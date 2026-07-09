// Simula um jogador extra para testar o multiplayer.
// Uso: node tools/sim_player.js <email> <nome> <codigo-fazenda> [duracao-ms]
const { io } = require('socket.io-client');

const BASE = 'http://localhost:8140';
const [email, name, code, durationArg] = process.argv.slice(2);
const duration = Number(durationArg || 15000);

async function api(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.error !== 'email_taken') throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  let auth = await api('/api/auth/register', { email, name, password: 'senha123' });
  if (auth.error === 'email_taken') auth = await api('/api/auth/login', { email, password: 'senha123' });
  const farm = (await api('/api/farms/join', { code }, auth.token)).farm;
  console.log('joined farm', farm.code, farm.id);

  const socket = io(BASE, { auth: { token: auth.token, farmId: farm.id } });
  socket.on('connect_error', (e) => { console.error('connect_error', e.message); process.exit(1); });
  socket.on('joined', (d) => {
    console.log('in room, players:', d.players.map(p => p.name).join(', '));
    socket.emit('appearance', { hair: 3, hairColor: 'black', shirt: 'green', pants: 'blue' });
    socket.emit('chat', `Oi! Eu sou ${name} 👋`);
    // anda em círculos perto do spawn
    let t0 = Date.now();
    let x = 18 * 16, y = 13 * 16;
    const timer = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      const nx = x + Math.cos(t * 1.5) * 30;
      const ny = y + Math.sin(t * 1.5) * 18;
      socket.emit('move', { x: nx, y: ny, dir: Math.cos(t * 1.5) > 0 ? 'right' : 'left', anim: 'walk' });
    }, 100);
    setTimeout(() => {
      clearInterval(timer);
      socket.emit('chat', 'Tchau!');
      socket.disconnect();
      console.log('sim done');
      process.exit(0);
    }, duration);
  });
  socket.on('chat', (m) => console.log('[chat]', m.name + ':', m.text));
  socket.on('err', (e) => console.log('[err]', e.code));
})().catch(e => { console.error(e); process.exit(1); });
