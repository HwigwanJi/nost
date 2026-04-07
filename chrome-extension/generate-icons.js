/**
 * generate-icons.js
 *
 * Run once with Node.js to produce the icon PNG files:
 *   node generate-icons.js
 *
 * No external dependencies. Creates icons/icon16.png, icon48.png, icon128.png
 * as solid-color PNGs with a simple rocket-style design using raw PNG encoding.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, 'icons');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// CRC32 table
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function uint32BE(n) {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const dataBytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const lenBytes = Buffer.from(uint32BE(dataBytes.length));
  const crcInput = Buffer.concat([typeBytes, dataBytes]);
  const crcBytes = Buffer.from(uint32BE(crc32(crcInput)));
  return Buffer.concat([lenBytes, typeBytes, dataBytes, crcBytes]);
}

/**
 * Build a PNG for a given size.
 * Design: purple gradient-style background (#7c3aed) with a white rocket shape.
 */
function buildPNG(size) {
  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);   // width
  ihdrData.writeUInt32BE(size, 4);   // height
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  // Build raw image data (RGB, filter byte = 0 per row)
  // Colors
  const BG   = [124, 58, 237];  // #7c3aed purple
  const LITE = [167, 139, 250]; // #a78bfa lighter purple (top-left highlight)
  const WHITE = [255, 255, 255];
  const BODY  = [255, 255, 255]; // rocket body

  const rawRows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter byte
    for (let x = 0; x < size; x++) {
      // Normalised coords -1..1 from centre
      const nx = (x / (size - 1)) * 2 - 1;
      const ny = (y / (size - 1)) * 2 - 1;
      const dist = Math.sqrt(nx * nx + ny * ny);

      // Rounded square mask (superellipse, n=6)
      const mask = Math.pow(Math.abs(nx), 6) + Math.pow(Math.abs(ny), 6);
      if (mask > 0.75) {
        // Transparent-ish: use BG colour (PNG has no alpha in type 2, so just extend BG)
        row.push(...BG);
        continue;
      }

      // Background gradient: lighter at top-left
      const bgBlend = Math.max(0, 1 - (nx * 0.3 + ny * 0.3 + 1) / 2);
      const bg = BG.map((c, i) => Math.round(c + (LITE[i] - c) * bgBlend * 0.5));

      // Rocket body: vertical oval, slightly taller than wide, in centre
      const rW = 0.28;
      const rH = 0.45;
      const body = (nx * nx) / (rW * rW) + ((ny + 0.05) * (ny + 0.05)) / (rH * rH);

      // Fins: two small triangles at bottom
      const finLeft  = ny > 0.25 && nx > -0.45 && nx < -0.18 && ny - 0.25 > -(nx + 0.18) * 1.2;
      const finRight = ny > 0.25 && nx < 0.45  && nx > 0.18  && ny - 0.25 > (nx - 0.18) * 1.2;

      // Flame: small orange teardrop below centre
      const flameNy = ny - 0.42;
      const flame = ny > 0.35 && (nx * nx) / 0.04 + (flameNy * flameNy) / 0.04 < 1;

      let pixel;
      if (body < 1) {
        // White body with slight shadow on right
        const shade = Math.max(0, nx * 0.25);
        pixel = WHITE.map(c => Math.round(c - shade * 60));
      } else if (finLeft || finRight) {
        pixel = WHITE.map(c => Math.round(c * 0.85));
      } else if (flame) {
        pixel = [255, 165, 0]; // orange flame
      } else {
        pixel = bg;
      }

      row.push(...pixel);
    }
    rawRows.push(Buffer.from(row));
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = pngChunk('IHDR', ihdrData);
  const idatChunk = pngChunk('IDAT', compressed);
  const iendChunk = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIG, ihdrChunk, idatChunk, iendChunk]);
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const buf = buildPNG(size);
  const outPath = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Created ${outPath} (${buf.length} bytes)`);
}

console.log('Done! Icons generated in chrome-extension/icons/');
