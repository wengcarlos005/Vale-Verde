// Geração do mapa: o overworld (fazenda + vila) é o mapa "núcleo" que carrega no login
// — precisa ser leve. Porto Vale e o ramal sul (mina/praia) são TELAS SEPARADAS,
// carregadas sob demanda (mesmo sistema de mapOf/enterMap já usado pra mina/interiores),
// cada uma com coordenada própria (0,0). Isso troca "um mapa gigante contínuo" por
// "vários mapas pequenos", que é o que resolve o carregamento pesado.
// Ground: 0 grama, 1 água (lago), 2 estrada, 3 chão de caverna, 4 areia, 5 água (oceano),
// 6 piso de madeira (interior), 7 pedra (encosta da mina). Objetos (árvore/pedra/minério/
// parede/móveis) vivem no estado.
const WIDTH = 92;
const HEIGHT = 50;
const TILE = 16;

// Dimensões dos mapas "ao ar livre" separados (Porto Vale, ramal sul, cidade da mina).
const PV_W = 60, PV_H = 36;
const SOUTH_W = 100, SOUTH_H = 46;
const PED_W = 50, PED_H = 36;
const FLORESTA_W = 56, FLORESTA_H = 48;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Prédios FIXOS iniciais, por MAPA (cada mapa tem coordenada própria 0,0). rect = base
// com colisão (sprite desenhado acima, alinhado pela borda inferior). door = tile de
// interação (na borda de baixo). padBottom = linhas de tile transparentes na base do
// PNG (medido por pixel) que NÃO devem bloquear — sem isso a colisão "sobra" além da
// parede visível e o jogador é barrado num tile de grama normal na frente da porta.
const BUILDINGS = {
  overworld: [
    { type: 'house', x: 6,  y: 6, w: 9, h: 4, padBottom: 1, door: [10, 9] },  // dormir (sprite 144x128)
    { type: 'shop',  x: 22, y: 6, w: 6, h: 4, padBottom: 1, door: [24, 9] },  // loja do Bob (sprite 96x128)
    { type: 'bin',   x: 16, y: 10, w: 1, h: 1, door: [16, 10] }, // caixa de venda
    { type: 'well',  x: 13, y: 13, w: 2, h: 1 },                 // decorativo (sprite 32x48)
    { type: 'bench', x: 10, y: 12, w: 1, h: 1 },                 // bancada de fabricação, perto da casa
    // vila (praça a leste, ligada por estrada) — quadro de recados morou pra lá.
    { type: 'store', x: 79, y: 6, w: 9, h: 4, padBottom: 1 },    // casa de pedra, decorativa por ora (sprite 144x128)
    { type: 'board', x: 83, y: 15, w: 1, h: 1 },                 // quadro de recados, na praça da vila
  ],
  // Porto Vale — cidade grande e litorânea, tela própria (entrada na borda oeste).
  portovale: [
    { type: 'city_hall',  x: 22, y: 7, w: 9, h: 4, padBottom: 1 }, // calcário bege (sprite 144x128)
    { type: 'city_house', x: 36, y: 8, w: 7, h: 3, padBottom: 1 }, // madeira verde (sprite 112x96)
  ],
  // Ramal sul (praia/porto) — tela própria (entrada na borda norte, saída pra
  // Pedreira na borda sul). A mina MOROU pra lá (ver comentário em BUILDINGS.pedreira).
  south: [
    // Porto: barquinho animado (bóia) ancorado na areia, de frente pra uma pequena
    // enseada de oceano — decorativo, dá vida ao "porto" pedido sem depender do
    // tileset de doca (autotile complexo demais pra compor à mão com robustez).
    { type: 'boat', x: 57, y: 25, w: 3, h: 3, padBottom: 1 },
    // Cabanas de pescador ao redor da praia (mesma classe de tamanho da loja,
    // 96x128), espalhadas na faixa de grama entre o ramal da mina e a areia.
    { type: 'cabin_green', x: 34, y: 25, w: 6, h: 4, padBottom: 1 },
    { type: 'cabin_dark',  x: 42, y: 25, w: 6, h: 4, padBottom: 1 },
    { type: 'cabin_green', x: 34, y: 34, w: 6, h: 4, padBottom: 1 },
  ],
  // Pedreira — cidade pequena focada em mineração, tela própria (entrada na borda
  // norte, vindo do ramal sul). Mapa rochoso (scatter pesado de pedra); a mina agora
  // fica embutida numa parede de pedra de verdade (ver `stone_wall` em generatePedreira),
  // como o sprite do arco pede — antes ela estava largada solta na grama do ramal sul.
  pedreira: [
    { type: 'mine_entrance', x: 23, y: 14, w: 3, h: 3, padBottom: 3 },
    { type: 'store', x: 8, y: 9, w: 9, h: 4, padBottom: 1 },  // posto de mineração (casa de pedra), decorativo por ora
  ],
};

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
function inBuildingVisual(mapKey, x, y) {
  return (BUILDINGS[mapKey] || []).some(b => buildingVisual(b, x, y));
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
// Só o overworld tem construção do jogador (coop), então só olha os prédios fixos de lá.
function buildingSpotFree(state, bx, by, w, h, vis, sidePad = 1) {
  const rects = [...BUILDINGS.overworld, ...state.buildings];
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
// Praia (mapa 'south'): areia com franja pro mar aberto no canto sul-leste do mapa.
const PRAIA = { x: 52, y: 14, w: 46, h: 30 };

// ---------------- helpers de terreno compartilhados pelos 3 geradores ----------------
function terrainTools(ground, w, h) {
  const dirt = (x, y) => { if (x >= 1 && y >= 0 && x < w - 1 && y < h - 1 && ground[y][x] === 0) ground[y][x] = 2; };
  const ellipse = (cx, cy, rx, ry) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) dirt(x, y);
  };
  const rect = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dirt(x, y); };
  return { dirt, ellipse, rect };
}
// `terrainTools().dirt` propositalmente NÃO pinta a borda direita/inferior/esquerda
// (só a de cima, pro caso original da entrada norte) — pra abrir uma travessia de
// borda pra outro mapa (leste/sul/oeste), pinta direto ignorando essa margem, senão a
// borderTrees() abaixo tampa o vão com uma árvore.
function openEdge(ground, w, h, x0, y0, x1, y1) {
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      if (ground[y][x] === 0) ground[y][x] = 2;
    }
  }
}
function borderTrees(ground, objects, w, h, treeVariant) {
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) {
    if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'tree', variant: treeVariant(), hp: 5 };
  }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) {
    if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'tree', variant: treeVariant(), hp: 5 };
  }
}
function scatterOnMap(mapKey, ground, objects, w, h, rnd, list, blockedExtra) {
  const scatterState = { objects };
  const blocked = (x, y) => ground[y][x] !== 0 || inBuildingVisual(mapKey, x, y) || (blockedExtra && blockedExtra(x, y));
  for (const [count, make] of list) {
    let placed = 0, tries = 0;
    while (placed < count && tries++ < 2000) {
      const x = 1 + Math.floor(rnd() * (w - 2));
      const y = 1 + Math.floor(rnd() * (h - 2));
      if (blocked(x, y) || hasNearbyContent(scatterState, x, y)) continue;
      objects[`${x},${y}`] = make();
      placed++;
    }
  }
}
function paintBeach(ground, w, h, praia) {
  for (let y = praia.y; y < praia.y + praia.h; y++) {
    for (let x = praia.x; x < praia.x + praia.w; x++) {
      if (ground[y][x] !== 0) continue;
      const dx = x - praia.x, dy = y - praia.y;
      const coast = dx * 0.7 + dy * 1.15;
      const wave = 2.3 * Math.sin(x * 0.55) + 1.7 * Math.sin(y * 0.8 + x * 0.15);
      ground[y][x] = (coast > 6 && coast + wave > praia.w * 0.42) ? 5 : 4;
    }
  }
  // Buffer de areia: grama nunca toca oceano direto (sempre tem areia no meio pro
  // cliente fazer a transição grama→areia→foam suave).
  for (let y = praia.y; y < praia.y + praia.h; y++) {
    for (let x = praia.x; x < praia.x + praia.w; x++) {
      if (ground[y][x] !== 5) continue;
      const g0 = (xx, yy) => yy >= 0 && yy < h && xx >= 0 && xx < w && ground[yy][xx] === 0;
      if (g0(x, y - 1) || g0(x, y + 1) || g0(x - 1, y) || g0(x + 1, y)) ground[y][x] = 4;
    }
  }
}

// ---------------- overworld (fazenda + vila) — mapa núcleo, carrega no login ----------------
function generateOverworld(seed) {
  const rnd = mulberry32(seed);
  const ground = [];
  for (let y = 0; y < HEIGHT; y++) ground.push(new Array(WIDTH).fill(0));
  for (let y = POND.y; y < POND.y + POND.h; y++)
    for (let x = POND.x; x < POND.x + POND.w; x++) ground[y][x] = 1;
  const { dirt, ellipse, rect } = terrainTools(ground, WIDTH, HEIGHT);
  // Praça central de terra ligando casa (esq), loja (dir) e caixa de venda.
  ellipse(11, 11.5, 7, 2.4);            // praça da casa
  ellipse(25, 11.5, 6, 2.4);            // praça da loja
  rect(11, 10, 25, 13);                 // liga as duas praças (bloco central)
  rect(30, 0, 32, 13);                  // entrada norte
  rect(17, 12, 19, 14);                 // portão do campo
  rect(25, 12, 91, 13);                 // faixa leste — passa pela praça da vila e sai na borda leste (Porto Vale)
  rect(38, 13, 39, 23);                 // desce pela lateral leste do campo até o quintal
  dirt(9, 10); dirt(10, 10); dirt(24, 10); dirt(25, 10); // frente das portas
  ellipse(80, 12.5, 9, 3);              // praça da vila
  rect(64, 13, 66, HEIGHT - 2);         // ramal sul — sai perto do cruzamento da vila até perto da borda
  // travessias de borda pros mapas vizinhos (dirt() não pinta a borda direita/inferior de propósito)
  openEdge(ground, WIDTH, HEIGHT, 89, 12, WIDTH - 1, 13);         // leste → Porto Vale
  openEdge(ground, WIDTH, HEIGHT, 64, HEIGHT - 2, 66, HEIGHT - 1); // sul → south

  const inRect = (r, x, y, pad = 0) =>
    x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad;
  const blocked = (x, y) =>
    ground[y][x] !== 0 || inBuildingVisual('overworld', x, y) || inRect(FARMLAND, x, y, 2) ||
    (Math.abs(x - SPAWN.x) < 3 && Math.abs(y - SPAWN.y) < 3);

  const objects = {};
  const treeVariant = () => (rnd() < 0.7 ? 'oak' : 'birch');
  borderTrees(ground, objects, WIDTH, HEIGHT, treeVariant);
  for (let x = FARMLAND.x - 1; x <= FARMLAND.x + FARMLAND.w; x++) {
    for (const y of [FARMLAND.y - 1, FARMLAND.y + FARMLAND.h]) if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'fence' };
  }
  for (let y = FARMLAND.y - 1; y <= FARMLAND.y + FARMLAND.h; y++) {
    for (const x of [FARMLAND.x - 1, FARMLAND.x + FARMLAND.w]) if (ground[y][x] === 0) objects[`${x},${y}`] = { type: 'fence' };
  }
  scatterOnMap('overworld', ground, objects, WIDTH, HEIGHT, rnd, [
    [60, () => ({ type: 'tree', variant: treeVariant(), hp: 5 })],
    [30, () => ({ type: 'rock', hp: 3 })],
    [26, () => ({ type: 'bush', hp: 2 })],
    [8, () => ({ type: 'stump', hp: 2 })],
  ], (x, y) => inRect(FARMLAND, x, y, 2) || (Math.abs(x - SPAWN.x) < 3 && Math.abs(y - SPAWN.y) < 3));
  return { ground, objects };
}

// ---------------- Porto Vale — tela própria, entrada na borda oeste ----------------
function generatePortoVale(seed) {
  const rnd = mulberry32(seed ^ 0x504f5254);
  const ground = [];
  for (let y = 0; y < PV_H; y++) ground.push(new Array(PV_W).fill(0));
  const { ellipse, rect } = terrainTools(ground, PV_W, PV_H);
  rect(0, 17, 35, 19);                  // estrada da borda oeste até a praça
  ellipse(35, 18, 15, 7);               // praça de Porto Vale
  openEdge(ground, PV_W, PV_H, 0, 17, 1, 19); // travessia de borda oeste → overworld

  const objects = {};
  const treeVariant = () => (rnd() < 0.7 ? 'oak' : 'birch');
  borderTrees(ground, objects, PV_W, PV_H, treeVariant);
  scatterOnMap('portovale', ground, objects, PV_W, PV_H, rnd, [
    [20, () => ({ type: 'tree', variant: treeVariant(), hp: 5 })],
    [10, () => ({ type: 'rock', hp: 3 })],
    [8, () => ({ type: 'bush', hp: 2 })],
    [3, () => ({ type: 'stump', hp: 2 })],
  ]);
  return { ground, objects, w: PV_W, h: PV_H, spawn: [2, 18] };
}

// ---------------- South (mina + praia) — tela própria, entrada na borda norte ----------------
function generateSouth(seed) {
  const rnd = mulberry32(seed ^ 0x534f5554);
  const ground = [];
  for (let y = 0; y < SOUTH_H; y++) ground.push(new Array(SOUTH_W).fill(0));
  const { ellipse, rect } = terrainTools(ground, SOUTH_W, SOUTH_H);
  rect(48, 0, 52, 14);                  // estrada da borda norte até o cruzamento
  rect(20, 12, 51, 14);                 // faixa leste-oeste — só até a beira da praia (PRAIA.x=52),
                                         // pra não cortar um pedaço de estrada dentro da areia
  rect(23, 14, 27, 20);                 // ramal oeste até a clareira da mina (curto de novo —
                                         // descer até a borda sul do mapa, 30 tiles, fazia o
                                         // caminho até a Pedreira parecer bem mais longo do que a
                                         // beira da praia, meio "sumido"; a saída oeste abaixo é
                                         // bem mais curta, a trilha já tava perto da borda oeste)
  ellipse(25, 20, 4, 3);                // clareira da mina
  rect(0, 19, 24, 21);                  // corredor curto até a saída oeste (Pedreira)
  openEdge(ground, SOUTH_W, SOUTH_H, 0, 19, 1, 21); // oeste → Pedreira
  paintBeach(ground, SOUTH_W, SOUTH_H, PRAIA);

  const objects = {};
  const treeVariant = () => (rnd() < 0.7 ? 'oak' : 'birch');
  borderTrees(ground, objects, SOUTH_W, SOUTH_H, treeVariant);
  scatterOnMap('south', ground, objects, SOUTH_W, SOUTH_H, rnd, [
    [40, () => ({ type: 'tree', variant: treeVariant(), hp: 5 })],
    [20, () => ({ type: 'rock', hp: 3 })],
    [15, () => ({ type: 'bush', hp: 2 })],
    [5, () => ({ type: 'stump', hp: 2 })],
  ]);
  return { ground, objects, w: SOUTH_W, h: SOUTH_H, spawn: [50, 2] };
}

// ---------------- Pedreira (cidade de mineração) — tela própria, entrada na borda norte ----------------
// Mapa rochoso: a mina fica embutida numa parede de pedra de verdade (o sprite do arco
// pressupõe isso — antes ele estava largado solto na grama do ramal sul).
function generatePedreira(seed) {
  const rnd = mulberry32(seed ^ 0x50454452);
  const ground = [];
  for (let y = 0; y < PED_H; y++) ground.push(new Array(PED_W).fill(0));
  const { ellipse, rect } = terrainTools(ground, PED_W, PED_H);
  rect(23, 0, 27, 17);                  // estrada da borda norte até a praça da mina
  ellipse(24, 17, 8, 4);                // praça em frente à mina
  rect(10, 12, 23, 14);                 // ramal até o posto de mineração
  openEdge(ground, PED_W, PED_H, 23, 0, 27, 1); // norte → south

  const objects = {};
  const treeVariant = () => (rnd() < 0.7 ? 'oak' : 'birch');
  borderTrees(ground, objects, PED_W, PED_H, treeVariant);

  // Parede de pedra flanqueando o arco da mina — 2 blocos de 4 colunas x 3 linhas (mesma
  // altura do arco), formando uma face de rocha contínua com o portal no meio.
  const mine = BUILDINGS.pedreira.find(b => b.type === 'mine_entrance');
  for (const side of [-1, 1]) {
    for (let dx = 1; dx <= 4; dx++) {
      const x = side < 0 ? mine.x - dx : mine.x + mine.w - 1 + dx;
      for (let dy = 0; dy < mine.h; dy++) objects[`${x},${mine.y + dy}`] = { type: 'stone_wall' };
    }
  }

  // Scatter pesado em pedra (rochoso/mineração) — poucas árvores, quase sem arbusto.
  scatterOnMap('pedreira', ground, objects, PED_W, PED_H, rnd, [
    [55, () => ({ type: 'rock', hp: 3 })],
    [10, () => ({ type: 'tree', variant: treeVariant(), hp: 5 })],
    [8, () => ({ type: 'bush', hp: 2 })],
  ]);
  return { ground, objects, w: PED_W, h: PED_H, spawn: [25, 2] };
}

// ---------------- Floresta — tela própria, entrada na borda sul (vindo da fazenda) ----------------
// Fase nova do roadmap: objetivo próprio (caça de insetos — ver BUGS em crops.js e a
// ação 'catch' em rooms.js) num mapa dedicado, mesmo padrão de "1 fase = 1 mapa + 1
// objetivo novo" que south/pedreira já estabeleceram (praia/porto e mineração). Entra
// pela saída norte do overworld (`rect(30,0,32,13)`, já existia sem uso — dirt() deixa a
// borda DE CIMA passar de propósito, então nem precisou de openEdge do lado da fazenda).
// Mata densa com uma clareira central (mais grama aberta = mais fácil caçar inseto ali).
function generateFloresta(seed) {
  const rnd = mulberry32(seed ^ 0x464c4f52);
  const ground = [];
  for (let y = 0; y < FLORESTA_H; y++) ground.push(new Array(FLORESTA_W).fill(0));
  const { ellipse, rect } = terrainTools(ground, FLORESTA_W, FLORESTA_H);
  rect(27, 24, 29, FLORESTA_H - 1);     // trilha da clareira até a borda sul
  ellipse(28, 22, 10, 7);               // clareira central (meadow)
  openEdge(ground, FLORESTA_W, FLORESTA_H, 27, FLORESTA_H - 2, 29, FLORESTA_H - 1); // sul → fazenda

  const objects = {};
  const treeVariant = () => (rnd() < 0.6 ? 'oak' : 'birch');
  borderTrees(ground, objects, FLORESTA_W, FLORESTA_H, treeVariant);
  scatterOnMap('floresta', ground, objects, FLORESTA_W, FLORESTA_H, rnd, [
    [130, () => ({ type: 'tree', variant: treeVariant(), hp: 5 })],
    [45, () => ({ type: 'bush', hp: 2 })],
    [18, () => ({ type: 'stump', hp: 2 })],
    [10, () => ({ type: 'rock', hp: 3 })],
  ]);
  return { ground, objects, w: FLORESTA_W, h: FLORESTA_H, spawn: [28, FLORESTA_H - 3] };
}

// ---------------- telas separadas (mina) ----------------
// A mina é uma sequência de telas próprias (mine:1, mine:2, ...), entradas pela Pedreira.
// Cada nível é uma sala de caverna com escada pra descer (minério mais raro/valioso
// quanto mais fundo) e escada/saída pra subir. Os primeiros 10 níveis têm FORMA e
// TAMANHO próprios (não um retângulo só escalando) — níveis 11+ caem num gerador
// genérico (retângulo crescendo devagar), documentado como próximo passo.
// Tile do mapa 'pedreira' onde o jogador reaparece ao sair da mina (logo abaixo do prédio).
const MINE_ENTRANCE_RETURN = [24, 17];

function depthOf(mapKey) { return Number(String(mapKey).split(':')[1]) || 1; }

// Contagem de cada minério por profundidade: ferro some, ouro cresce quanto mais fundo.
function mineOreCounts(depth) {
  return [
    ['iron', Math.max(3, 20 - depth * 3)],
    ['copper', 8 + depth],
    ['gold', Math.min(18, depth * 3)],
  ];
}

// Helpers de forma: `isFloor(x,y)` decide o que é chão andável (o resto vira parede de
// caverna). rectFloor/unionFloor compõem formas complexas a partir de retângulos.
function rectFloor(x0, y0, x1, y1) { return (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1; }
function unionFloor(...fns) { return (x, y) => fns.some(f => f(x, y)); }

// Config dos primeiros 10 níveis: forma+tamanho variam de verdade (não só escala). Todo
// nível múltiplo de 5 (`shortcut: true`) ganha uma saída extra direto pra Pedreira.
const MINE_LEVELS = [
  { w: 20, h: 14, shape: 'rect' },
  { w: 24, h: 16, shape: 'rect' },
  { w: 28, h: 20, shape: 'l' },
  { w: 26, h: 18, shape: 'pillars' },
  { w: 30, h: 20, shape: 'lake', shortcut: true },
  { w: 42, h: 12, shape: 'corridor' },
  { w: 26, h: 26, shape: 'cross' },
  { w: 32, h: 22, shape: 'pillars_dense' },
  { w: 36, h: 28, shape: 'rect' },
  { w: 34, h: 24, shape: 'lake_pillars', shortcut: true },
];

function mineLevelConfig(depth) {
  if (depth >= 1 && depth <= MINE_LEVELS.length) return MINE_LEVELS[depth - 1];
  // Níveis 11+: retângulo genérico crescendo bem devagar — dar forma própria a esses
  // também é o próximo passo natural (documentado no plano), não bloqueia os 10 primeiros.
  return { w: Math.min(60, 24 + depth), h: Math.min(40, 16 + Math.floor(depth / 2)), shape: 'rect' };
}

function mineIsFloor(shape, w, h) {
  const inset = rectFloor(1, 1, w - 1, h - 1);
  if (shape === 'l') {
    return unionFloor(rectFloor(1, 1, Math.floor(w * 0.55), h - 1), rectFloor(1, 1, w - 1, Math.floor(h * 0.5)));
  }
  if (shape === 'pillars' || shape === 'pillars_dense' || shape === 'lake_pillars') {
    const step = shape === 'pillars_dense' ? 5 : shape === 'lake_pillars' ? 9 : 7;
    return (x, y) => {
      if (!inset(x, y)) return false;
      if (x > 3 && y > 3 && x < w - 4 && y < h - 4 && (x - 4) % step === 0 && (y - 4) % step === 0) return false;
      return true;
    };
  }
  if (shape === 'corridor') {
    const bandH = Math.max(4, Math.floor(h / 3));
    return unionFloor(
      rectFloor(1, 1, Math.floor(w * 0.5), bandH),
      rectFloor(Math.floor(w * 0.4), 1, Math.floor(w * 0.6), h - 1),
      rectFloor(Math.floor(w * 0.5), h - 1 - bandH, w - 1, h - 1),
    );
  }
  if (shape === 'cross') {
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2), arm = Math.floor(Math.min(w, h) * 0.28);
    return unionFloor(rectFloor(1, cy - arm, w - 1, cy + arm), rectFloor(cx - arm, 1, cx + arm, h - 1));
  }
  return inset; // 'rect', 'lake' (o lago em si é recortado à parte, ver makeMineLevel)
}

// Procura o primeiro tile andável varrendo diagonalmente a partir de (x0,y0) — usado pra
// achar onde encaixar as escadas em formas irregulares (o canto literal pode ser parede).
function findFloorNear(isFloor, w, h, x0, y0, dx, dy) {
  for (let r = 0; r < Math.max(w, h); r++) {
    const x = x0 + dx * r, y = y0 + dy * r;
    if (x >= 1 && x < w - 1 && y >= 1 && y < h - 1 && isFloor(x, y)) return [x, y];
  }
  return [Math.floor(w / 2), Math.floor(h / 2)];
}

// Posição das escadas de um nível, sem gerar o nível inteiro (barato — não depende de
// `rnd`/minério/monstro, só da forma) — usado pra sincronizar o ladder_down de um nível
// com o ladder_up do próximo sem precisar construir os dois de verdade.
function mineLadderPositions(depth) {
  const cfg = mineLevelConfig(depth);
  const isFloor = mineIsFloor(cfg.shape, cfg.w, cfg.h);
  return {
    up: findFloorNear(isFloor, cfg.w, cfg.h, 2, 2, 1, 1),
    down: findFloorNear(isFloor, cfg.w, cfg.h, cfg.w - 3, cfg.h - 3, -1, -1),
  };
}

// Monstros por profundidade: slime pequeno → médio → grande → esqueleto, ficando mais
// numerosos e resistentes quanto mais fundo (dificuldade crescente por nível).
const MONSTER_TIERS = [
  { maxDepth: 2, type: 'slime_small', hp: 2 },
  { maxDepth: 5, type: 'slime_medium', hp: 4 },
  { maxDepth: 8, type: 'slime_big', hp: 7 },
  { maxDepth: Infinity, type: 'skeleton', hp: 11 },
];
function monsterTierFor(depth) { return MONSTER_TIERS.find(t => depth <= t.maxDepth); }

function makeMineLevel(seed, depth) {
  const rnd = mulberry32((seed ^ 0x51ede1 ^ Math.imul(depth, 2654435761)) >>> 0);
  const cfg = mineLevelConfig(depth);
  const w = cfg.w, h = cfg.h;
  const isFloor = mineIsFloor(cfg.shape, w, h);
  const ground = [];
  for (let y = 0; y < h; y++) ground.push(new Array(w).fill(3)); // chão de caverna em toda a caixa
  const objects = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isFloor(x, y)) objects[`${x},${y}`] = { type: 'cavewall' };
  }

  const up = findFloorNear(isFloor, w, h, 2, 2, 1, 1);
  const down = findFloorNear(isFloor, w, h, w - 3, h - 3, -1, -1);
  // Saída de atalho (a cada 5 níveis): escapa direto pra Pedreira sem subir nível por
  // nível. Busca a partir da borda esquerda na meia-altura (não do centro geométrico —
  // é onde o lago abaixo vai ser esculpido; começar a busca ali fazia a saída cair bem
  // no meio do lago, virando uma ilhota inacessível cercada de água).
  let shortcutAt = null;
  if (cfg.shortcut) {
    shortcutAt = findFloorNear(isFloor, w, h, 2, Math.floor(h / 2), 1, 0);
  }

  // Lago (formas 'lake'/'lake_pillars'): usa ground=5 (oceano), NÃO ground=1 (lago da
  // fazenda) — o ground=1 vem com uma borda decorativa de GRAMA no cliente (pensada pro
  // lago cercado de grama da fazenda), que ficava com uma moldura verde bizarra encostada
  // no chão de caverna marrom (reportado pelo usuário: "lago não tá bem conectado", a
  // borda verde lia como se fosse uma parede/coisa fora do lugar). Ground=5 renderiza só
  // água lisa sem moldura nenhuma — sem transição suave, mas sem cor errada também.
  if (cfg.shape === 'lake' || cfg.shape === 'lake_pillars') {
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    const rx = Math.max(3, Math.floor(w * 0.16)), ry = Math.max(3, Math.floor(h * 0.14));
    const nearReserved = (x, y) => [up, down, shortcutAt].some(pt => pt && Math.abs(x - pt[0]) <= 2 && Math.abs(y - pt[1]) <= 2);
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (!isFloor(x, y)) continue;
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
      if (nearReserved(x, y)) continue;
      ground[y][x] = 5;
      delete objects[`${x},${y}`];
    }
  }

  const reserved = (x, y) =>
    (Math.abs(x - up[0]) <= 1 && Math.abs(y - up[1]) <= 1) ||
    (Math.abs(x - down[0]) <= 1 && Math.abs(y - down[1]) <= 1) ||
    (shortcutAt && Math.abs(x - shortcutAt[0]) <= 1 && Math.abs(y - shortcutAt[1]) <= 1);
  const floorAndFree = (x, y) => isFloor(x, y) && ground[y][x] === 3 && !objects[`${x},${y}`] && !reserved(x, y);

  // Escada escondida (mecânica estilo Stardew Valley, pedido explícito do usuário): em
  // vez de uma escada sempre visível, o tile de descida esconde uma pedra especial —
  // minerá-la revela a escada de verdade (ver `stairsRevealed`/onAction 'mine' em
  // rooms.js). HP um pouco mais alto que pedra normal (5, contra 3) pra sinalizar que é
  // "diferente" sem precisar de sprite próprio. `reserved()` já garante que nada mais
  // (minério/monstro) nasce nesse tile.
  objects[`${down[0]},${down[1]}`] = { type: 'rock', hp: 5, hidesStairs: true };

  // Lista embaralhada de tiles de chão candidatos — formas finas (corredor em S, cruz)
  // têm baixa taxa de acerto pra amostragem aleatória "às cegas" (a maior parte da caixa
  // delimitadora é parede), então em vez de sortear (x,y) e tentar de novo até um limite
  // de tentativas (podia falhar silenciosamente e sobrar sem monstro nenhum num corredor
  // estreito), embaralha TODOS os tiles de chão uma vez e percorre em ordem — garante
  // preencher até o alvo sempre que sobrar espaço de verdade.
  const candidates = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (isFloor(x, y)) candidates.push([x, y]);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const scatterState = { objects };

  // Monstros PRIMEIRO (antes do minério): a contagem de monstro é sempre pequena (2-9),
  // então reservar o espaço deles antes evita que o minério — cuja contagem-alvo escala
  // só com a profundidade, não com a forma do nível — encha um corredor fino inteiro e
  // não sobre vaga nenhuma pra monstro (bug real visto num formato de corredor estreito).
  const tier = monsterTierFor(depth);
  const monsterCount = Math.min(9, 2 + Math.floor(depth / 2));
  const monsters = {};
  let placedM = 0, nextId = 1;
  for (const [x, y] of candidates) {
    if (placedM >= monsterCount) break;
    if (!floorAndFree(x, y) || hasNearbyContent(scatterState, x, y)) continue;
    const id = `m${nextId++}`;
    const hp = tier.hp + Math.floor(rnd() * 3) + Math.floor(depth / 3);
    // hx/hy = "casa" (posição de origem) — o monstro vaga perto dali (ver tickMonsters em
    // rooms.js), não é mais 100% parado, mas continua sem perseguir o jogador de propósito.
    monsters[id] = { id, type: tier.type, x, y, hx: x, hy: y, hp, maxHp: hp };
    placedM++;
  }

  // Minério: usa o que sobrou dos candidatos, com um teto (~45% do chão) pra sempre
  // sobrar espaço de passagem mesmo num formato bem apertado. Exclui os tiles onde já
  // colocamos monstro — sem isso, minério podia nascer EM CIMA de um monstro (mesmo
  // tile), os dois sprites empilhados ficando com aparência de cenário quebrado/cortado.
  const monsterPos = new Set(Object.values(monsters).map((mo) => `${mo.x},${mo.y}`));
  const oreCounts = mineOreCounts(depth);
  const oreCap = Math.max(6, Math.floor(candidates.length * 0.45));
  let oreBudgetLeft = oreCap;
  for (const [mineral, count] of oreCounts) {
    let placed = 0;
    const target = Math.min(count, oreBudgetLeft);
    for (const [x, y] of candidates) {
      if (placed >= target) break;
      if (!floorAndFree(x, y) || hasNearbyContent(scatterState, x, y) || monsterPos.has(`${x},${y}`)) continue;
      objects[`${x},${y}`] = { type: 'ore', mineral, hp: 3 };
      placed++;
    }
    oreBudgetLeft -= placed;
  }

  const nextUp = mineLadderPositions(depth + 1).up;
  const prevDown = depth > 1 ? mineLadderPositions(depth - 1).down : null;
  const entrances = [
    { at: up, kind: 'ladder_up', to: depth === 1 ? 'pedreira' : `mine:${depth - 1}`,
      toSpawn: depth === 1 ? MINE_ENTRANCE_RETURN : [prevDown[0], prevDown[1] - 1] },
    { at: down, kind: 'ladder_down', to: `mine:${depth + 1}`, toSpawn: [nextUp[0], nextUp[1] + 1] },
  ];
  if (shortcutAt) entrances.push({ at: shortcutAt, kind: 'shortcut', to: 'pedreira', toSpawn: MINE_ENTRANCE_RETURN });

  return { ground, objects, monsters, entrances, w, h, spawn: [up[0], up[1] + 1] };
}

// ---------------- interiores (casa, loja) ----------------
// Salas fixas entradas pela porta do prédio no overworld. Estáticas (piso/parede/móveis
// não mudam) — geradas por template, sem persistência. ground 6 = piso de madeira.
const INT_W = 11, INT_H = 8;
const INT_DOOR = Math.floor(INT_W / 2);       // vão da porta (embaixo, centro)
const INT_SPAWN = [INT_DOOR, INT_H - 2];      // onde o jogador aparece ao entrar

function makeInterior(kind) {
  const w = INT_W, h = INT_H;
  const ground = [];
  for (let y = 0; y < h; y++) ground.push(new Array(w).fill(6));
  const objects = {};
  // paredes fechando a sala, com vão de porta embaixo no centro
  for (let x = 0; x < w; x++) { objects[`${x},0`] = { type: 'wall' }; if (x !== INT_DOOR) objects[`${x},${h - 1}`] = { type: 'wall' }; }
  for (let y = 0; y < h; y++) { objects[`0,${y}`] = { type: 'wall' }; objects[`${w - 1},${y}`] = { type: 'wall' }; }
  const interactables = [];
  if (kind === 'house') {
    objects['1,5'] = { type: 'rug' };            // tapete decorativo (3x3, sem colisão) sob/à frente da cama
    objects['2,2'] = { type: 'bed' };            // cama (E → dormir)
    interactables.push({ at: [2, 2], kind: 'bed' });
    objects['6,2'] = { type: 'table' };          // mesa decorativa (sprite ~3 tiles, cabe em 6-8)
  } else { // shop
    // Antes reaproveitava a mesma mesa 2x lado a lado (sem cara de loja nenhuma).
    // Agora: prateleiras de mercadoria na parede de fundo + balcão mais perto delas
    // (não do meio da sala) + baú decorativo do lado. Balcão subiu de y4 pra y3 —
    // encostado perto da parede de fundo, com folga de sobra até a porta (y7) pra o
    // aviso "Loja (E)" do balcão não brigar com o "Entrar (E)" da porta de saída.
    objects['2,2'] = { type: 'shelf' };             // prateleira de mercadoria (parede de fundo)
    objects['7,2'] = { type: 'shelf' };
    objects['4,3'] = { type: 'counter' };            // balcão do Bob (E → abrir loja)
    interactables.push({ at: [5, 4], kind: 'counter' });
    objects['8,5'] = { type: 'chest' };              // baú de mercadoria, decorativo
  }
  // porta de saída → overworld, na frente do prédio correspondente
  const b = BUILDINGS.overworld.find(bl => bl.type === kind);
  const ret = b ? [b.door[0], b.door[1] + 1] : [SPAWN.x, SPAWN.y];
  const entrances = [{ at: [INT_DOOR, h - 1], kind: 'door', to: 'overworld', toSpawn: ret }];
  return { ground, objects, entrances, interactables, w, h, spawn: INT_SPAWN.slice() };
}

// Pontos onde os mapas "ao ar livre" (overworld/portovale/south) se cruzam na borda —
// andar até lá dispara enterMap pra tela vizinha, igual a uma porta.
const EDGE_LINKS = {
  overworld: [
    { at: [91, 12], kind: 'edge_east', to: 'portovale', toSpawn: [2, 18] },
    { at: [65, HEIGHT - 1], kind: 'edge_south', to: 'south', toSpawn: [50, 2] },
    { at: [31, 0], kind: 'edge_north', to: 'floresta', toSpawn: [28, FLORESTA_H - 3] },
  ],
  portovale: [
    { at: [0, 18], kind: 'edge_west', to: 'overworld', toSpawn: [89, 12] },
  ],
  south: [
    { at: [50, 0], kind: 'edge_north', to: 'overworld', toSpawn: [65, HEIGHT - 3] },
    { at: [0, 20], kind: 'edge_west', to: 'pedreira', toSpawn: [Math.floor(PED_W / 2), 2] },
  ],
  pedreira: [
    { at: [25, 0], kind: 'edge_north', to: 'south', toSpawn: [2, 20] },
  ],
  floresta: [
    { at: [28, FLORESTA_H - 1], kind: 'edge_south', to: 'overworld', toSpawn: [31, 3] },
  ],
};

// Entradas de um mapa "ao ar livre" (overworld/portovale/south): portas de prédio
// (casa/loja/mina) + travessias de borda pros mapas vizinhos.
function worldEntrances(mapKey) {
  const ents = [...(EDGE_LINKS[mapKey] || [])];
  const list = BUILDINGS[mapKey] || [];
  const mine = list.find(b => b.type === 'mine_entrance');
  if (mine) {
    const mineUp = mineLadderPositions(1).up;
    ents.push({ at: [mine.x + Math.floor(mine.w / 2), mine.y + mine.h - 1], kind: 'mine', to: 'mine:1', toSpawn: [mineUp[0], mineUp[1] + 1] });
  }
  for (const type of ['house', 'shop']) {
    const b = list.find(bl => bl.type === type);
    if (b) ents.push({ at: [b.door[0], b.door[1] + 1], kind: 'door', to: type, toSpawn: INT_SPAWN.slice() });
  }
  return ents;
}

function initialFarmState(seed) {
  const { ground, objects } = generateOverworld(seed);
  const state = {
    v: 1,
    seed,
    day: 1, season: 0, year: 1,
    time: 6 * 60,            // minutos do dia de jogo (6:00)
    money: 500,
    ground,                  // estático após gerar (overworld)
    objects,                 // "x,y" -> {type, hp} (overworld)
    tiles: {},               // "x,y" -> {tilled, watered, crop:{id, daysGrown}} (overworld)
    bin: [],                 // [{item, qty}]
    inventories: {},         // userId -> {items:{id:qty}, energy, can:{level,max}}
    animals: [],             // [{id, type:'chicken', hx, hy}] galinhas do galinheiro
    eggs: {},                // "x,y" -> {} ovos a coletar (overworld)
    nextAnimalId: 1,
    buildings: [],           // [{id, type, x, y}] prédios construídos pelo jogador (overworld)
    nextBuildingId: 1,
    forage: {},              // "x,y" -> {type} itens para forragear (overworld)
    maps: {},                // "portovale"/"south"/"mine:N" -> {objects,tiles,forage,eggs}
    // Coleção/progresso (menu novo): registra a PRIMEIRA vez que a fazenda (não um
    // jogador individual — é cooperativo, o progresso é da fazenda toda) colhe um
    // cultivo, minera um minério ou derrota um monstro. maxDepth = nível mais fundo já
    // alcançado na mina (não precisa ter sobrevivido, só ter chegado lá).
    discovered: { crops: [], minerals: [], monsters: [], fish: [], bugs: [], maxDepth: 0 },
  };
  scatterForage(state, 25, mulberry32(seed ^ 0x9e37));
  return state;
}

// Espalha `n` forrageáveis em tiles de grama livres do OVERWORLD. Chamado na criação e
// a cada dia (Porto Vale/south/mina não têm reposição diária ainda — próximo passo).
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
    if (inRect(FARMLAND, x, y) || inBuildingVisual('overworld', x, y) || inPlayerBuildingOrYard(state, x, y)) continue;
    if (hasNearbyContent(state, x, y)) continue;
    state.forage[key] = { type: types[Math.floor(rnd() * types.length)] };
    n--;
  }
}

module.exports = {
  WIDTH, HEIGHT, TILE, PV_W, PV_H, SOUTH_W, SOUTH_H, PED_W, PED_H, FLORESTA_W, FLORESTA_H,
  BUILDINGS, BUILDING_DEFS, POND, FARMLAND, SPAWN, PRAIA,
  generateOverworld, generatePortoVale, generateSouth, generatePedreira, generateFloresta, initialFarmState,
  inBuildingVisual, buildingVisual, buildingSpotFree, collisionRect, coopYard, scatterForage,
  inPlayerBuildingOrYard, hasNearbyContent, makeMineLevel, makeInterior, worldEntrances, depthOf,
};
