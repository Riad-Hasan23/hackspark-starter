const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8001;
const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret';
const CENTRAL_API_URL = process.env.CENTRAL_API_URL;
const CENTRAL_API_TOKEN = process.env.CENTRAL_API_TOKEN;

app.use(express.json());

// ── Request counter for monitoring ──────────────────────────────────────────
let requestCount = 0;

// ── In-memory cache ─────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// ── Postgres ────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Database initialized');
}

// ── Central API client with retry (B2) + caching + logging ──────────────────
async function centralGet(path, maxRetries = 3) {
  const cached = getCached(path);
  if (cached) return cached;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      requestCount++;
      console.log(`[API #${requestCount}] GET ${path}`);
      const res = await axios.get(`${CENTRAL_API_URL}${path}`, {
        headers: { Authorization: `Bearer ${CENTRAL_API_TOKEN}` },
        timeout: 30000,
      });
      setCache(path, res.data);
      return res.data;
    } catch (err) {
      if (err.response && err.response.status === 429 && attempt < maxRetries) {
        const retryAfter = err.response.data?.retryAfterSeconds || 10;
        const backoff = retryAfter * Math.pow(2, attempt);
        const jitter = backoff * (0.8 + Math.random() * 0.4);
        console.log(`[retry ${attempt + 1}/${maxRetries}] waiting ${Math.round(jitter)}s before retrying GET ${path}`);
        await new Promise(r => setTimeout(r, jitter * 1000));
        continue;
      }
      throw err;
    }
  }
}

// ── JWT middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── P1: Health check ────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ service: 'user-service', status: 'OK' });
});

// ── P2: Register ────────────────────────────────────────────────────────────
app.post('/users/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, password_hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── P2: Login ───────────────────────────────────────────────────────────────
app.post('/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── P2: Get current user ────────────────────────────────────────────────────
app.get('/users/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

// ── P6: Loyalty Discount ────────────────────────────────────────────────────
app.get('/users/:id/discount', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

    const data = await centralGet(`/api/data/users/${userId}`);
    const score = data.securityScore;
    let discountPercent = 0;
    if (score >= 80) discountPercent = 20;
    else if (score >= 60) discountPercent = 15;
    else if (score >= 40) discountPercent = 10;
    else if (score >= 20) discountPercent = 5;

    res.json({ userId, securityScore: score, discountPercent });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (err.response && err.response.status === 429) {
      return res.status(503).json({
        error: 'Central API unavailable after 3 retries',
        lastRetryAfter: 120,
        suggestion: 'Try again in ~2 minutes',
      });
    }
    console.error('Discount error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start server ────────────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`User Service running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize DB:', err.message);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`User Service running on port ${PORT} (DB init failed)`);
    });
  });
