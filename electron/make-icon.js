// Generate MyNote icons: blue bg + white document with folded corner + content lines
// Outputs: electron/icon.png (256), electron/tray.png (16),
//          public/icon-192.png, public/icon-512.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- Render icon at any size (supersampled 4x for smooth edges) ----
function renderIcon(size) {
  const SS = 4;                       // supersample factor
  const H = size * SS;
  const buf = Buffer.alloc(H * H * 4, 0);

  // Blue gradient background color at (x,y)
  function bgColor(x, y) {
    const t = y / H;                  // 0 top -> 1 bottom
    const r = Math.round(66 - 8 * t);
    const g = Math.round(96 - 14 * t);
    const b = Math.round(237 - 20 * t);
    return [r, g, b];
  }
  const bgA = new Float32Array([66, 96, 237]);
  const bgB = new Float32Array([58, 82, 217]);

  function inRoundedRect(x, y, x0, y0, x1, y1, rad) {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + rad, Math.min(x1 - rad, x));
    const cy = Math.max(y0 + rad, Math.min(y1 - rad, y));
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= rad * rad;
  }

  function inRect(x, y, x0, y0, x1, y1) {
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }

  // Triangle (inside) test via barycentric/sign
  function inTri(x, y, ax, ay, bx, by, cx, cy) {
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
    const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
    const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }

  // Geometry (fractions of H)
  const bgM = 0.03 * H, bgRad = 0.20 * H;              // background rounded square
  const pX0 = 0.18 * H, pY0 = 0.13 * H;                 // paper rect
  const pX1 = 0.82 * H, pY1 = 0.87 * H;
  const foldW = 0.15 * H;                               // fold corner size
  // Fold triangle: vertices A=(pX1-foldW,pY0) B=(pX1,pY0) C=(pX1,pY0+foldW)
  const ax = pX1 - foldW, ay = pY0;
  const bx = pX1, by = pY0;
  const cx2 = pX1, cy2 = pY0 + foldW;

  // Content lines (x0, x1, yCenter, thickness) - stadium shape
  const lines = [
    [0.28 * H, 0.72 * H, 0.36 * H, 0.05 * H],
    [0.28 * H, 0.72 * H, 0.50 * H, 0.05 * H],
    [0.28 * H, 0.53 * H, 0.64 * H, 0.05 * H]
  ];

  function inLine(x, y, lx0, lx1, ly, lt) {
    const half = lt / 2;
    if (Math.abs(y - ly) > half) return false;
    if (x >= lx0 + half && x <= lx1 - half) return true;
    const cx = x < lx0 + half ? lx0 : lx1;
    const dx = x - cx, dy = y - ly;
    return dx * dx + dy * dy <= half * half;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < H; x++) {
      const i = (y * H + x) * 4;
      // 1. Background rounded square
      if (!inRoundedRect(x, y, bgM, bgM, H - bgM, H - bgM, bgRad)) {
        buf[i + 3] = 0;
        continue;
      }
      const t = y / H;
      let r = bgA[0] + (bgB[0] - bgA[0]) * t;
      let g = bgA[1] + (bgB[1] - bgA[1]) * t;
      let b = bgA[2] + (bgB[2] - bgA[2]) * t;

      // 2. Fold triangle (paper folded back -> slightly darker blue)
      if (inTri(x, y, ax, ay, bx, by, cx2, cy2)) {
        r -= 14; g -= 10; b -= 4;
        buf[i] = Math.max(0, Math.round(r));
        buf[i + 1] = Math.max(0, Math.round(g));
        buf[i + 2] = Math.max(0, Math.round(b));
        buf[i + 3] = 255;
        continue;
      }

      // 3. Content lines (drawn on the paper)
      let isLine = false;
      for (const [lx0, lx1, ly, lt] of lines) {
        if (inLine(x, y, lx0, lx1, ly, lt)) { isLine = true; break; }
      }

      // 4. Paper (white)
      if (inRect(x, y, pX0, pY0, pX1, pY1)) {
        if (isLine) {
          buf[i] = 186; buf[i + 1] = 200; buf[i + 2] = 245; buf[i + 3] = 255;
        } else {
          buf[i] = 252; buf[i + 1] = 253; buf[i + 2] = 255; buf[i + 3] = 255;
        }
        continue;
      }

      // 5. Plain background
      buf[i] = Math.round(r); buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b); buf[i + 3] = 255;
    }
  }

  // ---- Downsample by SS to target size ----
  const out = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0, n = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * H + (x * SS + dx)) * 4;
          const a = buf[i + 3];
          rs += buf[i] * a; gs += buf[i + 1] * a; bs += buf[i + 2] * a; as += a; n++;
        }
      }
      const o = (y * size + x) * 4;
      if (as === 0) { out[o + 3] = 0; continue; }
      out[o] = Math.round(rs / as);
      out[o + 1] = Math.round(gs / as);
      out[o + 2] = Math.round(bs / as);
      out[o + 3] = Math.round(as / n);
    }
  }
  return out;
}

// ---- Minimal PNG encoder (RGBA) ----
function encodePNG(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function makeChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcData = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcData));
    return Buffer.concat([len, typeB, data, crc]);
  }

  const rawData = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    rawData[y * (1 + size * 4)] = 0;
    pixels.copy(rawData, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(rawData)),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- ICO wrapper (256x256 PNG-based, Vista+) ----
function encodeICO(pngBytes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: icon
  header.writeUInt16LE(1, 4);  // count
  const entry = Buffer.alloc(16);
  entry[0] = 0;  // 256 px
  entry[1] = 0;  // 256 px
  entry[2] = 0;  // no palette
  entry[3] = 0;  // reserved
  entry.writeUInt16LE(1, 4);  // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(pngBytes.length, 8);
  entry.writeUInt32LE(22, 12); // offset = header + entry
  return Buffer.concat([header, entry, pngBytes]);
}

const icon256 = renderIcon(256);
const icon192 = renderIcon(192);
const icon512 = renderIcon(512);
const tray16 = renderIcon(16);
const iconPng = encodePNG(256, icon256);

fs.writeFileSync(path.join(__dirname, 'icon.png'), iconPng);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), encodeICO(iconPng));
fs.writeFileSync(path.join(__dirname, 'tray.png'), encodePNG(16, tray16));
fs.writeFileSync(path.join(__dirname, '..', 'public', 'icon-192.png'), encodePNG(192, icon192));
fs.writeFileSync(path.join(__dirname, '..', 'public', 'icon-512.png'), encodePNG(512, icon512));
console.log('Icons written: electron/icon.png, electron/icon.ico, electron/tray.png, public/icon-192.png, public/icon-512.png');
