// HUD em DOM: hotbar, relógio, energia, chat, modais de loja/venda, overlay de sono.
import { t } from './i18n.js';
import { escapeHtml } from './ui.js';

const $ = (id) => document.getElementById(id);
export const TOOLS = ['hoe', 'can', 'axe', 'pickaxe'];

export function itemIcon(id) {
  if (TOOLS.includes(id)) return `/assets/icons/tool_${id}.png`;
  if (id.startsWith('seed_')) return `/assets/icons/${id}.png`;
  return `/assets/icons/item_${id}.png`;
}

const RESOURCE_PRICE = { wood: 3, stone: 3, egg: 50, berry: 20, mushroom: 25 };
export const FOODS = new Set(['berry', 'mushroom']);

export function itemName(id) {
  if (TOOLS.includes(id)) return t(`tool.${id}`);
  if (id.startsWith('seed_')) return t('seed.suffix', { crop: t(`crop.${id.slice(5)}`) });
  if (id in RESOURCE_PRICE) return t(`item.${id}`);
  return t(`crop.${id}`);
}

export class Hud {
  constructor(game) {
    this.game = game;       // callbacks: sendChat, buy, sell, cancelSleep
    this.inv = { items: {}, energy: 100, can: { level: 20, max: 20 } };
    this.slots = [];        // [{id, qty}]
    this.selected = 0;
    this.crops = {};
    this.state = { money: 0, season: 0, day: 1, year: 1, time: 360, bin: [] };

    $('chat-input').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const txt = $('chat-input').value.trim();
        if (txt) this.game.sendChat(txt);
        $('chat-input').value = '';
        $('chat-input').blur();
      } else if (e.key === 'Escape') $('chat-input').blur();
    });
    document.querySelectorAll('[data-close]').forEach(b =>
      b.addEventListener('click', () => b.closest('.modal-back').classList.remove('open')));
    $('btn-cancel-sleep').addEventListener('click', () => this.game.cancelSleep());
  }

  chatFocused() { return document.activeElement === $('chat-input'); }
  focusChat() { $('chat-input').focus(); }

  addChat(name, text) {
    const log = $('chat-log');
    const div = document.createElement('div');
    div.innerHTML = `<b>${escapeHtml(name)}</b> ${escapeHtml(text)}`;
    log.appendChild(div);
    while (log.children.length > 50) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 2400);
  }

  // ---------- estado ----------
  setInv(inv) {
    this.inv = inv;
    this.renderHotbar();
    this.renderEnergy();
    if ($('modal-bin').classList.contains('open')) this.renderBin();
  }

  setTime({ time, day, season, year }) {
    Object.assign(this.state, { time, day, season, year });
    this.renderClock();
  }

  setMoney(money) {
    this.state.money = money;
    this.renderClock();
    if ($('modal-shop').classList.contains('open')) this.renderShop();
  }

  setBin(bin) {
    this.state.bin = bin;
    if ($('modal-bin').classList.contains('open')) this.renderBin();
  }

  // ---------- render ----------
  renderClock() {
    const s = this.state;
    let h = Math.floor(s.time / 60), m = Math.floor(s.time % 60);
    if (h >= 24) h -= 24;
    const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    $('hud-clock').innerHTML =
      `${t('hud.day', { day: s.day, season: t('season.' + s.season) })}<br>` +
      `🕐 ${clock} &nbsp; 💰 ${s.money}`;
  }

  renderEnergy() {
    const pct = Math.max(0, Math.min(100, this.inv.energy));
    $('hud-energy').querySelector('.fill').style.height = pct + '%';
  }

  hotbarItems() {
    const ids = Object.keys(this.inv.items);
    const seeds = ids.filter(i => i.startsWith('seed_')).sort();
    const rest = ids.filter(i => !i.startsWith('seed_')).sort();
    return [
      ...TOOLS.map(id => ({ id, qty: null })),
      ...seeds.map(id => ({ id, qty: this.inv.items[id] })),
      ...rest.map(id => ({ id, qty: this.inv.items[id] })),
    ];
  }

  renderHotbar() {
    this.slots = this.hotbarItems();
    if (this.selected >= this.slots.length) this.selected = 0;
    const bar = $('hotbar');
    bar.innerHTML = '';
    this.slots.forEach((s, i) => {
      const food = FOODS.has(s.id);
      const div = document.createElement('div');
      div.className = 'slot' + (i === this.selected ? ' active' : '') + (food ? ' food' : '');
      div.title = food ? t('food.eat', { item: itemName(s.id) })
        : itemName(s.id) + (s.id === 'can' ? ` (${this.inv.can.level}/${this.inv.can.max})` : '');
      div.innerHTML = `<span class="key">${i + 1 <= 9 ? i + 1 : ''}</span><img src="${itemIcon(s.id)}" alt="">` +
        (s.qty != null ? `<span class="qty">${s.qty}</span>` : '') +
        (food ? `<span class="eat-badge">🍴</span>` : '') +
        (s.id === 'can' ? `<span class="qty" style="color:#3b82c4">${this.inv.can.level}</span>` : '');
      // comida: clicar come (é consumível, não ferramenta); demais: selecionam
      div.addEventListener('click', () => { if (food) this.game.eat(s.id); else this.select(i); });
      bar.appendChild(div);
    });
  }

  select(i) {
    if (i < 0 || i >= this.slots.length) return;
    this.selected = i;
    this.renderHotbar();
  }

  selectedItem() { return this.slots[this.selected] || null; }

  // ---------- loja ----------
  openShop() {
    this.renderShop();
    $('modal-shop').classList.add('open');
  }

  renderShop() {
    $('shop-money').textContent = t('shop.money', { money: this.state.money });
    const box = $('shop-items');
    box.innerHTML = '';
    if (!this.shopTab) this.shopTab = 'seeds';

    // abas
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    for (const [id, key] of [['seeds', 'shop.tabSeeds'], ['build', 'shop.tabBuild']]) {
      const tb = document.createElement('button');
      tb.textContent = t(key);
      tb.className = this.shopTab === id ? 'active' : '';
      tb.addEventListener('click', () => { this.shopTab = id; this.renderShop(); });
      tabs.appendChild(tb);
    }
    box.appendChild(tabs);

    if (this.shopTab === 'seeds') this.renderShopSeeds(box);
    else this.renderShopBuild(box);
  }

  renderShopSeeds(box) {
    // galinha (animal)
    const coop = document.createElement('div');
    coop.className = 'shop-item';
    coop.innerHTML = `<img src="/assets/icons/item_egg.png" alt="">
      <div class="grow"><b>${t('shop.chicken')}</b><br>💰100 · ${t('shop.chickenDesc')}</div>`;
    const cb = document.createElement('button');
    cb.textContent = t('shop.buy');
    cb.addEventListener('click', () => this.game.buyAnimal());
    coop.appendChild(cb);
    box.appendChild(coop);

    for (const [id, def] of Object.entries(this.crops)) {
      const inSeason = def.season === this.state.season;
      const div = document.createElement('div');
      div.className = 'shop-item';
      div.style.opacity = inSeason ? '1' : '.5';
      div.innerHTML = `<img src="/assets/icons/seed_${id}.png" alt="">
        <div class="grow"><b>${itemName('seed_' + id)}</b><br>
        💰${def.seedPrice} · ${t('season.' + def.season)}${inSeason ? '' : ' — ' + t('shop.outOfSeason')} · ${def.days}d</div>`;
      const b1 = document.createElement('button');
      b1.textContent = `${t('shop.buy')} 1`;
      b1.disabled = !inSeason;
      b1.addEventListener('click', () => this.game.buy(id, 1));
      const b5 = document.createElement('button');
      b5.textContent = '5';
      b5.disabled = !inSeason;
      b5.addEventListener('click', () => this.game.buy(id, 5));
      div.append(b1, b5);
      box.appendChild(div);
    }
  }

  renderShopBuild(box) {
    const names = { coop: 'shop.coop', coopDesc: 'shop.coopDesc' };
    const have = { wood: this.inv.items.wood || 0, stone: this.inv.items.stone || 0 };
    for (const [type, def] of Object.entries(this.buildingDefs || {})) {
      const cost = def.cost || {};
      const parts = [];
      if (cost.wood) parts.push(`🪵${cost.wood}`);
      if (cost.stone) parts.push(`🪨${cost.stone}`);
      if (cost.money) parts.push(`💰${cost.money}`);
      const enough = (cost.wood || 0) <= have.wood && (cost.stone || 0) <= have.stone && (cost.money || 0) <= this.state.money;
      const div = document.createElement('div');
      div.className = 'shop-item';
      div.style.opacity = enough ? '1' : '.55';
      div.innerHTML = `<img src="/assets/${type}_icon.png" alt="">
        <div class="grow"><b>${t(names[type] || type)}</b><br>${parts.join(' · ')} · ${t(names[type + 'Desc'] || '')}</div>`;
      const b = document.createElement('button');
      b.textContent = t('shop.build');
      b.disabled = !enough;
      b.addEventListener('click', () => this.game.build(type));
      div.appendChild(b);
      box.appendChild(div);
    }
  }

  // ---------- caixa de venda ----------
  openBin() {
    this.renderBin();
    $('modal-bin').classList.add('open');
  }

  renderBin() {
    const box = $('bin-sell-items');
    box.innerHTML = '';
    const sellable = Object.entries(this.inv.items).filter(([id]) => !id.startsWith('seed_'));
    for (const [id, qty] of sellable) {
      const price = this.crops[id] ? this.crops[id].sellPrice : (RESOURCE_PRICE[id] || 0);
      const div = document.createElement('div');
      div.className = 'shop-item';
      div.innerHTML = `<img src="${itemIcon(id)}" alt="">
        <div class="grow"><b>${itemName(id)}</b> ×${qty}<br>💰${price} ${t('bin.sell').toLowerCase()}</div>`;
      const b1 = document.createElement('button');
      b1.textContent = `${t('bin.sell')} 1`;
      b1.addEventListener('click', () => this.game.sell(id, 1));
      const ball = document.createElement('button');
      ball.textContent = `×${qty}`;
      ball.addEventListener('click', () => this.game.sell(id, qty));
      div.append(b1, ball);
      box.appendChild(div);
    }
    const content = this.state.bin.length
      ? this.state.bin.map(e => `${itemName(e.item)} ×${e.qty}`).join(', ')
      : t('bin.empty');
    $('bin-content').textContent = content;
  }

  anyModalOpen() {
    return document.querySelector('.modal-back.open') !== null || $('sleep-overlay').style.display === 'flex';
  }

  closeModals() {
    document.querySelectorAll('.modal-back.open').forEach(m => m.classList.remove('open'));
  }

  // ---------- sono ----------
  showSleep(waitingNames) {
    $('sleep-details').innerHTML = waitingNames && waitingNames.length
      ? escapeHtml(t('sleep.waiting', { names: waitingNames.join(', ') }))
      : '';
    $('btn-cancel-sleep').style.display = 'inline-block';
    $('sleep-overlay').style.display = 'flex';
  }

  hideSleep() { $('sleep-overlay').style.display = 'none'; }

  showDaySummary(data) {
    const lines = [t('day.summary', { day: data.day, season: t('season.' + data.season), year: data.year })];
    if (data.payout > 0) {
      const sold = data.soldItems.map(e => `${itemName(e.item)} ×${e.qty}`).join(', ');
      lines.push(`${t('day.payout', { payout: data.payout })} (${sold})`);
    }
    if (data.passedOut) lines.push(t('day.passedOut'));
    $('sleep-details').innerHTML = lines.map(escapeHtml).join('<br>');
    $('btn-cancel-sleep').style.display = 'none';
    $('sleep-overlay').style.display = 'flex';
    clearTimeout(this._sleepT);
    this._sleepT = setTimeout(() => this.hideSleep(), 4000);
  }
}
