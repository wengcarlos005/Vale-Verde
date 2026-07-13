// Definições dos cultivos da v1. Nomes exibidos ficam no i18n do client (crop.<id>).
// season: 0 primavera, 1 verão, 2 outono, 3 inverno (nada cresce no inverno).
// stages visuais no client: 0..4 (4 = pronto para colher).
const CROPS = {
  turnip:     { season: 0, days: 4,  seedPrice: 20,  sellPrice: 35 },
  potato:     { season: 0, days: 6,  seedPrice: 50,  sellPrice: 80 },
  carrot:     { season: 0, days: 5,  seedPrice: 30,  sellPrice: 50 },
  strawberry: { season: 0, days: 8,  seedPrice: 100, sellPrice: 150 },
  tomato:     { season: 1, days: 7,  seedPrice: 50,  sellPrice: 90 },
  corn:       { season: 1, days: 9,  seedPrice: 80,  sellPrice: 140 },
  pepper:     { season: 1, days: 6,  seedPrice: 40,  sellPrice: 70 },
  onion:      { season: 2, days: 8,  seedPrice: 90,  sellPrice: 180 },
  cabbage:    { season: 2, days: 7,  seedPrice: 70,  sellPrice: 120 },
  beet:       { season: 2, days: 5,  seedPrice: 40,  sellPrice: 70 },
};

// Itens vendáveis não-cultivo
const RESOURCES = {
  wood:  { sellPrice: 3 },
  stone: { sellPrice: 3 },
  egg:   { sellPrice: 50 },
  berry: { sellPrice: 20 },
  mushroom: { sellPrice: 25 },
  // minérios da mina (Fase C) — raridade decrescente: ferro comum, cobre médio, ouro raro.
  iron: { sellPrice: 15 },
  copper: { sellPrice: 25 },
  gold: { sellPrice: 55 },
};

// Minérios espalhados pela mina, com raridade (contagem) decrescente.
const ORE_SPAWN = [
  ['iron', 26],
  ['copper', 16],
  ['gold', 6],
];

// Comida: recupera energia ao comer.
const FOOD = {
  berry:    { energy: 12 },
  mushroom: { energy: 18 },
};

// Forrageáveis espalhados pelo mapa e o que dão ao coletar.
// give = item ganho; qty = quantidade.
const FORAGE = {
  berry:    { give: 'berry', qty: 1 },
  mushroom: { give: 'mushroom', qty: 1 },
  log:      { give: 'wood', qty: 2 },
};

// Receitas da bancada de fabricação: custo em recursos → item dado ao inventário.
const RECIPES = {
  fence: { cost: { wood: 4 }, give: 'fence', qty: 1 },
  // Armas de combate (mina) — craftadas igual a qualquer receita, viram selecionáveis
  // no hotbar como uma ferramenta comum (ver WEAPONS no client).
  sword: { cost: { wood: 2, iron: 2 }, give: 'sword', qty: 1 },
  spear: { cost: { wood: 3, iron: 1 }, give: 'spear', qty: 1 },
  bow: { cost: { wood: 3, stone: 1 }, give: 'bow', qty: 1 },
  shield: { cost: { wood: 2, stone: 3 }, give: 'shield', qty: 1 },
};

// Estatísticas de combate por arma. `range` em tiles (folga extra aplicada no cliente e
// no servidor pra compensar posição contínua vs. tile). Espada = curto alcance, dano
// alto; lança = alcance médio; arco = alcance longo, tiro à distância simplificado (sem
// física de projétil — o servidor resolve o acerto na hora, ver rooms.js). Escudo não
// ataca (damage 0) — `block` é a fração de dano por contato reduzida quando equipado.
const WEAPON_STATS = {
  sword: { range: 1.3, damage: 3 },
  spear: { range: 2.3, damage: 2 },
  bow: { range: 4.5, damage: 2 },
  shield: { range: 0, damage: 0, block: 0.5 },
};

// Pedidos do quadro de recados: só itens sempre obteníveis (não presos à estação).
const QUEST_POOL = [
  { item: 'wood', qty: 12 },
  { item: 'stone', qty: 8 },
  { item: 'egg', qty: 3 },
  { item: 'berry', qty: 6 },
  { item: 'mushroom', qty: 5 },
];

function pickQuest(rnd = Math.random) {
  const t = QUEST_POOL[Math.floor(rnd() * QUEST_POOL.length)];
  const reward = Math.round(RESOURCES[t.item].sellPrice * t.qty * 1.5);
  return { item: t.item, qty: t.qty, reward };
}

const CHICKEN_PRICE = 100;
const MAX_CHICKENS = 6;

function stageOf(crop, daysGrown) {
  const def = CROPS[crop];
  if (daysGrown >= def.days) return 4;
  return Math.min(3, Math.floor((daysGrown / def.days) * 4));
}

module.exports = { CROPS, RESOURCES, FOOD, FORAGE, RECIPES, WEAPON_STATS, ORE_SPAWN, pickQuest, stageOf, CHICKEN_PRICE, MAX_CHICKENS };
