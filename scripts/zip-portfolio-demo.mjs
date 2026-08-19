import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dist = path.join(root, "client", "dist");
const outFile = path.join(root, "portfolio-demo.zip");

function walk(dir, base = "") {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) entries.push(...walk(abs, rel));
    else entries.push({ abs, rel });
  }
  return entries;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (~c) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

if (!fs.existsSync(dist)) {
  console.error("client/dist missing. Run npm run build:portfolio first.");
  process.exit(1);
}

const files = walk(dist);
const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of files) {
  const data = fs.readFileSync(file.abs);
  const compressed = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(file.rel, "utf8");
  const crc = crc32(data);
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(8),
    u16(0),
    u16(0),
    u32(crc),
    u32(compressed.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0),
    nameBuf,
    compressed,
  ]);
  const central = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(8),
    u16(0),
    u16(0),
    u32(crc),
    u32(compressed.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    nameBuf,
  ]);
  localParts.push(local);
  centralParts.push(central);
  offset += local.length;
}

const centralBuf = Buffer.concat(centralParts);
const eocd = Buffer.concat([
  u32(0x06054b50),
  u16(0),
  u16(0),
  u16(files.length),
  u16(files.length),
  u32(centralBuf.length),
  u32(offset),
  u16(0),
]);

fs.writeFileSync(outFile, Buffer.concat([...localParts, centralBuf, eocd]));
console.log(`Wrote ${path.relative(root, outFile)} (${files.length} files, forward-slash paths)`);
