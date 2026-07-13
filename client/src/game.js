// Cena principal do jogo (Phaser 3) — renderização do mundo, movimento com
// predição local, jogadores remotos, ações de fazenda e interações.
import { connect } from './net.js';
import { Hud, TOOLS, WEAPONS, itemName } from './hud.js';
import { t } from './i18n.js';

const CROP_ORDER = ['turnip', 'potato', 'carrot', 'strawberry', 'tomato', 'corn', 'pepper', 'onion', 'cabbage', 'beet'];

// Lookup do autotile do solo arado (assinatura → frame do FarmLand_Tile).
// Derivado por análise de pixels em tools/analyze_farmland (bordas + cantos internos).
const TILLED_BLOB = {
  0: 9, 1: 2, 2: 10, 3: 3, 4: 16, 5: 23, 6: 17, 7: 24, 8: 8, 9: 1, 10: 14, 11: 7,
  12: 15, 13: 22, 14: 21, 15: 0, 16: 49, 20: 36, 24: 11, 28: 18, 32: 50, 34: 13,
  36: 37, 38: 20, 48: 12, 52: 19, 65: 29, 73: 4, 112: 45, 129: 30, 131: 6, 176: 44,
  192: 42, 193: 5,
};
export const HAIR_COLORS = ['black', 'blonde', 'brown', 'ginger', 'grey'];
export const OUTFIT_COLORS = ['black', 'blue', 'green', 'orange', 'pink', 'purple', 'red', 'white_and_brown'];

// Pegada de colisão (em tiles) dos objetos de interior maiores que 1x1 — sem isso só o
// tile-âncora bloqueava e dava pra "entrar" visualmente dentro do resto do sprite (mesa,
// balcão, cama, prateleira). Ancorado no canto inferior-esquerdo, igual ao render (mesma
// convenção de `by = y*T+T`, origin(0,1)): cobre colunas [ax, ax+w) e linhas (ay-h, ay].
const OBJ_FOOTPRINT = { table: [3, 2], counter: [3, 2], bed: [2, 2], shelf: [2, 2] };

const T = 16;                       // tile
const SPEED = 95;                   // px/s
const ROWS = { idle: { down: 0, right: 1, up: 2 }, walk: { down: 3, right: 4, up: 5 }, act: { down: 6, right: 7, up: 8 } };
const FRAMES_PER = { idle: 6, walk: 6, act: 4 };
const SHEET_COLS = 9;

function defaultAppearance(userId) {
  const saved = localStorage.getItem('gv_appearance');
  if (saved) { try { return JSON.parse(saved); } catch {} }
  return {
    hair: 1 + (userId % 6),
    hairColor: HAIR_COLORS[userId % HAIR_COLORS.length],
    shirt: OUTFIT_COLORS[(userId * 3) % OUTFIT_COLORS.length],
    pants: OUTFIT_COLORS[(userId * 5 + 1) % OUTFIT_COLORS.length],
  };
}

let game = null;

// Tela de carregamento (cobre o game-container até o mundo aparecer)
function loading(pct, msgKey) {
  const el = document.getElementById('game-loading');
  if (!el) return;
  el.classList.remove('hidden');
  if (pct != null) document.getElementById('gl-fill').style.width = Math.round(pct) + '%';
  if (msgKey) document.getElementById('gl-msg').textContent = t(msgKey);
}
function hideLoading() {
  const el = document.getElementById('game-loading');
  if (el) el.classList.add('hidden');
}

export function startGame(farm) {
  loading(8, 'loading.connecting');
  const socket = connect(farm.id);
  socket.on('connect_error', (e) => { console.error('[greenvale] connect_error', e.message); loading(8, 'loading.connecting'); });
  socket.io.on('reconnect_attempt', () => loading(8, 'loading.connecting'));
  // No plano grátis do Render o servidor "dorme" após ~15 min ocioso e leva ~30-60s pra
  // acordar. Se o 'joined' demorar, troca a mensagem pra explicar (senão parece travado).
  const wakeTimer = setTimeout(() => { if (window.gvBoot !== 'joined') loading(null, 'loading.waking'); }, 9000);
  // 'joined' chega no login E a cada troca de tela (overworld ↔ mina/interior). Toda vez
  // reconstrói a cena com o novo mapa — a tela de carregamento cobre, e como as texturas
  // ficam em cache o reload é rápido.
  socket.on('joined', (data) => {
    clearTimeout(wakeTimer);
    window.gvBoot = 'joined';
    loading(20, 'loading.assets');
    if (game) { game.destroy(true); game = null; }
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game-container',
      backgroundColor: '#1c2b1e',
      pixelArt: true,
      roundPixels: true,
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      scene: new GameScene(socket, data),
    });
    window.gvGame = game;
  });
}

// Eventos de jogo que a cena registra — removidos antes de re-registrar em cada rebuild
// (troca de tela), senão os handlers da cena antiga ficariam duplicados no socket.
const GAME_EVENTS = [
  'playerJoined', 'playerLeft', 'playerMoved', 'playerAppearance', 'chat', 'tile', 'object',
  'egg', 'forage', 'monster', 'animals', 'building', 'inv', 'money', 'bin', 'quest', 'questDelivered',
  'time', 'err', 'sleepState', 'dayEnded', 'mapRefresh', 'disconnect', 'connect',
];

class GameScene extends Phaser.Scene {
  constructor(socket, data) {
    super('game');
    this.socket = socket;
    this.data0 = data;
  }

  // ---------------- assets ----------------
  preload() {
    const L = this.load;
    L.on('progress', (p) => loading(20 + p * 70, 'loading.assets')); // 20→90%
    L.spritesheet('grass', '/assets/grass.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('water', '/assets/water.png', { frameWidth: T, frameHeight: T });
    L.image('path', '/assets/path.png');
    L.spritesheet('tilled', '/assets/tilled.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('tilled_wet', '/assets/tilled_wet.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('crops', '/assets/crops_stages.png', { frameWidth: T, frameHeight: 32 });
    L.image('crop_dead', '/assets/crop_dead.png');
    L.image('tree', '/assets/tree.png');
    L.image('tree_birch', '/assets/tree_birch.png');
    L.image('stump', '/assets/stump.png');
    L.spritesheet('bushes', '/assets/bushes.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('fence', '/assets/fence.png', { frameWidth: T, frameHeight: T });
    L.image('well', '/assets/well.png');
    L.image('bench', '/assets/bench.png');
    L.image('anvil', '/assets/anvil.png');
    L.image('board', '/assets/board.png');
    L.image('store', '/assets/store.png');
    L.spritesheet('cave_floor', '/assets/cave_floor.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('beach', '/assets/beach.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('sand_decor', '/assets/sand_decor.png', { frameWidth: T, frameHeight: T });
    L.image('cavewall', '/assets/cavewall.png');
    L.image('mine_entrance', '/assets/mine_entrance.png');
    L.image('ladder', '/assets/ladder.png');
    L.image('interior_floor', '/assets/interior_floor.png');
    L.image('interior_wall', '/assets/interior_wall.png');
    L.image('bed', '/assets/bed.png');
    L.image('table', '/assets/table.png');
    L.image('rug', '/assets/rug.png');
    L.image('shelf', '/assets/shelf.png');
    L.image('chest', '/assets/chest.png');
    L.image('stone_wall', '/assets/stone_wall.png');
    for (const m of ['iron', 'copper', 'gold']) L.image(`ore_${m}`, `/assets/ore_${m}.png`);
    L.image('city_hall', '/assets/city_hall.png');
    L.image('city_house', '/assets/city_house.png');
    L.image('cabin_green', '/assets/cabin_green.png');
    L.image('cabin_dark', '/assets/cabin_dark.png');
    L.spritesheet('boat', '/assets/boat.png', { frameWidth: 48, frameHeight: 48 });
    L.image('hay', '/assets/hay.png');
    L.image('log_fallen', '/assets/log_fallen.png');
    L.image('coop', '/assets/coop.png');
    L.image('egg', '/assets/egg.png');
    L.image('forage_berry', '/assets/forage_berry.png');
    L.image('forage_mushroom', '/assets/forage_mushroom.png');
    L.image('forage_log', '/assets/forage_log.png');
    L.image('forage_wood', '/assets/forage_wood.png');
    L.image('forage_stone', '/assets/forage_stone.png');
    L.image('forage_iron', '/assets/forage_iron.png');
    L.image('forage_copper', '/assets/forage_copper.png');
    L.image('forage_gold', '/assets/forage_gold.png');
    for (const tl of ['hoe', 'can', 'axe', 'pickaxe']) L.image(`tool_${tl}`, `/assets/icons/tool_${tl}.png`);
    for (const wp of ['sword', 'spear', 'bow', 'shield']) L.image(`tool_${wp}`, `/assets/icons/tool_${wp}.png`);
    // Monstros da mina: 4 frames idle cada, mesmo padrão dos outros bichos (chicken etc).
    L.spritesheet('mob_slime_small', '/assets/mob_slime_small.png', { frameWidth: 16, frameHeight: 16 });
    L.spritesheet('mob_slime_medium', '/assets/mob_slime_medium.png', { frameWidth: 32, frameHeight: 32 });
    L.spritesheet('mob_slime_big', '/assets/mob_slime_big.png', { frameWidth: 64, frameHeight: 64 });
    L.spritesheet('mob_skeleton', '/assets/mob_skeleton.png', { frameWidth: 32, frameHeight: 32 });
    L.image('arrow', '/assets/icons/tool_bow.png'); // reaproveita o ícone do arco como "flecha" voando (simplificação do tiro à distância)
    L.spritesheet('chicken', '/assets/chicken.png', { frameWidth: 32, frameHeight: 32 });
    L.spritesheet('rock', '/assets/rock.png', { frameWidth: 32, frameHeight: 32 });
    L.image('bin', '/assets/bin.png');
    L.image('house', '/assets/house.png');
    L.image('shop', '/assets/shop.png');
    L.spritesheet('bob', '/assets/bob.png', { frameWidth: 64, frameHeight: 64 });
    L.image('cursor', '/assets/cursor.png');
    L.spritesheet('gtiles', '/assets/grass_tiles.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('dirt_fringe', '/assets/dirt_fringe.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('decor_grass', '/assets/decor_grass.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('decor_mushroom', '/assets/decor_mushroom.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('decor_cattail', '/assets/decor_cattail.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('decor_lily', '/assets/decor_lily.png', { frameWidth: T, frameHeight: T });
    L.spritesheet('butterfly', '/assets/butterfly.png', { frameWidth: T, frameHeight: T });

    L.spritesheet('p_base', '/assets/player/base.png', { frameWidth: 64, frameHeight: 64 });
    for (let s = 1; s <= 6; s++) for (const c of HAIR_COLORS)
      L.spritesheet(`p_hair_${s}_${c}`, `/assets/player/hair_${s}_${c}.png`, { frameWidth: 64, frameHeight: 64 });
    for (const c of OUTFIT_COLORS) {
      L.spritesheet(`p_shirt_${c}`, `/assets/player/shirt_${c}.png`, { frameWidth: 64, frameHeight: 64 });
      L.spritesheet(`p_pants_${c}`, `/assets/player/pants_${c}.png`, { frameWidth: 64, frameHeight: 64 });
    }
  }

  makeLayerAnims(key) {
    if (this.anims.exists(`${key}_idle_down`)) return;
    for (const [type, dirs] of Object.entries(ROWS)) {
      for (const [dir, row] of Object.entries(dirs)) {
        this.anims.create({
          key: `${key}_${type}_${dir}`,
          frames: this.anims.generateFrameNumbers(key, {
            start: row * SHEET_COLS, end: row * SHEET_COLS + FRAMES_PER[type] - 1,
          }),
          frameRate: type === 'act' ? 10 : 7,
          repeat: type === 'act' ? 0 : -1,
        });
      }
    }
  }

  // ---------------- criação ----------------
  create() {
    window.gvBoot = 'create';
    const d = this.data0;
    this.world = d.world;
    this.mapKey = d.map || 'overworld';
    this.entrances = d.world.entrances || [];
    this.interactables = d.world.interactables || [];
    this.crops = d.crops;
    this.recipes = d.recipes || {};
    this.weapons = d.weapons || {};
    this.tilesState = d.state.tiles;
    this.objectsState = d.state.objects;
    this.buildingsState = d.state.buildings || [];
    this.buildingDefs = d.world.buildingDefs || {};
    this.me = d.you.userId;
    this.players = new Map();       // userId -> {container, sprites, target, dir, anim, name}
    this.tileSprites = new Map();   // "x,y" -> {overlay, crop}
    this.objectSprites = new Map();

    this.hud = new Hud({
      sendChat: (txt) => this.socket.emit('chat', txt),
      build: (type) => this.enterBuildMode(type),
      eat: (item) => this.socket.emit('eat', { item }),
      buy: (crop, qty) => this.socket.emit('buy', { crop, qty }),
      buyAnimal: () => this.socket.emit('buyAnimal'),
      craft: (recipe) => this.socket.emit('craft', { recipe }),
      deliverQuest: () => this.socket.emit('deliverQuest'),
      sell: (item, qty) => this.socket.emit('sell', { item, qty }),
      cancelSleep: () => { this.socket.emit('sleep', false); this.hud.hideSleep(); },
      equip: (item) => this.socket.emit('equip', { item }),
    });
    this.hud.crops = this.crops;
    this.hud.buildingDefs = this.buildingDefs;
    this.hud.recipes = this.recipes;
    this.hud.setInv(d.you.inv);
    this.hud.setMoney(d.state.money);
    this.hud.setBin(d.state.bin);
    this.hud.setQuest(d.state.quest);
    this.serverTime = d.state.time;
    this.serverTimeAt = performance.now();
    this.hud.setTime(d.state);

    // anims compartilhadas (antes de spawnar qualquer objeto)
    this.anims.create({ key: 'water_flow', frames: this.anims.generateFrameNumbers('water', { start: 0, end: 7 }), frameRate: 4, repeat: -1 });
    this.anims.create({ key: 'bob_idle', frames: this.anims.generateFrameNumbers('bob', { start: 0, end: 5 }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: 'butterfly_fly', frames: this.anims.generateFrameNumbers('butterfly', { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'boat_bob', frames: this.anims.generateFrameNumbers('boat', { start: 0, end: 3 }), frameRate: 3, repeat: -1 });
    for (const key of ['mob_slime_small', 'mob_slime_medium', 'mob_slime_big', 'mob_skeleton']) {
      this.anims.create({ key: `${key}_idle`, frames: this.anims.generateFrameNumbers(key, { start: 0, end: 3 }), frameRate: 4, repeat: -1 });
    }
    // galinha: linha 0 idle (0-1), linha 1 anda p/ baixo (8-13), linha 2 lado (16-21), linha 3 cima (24-29)
    this.anims.create({ key: 'chicken_idle', frames: this.anims.generateFrameNumbers('chicken', { start: 0, end: 1 }), frameRate: 3, repeat: -1 });
    this.anims.create({ key: 'chicken_down', frames: this.anims.generateFrameNumbers('chicken', { start: 8, end: 13 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'chicken_side', frames: this.anims.generateFrameNumbers('chicken', { start: 16, end: 21 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'chicken_up', frames: this.anims.generateFrameNumbers('chicken', { start: 24, end: 29 }), frameRate: 8, repeat: -1 });
    for (const [key, rows] of [['decor_grass', 18], ['decor_mushroom', 8], ['decor_cattail', 5], ['decor_lily', 6]]) {
      for (let r = 0; r < rows; r++) {
        this.anims.create({ key: `${key}_${r}`, frames: this.anims.generateFrameNumbers(key, { start: r * 8, end: r * 8 + 7 }), frameRate: 6, repeat: -1 });
      }
    }

    this.buildGround();
    // decoração (tufos, borboletas, props) é coisa de overworld; mina/interior não têm.
    if (this.mapKey === 'overworld') this.buildDecor();
    else { this.propBlockers = new Set(); this.butterflies = []; }
    this.buildBuildings();
    this.buildEntrances();
    for (const [key, obj] of Object.entries(this.objectsState)) this.spawnObject(key, obj);
    for (const [key, tile] of Object.entries(this.tilesState)) this.updateTile(key, tile);

    // animais e ovos
    this.eggSprites = new Map();
    this.chickens = new Map();
    this.setEggs(d.state.eggs || {});
    this.setAnimals(d.state.animals || []);

    // forrageáveis (frutas/cogumelos/lenha)
    this.forageState = d.state.forage || {};
    this.forageSprites = new Map();
    for (const [key, f] of Object.entries(this.forageState)) this.setForage(key, f);

    // monstros da mina (parados — vida/hp resolvidos no servidor)
    this.monstersState = d.state.monsters || {};
    this.monsterSprites = new Map();
    for (const [id, m] of Object.entries(this.monstersState)) this.spawnMonster(id, m);

    this.waterSprites.forEach(s => s.play({ key: 'water_flow', startFrame: Phaser.Math.Between(0, 7) }));
    if (this.bob) this.bob.play('bob_idle');

    // jogadores
    for (const p of d.players) this.addPlayer(p);
    const meP = this.players.get(this.me);

    // aparência local
    const app = defaultAppearance(this.me);
    this.socket.emit('appearance', app);
    this.rebuildPlayerLayers(this.me, app);

    // câmera
    // Mapas menores que o viewport (interiores 11x8, salas da mina) não devem ficar
    // ancorados no canto superior-esquerdo com o resto da tela em branco — os bounds
    // do Phaser só "centralizam" quando o mapa preenche o viewport inteiro. Se o mapa é
    // menor que o viewport num eixo, os bounds desse eixo viram do TAMANHO do viewport
    // (deslocados pra sobrar metade de cada lado), então a câmera não tem margem pra
    // rolar e o mapa sempre aparece centralizado, parado — exatamente o efeito desejado
    // numa sala estática pequena. Mapas grandes (overworld/south/portovale) continuam
    // com o comportamento de sempre (bounds = mapa, segue o jogador).
    const zoom = Math.max(2, Math.min(4, Math.round(Math.min(window.innerWidth, window.innerHeight * 1.6) / 320)));
    const mapW = this.world.width * T, mapH = this.world.height * T;
    const viewW = window.innerWidth / zoom, viewH = window.innerHeight / zoom;
    const boundsW = Math.max(mapW, viewW), boundsX = mapW >= viewW ? 0 : (mapW - viewW) / 2;
    const boundsH = Math.max(mapH, viewH), boundsY = mapH >= viewH ? 0 : (mapH - viewH) / 2;
    this.cameras.main.setBounds(boundsX, boundsY, boundsW, boundsH);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.startFollow(meP.container, true, 0.15, 0.15);

    // tint noturno
    this.nightRect = this.add.rectangle(0, 0, 4000, 4000, 0x0a1030).setOrigin(0).setScrollFactor(0).setDepth(99999).setAlpha(0);

    // cursor de tile
    this.cursor = this.add.image(0, 0, 'cursor').setOrigin(0).setDepth(90000).setVisible(false);
    this.hintText = this.add.text(0, 0, '', {
      fontSize: '8px', fontFamily: 'sans-serif', color: '#fff',
      backgroundColor: 'rgba(0,0,0,.55)', padding: { x: 3, y: 2 }, resolution: 6,
    }).setOrigin(0.5, 1).setDepth(95000).setVisible(false);

    this.bindInput();
    this.bindSocket();
    window.gvScene = this; // handle para debug/testes
    this.moveAccum = 0;
    this.lastSent = { x: 0, y: 0, dir: '', anim: '' };

    // mundo pronto: completa a barra e esconde a tela de carregamento após o 1º frame
    loading(100, 'loading.ready');
    this.time.delayedCall(120, hideLoading);
  }

  buildGround() {
    const g = this.world.ground;
    const W_ = this.world.width, H_ = this.world.height;
    const at = (x, y, v) => x >= 0 && y >= 0 && x < W_ && y < H_ && g[y][x] === v;
    const rt = this.add.renderTexture(0, 0, W_ * T, H_ * T).setOrigin(0).setDepth(-10);
    const rimRt = this.add.renderTexture(0, 0, W_ * T, H_ * T).setOrigin(0).setDepth(-4);
    this.waterSprites = [];

    // Moldura do caminho: peças de franja MASCARADAS (só a banda de transição tem
    // pixels; o resto é transparente), então sobreposições em tiles finos/isolados
    // não se apagam. Frames de dirt_fringe: 0 n, 1 s, 2 w, 3 e, 4 nw, 5 ne, 6 sw, 7 se.
    const drawDirt = (x, y) => {
      const X = x * T, Y = y * T;
      rt.drawFrame('gtiles', 97, X, Y); // base de areia
      const n = !at(x, y - 1, 2) && !at(x, y - 1, 1), s = !at(x, y + 1, 2) && !at(x, y + 1, 1);
      const w = !at(x - 1, y, 2) && !at(x - 1, y, 1), e = !at(x + 1, y, 2) && !at(x + 1, y, 1);
      const nw = !at(x - 1, y - 1, 2) && !at(x - 1, y - 1, 1), ne = !at(x + 1, y - 1, 2) && !at(x + 1, y - 1, 1);
      const sw = !at(x - 1, y + 1, 2) && !at(x - 1, y + 1, 1), se = !at(x + 1, y + 1, 2) && !at(x + 1, y + 1, 1);
      if (n) rt.drawFrame('dirt_fringe', 0, X, Y);
      if (s) rt.drawFrame('dirt_fringe', 1, X, Y);
      if (w) rt.drawFrame('dirt_fringe', 2, X, Y);
      if (e) rt.drawFrame('dirt_fringe', 3, X, Y);
      // cantos externos (convexos) quando as duas bordas são grama;
      // cantos internos (côncavos) quando só a diagonal é grama.
      if (n && w) rt.drawFrame('dirt_fringe', 4, X, Y);
      else if (!n && !w && nw) rt.drawFrame('dirt_fringe', 8, X, Y);
      if (n && e) rt.drawFrame('dirt_fringe', 5, X, Y);
      else if (!n && !e && ne) rt.drawFrame('dirt_fringe', 9, X, Y);
      if (s && w) rt.drawFrame('dirt_fringe', 6, X, Y);
      else if (!s && !w && sw) rt.drawFrame('dirt_fringe', 10, X, Y);
      if (s && e) rt.drawFrame('dirt_fringe', 7, X, Y);
      else if (!s && !e && se) rt.drawFrame('dirt_fringe', 11, X, Y);
    };
    // Autotile da praia: para um tile de AREIA, escolhe o frame do blob (Beach_Tiles,
    // 30 col) conforme quais vizinhos são OCEANO (5) — foam suave na borda areia↔água.
    // idx = row*30+col; centro 31, bordas T1/B61/L30/R32, cantos convexos TL0/TR2/BL60/BR62,
    // notches côncavos (só a diagonal é oceano) NW34/NE33/SW4/SE3.
    const beachFrame = (x, y) => {
      const oc = (xx, yy) => at(xx, yy, 5);
      const n = oc(x, y - 1), s = oc(x, y + 1), w = oc(x - 1, y), e = oc(x + 1, y);
      if (n && w) return 0; if (n && e) return 2; if (s && w) return 60; if (s && e) return 62;
      if (n) return 1; if (s) return 61; if (w) return 30; if (e) return 32;
      if (oc(x - 1, y - 1)) return 34; if (oc(x + 1, y - 1)) return 33;
      if (oc(x - 1, y + 1)) return 4; if (oc(x + 1, y + 1)) return 3;
      return 31;
    };
    // borda do lago (buraco d'água no tileset: 0 TL, 1 T, 2 TR / 16 L, 17 água, 18 R / 32 BL, 33 B, 34 BR)
    const pondFrame = (x, y) => {
      const n = at(x, y - 1, 1), e = at(x + 1, y, 1), s = at(x, y + 1, 1), w = at(x - 1, y, 1);
      if (n && e && s && w) return 17;
      if (!n && !w) return 0;
      if (!n && !e) return 2;
      if (!s && !w) return 32;
      if (!s && !e) return 34;
      if (!n) return 1;
      if (!s) return 33;
      if (!w) return 16;
      if (!e) return 18;
      return 17;
    };

    for (let y = 0; y < H_; y++) {
      for (let x = 0; x < W_; x++) {
        const v = g[y][x];
        rt.drawFrame('grass', 0, x * T, y * T);
        if (v === 2) {
          drawDirt(x, y);
        } else if (v === 1) {
          this.waterSprites.push(this.add.sprite(x * T, y * T, 'water', 0).setOrigin(0).setDepth(-6));
          const f = pondFrame(x, y);
          if (f !== 17) rimRt.drawFrame('gtiles', f, x * T, y * T);
        } else if (v === 3) {
          rt.drawFrame('cave_floor', 0, x * T, y * T);
        } else if (v === 6) {
          rt.drawFrame('interior_floor', 0, x * T, y * T);
        } else if (v === 4) {
          // areia: frame do blob (foam suave voltada pro oceano)...
          const bf = beachFrame(x, y);
          rt.drawFrame('beach', bf, x * T, y * T);
          // areia interior ganha variação de textura (pedriscos) pra não ficar chapada
          if (bf === 31) {
            const h = (x * 73856093 ^ y * 19349663) >>> 0;
            if (h % 5 < 2) rt.drawFrame('sand_decor', h % 4, x * T, y * T);
          }
          // ...+ franja de grama (dirt_fringe) invadindo a areia = transição grama→areia suave
          const gN = at(x, y - 1, 0), gS = at(x, y + 1, 0), gW = at(x - 1, y, 0), gE = at(x + 1, y, 0);
          const gNW = at(x - 1, y - 1, 0), gNE = at(x + 1, y - 1, 0), gSW = at(x - 1, y + 1, 0), gSE = at(x + 1, y + 1, 0);
          if (gN) rt.drawFrame('dirt_fringe', 0, x * T, y * T);
          if (gS) rt.drawFrame('dirt_fringe', 1, x * T, y * T);
          if (gW) rt.drawFrame('dirt_fringe', 2, x * T, y * T);
          if (gE) rt.drawFrame('dirt_fringe', 3, x * T, y * T);
          if (gN && gW) rt.drawFrame('dirt_fringe', 4, x * T, y * T);
          else if (!gN && !gW && gNW) rt.drawFrame('dirt_fringe', 8, x * T, y * T);
          if (gN && gE) rt.drawFrame('dirt_fringe', 5, x * T, y * T);
          else if (!gN && !gE && gNE) rt.drawFrame('dirt_fringe', 9, x * T, y * T);
          if (gS && gW) rt.drawFrame('dirt_fringe', 6, x * T, y * T);
          else if (!gS && !gW && gSW) rt.drawFrame('dirt_fringe', 10, x * T, y * T);
          if (gS && gE) rt.drawFrame('dirt_fringe', 7, x * T, y * T);
          else if (!gS && !gE && gSE) rt.drawFrame('dirt_fringe', 11, x * T, y * T);
        } else if (v === 5) {
          // oceano da praia: água animada do lago; a foam da borda fica no tile de AREIA
          // vizinho (beachFrame), então aqui é só a água.
          this.waterSprites.push(this.add.sprite(x * T, y * T, 'water', 0).setOrigin(0).setDepth(-6));
        }
      }
    }
  }

  // Decoração determinística (mesma para todos os jogadores da fazenda)
  buildDecor() {
    let seed = (this.data0.farm.id * 2654435761) >>> 0;
    const rnd = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const g = this.world.ground;
    const W_ = this.world.width, H_ = this.world.height;
    // Espelha world.js (buildingVisual + coopYard) — decoração puramente cosmética
    // (tufos de grama, cogumelos, banco/feno/tronco) não pode "nascer" em cima de
    // prédios construídos pelo jogador nem no quintal do galinheiro (onde as
    // galinhas ciscam), senão parece brotar de dentro da construção.
    const nearBuilding = (x, y) => {
      if (this.world.buildings.some(b => x >= b.x - 1 && x < b.x + b.w + 1 && y >= b.y - 4 && y < b.y + b.h + 1)) return true;
      for (const b of this.buildingsState) {
        const vis = b.vis != null ? b.vis : 4;
        if (x >= b.x - 1 && x < b.x + b.w + 1 && y >= b.y - vis && y < b.y + b.h + 1) return true;
        if (b.type === 'coop' && x >= b.x - 1 && x < b.x + b.w + 1 && y >= b.y + b.h && y < b.y + b.h + 4) return true;
      }
      return false;
    };
    const grassTile = (x, y) => g[y][x] === 0 && !nearBuilding(x, y);

    // tufos de grama e flores espalhados
    for (let i = 0; i < 380; i++) {
      const x = Math.floor(rnd() * W_), y = Math.floor(rnd() * H_);
      if (!grassTile(x, y)) continue;
      const row = Math.floor(rnd() * 18);
      this.add.sprite(x * T, y * T, 'decor_grass', row * 8).setOrigin(0).setDepth(-5)
        .play({ key: `decor_grass_${row}`, startFrame: Math.floor(rnd() * 8) });
    }
    // cogumelos perto das bordas do mapa
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(rnd() * W_), y = Math.floor(rnd() * H_);
      if (!grassTile(x, y)) continue;
      if (x > 6 && x < W_ - 7 && y > 6 && y < H_ - 7) continue;
      const row = Math.floor(rnd() * 8);
      this.add.sprite(x * T, y * T, 'decor_mushroom', row * 8).setOrigin(0).setDepth(-5)
        .play({ key: `decor_mushroom_${row}`, startFrame: Math.floor(rnd() * 8) });
    }
    // taboas na margem do lago e vitórias-régias na água
    const waterTiles = [], rimTiles = [];
    for (let y = 1; y < H_ - 1; y++) for (let x = 1; x < W_ - 1; x++) {
      if (g[y][x] !== 1) continue;
      const edge = g[y - 1][x] !== 1 || g[y + 1][x] !== 1 || g[y][x - 1] !== 1 || g[y][x + 1] !== 1;
      (edge ? rimTiles : waterTiles).push([x, y]);
    }
    for (let i = 0; i < 10 && rimTiles.length; i++) {
      const [x, y] = rimTiles.splice(Math.floor(rnd() * rimTiles.length), 1)[0];
      const row = Math.floor(rnd() * 5);
      this.add.sprite(x * T, y * T, 'decor_cattail', row * 8).setOrigin(0).setDepth(y * T + T)
        .play({ key: `decor_cattail_${row}`, startFrame: Math.floor(rnd() * 8) });
    }
    for (let i = 0; i < 9 && waterTiles.length; i++) {
      const [x, y] = waterTiles.splice(Math.floor(rnd() * waterTiles.length), 1)[0];
      const row = Math.floor(rnd() * 6);
      this.add.sprite(x * T, y * T, 'decor_lily', row * 8).setOrigin(0).setDepth(-4)
        .play({ key: `decor_lily_${row}`, startFrame: Math.floor(rnd() * 8) });
    }
    // props decorativos (banco, feno, tronco caído) em pontos de grama livres
    // Props decorativos ocupam 2 tiles de largura na base (x,y)-(x+1,y); registra
    // essa base em propBlockers para o jogador não conseguir andar por cima deles.
    this.propBlockers = new Set();
    const placeProp = (key, tries) => {
      for (let k = 0; k < tries; k++) {
        const x = 2 + Math.floor(rnd() * (W_ - 4));
        const y = 2 + Math.floor(rnd() * (H_ - 4));
        if (grassTile(x, y) && grassTile(x + 1, y)) {
          this.add.image(x * T, y * T + T, key).setOrigin(0, 1).setDepth(y * T + T);
          this.propBlockers.add(`${x},${y}`);
          this.propBlockers.add(`${x + 1},${y}`);
          return;
        }
      }
    };
    for (let i = 0; i < 3; i++) placeProp('bench', 30);
    for (let i = 0; i < 5; i++) placeProp('hay', 30);
    for (let i = 0; i < 6; i++) placeProp('log_fallen', 30);

    // borboletas passeando
    this.butterflies = [];
    for (let i = 0; i < 4; i++) {
      const s = this.add.sprite(rnd() * W_ * T, rnd() * H_ * T, 'butterfly', 0).setDepth(5000).play('butterfly_fly');
      this.butterflies.push({ s, tx: rnd() * W_ * T, ty: rnd() * H_ * T, phase: rnd() * 6 });
    }
  }

  buildBuildings() {
    this.doors = {};
    for (const b of this.world.buildings) {
      const bx = b.x * T, by = (b.y + b.h) * T;
      // A profundidade usa a base VISUAL real (descontando padBottom), não o
      // ancoradouro completo do sprite — senão um jogador parado na faixa
      // transparente da base (colisão liberada) teria profundidade menor que
      // a da casa e renderizaria atrás dela, "sumindo" atrás da parede.
      const depth = ((b.y + b.h - (b.padBottom || 0)) * T) - 1;
      if (b.type === 'house') this.add.image(bx, by, 'house').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'shop') this.add.image(bx, by, 'shop').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'bin') this.add.image(bx + T / 2, by, 'bin').setOrigin(0.5, 1).setScale(1.4).setDepth(depth);
      else if (b.type === 'well') this.add.image(bx, by, 'well').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'coop') this.add.image(bx, by, 'coop').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'bench') this.add.image(bx + T / 2, by, 'anvil').setOrigin(0.5, 1).setScale(1.6).setDepth(depth);
      else if (b.type === 'board') this.add.image(bx + T / 2, by, 'board').setOrigin(0.5, 1).setScale(1.25).setDepth(depth);
      else if (b.type === 'store') this.add.image(bx, by, 'store').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'city_hall') this.add.image(bx, by, 'city_hall').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'city_house') this.add.image(bx, by, 'city_house').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'mine_entrance') this.add.image(bx, by, 'mine_entrance').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'cabin_green') this.add.image(bx, by, 'cabin_green').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'cabin_dark') this.add.image(bx, by, 'cabin_dark').setOrigin(0, 1).setDepth(depth);
      else if (b.type === 'boat') this.add.sprite(bx, by, 'boat', 0).setOrigin(0, 1).setDepth(depth).play('boat_bob');
      // casa/loja agora são ENTRADAS (viram tela de interior); só a caixa de venda
      // (bin) e bancada/quadro continuam como interação in-loco no overworld.
      if (b.door && b.type === 'bin') {
        this.doors[b.type] = { x: b.door[0], y: b.door[1] + 1 };
      } else if (b.type === 'bench') {
        this.doors.bench = { x: b.x, y: b.y + b.h };
      } else if (b.type === 'board') {
        this.doors.board = { x: b.x, y: b.y + b.h };
      }
    }
    this.npcBlockers = new Set();
    const shop = this.world.buildings.find(b => b.type === 'shop');
    if (shop) { // Bob só existe no overworld (mina/interior não têm a loja)
      const bobX = (shop.x + shop.w) * T - 8, bobY = (shop.y + shop.h) * T + 14;
      this.bob = this.add.sprite(bobX, bobY, 'bob').setOrigin(0.5, 0.8).setDepth(bobY);
      this.npcBlockers.add(`${Math.floor(bobX / T)},${Math.floor(bobY / T)}`);
    }

    // prédios construídos pelo jogador
    this.placedBuildings = new Map(); // id -> {sprite, b}
    for (const b of this.buildingsState) this.addBuilding(b);
  }

  // Escadas/entradas do mapa: sprite de escada nas telas de mina (a entrada da mina no
  // overworld já é o prédio mine_entrance). Registra os tiles pra interação (E → trocar).
  buildEntrances() {
    for (const e of this.entrances) {
      if (e.kind === 'ladder_up' || e.kind === 'ladder_down') {
        const [x, y] = e.at;
        this.add.image(x * T, y * T, 'ladder').setOrigin(0).setDepth(y * T + 2);
      } else if (e.kind === 'shortcut') {
        // Saída de atalho (a cada 5 níveis) — mesma escada, tingida de dourado pra se
        // diferenciar visualmente da escada normal (ladder_up/down).
        const [x, y] = e.at;
        this.add.image(x * T, y * T, 'ladder').setOrigin(0).setDepth(y * T + 2).setTint(0xffd76a);
      }
    }
    // Bob atrás do balcão da loja (interior 'shop') — posição vem do objeto 'counter' de
    // verdade (não do tile de interação, que fica na FRENTE do balcão pro jogador
    // clicar): Bob fica um tile ATRÁS dele (mais perto da parede de fundo). Depth com
    // bônus grande de propósito — senão o depth-sort por y competia com o balcão (que é
    // um sprite alto, ~2 tiles) e o Bob sumia atrás dele (reportado pelo usuário).
    if (this.mapKey === 'shop') {
      const counterKey = Object.keys(this.objectsState).find((k) => this.objectsState[k].type === 'counter');
      if (counterKey) {
        const [cx, cy] = counterKey.split(',').map(Number);
        const bx = cx * T + T * 1.5, by = cy * T;
        this.bob = this.add.sprite(bx, by, 'bob').setOrigin(0.5, 0.9).setDepth(by + 1000);
      }
    }
  }

  addBuilding(b) {
    if (this.placedBuildings.has(b.id)) return;
    const bx = b.x * T, by = (b.y + b.h) * T;
    const depth = ((b.y + b.h - (b.padBottom || 0)) * T) - 1;
    const sprite = this.add.image(bx, by, b.type).setOrigin(0, 1).setDepth(depth);
    this.placedBuildings.set(b.id, { sprite, b });
  }

  // ---------------- jogadores ----------------
  addPlayer(p) {
    if (this.players.has(p.userId)) this.removePlayer(p.userId);
    const container = this.add.container(p.x, p.y);
    container.setDepth(p.y);
    const label = this.add.text(0, -30, p.name, {
      fontSize: '8px', fontFamily: 'sans-serif', color: '#fff',
      stroke: '#000', strokeThickness: 2, resolution: 6,
    }).setOrigin(0.5, 1);
    container.add(label);
    const entry = {
      container, label, sprites: [], userId: p.userId, name: p.name,
      target: { x: p.x, y: p.y }, dir: p.dir || 'down', anim: p.anim || 'idle',
    };
    this.players.set(p.userId, entry);
    this.rebuildPlayerLayers(p.userId, p.appearance || defaultAppearance(p.userId));
    return entry;
  }

  rebuildPlayerLayers(userId, app) {
    const e = this.players.get(userId);
    if (!e) return;
    for (const s of e.sprites) s.destroy();
    e.sprites = [];
    const hair = Math.min(6, Math.max(1, app.hair || 1));
    const hc = HAIR_COLORS.includes(app.hairColor) ? app.hairColor : 'brown';
    const sc = OUTFIT_COLORS.includes(app.shirt) ? app.shirt : 'blue';
    const pc = OUTFIT_COLORS.includes(app.pants) ? app.pants : 'black';
    const keys = ['p_base', `p_pants_${pc}`, `p_shirt_${sc}`, `p_hair_${hair}_${hc}`];
    for (const key of keys) {
      if (!this.textures.exists(key)) continue;
      this.makeLayerAnims(key);
      // origem nos pés reais do personagem (y≈40/64) para colisão e profundidade baterem com o visual
      const s = this.add.sprite(0, 0, key, 0).setOrigin(0.5, 0.64);
      e.container.addAt(s, e.container.length - 1); // label fica por cima
      e.sprites.push(s);
    }
    this.playAnim(e, e.anim, e.dir);
  }

  playAnim(entry, anim, dir, once = false) {
    entry.anim = anim; entry.dir = dir;
    const flip = dir === 'left';
    const d = dir === 'left' ? 'right' : dir;
    entry.sprites.forEach((s, i) => {
      s.setFlipX(flip);
      const key = `${s.texture.key}_${anim}_${d}`;
      if (once) {
        s.play(key);
        // ao terminar a ação, volta para idle (senão o estado 'act' trava as animações)
        if (i === 0) s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (entry.anim === 'act') this.playAnim(entry, 'idle', entry.dir);
        });
      } else if (s.anims.currentAnim?.key !== key || !s.anims.isPlaying) {
        s.play(key);
      }
    });
  }

  removePlayer(userId) {
    const e = this.players.get(userId);
    if (!e) return;
    e.container.destroy();
    this.players.delete(userId);
  }

  // ---------------- mundo mutável ----------------
  spawnObject(key, obj) {
    this.despawnObject(key);
    const [x, y] = key.split(',').map(Number);
    const cx = x * T + T / 2, by = y * T + T;
    let sprite;
    if (obj.type === 'tree') {
      const birch = obj.variant === 'birch';
      sprite = this.add.image(cx, by, birch ? 'tree_birch' : 'tree').setOrigin(0.5, 1).setDepth(by);
    } else if (obj.type === 'rock') {
      sprite = this.add.sprite(cx, by, 'rock', 0).setOrigin(0.5, 1).setDepth(by);
    } else if (obj.type === 'bush') {
      sprite = this.add.image(cx, by, 'bushes', (x * 7 + y * 13) % 5).setOrigin(0.5, 1).setDepth(by);
    } else if (obj.type === 'stump') {
      sprite = this.add.image(cx, by, 'stump').setOrigin(0.5, 1).setDepth(by);
    } else if (obj.type === 'fence') {
      // frame por vizinhança (grade 4x4: postes/retas/cantos/T/cruz)
      const FENCE_MAP = [12, 8, 1, 13, 0, 4, 5, 9, 3, 15, 2, 14, 7, 11, 6, 10];
      const f = (xx, yy) => this.objectsState[`${xx},${yy}`]?.type === 'fence' ? 1 : 0;
      const mask = f(x, y - 1) | (f(x + 1, y) << 1) | (f(x, y + 1) << 2) | (f(x - 1, y) << 3);
      sprite = this.add.image(x * T, y * T, 'fence', FENCE_MAP[mask]).setOrigin(0).setDepth(by);
    } else if (obj.type === 'cavewall') {
      sprite = this.add.image(cx, by, 'cavewall').setOrigin(0.5, 1).setDepth(by);
    } else if (obj.type === 'stone_wall') {
      sprite = this.add.image(x * T, y * T, 'stone_wall').setOrigin(0).setDepth(by);
    } else if (obj.type === 'ore') {
      sprite = this.add.image(cx, by, `ore_${obj.mineral}`).setOrigin(0.5, 1).setDepth(by);
    } else if (obj.type === 'rug') {
      // decoração de chão (3x3) — depth fixo BAIXO (mesma faixa de decor_grass/mushroom),
      // nunca deve competir com jogador/móveis pelo depth-sort baseado em y.
      sprite = this.add.image(x * T, by, 'rug').setOrigin(0, 1).setDepth(-5);
    } else if (obj.type === 'wall') {
      sprite = this.add.image(x * T, y * T, 'interior_wall').setOrigin(0).setDepth(by);
    } else if (obj.type === 'bed') {
      sprite = this.add.image(x * T, by, 'bed').setOrigin(0, 1).setDepth(by); // sprite 32x32 (2 tiles)
    } else if (obj.type === 'table' || obj.type === 'counter') {
      sprite = this.add.image(x * T, by, 'table').setOrigin(0, 1).setDepth(by);
    } else if (obj.type === 'shelf') {
      sprite = this.add.image(x * T, by, 'shelf').setOrigin(0, 1).setDepth(by);
    } else if (obj.type === 'chest') {
      sprite = this.add.image(cx, by, 'chest').setOrigin(0.5, 1).setDepth(by);
    } else {
      sprite = this.add.image(cx, by, 'stump').setOrigin(0.5, 1).setDepth(by);
    }
    this.objectSprites.set(key, sprite);
  }

  despawnObject(key) {
    const s = this.objectSprites.get(key);
    if (s) { s.destroy(); this.objectSprites.delete(key); }
  }

  hitObject(key) {
    const s = this.objectSprites.get(key);
    if (!s) return;
    this.tweens.add({ targets: s, angle: { from: -6, to: 0 }, duration: 140, ease: 'Sine.out' });
  }

  // Ao surgir uma cerca nova (colocada por um jogador), os postes vizinhos já
  // desenhados precisam recalcular sua máscara de vizinhança pra "conectar" com ela.
  refreshFenceNeighbors(key) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const k = `${x + dx},${y + dy}`;
      const o = this.objectsState[k];
      if (o && o.type === 'fence') this.spawnObject(k, o);
    }
  }

  breakObject(key) {
    const s = this.objectSprites.get(key);
    if (!s) return;
    this.objectSprites.delete(key);
    this.tweens.add({
      targets: s, alpha: 0, scaleX: 0.6, scaleY: 0.4, y: s.y + 4, duration: 260,
      onComplete: () => s.destroy(),
    });
  }

  // ---------------- animais e ovos ----------------
  setEggs(eggs) {
    for (const key of [...this.eggSprites.keys()]) if (!eggs[key]) this.setEgg(key, null);
    for (const key of Object.keys(eggs)) if (!this.eggSprites.has(key)) this.setEgg(key, eggs[key]);
    this.eggsState = eggs;
  }

  setEgg(key, egg) {
    const cur = this.eggSprites.get(key);
    if (egg) {
      if (!cur) {
        const [x, y] = key.split(',').map(Number);
        const sp = this.add.image(x * T + T / 2, y * T + T - 3, 'egg').setOrigin(0.5, 1).setDepth(y * T + T - 2);
        this.tweens.add({ targets: sp, y: sp.y - 2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        this.eggSprites.set(key, sp);
      }
    } else if (cur) {
      cur.destroy();
      this.eggSprites.delete(key);
    }
  }

  setForage(key, f) {
    const cur = this.forageSprites.get(key);
    if (f) {
      if (!cur) {
        const [x, y] = key.split(',').map(Number);
        const sp = this.add.image(x * T + T / 2, y * T + T - 2, `forage_${f.type}`).setOrigin(0.5, 1).setDepth(y * T + T - 2);
        this.forageSprites.set(key, sp);
      }
    } else if (cur) {
      cur.destroy();
      this.forageSprites.delete(key);
    }
  }

  setForageAll(forage) {
    for (const key of [...this.forageSprites.keys()]) if (!forage[key]) this.setForage(key, null);
    for (const key of Object.keys(forage)) if (!this.forageSprites.has(key)) this.setForage(key, forage[key]);
    this.forageState = forage;
  }

  // ---------------- monstros da mina ----------------
  spawnMonster(id, m) {
    this.despawnMonster(id);
    const x = m.x * T + T / 2, by = m.y * T + T;
    const sprite = this.add.sprite(x, by, `mob_${m.type}`, 0).setOrigin(0.5, 1).setDepth(by).play(`mob_${m.type}_idle`);
    // barrinha de vida fina acima do monstro — só aparece quando ele já levou dano (cheia
    // = não polui a tela de bichos ilesos, igual ao resto do jogo não mostra HUD à toa).
    const barW = 16;
    const barBg = this.add.rectangle(x, by - sprite.displayHeight - 6, barW, 3, 0x1a1a1a).setDepth(by + 1).setVisible(m.hp < m.maxHp);
    const barFg = this.add.rectangle(x - barW / 2, by - sprite.displayHeight - 6, barW * (m.hp / m.maxHp), 3, 0xd8483c)
      .setOrigin(0, 0.5).setDepth(by + 2).setVisible(m.hp < m.maxHp);
    this.monsterSprites.set(id, { sprite, barBg, barFg, barW });
  }

  despawnMonster(id) {
    const e = this.monsterSprites.get(id);
    if (!e) return;
    e.sprite.destroy(); e.barBg.destroy(); e.barFg.destroy();
    this.monsterSprites.delete(id);
  }

  updateMonster(id, m) {
    if (!m) { this.despawnMonster(id); return; }
    const e = this.monsterSprites.get(id);
    if (!e) { this.spawnMonster(id, m); return; }
    const hurt = m.hp < m.maxHp;
    e.barBg.setVisible(hurt); e.barFg.setVisible(hurt);
    e.barFg.width = e.barW * Math.max(0, m.hp / m.maxHp);
    e.sprite.setTintFill(0xffffff);
    this.time.delayedCall(80, () => e.sprite.clearTint());
  }

  setAnimals(animals) {
    const ids = new Set(animals.map(a => a.id));
    for (const [id, c] of this.chickens) if (!ids.has(id)) { c.sprite.destroy(); this.chickens.delete(id); }
    for (const a of animals) {
      if (this.chickens.has(a.id)) continue;
      const sprite = this.add.sprite(a.hx, a.hy, 'chicken', 0).setOrigin(0.5, 0.85).setDepth(a.hy).play('chicken_idle');
      this.chickens.set(a.id, { sprite, hx: a.hx, hy: a.hy, tx: a.hx, ty: a.hy, wait: 0, dir: 'down' });
    }
  }

  updateChickens(dt) {
    if (!this.chickens) return;
    const now = this.time.now / 1000;
    for (const c of this.chickens.values()) {
      const dx = c.tx - c.sprite.x, dy = c.ty - c.sprite.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        c.wait -= dt;
        if (c.sprite.anims.currentAnim?.key !== 'chicken_idle') c.sprite.play('chicken_idle');
        if (c.wait <= 0) { // novo destino perto de casa
          c.tx = c.hx + (Math.random() - 0.5) * 40;
          c.ty = c.hy + (Math.random() - 0.5) * 32;
          c.wait = 1 + Math.random() * 3;
        }
      } else {
        const sp = 18;
        c.sprite.x += (dx / dist) * sp * dt;
        c.sprite.y += (dy / dist) * sp * dt;
        c.sprite.setDepth(c.sprite.y);
        const horiz = Math.abs(dx) > Math.abs(dy);
        const key = horiz ? 'chicken_side' : (dy < 0 ? 'chicken_up' : 'chicken_down');
        if (horiz) c.sprite.setFlipX(dx < 0);
        if (c.sprite.anims.currentAnim?.key !== key) c.sprite.play(key);
      }
    }
  }

  updateTile(key, tile) {
    if (tile) this.tilesState[key] = tile; else delete this.tilesState[key];
    const [x, y] = key.split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.refreshTile(x + dx, y + dy);
  }

  // Autotile do solo arado (blob completo de 8 vizinhos do FarmLand_Tile, derivado
  // por análise de pixels). Assinatura: bordas eN=1,eE=2,eS=4,eW=8 (vizinho sem terra)
  // + cantos internos côncavos nNE=16,nNW=32,nSE=64,nSW=128 (2 bordas conectam mas a
  // diagonal é grama). Fallback ignora os notches se a combinação não existir.
  tilledFrame(x, y) {
    const L = TILLED_BLOB;
    const on = (xx, yy) => { const t = this.tilesState[`${xx},${yy}`]; return !!(t && t.tilled); };
    const N = !on(x, y - 1), E = !on(x + 1, y), S = !on(x, y + 1), W = !on(x - 1, y);
    let key = (N ? 1 : 0) | (E ? 2 : 0) | (S ? 4 : 0) | (W ? 8 : 0);
    if (!N && !E && !on(x + 1, y - 1)) key |= 16;   // notch NE
    if (!N && !W && !on(x - 1, y - 1)) key |= 32;   // notch NW
    if (!S && !E && !on(x + 1, y + 1)) key |= 64;   // notch SE
    if (!S && !W && !on(x - 1, y + 1)) key |= 128;  // notch SW
    return L[key] !== undefined ? L[key] : (L[key & 15] !== undefined ? L[key & 15] : 9);
  }

  refreshTile(x, y) {
    const key = `${x},${y}`;
    const tile = this.tilesState[key];
    let entry = this.tileSprites.get(key);
    if (!entry) { entry = {}; this.tileSprites.set(key, entry); }

    // solo arado
    if (tile && tile.tilled) {
      const tex = tile.watered ? 'tilled_wet' : 'tilled';
      const frame = this.tilledFrame(x, y);
      if (!entry.overlay) entry.overlay = this.add.image(x * T, y * T, tex, frame).setOrigin(0).setDepth(-3);
      else entry.overlay.setTexture(tex, frame);
    } else if (entry.overlay) { entry.overlay.destroy(); entry.overlay = null; }

    // cultivo
    if (tile && tile.crop) {
      const frame = this.cropFrame(tile.crop);
      if (tile.crop.dead) {
        if (entry.crop) { if (entry.readyTween) { entry.readyTween.stop(); entry.readyTween = null; } entry.crop.destroy(); entry.crop = null; }
        if (!entry.dead) entry.dead = this.add.image(x * T, y * T - T, 'crop_dead').setOrigin(0).setDepth(y * T + T - 1);
      } else {
        if (entry.dead) { entry.dead.destroy(); entry.dead = null; }
        if (!entry.crop) entry.crop = this.add.image(x * T, y * T - T, 'crops', frame).setOrigin(0).setDepth(y * T + T - 1);
        else entry.crop.setFrame(frame);
        // pulinho + brilho quando pronto para colher, para o jogador saber que pode colher
        const ready = tile.crop.daysGrown >= this.crops[tile.crop.id].days;
        if (ready && !entry.readyTween) {
          entry.crop.setY(y * T - T);
          entry.readyTween = this.tweens.add({ targets: entry.crop, y: y * T - T - 2, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        } else if (!ready && entry.readyTween) {
          entry.readyTween.stop(); entry.readyTween = null; entry.crop.setY(y * T - T);
        }
      }
    } else {
      if (entry.crop) { if (entry.readyTween) { entry.readyTween.stop(); entry.readyTween = null; } entry.crop.destroy(); entry.crop = null; }
      if (entry.dead) { entry.dead.destroy(); entry.dead = null; }
    }
    if (!entry.overlay && !entry.crop && !entry.dead) this.tileSprites.delete(key);
  }

  cropFrame(crop) {
    const def = this.crops[crop.id];
    const idx = CROP_ORDER.indexOf(crop.id);
    let stage;
    if (crop.daysGrown >= def.days) stage = 3;
    else stage = Math.min(2, Math.floor((crop.daysGrown / def.days) * 4));
    return idx * 4 + stage;
  }

  rebuildAll(tiles, objects) {
    for (const key of [...this.tileSprites.keys()]) this.updateTile(key, null);
    this.tilesState = {};
    for (const [key, tile] of Object.entries(tiles)) this.updateTile(key, tile);
    this.tilesState = tiles;
    for (const key of [...this.objectSprites.keys()]) this.despawnObject(key);
    this.objectsState = objects;
    for (const [key, obj] of Object.entries(objects)) this.spawnObject(key, obj);
  }

  // ---------------- colisão ----------------
  blockedAt(px, py) {
    const x = Math.floor(px / T), y = Math.floor(py / T);
    if (x < 0 || y < 0 || x >= this.world.width || y >= this.world.height) return true;
    if (this.world.ground[y][x] === 1 || this.world.ground[y][x] === 5) return true; // água (lago/oceano)
    const hereObj = this.objectsState[`${x},${y}`];
    if (hereObj && hereObj.type !== 'rug') return true; // tapete é decoração de chão, não bloqueia
    // objetos maiores que 1x1 (mesa/balcão/cama/prateleira): procura uma âncora próxima
    // cuja pegada (OBJ_FOOTPRINT) cubra este tile, senão só o tile-âncora bloqueava.
    for (let ddx = -3; ddx <= 0; ddx++) {
      for (let ddy = -2; ddy <= 0; ddy++) {
        if (ddx === 0 && ddy === 0) continue; // já checado acima
        const ax = x + ddx, ay = y + ddy;
        const o = this.objectsState[`${ax},${ay}`];
        const fp = o && OBJ_FOOTPRINT[o.type];
        if (fp && x >= ax && x < ax + fp[0] && y > ay - fp[1] && y <= ay) return true;
      }
    }
    const key = `${x},${y}`;
    if (this.propBlockers && this.propBlockers.has(key)) return true;
    if (this.npcBlockers && this.npcBlockers.has(key)) return true;
    // colisão real do prédio: h reduzido pela margem transparente da base do sprite
    // (padBottom) — sem isso a colisão "sobra" além da parede visível.
    const inRect = (b) => {
      const h = b.h - (b.padBottom || 0);
      return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + h;
    };
    if (this.world.buildings.some(inRect)) return true;
    if (this.buildingsState.some(inRect)) return true;
    return false;
  }

  // Caixa de colisão pequena nos "pés" do jogador (container.y = pés), simétrica
  // nas quatro direções para o bloqueio parecer consistente perto de cercas/paredes.
  moveWithCollision(e, dx, dy) {
    const halfW = 5, footTop = -2, footBot = 3;
    if (dx !== 0) {
      const edge = e.container.x + dx + (dx > 0 ? halfW : -halfW);
      if (!this.blockedAt(edge, e.container.y + footTop) && !this.blockedAt(edge, e.container.y + footBot)) e.container.x += dx;
    }
    if (dy !== 0) {
      const edge = e.container.y + dy + (dy > 0 ? footBot : footTop);
      if (!this.blockedAt(e.container.x - halfW, edge) && !this.blockedAt(e.container.x + halfW, edge)) e.container.y += dy;
    }
  }

  // ---------------- input ----------------
  bindInput() {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard.addKeys({
      up: K.W, down: K.S, left: K.A, right: K.D,
      up2: K.UP, down2: K.DOWN, left2: K.LEFT, right2: K.RIGHT,
      interact: K.E, action: K.SPACE, chat: K.ENTER, esc: K.ESC,
    });
    this.input.keyboard.on('keydown', (ev) => {
      if (this.hud.chatFocused()) return;
      if (ev.key === 'Escape') { if (this.buildMode) { this.cancelBuild(); this.hud.toast(t('build.cancel')); } this.hud.closeModals(); return; }
      if (this.buildMode) return; // no modo construção, teclas de ação ficam inativas
      if (ev.key >= '1' && ev.key <= '9') this.hud.select(Number(ev.key) - 1);
      if (ev.key === 'Enter') { ev.preventDefault(); this.hud.focusChat(); }
      if (ev.key.toLowerCase() === 'e') this.tryInteract();
      if (ev.key === ' ') {
        const me = this.players.get(this.me);
        const fx = Math.floor(me.container.x / T) + (me.dir === 'left' ? -1 : me.dir === 'right' ? 1 : 0);
        const fy = Math.floor(me.container.y / T) + (me.dir === 'up' ? -1 : me.dir === 'down' ? 1 : 0);
        this.doAction(fx, fy);
      }
    });

    this.input.on('pointermove', (p) => {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.hoverTile = { x: Math.floor(wp.x / T), y: Math.floor(wp.y / T) };
    });
    this.input.on('pointerdown', (p) => {
      if (this.buildMode) {
        this.updateBuildMode();
        if (this.buildMode.valid) {
          this.socket.emit('build', { type: this.buildMode.type, x: this.buildMode.bx, y: this.buildMode.by });
          this.cancelBuild();
        } else {
          this.hud.toast(t('err.bad_spot'));
        }
        return;
      }
      if (this.hud.anyModalOpen() || this.hud.chatFocused()) return;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.doAction(Math.floor(wp.x / T), Math.floor(wp.y / T), wp.x, wp.y);
    });
  }

  inReach(tx, ty) {
    const me = this.players.get(this.me);
    const px = Math.floor(me.container.x / T), py = Math.floor(me.container.y / T);
    return Math.abs(tx - px) <= 2 && Math.abs(ty - py) <= 2;
  }

  // ---------------- construção ----------------
  enterBuildMode(type) {
    const def = this.buildingDefs[type];
    if (!def) return;
    // só dá pra construir no overworld (prédios ficam na fazenda, não dentro da loja)
    if (this.mapKey !== 'overworld') { this.hud.toast(t('build.outside')); this.hud.closeModals(); return; }
    this.hud.closeModals();
    this.cancelBuild();
    const ghost = this.add.image(0, 0, type).setOrigin(0, 1).setAlpha(0.7).setDepth(100000);
    this.buildMode = { type, def, ghost };
    this.hud.toast(t('build.place'), 3500);
  }

  cancelBuild() {
    if (this.buildMode) { this.buildMode.ghost.destroy(); this.buildMode = null; }
  }

  buildSpotValid(bx, by, def) {
    if (bx < 1 || by < 1 || bx + def.w > this.world.width - 1 || by + def.h > this.world.height - 1) return false;
    for (let y = by; y < by + def.h; y++) {
      for (let x = bx; x < bx + def.w; x++) {
        if (this.world.ground[y][x] !== 0) return false;
        if (this.objectsState[`${x},${y}`] || this.tilesState[`${x},${y}`]) return false;
        const inR = (b) => { const h = b.h - (b.padBottom || 0); return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + h; };
        if (this.world.buildings.some(inR) || this.buildingsState.some(inR)) return false;
      }
    }
    // folga em relação a outros prédios (espelha a validação do servidor —
    // evita telhados/paredes se sobrepondo visualmente entre construções vizinhas)
    const vis = def.vis != null ? def.vis : 4;
    const sidePad = 1;
    const nx0 = bx - sidePad, nx1 = bx + def.w + sidePad;
    const ny0 = by - vis, ny1 = by + def.h + sidePad;
    for (const ob of [...this.world.buildings, ...this.buildingsState]) {
      const ovis = ob.vis != null ? ob.vis : 4;
      const ex0 = ob.x - sidePad, ex1 = ob.x + ob.w + sidePad;
      const ey0 = ob.y - ovis, ey1 = ob.y + ob.h + sidePad;
      if (nx0 < ex1 && nx1 > ex0 && ny0 < ey1 && ny1 > ey0) return false;
    }
    return true;
  }

  updateBuildMode() {
    if (!this.buildMode || !this.hoverTile) return;
    const { def, ghost } = this.buildMode;
    const bx = this.hoverTile.x, by = this.hoverTile.y;
    ghost.setPosition(bx * T, (by + def.h) * T).setDepth(100000);
    const ok = this.buildSpotValid(bx, by, def);
    ghost.setTint(ok ? 0x88ff88 : 0xff8888);
    this.buildMode.valid = ok; this.buildMode.bx = bx; this.buildMode.by = by;
  }

  // Acha um monstro no tile exato (mira direta, tecla de ação) ou dentro do retângulo do
  // sprite (clique do mouse, igual à retargeting de árvore/pedra).
  findMonsterAt(tx, ty) {
    for (const [id, m] of Object.entries(this.monstersState)) if (m.x === tx && m.y === ty) return id;
    return null;
  }
  findMonsterNear(worldX, worldY) {
    for (const [id, e] of this.monsterSprites) if (e.sprite.getBounds().contains(worldX, worldY)) return id;
    return null;
  }

  // Atira uma "flecha" simples (tween reto até o alvo) — simplificação do tiro à
  // distância: sem física de projétil de verdade, o servidor já resolve o acerto na hora.
  showArrow(me, mon) {
    const from = { x: me.container.x, y: me.container.y - 10 };
    const to = { x: mon.x * T + T / 2, y: mon.y * T + T / 2 };
    const arrow = this.add.image(from.x, from.y, 'arrow').setScale(0.4).setDepth(99998)
      .setRotation(Math.atan2(to.y - from.y, to.x - from.x));
    this.tweens.add({ targets: arrow, x: to.x, y: to.y, duration: 160, onComplete: () => arrow.destroy() });
  }

  doAction(tx, ty, worldX, worldY) {
    // Ataque em monstro tem prioridade se uma arma ofensiva tá selecionada (escudo não
    // ataca, só bloqueia — resolvido passivamente no servidor via 'equip').
    const selected = this.hud.selectedItem();
    if (selected && WEAPONS.includes(selected.id) && selected.id !== 'shield') {
      let monsterId = this.findMonsterAt(tx, ty);
      if (!monsterId && worldX !== undefined) monsterId = this.findMonsterNear(worldX, worldY);
      if (monsterId) {
        const mon = this.monstersState[monsterId];
        const me = this.players.get(this.me);
        const px = me.container.x / T, py = me.container.y / T;
        const range = (this.weapons[selected.id] && this.weapons[selected.id].range) || 1.5;
        if (Math.hypot(px - mon.x, py - mon.y) > range + 0.6) { this.hud.toast(t('err.out_of_range')); return; }
        const dxT = mon.x - Math.floor(me.container.x / T), dyT = mon.y - Math.floor(me.container.y / T);
        me.dir = Math.abs(dxT) >= Math.abs(dyT) ? (dxT >= 0 ? 'right' : 'left') : (dyT > 0 ? 'down' : 'up');
        this.socket.emit('action', { type: 'attack', monsterId, weapon: selected.id });
        this.playAnim(me, 'act', me.dir, true);
        this.showToolSwing(me, selected.id);
        if (selected.id === 'bow') this.showArrow(me, mon);
        return;
      }
    }
    let key = `${tx},${ty}`;
    let obj = this.objectsState[key];
    // Prioridade: se o tile clicado já é acionável por si só (objeto, solo arado,
    // cultivo ou ovo), age nele direto. Só quando o tile clicado é "vazio" (grama)
    // é que redirecionamos para um sprite que se sobrepõe a partir de baixo
    // (copa de árvore / folhas de um cultivo) — evita agir no tile de baixo por engano.
    const hereTile = this.tilesState[key];
    const hereActionable = obj || (hereTile && (hereTile.crop || hereTile.tilled))
      || (this.eggsState && this.eggsState[key]) || (this.forageState && this.forageState[key]);
    if (!hereActionable && worldX !== undefined) {
      // árvores/pedras/arbustos pelo retângulo do sprite — quando MAIS de um sprite
      // sobrepõe o ponto clicado (copa de árvore encostando numa pedra vizinha, por
      // exemplo), pega o mais PRÓXIMO do clique, não só o primeiro da iteração (senão
      // um clique visualmente em cima da pedra podia acabar mirando a árvore do lado).
      let best = null, bestDist = Infinity;
      for (const [k, sprite] of this.objectSprites) {
        const b = sprite.getBounds();
        if (!b.contains(worldX, worldY)) continue;
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        const dist = Math.hypot(worldX - cx, worldY - cy);
        if (dist < bestDist) { bestDist = dist; best = k; }
      }
      if (best) {
        const [ox, oy] = best.split(',').map(Number);
        if (this.inReach(ox, oy)) { key = best; obj = this.objectsState[best]; tx = ox; ty = oy; }
      }
      // cultivo cujo sprite sobe para o tile clicado → mira a raiz dele
      if (!obj) {
        for (const [k, entry] of this.tileSprites) {
          if (entry.crop && entry.crop.getBounds().contains(worldX, worldY)) {
            const [cx, cy] = k.split(',').map(Number);
            if (this.inReach(cx, cy)) { key = k; tx = cx; ty = cy; }
            break;
          }
        }
      }
    }
    // ovo ou forrageável: pegar sem ferramenta nem energia (prioridade máxima)
    if (((this.eggsState && this.eggsState[key]) || (this.forageState && this.forageState[key])) && this.inReach(tx, ty)) {
      this.socket.emit('action', { type: 'collect', x: tx, y: ty });
      return;
    }
    if (!this.inReach(tx, ty)) return;
    const me = this.players.get(this.me);
    const tile = this.tilesState[key];
    const item = this.hud.selectedItem();
    const ground = this.world.ground[ty] && this.world.ground[ty][tx];

    // vira para o alvo
    const dxT = tx - Math.floor(me.container.x / T), dyT = ty - Math.floor(me.container.y / T);
    if (Math.abs(dxT) >= Math.abs(dyT)) me.dir = dxT >= 0 ? (dxT === 0 ? me.dir : 'right') : 'left';
    else me.dir = dyT > 0 ? 'down' : 'up';

    let type = null, extra = {};
    // Lista de permissão (não de bloqueio): só árvore/arbusto/toco (corta) e pedra/
    // minério (minera) tentam virar chop/mine — antes era "qualquer objeto que não seja
    // fence/cavewall", uma lista de BLOQUEIO frágil que esquecia de excluir cada
    // fixture nova (deu pra clicar na parede de pedra da Pedreira, por exemplo, e cair
    // nesse branch por engano).
    const choppable = obj && (obj.type === 'tree' || obj.type === 'bush' || obj.type === 'stump');
    const mineable = obj && (obj.type === 'rock' || obj.type === 'ore');
    if (choppable || mineable) {
      // exige a ferramenta certa: machado para madeira, picareta para pedra/minério
      const needed = mineable ? 'pickaxe' : 'axe';
      if (!item || item.id !== needed) { this.hud.toast(t('err.wrong_tool')); return; }
      type = mineable ? 'mine' : 'chop';
    } else if (tile && tile.crop) {
      const ready = tile.crop.dead || tile.crop.daysGrown >= this.crops[tile.crop.id].days;
      if (ready) type = 'harvest';
      else if (item && item.id === 'can') type = 'water';
    } else if (item && item.id === 'hoe') type = 'till';
    else if (item && item.id === 'can') type = 'water';
    else if (item && item.id.startsWith('seed_')) { type = 'plant'; extra.crop = item.id.slice(5); }
    else if (item && item.id === 'fence' && !obj && ground === 0) { type = 'place'; extra.item = 'fence'; }

    if (!type) return;
    if (type === 'water' && ground !== 1 && (!tile || !tile.tilled)) return;
    if (type === 'place' && tile) return;
    this.socket.emit('action', { type, x: tx, y: ty, ...extra });
    this.playAnim(me, 'act', me.dir, true);
    // ferramenta na mão dando o golpe (machado, picareta, enxada, regador)
    const toolFor = { chop: 'axe', mine: 'pickaxe', till: 'hoe', water: 'can', plant: null, harvest: null };
    this.showToolSwing(me, toolFor[type]);
    if (type === 'harvest') this.popHarvest(key);
    this.sendMove(true);
  }

  // Efeito de colheita: o cultivo "pula" e some, deixando claro que foi colhido
  popHarvest(key) {
    const entry = this.tileSprites.get(key);
    if (!entry || !entry.crop) return;
    const sp = entry.crop;
    if (entry.readyTween) { entry.readyTween.stop(); entry.readyTween = null; }
    entry.crop = null; // desacopla para o updateTile do servidor não mexer nele
    this.tweens.add({
      targets: sp, y: sp.y - 12, alpha: 0, scaleX: 1.25, scaleY: 1.25,
      duration: 340, ease: 'Quad.out', onComplete: () => sp.destroy(),
    });
  }

  // Sprite de ferramenta que aparece na mão e dá um golpe curto na direção da ação
  showToolSwing(entry, toolId) {
    if (!toolId || !this.textures.exists(`tool_${toolId}`)) return;
    const dir = entry.dir;
    const off = { down: [5, -16], up: [-5, -24], left: [-10, -20], right: [10, -20] }[dir] || [8, -20];
    const t = this.add.image(entry.container.x + off[0], entry.container.y + off[1], `tool_${toolId}`)
      .setScale(0.5).setDepth(entry.container.y + 1);
    const flip = dir === 'left';
    t.setFlipX(flip);
    const base = flip ? 20 : -20;
    t.setAngle(base - (flip ? -40 : 40));
    this.tweens.add({
      targets: t, angle: base + (flip ? -30 : 30), duration: 200, ease: 'Quad.in',
      onComplete: () => this.tweens.add({ targets: t, alpha: 0, duration: 120, onComplete: () => t.destroy() }),
    });
  }

  tryInteract() {
    const me = this.players.get(this.me);
    const px = Math.floor(me.container.x / T), py = Math.floor(me.container.y / T);
    // entrada de tela (mina/escada/porta) tem prioridade. Porta exige alinhamento exato
    // na coluna (tem que estar literalmente EM FRENTE, não do lado) — mina/escada/borda
    // continuam com folga de 1 tile (vãos maiores, sem essa exigência de "de frente").
    for (const e of this.entrances) {
      const tolX = e.kind === 'door' ? 0 : 1;
      if (Math.abs(px - e.at[0]) <= tolX && Math.abs(py - e.at[1]) <= 1) { this.socket.emit('enterMap'); return; }
    }
    // móveis interativos de interior (cama = dormir, balcão = loja)
    for (const it of this.interactables) {
      if (Math.abs(px - it.at[0]) <= 1 && Math.abs(py - it.at[1]) <= 1) {
        if (it.kind === 'bed') { this.socket.emit('sleep', true); this.hud.showSleep([]); }
        else if (it.kind === 'counter') this.hud.openShop();
        return;
      }
    }
    const near = (d) => d && Math.abs(px - d.x) <= 1 && Math.abs(py - d.y) <= 1;
    if (near(this.doors.bin)) this.hud.openBin();
    else if (near(this.doors.bench)) this.hud.openCraft();
    else if (near(this.doors.board)) this.hud.openQuest();
  }

  // ---------------- rede ----------------
  bindSocket() {
    const s = this.socket;
    GAME_EVENTS.forEach(ev => s.off(ev)); // evita handlers duplicados ao trocar de tela
    s.on('playerJoined', (p) => { this.addPlayer(p); this.hud.addChat('☀', `${p.name} ➜`); });
    s.on('playerLeft', ({ userId }) => this.removePlayer(userId));
    s.on('playerMoved', (m) => {
      const e = this.players.get(m.userId);
      if (!e) return;
      e.target = { x: m.x, y: m.y };
      e.pendingDir = m.dir;
      if (m.anim === 'act' && e.anim !== 'act') this.playAnim(e, 'act', m.dir, true);
    });
    s.on('playerAppearance', ({ userId, appearance }) => this.rebuildPlayerLayers(userId, appearance));
    s.on('chat', ({ name, text }) => this.hud.addChat(name, text));
    s.on('tile', ({ key, tile }) => this.updateTile(key, tile));
    s.on('object', ({ key, obj }) => {
      if (obj) {
        this.objectsState[key] = obj;
        if (this.objectSprites.has(key)) this.hitObject(key);
        else {
          this.spawnObject(key, obj);
          if (obj.type === 'fence') this.refreshFenceNeighbors(key);
        }
      } else { delete this.objectsState[key]; this.breakObject(key); }
    });
    s.on('egg', ({ key, egg }) => { if (egg) this.eggsState[key] = egg; else delete this.eggsState[key]; this.setEgg(key, egg); });
    s.on('forage', ({ key, item }) => { if (item) this.forageState[key] = item; else delete this.forageState[key]; this.setForage(key, item); });
    s.on('monster', ({ id, monster }) => { if (monster) this.monstersState[id] = monster; else delete this.monstersState[id]; this.updateMonster(id, monster); });
    s.on('animals', ({ animals }) => this.setAnimals(animals));
    s.on('building', ({ building }) => {
      this.buildingsState.push(building);
      this.addBuilding(building);
      this.hud.toast(t('build.placed'));
    });
    s.on('inv', (inv) => this.hud.setInv(inv));
    s.on('money', ({ money }) => this.hud.setMoney(money));
    s.on('bin', ({ bin }) => this.hud.setBin(bin));
    s.on('quest', ({ quest }) => this.hud.setQuest(quest));
    s.on('questDelivered', ({ name, item, qty, reward }) => {
      this.hud.addChat('📋', t('quest.deliveredChat', { name, qty, item: itemName(item), reward }));
    });
    s.on('time', (data) => {
      this.serverTime = data.time; this.serverTimeAt = performance.now();
      this.hud.setTime(data);
    });
    s.on('err', ({ code }) => this.hud.toast(t('err.' + code)));
    s.on('sleepState', ({ userId, sleeping, waiting }) => {
      const overlayOpen = document.getElementById('sleep-overlay').style.display === 'flex';
      if (userId === this.me && !sleeping) this.hud.hideSleep();
      else if (overlayOpen) this.hud.showSleep(waiting);
    });
    s.on('dayEnded', (d) => {
      // só resumo/relógio/dinheiro (o mundo em si vem no 'mapRefresh', só pra quem está no overworld)
      this.serverTime = d.time; this.serverTimeAt = performance.now();
      this.hud.setTime(d);
      this.hud.setMoney(d.money);
      this.hud.setBin([]);
      this.hud.showDaySummary(d);
    });
    s.on('mapRefresh', (d) => {
      this.rebuildAll(d.tiles, d.objects);
      if (d.eggs) this.setEggs(d.eggs);
      if (d.forage) this.setForageAll(d.forage);
    });
    // Queda de conexão (comum no plano grátis do Render) — o socket.io tenta reconectar
    // sozinho, e o servidor reenvia 'joined' quando reconecta (o handler já registrado em
    // startGame() reconstrói a cena inteira). Mensagem só avisa que está reconectando; se
    // realmente reconectar, confirma. Não é um erro definitivo, então o texto não assusta.
    s.on('disconnect', () => { this._wasDisconnected = true; this.hud.toast(t('err.reconnecting'), 6000); });
    s.on('connect', () => {
      if (this._wasDisconnected) { this._wasDisconnected = false; this.hud.toast(t('err.reconnected')); }
    });
  }

  sendMove(force) {
    const me = this.players.get(this.me);
    const data = {
      x: Math.round(me.container.x * 10) / 10, y: Math.round(me.container.y * 10) / 10,
      dir: me.dir, anim: me.anim,
    };
    const l = this.lastSent;
    if (force || l.x !== data.x || l.y !== data.y || l.dir !== data.dir || l.anim !== data.anim) {
      this.socket.emit('move', data);
      this.lastSent = data;
    }
  }

  // ---------------- loop ----------------
  update(_, deltaMs) {
    const me = this.players.get(this.me);
    if (!me) return;
    const dt = deltaMs / 1000;

    // movimento local
    if (!this.hud.chatFocused() && !this.hud.anyModalOpen()) {
      const k = this.keys;
      let dx = (k.left.isDown || k.left2.isDown ? -1 : 0) + (k.right.isDown || k.right2.isDown ? 1 : 0);
      let dy = (k.up.isDown || k.up2.isDown ? -1 : 0) + (k.down.isDown || k.down2.isDown ? 1 : 0);
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        this.moveWithCollision(me, (dx / len) * SPEED * dt, (dy / len) * SPEED * dt);
        me.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : dx > 0 ? 'right' : me.dir) : (dy < 0 ? 'up' : 'down');
        if (me.anim !== 'act') this.playAnim(me, 'walk', me.dir);
      } else if (me.anim === 'walk') {
        this.playAnim(me, 'idle', me.dir);
      }
      me.container.setDepth(me.container.y);
    }

    // Travessia de borda do mapa (edge_*) dispara sozinha ao encostar — diferente de
    // porta/escada/mina, que continuam exigindo E (tela cheia de conteúdo, o jogador
    // pode só estar passando perto sem querer entrar). `_enteringMap` evita reemitir a
    // cada frame enquanto o servidor ainda não respondeu com o novo mapa.
    if (!this._enteringMap) {
      const px = Math.floor(me.container.x / T), py = Math.floor(me.container.y / T);
      for (const e of this.entrances) {
        if (e.kind.startsWith('edge_') && Math.abs(px - e.at[0]) <= 1 && Math.abs(py - e.at[1]) <= 1) {
          this._enteringMap = true;
          this.socket.emit('enterMap');
          break;
        }
      }
    }

    // envio de posição (10 Hz)
    this.moveAccum += deltaMs;
    if (this.moveAccum >= 100) { this.moveAccum = 0; this.sendMove(false); }

    // interpolação dos remotos
    for (const e of this.players.values()) {
      if (e.userId === this.me) continue;
      const dx = e.target.x - e.container.x, dy = e.target.y - e.container.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 60) { e.container.setPosition(e.target.x, e.target.y); }
      else if (dist > 0.5) {
        e.container.x += dx * 0.18;
        e.container.y += dy * 0.18;
        if (e.anim !== 'act') this.playAnim(e, 'walk', e.pendingDir || e.dir);
      } else if (e.anim === 'walk') {
        this.playAnim(e, 'idle', e.pendingDir || e.dir);
      }
      e.container.setDepth(e.container.y);
    }

    // modo construção: fantasma segue o cursor
    if (this.buildMode) {
      this.updateBuildMode();
      this.cursor.setVisible(false);
    } else if (this.hoverTile && this.inReach(this.hoverTile.x, this.hoverTile.y)) {
      // cursor de tile
      this.cursor.setVisible(true).setPosition(this.hoverTile.x * T, this.hoverTile.y * T);
    } else this.cursor.setVisible(false);

    // dica de interação
    const px = Math.floor(me.container.x / T), py = Math.floor(me.container.y / T);
    let hint = null;
    for (const e of this.entrances) {
      if (Math.abs(px - e.at[0]) <= 1 && Math.abs(py - e.at[1]) <= 1) {
        hint = t(`interact.${e.kind === 'ladder_up' ? 'up' : e.kind === 'ladder_down' ? 'down' : e.kind === 'shortcut' ? 'shortcut' : 'enter'}`);
        break;
      }
    }
    if (!hint) for (const it of this.interactables) {
      if (Math.abs(px - it.at[0]) <= 1 && Math.abs(py - it.at[1]) <= 1) {
        hint = t(`interact.${it.kind === 'bed' ? 'sleep' : 'shop'}`);
        break;
      }
    }
    if (!hint) for (const [type, d] of Object.entries(this.doors)) {
      if (Math.abs(px - d.x) <= 1 && Math.abs(py - d.y) <= 1) {
        hint = t(`interact.${type === 'house' ? 'sleep' : type}`);
        break;
      }
    }
    if (hint) this.hintText.setVisible(true).setText(hint).setPosition(me.container.x, me.container.y - 34);
    else this.hintText.setVisible(false);

    this.updateChickens(dt);

    // borboletas passeando
    const now = this.time.now / 1000;
    for (const b of this.butterflies || []) {
      const bdx = b.tx - b.s.x, bdy = b.ty - b.s.y;
      const d = Math.hypot(bdx, bdy);
      if (d < 8) {
        b.tx = Phaser.Math.Between(16, (this.world.width - 2) * T);
        b.ty = Phaser.Math.Between(16, (this.world.height - 2) * T);
      } else {
        b.s.x += (bdx / d) * 22 * dt;
        b.s.y += (bdy / d) * 22 * dt + Math.sin(now * 5 + b.phase) * 0.25;
        b.s.setFlipX(bdx < 0);
      }
    }

    // relógio local previsto + noite
    const mins = this.serverTime + ((performance.now() - this.serverTimeAt) / 1000) * (1200 / 900);
    if (Math.floor(mins) !== Math.floor(this.hud.state.time)) {
      this.hud.setTime({ ...this.hud.state, time: mins });
    }
    const h = mins / 60;
    let dark = 0;
    if (h >= 17 && h < 20) dark = ((h - 17) / 3) * 0.35;
    else if (h >= 20) dark = 0.35 + Math.min(1, (h - 20) / 6) * 0.25;
    this.nightRect.setAlpha(dark);
  }
}
