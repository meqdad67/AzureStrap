(async function () {
  const st = await window.azure.state();
  setLang(st.settings.lang);
  $('ver').textContent = st.appVersion;

  $('launch').addEventListener('click', () => window.azure.play());
  $('settings').addEventListener('click', () => window.azure.open('settings'));
  $('help').addEventListener('click', () => window.azure.openData());
  $('data').addEventListener('click', () => window.azure.openData());
  $('about').addEventListener('click', () => window.azure.open('settings'));

  window.azure.onSettings(s => setLang(s.lang));
  window.azure.onError(msg => { $('error').textContent = msg; $('error').hidden = false; });
})();
