const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

function sign(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

async function authenticate(email, password) {
  const result = await db.query(
    'SELECT id, name, email, password_hash, role, active FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  const user = result.rows[0];
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) return null;
  return user;
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Permissão insuficiente.' });
    next();
  };
}

module.exports = { sign, authenticate, requireAuth, requireRole };
