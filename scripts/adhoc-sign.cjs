// Apple Silicon refuses to run an arm64 app with no signature at all — macOS
// reports it as "damaged". A Developer ID costs money and we don't ship one, so
// the bundle is signed ad-hoc instead: no identity, no notarisation, but a valid
// signature, which is enough for the app to launch (after the usual right-click
// → Open, or once quarantine is cleared).

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // The model sidecar is a Mach-O binary sitting in Resources, and macOS refuses
  // to spawn an unsigned one. Sign it before the bundle: an inner signature has
  // to be in place before the outer one is computed over it.
  const sidecar = path.join(app, 'Contents', 'Resources', 'native', 'habitat-ai');
  if (fs.existsSync(sidecar)) {
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', sidecar], { stdio: 'inherit' });
  }

  // --deep so the helper apps and frameworks inside are signed too.
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed  ${path.basename(app)}`);
};
