const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const backup = require('./backup');

const PORT = process.env.PORT || 8140;
const MAX_MEMBERS = 6;

// Restaura o backup da nuvem ANTES de abrir o banco (Render free não tem disco),
// depois carrega os módulos que dependem do banco e sobe o servidor.
async function main() {
  await backup.restore().catch(e => console.error('[backup] restore falhou:', e.message));

  const { db, stmts } = require('./db');
  const { router: authRouter, verifyToken, requireAuth } = require('./auth');
  const { initialFarmState } = require('./game/world');
  const { RoomManager } = require('./game/rooms');

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const rooms = new RoomManager(io);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'client')));

  app.use('/api/auth', authRouter);

  // ---------- fazendas ----------
function genCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = 'VV-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (stmts.farmByCode.get(code));
  return code;
}

app.get('/api/farms', requireAuth, (req, res) => {
  res.json({ farms: stmts.farmsOfUser.all(req.user.id) });
});

app.post('/api/farms', requireAuth, (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 24);
  if (name.length < 2) return res.status(400).json({ error: 'invalid_name' });
  const code = genCode();
  const seed = [...code].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const info = stmts.createFarm.run(code, name, req.user.id, JSON.stringify(initialFarmState(seed)));
  stmts.addMember.run(info.lastInsertRowid, req.user.id);
  res.json({ farm: { id: info.lastInsertRowid, code, name, members: 1 } });
});

app.post('/api/farms/join', requireAuth, (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  const farm = stmts.farmByCode.get(code);
  if (!farm) return res.status(404).json({ error: 'farm_not_found' });
  if (!stmts.isMember.get(farm.id, req.user.id)) {
    if (stmts.memberCount.get(farm.id).n >= MAX_MEMBERS) return res.status(409).json({ error: 'farm_full' });
    stmts.addMember.run(farm.id, req.user.id);
  }
  res.json({ farm: { id: farm.id, code: farm.code, name: farm.name } });
});

// ---------- websocket ----------
io.use((socket, next) => {
  const { token, farmId } = socket.handshake.auth || {};
  const payload = verifyToken(token);
  if (!payload) return next(new Error('unauthorized'));
  const farm = stmts.farmById.get(Number(farmId));
  if (!farm || !stmts.isMember.get(farm.id, payload.id)) return next(new Error('not_member'));
  socket.data.user = payload;
  socket.data.farmId = farm.id;
  next();
});

io.on('connection', (socket) => {
  const room = rooms.getOrLoad(socket.data.farmId);
  if (!room) { socket.disconnect(true); return; }

  // um usuário só pode estar conectado uma vez por fazenda
  const dup = room.playerByUser(socket.data.user.id);
  if (dup) io.sockets.sockets.get(dup.socketId)?.disconnect(true);

  const row = stmts.getAppearance.get(socket.data.farmId, socket.data.user.id);
  let appearance = {};
  try { appearance = JSON.parse(row?.appearance || '{}'); } catch {}

  room.join(socket, socket.data.user, appearance);

  socket.on('move', d => room.onMove(socket, d));
  socket.on('chat', d => room.onChat(socket, d));
  socket.on('action', d => room.onAction(socket, d));
  socket.on('buy', d => room.onBuy(socket, d));
  socket.on('buyAnimal', () => room.onBuyAnimal(socket));
  socket.on('build', d => room.onBuild(socket, d));
  socket.on('craft', d => room.onCraft(socket, d));
  socket.on('equip', d => room.onEquip(socket, d));
  socket.on('block', d => room.onBlock(socket, d));
  socket.on('deliverQuest', () => room.onDeliverQuest(socket));
  socket.on('enterMap', () => room.enterMap(socket));
  socket.on('eat', d => room.onEat(socket, d));
  socket.on('sell', d => room.onSell(socket, d));
  socket.on('sleep', d => room.onSleep(socket, d));
  socket.on('appearance', d => room.onAppearance(socket, d));
  socket.on('disconnect', () => room.leave(socket));
});

  backup.startAutoSave(db);

  server.listen(PORT, () => {
    console.log(`Greenvale server on http://localhost:${PORT}`);
    if (backup.enabled()) console.log('[backup] progresso salvo na nuvem (Turso)');
  });
}

main().catch(e => { console.error('Falha ao iniciar:', e); process.exit(1); });
