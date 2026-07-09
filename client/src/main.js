import { initI18n } from './i18n.js';
import { initUI, showScreen } from './ui.js';
import { startGame } from './game.js';

// Link de doação — configure aqui (Ko-fi, PIX, etc.)
const DONATE_URL = 'https://ko-fi.com/';

async function boot() {
  await initI18n();
  document.getElementById('donate-link').href = DONATE_URL;
  initUI({
    onPlay: (farm) => {
      showScreen('game');
      startGame(farm);
    },
  });
}

boot();
