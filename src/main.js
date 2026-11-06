const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const bs = require('./bootstrapper');
const store = require('./store');
const icons = require('./icons');
const { extractZip } = require('./unzip');
const updater = require('./updater');

// The AppImage cannot use Chromium's sandbox on many Linux systems (it needs setuid or user
// namespaces) and would not start at all. The app only shows its own local pages.
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

let settings = null;
let busy = false;
let keepAlive = false;
let pendingUri = null;
const wins = {};

// A small text log next to the settings (Settings > Open data folder) to help find problems.
const logFile = () => path.join(app.getPath('userData'), 'azure-strap.log');
function log(msg) {
  try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`); } catch { /* best effort */ }
}

bs.setLogger(log);

const rootDir = () => path.join(app.getPath('userData'), 'Roblox');
const modsDir = () => path.join(app.getPath('userData'), 'Mods');
const packsDir = () => path.join(app.getPath('userData'), 'Packs');
const findUri = argv => argv.find(a => /^roblox(-player)?:/i.test(a)) || null;

/* ---------- single instance + protocol ---------- */

if (!app.requestSingleInstanceLock()) {
  app.exit(0); // another copy is already running and gets our link; do not open any window here
} else {
  app.on('second-instance', (_e, argv) => {
    const uri = findUri(argv);
    if (uri) play(uri);
    else if (argv.includes('--launch')) play(null);
    else openMenu();
  });
}

app.on('open-url', (e, url) => {
  e.preventDefault();
  if (app.isReady()) play(url); else pendingUri = url;
});

function registerLinks() {
  if (bs.isLinux) return; // Sober registers roblox:// itself
  for (const scheme of ['roblox-player', 'roblox']) {
    if (settings.handleLinks) app.setAsDefaultProtocolClient(scheme);
    else app.removeAsDefaultProtocolClient(scheme);
  }
}

/* ---------- windows ---------- */

function makeWin(name, file, opts = {}) {
  if (wins[name] && !wins[name].isDestroyed()) {
    wins[name].show(); wins[name].focus();
    return wins[name];
  }
  const dark = nativeTheme.shouldUseDarkColors;
  const w = new BrowserWindow({
    autoHideMenuBar: true,
    show: false,
    backgroundColor: opts.frame === false ? '#08163a' : dark ? '#1c1c1c' : '#f3f3f3',
    icon: icons.image(settings.robloxIcon === 'azure' ? 'azure' : settings.robloxIcon),
    title: 'Azure Strap',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    ...opts
  });
  w.loadFile(path.join(__dirname, 'renderer', file));
  w.once('ready-to-show', () => w.show());
  w.on('closed', () => { delete wins[name]; });
  wins[name] = w;
  return w;
}

const openMenu = () => makeWin('menu', 'menu.html', { width: 640, height: 340, resizable: false, maximizable: false, title: 'Azure Strap' });
const openSettings = () => makeWin('settings', 'settings.html', { width: 980, height: 780, minWidth: 820, minHeight: 560, title: 'Azure Strap Settings' });
const openWizard = () => makeWin('wizard', 'wizard.html', { width: 880, height: 580, resizable: false, maximizable: false, frame: false, title: 'Azure Strap Setup' });
const openProgress = () => makeWin('progress', 'progress.html', { width: 460, height: 250, resizable: false, maximizable: false, frame: false, alwaysOnTop: true });

function broadcast(ch, payload) {
  for (const w of Object.values(wins)) if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
}

// Downloads report progress for every network chunk (hundreds per second). Send at most about
// 7 updates per second, but always send a change of stage and the start and end values.
function makeProgress() {
  let lastSent = 0, lastKey = null;
  return (p, key) => {
    const now = Date.now();
    const important = key !== lastKey || p < 0 || p >= 100;
    if (!important && now - lastSent < 150) return;
    lastSent = now; lastKey = key;
    broadcast('progress', { p, key });
  };
}

/* ---------- play flow ---------- */

async function ensureRuntime(onProgress) {
  if (bs.isLinux) {
    if (!(await bs.soberInstalled())) {
      onProgress(-1, 'installingSober');
      await bs.installSober();
    }
    return null;
  }
  return bs.ensureInstalled(rootDir(), onProgress);
}

async function play(uri) {
  if (busy) return;

  // The person pressed "Later" on an update more than a day ago: it is required now.
  if (settings.updatePostponedAt && Date.now() - settings.updatePostponedAt >= 864e5) {
    const u = await updater.check({ manual: false });
    if (u.status === 'updating') return;
  }

  if (bs.isWin && !settings.multiInstance && settings.confirmLaunch && (await bs.isRunning())) {
    const r = await dialog.showMessageBox({
      type: 'question', buttons: ['Launch anyway', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Azure Strap',
      message: 'Roblox is already running.', detail: 'Launching again can close your current game.'
    });
    if (r.response !== 0) return;
  }

  busy = true; keepAlive = true;
  openProgress();
  const progress = makeProgress();
  try {
    broadcast('status', 'checking');
    const rt = await ensureRuntime(progress);
    if (rt) {
      broadcast('version', { version: rt.version, offline: !!rt.offline });
      await Promise.all([
        bs.applySettings(rt.dir, settings, modsDir(), packsDir()),
        bs.ensureWebView2(rootDir(), path.basename(rt.dir), progress)
          .catch(e => log('WebView2 step skipped: ' + (e && e.message ? e.message : e)))
      ]);
      if (settings.multiInstance) bs.holdMultiInstanceMutex();
      broadcast('status', 'launching');
      log(`launching Roblox ${rt.version} from ${rt.dir}`);
      await bs.launchChecked(rt.dir, uri);
      log('Roblox is running');
    } else {
      await bs.applySoberSettings(settings);
      broadcast('status', 'launching');
      bs.launchSober(uri);
    }
    progress(100, 'launching');

    await new Promise(r => setTimeout(r, 250));
    if (wins.progress && !wins.progress.isDestroyed()) wins.progress.close();

    // Small jobs that run right after Roblox starts.
    const jobs = [];
    if (bs.isWin) {
      if (settings.closeCrashHandler) jobs.push(bs.closeCrashHandler());
      if (settings.priority !== 'normal') jobs.push(bs.tunePriority(settings.priority));
    }
    if (settings.backgroundUpdates && !bs.isLinux && !settings.closeOnLaunch) {
      jobs.push(bs.ensureInstalled(rootDir(), () => {}, { prune: false }).catch(() => {}));
    }
    // Only wait when there is something to do after launch, and never longer than 15 seconds,
    // so the launcher closes right away in the normal case.
    if (jobs.length) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 15000))]);

    busy = false; keepAlive = false;
    if (settings.closeOnLaunch) app.quit();
  } catch (e) {
    busy = false; keepAlive = false;
    log('play failed: ' + (e && e.message ? e.message : e));
    broadcast('error', String(e && e.message ? e.message : e));
    broadcast('status', 'idle');
  }
}

async function maybeClean() {
  if (settings.cleanerSchedule === 'never') return;
  if (Date.now() - (settings.lastClean || 0) < 864e5) return;
  try {
    if (await bs.runCleaner(settings, rootDir())) settings = store.save({ ...settings, lastClean: Date.now() });
  } catch { /* cleaning is best-effort */ }
}

/* ---------- IPC ---------- */

ipcMain.handle('state', async () => ({
  settings,
  platform: process.platform,
  appVersion: app.getVersion(),
  icons: icons.list(),
  soberInstalled: bs.isLinux ? await bs.soberInstalled() : null
}));

ipcMain.handle('save', (_e, s) => {
  settings = store.save({ ...settings, ...s });
  nativeTheme.themeSource = settings.theme;
  registerLinks();
  broadcast('settings', settings);
  return settings;
});

ipcMain.handle('play', () => { play(null); });

ipcMain.handle('open', (_e, name) => {
  if (name === 'settings') openSettings();
  else if (name === 'menu') openMenu();
});

ipcMain.handle('openMods', async () => {
  fs.mkdirSync(modsDir(), { recursive: true });
  await shell.openPath(modsDir());
});

ipcMain.handle('listMods', () => {
  const out = [];
  const walk = (dir, base) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = path.posix.join(base, e.name);
      if (e.isDirectory()) walk(path.join(dir, e.name), rel); else out.push(rel);
    }
  };
  walk(modsDir(), '');
  return out.slice(0, 200);
});

ipcMain.handle('openData', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('restart', () => { app.relaunch(); app.exit(0); });
ipcMain.handle('pickIcon', async e => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(parent, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'ico'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  try { return { ok: icons.setCustom(r.filePaths[0]), icons: icons.list() }; }
  catch { return { ok: false }; }
});
ipcMain.handle('shortcuts', (_e, where) => icons.shortcuts(settings.robloxIcon, where));

ipcMain.handle('checkUpdate', () => updater.check({ manual: true }));

ipcMain.handle('closeSelf', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });
ipcMain.handle('minimizeSelf', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); });

// Setup wizard: install Roblox with live progress.
ipcMain.handle('wizardInstall', async () => {
  try {
    await ensureRuntime(makeProgress());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('finishSetup', (_e, s) => {
  settings = store.save({ ...settings, ...s, setupDone: true });
  nativeTheme.themeSource = settings.theme;
  registerLinks();
  const sc = icons.shortcuts(settings.robloxIcon, 'both');
  return { settings, shortcuts: sc };
});

ipcMain.handle('openMenuAfterSetup', () => {
  if (wins.wizard) wins.wizard.close();
  openMenu();
});


/* ---------- visual packs (zip or folder of Roblox-layout files) ---------- */

const ROOTS = new Set(['content', 'platformcontent', 'extracontent', 'shaders', 'ssl']);

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

ipcMain.handle('packsList', () => {
  fs.mkdirSync(packsDir(), { recursive: true });
  return fs.readdirSync(packsDir(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => ({
    name: e.name, files: countFiles(path.join(packsDir(), e.name)), enabled: (settings.enabledPacks || []).includes(e.name)
  }));
});

ipcMain.handle('packsImport', async (e, kind) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  // A zip and a folder need separate dialogs: on Windows and Linux one dialog cannot pick both.
  const r = await dialog.showOpenDialog(parent, kind === 'folder'
    ? { properties: ['openDirectory'] }
    : { properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  try {
    const src = r.filePaths[0];
    const isDir = fs.statSync(src).isDirectory();
    let base = path.basename(src, isDir ? '' : path.extname(src)).replace(/[^\w .-]/g, '_').slice(0, 40) || 'pack';
    let name = base, n = 2;
    while (fs.existsSync(path.join(packsDir(), name))) name = `${base} (${n++})`;
    const dest = path.join(packsDir(), name);
    fs.mkdirSync(dest, { recursive: true });
    if (isDir) await fs.promises.cp(src, dest, { recursive: true });
    else await extractZip(src, dest);

    // If the zip wraps everything in one folder, lift its contents up one level.
    const top = fs.readdirSync(dest, { withFileTypes: true });
    if (top.length === 1 && top[0].isDirectory() && !ROOTS.has(top[0].name.toLowerCase())) {
      const inner = path.join(dest, top[0].name);
      for (const x of fs.readdirSync(inner)) fs.renameSync(path.join(inner, x), path.join(dest, x));
      fs.rmdirSync(inner);
    }
    if (!countFiles(dest)) { fs.rmSync(dest, { recursive: true, force: true }); return { ok: false, error: 'empty' }; }
    return { ok: true, name };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('packsRemove', (_e, name) => {
  const target = path.join(packsDir(), path.basename(String(name)));
  if (!target.startsWith(packsDir() + path.sep)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  settings = store.save({ ...settings, enabledPacks: (settings.enabledPacks || []).filter(x => x !== name) });
  broadcast('settings', settings);
  return true;
});

/* ---------- boot ---------- */

app.whenReady().then(() => {
  settings = store.load();
  nativeTheme.themeSource = settings.theme;
  Menu.setApplicationMenu(null);
  registerLinks();
  updater.init({
    getSettings: () => settings,
    saveSettings: patch => { settings = store.save({ ...settings, ...patch }); },
    broadcast,
    log
  });

  const uri = pendingUri || findUri(process.argv);
  const launchFlag = process.argv.includes('--launch');
  if (uri || launchFlag) play(uri);
  else if (!settings.setupDone) openWizard();
  else { openMenu(); setTimeout(() => updater.check({ manual: false }), 2500); }

  maybeClean();
});

app.on('window-all-closed', () => { if (!keepAlive && !busy) app.quit(); });
