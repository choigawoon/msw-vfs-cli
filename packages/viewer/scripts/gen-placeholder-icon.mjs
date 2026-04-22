// Generates a 1024×1024 solid-color PNG placeholder used as the source for
// `tauri icon`. Replace the generated file with a real icon before shipping.
//
//   node scripts/gen-placeholder-icon.mjs [out.png]
//
// Pure-Node PNG writer — no dependencies.

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SIZE = 1024;
// Primary zinc color from the shadcn palette.
const RGBA = [24, 24, 27, 255];

function crc32(buf) {
  let c;
  const table = (crc32.table ||= (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr.writeUInt8(8, 8);   // bit depth
ihdr.writeUInt8(6, 9);   // color type RGBA
ihdr.writeUInt8(0, 10);
ihdr.writeUInt8(0, 11);
ihdr.writeUInt8(0, 12);

// Raw scanlines: each row starts with filter byte (0 = None) followed by RGBA.
const rowLen = 1 + SIZE * 4;
const raw = Buffer.alloc(rowLen * SIZE);
for (let y = 0; y < SIZE; y++) {
  const off = y * rowLen;
  raw[off] = 0;
  for (let x = 0; x < SIZE; x++) {
    const p = off + 1 + x * 4;
    raw[p] = RGBA[0];
    raw[p + 1] = RGBA[1];
    raw[p + 2] = RGBA[2];
    raw[p + 3] = RGBA[3];
  }
}

const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  signature,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = resolve(process.argv[2] ?? "src-tauri/icons/app-icon.png");
writeFileSync(out, png);
process.stdout.write(`wrote ${png.length} bytes → ${out}\n`);
