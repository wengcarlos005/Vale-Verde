# Roadmap do Vale Verde

Estado atual (v1): fazenda co-op multiplayer com contas, cultivos/estações, ferramentas
com animação, galinhas/ovos, economia, dia-noite, chat, i18n, deploy no Render + Turso.

Abaixo, o plano de evolução em ordem sugerida. Cada item é uma "fatia" que dá para
entregar e testar separadamente.

## ✅ Sistema de construção (feito)

Prédios são **comprados com materiais** (madeira/pedra/moedas) e **posicionados** pelo
jogador: na loja do Bob há a aba **🔨 Construir**; ao escolher, entra no modo de
posicionamento (fantasma segue o cursor, verde = ok / vermelho = inválido), clique
posiciona, ESC cancela. O servidor valida posição e materiais. O **galinheiro** já usa
esse sistema (30 madeira + 10 pedra); só dá para comprar galinhas depois de construir um.
Próximos prédios (celeiro, estufa, silo, baú, cerca) entram como novas entradas em
`BUILDING_DEFS` — a mecânica já está pronta.

## Fase A — Coleta e sobrevivência

- ✅ **Forrageio (comida que dá energia):** cerejas, cogumelos e lenha espalhados pelo mapa
  (25 no início, +8 por dia), coletados como os ovos. Cerejas/cogumelos são **comida** —
  clique na hotbar para **comer e recuperar energia**; também dão para vender. Lenha dá madeira.
- ✅ **Fabricação simples (crafting):** bancada de fabricação (bigorna) perto da casa, na praça —
  aperte E perto dela pra abrir. Receita v1: 4 madeira → 1 cerca. A cerca fabricada vai pro
  inventário como item da hotbar; selecione-a e clique na grama para "plantá-la" (mesmo padrão
  de clique das sementes), o que a transforma num poste de cerca real no mapa (conecta
  visualmente com outras cercas vizinhas, inclusive as do mapa original). Servidor valida
  proximidade da bancada e materiais antes de fabricar, e valida o tile antes de colocar.
  Novas receitas entram só adicionando entradas em `RECIPES` (`server/game/crops.js`) — a
  bancada, o modal e a validação já estão prontos para qualquer receita futura.

## Fase B — NPCs e missões

- **NPCs com falas:** o Bob (loja) e novos NPCs (pescador, ferreiro) ganham diálogo ao
  interagir (E). Sistema de balões de fala + janela de diálogo (DOM).
- **Missões / quadro de recados:** um mural na praça com pedidos ("entregue 10 nabos",
  "corte 5 árvores") que dão recompensa (moedas/itens). Estado das missões salvo por fazenda.
- **Amizade:** dar itens preferidos aos NPCs aumenta amizade → descontos, receitas, missões novas.

## Fase C — Novos cenários (cidade e além)

- **Vila / cidade:** um segundo mapa conectado por uma estrada na borda norte. Tem lojas
  (sementeiro, ferreiro, mercado), NPCs e o quadro de missões. Troca de mapa = novo "room"
  no servidor com seu próprio estado; o jogador transita entre fazenda e vila.
- **Mina / caverna:** entrada numa encosta; andares com pedras/minérios (o pack tem tiles de
  caverna e minérios). Picareta coleta minério → forja na cidade.
- **Floresta / lago de pesca:** minigame de pesca no lago (o pack tem vara e peixes).

## Fase D — Progressão de longo prazo

- **Melhorias da fazenda:** comprar upgrades (regador maior, mochila, celeiro, estufa).
- **Mais animais:** vacas (leite) e ovelhas (lã) — o pack tem os sprites; reusar o sistema
  das galinhas com produto diário.
- **Estações e eventos:** festivais sazonais na cidade, clima (chuva rega sozinho — efeitos
  de chuva já existem no pack).

## Notas técnicas para implementar

- Novos coletáveis seguem o padrão de `eggs`/`onAction('collect')` no servidor.
- Troca de cenário: generalizar `Room` para aceitar um `mapId`; o cliente recarrega o mundo
  no evento `joined` (a tela de carregamento já cobre a transição).
- Missões/NPCs: guardar no JSON de estado da fazenda (`state.quests`, `state.npcFriendship`).
- Tudo continua salvando de graça via Turso (backup do SQLite inteiro).
