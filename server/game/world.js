// Geração do mapa: fazenda (x0-59) + vila conectada por estrada a leste (x60-91),
// tudo num único mundo/room (sem troca de mapa) — mais simples que rooms separadas
// e já entrega "cidade + rota de transição" pedida pelo usuário.
// Ground: 0 grama, 1 água, 2 estrada. Objetos (árvore/pedra) são mutáveis e vivem no estado.
const WIDTH = 92;
const HEIGHT = 50;
const TILE = 16;

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
  rect(25, 12, 86, 13);                 // faixa leste na altura da praça — segue até a vila
  rect(38, 13, 39, 23);                 // desce pela lateral leste do campo até o quintal
  dirt(9, 10); dirt(10, 10); dirt(24, 10); dirt(25, 10); // frente das portas
  // Vila: praça a leste da estrada, longe da fazenda — rota de transição entre as duas.
  ellipse(80, 12.5, 9, 3);

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
  WIDTH, HEIGHT, TILE, BUILDINGS, BUILDING_DEFS, POND, FARMLAND, SPAWN,
  generateWorld, initialFarmState, inBuildingVisual, buildingVisual, buildingSpotFree, collisionRect, coopYard, scatterForage,
  inPlayerBuildingOrYard, hasNearbyContent,
};
