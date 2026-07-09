// Backup do banco na nuvem (Turso/libSQL) — mantém o progresso mesmo em hosts
// sem disco persistente (ex: Render free). Guarda o SQLite inteiro como 1 blob.
// Se TURSO_DATABASE_URL/TURSO_AUTH_TOKEN não estiverem definidos, não faz nada
// (o jogo usa o arquivo local normalmente — bom para desenvolvimento).
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'greenvale.db');
const URL = process.env.TURSO_DATABASE_URL;
const TOKEN = process.env.TURSO_AUTH_TOKEN;

let client = null;
if (URL && TOKEN) {
  const { createClient } = require('@libsql/client');
  client = createClient({ url: URL, authToken: TOKEN });
}

const enabled = () => !!client;

// Baixa o backup mais recente e grava em data/greenvale.db ANTES de abrir o banco.
async function restore() {
  if (!client) return;
  await client.execute(
    'CREATE TABLE IF NOT EXISTS db_backup (id INTEGER PRIMARY KEY, data BLOB, updated_at TEXT)'
  );
  const rs = await client.execute('SELECT data FROM db_backup WHERE id = 1');
  if (rs.rows.length && rs.rows[0].data) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const data = rs.rows[0].data;
    fs.writeFileSync(DB_PATH, Buffer.isBuffer(data) ? data : Buffer.from(data));
    console.log('[backup] banco restaurado da nuvem (Turso)');
  } else {
    console.log('[backup] sem backup na nuvem ainda — começando limpo');
  }
}

// Serializa o banco atual e envia como blob único para a nuvem.
async function save(db) {
  if (!client) return;
  try {
    const buf = db.serialize(); // snapshot consistente do SQLite
    await client.execute({
      sql: "INSERT OR REPLACE INTO db_backup (id, data, updated_at) VALUES (1, ?, datetime('now'))",
      args: [buf],
    });
  } catch (e) {
    console.error('[backup] falha ao salvar na nuvem:', e.message);
  }
}

// Salva periodicamente e ao desligar (Render manda SIGTERM antes de dormir).
function startAutoSave(db, intervalMs = 120000) {
  if (!client) return;
  setInterval(() => save(db), intervalMs);
  const flush = async () => { await save(db); process.exit(0); };
  process.on('SIGTERM', flush);
  process.on('SIGINT', flush);
  console.log('[backup] auto-save na nuvem ativo (a cada', intervalMs / 1000, 's)');
}

module.exports = { enabled, restore, save, startAutoSave };
