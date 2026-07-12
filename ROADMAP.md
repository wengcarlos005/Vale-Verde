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

- ✅ **Quadro de recados:** placa fixa na praça (entre a caixa de venda e a loja) — aperte E
  pra ver o pedido atual ("entregue 3 ovos", "entregue 12 madeira" etc., sempre itens não
  presos à estação: madeira/pedra/ovo/cereja/cogumelo). Entregar dá uma recompensa em moedas
  (melhor que vender direto) e sorteia um novo pedido; todo mundo na fazenda vê no chat quem
  entregou. Servidor valida proximidade da placa e quantidade antes de aceitar. Só 1 pedido
  ativo por vez (fica esperando até alguém entregar, não expira). Próximo passo natural:
  pedidos variados por dia/NPC específico, e recompensas em itens além de moedas.
- **NPCs com falas:** o Bob (loja) e novos NPCs (pescador, ferreiro) ganham diálogo ao
  interagir (E). Sistema de balões de fala + janela de diálogo (DOM).
- **Amizade:** dar itens preferidos aos NPCs aumenta amizade → descontos, receitas, missões novas.

## Fase C — Novos cenários (cidade e além)

- ✅ **Vila (v1):** em vez de um "room"/mapa separado (que exigiria trocar de cenário, salvar
  estado à parte, sincronizar handoff entre jogadores etc.), o mapa único cresceu pra leste
  (60→92 tiles de largura) e ganhou uma praça de vila conectada à fazenda por uma estrada reta
  bem longa — a "rota de transição" é literal, dá pra ver ela vindo de longe e caminhar até lá,
  sem tela de carregamento. O **quadro de recados** morou pra lá (antes ficava na praça da
  fazenda); tem também uma **casa de pedra** (arquitetura diferente da fazenda, pra dar
  identidade própria à vila) — por ora só decorativa, sem loja ligada.
  Próximo passo natural: dar função à casa de pedra (loja de verdade — sementeiro/ferreiro/
  mercado) e povoar a vila com NPCs. Se um dia isso crescer demais pro mapa único ficar
  gigante, aí sim vale considerar trocar pra rooms/mapas separados de verdade (a nota técnica
  abaixo sobre `mapId` continua valendo como plano B).
- ✅ **Porto Vale (cidade grande) + mina + praia:** mapa cresceu de novo (92×50 → 150×80).
  A estrada da vila continua até Porto Vale, cidade litorânea maior com 2 casas
  decorativas de arquitetura própria (calcário bege + madeira verde). Uma bifurcação
  nova sai perto da praça da vila e desce pro sul, dividindo em dois ramais: **mina**
  (chão de caverna cercado por parede, entrada esculpida na rocha) e **praia** (areia +
  oceano aberto em costa diagonal, sem lago redondo). A mina já tem minério de verdade:
  ferro/cobre/ouro (raridade decrescente) espalhados só lá dentro, minerados com a
  picareta igual pedra, vendáveis na caixa. Porto Vale e a praia ainda são só
  cenário/atmosfera — sem loja ligada nem pesca. Próximo passo natural: dar função às
  casas de Porto Vale (ferreiro/sementeiro/mercado — o ferro/cobre/ouro já mineráveis
  pedem uma forja) e o minigame de pesca na praia/lago.
- **Mais bairros/vilarejos:** o mesmo padrão (praça + estrada) pode repetir em outras direções
  do mapa pra criar mais povoados, sem precisar de arquitetura nova.

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
