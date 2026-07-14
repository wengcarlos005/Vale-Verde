// Salas de jogo: uma por fazenda, servidor autoritativo.
const { stmts } = require('../db');
const { CROPS, RESOURCES, FOOD, FORAGE, RECIPES, WEAPON_STATS, pickQuest, stageOf, CHICKEN_PRICE, MAX_CHICKENS } = require('./crops');
const W = require('./world');

const DAY_START = 6 * 60;          // 6:00
const DAY_END = 26 * 60;           // 2:00 (apaga de exaustão)
const REAL_DAY_MS = 15 * 60 * 1000; // 1 dia de jogo = 15 min reais
const MIN_PER_TICK = (DAY_END - DAY_START) / (REAL_DAY_MS / 1000); // por segundo

const ENERGY_MAX = 100;
const HEALTH_MAX = 100;
const COST = { till: 2, water: 1, plant: 1, harvest: 1, chop: 2, mine: 2, place: 1 };

function newInventory() {
  return {
    items: { seed_turnip: 5 },
    energy: ENERGY_MAX,
    can: { level: 20, max: 20 },
    health: HEALTH_MAX, maxHealth: HEALTH_MAX,
    equipped: null, // arma selecionada no hotbar (só o client sabe a seleção — sincronizado via 'equip' pro servidor resolver o bloqueio do escudo)
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
    // receberem melhorias de mapa (praças de terra, caminhos, etc.). O overworld voltou
    // a ser só fazenda+vila (Porto Vale e o ramal sul viraram telas próprias — ver
    // mapOf), então fazendas salvas na versão "mapa gigante" (92x50→150x80) ENCOLHEM de
    // volta: qualquer objeto/tile fora do novo tamanho menor é limpo pela checagem de
    // validGround abaixo (this.state.ground[y] fica undefined fora do novo tamanho).
    const oldWidth = this.state.ground[0].length;
    const oldHeight = this.state.ground.length;
    const fresh = W.generateOverworld(this.state.seed);
    this.state.ground = fresh.ground;
    // migração: remove objetos/tiles em posição inválida e adiciona cercas/paredes novas.
    for (const key of Object.keys(this.state.objects)) {
      const [x, y] = key.split(',').map(Number);
      const obj = this.state.objects[key];
      // cavewall/ore nunca existiram no overworld de verdade (a mina sempre foi tela
      // separada) — limpa qualquer entulho de versões antigas; o resto só em grama.
      const validGround = this.state.ground[y] && this.state.ground[y][x] === 0;
      const validType = obj.type !== 'cavewall' && obj.type !== 'ore';
      if (W.inBuildingVisual('overworld', x, y) || !validGround || !validType) delete this.state.objects[key];
    }
    for (const key of Object.keys(this.state.tiles)) {
      const [x, y] = key.split(',').map(Number);
      const validGround = this.state.ground[y] && this.state.ground[y][x] === 0;
      if (!validGround || W.inBuildingVisual('overworld', x, y)) delete this.state.tiles[key];
    }
    for (const [key, obj] of Object.entries(fresh.objects)) {
      const structural = obj.type === 'fence' || obj.type === 'cavewall';
      if (structural && !this.state.objects[key] && !this.state.tiles[key]) {
        this.state.objects[key] = obj;
      }
    }
    // migração: campos de animais e construções para fazendas antigas
    if (!this.state.animals) this.state.animals = [];
    if (!this.state.eggs) this.state.eggs = {};
    if (!this.state.nextAnimalId) this.state.nextAnimalId = 1;
    if (!this.state.buildings) this.state.buildings = [];
    if (!this.state.nextBuildingId) this.state.nextBuildingId = 1;
    if (!this.state.forage) { this.state.forage = {}; W.scatterForage(this.state, 25); }
    if (!this.state.quest) this.state.quest = pickQuest();
    if (!this.state.maps) this.state.maps = {}; // estado mutável das telas de mina
    if (!this.state.discovered) this.state.discovered = { crops: [], minerals: [], monsters: [], maxDepth: 0 };
    // migração: mapa cresceu (vila a leste, depois mina/praia/Porto Vale ao sul e mais
    // a leste) — fazendas salvas antes disso têm a área nova vazia (o SCATTER original
    // só roda uma vez, na criação da fazenda). Densidade proporcional à área nova.
    if (oldWidth < W.WIDTH || oldHeight < W.HEIGHT) {
      const oldTiles = oldWidth * oldHeight, newTiles = W.WIDTH * W.HEIGHT;
      this.respawnObjects(Math.round((newTiles - oldTiles) * 0.03));
    }
    this.players = new Map(); // socketId -> player
    this.dirty = false;
    this.channel = `farm:${farm.id}`;
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.lastTimeBroadcast = 0;
  }

  // ---------- helpers ----------
  // emit = farm-wide (chat, relógio, dinheiro, dia, missões — todos veem de qualquer tela).
  emit(ev, data) { this.io.to(this.channel).emit(ev, data); }
  // emitMap = só quem está na MESMA tela (movimento, objetos, tiles).
  mapChannel(mapKey) { return `${this.channel}:${mapKey}`; }
  emitMap(mapKey, ev, data) { this.io.to(this.mapChannel(mapKey)).emit(ev, data); }
  playersOnMap(mapKey) { return [...this.players.values()].filter(q => (q.map || 'overworld') === mapKey); }

  // Contêineres mutáveis (ground/objects/tiles/forage/eggs) do mapa. Overworld = campos
  // top-level do estado (sempre existiu assim). Casa/loja = estáticos, geram de novo toda
  // vez (nada muda lá). Porto Vale/south/mina = "ao ar livre" mutáveis, persistidos em
  // state.maps[mapKey] igual ao overworld, só que num container próprio em vez de
  // top-level. Só ground/objects/tiles/forage/eggs são por-mapa; dinheiro/dia/prédios/
  // animais/inventários continuam globais da fazenda (só existem no overworld hoje).
  mapOf(mapKey) {
    if (!mapKey || mapKey === 'overworld') {
      if (!this._owEntrances) this._owEntrances = W.worldEntrances('overworld');
      return {
        key: 'overworld',
        ground: this.state.ground, objects: this.state.objects, tiles: this.state.tiles,
        forage: this.state.forage, eggs: this.state.eggs, monsters: {},
        w: W.WIDTH, h: W.HEIGHT, entrances: this._owEntrances, spawn: W.SPAWN,
      };
    }
    if (!this._maps) this._maps = {};
    if (!this._maps[mapKey]) {
      if (mapKey === 'house' || mapKey === 'shop') {
        // interiores são estáticos (piso/parede/móveis não mudam) — sem persistência.
        const gen = W.makeInterior(mapKey);
        this._maps[mapKey] = {
          key: mapKey,
          ground: gen.ground, objects: gen.objects, tiles: {}, forage: {}, eggs: {}, monsters: {},
          w: gen.w, h: gen.h, entrances: gen.entrances, spawn: gen.spawn, interactables: gen.interactables,
        };
      } else {
        // Porto Vale / south / mina: gera o terreno e persiste o estado mutável em
        // state.maps[mapKey] (preguiçoso — só na primeira visita).
        let gen, entrances;
        if (mapKey === 'portovale') { gen = W.generatePortoVale(this.state.seed); entrances = W.worldEntrances('portovale'); }
        else if (mapKey === 'south') { gen = W.generateSouth(this.state.seed); entrances = W.worldEntrances('south'); }
        else if (mapKey === 'pedreira') { gen = W.generatePedreira(this.state.seed); entrances = W.worldEntrances('pedreira'); }
        else { gen = W.makeMineLevel(this.state.seed, W.depthOf(mapKey)); entrances = gen.entrances; }
        if (!this.state.maps) this.state.maps = {};
        if (!this.state.maps[mapKey]) this.state.maps[mapKey] = { objects: gen.objects, tiles: {}, forage: {}, eggs: {}, monsters: gen.monsters || {} };
        const saved = this.state.maps[mapKey];
        if (saved.monsters == null) saved.monsters = gen.monsters || {}; // migração: mapa salvo antes do sistema de combate
        // Migração: terreno "ao ar livre" é sempre regerado do código atual (não salvo),
        // então se a geração mudar (praia cresceu, estrada mudou de forma...) um objeto
        // ESPALHADO (árvore/pedra/arbusto/toco) pode ficar preso em cima de areia/água/
        // estrada que antes era grama. Limpa qualquer um fora de grama — mesmo princípio
        // da limpeza de validGround que já existe pro overworld. NÃO mexe em fixtures
        // colocadas de propósito pelo gerador (ex.: stone_wall pode legitimamente ficar
        // sobre estrada/praça, como acontece na Pedreira).
        if (mapKey === 'south' || mapKey === 'portovale' || mapKey === 'pedreira') {
          const scatterTypes = new Set(['tree', 'rock', 'bush', 'stump']);
          for (const okey of Object.keys(saved.objects)) {
            if (!scatterTypes.has(saved.objects[okey].type)) continue;
            const [ox, oy] = okey.split(',').map(Number);
            if (!(gen.ground[oy] && gen.ground[oy][ox] === 0)) { delete saved.objects[okey]; this.dirty = true; }
          }
        }
        this._maps[mapKey] = {
          key: mapKey,
          ground: gen.ground, objects: saved.objects, tiles: saved.tiles, forage: saved.forage, eggs: saved.eggs,
          monsters: saved.monsters,
          w: gen.w, h: gen.h, entrances, spawn: gen.spawn,
        };
      }
    }
    return this._maps[mapKey];
  }

  // Payload no formato do 'joined' pra um jogador, do mapa em que ele está agora.
  mapPayload(p) {
    const m = this.mapOf(p.map);
    const s = this.state;
    const isOw = m.key === 'overworld';
    return {
      farm: { id: this.farmId, code: this.code, name: this.name },
      map: m.key,
      world: {
        width: m.w, height: m.h, tile: W.TILE,
        ground: m.ground, buildings: W.BUILDINGS[m.key] || [], spawn: m.spawn,
        buildingDefs: W.BUILDING_DEFS,
        entrances: m.entrances.map(e => ({ at: e.at, kind: e.kind })),
        interactables: m.interactables || [],
      },
      state: {
        day: s.day, season: s.season, year: s.year, time: s.time, money: s.money,
        tiles: m.tiles, objects: m.objects, bin: s.bin,
        animals: isOw ? s.animals : [], eggs: m.eggs, buildings: isOw ? s.buildings : [],
        forage: m.forage, quest: s.quest, monsters: m.monsters || {}, discovered: s.discovered,
      },
      crops: CROPS,
      recipes: RECIPES,
      weapons: WEAPON_STATS,
      you: { userId: p.userId, inv: this.inv(p.userId) },
      players: this.playersOnMap(m.key).map(q => this.publicPlayer(q)),
    };
  }

  playerByUser(userId) {
    for (const p of this.players.values()) if (p.userId === userId) return p;
    return null;
  }

  inv(userId) {
    if (!this.state.inventories[userId]) this.state.inventories[userId] = newInventory();
    const inv = this.state.inventories[userId];
    // migração: inventários salvos antes do sistema de combate não tinham vida/equip.
    if (inv.health == null) { inv.health = HEALTH_MAX; inv.maxHealth = HEALTH_MAX; inv.equipped = null; }
    return inv;
  }

  addItem(inv, id, qty) { inv.items[id] = (inv.items[id] || 0) + qty; if (inv.items[id] <= 0) delete inv.items[id]; }

  // Registra a primeira vez que a FAZENDA (cooperativo — não é por jogador) colhe um
  // cultivo, minera um minério ou derrota um tipo de monstro, pro menu de progresso.
  // Emite só quando muda de verdade (evita spam a cada colheita repetida).
  discover(category, id) {
    const list = this.state.discovered[category];
    if (list.includes(id)) return;
    list.push(id);
    this.dirty = true;
    this.emit('discovered', this.state.discovered);
  }

  near(player, x, y) {
    const px = Math.round(player.x / W.TILE), py = Math.round(player.y / W.TILE);
    return Math.abs(px - x) <= 2 && Math.abs(py - y) <= 2;
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < W.WIDTH && y < W.HEIGHT; }

  // mapKey opcional — default 'overworld' (todo mundo que chamava isso antes só existia
  // dentro de ações do overworld mesmo). Prédios do jogador (coop) só existem lá.
  isBuildingTile(x, y, mapKey = 'overworld') {
    const hit = (b) => { const r = W.collisionRect(b); return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; };
    return (W.BUILDINGS[mapKey] || []).some(hit) || (mapKey === 'overworld' && this.state.buildings.some(hit));
  }

  // Galinheiros construídos (para ovos e compra de galinha)
  coops() { return this.state.buildings.filter(b => b.type === 'coop'); }

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
      appearance: appearance || {}, sleeping: false, map: 'overworld',
    };
    this.players.set(socket.id, player);
    socket.join(this.channel);                       // farm-wide (chat/global)
    socket.join(this.mapChannel('overworld'));       // canal do mapa
    this.inv(user.id);
    this.dirty = true;
    socket.emit('joined', this.mapPayload(player));
    socket.to(this.mapChannel('overworld')).emit('playerJoined', this.publicPlayer(player));
  }

  // Trocar de tela por uma entrada (entrada da mina, escadas, portas). Valida que o
  // jogador está no tile de uma `entrance` do mapa atual e o move pra tela alvo.
  enterMap(socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    const cur = this.mapOf(p.map);
    const px = Math.round(p.x / W.TILE), py = Math.round(p.y / W.TILE);
    const ent = cur.entrances.find(e => Math.abs(px - e.at[0]) <= 1 && Math.abs(py - e.at[1]) <= 1);
    if (!ent) return;
    socket.leave(this.mapChannel(p.map));
    socket.to(this.mapChannel(p.map)).emit('playerLeft', { userId: p.userId });
    p.map = ent.to;
    p.x = ent.toSpawn[0] * W.TILE; p.y = ent.toSpawn[1] * W.TILE;
    p.dir = 'down'; p.anim = 'idle'; p.sleeping = false;
    if (p.map.startsWith('mine:')) {
      const depth = W.depthOf(p.map);
      if (depth > this.state.discovered.maxDepth) { this.state.discovered.maxDepth = depth; this.emit('discovered', this.state.discovered); }
    }
    socket.join(this.mapChannel(p.map));
    socket.emit('joined', this.mapPayload(p));
    socket.to(this.mapChannel(p.map)).emit('playerJoined', this.publicPlayer(p));
    this.checkAllSleeping();
    this.dirty = true;
  }

  publicPlayer(p) {
    return { userId: p.userId, name: p.name, x: p.x, y: p.y, dir: p.dir, anim: p.anim, appearance: p.appearance, sleeping: p.sleeping };
  }

  leave(socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    this.players.delete(socket.id);
    socket.leave(this.channel);
    socket.leave(this.mapChannel(p.map));
    this.emitMap(p.map, 'playerLeft', { userId: p.userId });
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
    this.tickCombat();
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

    // repõe alguns recursos e forrageáveis
    this.respawnObjects(3);
    W.scatterForage(s, 8);

    // galinhas botam um ovo cada, no quintal de algum galinheiro construído
    const coops = this.coops();
    if (coops.length) {
      for (const animal of s.animals) {
        const spot = this.freeYardTile(coops[Math.floor(Math.random() * coops.length)]);
        if (spot) s.eggs[spot] = { id: animal.id };
      }
    }

    // energia
    for (const p of this.players.values()) {
      const inv = this.inv(p.userId);
      inv.energy = passedOut && !p.sleeping ? Math.floor(ENERGY_MAX * 0.6) : ENERGY_MAX;
      p.sleeping = false;
    }

    this.save();
    // resumo/calendário/dinheiro é global (todos veem, de qualquer tela)...
    this.emit('dayEnded', {
      payout, soldItems, passedOut,
      day: s.day, season: s.season, year: s.year, time: s.time, money: s.money,
    });
    // ...mas a atualização do MUNDO (tiles/objetos/ovos/forrageio) é só do overworld —
    // quem está na mina não deve receber (senão o cliente aplicaria no cenário errado).
    this.emitMap('overworld', 'mapRefresh', { tiles: s.tiles, objects: s.objects, eggs: s.eggs, forage: s.forage });
    for (const p of this.players.values()) {
      this.io.to(p.socketId).emit('inv', this.inv(p.userId));
    }
  }

  // Tile de grama livre no quintal de um galinheiro (para botar ovo)
  freeYardTile(coop) {
    const s = this.state;
    const y0 = W.coopYard(coop);
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
    while (n > 0 && tries++ < 1000) {
      const x = 1 + Math.floor(Math.random() * (W.WIDTH - 2));
      const y = 1 + Math.floor(Math.random() * (W.HEIGHT - 2));
      const key = `${x},${y}`;
      const inFarm = x >= W.FARMLAND.x - 2 && x < W.FARMLAND.x + W.FARMLAND.w + 2 && y >= W.FARMLAND.y - 2 && y < W.FARMLAND.y + W.FARMLAND.h + 2;
      if (s.ground[y][x] !== 0 || s.tiles[key] || inFarm || W.inBuildingVisual('overworld', x, y) || W.inPlayerBuildingOrYard(s, x, y)) continue;
      if (W.hasNearbyContent(s, x, y)) continue;
      s.objects[key] = Math.random() < 0.6 ? { type: 'tree', hp: 5 } : { type: 'rock', hp: 3 };
      n--;
    }
  }

  // ---------- eventos do jogador ----------
  onMove(socket, data) {
    const p = this.players.get(socket.id);
    if (!p || typeof data.x !== 'number' || typeof data.y !== 'number') return;
    const m = this.mapOf(p.map);
    p.x = Math.max(0, Math.min(m.w * W.TILE, data.x));
    p.y = Math.max(0, Math.min(m.h * W.TILE, data.y));
    p.dir = data.dir || p.dir;
    p.anim = data.anim || 'idle';
    socket.to(this.mapChannel(p.map)).emit('playerMoved', { userId: p.userId, x: p.x, y: p.y, dir: p.dir, anim: p.anim });
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
    // Ataque em monstro: não tem x/y (o alvo é o monstro, não um tile) e o alcance varia
    // por arma (arco chega bem mais longe que os 2 tiles do `near()` genérico), então
    // resolve antes/fora da validação de tile normal.
    if (type === 'attack') { this.onAttack(socket, data); return; }
    const x = Math.floor(data.x), y = Math.floor(data.y);
    const m = this.mapOf(p.map);
    if (x < 0 || y < 0 || x >= m.w || y >= m.h || !this.near(p, x, y)) return;
    const key = `${x},${y}`;
    const inv = this.inv(p.userId);
    const ground = m.ground[y][x];
    const tile = m.tiles[key];
    const obj = m.objects[key];
    const patch = (k) => { this.dirty = true; this.emitMap(p.map, 'tile', { key: k, tile: m.tiles[k] || null }); };
    const onOverworld = p.map === 'overworld';

    if (type === 'collect') {
      // ovo ou forrageável (fruta/cogumelo/lenha) — sem ferramenta nem energia
      if (m.eggs[key]) {
        delete m.eggs[key];
        this.addItem(inv, 'egg', 1);
        this.emitMap(p.map, 'egg', { key, egg: null });
      } else if (m.forage[key]) {
        const f = m.forage[key];
        const def = FORAGE[f.type];
        delete m.forage[key];
        // drops de corte/mineração carregam give/qty próprios (não vêm da tabela FORAGE,
        // que é só pros forrageáveis "nativos" berry/mushroom/log); um cobre o outro.
        if (f.give) this.addItem(inv, f.give, f.qty || 1);
        else if (def) this.addItem(inv, def.give, def.qty);
        this.emitMap(p.map, 'forage', { key, item: null });
      } else return;
      this.dirty = true;
      socket.emit('inv', inv);
    } else if (type === 'till') {
      if (!onOverworld || ground !== 0 || obj || this.isBuildingTile(x, y) || (tile && tile.tilled)) return;
      if (!this.spend(inv, COST.till, socket)) return;
      m.tiles[key] = { tilled: true, watered: false, crop: null };
      patch(key);
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
      patch(key);
      socket.emit('inv', inv);
    } else if (type === 'plant') {
      const cropId = data.crop;
      const def = CROPS[cropId];
      if (!def || !tile || !tile.tilled || tile.crop) return;
      if (def.season !== this.state.season) { socket.emit('err', { code: 'wrong_season' }); return; }
      const seedId = `seed_${cropId}`;
      if (!inv.items[seedId]) { socket.emit('err', { code: 'no_seeds' }); return; }
      if (!this.spend(inv, COST.plant, socket)) return;
      this.addItem(inv, seedId, -1);
      tile.crop = { id: cropId, daysGrown: 0 };
      patch(key);
      socket.emit('inv', inv);
    } else if (type === 'harvest') {
      if (!tile || !tile.crop) return;
      if (tile.crop.dead) { // limpar cultivo morto
        tile.crop = null;
        patch(key);
        return;
      }
      if (stageOf(tile.crop.id, tile.crop.daysGrown) !== 4) return;
      if (!this.spend(inv, COST.harvest, socket)) return;
      this.addItem(inv, tile.crop.id, 1);
      this.discover('crops', tile.crop.id);
      tile.crop = null;
      patch(key);
      socket.emit('inv', inv);
    } else if (type === 'chop' || type === 'mine') {
      if (!obj) return;
      const choppable = ['tree', 'bush', 'stump'];
      const mineable = ['rock', 'ore'];
      if (type === 'chop' ? !choppable.includes(obj.type) : !mineable.includes(obj.type)) return;
      if (!this.spend(inv, COST[type], socket)) return;
      obj.hp--;
      if (obj.hp <= 0) {
        delete m.objects[key];
        if (obj.type === 'ore') this.discover('minerals', obj.mineral);
        const drop = obj.type === 'rock' ? ['stone', 3]
          : obj.type === 'ore' ? [obj.mineral, 2]
          : ['wood', obj.type === 'tree' ? 3 : 1];
        // Cai no CHÃO em vez de ir direto pro inventário — o jogador precisa passar por
        // cima pra coletar (mesmo mecanismo de forage: `type` dobra como visual E dá
        // give/qty próprios, sem passar pela tabela FORAGE fixa de berry/mushroom/log).
        m.forage[key] = { type: drop[0], give: drop[0], qty: drop[1] };
        this.emitMap(p.map, 'object', { key, obj: null });
        this.emitMap(p.map, 'forage', { key, item: m.forage[key] });
      } else {
        this.emitMap(p.map, 'object', { key, obj });
      }
      this.dirty = true;
    } else if (type === 'place') {
      // colocar um item fabricado no mundo (por ora só cerca) — só no overworld
      const itemId = String(data.item || '');
      if (!onOverworld || itemId !== 'fence') return;
      if (ground !== 0 || obj || tile || this.isBuildingTile(x, y)) return;
      if (!inv.items.fence) return;
      if (!this.spend(inv, COST.place, socket)) return;
      this.addItem(inv, 'fence', -1);
      m.objects[key] = { type: 'fence' };
      this.emitMap(p.map, 'object', { key, obj: m.objects[key] });
      socket.emit('inv', inv);
      this.dirty = true;
    }
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
    if (!p || p.map !== 'overworld') return;
    const s = this.state;
    const coops = this.coops();
    if (!coops.length) { socket.emit('err', { code: 'need_coop' }); return; }
    if (s.animals.length >= MAX_CHICKENS * coops.length) { socket.emit('err', { code: 'no_animal_space' }); return; }
    if (s.money < CHICKEN_PRICE) { socket.emit('err', { code: 'need_egg_money' }); return; }
    s.money -= CHICKEN_PRICE;
    const y0 = W.coopYard(coops[Math.floor(Math.random() * coops.length)]);
    const animal = {
      id: s.nextAnimalId++, type: 'chicken',
      hx: (y0.x + 1 + Math.random() * (y0.w - 2)) * W.TILE,
      hy: (y0.y + 1 + Math.random() * (y0.h - 2)) * W.TILE,
    };
    s.animals.push(animal);
    this.dirty = true;
    this.emit('money', { money: s.money });
    this.emitMap('overworld', 'animals', { animals: s.animals });
  }

  // Construir um prédio: valida materiais e posição, desconta, adiciona ao estado.
  onBuild(socket, data) {
    const p = this.players.get(socket.id);
    if (!p || !data || p.map !== 'overworld') return;
    const s = this.state;
    const def = W.BUILDING_DEFS[String(data.type || '')];
    if (!def) return;
    const bx = Math.floor(data.x), by = Math.floor(data.y);
    // dentro dos limites e longe das bordas
    if (bx < 1 || by < 1 || bx + def.w > W.WIDTH - 1 || by + def.h > W.HEIGHT - 1) {
      socket.emit('err', { code: 'bad_spot' }); return;
    }
    // posição livre: sem água/estrada, objetos, solo arado ou outro prédio
    for (let y = by; y < by + def.h; y++) {
      for (let x = bx; x < bx + def.w; x++) {
        if (s.ground[y][x] !== 0 || s.objects[`${x},${y}`] || s.tiles[`${x},${y}`] || this.isBuildingTile(x, y)) {
          socket.emit('err', { code: 'bad_spot' }); return;
        }
      }
    }
    // folga em relação a outros prédios (evita telhados/paredes se sobrepondo visualmente)
    const vis = def.vis != null ? def.vis : 4;
    if (!W.buildingSpotFree(s, bx, by, def.w, def.h, vis)) {
      socket.emit('err', { code: 'bad_spot' }); return;
    }
    // materiais
    const inv = this.inv(p.userId);
    const cost = def.cost || {};
    if ((cost.wood || 0) > (inv.items.wood || 0) || (cost.stone || 0) > (inv.items.stone || 0) || (cost.money || 0) > s.money) {
      socket.emit('err', { code: 'no_materials' }); return;
    }
    if (cost.wood) this.addItem(inv, 'wood', -cost.wood);
    if (cost.stone) this.addItem(inv, 'stone', -cost.stone);
    if (cost.money) s.money -= cost.money;

    const b = { id: s.nextBuildingId++, type: data.type, x: bx, y: by, w: def.w, h: def.h, vis };
    s.buildings.push(b);
    this.dirty = true;
    this.emitMap('overworld', 'building', { building: b });
    this.emit('money', { money: s.money });
    socket.emit('inv', inv);
  }

  // Fabricar na bancada: consome materiais e dá o item pronto (cerca, e agora também as
  // armas de combate — sword/spear/bow/shield custam madeira+ferro/pedra).
  onCraft(socket, data) {
    const p = this.players.get(socket.id);
    if (!p || !data || p.map !== 'overworld') return;
    const def = RECIPES[String(data.recipe || '')];
    if (!def) return;
    if (!W.BUILDINGS.overworld.some(b => b.type === 'bench' && this.near(p, b.x, b.y))) {
      socket.emit('err', { code: 'need_bench' }); return;
    }
    const inv = this.inv(p.userId);
    const cost = def.cost || {};
    for (const [item, qty] of Object.entries(cost)) {
      if (qty > (inv.items[item] || 0)) { socket.emit('err', { code: 'no_materials' }); return; }
    }
    for (const [item, qty] of Object.entries(cost)) this.addItem(inv, item, -qty);
    this.addItem(inv, def.give, def.qty || 1);
    this.dirty = true;
    socket.emit('inv', inv);
  }

  // Arma equipada no hotbar — o client só manda isso quando seleciona/desseleciona uma
  // arma (não a cada frame). Guardado no inventário pra o tick de combate saber resolver
  // o bloqueio do escudo (o servidor não vê a seleção do hotbar de outra forma).
  onEquip(socket, data) {
    const p = this.players.get(socket.id);
    if (!p) return;
    const inv = this.inv(p.userId);
    const item = data && data.item ? String(data.item) : null;
    inv.equipped = (item && WEAPON_STATS[item]) ? item : null;
  }

  // Atacar um monstro: sem x/y (o alvo é o monstro, não um tile) — alcance vem da arma
  // (WEAPON_STATS), bem maior que o `near()` genérico das ações de fazenda (arco chega
  // a ~4.5 tiles). Escudo não ataca (damage 0, filtrado antes de chegar aqui).
  onAttack(socket, data) {
    const p = this.players.get(socket.id);
    if (!p) return;
    const weaponId = String((data && data.weapon) || '');
    const stats = WEAPON_STATS[weaponId];
    if (!stats || !stats.damage) return;
    const inv = this.inv(p.userId);
    if (!inv.items[weaponId]) return; // precisa ter a arma de verdade no inventário
    const m = this.mapOf(p.map);
    const monsterId = String((data && data.monsterId) || '');
    const mon = m.monsters && m.monsters[monsterId];
    if (!mon) return;
    const px = p.x / W.TILE, py = p.y / W.TILE;
    if (Math.hypot(px - mon.x, py - mon.y) > stats.range + 0.6) return;
    mon.hp -= stats.damage;
    this.dirty = true;
    if (mon.hp <= 0) {
      delete m.monsters[monsterId];
      const depth = W.depthOf(p.map);
      const reward = 5 + depth * 2 + Math.floor(Math.random() * 5);
      this.state.money += reward;
      this.discover('monsters', mon.type);
      this.emitMap(p.map, 'monster', { id: monsterId, monster: null });
      this.emit('money', { money: this.state.money });
    } else {
      this.emitMap(p.map, 'monster', { id: monsterId, monster: mon });
    }
  }

  // Dano por contato: monstros são PARADOS (sem perseguição, decisão explícita pra
  // reduzir risco/escopo) — se o jogador fica perto (mesmo tile ou vizinho), leva dano a
  // cada tick (1s) enquanto continuar ali. Escudo equipado reduz o dano recebido.
  tickCombat() {
    for (const p of this.players.values()) {
      if (!p.map || !p.map.startsWith('mine:')) continue;
      const m = this._maps && this._maps[p.map];
      if (!m || !m.monsters) continue;
      const monsters = Object.values(m.monsters);
      if (!monsters.length) continue;
      // Raio generoso o bastante pra cobrir "andou pro tile vizinho" (distância 1 em
      // ortogonal), não só "ficou exatamente em cima do monstro" — monstro também virou
      // obstáculo de colisão no cliente (blockedAt), então "vizinho" já é o mais perto
      // que dá pra chegar sem atravessar por cima dele.
      const px = p.x / W.TILE, py = p.y / W.TILE;
      if (!monsters.some((mon) => Math.hypot(px - mon.x, py - mon.y) < 1.3)) continue;
      const inv = this.inv(p.userId);
      const depth = W.depthOf(p.map);
      let dmg = 3 + Math.floor(depth / 3);
      if (inv.equipped === 'shield' && inv.items.shield) dmg = Math.max(1, Math.ceil(dmg * (1 - WEAPON_STATS.shield.block)));
      inv.health = Math.max(0, inv.health - dmg);
      this.dirty = true;
      if (inv.health <= 0) { this.faintInMine(p, inv); continue; }
      this.io.to(p.socketId).emit('inv', inv);
    }
  }

  // Vida chega a 0 na mina: "desmaia" e é levado de volta pra casa (overworld), recupera
  // metade da vida, perde um pouco de dinheiro — mesmo espírito do desmaio por exaustão
  // que já existe pra energia. Reaproveita o mesmo formato de payload do enterMap/joined
  // pra reconstruir a cena do jogador do zero na tela nova.
  faintInMine(p, inv) {
    inv.health = Math.ceil(inv.maxHealth * 0.5);
    const penalty = Math.min(this.state.money, 20 + W.depthOf(p.map) * 3);
    this.state.money -= penalty;
    this.emit('money', { money: this.state.money });
    const oldMap = p.map;
    const houseB = W.BUILDINGS.overworld.find((b) => b.type === 'house');
    const spawn = houseB ? [houseB.door[0], houseB.door[1] + 1] : [W.SPAWN.x, W.SPAWN.y];
    this.emitMap(oldMap, 'playerLeft', { userId: p.userId });
    p.map = 'overworld';
    p.x = spawn[0] * W.TILE; p.y = spawn[1] * W.TILE;
    p.dir = 'down'; p.anim = 'idle'; p.sleeping = false;
    const socket = this.io.sockets && this.io.sockets.sockets && this.io.sockets.sockets.get(p.socketId);
    if (socket) {
      socket.leave(this.mapChannel(oldMap));
      socket.join(this.mapChannel('overworld'));
      socket.emit('joined', this.mapPayload(p));
      socket.emit('err', { code: 'fainted' });
      socket.to(this.mapChannel('overworld')).emit('playerJoined', this.publicPlayer(p));
    }
    this.checkAllSleeping();
    this.dirty = true;
  }

  // Entregar o pedido do quadro de recados: dá a recompensa e sorteia o próximo.
  onDeliverQuest(socket) {
    const p = this.players.get(socket.id);
    if (!p || p.map !== 'overworld') return;
    const s = this.state;
    const q = s.quest;
    if (!q) return;
    if (!W.BUILDINGS.overworld.some(b => b.type === 'board' && this.near(p, b.x, b.y))) {
      socket.emit('err', { code: 'need_board' }); return;
    }
    const inv = this.inv(p.userId);
    if ((inv.items[q.item] || 0) < q.qty) { socket.emit('err', { code: 'quest_missing_items' }); return; }
    this.addItem(inv, q.item, -q.qty);
    s.money += q.reward;
    s.quest = pickQuest();
    this.dirty = true;
    this.emit('quest', { quest: s.quest });
    this.emit('money', { money: s.money });
    socket.emit('inv', inv);
    this.emit('questDelivered', { name: p.name, item: q.item, qty: q.qty, reward: q.reward });
  }

  // Comer: recupera energia e consome 1 do item (frutas/cogumelos)
  onEat(socket, data) {
    const p = this.players.get(socket.id);
    if (!p || !data) return;
    const id = String(data.item || '');
    const def = FOOD[id];
    if (!def) return;
    const inv = this.inv(p.userId);
    if (!inv.items[id]) return;
    if (inv.energy >= ENERGY_MAX) { socket.emit('err', { code: 'energy_full' }); return; }
    this.addItem(inv, id, -1);
    inv.energy = Math.min(ENERGY_MAX, inv.energy + def.energy);
    this.dirty = true;
    socket.emit('inv', inv);
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
    socket.to(this.mapChannel(p.map)).emit('playerAppearance', { userId: p.userId, appearance: p.appearance });
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
