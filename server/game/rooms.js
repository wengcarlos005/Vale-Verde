// Salas de jogo: uma por fazenda, servidor autoritativo.
const { stmts } = require('../db');
const { CROPS, RESOURCES, stageOf, CHICKEN_PRICE, MAX_CHICKENS } = require('./crops');
const W = require('./world');

const DAY_START = 6 * 60;          // 6:00
const DAY_END = 26 * 60;           // 2:00 (apaga de exaustão)
const REAL_DAY_MS = 15 * 60 * 1000; // 1 dia de jogo = 15 min reais
const MIN_PER_TICK = (DAY_END - DAY_START) / (REAL_DAY_MS / 1000); // por segundo

const ENERGY_MAX = 100;
const COST = { till: 2, water: 1, plant: 1, harvest: 1, chop: 2, mine: 2 };

function newInventory() {
  return {
    items: { seed_turnip: 5 },
    energy: ENERGY_MAX,
    can: { level: 20, max: 20 },
  };
}

class Room {
  constructor(io, farm) {
    this.io = io;
    this.farmId = farm.id;
    this.code = farm.code;
    this.name = farm.name;
    this.state = JSON.parse(farm.state);
    // O ground é estático e derivado do seed: regenera no load para fazendas antigas
    // receberem melhorias de mapa (praças de terra, caminhos, etc.).
    const fresh = W.generateWorld(this.state.seed);
    this.state.ground = fresh.ground;
    // migração: remove objetos/tiles em posição inválida e adiciona cercas novas
    for (const key of Object.keys(this.state.objects)) {
      const [x, y] = key.split(',').map(Number);
      if (W.inBuildingVisual(x, y) || this.state.ground[y][x] !== 0) delete this.state.objects[key];
    }
    for (const key of Object.keys(this.state.tiles)) {
      const [x, y] = key.split(',').map(Number);
      if (this.state.ground[y][x] !== 0) delete this.state.tiles[key];
    }
    for (const [key, obj] of Object.entries(fresh.objects)) {
      if (obj.type === 'fence' && !this.state.objects[key] && !this.state.tiles[key]) {
        this.state.objects[key] = obj;
      }
    }
    // migração: campos de animais para fazendas antigas
    if (!this.state.animals) this.state.animals = [];
    if (!this.state.eggs) this.state.eggs = {};
    if (!this.state.nextAnimalId) this.state.nextAnimalId = 1;
    this.players = new Map(); // socketId -> player
    this.dirty = false;
    this.channel = `farm:${farm.id}`;
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.lastTimeBroadcast = 0;
  }

  // ---------- helpers ----------
  emit(ev, data) { this.io.to(this.channel).emit(ev, data); }

  playerByUser(userId) {
    for (const p of this.players.values()) if (p.userId === userId) return p;
    return null;
  }

  inv(userId) {
    if (!this.state.inventories[userId]) this.state.inventories[userId] = newInventory();
    return this.state.inventories[userId];
  }

  addItem(inv, id, qty) { inv.items[id] = (inv.items[id] || 0) + qty; if (inv.items[id] <= 0) delete inv.items[id]; }

  near(player, x, y) {
    const px = Math.round(player.x / W.TILE), py = Math.round(player.y / W.TILE);
    return Math.abs(px - x) <= 2 && Math.abs(py - y) <= 2;
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < W.WIDTH && y < W.HEIGHT; }

  isBuildingTile(x, y) {
    return W.BUILDINGS.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  }

  spend(inv, cost, socket) {
    if (inv.energy < cost) { socket.emit('err', { code: 'no_energy' }); return false; }
    inv.energy -= cost;
    return true;
  }

  // ---------- ciclo de vida ----------
  join(socket, user, appearance) {
    const spawnPx = { x: (W.SPAWN.x + this.players.size % 3) * W.TILE, y: W.SPAWN.y * W.TILE };
    const player = {
      socketId: socket.id, userId: user.id, name: user.name,
      x: spawnPx.x, y: spawnPx.y, dir: 'down', anim: 'idle',
      appearance: appearance || {}, sleeping: false,
    };
    this.players.set(socket.id, player);
    socket.join(this.channel);
    const inv = this.inv(user.id);
    this.dirty = true;

    socket.emit('joined', {
      farm: { id: this.farmId, code: this.code, name: this.name },
      world: {
        width: W.WIDTH, height: W.HEIGHT, tile: W.TILE,
        ground: this.state.ground, buildings: W.BUILDINGS, spawn: W.SPAWN,
      },
      state: {
        day: this.state.day, season: this.state.season, year: this.state.year,
        time: this.state.time, money: this.state.money,
        tiles: this.state.tiles, objects: this.state.objects, bin: this.state.bin,
        animals: this.state.animals, eggs: this.state.eggs,
      },
      crops: CROPS,
      you: { userId: user.id, inv },
      players: [...this.players.values()].map(p => this.publicPlayer(p)),
    });
    socket.to(this.channel).emit('playerJoined', this.publicPlayer(player));
  }

  publicPlayer(p) {
    return { userId: p.userId, name: p.name, x: p.x, y: p.y, dir: p.dir, anim: p.anim, appearance: p.appearance, sleeping: p.sleeping };
  }

  leave(socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    this.players.delete(socket.id);
    socket.leave(this.channel);
    this.emit('playerLeft', { userId: p.userId });
    this.checkAllSleeping(); // quem saiu não bloqueia a noite
    if (this.players.size === 0) this.save();
  }

  get empty() { return this.players.size === 0; }

  destroy() { clearInterval(this.tickTimer); this.save(); }

  save() {
    stmts.saveFarmState.run(JSON.stringify(this.state), this.farmId);
    this.dirty = false;
  }

  // ---------- tempo ----------
  tick() {
    if (this.players.size === 0) return;
    this.state.time += MIN_PER_TICK;
    if (this.state.time >= DAY_END) { this.advanceDay(true); return; }
    // broadcast do relógio a cada ~10s
    if (Date.now() - this.lastTimeBroadcast > 10000) {
      this.lastTimeBroadcast = Date.now();
      this.emitTime();
    }
  }

  emitTime() {
    this.emit('time', { time: Math.floor(this.state.time), day: this.state.day, season: this.state.season, year: this.state.year });
  }

  checkAllSleeping() {
    if (this.players.size > 0 && [...this.players.values()].every(p => p.sleeping)) {
      this.advanceDay(false);
    }
  }

  advanceDay(passedOut) {
    const s = this.state;
    // pagamento da caixa de venda
    let payout = 0;
    for (const e of s.bin) {
      const val = CROPS[e.item] ? CROPS[e.item].sellPrice : (RESOURCES[e.item] ? RESOURCES[e.item].sellPrice : 0);
      payout += val * e.qty;
    }
    const soldItems = s.bin;
    s.bin = [];
    s.money += payout;

    // crescimento: só cresce se regado; fora de estação morre.
    // Solo arado sem plantio volta a ser grama no dia seguinte.
    for (const [key, t] of Object.entries(s.tiles)) {
      if (!t.crop) { delete s.tiles[key]; continue; }
      if (CROPS[t.crop.id].season !== s.season) t.crop.dead = true;
      else if (t.watered && !t.crop.dead) t.crop.daysGrown++;
      t.watered = false;
    }

    // calendário
    s.day++;
    if (s.day > 28) {
      s.day = 1;
      s.season = (s.season + 1) % 4;
      if (s.season === 0) s.year++;
      // virada de estação mata cultivos da estação anterior
      for (const t of Object.values(s.tiles)) {
        if (t.crop && CROPS[t.crop.id].season !== s.season) t.crop.dead = true;
      }
    }
    s.time = DAY_START;

    // repõe alguns recursos
    this.respawnObjects(3);

    // galinhas botam um ovo cada, em tiles de grama livres do quintal do galinheiro
    for (const animal of s.animals) {
      const spot = this.freeYardTile();
      if (spot) s.eggs[spot] = { id: animal.id };
    }

    // energia
    for (const p of this.players.values()) {
      const inv = this.inv(p.userId);
      inv.energy = passedOut && !p.sleeping ? Math.floor(ENERGY_MAX * 0.6) : ENERGY_MAX;
      p.sleeping = false;
    }

    this.save();
    this.emit('dayEnded', {
      payout, soldItems, passedOut,
      day: s.day, season: s.season, year: s.year, time: s.time, money: s.money,
      tiles: s.tiles, objects: s.objects, eggs: s.eggs,
    });
    for (const p of this.players.values()) {
      this.io.to(p.socketId).emit('inv', this.inv(p.userId));
    }
  }

  // Tile de grama livre no quintal do galinheiro (para botar ovo)
  freeYardTile() {
    const s = this.state;
    const y0 = W.COOP_YARD;
    for (let tries = 0; tries < 40; tries++) {
      const x = y0.x + Math.floor(Math.random() * y0.w);
      const y = y0.y + Math.floor(Math.random() * y0.h);
      const key = `${x},${y}`;
      if (s.ground[y][x] === 0 && !s.objects[key] && !s.tiles[key] && !s.eggs[key] && !this.isBuildingTile(x, y)) {
        return key;
      }
    }
    return null;
  }

  respawnObjects(n) {
    const s = this.state;
    let tries = 0;
    while (n > 0 && tries++ < 200) {
      const x = 1 + Math.floor(Math.random() * (W.WIDTH - 2));
      const y = 1 + Math.floor(Math.random() * (W.HEIGHT - 2));
      const key = `${x},${y}`;
      const inFarm = x >= W.FARMLAND.x - 2 && x < W.FARMLAND.x + W.FARMLAND.w + 2 && y >= W.FARMLAND.y - 2 && y < W.FARMLAND.y + W.FARMLAND.h + 2;
      if (s.ground[y][x] !== 0 || s.objects[key] || s.tiles[key] || inFarm || W.inBuildingVisual(x, y)) continue;
      s.objects[key] = Math.random() < 0.6 ? { type: 'tree', hp: 5 } : { type: 'rock', hp: 3 };
      n--;
    }
  }

  // ---------- eventos do jogador ----------
  onMove(socket, data) {
    const p = this.players.get(socket.id);
    if (!p || typeof data.x !== 'number' || typeof data.y !== 'number') return;
    p.x = Math.max(0, Math.min(W.WIDTH * W.TILE, data.x));
    p.y = Math.max(0, Math.min(W.HEIGHT * W.TILE, data.y));
    p.dir = data.dir || p.dir;
    p.anim = data.anim || 'idle';
    socket.to(this.channel).emit('playerMoved', { userId: p.userId, x: p.x, y: p.y, dir: p.dir, anim: p.anim });
  }

  onChat(socket, text) {
    const p = this.players.get(socket.id);
    if (!p || typeof text !== 'string') return;
    const msg = text.trim().slice(0, 200);
    if (msg) this.emit('chat', { userId: p.userId, name: p.name, text: msg });
  }

  onAction(socket, data) {
    const p = this.players.get(socket.id);
    if (!p || !data) return;
    const { type } = data;
    const x = Math.floor(data.x), y = Math.floor(data.y);
    if (!this.inBounds(x, y) || !this.near(p, x, y)) return;
    const key = `${x},${y}`;
    const s = this.state;
    const inv = this.inv(p.userId);
    const ground = s.ground[y][x];
    const tile = s.tiles[key];
    const obj = s.objects[key];

    if (type === 'collect') {
      if (!s.eggs[key]) return;
      delete s.eggs[key];
      this.addItem(inv, 'egg', 1);
      this.dirty = true;
      this.emit('egg', { key, egg: null });
      socket.emit('inv', inv);
    } else if (type === 'till') {
      if (ground !== 0 || obj || this.isBuildingTile(x, y) || (tile && tile.tilled)) return;
      if (!this.spend(inv, COST.till, socket)) return;
      s.tiles[key] = { tilled: true, watered: false, crop: null };
      this.patchTile(key);
    } else if (type === 'water') {
      if (ground === 1) { // regar a água = encher o regador
        inv.can.level = inv.can.max;
        socket.emit('inv', inv);
        this.dirty = true;
        return;
      }
      if (!tile || !tile.tilled || tile.watered) return;
      if (inv.can.level <= 0) { socket.emit('err', { code: 'can_empty' }); return; }
      if (!this.spend(inv, COST.water, socket)) return;
      inv.can.level--;
      tile.watered = true;
      this.patchTile(key);
      socket.emit('inv', inv);
    } else if (type === 'plant') {
      const cropId = data.crop;
      const def = CROPS[cropId];
      if (!def || !tile || !tile.tilled || tile.crop) return;
      if (def.season !== s.season) { socket.emit('err', { code: 'wrong_season' }); return; }
      const seedId = `seed_${cropId}`;
      if (!inv.items[seedId]) { socket.emit('err', { code: 'no_seeds' }); return; }
      if (!this.spend(inv, COST.plant, socket)) return;
      this.addItem(inv, seedId, -1);
      tile.crop = { id: cropId, daysGrown: 0 };
      this.patchTile(key);
      socket.emit('inv', inv);
    } else if (type === 'harvest') {
      if (!tile || !tile.crop) return;
      if (tile.crop.dead) { // limpar cultivo morto
        tile.crop = null;
        this.patchTile(key);
        return;
      }
      if (stageOf(tile.crop.id, tile.crop.daysGrown) !== 4) return;
      if (!this.spend(inv, COST.harvest, socket)) return;
      this.addItem(inv, tile.crop.id, 1);
      tile.crop = null;
      this.patchTile(key);
      socket.emit('inv', inv);
    } else if (type === 'chop' || type === 'mine') {
      if (!obj) return;
      const choppable = ['tree', 'bush', 'stump'];
      if (type === 'chop' ? !choppable.includes(obj.type) : obj.type !== 'rock') return;
      if (!this.spend(inv, COST[type], socket)) return;
      obj.hp--;
      if (obj.hp <= 0) {
        delete s.objects[key];
        const drop = obj.type === 'rock' ? ['stone', 3] : ['wood', obj.type === 'tree' ? 3 : 1];
        this.addItem(inv, drop[0], drop[1]);
        this.emit('object', { key, obj: null });
        socket.emit('inv', inv);
      } else {
        this.emit('object', { key, obj });
      }
      this.dirty = true;
    }
  }

  patchTile(key) {
    this.dirty = true;
    this.emit('tile', { key, tile: this.state.tiles[key] || null });
  }

  onBuy(socket, data) {
    const p = this.players.get(socket.id);
    if (!p || !data) return;
    const cropId = String(data.crop || '');
    const qty = Math.max(1, Math.min(99, Math.floor(data.qty || 1)));
    const def = CROPS[cropId];
    if (!def) return;
    const cost = def.seedPrice * qty;
    if (this.state.money < cost) { socket.emit('err', { code: 'no_money' }); return; }
    this.state.money -= cost;
    const inv = this.inv(p.userId);
    this.addItem(inv, `seed_${cropId}`, qty);
    this.dirty = true;
    this.emit('money', { money: this.state.money });
    socket.emit('inv', inv);
  }

  onBuyAnimal(socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    const s = this.state;
    if (s.animals.length >= MAX_CHICKENS) { socket.emit('err', { code: 'no_animal_space' }); return; }
    if (s.money < CHICKEN_PRICE) { socket.emit('err', { code: 'need_egg_money' }); return; }
    s.money -= CHICKEN_PRICE;
    const y0 = W.COOP_YARD;
    const animal = {
      id: s.nextAnimalId++, type: 'chicken',
      hx: (y0.x + 1 + Math.random() * (y0.w - 2)) * W.TILE,
      hy: (y0.y + 1 + Math.random() * (y0.h - 2)) * W.TILE,
    };
    s.animals.push(animal);
    this.dirty = true;
    this.emit('money', { money: s.money });
    this.emit('animals', { animals: s.animals });
  }

  onSell(socket, data) {
    const p = this.players.get(socket.id);
    if (!p || !data) return;
    const itemId = String(data.item || '');
    const inv = this.inv(p.userId);
    const have = inv.items[itemId] || 0;
    const qty = Math.max(1, Math.min(have, Math.floor(data.qty || 1)));
    const sellable = CROPS[itemId] || RESOURCES[itemId];
    if (!sellable || have < 1) return;
    this.addItem(inv, itemId, -qty);
    const entry = this.state.bin.find(e => e.item === itemId);
    if (entry) entry.qty += qty; else this.state.bin.push({ item: itemId, qty });
    this.dirty = true;
    this.emit('bin', { bin: this.state.bin });
    socket.emit('inv', inv);
  }

  onSleep(socket, wants) {
    const p = this.players.get(socket.id);
    if (!p) return;
    p.sleeping = !!wants;
    this.emit('sleepState', {
      userId: p.userId, sleeping: p.sleeping,
      waiting: [...this.players.values()].filter(q => !q.sleeping).map(q => q.name),
    });
    this.checkAllSleeping();
  }

  onAppearance(socket, appearance) {
    const p = this.players.get(socket.id);
    if (!p) return;
    p.appearance = appearance || {};
    stmts.setAppearance.run(JSON.stringify(p.appearance), this.farmId, p.userId);
    socket.to(this.channel).emit('playerAppearance', { userId: p.userId, appearance: p.appearance });
  }
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // farmId -> Room
    setInterval(() => {
      for (const [id, room] of this.rooms) {
        if (room.dirty) room.save();
        if (room.empty) { room.destroy(); this.rooms.delete(id); }
      }
    }, 30000);
  }

  getOrLoad(farmId) {
    let room = this.rooms.get(farmId);
    if (!room) {
      const farm = stmts.farmById.get(farmId);
      if (!farm) return null;
      room = new Room(this.io, farm);
      this.rooms.set(farmId, room);
    }
    return room;
  }
}

module.exports = { RoomManager, newInventory };
