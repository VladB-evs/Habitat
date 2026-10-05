// Builds the `habitat-ai` sidecar and drops it in native/, which is what
// electron-builder copies into the packaged app and what electron/ai.js looks
// for at runtime.
//
// Apple's Foundation Models framework needs macOS 26 to build against, so this
// is a no-op elsewhere — the app then reports the model as unavailable and
// hides its buttons, rather than failing to start.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swiftDir = path.join(root, 'swift');
const outDir = path.join(root, 'native');
const outBin = path.join(outDir, 'habitat-ai');

if (process.platform !== 'darwin') {
  console.log('• habitat-ai: skipped (macOS only)');
  process.exit(0);
}

try {
  execFileSync('swift', ['build', '-c', 'release'], { cwd: swiftDir, stdio: 'inherit' });
} catch {
  // A Mac on an older SDK can still build and run the rest of the app.
  console.warn('• habitat-ai: build failed — the on-device model will be unavailable.');
  process.exit(0);
}

const built = path.join(swiftDir, '.build', 'release', 'habitat-ai');
if (!fs.existsSync(built)) {
  console.warn('• habitat-ai: nothing was produced — the on-device model will be unavailable.');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
// Delete before copying rather than overwriting in place. macOS caches a binary's
// code signature against its inode; writing new bytes into the old inode leaves
// that cache stale and the kernel kills the process on launch with an invalid
// signature — which looks exactly like a crash, and only after a rebuild.
fs.rmSync(outBin, { force: true });
fs.copyFileSync(built, outBin);
fs.chmodSync(outBin, 0o755);
console.log(`• habitat-ai → ${path.relative(root, outBin)}`);
