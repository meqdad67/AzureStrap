const { contextBridge, ipcRenderer } = require('electron');

const on = (ch, cb) => ipcRenderer.on(ch, (_e, payload) => cb(payload));
const call = ch => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('azure', {
  state: call('state'),
  save: call('save'),
  play: call('play'),
  open: call('open'),
  openMods: call('openMods'),
  listMods: call('listMods'),
  packsList: call('packsList'),
  packsImport: call('packsImport'),
  packsRemove: call('packsRemove'),
  openData: call('openData'),
  restart: call('restart'),
  shortcuts: call('shortcuts'),
  pickIcon: call('pickIcon'),
  closeSelf: call('closeSelf'),
  minimizeSelf: call('minimizeSelf'),
  wizardInstall: call('wizardInstall'),
  finishSetup: call('finishSetup'),
  openMenuAfterSetup: call('openMenuAfterSetup'),
  onProgress: cb => on('progress', cb),
  onStatus: cb => on('status', cb),
  onVersion: cb => on('version', cb),
  onError: cb => on('error', cb),
  onSettings: cb => on('settings', cb)
});
