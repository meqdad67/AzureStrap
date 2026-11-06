// Downloads, verifies, installs and launches the official Roblox client.
// Everything is async + streamed so the UI never blocks.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { extractZip } = require('./unzip');

const execFileP = promisify(execFile);
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// Several addresses for the same files: if one is slow or blocked, the next one is tried.
const CS_URLS = ['https://clientsettingscdn.roblox.com/v2/client-version/', 'https://clientsettings.roblox.com/v2/client-version/'];
const MIRRORS = [
  'https://setup.rbxcdn.com/',
  'https://setup-ak.rbxcdn.com/',
  'https://setup-cfly.rbxcdn.com/',
  'https://roblox-setup.cachefly.net/',
  'https://s3.amazonaws.com/setup.roblox.com/'
];
const UA = 'AzureStrap/1.0';
const REQUEST_MS = 15000;  // small requests must answer within this time
const STALL_MS = 30000;    // a download that gets no data for this long is retried

// Electron's own network stack follows the system proxy / VPN settings; plain Node fetch does not.
let httpFetch = (url, opts) => fetch(url, opts);
try {
  const { net } = require('electron');
  if (net && typeof net.fetch === 'function') httpFetch = (url, opts) => net.fetch(url, opts);
} catch { /* not running inside Electron */ }

// Where each Windows package is extracted inside the version folder.
const PKG_DIRS = {
  'RobloxApp.zip': '',
  'shaders.zip': 'shaders/',
  'ssl.zip': 'ssl/',
  'WebView2.zip': '',
  'content-avatar.zip': 'content/avatar/',
  'content-configs.zip': 'content/configs/',
  'content-fonts.zip': 'content/fonts/',
  'content-sky.zip': 'content/sky/',
  'content-sounds.zip': 'content/sounds/',
  'content-textures2.zip': 'content/textures/',
  'content-models.zip': 'content/models/',
  'content-textures3.zip': 'PlatformContent/pc/textures/',
  'content-terrain.zip': 'PlatformContent/pc/terrain/',
  'content-platform-fonts.zip': 'PlatformContent/pc/fonts/',
  // Roblox's compressed client-settings dictionary is shipped separately.
  // Without this package Roblox logs a missing Zstd dictionary on startup.
  'content-platform-dictionaries.zip': 'PlatformContent/pc/shared_compression_dictionaries/',
  'extracontent-luapackages.zip': 'ExtraContent/LuaPackages/',
  'extracontent-translations.zip': 'ExtraContent/translations/',
  'extracontent-models.zip': 'ExtraContent/models/',
  'extracontent-textures.zip': 'ExtraContent/textures/',
  'extracontent-places.zip': 'ExtraContent/places/',
  'extracted-content-avatar.zip': 'ExtraContent/avatar/',
  'extracted-content-configs.zip': 'ExtraContent/configs/',
  'extracted-content-fonts.zip': 'ExtraContent/fonts/',
  'extracted-content-models.zip': 'ExtraContent/models/',
  'extracted-content-sky.zip': 'ExtraContent/sky/',
  'extracted-content-sounds.zip': 'ExtraContent/sounds/',
  'extracted-content-terrain.zip': 'ExtraContent/terrain/',
  'extracted-content-textures.zip': 'ExtraContent/textures/'
};

// Mods can replace textures, sounds, fonts... never executables.
const BLOCKED_MOD_EXT = new Set(['.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.msi', '.sh', '.dylib', '.so', '.scr', '.com']);

/* ---------- helpers ---------- */

let logFn = () => {};
const setLogger = fn => { logFn = typeof fn === 'function' ? fn : () => {}; };

async function requestText(url, timeoutMs = REQUEST_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await httpFetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal });
    if (!r.ok) throw new Error(`Request failed (${r.status}): ${url}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

// Try each mirror in turn for a small file (like the package list).
async function textFromMirrors(rel) {
  let last;
  for (const base of MIRRORS) {
    try { return await requestText(base + rel); } catch (e) { last = e; }
  }
  throw last;
}

async function md5(file) {
  const h = crypto.createHash('md5');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

// `rel` is the file path after the host. Every retry uses the next mirror, and a download
// that stops receiving data for STALL_MS is cancelled and retried instead of hanging forever.
async function download(rel, dest, onBytes, expectedMd5) {
  if (fs.existsSync(dest) && (!expectedMd5 || (await md5(dest)) === expectedMd5)) return; // cached
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    let fileBytes = 0;
    const ac = new AbortController();
    let timer;
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), STALL_MS); };
    try {
      kick();
      const res = await httpFetch(MIRRORS[attempt % MIRRORS.length] + rel, { headers: { 'User-Agent': UA }, signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
      const counter = new Transform({
        transform(chunk, _e, cb) { kick(); fileBytes += chunk.length; onBytes(chunk.length); cb(null, chunk); }
      });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(dest + '.tmp'), { signal: ac.signal });
      clearTimeout(timer);
      await fsp.rename(dest + '.tmp', dest);
      if (expectedMd5 && (await md5(dest)) !== expectedMd5) throw new Error('Checksum mismatch');
      return;
    } catch (e) {
      clearTimeout(timer);
      onBytes(-fileBytes); // take back what this failed try counted
      lastErr = e;
      await fsp.rm(dest + '.tmp', { force: true });
      await fsp.rm(dest, { force: true });
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw new Error(`Could not download ${rel.split('/').pop()}: ${lastErr && lastErr.message ? lastErr.message : lastErr}`);
}

async function pool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await worker(items[i++]);
  });
  await Promise.all(runners);
}

/* ---------- version lookup ---------- */

// Cached for a few minutes so that every launch does not wait on the network again.
const LATEST_TTL = 10 * 60 * 1000;
let latestCache = null;

async function latest({ timeoutMs = REQUEST_MS } = {}) {
  if (latestCache && Date.now() - latestCache.at < LATEST_TTL) return latestCache.info;
  const name = isWin ? 'WindowsPlayer' : 'MacPlayer';
  let last;
  for (const base of CS_URLS) {
    try {
      const j = JSON.parse(await requestText(base + name, timeoutMs));
      if (!j.clientVersionUpload) throw new Error('Unexpected answer from Roblox');
      const info = { guid: j.clientVersionUpload, version: j.version };
      latestCache = { at: Date.now(), info };
      return info;
    } catch (e) { last = e; }
  }
  throw last;
}

/* ---------- install (into a .part folder, renamed only when complete) ---------- */

// For error messages: size and first bytes, so a broken download can be recognised.
async function describeFile(file) {
  try {
    const st = await fsp.stat(file);
    const fh = await fsp.open(file, 'r');
    const b = Buffer.alloc(8);
    await fh.read(b, 0, 8, 0);
    await fh.close();
    return `${st.size} bytes, starts with ${b.toString('hex')}`;
  } catch { return 'file unreadable'; }
}

// The package list is: a version line, then 4 lines per package (name, md5, packed size, size).
// Only .zip packages are installed. The list also names RobloxPlayerInstaller.exe (Roblox's own
// installer), which is not an archive and not needed here, and the optional WebView2 installer.
function parseManifest(text, keepRuntimeInstaller = false) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const pkgs = [];
  for (let i = 1; i + 3 < lines.length; i += 4) {
    const name = lines[i];
    if (!/\.zip$/i.test(name)) continue;
    if (name === 'WebView2RuntimeInstaller.zip' && !keepRuntimeInstaller) continue;
    pkgs.push({ name, md5: lines[i + 1], size: Number(lines[i + 2]) });
  }
  return pkgs;
}

async function installWindows(info, dir, root, progress) {
  const dl = path.join(root, 'Downloads', info.guid);
  await fsp.mkdir(dl, { recursive: true });

  const pkgs = parseManifest(await textFromMirrors(`${info.guid}-rbxPkgManifest.txt`));
  logFn(`install ${info.version}: ${pkgs.length} packages: ${pkgs.map(p => p.name).join(', ')}`);
  const unmapped = pkgs.filter(p => !(p.name in PKG_DIRS)).map(p => p.name);
  if (unmapped.length) logFn('packages extracted to the version folder root (no mapping): ' + unmapped.join(', '));
  const total = pkgs.reduce((a, p) => a + p.size, 0) || 1;
  let got = 0;

  await pool(pkgs, 4, async p => {
    await download(`${info.guid}-${p.name}`, path.join(dl, p.name), n => {
      got += n;
      progress(Math.max(0, Math.min(80, (got / total) * 80)), 'downloading');
    }, p.md5);
  });

  const part = dir + '.part';
  await fsp.rm(part, { recursive: true, force: true });
  await fsp.mkdir(part, { recursive: true });

  let done = 0;
  for (const p of pkgs) {
    const target = path.join(part, PKG_DIRS[p.name] ?? '');
    await fsp.mkdir(target, { recursive: true });
    const zipFile = path.join(dl, p.name);
    try { await extractZip(zipFile, target); }
    catch (e) { throw new Error(`${p.name}: ${e.message} (${await describeFile(zipFile)})`); }
    progress(80 + (++done / pkgs.length) * 20, 'installing');
  }

  await fsp.writeFile(
    path.join(part, 'AppSettings.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<Settings>\n\t<ContentFolder>content</ContentFolder>\n\t<BaseUrl>http://www.roblox.com</BaseUrl>\n</Settings>\n'
  );
  await fsp.rename(part, dir);
  await fsp.rm(dl, { recursive: true, force: true });
}

async function installMac(info, dir, root, progress) {
  const dl = path.join(root, 'Downloads', info.guid);
  await fsp.mkdir(dl, { recursive: true });
  const zip = path.join(dl, 'RobloxPlayer.zip');

  const urls = [];
  if (process.arch === 'arm64') urls.push(`mac/arm64/${info.guid}-RobloxPlayer.zip`);
  urls.push(`mac/${info.guid}-RobloxPlayer.zip`);

  let ok = false, lastErr;
  for (const u of urls) {
    try {
      let got = 0;
      await download(u, zip, n => { got += n; progress(Math.max(0, Math.min(80, got / 2.5e6)), 'downloading'); });
      ok = true; break;
    } catch (e) { lastErr = e; }
  }
  if (!ok) throw lastErr;

  progress(85, 'installing');
  const part = dir + '.part';
  await fsp.rm(part, { recursive: true, force: true });
  await fsp.mkdir(part, { recursive: true });
  await execFileP('/usr/bin/ditto', ['-x', '-k', zip, part]); // keeps symlinks + permissions
  await fsp.rename(part, dir);
  await fsp.rm(dl, { recursive: true, force: true });
  progress(100, 'installing');
}

async function validateWindowsInstall(dir) {
  // Only check what must exist for Roblox to start: the game exe, and a content folder that
  // is not empty. Other files differ between Roblox versions, so they are not required
  // (requiring a wrong path here made every fresh install look "incomplete").
  const missing = [];
  try {
    const st = await fsp.stat(path.join(dir, 'RobloxPlayerBeta.exe'));
    if (!st.isFile() || st.size < 1024 * 1024) missing.push('RobloxPlayerBeta.exe');
  } catch { missing.push('RobloxPlayerBeta.exe'); }
  try {
    const items = await fsp.readdir(path.join(dir, 'content'));
    if (!items.length) missing.push('content');
  } catch { missing.push('content'); }
  return { ok: missing.length === 0, missing };
}

async function ensureInstalled(root, progress, opts = {}) {
  const versions = path.join(root, 'Versions');
  await fsp.mkdir(versions, { recursive: true });
  const have = (await fsp.readdir(versions)).filter(d => fs.existsSync(path.join(versions, d, '.azure-ok')));
  // Newest first, by the time each version was marked complete.
  const stamp = d => { try { return fs.statSync(path.join(versions, d, '.azure-ok')).mtimeMs; } catch { return 0; } };
  have.sort((a, b) => stamp(b) - stamp(a));
  let info;
  try {
    // With a copy already installed, give the version check only a few seconds, so a slow
    // network never holds up the launch. If it fails, the installed copy is used.
    info = await latest({ timeoutMs: have.length ? 2500 : REQUEST_MS });
  } catch (e) {
    // Offline? Fall back to the newest installed version so the game still opens.
    if (!have.length) throw e;
    return { dir: path.join(versions, have[0]), version: have[0], offline: true };
  }
  const dir = path.join(versions, info.guid);
  let installed = fs.existsSync(path.join(dir, '.azure-ok'));
  if (installed && isWin) {
    const check = await validateWindowsInstall(dir);
    if (!check.ok) {
      // Older Azure Strap builds could mark an incomplete extraction as complete.
      // Remove the marker and reinstall cleanly instead of launching a broken client.
      await fsp.rm(path.join(dir, '.azure-ok'), { force: true });
      installed = false;
    }
  }
  if (!installed) {
    await fsp.rm(dir, { recursive: true, force: true });
    progress(0, 'downloading');
    if (isWin) await installWindows(info, dir, root, progress);
    else await installMac(info, dir, root, progress);
    if (isWin) {
      const check = await validateWindowsInstall(dir);
      if (!check.ok) {
        await fsp.rm(dir, { recursive: true, force: true });
        throw new Error(`Roblox installation is incomplete. Missing required files: ${check.missing.join(', ')}. Please retry the installation.`);
      }
    }
    await fsp.writeFile(path.join(dir, '.azure-ok'), info.version);
    if (opts.prune !== false) {
      for (const d of await fsp.readdir(versions)) {
        if (d !== info.guid) await fsp.rm(path.join(versions, d), { recursive: true, force: true });
      }
    }
  }
  return { dir, version: info.version };
}

/* ---------- settings -> files ---------- */

// Since September 2025 Roblox only reads the flags on its published allowlist from
// ClientAppSettings.json; every other flag is silently ignored. So only allowed flags are
// written here. (The old frame-rate flags, telemetry flags and shadow flags did nothing.)
// The frame-rate limit is now a setting inside Roblox: Settings > Graphics > Maximum Frame Rate.
//
// The mesh "level of detail" distances are the safe way to gain frames without anyone
// noticing: far away meshes switch to a cheaper model earlier, and the full model comes back
// by itself as you get close.
const LOD = (a, b, c, d) => ({
  DFIntCSGLevelOfDetailSwitchingDistance: a,
  DFIntCSGLevelOfDetailSwitchingDistanceL12: b,
  DFIntCSGLevelOfDetailSwitchingDistanceL23: c,
  DFIntCSGLevelOfDetailSwitchingDistanceL34: d
});

const PRESETS = {
  off: {},
  balanced: { FIntDebugForceMSAASamples: 1, ...LOD(250, 500, 750, 1000) },
  max: {
    FIntDebugForceMSAASamples: 1,
    ...LOD(120, 240, 360, 480),
    FIntFRMMaxGrassDistance: 60,
    FIntFRMMinGrassDistance: 0
  },
  lowend: {
    FIntDebugForceMSAASamples: 1,
    ...LOD(60, 120, 180, 240),
    FIntFRMMaxGrassDistance: 0,
    FIntFRMMinGrassDistance: 0,
    DFIntDebugFRMQualityLevelOverride: 1,
    DFFlagTextureQualityOverrideEnabled: true,
    DFIntTextureQualityOverride: 0
  }
};

function buildFlags(s) {
  const f = { ...(PRESETS[s.perfPreset] || {}) };
  if (s.renderer === 'd3d11') f.FFlagDebugGraphicsPreferD3D11 = true;
  if (s.renderer === 'vulkan') f.FFlagDebugGraphicsPreferVulkan = true;
  if (s.textureQuality !== 'auto') {
    f.DFFlagTextureQualityOverrideEnabled = true;
    f.DFIntTextureQualityOverride = Number(s.textureQuality);
  }
  try { Object.assign(f, JSON.parse(s.customFlags || '{}')); } catch { /* UI validates */ }
  return f;
}

// Copies a file only when it is missing or differs from the source (size, or older copy).
async function copyIfChanged(from, to) {
  try {
    const [a, b] = await Promise.all([fsp.stat(from), fsp.stat(to)]);
    if (a.size === b.size && b.mtimeMs >= a.mtimeMs) return;
  } catch { /* target missing: copy it */ }
  await fsp.copyFile(from, to);
}

async function copyMods(src, dest) {
  if (!fs.existsSync(src)) return;
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dest, e.name);
    if (e.isDirectory()) { await fsp.mkdir(to, { recursive: true }); await copyMods(from, to); }
    else if (e.isFile() && !BLOCKED_MOD_EXT.has(path.extname(e.name).toLowerCase())) await copyIfChanged(from, to);
  }
}

const macBinDir = dir => path.join(dir, 'RobloxPlayer.app', 'Contents', 'MacOS');

async function applySettings(dir, s, modsDir, packsDir) {
  const flagDir = path.join(isMac ? macBinDir(dir) : dir, 'ClientSettings');
  await fsp.mkdir(flagDir, { recursive: true });
  await fsp.writeFile(path.join(flagDir, 'ClientAppSettings.json'), JSON.stringify(buildFlags(s), null, 2));
  const dest = isMac ? path.join(dir, 'RobloxPlayer.app', 'Contents', 'Resources') : dir;
  if (s.useMods) await copyMods(modsDir, dest);
  for (const name of s.enabledPacks || []) await copyMods(path.join(packsDir, path.basename(String(name))), dest); // same safe copy: no executables
}

/* ---------- launch ---------- */

function launch(dir, uri) {
  if (isWin) {
    const exe = path.join(dir, 'RobloxPlayerBeta.exe');
    spawn(exe, [uri || '--app'], { detached: true, stdio: 'ignore', cwd: dir }).unref();
  } else if (isMac) {
    const args = ['-a', path.join(dir, 'RobloxPlayer.app')];
    if (uri) args.push(uri);
    spawn('/usr/bin/open', args, { detached: true, stdio: 'ignore' }).unref();
  }
}

/* ---------- Windows extras: priority, crash handler, multi-instance, cleaner ---------- */

const psRun = cmd => execFileP('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function isRunning() {
  if (!isWin) return false;
  try {
    const { stdout } = await execFileP('tasklist', ['/FI', 'IMAGENAME eq RobloxPlayerBeta.exe', '/NH'], { windowsHide: true });
    return /RobloxPlayerBeta\.exe/i.test(stdout);
  } catch { return false; }
}

// Roblox refuses a second window when it can create this mutex first, so we hold it
// until the last Roblox process exits (then the helper ends by itself).
function holdMultiInstanceMutex() {
  if (!isWin) return;
  const script = "$m = New-Object System.Threading.Mutex($true,'ROBLOX_singletonMutex'); " +
    "$end = (Get-Date).AddSeconds(90); " +
    "while ((Get-Date) -lt $end -or (Get-Process RobloxPlayerBeta -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 3 }";
  spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function tunePriority(level) {
  if (!isWin || level === 'normal') return;
  const cls = level === 'high' ? 'High' : 'AboveNormal';
  for (let i = 0; i < 20; i++) {
    try {
      const { stdout } = await psRun(`$p = Get-Process RobloxPlayerBeta -ErrorAction SilentlyContinue; if ($p) { $p | ForEach-Object { $_.PriorityClass = '${cls}' }; 'ok' }`);
      if (stdout.includes('ok')) return;
    } catch { /* retry */ }
    await sleep(2000);
  }
}

async function closeCrashHandler() {
  if (!isWin) return;
  for (let i = 0; i < 15; i++) {
    try { await execFileP('taskkill', ['/F', '/IM', 'RobloxCrashHandler.exe'], { windowsHide: true }); return; }
    catch { await sleep(2500); }
  }
}

async function removeOlderThan(dir, cutoff) {
  let entries;
  try { entries = await fsp.readdir(dir); } catch { return; }
  for (const name of entries) {
    const p = path.join(dir, name);
    try {
      const st = await fsp.stat(p);
      if (st.mtimeMs < cutoff) await fsp.rm(p, { recursive: true, force: true });
    } catch { /* in use, skip */ }
  }
}

async function runCleaner(s, root) {
  const days = { '1d': 1, '7d': 7, '30d': 30 }[s.cleanerSchedule];
  if (!days) return false;
  const cutoff = Date.now() - days * 864e5;
  if (s.cleanCache) await removeOlderThan(path.join(root, 'Downloads'), cutoff);
  if (s.cleanLogs && isWin && process.env.LOCALAPPDATA) await removeOlderThan(path.join(process.env.LOCALAPPDATA, 'Roblox', 'logs'), cutoff);
  return true;
}

/* ---------- Linux: Roblox has no native client, so we drive Sober (Flatpak) ---------- */

const SOBER = 'org.vinegarhq.Sober';

async function soberInstalled() {
  try { await execFileP('flatpak', ['info', SOBER]); return true; } catch { return false; }
}

async function installSober() {
  try {
    await execFileP('flatpak', ['remote-add', '--user', '--if-not-exists', 'flathub', 'https://dl.flathub.org/repo/flathub.flatpakrepo']);
  } catch { /* flatpak missing: the install below reports it */ }
  return new Promise((resolve, reject) => {
    const p = spawn('flatpak', ['install', '-y', '--user', 'flathub', SOBER], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', c => (c === 0 ? resolve() : reject(new Error('flatpak install failed. Is Flatpak installed and Flathub added?'))));
  });
}

async function applySoberSettings(s) {
  const file = path.join(process.env.HOME, '.var/app', SOBER, 'config/sober/config.json');
  let cfg = {};
  try { cfg = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* first run */ }
  cfg.fflags = { ...(cfg.fflags || {}), ...buildFlags(s) };
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(cfg, null, 2));
}

/* ---------- launch with a check that Roblox really started ---------- */

const hexCode = c => '0x' + (Number(c) >>> 0).toString(16).toUpperCase();
const CODE_HINTS = {
  0xC0000135: ' Windows is missing a file Roblox needs. Install "Microsoft Visual C++ Redistributable 2015-2022 (x64)" and try again.',
  0xC000007B: ' Windows is missing a file Roblox needs. Install "Microsoft Visual C++ Redistributable 2015-2022 (x64)" and try again.'
};

// Waits up to tries * stepMs for the game to appear. Throws a readable error if it
// could not start, or if it closed right away (instead of failing silently).
async function watchLaunch(child, isUp, stepMs = 400, tries = 50) {
  let exited = false, exitCode = null, spawnErr = null;
  child.once('error', e => { spawnErr = e; });
  child.once('exit', c => { exited = true; exitCode = c; });
  for (let i = 0; i < tries; i++) {
    await sleep(stepMs);
    if (spawnErr) throw new Error(`Windows would not start Roblox: ${spawnErr.message}`);
    if (await isUp()) return;
    if (exited && Number(exitCode) === 0) return;      // it handed over to another process: fine
    if (exited) {
      const hint = CODE_HINTS[Number(exitCode) >>> 0] || '';
      throw new Error(`Roblox closed right away (exit code ${exitCode === null ? 'none' : hexCode(exitCode)}).${hint}`);
    }
  }
  // Still alive but not listed (slow PC, or the process list could not be read): do not
  // report a failure for a game that is most likely still starting.
}

async function launchChecked(dir, uri) {
  if (!isWin) { launch(dir, uri); return; }
  const exe = path.join(dir, 'RobloxPlayerBeta.exe');
  if (!fs.existsSync(exe)) {
    await fsp.rm(path.join(dir, '.azure-ok'), { force: true }); // so the next try installs it again
    const found = (await fsp.readdir(dir).catch(() => [])).slice(0, 10).join(', ') || 'nothing';
    throw new Error(`RobloxPlayerBeta.exe is missing. Press Try again to install Roblox again. (found: ${found})`);
  }
  const child = spawn(exe, [uri || '--app'], { detached: true, stdio: 'ignore', cwd: dir });
  await watchLaunch(child, isRunning);
  child.unref();
}

/* ---------- Windows: Roblox's app screens need the WebView2 runtime ---------- */

const WV2 = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

async function webview2Installed() {
  const keys = [
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WV2}`,
    `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WV2}`,
    `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${WV2}`
  ];
  for (const k of keys) {
    try {
      const { stdout } = await execFileP('reg', ['query', k, '/v', 'pv'], { windowsHide: true });
      const m = /pv\s+REG_SZ\s+(\S+)/i.exec(stdout);
      if (m && m[1] !== '0.0.0.0') return true;
    } catch { /* key not present */ }
  }
  return false;
}

function findExe(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findExe(p); if (r) return r; }
    else if (/\.exe$/i.test(e.name)) return p;
  }
  return null;
}

// Installs Microsoft's WebView2 runtime (from Roblox's own package list) only when it is missing.
let wv2Ready = false;

async function ensureWebView2(root, guid, progress) {
  if (!isWin || wv2Ready) return;
  if (await webview2Installed()) { wv2Ready = true; return; }
  progress(-1, 'installingWebView2');
  const pkg = parseManifest(await textFromMirrors(`${guid}-rbxPkgManifest.txt`), true).find(p => p.name === 'WebView2RuntimeInstaller.zip');
  if (!pkg) return;
  const dl = path.join(root, 'Downloads', 'webview2');
  await fsp.mkdir(dl, { recursive: true });
  const zip = path.join(dl, pkg.name);
  await download(`${guid}-${pkg.name}`, zip, () => {}, pkg.md5);
  const out = path.join(dl, 'x');
  await fsp.rm(out, { recursive: true, force: true });
  await extractZip(zip, out);
  const exe = findExe(out);
  if (exe) await execFileP(exe, ['/silent', '/install'], { windowsHide: true, timeout: 5 * 60 * 1000 });
  await fsp.rm(dl, { recursive: true, force: true });
  wv2Ready = true;
}

function launchSober(uri) {
  const args = ['run', SOBER];
  if (uri) args.push(uri);
  spawn('flatpak', args, { detached: true, stdio: 'ignore' }).unref();
}

module.exports = {
  isWin, isMac, isLinux,
  setLogger, ensureInstalled, applySettings, launch, launchChecked, watchLaunch, ensureWebView2, parseManifest,
  isRunning, holdMultiInstanceMutex, tunePriority, closeCrashHandler, runCleaner,
  soberInstalled, installSober, applySoberSettings, launchSober
};
