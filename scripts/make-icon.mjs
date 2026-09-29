// Renders the app icon (a shaded matcap sphere) to app-icon.png.
// Then: pnpm tauri icon app-icon.png
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const S = 1024;
const px = new Uint8Array(S * S * 4);
const clamp = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const nx = ((x + 0.5) / S) * 2 - 1;
    const ny = 1 - ((y + 0.5) / S) * 2;
    const r = Math.hypot(nx, ny) / 0.92;
    const i = (y * S + x) * 4;
    const cover = clamp((1 - r) * S * 0.46 + 0.5);
    if (cover <= 0) continue;
    const qx = nx / 0.92;
    const qy = ny / 0.92;
    const nz = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
    // base gradient (deep indigo -> teal)
    const t = (qy + 1) / 2;
    let cr = mix(0.1, 0.18, t);
    let cg = mix(0.08, 0.55, t);
    let cb = mix(0.3, 0.75, t);
    // key light
    const L = [-0.45, 0.55, 0.7];
    const ll = Math.hypot(...L);
    const ndl = (qx * L[0] + qy * L[1] + nz * L[2]) / ll;
    const spec = smooth(0.9, 0.985, ndl);
    cr += spec;
    cg += spec;
    cb += spec;
    // warm rim
    const rim = Math.pow(1 - nz, 3);
    cr += rim * 0.95;
    cg += rim * 0.45;
    cb += rim * 0.2;
    px[i] = Math.round(clamp(cr) * 255);
    px[i + 1] = Math.round(clamp(cg) * 255);
    px[i + 2] = Math.round(clamp(cb) * 255);
    px[i + 3] = Math.round(cover * 255);
  }
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) Buffer.from(px.subarray(y * S * 4, (y + 1) * S * 4)).copy(raw, y * (S * 4 + 1) + 1);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../app-icon.png', import.meta.url), png);
console.log('wrote app-icon.png');
