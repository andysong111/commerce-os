import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FILES = [
  "manifest.json",
  "background.js",
  "content-ops.js",
  "content-shopling.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "README.txt",
] as const;

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function localHeader(input: {
  name: Buffer;
  data: Buffer;
  crc: number;
}) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(input.crc, 14);
  header.writeUInt32LE(input.data.length, 18);
  header.writeUInt32LE(input.data.length, 22);
  header.writeUInt16LE(input.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, input.name, input.data]);
}

function centralHeader(input: {
  name: Buffer;
  data: Buffer;
  crc: number;
  offset: number;
}) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(input.crc, 16);
  header.writeUInt32LE(input.data.length, 20);
  header.writeUInt32LE(input.data.length, 24);
  header.writeUInt16LE(input.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(input.offset, 42);
  return Buffer.concat([header, input.name]);
}

function endRecord(input: {
  entries: number;
  centralSize: number;
  centralOffset: number;
}) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(input.entries, 8);
  record.writeUInt16LE(input.entries, 10);
  record.writeUInt32LE(input.centralSize, 12);
  record.writeUInt32LE(input.centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function createStoredZip(entries: Array<{ name: string; data: Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(`shopling-inventory-lifecycle/${entry.name}`, "utf8");
    const crc = crc32(entry.data);
    const local = localHeader({ name, data: entry.data, crc });
    localParts.push(local);
    centralParts.push(
      centralHeader({ name, data: entry.data, crc, offset }),
    );
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    endRecord({
      entries: entries.length,
      centralSize: central.length,
      centralOffset: offset,
    }),
  ]);
}

export async function GET() {
  try {
    const root = path.join(
      process.cwd(),
      "public",
      "shopling-inventory-lifecycle",
    );
    const entries = await Promise.all(
      FILES.map(async (name) => ({
        name,
        data: await readFile(path.join(root, name)),
      })),
    );
    const zip = createStoredZip(entries);
    return new Response(zip, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition":
          'attachment; filename="commerce-os-shopling-inventory-lifecycle-v0.1.0.zip"',
        "cache-control": "no-store",
        "content-length": String(zip.length),
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_INVENTORY_EXTENSION_ZIP_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "확장프로그램 ZIP을 만들지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
