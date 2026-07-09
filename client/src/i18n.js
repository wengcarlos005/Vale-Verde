// i18n simples: carrega JSON do idioma e aplica em elementos [data-i18n].
let dict = {};
let lang = localStorage.getItem('gv_lang') || (navigator.language.startsWith('pt') ? 'pt-BR' : 'en');

export function t(key, params = {}) {
  let s = dict[key] || key;
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function currentLang() { return lang; }

export async function setLang(newLang) {
  lang = newLang;
  localStorage.setItem('gv_lang', lang);
  const res = await fetch(`/src/i18n/${lang}.json`);
  dict = await res.json();
  applyDom();
  document.dispatchEvent(new CustomEvent('langchange'));
}

export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

export async function initI18n() {
  const sel = document.getElementById('lang-select');
  sel.value = lang;
  sel.addEventListener('change', () => setLang(sel.value));
  await setLang(lang);
}
