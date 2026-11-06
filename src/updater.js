// Checks GitHub Releases for a newer Azure Strap, asks the person, and installs it.
// "Later" is allowed once: a day after it was pressed the update becomes required.
const { app, dialog, shell, net, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'meqdad67/AzureStrap';
const DAY = 864e5;

const TEXT = {
  en: {
    title: 'Azure Strap update',
    available: v => `Version ${v} is available (you have ${app.getVersion()}).`,
    ask: 'Do you want to update now?',
    required: 'You chose "Later" yesterday, so this update is now required.',
    now: 'Update now', later: 'Later',
    current: v => `You are up to date (version ${v}).`,
    failed: 'Could not check for updates. Check your internet and try again.',
    dlFailed: 'The update could not be downloaded. Try again in a moment.',
    dev: 'This is a development build, so it cannot install updates.',
    opened: 'The download page was opened. Install the new version, then start Azure Strap again.'
  },
  ar: {
    title: 'تحديث Azure Strap',
    available: v => `فيه إصدار جديد ${v} (عندك ${app.getVersion()}).`,
    ask: 'تبي تحدث الحين؟',
    required: 'اخترت "بعدين" أمس، فالتحديث الحين إجباري.',
    now: 'حدّث الحين', later: 'بعدين',
    current: v => `انت على آخر إصدار (${v}).`,
    failed: 'ما قدرنا نشيك على التحديثات. تأكد من الإنترنت وجرب مرة ثانية.',
    dlFailed: 'ما قدرنا ننزل التحديث. جرب بعد شوي.',
    dev: 'هذي نسخة تطوير، ما تقدر تثبت تحديثات.',
    opened: 'انفتحت صفحة التنزيل. ثبّت النسخة الجديدة وبعدها شغّل Azure Strap من جديد.'
  }
};

let ctx = { getSettings: () => ({}), saveSettings: () => {}, broadcast: () => {}, log: () => {} };
let busy = false;

const init = c => { ctx = { ...ctx, ...c }; };
const tx = () => TEXT[ctx.getSettings().lang === 'ar' ? 'ar' : 'en'];

// 1.2.10 > 1.2.9: compare number by number.
function newer(a, b) {
  const x = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const y = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function fetchLatest() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'AzureStrap', Accept: 'application/vnd.github+json' },
      signal: ac.signal
    });
    if (r.status === 404) return null;                 // no release published yet
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    const j = await r.json();
    const version = String(j.tag_name || '').replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error('Unexpected release tag: ' + j.tag_name);
    return { version, page: j.html_url, assets: Array.isArray(j.assets) ? j.assets : [] };
  } finally { clearTimeout(timer); }
}

function pickAsset(assets) {
  const ext = process.platform === 'win32' ? /\.exe$/i : process.platform === 'darwin' ? /\.dmg$/i : null;
  if (!ext) return null;
  const list = assets.filter(a => ext.test(a.name || ''));
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    const arm = list.find(a => /arm64/i.test(a.name));
    if (arm) return arm;
  }
  return list[0] || null;
}

async function download(asset, dest) {
  const res = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'AzureStrap' } });
  if (!res.ok || !res.body) throw new Error('Download failed (' + res.status + ')');
  const total = Number(asset.size) || Number(res.headers.get('content-length')) || 0;
  let got = 0, lastSent = 0;
  const progress = new (require('stream').Transform)({
    transform(chunk, _e, cb) {
      got += chunk.length;
      const now = Date.now();
      if (total && now - lastSent > 150) { lastSent = now; ctx.broadcast('update', { state: 'downloading', p: (got / total) * 100 }); }
      cb(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(res.body), progress, fs.createWriteStream(dest));
  if (total && got < total) throw new Error('Download incomplete');
}

const parentWin = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || undefined;

function box(opts) {
  const w = parentWin();
  const o = { type: 'info', title: tx().title, noLink: true, ...opts };
  return w ? dialog.showMessageBox(w, o) : dialog.showMessageBox(o);
}

// Returns 'updating' when the app is about to close for an install (the caller must stop).
async function install(rel, mandatory) {
  const T = tx();
  if (!app.isPackaged) { await box({ message: T.dev }); return 'later'; }

  const asset = pickAsset(rel.assets);
  if (!asset) {                                         // Linux, or a release without an installer
    await shell.openExternal(rel.page);
    if (mandatory) { await box({ message: T.opened }); app.quit(); return 'updating'; }
    return 'later';
  }

  const dest = path.join(os.tmpdir(), 'azure-strap-update-' + asset.name.replace(/[^\w.-]/g, '_'));
  try {
    ctx.broadcast('update', { state: 'downloading', p: 0 });
    await download(asset, dest);
    ctx.broadcast('update', { state: 'done', p: 100 });
  } catch (e) {
    ctx.log('update download failed: ' + (e && e.message ? e.message : e));
    ctx.broadcast('update', { state: 'idle', p: 0 });
    await box({ type: 'error', message: T.dlFailed });
    return 'error';
  }

  if (process.platform === 'win32') {
    spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();   // the installer restarts the app
    setTimeout(() => app.exit(0), 400);
  } else {
    await shell.openPath(dest);                         // macOS: opens the disk image
    await box({ message: T.opened });
    app.quit();
  }
  return 'updating';
}

// manual = the person pressed the button. Otherwise it only speaks up when there is news.
async function check({ manual = false } = {}) {
  if (busy) return { status: 'busy' };
  busy = true;
  try {
    const T = tx();
    let rel;
    try { rel = await fetchLatest(); }
    catch (e) {
      ctx.log('update check failed: ' + (e && e.message ? e.message : e));
      if (manual) await box({ type: 'warning', message: T.failed });
      return { status: 'error' };
    }

    if (!rel || !newer(rel.version, app.getVersion())) {
      if (ctx.getSettings().updatePostponedAt) ctx.saveSettings({ updatePostponedAt: 0, updateVersion: '' });
      if (manual) await box({ message: T.current(app.getVersion()) });
      return { status: 'current' };
    }

    let s = ctx.getSettings();
    if (s.updateVersion !== rel.version) {              // a newer release than the one we asked about
      ctx.saveSettings({ updateVersion: rel.version, updatePostponedAt: 0 });
      s = ctx.getSettings();
    }
    const mandatory = s.updatePostponedAt > 0 && Date.now() - s.updatePostponedAt >= DAY;

    const r = await box({
      message: T.available(rel.version),
      detail: mandatory ? T.required : T.ask,
      buttons: mandatory ? [T.now] : [T.now, T.later],
      defaultId: 0,
      cancelId: mandatory ? 0 : 1
    });

    if (r.response === 0) return { status: await install(rel, mandatory) };

    if (!s.updatePostponedAt) ctx.saveSettings({ updatePostponedAt: Date.now() });
    return { status: 'later' };
  } finally { busy = false; }
}

module.exports = { init, check };
