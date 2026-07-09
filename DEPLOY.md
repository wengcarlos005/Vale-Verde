# Deploy do Vale Verde

## ⚠️ Importante: o Vercel NÃO serve para este jogo

O Vale Verde é um **servidor Node.js persistente** (Express + **Socket.IO** para o multiplayer em tempo real + **SQLite** em disco + salas de jogo mantidas em memória). O Vercel roda **funções serverless** de vida curta e sem estado, o que é **incompatível** com este jogo:

- **WebSocket / Socket.IO** precisa de um servidor sempre ligado — funções serverless do Vercel encerram após cada requisição e não mantêm conexões abertas.
- **Estado das salas em memória** (posições dos jogadores, tempo, etc.) seria perdido a cada invocação.
- **SQLite em arquivo** não persiste no sistema de arquivos efêmero do Vercel.

Ou seja: o multiplayer simplesmente **não funciona no Vercel**. Use uma das opções abaixo, que hospedam servidores Node persistentes com WebSocket e disco. São igualmente fáceis e têm plano gratuito.

## ✅ Opção recomendada: Render (grátis, tem `render.yaml` pronto)

1. Repositório **privado** no GitHub (obrigatório — ver seção de licença abaixo).
2. Em [render.com](https://render.com), faça login com o GitHub.
3. **New** → **Blueprint** → escolha o repositório `Vale-Verde`.
   O `render.yaml` já configura tudo: build `npm install`, start `npm start`, `JWT_SECRET` gerado.
4. **Apply** / **Create**. Em 1-3 min a URL sai como `https://vale-verde.onrender.com` — compartilhe com os amigos.

> **Plano free:** o serviço "dorme" após ~15 min sem acesso (o 1º jogador espera ~50 s para acordar) e **não salva o progresso** entre reinícios (sem disco no free). Dá para jogar numa sessão, mas a fazenda zera quando o serviço dorme. Para **salvar de verdade**: descomente o bloco `disk` no `render.yaml` e suba para o plano Starter (pago), **ou** use Railway/Fly (volume no free).

## ✅ Alternativa: Railway

1. Em [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. Build `npm install`, Start `npm start` (o `Procfile` já indica). A porta é lida de `process.env.PORT` (automático).
3. **Adicione um Volume** montado em `/app/data` (senão o progresso zera a cada deploy).
4. Variável de ambiente `JWT_SECRET` = uma string longa aleatória.

## ✅ Alternativa: Fly.io

Suporta WebSocket e volumes persistentes. `fly launch` detecta o Node; adicione um volume montado em `/app/data` e defina `JWT_SECRET`.

---

## 🔒 Licença dos sprites — o repositório TEM que ser privado

Os sprites em `client/assets/` derivam do pack **Cute Fantasy (Kenmi)**, cuja licença permite uso comercial mas **proíbe redistribuição**. Publicar esses arquivos num repositório **público** viola a licença. Portanto:

- Mantenha o repositório `Vale-Verde` como **Private** no GitHub (Settings → Danger Zone → Change visibility).
- Render/Railway/Fly acessam repositórios privados normalmente após você autorizar o GitHub.

## Domínio próprio e anúncios

- Aponte um domínio (ex: Registro.br) para a plataforma via CNAME; HTTPS é automático.
- AdSense exige domínio próprio + aprovação do Google. Alternativas para jogos: Poki / CrazyGames. Ative só no menu/lobby.
- Doações: edite `DONATE_URL` em `client/src/main.js`.

## Checklist

- [ ] Repositório **privado**
- [ ] `JWT_SECRET` definido no ambiente
- [ ] Disco/volume persistente montado em `data/`
- [ ] `DONATE_URL` configurada
- [ ] Testado com 2+ pessoas em redes diferentes
