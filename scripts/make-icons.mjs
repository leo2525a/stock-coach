#!/usr/bin/env node
/**
 * Generates the PWA raster icons from the candlestick mark.
 *
 * Deliberately dependency-free: the mark is simple enough (flat rounded square,
 * a few rectangles) that emitting PNG chunks by hand is smaller and far more
 * predictable than pulling in sharp/canvas just to run at install time.
 *
 *   node scripts/make-icons.mjs
 *
 * Output is RGBA, so the "any" icons have genuinely transparent corners and the
 * full-bleed (maskable / iOS) variants stay fully opaque.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');
mkdirSync(publicDir, { recursive: true });

const BG = [0x0d, 0x11, 0x17];
const UP = [0x26, 0xa6, 0x9a];
const DOWN = [0xef, 0x53, 0x50];
const ACCENT = [0x4c, 0x8d, 0xff];

/* ---------------- PNG encoding ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA pixel buffer as a PNG. */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- drawing ---------------- */

/**
 * Rasterise the mark at N x N in RGBA.
 *
 * Geometry is expressed as fractions of the canvas so one routine serves every
 * size. `padding`/`radius` are fractions too; `radius: 0` gives a square.
 */
function renderAt(N, { padding = 0.14, radius = 0.22, bleed = false } = {}) {
  const px = Buffer.alloc(N * N * 4);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };

  // With `bleed` the plate covers the whole canvas (maskable / iOS), otherwise
  // it floats inside `padding` with transparent surroundings.
  const pad = bleed ? 0 : N * padding;
  const r = bleed ? 0 : N * radius;

  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      if (x < pad || x >= N - pad || y < pad || y >= N - pad) continue;
      if (r === 0) {
        set(x, y, BG);
        continue;
      }
      const cx = Math.min(Math.max(x, pad + r), N - pad - r);
      const cy = Math.min(Math.max(y, pad + r), N - pad - r);
      const straight = (x >= pad + r && x < N - pad - r) || (y >= pad + r && y < N - pad - r);
      if (straight || Math.hypot(x - cx, y - cy) <= r) set(x, y, BG);
    }
  }

  // Four candlesticks, evenly spaced across the inner width.
  const inner = N - 2 * pad;
  const slot = inner / 4;
  const body = inner * 0.115;
  const wick = Math.max(1, inner * 0.024);
  const bars = [
    { up: true, top: 0.34, bot: 0.78, bodyTop: 0.45, bodyBot: 0.71 },
    { up: true, top: 0.22, bot: 0.65, bodyTop: 0.31, bodyBot: 0.58 },
    { up: false, top: 0.3, bot: 0.74, bodyTop: 0.38, bodyBot: 0.65 },
    { up: true, top: 0.2, bot: 0.6, bodyTop: 0.26, bodyBot: 0.51 },
  ];

  const fill = (x0, x1, y0, y1, colour) => {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y += 1) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x += 1) set(x, y, colour);
    }
  };

  bars.forEach((bar, idx) => {
    const cx = pad + slot * (idx + 0.5);
    const colour = bar.up ? UP : DOWN;
    const y0 = pad + inner * bar.top;
    const y1 = pad + inner * bar.bot;
    const b0 = pad + inner * bar.bodyTop;
    const b1 = pad + inner * bar.bodyBot;
    fill(cx - wick, cx + wick, y0, y1, colour); // wick
    fill(cx - body / 2, cx + body / 2, b0, b1, colour); // body
  });

  // A single accent tick along the bottom, echoing the app's mark.
  const by = pad + inner * 0.88;
  const bh = Math.max(1, inner * 0.03);
  fill(pad + inner * 0.24, pad + inner * 0.76, by, by + bh, ACCENT);

  return px;
}

/**
 * Box-average a supersampled RGBA buffer down to `size` x `size`.
 *
 * Channels are averaged premultiplied by alpha and then un-premultiplied, so
 * edge pixels blend to the mark's colour instead of fading through black.
 */
function downscale(px, N, size, ss) {
  const out = Buffer.alloc(size * size * 4);
  const n = ss * ss;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < ss; dy += 1) {
        for (let dx = 0; dx < ss; dx += 1) {
          const i = ((y * ss + dy) * N + (x * ss + dx)) * 4;
          const alpha = px[i + 3] / 255;
          a += alpha;
          r += px[i] * alpha;
          g += px[i + 1] * alpha;
          b += px[i + 2] * alpha;
        }
      }
      const o = (y * size + x) * 4;
      if (a === 0) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
      } else {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return out;
}

function drawIcon(size, opts, ss = 4) {
  return downscale(renderAt(size * ss, opts), size * ss, size, ss);
}

/* ---------------- output ---------------- */

const targets = [
  // "any" icons: rounded plate with transparent corners.
  { file: 'pwa-192.png', size: 192, opts: {} },
  { file: 'pwa-512.png', size: 512, opts: {} },
  // Maskable + iOS: full bleed, because the platform applies its own mask and
  // would otherwise clip our rounded corners twice.
  { file: 'pwa-maskable-512.png', size: 512, opts: { bleed: true, padding: 0.18 } },
  { file: 'apple-touch-icon.png', size: 180, opts: { bleed: true, padding: 0.16 } },
];

for (const t of targets) {
  const rgba = drawIcon(t.size, t.opts);
  const png = encodePng(t.size, t.size, rgba);
  writeFileSync(resolve(publicDir, t.file), png);
  console.log(`${t.file.padEnd(24)} ${t.size}x${t.size}  ${png.length} bytes`);
}
