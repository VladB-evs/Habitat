import Foundation
import FoundationModels

// habitat-ai — the bridge between Electron and Apple's on-device model.
//
// Apple exposes Foundation Models to Swift only, so this binary is spawned once
// and kept alive for the life of the app. It speaks newline-delimited JSON:
//
//   in   { "id": "7", "op": "run", "instructions": "…", "prompt": "…" }
//   out  { "id": "7", "event": "delta", "text": "partial…" }        (repeated)
//   out  { "id": "7", "event": "done",  "text": "the whole reply" }
//
// A "run" carrying a `schema` is answered with JSON matching that shape instead
// of prose, built by the model's guided generation. Those don't stream — half an
// object is no use to a caller — so they arrive as one `done` with `structured`.
//
// Other ops: "availability" (answers with a `result` event), "prewarm" (loads
// the model so the first real request isn't slow), "cancel" (stops a run in
// flight). Every failure comes back as an `error` event on the same id, so the
// caller never has to time out waiting for a reply that isn't coming.

// MARK: - Output

/// Stdout is shared by every in-flight run, so writes go through one actor —
/// interleaved bytes would be unparseable half-lines on the other end.
actor Emitter {
  static let shared = Emitter()
  private let handle = FileHandle.standardOutput

  func send(_ payload: [String: Any]) {
    guard
      let data = try? JSONSerialization.data(withJSONObject: payload, options: [.withoutEscapingSlashes])
    else { return }
    handle.write(data)
    handle.write(Data([0x0A]))
  }

  func error(_ id: String, _ message: String, code: String = "failed") {
    send(["id": id, "event": "error", "message": message, "code": code])
  }
}

// MARK: - Errors

/// Model failures are jargon by default ("exceededContextWindowSize"). The app
/// shows these strings to a person, so they're translated here where the cases
/// live rather than being pattern-matched back out of a description in JS.
private func describe(_ error: Error) -> (String, String) {
  if let gen = error as? LanguageModelSession.GenerationError {
    switch gen {
    case .exceededContextWindowSize:
      return ("too-long", "That's more text than the on-device model can hold at once. Try a smaller selection.")
    case .guardrailViolation:
      return ("guardrail", "Apple's on-device model declined to answer that one.")
    case .unsupportedLanguageOrLocale:
      return ("language", "The on-device model doesn't support that language yet.")
    case .assetsUnavailable:
      return ("unavailable", "The on-device model isn't downloaded yet. Check Apple Intelligence in System Settings.")
    case .rateLimited:
      return ("rate-limited", "Too many requests at once — give it a moment.")
    default:
      return ("failed", gen.localizedDescription)
    }
  }
  return ("failed", error.localizedDescription)
}

// MARK: - Availability

private func availability() -> [String: Any] {
  switch SystemLanguageModel.default.availability {
  case .available:
    return ["available": true]
  case .unavailable(let reason):
    let message: String
    switch reason {
    case .deviceNotEligible:
      message = "This Mac doesn't support Apple Intelligence."
    case .appleIntelligenceNotEnabled:
      message = "Turn on Apple Intelligence in System Settings to use this."
    case .modelNotReady:
      message = "Apple Intelligence is still downloading its model. Try again shortly."
    default:
      message = "Apple Intelligence isn't available right now."
    }
    return ["available": false, "reason": message]
  @unknown default:
    return ["available": false, "reason": "Apple Intelligence isn't available right now."]
  }
}

// MARK: - Guided generation

private struct BadSchema: LocalizedError {
  let detail: String
  var errorDescription: String? { "Bad schema: \(detail)" }
}

/**
 Builds a schema at runtime from the description JS sends.

 It has to be built rather than declared with `@Generable` because the shapes
 depend on the vault: which object types exist, which tags, which properties a
 type defines. None of that is known when this binary is compiled.

 Returns the schema plus every *named* sub-schema, which `GenerationSchema`
 requires listed as dependencies — an enum referenced by a property is not
 discovered on its own.
 */
private func buildSchema(_ spec: [String: Any], name: String) throws -> (DynamicGenerationSchema, [DynamicGenerationSchema]) {
  switch (spec["type"] as? String) ?? "string" {
  case "string":
    return (DynamicGenerationSchema(type: String.self), [])
  case "integer":
    return (DynamicGenerationSchema(type: Int.self), [])
  case "number":
    return (DynamicGenerationSchema(type: Double.self), [])
  case "boolean":
    return (DynamicGenerationSchema(type: Bool.self), [])

  case "enum":
    guard let values = spec["values"] as? [String], !values.isEmpty else {
      throw BadSchema(detail: "\(name) is an enum with no values")
    }
    // Constraining to the values that exist is the whole point: the model cannot
    // invent a type or tag the vault has never heard of.
    let schema = DynamicGenerationSchema(name: name, anyOf: values)
    return (schema, [schema])

  case "array":
    guard let items = spec["items"] as? [String: Any] else {
      throw BadSchema(detail: "\(name) is an array with no items")
    }
    let (item, deps) = try buildSchema(items, name: name + "Item")
    return (DynamicGenerationSchema(arrayOf: item), deps)

  case "object":
    guard let properties = spec["properties"] as? [[String: Any]] else {
      throw BadSchema(detail: "\(name) is an object with no properties")
    }
    var deps: [DynamicGenerationSchema] = []
    var fields: [DynamicGenerationSchema.Property] = []
    for property in properties {
      guard let field = property["name"] as? String else {
        throw BadSchema(detail: "a property of \(name) has no name")
      }
      let (child, childDeps) = try buildSchema(property, name: name + field.prefix(1).uppercased() + field.dropFirst())
      deps += childDeps
      fields.append(
        .init(
          name: field,
          description: property["description"] as? String,
          schema: child,
          isOptional: (property["optional"] as? Bool) ?? false
        )
      )
    }
    return (
      DynamicGenerationSchema(name: name, description: spec["description"] as? String, properties: fields),
      deps
    )

  case let other:
    throw BadSchema(detail: "unknown type \(other)")
  }
}

// MARK: - Runs

/// Owns every run in flight so `cancel` has something to cancel, and so a second
/// request on a dead id can't resurrect the first.
actor Runner {
  static let shared = Runner()
  private var running: [String: Task<Void, Never>] = [:]

  func start(
    id: String,
    instructions: String,
    prompt: String,
    temperature: Double?,
    // Carried as JSON rather than a dictionary: `[String: Any]` is not Sendable,
    // and this crosses into the actor.
    schema: Data?
  ) {
    running[id]?.cancel()
    running[id] = Task {
      let session = LanguageModelSession(instructions: instructions)
      var options = GenerationOptions()
      if let temperature { options = GenerationOptions(temperature: temperature) }

      // A schema means the caller wants JSON it can act on, not prose to show.
      // There is nothing to stream in that case — a half-built object is no use
      // to anyone — so it arrives in one piece.
      if let schema {
        do {
          guard let spec = try JSONSerialization.jsonObject(with: schema) as? [String: Any] else {
            throw BadSchema(detail: "not an object")
          }
          let (root, deps) = try buildSchema(spec, name: (spec["name"] as? String) ?? "Result")
          let generation = try GenerationSchema(root: root, dependencies: deps)
          let reply = try await session.respond(to: prompt, schema: generation, options: options)
          await Emitter.shared.send([
            "id": id, "event": "done", "text": String(describing: reply.content), "structured": true,
          ])
        } catch is CancellationError {
          await Emitter.shared.send(["id": id, "event": "cancelled"])
        } catch let error as BadSchema {
          await Emitter.shared.error(id, error.localizedDescription, code: "bad-request")
        } catch {
          let (code, message) = describe(error)
          await Emitter.shared.error(id, message, code: code)
        }
        await Runner.shared.finished(id)
        return
      }

      do {
        // Snapshots arrive cumulative — the whole reply so far, every time — so
        // the delta is whatever's been appended since the last one.
        var sent = ""
        for try await snapshot in session.streamResponse(to: prompt, options: options) {
          if Task.isCancelled { break }
          let text = snapshot.content
          guard text.count > sent.count, text.hasPrefix(sent) else {
            // A rewritten (not appended) snapshot: replace rather than diff.
            sent = text
            await Emitter.shared.send(["id": id, "event": "reset", "text": text])
            continue
          }
          let delta = String(text.dropFirst(sent.count))
          sent = text
          await Emitter.shared.send(["id": id, "event": "delta", "text": delta])
        }
        if Task.isCancelled {
          await Emitter.shared.send(["id": id, "event": "cancelled"])
        } else {
          await Emitter.shared.send(["id": id, "event": "done", "text": sent])
        }
      } catch is CancellationError {
        await Emitter.shared.send(["id": id, "event": "cancelled"])
      } catch {
        let (code, message) = describe(error)
        await Emitter.shared.error(id, message, code: code)
      }
      await Runner.shared.finished(id)
    }
  }

  func cancel(id: String) {
    running[id]?.cancel()
    running[id] = nil
  }

  fileprivate func finished(_ id: String) {
    running[id] = nil
  }
}

/// Loading the model takes about a second. Doing it when the editor opens, rather
/// than when the user first clicks, is the difference between snappy and sluggish.
private func prewarm() {
  guard case .available = SystemLanguageModel.default.availability else { return }
  LanguageModelSession().prewarm()
}

// MARK: - Input

/// `readLine` blocks, which an async task must not do, so stdin is drained on its
/// own thread and handed over as a stream.
private func stdinLines() -> AsyncStream<String> {
  AsyncStream { continuation in
    let thread = Thread {
      while let line = readLine(strippingNewline: true) {
        continuation.yield(line)
      }
      continuation.finish()
    }
    thread.name = "habitat-ai.stdin"
    thread.start()
  }
}

@main
struct Main {
  static func main() async {
    for await line in stdinLines() {
      let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty { continue }
      guard
        let data = trimmed.data(using: .utf8),
        let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let id = msg["id"] as? String,
        let op = msg["op"] as? String
      else {
        await Emitter.shared.error("", "Could not parse that request.", code: "bad-request")
        continue
      }

      switch op {
      case "availability":
        var payload = availability()
        payload["id"] = id
        payload["event"] = "result"
        await Emitter.shared.send(payload)

      case "prewarm":
        prewarm()
        await Emitter.shared.send(["id": id, "event": "result", "ok": true])

      case "run":
        guard let prompt = msg["prompt"] as? String, !prompt.isEmpty else {
          await Emitter.shared.error(id, "Nothing to work on.", code: "bad-request")
          continue
        }
        await Runner.shared.start(
          id: id,
          instructions: (msg["instructions"] as? String) ?? "You are a helpful writing assistant.",
          prompt: prompt,
          temperature: msg["temperature"] as? Double,
          schema: (msg["schema"] as? [String: Any]).flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        )

      case "cancel":
        await Runner.shared.cancel(id: id)

      default:
        await Emitter.shared.error(id, "Unknown op: \(op)", code: "bad-request")
      }
    }
    // stdin closed: Electron is gone, and so are we.
    exit(0)
  }
}
