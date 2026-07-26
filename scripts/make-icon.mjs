// Draws Habitat's app icon and writes every size macOS wants.
//
// No image libraries: shapes are signed distance fields sampled per pixel, so
// each size is rendered at its own resolution and comes out crisp. Run with
//   node scripts/make-icon.mjs
// then `iconutil -c icns build/icon.iconset -o build/icon.icns`.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build');

// The app's own palette: warm near-black, amber accent.
const BG_TOP = [32, 31, 29];
const BG_BOTTOM = [19, 19, 18];
const LEAF = [237, 161, 0];
const LEAF_DARK = [201, 133, 0];
const STEM = [166, 112, 6];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Coverage from a distance: 0 outside, 1 inside, smooth across one pixel. */
const cover = (d, px) => clamp01(0.5 - d / px);

function sdRoundedBox(px, py, halfW, halfH, r) {
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by, r) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t) - r;
}

/**
 * A leaf is the lens where two equal circles overlap — pointed at both ends, fat
 * in the middle. `len` is the half-length along the leaf, `width` the half-width
 * at its widest. Exact distances, so the edges antialias cleanly.
 */
function sdLeaf(px, py, cx, cy, angle, len, width) {
  const dx = px - cx;
  const dy = py - cy;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const x = dx * c - dy * s;
  const y = dx * s + dy * c;

  const r = (len * len + width * width) / (2 * width);
  const off = r - width;
  const d1 = Math.hypot(x, y + off) - r;
  const d2 = Math.hypot(x, y - off) - r;
  return Math.max(d1, d2);
}

/** The vein down the middle of a leaf, stopping short of both tips. */
function sdVein(px, py, cx, cy, angle, len, w) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return sdSegment(px, py, cx - c * len * 0.72, cy - s * len * 0.72, cx + c * len * 0.72, cy + s * len * 0.72, w);
}

function render(size) {
  const px = 1024 / size; // one pixel, in design units
  const rgba = Buffer.alloc(size * size * 4);
  const S = 1024;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample in a fixed 1024-unit design space, centred on the icon.
      const u = ((x + 0.5) * S) / size - S / 2;
      const v = ((y + 0.5) * S) / size - S / 2;

      // macOS leaves a margin around the rounded square.
      const bg = sdRoundedBox(u, v, 400, 400, 92);
      const bgA = cover(bg, px);
      if (bgA <= 0) continue;

      const grad = clamp01((v + 400) / 800);
      let col = mix(BG_TOP, BG_BOTTOM, grad);

      // Stem: two joined segments, leaning very slightly to suggest a curve.
      const stem = Math.min(
        sdSegment(u, v, 8, 235, -4, 80, 17),
        sdSegment(u, v, -4, 80, 4, -45, 16)
      );
      col = mix(col, STEM, cover(stem, px));

      // Left leaf sits lower and darker; the right one is the highlight.
      const angL = Math.PI + 0.55;
      const angR = -0.5;
      const leafL = sdLeaf(u, v, -128, -55, angL, 145, 58);
      const leafR = sdLeaf(u, v, 133, -130, angR, 158, 63);

      col = mix(col, LEAF_DARK, cover(leafL, px));
      col = mix(col, mix(LEAF_DARK, BG_TOP, 0.45), cover(Math.max(sdVein(u, v, -128, -55, angL, 145, 5), leafL), px));
      col = mix(col, LEAF, cover(leafR, px));
      col = mix(col, mix(LEAF, BG_TOP, 0.35), cover(Math.max(sdVein(u, v, 133, -130, angR, 158, 5.5), leafR), px));

      const i = (y * size + x) * 4;
      col = col.map((c) => Math.round(clamp01(c / 255) * 255));
      rgba[i] = col[0];
      rgba[i + 1] = col[1];
      rgba[i + 2] = col[2];
      rgba[i + 3] = Math.round(bgA * 255);
    }
  }
  return rgba;
}

/** Minimal PNG writer: one IDAT of filtered scanlines. */
function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

// macOS iconset names, plus a plain 1024 png for everything else.
const ICONSET = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

mkdirSync(`${OUT}/icon.iconset`, { recursive: true });
const cache = new Map();
for (const [size, name] of ICONSET) {
  if (!cache.has(size)) cache.set(size, png(size, render(size)));
  writeFileSync(`${OUT}/icon.iconset/${name}`, cache.get(size));
}
writeFileSync(`${OUT}/icon.png`, cache.get(1024));
console.log(`wrote ${ICONSET.length} sizes to build/icon.iconset and build/icon.png`);
