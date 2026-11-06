const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  setupDone: false,
  lang: 'en',               // English by default, Arabic optional
  theme: 'system',          // system | light | dark
  robloxIcon: 'azure',      // azure | 2006 | 2009 | ... | 2026

  // FastFlag settings
  fpsCap: 60,               // 0 = Roblox default
  uncapFps: false,
  renderer: 'auto',
  textureQuality: 'auto',
  perfPreset: 'off',        // off | balanced | max | lowend
  customFlags: '{}',

  // Bootstrapper
  confirmLaunch: true,
  closeCrashHandler: false,
  multiInstance: false,
  priority: 'normal',       // normal | abovenormal | high
  backgroundUpdates: false,
  cleanerSchedule: 'never', // never | 1d | 7d | 30d
  cleanCache: false,
  cleanLogs: false,
  lastClean: 0,

  // Launcher
  closeOnLaunch: true,
  handleLinks: true,
  useMods: true,
  enabledPacks: []
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}

function save(s) {
  const clean = { ...DEFAULTS, ...s };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2));
  fs.renameSync(tmp, file()); // atomic
  return clean;
}

module.exports = { load, save, DEFAULTS };
