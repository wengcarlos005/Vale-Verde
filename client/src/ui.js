// Telas de login e lobby (DOM). O jogo em si é iniciado por main.js via startGame(farm).
import { t, applyDom } from './i18n.js';
import { api, session } from './api.js';

const $ = (id) => document.getElementById(id);

export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

export function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, ms);
}

function errMsg(e) { return t(`err.${e.code || 'network'}`); }

export function initUI({ onPlay }) {
  let mode = 'login';

  const setMode = (m) => {
    mode = m;
    $('tab-login').classList.toggle('active', m === 'login');
    $('tab-register').classList.toggle('active', m === 'register');
    $('field-name').style.display = m === 'register' ? 'block' : 'none';
    $('auth-submit').dataset.i18n = m === 'login' ? 'auth.login' : 'auth.register';
    $('auth-password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    applyDom();
  };
  $('tab-login').addEventListener('click', (e) => { e.preventDefault(); setMode('login'); });
  $('tab-register').addEventListener('click', (e) => { e.preventDefault(); setMode('register'); });

  $('form-auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('auth-msg');
    msg.className = 'msg'; msg.textContent = t('auth.working');
    try {
      const body = { email: $('auth-email').value.trim(), password: $('auth-password').value };
      if (mode === 'register') body.name = $('auth-name').value.trim();
      const data = await api(`/api/auth/${mode}`, body);
      session.token = data.token;
      session.user = data.user;
      msg.textContent = '';
      enterLobby();
    } catch (err) {
      msg.className = 'msg error';
      msg.textContent = errMsg(err);
    }
  });

  $('btn-logout').addEventListener('click', () => {
    session.token = null; session.user = null;
    showScreen('auth');
  });

  const toggleRow = (id) => {
    for (const r of ['row-new-farm', 'row-join-farm']) $(r).style.display = r === id && $(r).style.display === 'none' ? 'block' : 'none';
    if ($(id).style.display === 'block') $(id).querySelector('input').focus();
  };
  $('btn-new-farm').addEventListener('click', () => toggleRow('row-new-farm'));
  $('btn-join-farm').addEventListener('click', () => toggleRow('row-join-farm'));

  $('confirm-new-farm').addEventListener('click', async () => {
    const name = $('new-farm-name').value.trim();
    if (!name) return;
    try {
      await api('/api/farms', { name });
      $('new-farm-name').value = '';
      $('row-new-farm').style.display = 'none';
      loadFarms();
    } catch (err) { $('farms-msg').className = 'msg error'; $('farms-msg').textContent = errMsg(err); }
  });

  $('confirm-join-farm').addEventListener('click', async () => {
    const code = $('join-farm-code').value.trim();
    if (!code) return;
    try {
      const data = await api('/api/farms/join', { code });
      onPlay(data.farm);
    } catch (err) { $('farms-msg').className = 'msg error'; $('farms-msg').textContent = errMsg(err); }
  });

  async function loadFarms() {
    $('farms-msg').textContent = '';
    $('farms-welcome').textContent = t('farms.welcome', { name: session.user?.name || '' });
    const list = $('farm-list');
    list.innerHTML = '';
    try {
      const { farms } = await api('/api/farms');
      if (!farms.length) {
        list.innerHTML = `<div style="font-size:13px;padding:6px 0">${t('farms.empty')}</div>`;
        return;
      }
      for (const f of farms) {
        const div = document.createElement('div');
        div.className = 'farm-item';
        div.innerHTML = `<div class="info"><b>${escapeHtml(f.name)}</b><br>
          <code>${f.code}</code> · ${f.members}/6 ${t('farms.members')}</div>`;
        const btn = document.createElement('button');
        btn.className = 'green';
        btn.textContent = t('farms.play');
        btn.addEventListener('click', () => onPlay(f));
        div.appendChild(btn);
        list.appendChild(div);
      }
    } catch (err) {
      if (err.code === 'unauthorized') { session.token = null; showScreen('auth'); return; }
      $('farms-msg').className = 'msg error';
      $('farms-msg').textContent = errMsg(err);
    }
  }

  function enterLobby() {
    showScreen('farms');
    loadFarms();
  }

  // seletor de aparência (persistido; enviado ao entrar no jogo)
  const HAIR_COLORS = ['black', 'blonde', 'brown', 'ginger', 'grey'];
  const OUTFIT_COLORS = ['black', 'blue', 'green', 'orange', 'pink', 'purple', 'red', 'white_and_brown'];
  const fill = (id, options, labels) => {
    const sel = $(id);
    sel.innerHTML = options.map((o, i) => `<option value="${o}">${labels ? labels[i] : o}</option>`).join('');
    return sel;
  };
  fill('app-hair', [1, 2, 3, 4, 5, 6], ['1', '2', '3', '4', '5', '6']);
  fill('app-hair-color', HAIR_COLORS);
  fill('app-shirt', OUTFIT_COLORS);
  fill('app-pants', OUTFIT_COLORS);
  let app = { hair: 1, hairColor: 'brown', shirt: 'blue', pants: 'black' };
  try { app = { ...app, ...JSON.parse(localStorage.getItem('gv_appearance') || '{}') }; } catch {}
  $('app-hair').value = String(app.hair);
  $('app-hair-color').value = app.hairColor;
  $('app-shirt').value = app.shirt;
  $('app-pants').value = app.pants;
  // preview do personagem (camadas: base, calça, camisa, cabelo — frame 0)
  const imgCache = {};
  const loadImg = (src) => imgCache[src] || (imgCache[src] = new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  }));
  async function drawPreview() {
    const ctx = $('app-preview').getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 48, 48);
    const layers = [
      '/assets/player/base.png',
      `/assets/player/pants_${$('app-pants').value}.png`,
      `/assets/player/shirt_${$('app-shirt').value}.png`,
      `/assets/player/hair_${$('app-hair').value}_${$('app-hair-color').value}.png`,
    ];
    for (const src of layers) {
      const im = await loadImg(src);
      if (im) ctx.drawImage(im, 8, 10, 48, 48, 0, 0, 48, 48);
    }
  }
  const saveApp = () => {
    localStorage.setItem('gv_appearance', JSON.stringify({
      hair: Number($('app-hair').value), hairColor: $('app-hair-color').value,
      shirt: $('app-shirt').value, pants: $('app-pants').value,
    }));
    drawPreview();
  };
  for (const id of ['app-hair', 'app-hair-color', 'app-shirt', 'app-pants']) $(id).addEventListener('change', saveApp);
  drawPreview();

  document.addEventListener('langchange', () => {
    if ($('screen-farms').classList.contains('active')) loadFarms();
  });

  // sessão existente → direto ao lobby
  if (session.token) enterLobby(); else showScreen('auth');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
