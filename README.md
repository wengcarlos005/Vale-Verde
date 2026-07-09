# 🌱 Vale Verde / Greenvale

Jogo de fazenda cooperativo para web (estilo Stardew Valley), com **multiplayer de até 6 jogadores por fazenda**, em PT-BR e Inglês.

> **⚠️ Deploy:** este jogo **não roda no Vercel** (precisa de servidor Node persistente com WebSocket). Rode de graça no **Render** + **Turso** (salva o progresso na nuvem, sem cartão) — passo a passo em [`DEPLOY.md`](DEPLOY.md).
>
> **🔒 Licença:** os sprites vêm de um pack pago que proíbe redistribuição — mantenha este repositório **privado**.

## Rodar

```
npm install
npm start          # http://localhost:8140
```

O servidor Node serve o client, a API e o WebSocket em uma porta só (padrão `8140`, configurável via `PORT`).

## Como funciona

- **Conta**: registro/login com e-mail e senha (bcrypt + JWT, 30 dias).
- **Fazenda**: quem cria recebe um código (ex: `VV-ABCD`); até 6 jogadores entram com esse código. Cada fazenda é um mundo persistente (SQLite em `data/greenvale.db`).
- **Jogo**: arar (enxada), plantar (10 cultivos em 3 estações), regar (encha o regador no lago), colher, cortar árvores, minerar pedras, comprar sementes/galinhas na loja do Bob, vender na caixa ao lado da casa (pagamento chega quando todos dormirem). 1 dia de jogo = 15 minutos reais; energia limitada — durma na porta da casa.
- **Animais**: compre galinhas (máx. 6); elas ciscam no quintal do galinheiro e botam 1 ovo por dia — colete e venda por 50.
- **Controles**: WASD/setas movem · clique ou Espaço usa o item · 1–9 seleciona · E interage (loja/caixa/dormir) · Enter abre o chat.

## Estrutura

```
server/           Express + Socket.IO + better-sqlite3 (autoritativo)
  game/rooms.js   salas por fazenda: tick de tempo, ações validadas, save
  game/world.js   geração do mapa 60x50
  game/crops.js   definições dos cultivos
client/           Phaser 3 sem bundler (módulos ES servidos direto)
  src/game.js     cena do jogo, multiplayer, predição de movimento
  src/hud.js      HUD DOM (hotbar, loja, caixa, chat, sono)
  src/i18n/       pt-BR.json / en.json
tools/            extract_assets.py (recorta o pack Cute Fantasy), sim_player.js (teste multiplayer)
```

## Assets

Sprites do pack **Cute Fantasy (Kenmi)** — licença premium permite uso comercial, mas **proíbe redistribuir os arquivos do pack**: não torne público um repositório contendo `client/assets/` nem a pasta original do pack. Os recortes são gerados por `python tools/extract_assets.py` (requer o pack no OneDrive, caminho no topo do script).

## Monetização

- **Doações**: configure a URL em `client/src/main.js` (`DONATE_URL`) — Ko-fi, PIX, etc.
- **Anúncios**: há espaços reservados (`.ad-slot`). Ativação real do AdSense: ver `DEPLOY.md`.

## Testar multiplayer localmente

```
node tools/sim_player.js amigo@teste.dev Bruno VV-XXXX 20000
```
Simula um segundo jogador entrando na fazenda pelo código, andando e conversando por 20 s.
