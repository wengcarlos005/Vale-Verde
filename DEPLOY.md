# Deploy do Vale Verde

## ⚠️ Importante: o Vercel NÃO serve para este jogo

O Vale Verde é um **servidor Node.js persistente** (Express + **Socket.IO** para o multiplayer em tempo real + **SQLite** em disco + salas de jogo mantidas em memória). O Vercel roda **funções serverless** de vida curta e sem estado, o que é **incompatível** com este jogo:

- **WebSocket / Socket.IO** precisa de um servidor sempre ligado — funções serverless do Vercel encerram após cada requisição e não mantêm conexões abertas.
- **Estado das salas em memória** (posições dos jogadores, tempo, etc.) seria perdido a cada invocação.
- **SQLite em arquivo** não persiste no sistema de arquivos efêmero do Vercel.

Ou seja: o multiplayer simplesmente **não funciona no Vercel**. Use uma das opções abaixo, que hospedam servidores Node persistentes com WebSocket e disco. São igualmente fáceis e têm plano gratuito.

## ✅ Recomendado: Render (servidor) + Turso (salva o progresso) — tudo GRÁTIS

Duas contas gratuitas, sem cartão de crédito. O Render roda o jogo; o Turso guarda
o progresso na nuvem (o servidor faz backup automático a cada 2 min e ao desligar).

### Parte 1 — Turso (banco na nuvem, grátis)

1. Acesse [turso.tech](https://turso.tech) e faça login (GitHub ou Google).
2. Crie uma database (**Create Database** / **+**), dê um nome (ex: `vale-verde`).
3. Na página da database, copie a **Database URL** (começa com `libsql://...`).
4. Gere um token: **Create Token** (ou "Generate token") e copie o valor.
   Guarde os dois — vão para o Render no próximo passo.

### Parte 2 — Render (servidor do jogo, grátis)

1. Repositório **privado** no GitHub (obrigatório — ver licença abaixo).
2. Em [render.com](https://render.com), login com o GitHub.
3. **New** → **Blueprint** → escolha o repositório `Vale-Verde` → **Apply**.
   O `render.yaml` configura build, start e o `JWT_SECRET`.
4. Ele vai pedir os valores de **TURSO_DATABASE_URL** e **TURSO_AUTH_TOKEN**
   (marcados como `sync: false`): cole os dois que você copiou do Turso.
   *(Se não pedir na hora: abra o serviço → **Environment** → adicione as duas
   variáveis → **Save**, que ele redeploya.)*
5. Em 1-3 min a URL sai como `https://vale-verde.onrender.com` — compartilhe!

> **Plano free do Render:** o serviço "dorme" após ~15 min sem ninguém online
> (o 1º a entrar espera ~50 s para acordar). Com o Turso configurado, **o
> progresso é preservado** ao acordar — a fazenda continua onde parou. Sem o
> Turso, o jogo roda mas a fazenda zera a cada reinício.

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
