// swift-tools-version: 6.2
import PackageDescription

// Builds `habitat-ai`, the sidecar Electron talks to over stdin/stdout. Apple's
// on-device model is reachable from Swift only, so this tiny binary is the whole
// bridge — see Sources/habitat-ai/main.swift for the line protocol.
let package = Package(
  name: "habitat-ai",
  platforms: [.macOS(.v26)],
  targets: [
    .executableTarget(name: "habitat-ai", path: "Sources/habitat-ai")
  ]
)
