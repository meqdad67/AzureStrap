// Helpers shared by every window.
window.lang = 'en';
window.t = k => (I18N[window.lang] && I18N[window.lang][k]) || I18N.en[k] || k;

window.setLang = l => {
  window.lang = l === 'ar' ? 'ar' : 'en';
  document.documentElement.lang = window.lang;
  document.documentElement.dir = window.lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
};

window.$ = id => document.getElementById(id);

window.setWave = (p, root = document) => {
  const wave = root.querySelector('.wave');
  const fill = root.querySelector('.wave .fill');
  if (!wave || !fill) return;
  if (p < 0) { wave.classList.add('indeterminate'); return; }
  wave.classList.remove('indeterminate');
  fill.style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, p)));
};

window.waveHTML = () => `
  <div class="wave" aria-hidden="true">
    <svg viewBox="0 0 400 24" preserveAspectRatio="none">
      <path class="track" d="M0 12 C 25 0, 50 24, 100 12 S 175 0, 200 12 S 275 24, 300 12 S 375 0, 400 12" pathLength="100"/>
      <path class="fill"  d="M0 12 C 25 0, 50 24, 100 12 S 175 0, 200 12 S 275 24, 300 12 S 375 0, 400 12" pathLength="100"/>
    </svg>
  </div>`;
