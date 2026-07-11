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
};

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
};

const CHICKEN_PRICE = 100;
const MAX_CHICKENS = 6;

function stageOf(crop, daysGrown) {
  const def = CROPS[crop];
  if (daysGrown >= def.days) return 4;
  return Math.min(3, Math.floor((daysGrown / def.days) * 4));
}

module.exports = { CROPS, RESOURCES, FOOD, FORAGE, RECIPES, stageOf, CHICKEN_PRICE, MAX_CHICKENS };
