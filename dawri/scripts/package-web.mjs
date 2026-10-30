// Builds dawri-web.zip with the contents of web/ at the zip root (drag-and-drop to Netlify).
// No dependencies: a minimal ZIP writer (deflate via zlib, CRC-32 computed here).
// Run: node scripts/package-web.mjs
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../web/", import.meta.url));
const out = fileURLToPath(new URL("../dawri-web.zip", import.meta.url));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (!e.name.startsWith(".")) out.push(p);
  }
  return out.sort();
}

const files = await walk(root);
const local = [], central = [];
let offset = 0;
const dosTime = (d) => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() });
for (const f of files) {
  const name = Buffer.from(relative(root, f).split("\\").join("/"));
  const data = await readFile(f);
  const comp = deflateRawSync(data, { level: 9 });
  const { time, date } = dosTime((await stat(f)).mtime);
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
  head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
  local.push(head, name, comp);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
  cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
  central.push(cen, name);
  offset += head.length + name.length + comp.length;
}
const cenSize = central.reduce((a, b) => a + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);
await writeFile(out, Buffer.concat([...local, ...central, end]));
console.log(`dawri-web.zip: ${files.length} files, ${(offset + cenSize + 22) / 1024 | 0} KB`);
