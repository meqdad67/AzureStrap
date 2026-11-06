// Small, dependency-free zip extractor (stored + deflate).
// Roblox's package zips contain entries such as "/" and names with backslashes, which the
// stricter extract-zip library rejects ("absolute path: /"). Here such names are cleaned up,
// and anything that would escape the target folder is refused.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');

// Marks problems with the zip format itself (as opposed to unsafe paths), so we may try another tool.
const formatError = msg => Object.assign(new Error(msg), { formatProblem: true });

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  if (bytesRead !== len) throw formatError('Zip file is damaged or incomplete');
  return buf;
}

async function listEntries(fh, size) {
  const tailLen = Math.min(size, 22 + 65535);
  const tail = await readAt(fh, size - tailLen, tailLen);
  let i = tail.length - 22;
  for (; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) break;
  if (i < 0) throw formatError('Not a valid zip file');
  const cdSize = tail.readUInt32LE(i + 12);
  const cdOffset = tail.readUInt32LE(i + 16);
  if (tail.readUInt16LE(i + 10) === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw formatError('Zip64 archives are not supported');
  }
  const cd = await readAt(fh, cdOffset, cdSize);
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const flags = cd.readUInt16LE(p + 8);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const e = {
      flags,
      method: cd.readUInt16LE(p + 10),
      compSize: cd.readUInt32LE(p + 20),
      offset: cd.readUInt32LE(p + 42),
      name: cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen)
    };
    if (e.compSize === 0xffffffff || e.offset === 0xffffffff) throw formatError('Zip64 archives are not supported');
    entries.push(e);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extractOwn(zipPath, destDir) {
  const root = path.resolve(destDir);
  await fsp.mkdir(root, { recursive: true });
  const fh = await fsp.open(zipPath, 'r');
  try {
    const { size } = await fh.stat();
    if (size === 0) return;                              // an empty package: nothing to install
    const entries = await listEntries(fh, size);
    for (const e of entries) {
      const parts = e.name.replace(/\\/g, '/').split('/').filter(s => s && s !== '.');
      if (!parts.length) continue;                       // an entry like "/" : nothing to create
      if (parts.includes('..') || /^[a-zA-Z]:$/.test(parts[0])) throw new Error('Unsafe path in zip: ' + e.name);
      const target = path.join(root, ...parts);
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Unsafe path in zip: ' + e.name);

      if (/[\\/]$/.test(e.name)) { await fsp.mkdir(target, { recursive: true }); continue; }
      if (e.flags & 1) throw formatError('Encrypted zip files are not supported');
      await fsp.mkdir(path.dirname(target), { recursive: true });

      if (e.compSize === 0) { await fsp.writeFile(target, ''); continue; }
      const lh = await readAt(fh, e.offset, 30);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw formatError('Zip file is damaged');
      const start = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const src = fh.createReadStream({ start, end: start + e.compSize - 1, autoClose: false });
      const out = fs.createWriteStream(target);
      if (e.method === 0) await pipeline(src, out);
      else if (e.method === 8) {
        try { await pipeline(src, zlib.createInflateRaw(), out); }
        catch (err) { if (String(err && err.code).startsWith('Z_')) err.formatProblem = true; throw err; }
      } else throw formatError('Unsupported zip compression (' + e.method + ')');
    }
  } finally {
    await fh.close();
  }
}

// Second chance for archives our own reader does not understand: the system's tar
// (built into Windows 10+, macOS and most Linux) reads many archive variants.
function systemExtract(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xf', zipPath, '-C', path.resolve(destDir)], { windowsHide: true, maxBuffer: 1 << 20 }, (err, _out, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().slice(0, 160)));
      else resolve();
    });
  });
}

async function extractZip(zipPath, destDir) {
  try {
    await extractOwn(zipPath, destDir);
  } catch (e) {
    if (!e.formatProblem) throw e;                       // unsafe paths etc. are never retried
    try { await systemExtract(zipPath, destDir); }
    catch (e2) { throw new Error(`${e.message}; system tar also failed: ${e2.message}`); }
  }
}

module.exports = { extractZip };
