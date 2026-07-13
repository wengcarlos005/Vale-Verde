// Geração do mapa: fazenda (x0-59) + vila (x60-91) + Porto Vale, cidade grande e
// litorânea (x92-149) na faixa norte; mina (x25-64,y60-77) e praia (x100-149,y60-79)
// na faixa sul, ligadas por uma bifurcação que sai perto da praça da vila. Tudo num
// único mundo/room (sem troca de mapa) — mesmo padrão da fazenda→vila, só cresce
// WIDTH/HEIGHT e pinta a região nova.
// Ground: 0 grama, 1 água (lago), 2 estrada, 3 chão de caverna, 4 areia, 5 água (oceano).
// Objetos (árvore/pedra/minério/parede de caverna) são mutáveis e vivem no estado.
const WIDTH = 150;
const HEIGHT = 80;
const TILE = 16;

const { ORE_SPAWN } = require('./crops');

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Prédios FIXOS iniciais: rect = base com colisão (sprite desenhado acima, alinhado
// pela borda inferior). door = tile de interação (na borda de baixo). padBottom =
// linhas de tile transparentes na base do PNG (medido por pixel) que NÃO devem
// bloquear — sem isso a colisão "sobra" além da parede visível e o jogador é
// barrado num tile de grama normal na frente da porta.
const BUILDINGS = [
  { type: 'house', x: 6,  y: 6, w: 9, h: 4, padBottom: 1, door: [10, 9] },  // dormir (sprite 144x128)
  { type: 'shop',  x: 22, y: 6, w: 6, h: 4, padBottom: 1, door: [24, 9] },  // loja do Bob (sprite 96x128)
  { type: 'bin',   x: 16, y: 10, w: 1, h: 1, door: [16, 10] }, // caixa de venda
  { type: 'well',  x: 13, y: 13, w: 2, h: 1 },                 // decorativo (sprite 32x48)
  { type: 'bench', x: 10, y: 12, w: 1, h: 1 },                 // bancada de fabricação, perto da casa
  // vila (praça a leste, ligada por estrada) — quadro de recados morou pra lá.
  { type: 'store', x: 79, y: 6, w: 9, h: 4, padBottom: 1 },    // casa de pedra, decorativa por ora (sprite 144x128)
  { type: 'board', x: 83, y: 15, w: 1, h: 1 },                 // quadro de recados, na praça da vila
  // Porto Vale (cidade grande e litorânea, fim da estrada leste) — decorativas por ora.
  { type: 'city_hall',  x: 108, y: 5, w: 9, h: 4, padBottom: 1 }, // calcário bege (sprite 144x128)
  { type: 'city_house', x: 122, y: 6, w: 7, h: 3, padBottom: 1 }, // madeira verde (sprite 112x96)
  // Mina — arco esculpido na rocha, puramente decorativo (h todo virou padBottom: o
  // jogador tem que poder atravessar o vão andando, não é uma porta/parede de verdade).
  { type: 'mine_entrance', x: 44, y: 57, w: 3, h: 3, padBottom: 3 },
];

// Prédios CONSTRUÍVEIS pelo jogador (comprados com materiais e posicionados).
// h = tiles da base com colisão; vis = quantos tiles o sprite sobe acima da base.
const BUILDING_DEFS = {
  coop: { w: 5, h: 2, vis: 6, door: [2, 2], cost: { wood: 30, stone: 10, money: 0 } },
};

// Quintal em frente a um galinheiro (onde galinhas ciscam e ovos aparecem)
function coopYard(b) {
  return { x: b.x - 1, y: b.y + b.h, w: b.w + 2, h: 4 };
}

// Retângulo de colisão real de um prédio (h reduzido pela margem transparente
// da base do sprite, ver comentário de `padBottom` acima).
function collisionRect(b) {
  return { x: b.x, y: b.y, w: b.w, h: b.h - (b.padBottom || 0) };
}

// Área visual de um prédio (sprite sobe `vis` tiles acima da base)
function buildingVisual(b, x, y) {
  const vis = b.vis != null ? b.vis : 4;
  return x >= b.x - 1 && x < b.x + b.w + 1 && y >= b.y - vis && y < b.y + b.h + 1;
}
function inBuildingVisual(x, y) {
  return BUILDINGS.some(b => buildingVisual(b, x, y));
}

// Prédios construídos pelo jogador (ex.: galinheiro) + o quintal dos galinheiros —
// scatter/forrageio não pode nascer em cima disso (senão "nasce" pedra/árvore dentro
// do galinheiro ou no meio das galinhas).
function inPlayerBuildingOrYard(state, x, y) {
  for (const b of state.buildings || []) {
    if (buildingVisual(b, x, y)) return true;
    if (b.type === 'coop') {
      const yard = coopYard(b);
      if (x >= yard.x && x < yard.x + yard.w && y >= yard.y && y < yard.y + yard.h) return true;
    }
  }
  return false;
}

// Verifica se já existe objeto/forrageável num raio ao redor de (x,y) — os sprites
// de árvore/pedra/etc são maiores que 1 tile, então só bloquear o tile exato ainda
// deixa vizinhos colados visualmente. radius=1 dá 1 tile de respiro entre objetos.
function hasNearbyContent(state, x, y, radius = 1) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const key = `${x + dx},${y + dy}`;
      if (state.objects[key] || (state.forage && state.forage[key])) return true;
    }
  }
  return false;
}

// Verifica se um novo prédio (bx,by,w,h, com overhang visual `vis` acima da base)
// cabe sem encostar em nenhum prédio existente — evita telhados/paredes se
// sobrepondo visualmente quando o jogador constrói perto demais de outro prédio.
function buildingSpotFree(state, bx, by, w, h, vis, sidePad = 1) {
  const rects = [...BUILDINGS, ...state.buildings];
  const nx0 = bx - sidePad, nx1 = bx + w + sidePad;
  const ny0 = by - vis, ny1 = by + h + sidePad;
  for (const ob of rects) {
    const ovis = ob.vis != null ? ob.vis : 4;
    const ex0 = ob.x - sidePad, ex1 = ob.x + ob.w + sidePad;
    const ey0 = ob.y - ovis, ey1 = ob.y + ob.h + sidePad;
    if (nx0 < ex1 && nx1 > ex0 && ny0 < ey1 && ny1 > ey0) return false;
  }
  return true;
}

const POND = { x: 44, y: 36, w: 12, h: 10 };
const FARMLAND = { x: 8, y: 15, w: 29, h: 17 }; // área mantida livre de objetos
const SPAWN = { x: 18, y: 12 };
// Mina: retângulo de chão de caverna cercado por paredes-objeto; entrada no lado
// norte, onde o ramal sul da estrada chega.
const MINA = { x: 25, y: 60, w: 40, h: 18 };
// Praia: areia com franja pro mar aberto (não um lago redondo) no canto sul-leste.
const PRAIA = { x: 100, y: 60, w: 50, h: 20 };

function generateWorld(seed) {
  const rnd = mulberry32(seed);
  const ground = [];
  for (let y = 0; y < HEIGHT; y++) {
    const row = new Array(WIDTH).fill(0);
    ground.push(row);
  }
  // Lago
  for (let y = POND.y; y < POND.y + POND.h; y++)
    for (let x = POND.x; x < POND.x + POND.w; x++) ground[y][x] = 1;
  // Áreas de terra orgânicas (código 2): praça entre casa e loja, entrada norte,
  // caminho até o campo e até o lago, clareiras.
  const dirt = (x, y) => {
    if (x >= 1 && y >= 0 && x < WIDTH - 1 && y < HEIGHT - 1 && ground[y][x] === 0) ground[y][x] = 2;
  };
  const ellipse = (cx, cy, rx, ry) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) dirt(x, y);
  };
  const rect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dirt(x, y);
  };
  // Praça central de terra ligando casa (esq), loja (dir) e caixa de venda.
  ellipse(11, 11.5, 7, 2.4);            // praça da casa
  ellipse(25, 11.5, 6, 2.4);            // praça da loja
  rect(11, 10, 25, 13);                 // liga as duas praças (bloco central)
  // Entrada norte: reta e larga (3 tiles) descendo do topo à praça.
  rect(30, 0, 32, 13);
  // Portão do campo: trecho curto de terra da praça até a cerca (abre o gap na cerca).
  rect(17, 12, 19, 14);
  // Caminho ao galinheiro/lago: sai da praça leste, contorna o campo pelo leste.
  rect(25, 12, 143, 13);                // faixa leste na altura da praça — segue até Porto Vale
  rect(38, 13, 39, 23);                 // desce pela lateral leste do campo até o quintal
  dirt(9, 10); dirt(10, 10); dirt(24, 10); dirt(25, 10); // frente das portas
  // Vila: praça a leste da estrada, longe da fazenda — rota de transição entre as duas.
  ellipse(80, 12.5, 9, 3);
  // Porto Vale: cidade grande e litorânea, no fim da estrada leste.
  ellipse(120, 12.5, 15, 4);
  // Bifurcação sul: sai perto do cruzamento da vila, desce e se divide em dois ramais
  // (mina a oeste, praia a leste) — a "rota de transição" pras áreas novas do sul.
  rect(64, 13, 66, 52);                 // corredor vertical principal
  rect(43, 50, 118, 52);                // faixa leste-oeste ligando os dois ramais
  rect(43, 52, 47, 60);                 // ramal oeste até a entrada da mina
  rect(114, 52, 118, 66);               // ramal leste até a praia

  // Mina: chão de caverna preenchendo o retângulo; a parede (objeto, adicionada mais
  // abaixo) contorna por fora e abre um vão exatamente onde a estrada já chega —
  // mesmo truque do portão da cerca da fazenda (o anel só vira parede em grama, e
  // ali já virou estrada antes).
  for (let y = MINA.y; y < MINA.y + MINA.h; y++)
    for (let x = MINA.x; x < MINA.x + MINA.w; x++)
      if (ground[y][x] === 0) ground[y][x] = 3;

  // Praia: areia + oceano aberto na diagonal sul-leste, chegando à borda do mapa (o mar
  // "continua" além da tela). Costa ORGÂNICA (ondulada por seno determinístico), não um
  // degrau reto — o autotile de foam do cliente faz a transição suave areia↔água. Uma
  // margem de areia garantida perto da grama impede oceano colado na grama (sempre tem
  // areia no meio, pro cliente desenhar a transição grama→areia suave).
  for (let y = PRAIA.y; y < PRAIA.y + PRAIA.h; y++) {
    for (let x = PRAIA.x; x < PRAIA.x + PRAIA.w; x++) {
      if (ground[y][x] !== 0) continue;
      const dx = x - PRAIA.x, dy = y - PRAIA.y;
      const coast = dx * 0.7 + dy * 1.15;
      const wave = 2.3 * Math.sin(x * 0.55) + 1.7 * Math.sin(y * 0.8 + x * 0.15);
      ground[y][x] = (coast > 6 && coast + wave > PRAIA.w * 0.42) ? 5 : 4;
    }
  }
  // Buffer de areia: onde a onda empurrou oceano encostado na grama, volta pra areia —
  // grama nunca toca oceano direto (sempre tem areia no meio pro cliente fazer a
  // transição grama→areia→foam suave).
  for (let y = PRAIA.y; y < PRAIA.y + PRAIA.h; y++) {
    for (let x = PRAIA.x; x < PRAIA.x + PRAIA.w; x++) {
      if (ground[y][x] !== 5) continue;
      const g0 = (xx, yy) => yy >= 0 && yy < HEIGHT && xx >= 0 && xx < WIDTH && ground[yy][xx] === 0;
      if (g0(x, y - 1) || g0(x, y + 1) || g0(x - 1, y) || g0(x + 1, y)) ground[y][x] = 4;
    }
  }

  const inRect = (r, x, y, pad = 0) =>
    x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad;
  const blocked = (x, y) =>
    ground[y][x] !== 0 ||
    inBuildingVisual(x, y) ||
    inRect(FARMLAND, x, y, 2) ||
    (Math.abs(x - SPAWN.x) < 3 && Math.abs(y - SPAWN.y) < 3);

  const objects = {};
  const treeVariant = () => (rnd() < 0.7 ? 'oak' : 'birch');
  // Cerca de árvores na borda
  for (let x = 0; x < WIDTH; x++) for (const y of [0, HEIGHT - 1]) {
    if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'tree', variant: treeVariant(), hp: 5 };
  }
  for (let y = 0; y < HEIGHT; y++) for (const x of [0, WIDTH - 1]) {
    if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'tree', variant: treeVariant(), hp: 5 };
  }
  // Cerca de madeira ao redor do campo (o caminho de terra vira o portão)
  for (let x = FARMLAND.x - 1; x <= FARMLAND.x + FARMLAND.w; x++) {
    for (const y of [FARMLAND.y - 1, FARMLAND.y + FARMLAND.h]) {
      if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'fence' };
    }
  }
  for (let y = FARMLAND.y - 1; y <= FARMLAND.y + FARMLAND.h; y++) {
    for (const x of [FARMLAND.x - 1, FARMLAND.x + FARMLAND.w]) {
      if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'fence' };
    }
  }
  // Parede da mina: contorna o retângulo de chão de caverna; some sozinha onde a
  // estrada de acesso já virou chão de caverna/estrada (mesmo truque do portão acima).
  for (let x = MINA.x - 1; x <= MINA.x + MINA.w; x++) {
    for (const y of [MINA.y - 1, MINA.y + MINA.h]) {
      if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'cavewall' };
    }
  }
  for (let y = MINA.y - 1; y <= MINA.y + MINA.h; y++) {
    for (const x of [MINA.x - 1, MINA.x + MINA.w]) {
      if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'cavewall' };
    }
  }
  // Árvores, pedras, arbustos e tocos espalhados (contagens escaladas p/ o mapa
  // maior desde que a vila foi adicionada a leste, senão fica ralo demais lá).
  const SCATTER = [
    [92, () => ({ type: 'tree', variant: treeVariant(), hp: 5 })],
    [46, () => ({ type: 'rock', hp: 3 })],
    [40, () => ({ type: 'bush', hp: 2 })],
    [12, () => ({ type: 'stump', hp: 2 })],
  ];
  const scatterState = { objects }; // wrapper só pra reusar hasNearbyContent
  for (const [count, make] of SCATTER) {
    let placed = 0, tries = 0;
    while (placed < count && tries++ < 2000) {
      const x = 1 + Math.floor(rnd() * (WIDTH - 2));
      const y = 1 + Math.floor(rnd() * (HEIGHT - 2));
      if (blocked(x, y) || hasNearbyContent(scatterState, x, y)) continue;
      objects[`${x},${y}`] = make();
      placed++;
    }
  }

  // Minérios: só no chão de caverna da mina, raridade decrescente (ORE_SPAWN).
  for (const [mineral, count] of ORE_SPAWN) {
    let placed = 0, tries = 0;
    while (placed < count && tries++ < 1000) {
      const x = MINA.x + Math.floor(rnd() * MINA.w);
      const y = MINA.y + Math.floor(rnd() * MINA.h);
      if (ground[y][x] !== 3 || hasNearbyContent(scatterState, x, y)) continue;
      objects[`${x},${y}`] = { type: 'ore', mineral, hp: 3 };
      placed++;
    }
  }
  return { ground, objects };
}

function initialFarmState(seed) {
  const { ground, objects } = generateWorld(seed);
  const state = {
    v: 1,
    seed,
    day: 1, season: 0, year: 1,
    time: 6 * 60,            // minutos do dia de jogo (6:00)
    money: 500,
    ground,                  // estático após gerar
    objects,                 // "x,y" -> {type, hp}
    tiles: {},               // "x,y" -> {tilled, watered, crop:{id, daysGrown}}
    bin: [],                 // [{item, qty}]
    inventories: {},         // userId -> {items:{id:qty}, energy, can:{level,max}}
    animals: [],             // [{id, type:'chicken', hx, hy}] galinhas do galinheiro
    eggs: {},                // "x,y" -> {} ovos a coletar
    nextAnimalId: 1,
    buildings: [],           // [{id, type, x, y}] prédios construídos pelo jogador
    nextBuildingId: 1,
    forage: {},              // "x,y" -> {type} itens para forragear (berry/mushroom/log)
  };
  scatterForage(state, 25, mulberry32(seed ^ 0x9e37));
  return state;
}

// Espalha `n` forrageáveis em tiles de grama livres. Chamado na criação e a cada dia.
function scatterForage(state, n, rnd = Math.random) {
  const types = ['berry', 'mushroom', 'mushroom', 'log'];
  const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  let tries = 0;
  while (n > 0 && tries++ < 1200) {
    const x = 1 + Math.floor(rnd() * (WIDTH - 2));
    const y = 1 + Math.floor(rnd() * (HEIGHT - 2));
    const key = `${x},${y}`;
    if (state.ground[y][x] !== 0) continue;
    if (state.tiles[key]) continue;
    if (inRect(FARMLAND, x, y) || inBuildingVisual(x, y) || inPlayerBuildingOrYard(state, x, y)) continue;
    if (hasNearbyContent(state, x, y)) continue;
    state.forage[key] = { type: types[Math.floor(rnd() * types.length)] };
    n--;
  }
}

module.exports = {
  WIDTH, HEIGHT, TILE, BUILDINGS, BUILDING_DEFS, POND, FARMLAND, SPAWN, MINA, PRAIA,
  generateWorld, initialFarmState, inBuildingVisual, buildingVisual, buildingSpotFree, collisionRect, coopYard, scatterForage,
  inPlayerBuildingOrYard, hasNearbyContent,
};
