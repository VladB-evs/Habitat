// macOS takes the app-menu title from the running bundle's Info.plist, not from
// app.setName(), so an unpackaged run says "Electron" however the menu is built.
// This renames the local Electron.app in node_modules — dev only, and re-run
// automatically before `npm run dev` / `npm start`. Packaged builds get the name
// from electron-builder's productName instead.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plist = resolve(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist');
if (!existsSync(plist)) process.exit(0);

const NAME = 'Habitat';
const set = (xml, key, value) =>
  xml.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`), `$1${value}$2`);

const before = readFileSync(plist, 'utf8');
let after = set(before, 'CFBundleName', NAME);
after = set(after, 'CFBundleDisplayName', NAME);

if (after !== before) {
  writeFileSync(plist, after);
  console.log(`dev: renamed the local Electron bundle to ${NAME}`);
}
