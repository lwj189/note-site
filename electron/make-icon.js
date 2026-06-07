// Generate a simple 64x64 icon for MyNote
const fs = require('fs');
const path = require('path');

// Create a minimal 64x64 blue circle PNG
// This is a valid PNG file (RGBA, 64x64, blue circle on transparent bg)
function createPNG() {
  const w = 64, h = 64;
  const pixels = Buffer.alloc(w * h * 4, 0);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - 32, dy = y - 32;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 28) {
        const idx = (y * w + x) * 4;
        // Gradient blue
        const r = Math.max(0, 67 - dist * 0.5);
        const g = Math.max(0, 97 - dist * 0.5);
        const b = Math.min(255, 238 + dist * 0.3);
        pixels[idx] = Math.round(r);
        pixels[idx + 1] = Math.round(g);
        pixels[idx + 2] = Math.round(b);
        pixels[idx + 3] = 255;
        
        // Highlight
        if (dist < 10) {
          pixels[idx] = Math.min(255, pixels[idx] + 40);
          pixels[idx + 1] = Math.min(255, pixels[idx + 1] + 40);
          pixels[idx + 2] = Math.min(255, pixels[idx + 2] + 40);
        }
      }
    }
  }

  // Build PNG manually (minimal valid PNG)
  const zlib = require('zlib');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    for (let i = 0; i < buf.length; i++) {
      crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcData = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData));
    return Buffer.concat([len, typeB, data, crc]);
  }

  // Image data with filter bytes (0 = None)
  const rawData = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    rawData[y * (1 + w * 4)] = 0; // filter byte
    pixels.copy(rawData, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  
  const compressed = zlib.deflateSync(rawData);

  const iend = Buffer.alloc(0);
  
  const png = Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend)
  ]);
  
  return png;
}

const png = createPNG();
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('Icon created: electron/icon.png (' + png.length + ' bytes)');
