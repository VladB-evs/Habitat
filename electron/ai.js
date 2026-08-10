// Text generation, kept behind one small interface.
//
// Today there is exactly one provider: Apple's on-device model, reached through
// the `habitat-ai` Swift sidecar (swift/Sources/habitat-ai/main.swift), because
// Foundation Models is a Swift-only framework. Nothing leaves the machine and
// nothing needs a key.
//
// The provider shape is deliberately narrow — availability, run, cancel — so a
// hosted model can be added later without the renderer or the callers changing.
// Apple does not open Private Cloud Compute to third-party apps, so anything
// needing a large context window will have to arrive that way.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

/**
 * The on-device model holds roughly four thousand tokens of prompt and reply
 * together. Rather than spend a second discovering that, oversized work is
 * refused up front — the number is chars, and deliberately conservative so
 * there's room left for the model to answer at length.
 */
const MAX_PROMPT_CHARS = 6000;

/** Unpacked in dev, copied beside the app by electron-builder in a release. */
function sidecarPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'native', 'habitat-ai'),
    path.join(__dirname, '..', 'native', 'habitat-ai'),
    path.join(__dirname, '..', 'swift', '.build', 'release', 'habitat-ai'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

/* ------------------------------------------------------------------ *
 * Apple on-device provider
 * ------------------------------------------------------------------ */

const apple = (() => {
  let child = null;
  /** id → { onDelta, resolve, reject, text } */
  const pending = new Map();
  let startFailure = null;

  const failAll = (message) => {
    for (const [, req] of pending) req.reject(new Error(message));
    pending.clear();
  };

  function ensure() {
    if (child && !child.killed) return child;

    const bin = sidecarPath();
    if (!bin) {
      startFailure =
        'The on-device helper is missing from this build. Run `npm run build:ai` if you are working from source.';
      return null;
    }

    child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    startFailure = null;

    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      // The sidecar writes one JSON object per line; a chunk boundary can land
      // anywhere, so only whole lines are parsed and the tail is carried over.
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) handle(line);
      }
    });

    child.stderr.on('data', (d) => console.error('[habitat-ai]', d.toString().trim()));

    child.on('exit', (code) => {
      child = null;
      failAll(
        code === 0 ? 'The on-device helper stopped.' : `The on-device helper exited unexpectedly (${code}).`
      );
    });

    child.on('error', (err) => {
      child = null;
      startFailure = `Could not start the on-device helper: ${err.message}`;
      failAll(startFailure);
    });

    return child;
  }

  function handle(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return console.error('[habitat-ai] unparseable line', line);
    }
    const req = pending.get(msg.id);
    if (!req) return;

    switch (msg.event) {
      case 'delta':
        req.text += msg.text;
        req.onDelta?.(msg.text, req.text);
        break;
      // The model occasionally revises what it already said rather than appending;
      // the sidecar flags that so the caller can replace instead of concatenate.
      case 'reset':
        req.text = msg.text;
        req.onDelta?.(null, req.text);
        break;
      case 'done':
        pending.delete(msg.id);
        req.resolve({ text: msg.text ?? req.text });
        break;
      case 'cancelled':
        pending.delete(msg.id);
        req.resolve({ text: req.text, cancelled: true });
        break;
      case 'result':
        pending.delete(msg.id);
        req.resolve(msg);
        break;
      case 'error': {
        pending.delete(msg.id);
        const err = new Error(msg.message || 'The on-device model failed.');
        err.code = msg.code;
        req.reject(err);
        break;
      }
    }
  }

  /** One request in, one promise out; `onDelta` sees the reply as it's written. */
  function send(payload, onDelta) {
    const proc = ensure();
    if (!proc) return Promise.reject(new Error(startFailure));
    return new Promise((resolve, reject) => {
      pending.set(payload.id, { onDelta, resolve, reject, text: '' });
      proc.stdin.write(JSON.stringify(payload) + '\n', (err) => {
        if (!err) return;
        pending.delete(payload.id);
        reject(new Error('Could not reach the on-device helper.'));
      });
    });
  }

  return {
    id: 'apple-on-device',
    label: 'Apple Intelligence (on device)',

    async availability() {
      if (process.platform !== 'darwin') {
        return { available: false, reason: 'Apple Intelligence is only available on macOS.' };
      }
      if (!sidecarPath()) {
        return {
          available: false,
          reason: 'The on-device helper is missing from this build.',
        };
      }
      try {
        const res = await send({ id: randomUUID(), op: 'availability' });
        return { available: !!res.available, reason: res.reason };
      } catch (err) {
        return { available: false, reason: err.message };
      }
    },

    /** Load the model ahead of the first click, which is otherwise about a second slower. */
    prewarm() {
      try {
        send({ id: randomUUID(), op: 'prewarm' }).catch(() => {});
      } catch {
        /* prewarming is a courtesy; failing at it changes nothing */
      }
    },

    /**
     * With a `schema` the reply is JSON matching that shape, built by the model's
     * guided generation rather than parsed out of prose — and it arrives whole
     * instead of streaming, since half an object is no use to a caller.
     */
    run({ id, instructions, prompt, temperature, schema }, onDelta) {
      if (prompt.length > MAX_PROMPT_CHARS) {
        return Promise.reject(
          new Error("That's more text than the on-device model can hold at once. Try a smaller selection.")
        );
      }
      return send({ id, op: 'run', instructions, prompt, temperature, schema }, onDelta);
    },

    cancel(id) {
      const req = pending.get(id);
      if (!req) return false;
      // The sidecar answers with `cancelled`, which settles the promise — so the
      // entry stays in `pending` until then rather than being dropped here.
      try {
        child?.stdin.write(JSON.stringify({ id, op: 'cancel' }) + '\n');
      } catch {
        return false;
      }
      return true;
    },

    stop() {
      failAll('Habitat is closing.');
      child?.kill();
      child = null;
    },
  };
})();

/* ------------------------------------------------------------------ *
 * The public surface
 * ------------------------------------------------------------------ */

const providers = { [apple.id]: apple };
let activeId = apple.id;

const provider = () => providers[activeId];

module.exports = {
  MAX_PROMPT_CHARS,
  provider,
  availability: () => provider().availability(),
  prewarm: () => provider().prewarm(),
  run: (req, onDelta) => provider().run(req, onDelta),
  cancel: (id) => provider().cancel(id),
  stop: () => {
    for (const p of Object.values(providers)) p.stop?.();
  },
};
