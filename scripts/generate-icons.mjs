#!/usr/bin/env node
/**
 * Generate Stori PWA icons using only Node built-ins (no native deps).
 *
 * Renders a brand-coloured rounded square with a stylised "S" glyph.
 * Outputs public/icon-192.png and public/icon-512.png.
 *
 * Run: `node scripts/generate-icons.mjs`
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, "..", "public");

// Brand palette (matches manifest.json theme_color)
const BG_TOP = [99, 86, 247];   // #6356F7
const BG_BOTTOM = [236, 72, 153]; // #EC4899
const FG = [255, 255, 255];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function gradientColor(y, h) {
  const t = y / h;
  return [lerp(BG_TOP[0], BG_BOTTOM[0], t), lerp(BG_TOP[1], BG_BOTTOM[1], t), lerp(BG_TOP[2], BG_BOTTOM[2], t)];
}

/**
 * Draw the icon:
 *   - rounded-square background with vertical brand gradient
 *   - white "S" glyph centred
 */
function renderRGBA(size) {
  const data = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.22); // rounded-square corner radius

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded square mask
      const inCorner = (() => {
        const cx = x < radius ? radius : x > size - radius - 1 ? size - radius - 1 : x;
        const cy = y < radius ? radius : y > size - radius - 1 ? size - radius - 1 : y;
        const dx = x - cx;
        const dy = y - cy;
        return dx * dx + dy * dy > radius * radius;
      })();

      if (inCorner) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        continue;
      }

      // Background gradient
      let [r, g, b] = gradientColor(y, size);

      // Stylised "S": three horizontal bars, offset to suggest the letter
      // Glyph bbox: 30%..70% of size, three bars at 22%, 48%, 74% of glyph height
      const gxMin = size * 0.3;
      const gxMax = size * 0.7;
      const gyMin = size * 0.28;
      const gyMax = size * 0.72;
      const gw = gxMax - gxMin;
      const gh = gyMax - gyMin;
      const barH = gh * 0.16;
      const barInset = gw * 0.04;

      const bars = [
        { y: gyMin,                 left: gxMin,            right: gxMax - barInset }, // top — left aligned
        { y: gyMin + gh / 2 - barH / 2, left: gxMin + barInset, right: gxMax - barInset }, // middle
        { y: gyMax - barH,          left: gxMin + barInset, right: gxMax }, // bottom — right aligned
      ];

      let onGlyph = false;
      for (const bar of bars) {
        if (y >= bar.y && y < bar.y + barH && x >= bar.left && x <= bar.right) {
          onGlyph = true;
          break;
        }
      }

      // Vertical connectors of the S (left side top half, right side bottom half)
      const vBarW = gw * 0.16;
      const vBarLeft  = { x: gxMin, y1: gyMin,            y2: gyMin + gh / 2 + barH / 2 };
      const vBarRight = { x: gxMax - vBarW, y1: gyMin + gh / 2 - barH / 2, y2: gyMax };
      if (y >= vBarLeft.y1 && y < vBarLeft.y2 && x >= vBarLeft.x && x < vBarLeft.x + vBarW) onGlyph = true;
      if (y >= vBarRight.y1 && y < vBarRight.y2 && x >= vBarRight.x && x < vBarRight.x + vBarW) onGlyph = true;

      if (onGlyph) {
        r = FG[0]; g = FG[1]; b = FG[2];
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return data;
}

// ── PNG encoder ────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type: RGBA
  ihdr[10] = 0;    // compression
  ihdr[11] = 0;    // filter
  ihdr[12] = 0;    // interlace

  // Add filter byte (0 = None) at the start of each scanline
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ── Run ─────────────────────────────────────────────────────────

for (const size of [192, 512]) {
  const rgba = renderRGBA(size);
  const png = encodePNG(rgba, size);
  const out = resolve(PUBLIC, `icon-${size}.png`);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}
