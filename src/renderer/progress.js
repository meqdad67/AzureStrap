(async function () {
  const st = await window.azure.state();
  setLang(st.settings.lang);
  const icon = st.icons.find(i => i.id === st.settings.robloxIcon) || st.icons[0];
  $('logo').src = icon.url;
  $('wave').innerHTML = waveHTML();
  $('cancel').textContent = t('cancel');
  $('status').textContent = t('checking');
  $('cancel').addEventListener('click', () => window.azure.closeSelf());

  window.azure.onStatus(k => { $('status').textContent = t(k); });
  window.azure.onProgress(({ p, key }) => {
    setWave(p);
    if (key) $('status').textContent = t(key);
    $('pct').textContent = p > 0 && p < 100 ? Math.round(p) + '%' : '';
  });
  window.azure.onVersion(({ offline }) => { $('sub').textContent = offline ? t('offline') : ''; });
  window.azure.onError(msg => {
    $('error').textContent = msg; $('error').hidden = false;
    $('cancel').textContent = t('close');
  });
})();
