const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { stmts } = require('./db');

// Segredo JWT persistido em data/ para as sessões sobreviverem a restarts.
const SECRET_FILE = path.join(__dirname, '..', 'data', 'jwt.secret');
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (fs.existsSync(SECRET_FILE)) {
    JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } else {
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, JWT_SECRET);
  }
}

function signToken(user) {
  return jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// Middleware para rotas HTTP autenticadas
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const payload = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = payload;
  next();
}

const router = express.Router();

router.post('/register', (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (!name || name.trim().length < 2 || name.trim().length > 16) return res.status(400).json({ error: 'invalid_name' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'weak_password' });
  if (stmts.userByEmail.get(email.toLowerCase())) return res.status(409).json({ error: 'email_taken' });
  const hash = bcrypt.hashSync(password, 10);
  const info = stmts.createUser.run(email.toLowerCase(), name.trim(), hash);
  const user = { id: info.lastInsertRowid, name: name.trim(), email: email.toLowerCase() };
  res.json({ token: signToken(user), user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = email && stmts.userByEmail.get(String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.pass_hash)) {
    return res.status(401).json({ error: 'bad_credentials' });
  }
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email } });
});

module.exports = { router, verifyToken, requireAuth };
