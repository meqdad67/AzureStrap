const STEPS = ['welcome', 'language', 'icon', 'perf', 'install', 'done'];
let st, i = 0;
const pick = { lang: 'en', robloxIcon: 'azure', perfPreset: 'balanced' };
let installError = null, installing = false;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function dots() {
  $('dots').innerHTML = STEPS.map((_, n) => `<li class="${n === i ? 'on' : ''}"></li>`).join('');
}

function navBar({ back = true, next, nextLabel, nextFn, extra } = {}) {
  const bar = mk('div', 'nav');
  if (back && i > 0) {
    const b = mk('button', 'btn ghost', esc(t('w_back'))); b.addEventListener('click', () => go(i - 1)); bar.append(b);
  } else bar.append(mk('span'));
  if (extra) bar.append(extra);
  if (next !== false) {
    const n = mk('button', 'btn big', esc(nextLabel || t('w_next')));
    n.addEventListener('click', nextFn || (() => go(i + 1)));
    bar.append(n);
  }
  return bar;
}

function optionList(items, current, onPick) {
  const wrap = mk('div', 'choice'); wrap.setAttribute('role', 'radiogroup');
  items.forEach(([value, title, desc]) => {
    const b = mk('button', 'opt', `<strong>${esc(title)}</strong>${desc ? `<span>${esc(desc)}</span>` : ''}`);
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(current() === value));
    b.addEventListener('click', () => {
      onPick(value);
      wrap.querySelectorAll('.opt').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    });
    wrap.append(b);
  });
  return wrap;
}

const VIEWS = {
  welcome(root) {
    root.append(mk('h1', '', esc(t('w_welcome_t'))), mk('p', 'soft', esc(t('w_welcome_d'))));
    root.append(mk('div', 'body'));
    const bar = mk('div', 'nav'); bar.append(mk('span'));
    const b = mk('button', 'btn big', esc(t('w_start'))); b.addEventListener('click', () => go(1));
    bar.append(b); root.append(bar);
  },

  language(root) {
    root.append(mk('h1', '', esc(t('w_lang_t'))), mk('p', 'soft', esc(t('w_lang_d'))));
    const body = mk('div', 'body');
    body.append(optionList([['en', 'English', ''], ['ar', 'العربية', '']], () => pick.lang, v => {
      pick.lang = v; setLang(v); render();
    }));
    root.append(body, navBar());
  },

  icon(root) {
    root.append(mk('h1', '', esc(t('w_icon_t'))), mk('p', 'soft', esc(t('w_icon_d'))));
    const body = mk('div', 'body');
    const grid = mk('div', 'icon-grid'); grid.setAttribute('role', 'radiogroup');
    st.icons.forEach(ic => {
      const b = mk('button', 'icon-tile', `<img src="${esc(ic.url)}" alt=""><span>${esc(ic.label)}</span>`);
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(pick.robloxIcon === ic.id));
      b.addEventListener('click', () => {
        pick.robloxIcon = ic.id;
        grid.querySelectorAll('.icon-tile').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      });
      grid.append(b);
    });
    body.append(grid);
    const own = mk('button', 'btn ghost', esc(t('iconPick'))); own.style.marginTop = '12px';
    own.addEventListener('click', async () => {
      const r = await window.azure.pickIcon();
      if (r.ok) { st.icons = r.icons; pick.robloxIcon = 'custom'; render(); }
    });
    body.append(own);
    root.append(body, navBar());
  },

  perf(root) {
    root.append(mk('h1', '', esc(t('w_perf_t'))), mk('p', 'soft', esc(t('w_perf_d'))));
    const body = mk('div', 'body');
    const items = ['off', 'balanced', 'max', 'lowend'].map(k => [k, t('w_perf_' + k), t('w_perf_' + k + '_d')]);
    body.append(optionList(items, () => pick.perfPreset, v => { pick.perfPreset = v; }));
    root.append(body, navBar({ nextLabel: t('w_install'), nextFn: () => go(4) }));
  },

  install(root) {
    root.append(mk('h1', '', esc(installError ? t('w_error_t') : t('w_installing_t'))));
    root.append(mk('p', 'soft', esc(installError || t('w_installing_d'))));
    const body = mk('div', 'body');
    body.innerHTML = `<h2 id="istatus" style="font-size:16px;margin:8px 0">${esc(t('checking'))}</h2>${waveHTML()}<p id="ipct" class="soft"></p>`;
    root.append(body);
    if (installError) {
      const bar = mk('div', 'nav'); bar.append(mk('span'));
      const r = mk('button', 'btn big', esc(t('w_retry'))); r.addEventListener('click', () => { installError = null; render(); });
      bar.append(r); root.append(bar);
    } else {
      startInstall();
    }
  },

  done(root) {
    root.append(mk('h1', '', esc(t('w_done_t'))), mk('p', 'soft', esc(t('w_done_d'))));
    root.append(mk('div', 'body'));
    const bar = mk('div', 'nav');
    const s = mk('button', 'btn ghost', esc(t('w_openSettings')));
    s.addEventListener('click', async () => { await window.azure.openMenuAfterSetup(); window.azure.open('settings'); });
    const l = mk('button', 'btn big', esc(t('w_launch')));
    l.addEventListener('click', async () => { await window.azure.openMenuAfterSetup(); window.azure.play(); });
    bar.append(s, l); root.append(bar);
  }
};

async function startInstall() {
  if (installing) return;
  installing = true;
  // Save choices first so the shortcuts use the icon the person picked.
  await window.azure.finishSetup({ lang: pick.lang, robloxIcon: pick.robloxIcon, perfPreset: pick.perfPreset });
  const r = await window.azure.wizardInstall();
  installing = false;
  if (r.ok) go(5); else { installError = r.error; render(); }
}

function go(n) { i = n; render(); }

function render() {
  const root = $('step'); root.innerHTML = '';
  VIEWS[STEPS[i]](root);
  dots();
  root.focus({ preventScroll: true });
}

(async function init() {
  st = await window.azure.state();
  pick.lang = st.settings.lang || 'en';
  setLang(pick.lang);
  $('x').addEventListener('click', () => window.azure.closeSelf());
  window.azure.onProgress(({ p, key }) => {
    if ($('istatus') && key) $('istatus').textContent = t(key);
    setWave(p);
    if ($('ipct')) $('ipct').textContent = p > 0 && p < 100 ? Math.round(p) + '%' : '';
  });
  render();
})();
