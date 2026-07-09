const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'greenvale.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS farms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  state TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS farm_members (
  farm_id INTEGER NOT NULL REFERENCES farms(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  appearance TEXT NOT NULL DEFAULT '{}',
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (farm_id, user_id)
);
`);

const stmts = {
  createUser: db.prepare('INSERT INTO users (email, name, pass_hash) VALUES (?, ?, ?)'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT id, email, name FROM users WHERE id = ?'),

  createFarm: db.prepare('INSERT INTO farms (code, name, owner_id, state) VALUES (?, ?, ?, ?)'),
  farmByCode: db.prepare('SELECT * FROM farms WHERE code = ?'),
  farmById: db.prepare('SELECT * FROM farms WHERE id = ?'),
  saveFarmState: db.prepare("UPDATE farms SET state = ?, updated_at = datetime('now') WHERE id = ?"),

  addMember: db.prepare('INSERT OR IGNORE INTO farm_members (farm_id, user_id) VALUES (?, ?)'),
  memberCount: db.prepare('SELECT COUNT(*) AS n FROM farm_members WHERE farm_id = ?'),
  isMember: db.prepare('SELECT 1 FROM farm_members WHERE farm_id = ? AND user_id = ?'),
  membersOfFarm: db.prepare(`
    SELECT u.id, u.name, fm.appearance FROM farm_members fm
    JOIN users u ON u.id = fm.user_id WHERE fm.farm_id = ?`),
  farmsOfUser: db.prepare(`
    SELECT f.id, f.code, f.name, f.owner_id,
      (SELECT COUNT(*) FROM farm_members m2 WHERE m2.farm_id = f.id) AS members
    FROM farm_members fm JOIN farms f ON f.id = fm.farm_id
    WHERE fm.user_id = ? ORDER BY f.created_at DESC`),
  setAppearance: db.prepare('UPDATE farm_members SET appearance = ? WHERE farm_id = ? AND user_id = ?'),
  getAppearance: db.prepare('SELECT appearance FROM farm_members WHERE farm_id = ? AND user_id = ?'),
};

module.exports = { db, stmts };
