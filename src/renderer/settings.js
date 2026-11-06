const IC = {
  integrations: '<path d="M12 5v14M5 12h14"/>',
  bootstrapper: '<path d="M6 4l12 8-12 8z"/>',
  mods: '<path d="M4 8h16M4 16h16M9 4v8M15 12v8"/>',
  packs: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  fastflags: '<path d="M6 21V4M6 5h12l-2 4 2 4H6"/>',
  appearance: '<path d="M12 3a9 9 0 1 0 0 18c1.700 0 2-1.200 1.300-2.200-.7-1 0-2.300 1.300-2.300H17a4 4 0 0 0 4-4C21 6.800 17 3 12 3z"/>',
  shortcuts: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.1"/>'
};
const TOP = ['integrations', 'bootstrapper', 'mods', 'packs', 'fastflags', 'appearance', 'shortcuts'];
const BOTTOM = ['settings', 'about'];

let st, draft, page = 'integrations', dirty = false;
const win = () => st.platform === 'win32';

/* ---------- small builders ---------- */
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function markDirty() {
  dirty = true;
  $('msg').textContent = t('unsaved');
}

function head(key) {
  const f = document.createDocumentFragment();
  f.append(el('h1', '', esc(t(key + '_t'))), el('p', 'sub', esc(t(key + '_d'))));
  return f;
}

function rowText(key, extra) {
  const d = t(key + '_d');
  return `<div class="txt"><div class="title">${esc(t(key + '_t'))}</div><div class="desc">${esc(d === key + '_d' ? '' : d)}${extra ? ' ' + esc(extra) : ''}</div></div>`;
}

function toggle(key, { winOnly = false, nested = false } = {}) {
  const off = winOnly && !win();
  const c = el('div', 'card' + (nested ? ' nested' : ''));
  c.innerHTML = `<div class="row">${rowText(key, off ? '(' + t('winOnly') + ')' : '')}<label class="switch"><input type="checkbox" ${draft[key] ? 'checked' : ''} ${off ? 'disabled' : ''} aria-label="${esc(t(key + '_t'))}"><span></span></label></div>`;
  c.querySelector('input').addEventListener('change', e => { draft[key] = e.target.checked; markDirty(); });
  return c;
}

function select(key, options, { winOnly = false, nested = false, numeric = false, onChange } = {}) {
  const off = winOnly && !win();
  const c = el('div', 'card' + (nested ? ' nested' : ''));
  const opts = options.map(([v, label]) => `<option value="${esc(v)}" ${String(draft[key]) === String(v) ? 'selected' : ''}>${esc(label)}</option>`).join('');
  c.innerHTML = `<div class="row">${rowText(key, off ? '(' + t('winOnly') + ')' : '')}<select ${off ? 'disabled' : ''} aria-label="${esc(t(key + '_t'))}">${opts}</select></div>`;
  c.querySelector('select').addEventListener('change', e => {
    draft[key] = numeric ? Number(e.target.value) : e.target.value;
    markDirty();
    if (onChange) onChange();
  });
  return c;
}

function button(label, fn, primary) {
  const b = el('button', 'btn' + (primary ? ' primary' : ''), esc(label));
  b.addEventListener('click', fn);
  return b;
}

/* ---------- pages ---------- */
const PAGES = {
  integrations(root) {
    root.append(head('integrations'));
    if (st.platform !== 'linux') root.append(toggle('handleLinks'));
    root.append(toggle('closeOnLaunch'));
  },

  bootstrapper(root) {
    root.append(head('bootstrapper'));
    root.append(toggle('confirmLaunch', { winOnly: true }));
    root.append(toggle('closeCrashHandler', { winOnly: true }));
    root.append(toggle('uncapFps'));
    root.append(toggle('multiInstance', { winOnly: true }));
    root.append(select('priority', [['normal', t('p_normal')], ['abovenormal', t('p_abovenormal')], ['high', t('p_high')]], { winOnly: true }));
    root.append(toggle('backgroundUpdates'));

    const g = el('div', 'group');
    g.innerHTML = `<div class="row">${rowText('cleaner')}</div>`;
    const inner = el('div', 'inner');
    inner.append(
      select('cleanerSchedule', [['never', t('s_never')], ['1d', t('s_1d')], ['7d', t('s_7d')], ['30d', t('s_30d')]], { nested: true }),
      toggle('cleanCache', { nested: true }),
      toggle('cleanLogs', { nested: true, winOnly: true })
    );
    g.append(inner);
    root.append(g);
  },

  mods(root) {
    root.append(head('mods'));
    root.append(toggle('useMods'));
    const c = el('div', 'card');
    c.innerHTML = `<div class="title">${esc(t('modsFiles'))}</div><p class="desc muted small">${esc(t('modsHelp'))}</p><ul class="file-list"></ul>`;
    const row = el('div', 'btn-row');
    row.append(button(t('openMods'), () => window.azure.openMods()));
    c.append(row);
    root.append(c);
    window.azure.listMods().then(files => {
      c.querySelector('.file-list').innerHTML = files.length ? files.map(f => `<li>${esc(f)}</li>`).join('') : `<li>${esc(t('modsEmpty'))}</li>`;
    });
  },

  packs(root) {
    root.append(head('packs'));
    const top = el('div', 'card');
    top.innerHTML = `<p class="desc muted small" style="margin-top:0">${esc(t('packsHelp'))}</p>`;
    const list = el('div');
    const render = async () => {
      const packs = await window.azure.packsList();
      list.innerHTML = '';
      if (!packs.length) list.append(el('p', 'muted', esc(t('packsEmpty'))));
      packs.forEach(p => {
        const on = (draft.enabledPacks || []).includes(p.name);
        const c = el('div', 'card nested');
        c.innerHTML = `<div class="row"><div class="txt"><div class="title">${esc(p.name)}</div><div class="desc">${p.files} ${esc(t('packFiles'))}</div></div><div class="btn-row" style="margin:0;align-items:center"><button class="btn rm">${esc(t('remove'))}</button><label class="switch"><input type="checkbox" ${on ? 'checked' : ''} aria-label="${esc(p.name)}"><span></span></label></div></div>`;
        c.querySelector('input').addEventListener('change', e => {
          const set = new Set(draft.enabledPacks || []);
          if (e.target.checked) set.add(p.name); else set.delete(p.name);
          draft.enabledPacks = [...set]; markDirty();
        });
        c.querySelector('.rm').addEventListener('click', async () => {
          await window.azure.packsRemove(p.name);
          draft.enabledPacks = (draft.enabledPacks || []).filter(x => x !== p.name);
          render();
        });
        list.append(c);
      });
    };
    const row = el('div', 'btn-row');
    row.append(button(t('packsImport'), async () => {
      const r = await window.azure.packsImport();
      if (r.ok) { draft.enabledPacks = [...new Set([...(draft.enabledPacks || []), r.name])]; markDirty(); render(); }
      else if (!r.canceled) $('msg').textContent = r.error === 'empty' ? t('packsEmptyZip') : t('packsFail');
    }, true));
    top.append(row);
    root.append(top, list);
    render();
  },

  fastflags(root) {
    root.append(head('fastflags'));
    root.append(select('fpsCap', [[0, t('fpsDefault')], [30, '30'], [60, '60'], [75, '75'], [120, '120'], [144, '144'], [165, '165'], [240, '240'], [9999, t('fpsUnlimited')]], { numeric: true }));

    const rend = [['auto', t('auto')]];
    if (st.platform === 'win32') rend.push(['d3d11', 'Direct3D 11'], ['vulkan', 'Vulkan']);
    if (st.platform === 'darwin') rend.push(['metal', 'Metal']);
    if (st.platform === 'linux') rend.push(['vulkan', 'Vulkan']);
    root.append(select('renderer', rend));

    root.append(select('textureQuality', [['auto', t('auto')], ['0', t('q0')], ['1', t('q1')], ['2', t('q2')], ['3', t('q3')]]));

    const help = el('p', 'desc muted small', '');
    const upd = () => { help.textContent = t('presetHelp_' + draft.perfPreset); };
    const preset = select('perfPreset', [['off', t('pr_off')], ['balanced', t('pr_balanced')], ['max', t('pr_max')], ['lowend', t('pr_lowend')]], { onChange: upd });
    preset.append(help); upd();
    root.append(preset);

    const c = el('div', 'card');
    c.innerHTML = `<div class="title">${esc(t('customFlags_t'))}</div>`;
    const ta = el('textarea'); ta.rows = 9; ta.spellcheck = false; ta.dir = 'ltr'; ta.value = draft.customFlags;
    const err = el('p', 'error small', esc(t('flagsBad'))); err.hidden = true;
    const check = () => { try { JSON.parse(ta.value || '{}'); err.hidden = true; return true; } catch { err.hidden = false; return false; } };
    ta.addEventListener('input', () => { draft.customFlags = ta.value; check(); markDirty(); });
    const row = el('div', 'btn-row');
    row.append(
      button(t('format'), () => { try { ta.value = JSON.stringify(JSON.parse(ta.value || '{}'), null, 2); draft.customFlags = ta.value; err.hidden = true; markDirty(); } catch { err.hidden = false; } }),
      button(t('reset'), () => { ta.value = '{}'; draft.customFlags = '{}'; err.hidden = true; markDirty(); })
    );
    c.append(ta, err, row);
    root.append(c);
  },

  appearance(root) {
    root.append(head('appearance'));
    root.append(select('theme', [['system', t('th_system')], ['light', t('th_light')], ['dark', t('th_dark')]]));
    root.append(select('lang', [['en', 'English'], ['ar', 'العربية']], { onChange: () => { setLang(draft.lang); build(); } }));

    const c = el('div', 'card');
    c.innerHTML = `<div class="row">${rowText('icon')}</div>`;
    const grid = el('div', 'icon-grid'); grid.setAttribute('role', 'radiogroup'); grid.setAttribute('aria-label', t('icon_t'));
    st.icons.forEach(i => {
      const b = el('button', 'icon-tile', `<img src="${esc(i.url)}" alt=""><span>${esc(i.label)}</span>`);
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(draft.robloxIcon === i.id));
      b.addEventListener('click', () => {
        draft.robloxIcon = i.id; markDirty();
        grid.querySelectorAll('.icon-tile').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      });
      grid.append(b);
    });
    c.append(grid);
    const pickRow = el('div', 'btn-row');
    pickRow.append(button(t('iconPick'), async () => {
      const r = await window.azure.pickIcon();
      if (r.ok) { st.icons = r.icons; draft.robloxIcon = 'custom'; markDirty(); build(); }
      else if (!r.canceled) $('msg').textContent = t('iconPickFail');
    }));
    c.append(pickRow);
    root.append(c);
  },

  shortcuts(root) {
    root.append(head('shortcuts'));
    [['scDesktop', 'desktop'], ['scStart', 'startmenu']].forEach(([key, where]) => {
      const c = el('div', 'card');
      c.innerHTML = `<div class="row">${rowText(key)}</div>`;
      const b = button(t('create'), async () => {
        await window.azure.save(draft); // shortcuts use the icon you picked
        const r = await window.azure.shortcuts(where);
        $('msg').textContent = r && r.ok ? t('scDone') : t('scFail');
      });
      c.querySelector('.row').append(b);
      root.append(c);
    });
  },

  settings(root) {
    root.append(head('settings'));
    const c = el('div', 'card');
    c.innerHTML = `<div class="row">${rowText('openData')}</div>`;
    c.querySelector('.row').append(button(t('openData'), () => window.azure.openData()));
    root.append(c);
  },

  about(root) {
    const h = el('div', 'about-head', `<img src="../../assets/icon.png" alt=""><div><h1 style="margin:0">Azure Strap</h1><div class="muted">${esc(t('version'))} ${esc(st.appVersion)}</div></div>`);
    root.append(h);
    root.append(el('p', '', esc(t('about_d'))), el('p', 'muted small', esc(t('disclaimer'))));
  }
};

/* ---------- shell ---------- */
function buildNav() {
  const nav = $('nav'); nav.innerHTML = '';
  const item = k => {
    const b = el('button', 'nav-item', `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${IC[k]}</svg><span>${esc(t('nav_' + k))}</span>`);
    if (k === page) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => { page = k; build(); });
    return b;
  };
  TOP.forEach(k => nav.append(item(k)));
  nav.append(el('div', 'nav-spacer'));
  BOTTOM.forEach(k => nav.append(item(k)));
}

function build() {
  buildNav();
  const root = $('page'); root.innerHTML = '';
  PAGES[page](root);
  $('saveLaunch').textContent = t('saveLaunch');
  $('restart').textContent = t('restart');
  $('save').textContent = t('save');
  $('close').textContent = t('close');
}

async function save() {
  await window.azure.save(draft);
  dirty = false;
  $('msg').textContent = t('saved');
}

(async function init() {
  st = await window.azure.state();
  draft = { ...st.settings };
  setLang(draft.lang);
  build();

  $('save').addEventListener('click', save);
  $('saveLaunch').addEventListener('click', async () => { await save(); window.azure.play(); });
  $('restart').addEventListener('click', () => window.azure.restart());
  $('close').addEventListener('click', () => { if (!dirty || confirm(t('unsaved') + '. ' + t('close') + '?')) window.azure.closeSelf(); });
})();
