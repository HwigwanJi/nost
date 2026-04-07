/**
 * create-icons.js  (alternative: simpler solid-color PNG generator)
 *
 * This version creates the smallest valid PNG possible for Chrome to accept,
 * using only Node.js built-ins. Run with:
 *
 *   node create-icons.js
 *
 * Then you can delete this file.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* ---- PNG primitives ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf, start = 0, end = buf.length) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const combined = Buffer.concat([t, d]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(combined), 0);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(d.length, 0);
  return Buffer.concat([len, combined, crc]);
}

/**
 * Make a solid RGBA PNG of given size with the given fill colour.
 * @param {number} size
 * @param {number[]} rgba  [r, g, b, a]
 */
function solidPNG(size, [r, g, b, a]) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  // bytes 10-12 stay 0 (deflate, adaptive, no interlace)

  // Raw image: one filter-byte (0) + size*4 bytes per row
  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    const base = y * rowLen;
    raw[base] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const p = base + 1 + x * 4;
      raw[p]     = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Purple brand colour: #7c3aed  →  rgba(124, 58, 237, 255)
const FILL = [124, 58, 237, 255];

for (const size of [16, 48, 128]) {
  const buf = solidPNG(size, FILL);
  const out = path.join(OUT, `icon${size}.png`);
  fs.writeFileSync(out, buf);
  console.log(`icon${size}.png  (${buf.length} B)`);
}
console.log('Icons ready.');
