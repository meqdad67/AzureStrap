# Azure Strap

Roblox launcher for Windows, macOS and Linux (Electron). Windows is the main target.

## Run from source
```bash
npm install
npm start
```

## Build the Windows installer (.exe)
```bash
npm run dist
```
Output: `dist/Azure Strap Setup 1.2.0.exe` (installer only, no portable build).
macOS and Linux builds must be made on those systems. Easiest: push to GitHub and run the
`build` workflow in `.github/workflows/build.yml`, which builds all three.

## What it has
- **Setup wizard** (first launch): language, Roblox icon (Azure or 2006-2026 eras), performance preset,
  then it installs Roblox and creates shortcuts.
- **Launcher home** and **Settings window** inspired by the Bloxstrap family, written from scratch:
  Integrations, Bootstrapper, Mods, FastFlag Settings, Appearance, Shortcuts, Settings, About.
- **Bootstrapper options:** instance launch confirmation, close crash handler, uncap FPS, multi-instance,
  process priority, background updates, cleaner (cache and logs, on a schedule).
- **Performance presets:** Balanced, Max FPS, Low-end PC, plus FPS limit, graphics API, texture quality
  and a custom FastFlag JSON editor.
- **Visual Packs:** import a zip or folder (skies, textures), turn it on or off, remove it. Plain files, no GPU needed, no injection. Not real shaders.
- **Safe installs:** files are checksum-verified, installed into a temporary folder and only activated when complete.
- English by default, Arabic optional.

## Changes in 1.2.0
- Launch no longer waits on the network: if Roblox is already installed, the version check gives up after 4 seconds and the installed copy opens. Version checks are cached for 10 minutes.
- Progress updates are throttled (about 7 per second), so downloads no longer flood the windows with messages.
- Visual packs and mods are copied only when they changed, instead of re-copying every file on every launch.
- The WebView2 check runs once per session instead of on every launch.
- Pack names from settings are sanitised, so they can never point outside the Packs folder.

## Roblox icons
The era icons in `assets/roblox-icons/` are placeholder tiles drawn for Azure Strap, not Roblox's logos.
Replace any of them with your own 256x256 PNG of the same name (`2006.png` ... `2026.png`).
Make sure you have the right to use any artwork you add.

## Honest notes
- Not tested against live Roblox servers yet. The UI was smoke-tested; the download, install and launch
  paths were not. Test on a real Windows PC first.
- Roblox only accepts FastFlags on its own allow-list. Some flags in the presets may be ignored by the game,
  and Roblox can change the list at any time.
- Real lag reduction comes mainly from a sensible FPS limit, lower textures, process priority and the
  Max FPS / Low-end presets. Results depend on the PC.
- Multi-instance, priority and crash-handler features are Windows only.
- Linux: Roblox has no native client, so Azure Strap installs and launches Sober (Flatpak).
- Not included: Region Selector and Account Manager (they need your Roblox login cookie, which is a security risk),
  and Discord Rich Presence.
- Azure Strap is not affiliated with Roblox Corporation.
