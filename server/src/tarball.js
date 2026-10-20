// Making and opening .tar.gz files with Node's own code, so the cloud
// copies (offsite.js) don't need the "tar" program installed on the
// server (shared hosting like SiteGround may not let you install it).
// The files are standard .tar.gz: copies made with the old "tar" program
// open here, and these open with any archive tool.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BLOCK = 512;

// One 512-byte header for a file (the standard "ustar" layout)
function header(name, size, mtime) {
  const h = Buffer.alloc(BLOCK);
  const put = (text, at, len) => h.write(text, at, len, "utf8");
  const octal = (n, len) => n.toString(8).padStart(len - 1, "0") + "\0";
  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8); // mode
  put(octal(0, 8), 108, 8); // uid
  put(octal(0, 8), 116, 8); // gid
  put(octal(size, 12), 124, 12);
  put(octal(Math.floor(mtime / 1000), 12), 136, 12);
  put("        ", 148, 8); // checksum, worked out below
  put("0", 156, 1); // a normal file
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  let sum = 0;
  for (const byte of h) sum += byte;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

// Writes a .tar.gz with these files: [{ name, data (Buffer or text) }]
export async function writeTarGz(file, entries) {
  const parts = [];
  const now = Date.now();
  for (const { name, data } of entries) {
    if (Buffer.byteLength(name) > 100)
      throw new Error(`Name too long: ${name}`);
    const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    parts.push(header(name, body.length, now), body);
    const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // the end
  await fs.promises.writeFile(file, zlib.gzipSync(Buffer.concat(parts)));
}

const text = (buf, at, len) => {
  const raw = buf.subarray(at, at + len);
  const end = raw.indexOf(0);
  return (end === -1 ? raw : raw.subarray(0, end)).toString("utf8");
};
const number = (buf, at, len) => parseInt(text(buf, at, len).trim() || "0", 8);

// Opens a .tar.gz into a folder. Only plain files and folders come out,
// and never anywhere outside that folder.
export async function extractTarGz(file, into) {
  const root = path.resolve(into);
  let pending = Buffer.alloc(0);
  let current = null; // { out, left, pad } while reading a file's data
  let longName = null; // a long name from the entry before

  async function handle(block) {
    if (block.every((b) => b === 0)) return; // padding / the end
    let name = text(block, 0, 100);
    const prefix = text(block, 345, 155);
    if (prefix && text(block, 257, 5) === "ustar") name = `${prefix}/${name}`;
    const type = String.fromCharCode(block[156] || 48); // "0" if empty
    const size = number(block, 124, 12);
    const pad = (BLOCK - (size % BLOCK)) % BLOCK;
    if (longName) {
      name = longName;
      longName = null;
    }

    // Long names come as their own entry first (GNU "L" or pax "x")
    if (type === "L" || type === "x" || type === "g") {
      current = { kind: type, chunks: [], left: size, pad };
      return;
    }
    const target = path.resolve(root, name);
    const inside = target === root || target.startsWith(root + path.sep);
    if (type === "5") {
      if (inside) await fs.promises.mkdir(target, { recursive: true });
      return;
    }
    if (type !== "0" && type !== "7") {
      current = { kind: "skip", left: size, pad }; // links etc.: skipped
      return;
    }
    if (!inside) {
      current = { kind: "skip", left: size, pad };
      return;
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    current = {
      kind: "file",
      out: await fs.promises.open(target, "w"),
      left: size,
      pad,
    };
    if (size === 0) await finishEntry();
  }

  async function finishEntry() {
    const done = current;
    if (done.kind === "file") await done.out.close();
    if (done.kind === "L")
      longName = Buffer.concat(done.chunks)
        .toString("utf8")
        .replace(/\0+$/, "");
    if (done.kind === "x") {
      const pax = Buffer.concat(done.chunks).toString("utf8");
      const found = pax.match(/^\d+ path=(.*)$/m);
      if (found) longName = found[1];
    }
    current = done.pad ? { kind: "pad", left: done.pad, pad: 0 } : null;
  }

  async function take(chunk) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    for (;;) {
      if (current) {
        if (!pending.length) return;
        const n = Math.min(current.left, pending.length);
        const piece = pending.subarray(0, n);
        if (current.kind === "file") await current.out.write(piece);
        else if (current.chunks) current.chunks.push(Buffer.from(piece));
        current.left -= n;
        pending = pending.subarray(n);
        if (current.left === 0) {
          if (current.kind === "pad") current = null;
          else await finishEntry();
        }
        continue;
      }
      if (pending.length < BLOCK) return;
      const block = pending.subarray(0, BLOCK);
      pending = pending.subarray(BLOCK);
      await handle(block);
    }
  }

  try {
    await pipeline(
      fs.createReadStream(file),
      zlib.createGunzip(),
      new Writable({
        write(chunk, _encoding, done) {
          take(chunk).then(() => done(), done);
        },
      }),
    );
  } finally {
    if (current?.kind === "file") await current.out.close().catch(() => {});
  }
}
