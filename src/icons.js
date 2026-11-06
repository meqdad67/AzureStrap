// Roblox icon picker support: icon list, PNG -> ICO, Windows shortcuts.
const { app, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ASSETS = path.join(__dirname, '..', 'assets');
const YEARS = ['2006', '2009', '2012', '2015', '2017', '2019', '2022', '2026'];

const customFile = () => path.join(app.getPath('userData'), 'icons', 'custom.png');

function file(id) {
  if (id === 'custom') {
    if (fs.existsSync(customFile())) return customFile();
  } else if (id !== 'azure') {
    const f = path.join(ASSETS, 'roblox-icons', id + '.png');
    if (fs.existsSync(f)) return f;
  }
  return path.join(ASSETS, 'icon.png');
}

function list() {
  const items = [{ id: 'azure', label: 'Azure Strap' }, ...YEARS.map(y => ({ id: y, label: y }))];
  if (fs.existsSync(customFile())) items.push({ id: 'custom', label: 'Custom' });
  return items.map(i => {
    let url = pathToFileURL(file(i.id)).href;
    if (i.id === 'custom') url += '?v=' + Math.round(fs.statSync(customFile()).mtimeMs);
    return { ...i, url };
  });
}

// The person's own picture: cropped to a centred square and saved as 256x256 PNG.
function setCustom(src) {
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) return false;
  const { width, height } = img.getSize();
  const side = Math.min(width, height);
  const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  fs.mkdirSync(path.dirname(customFile()), { recursive: true });
  fs.writeFileSync(customFile(), square.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  return true;
}

function image(id) { return nativeImage.createFromPath(file(id)); }

// ICO files may embed a PNG, so we just wrap one in the 22-byte ICO header.
function ico(id) {
  const out = path.join(app.getPath('userData'), 'icons', id + '.ico');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const png = image(id).resize({ width: 256, height: 256, quality: 'best' }).toPNG();
  const h = Buffer.alloc(22);
  h.writeUInt16LE(1, 2);          // type: icon
  h.writeUInt16LE(1, 4);          // one image
  h.writeUInt16LE(1, 10);         // planes
  h.writeUInt16LE(32, 12);        // bits per pixel
  h.writeUInt32LE(png.length, 14);
  h.writeUInt32LE(22, 18);        // data offset (width/height 0 = 256)
  fs.writeFileSync(out, Buffer.concat([h, png]));
  return out;
}

// Windows only: one "Azure Strap" shortcut wearing the chosen icon.
function shortcuts(robloxIcon, where) {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported' };
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  const targets = [];
  if (where === 'desktop' || where === 'both') targets.push(app.getPath('desktop'));
  if (where === 'startmenu' || where === 'both') targets.push(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  for (const dir of targets) {
    fs.mkdirSync(dir, { recursive: true });
    // Older versions made a separate "Roblox" shortcut. Remove it, keep only Azure Strap.
    try { fs.rmSync(path.join(dir, 'Roblox.lnk'), { force: true }); } catch { /* ignore */ }
    shell.writeShortcutLink(path.join(dir, 'Azure Strap.lnk'), 'create', {
      target: process.execPath, icon: ico(robloxIcon), iconIndex: 0, description: 'Azure Strap'
    });
  }
  return { ok: true };
}

module.exports = { list, image, file, shortcuts, setCustom };
