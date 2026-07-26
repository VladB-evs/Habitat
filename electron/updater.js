// Self-update without code signing.
//
// Squirrel (electron-updater) refuses to install onto an unsigned bundle, so
// this does the swap itself: read the newest GitHub release, download its zip,
// unpack it next to the installed app, and move it into place. macOS keeps a
// running process alive through its own bundle being replaced, so the app can
// relaunch straight into the new version.
//
// On Windows and Linux it stops at "there's a new version" and opens the
// release page, since replacing a running .exe/.AppImage isn't safe.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UA = { 'user-agent': 'Habitat-Updater', accept: 'application/vnd.github+json' };

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
  );

/** "1.2.10" > "1.2.9" — numeric compare, tolerant of a leading v. */
function isNewer(candidate, current) {
  const parse = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

async function latestRelease(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: UA });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return res.json();
}

/** The zip built for this machine's architecture, falling back to any zip. */
function pickAsset(release) {
  const assets = release.assets || [];
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return (
    assets.find((a) => a.name.endsWith('.zip') && a.name.includes(arch)) ||
    assets.find((a) => a.name.endsWith('.zip')) ||
    null
  );
}

async function download(url, to) {
  const res = await fetch(url, { headers: { ...UA, accept: 'application/octet-stream' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

/**
 * Swaps the installed bundle for the downloaded one. The old copy is only
 * deleted once the new one is in place, and is put back if the move fails.
 */
async function installMac(zipPath, appPath) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-update-'));
  await run('/usr/bin/ditto', ['-x', '-k', zipPath, work]);

  const unpacked = fs.readdirSync(work).find((n) => n.endsWith('.app'));
  if (!unpacked) throw new Error('the release zip had no .app in it');
  const fresh = path.join(work, unpacked);

  // Downloads are quarantined; without this macOS blocks the unsigned bundle.
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', fresh]).catch(() => {});

  const backup = `${appPath}.old`;
  fs.rmSync(backup, { recursive: true, force: true });
  fs.renameSync(appPath, backup);
  try {
    fs.renameSync(fresh, appPath);
  } catch (err) {
    // Cross-device or permissions: put the original back rather than leaving nothing.
    fs.renameSync(backup, appPath);
    throw err;
  }
  fs.rmSync(backup, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
}

/** The installed .app bundle, or null when running from source. */
function bundlePath(execPath) {
  const i = execPath.indexOf('.app/Contents/MacOS/');
  return i === -1 ? null : execPath.slice(0, i + 4);
}

module.exports = { isNewer, latestRelease, pickAsset, download, installMac, bundlePath };
