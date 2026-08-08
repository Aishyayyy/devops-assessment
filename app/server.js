const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// pg library auto-reads PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
// but we set them explicitly so misconfiguration is easy to reason about.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionTimeoutMillis: 3000,
});

let dbReady = false;

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    dbReady = true;
    console.log('[startup] DB connected and schema ensured');
  } catch (err) {
    dbReady = false;
    console.error('[startup] DB init failed:', err.message);
  }
}

// Retry DB connection in background so the process doesn't crash-loop
// just because the DB isn't ready yet (common in k8s startup ordering).
function initDbWithRetry() {
  initDb().then(() => {
    if (!dbReady) setTimeout(initDbWithRetry, 3000);
  });
}
initDbWithRetry();

// --- Liveness: is the Node process itself alive? Never touches the DB. ---
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

// --- Readiness: can this pod actually serve traffic (DB reachable)? ---
app.get('/ready', async (req, res) => {
  if (!dbReady) {
    return res.status(503).json({ status: 'not ready', reason: 'db not connected' });
  }
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', reason: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ service: 'devops-assessment-backend', version: '1.0.0' });
});

app.get('/items', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items ORDER BY id DESC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/items', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'INSERT INTO items (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[startup] Server listening on port ${PORT}`);
});