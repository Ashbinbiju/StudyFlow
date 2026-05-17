import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFile = path.join(__dirname, '.env');

if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (!process.env[key]) {
      process.env[key] = valueParts.join('=').replace(/^["']|["']$/g, '');
    }
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, '..')));

// Setup SQL.js
const dbFile = path.join(__dirname, 'studyflow.db');
let db = null;

async function initDb() {
  const SQL = await initSqlJs();
  
  // Try to load existing DB
  if (fs.existsSync(dbFile)) {
    const fileBuffer = fs.readFileSync(dbFile);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subjectId TEXT NOT NULL,
      videoId TEXT NOT NULL,
      time INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subjectId TEXT NOT NULL,
      videoId TEXT NOT NULL,
      time INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  saveDb();
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbFile, buffer);
}

function runQuery(sql, params = []) {
  if (!db) throw new Error('DB not initialized');
  try {
    db.run(sql, params);
    saveDb();
    return true;
  } catch (e) {
    console.error('Query error:', e, sql, params);
    return false;
  }
}

function getAll(sql, params = []) {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const result = [];
    while (stmt.step()) {
      result.push(stmt.getAsObject());
    }
    stmt.free();
    return result;
  } catch (e) {
    console.error('Query error:', e, sql, params);
    return [];
  }
}

function getOne(sql, params = []) {
  const rows = getAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Simple ping
app.get('/api/ping', (req, res) => res.json({ ok: true }));

// Subjects
app.get('/api/subjects', (req, res) => {
  let rows = getAll('SELECT id, name FROM subjects ORDER BY name');
  if (rows.length === 0) {
    // Seed defaults
    const defaults = [
      ['physics', 'Physics'],
      ['maths', 'Maths'],
      ['chemistry', 'Chemistry'],
      ['programming', 'Programming']
    ];
    defaults.forEach(([id, name]) => {
      runQuery('INSERT OR IGNORE INTO subjects (id, name) VALUES (?, ?)', [id, name]);
    });
    rows = getAll('SELECT id, name FROM subjects ORDER BY name');
  }
  res.json(rows);
});

app.post('/api/subjects', (req, res) => {
  const { name, id } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const sid = id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  runQuery('INSERT OR IGNORE INTO subjects (id, name) VALUES (?, ?)', [sid, name]);
  const s = getOne('SELECT id, name FROM subjects WHERE id = ?', [sid]);
  res.json(s);
});

app.delete('/api/subjects/:id', (req, res) => {
  const { id } = req.params;
  runQuery('DELETE FROM subjects WHERE id = ?', [id]);
  runQuery('DELETE FROM notes WHERE subjectId = ?', [id]);
  runQuery('DELETE FROM bookmarks WHERE subjectId = ?', [id]);
  res.json({ ok: true });
});

// Settings
app.get('/api/settings', (req, res) => {
  const rows = getAll('SELECT key, value FROM settings');
  const settings = {};
  rows.forEach(row => {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch (_) {
      settings[row.key] = row.value;
    }
  });
  res.json(settings);
});

app.put('/api/settings/:key', (req, res) => {
  const { key } = req.params;
  if (req.body?.value == null) {
    const ok = runQuery('DELETE FROM settings WHERE key = ?', [key]);
    if (!ok) return res.status(500).json({ error: 'failed to delete setting' });
    return res.json({ key, value: null });
  }

  const value = JSON.stringify(req.body.value);
  const ok = runQuery(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value]
  );
  if (!ok) return res.status(500).json({ error: 'failed to save setting' });
  res.json({ key, value: req.body.value });
});

// Notes
app.get('/api/subjects/:id/notes', (req, res) => {
  const { id } = req.params;
  const { videoId } = req.query;
  const rows = getAll(
    'SELECT id, subjectId, videoId, time, text FROM notes WHERE subjectId = ? AND videoId = ? ORDER BY time',
    [id, videoId || 'video1']
  );
  res.json(rows);
});

app.post('/api/subjects/:id/notes', (req, res) => {
  const { id } = req.params;
  const { videoId, time, text } = req.body;
  if (typeof time !== 'number' || !text) return res.status(400).json({ error: 'time and text required' });
  runQuery('INSERT INTO notes (subjectId, videoId, time, text) VALUES (?, ?, ?, ?)', [id, videoId || 'video1', time, text]);
  const row = getOne('SELECT id, subjectId, videoId, time, text FROM notes ORDER BY id DESC LIMIT 1');
  res.json(row);
});

app.delete('/api/notes/:id', (req, res) => {
  runQuery('DELETE FROM notes WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// Bookmarks
app.get('/api/subjects/:id/bookmarks', (req, res) => {
  const { id } = req.params;
  const { videoId } = req.query;
  const rows = getAll(
    'SELECT id, subjectId, videoId, time FROM bookmarks WHERE subjectId = ? AND videoId = ? ORDER BY time',
    [id, videoId || 'video1']
  );
  res.json(rows);
});

app.post('/api/subjects/:id/bookmarks', (req, res) => {
  const { id } = req.params;
  const { videoId, time } = req.body;
  if (typeof time !== 'number') return res.status(400).json({ error: 'time required' });
  runQuery('INSERT INTO bookmarks (subjectId, videoId, time) VALUES (?, ?, ?)', [id, videoId || 'video1', time]);
  const row = getOne('SELECT id, subjectId, videoId, time FROM bookmarks ORDER BY id DESC LIMIT 1');
  res.json(row);
});

app.delete('/api/bookmarks/:id', (req, res) => {
  runQuery('DELETE FROM bookmarks WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// AI mock endpoints
app.post('/api/ai/summary', (req, res) => {
  const { subjectId, videoId } = req.body;
  const notesRows = getAll(
    'SELECT time, text FROM notes WHERE subjectId = ? AND videoId = ? ORDER BY time',
    [subjectId, videoId || 'video1']
  );
  if (!notesRows.length) return res.json({ summary: 'No notes available.' });
  const lines = notesRows.slice(0, 10).map(n => `- [${new Date(n.time * 1000).toISOString().substr(14, 5)}] ${n.text}`);
  res.json({ summary: lines.join('\n') });
});

app.post('/api/ai/chat', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: { message: 'AI is not configured on the server.' } });
  }

  const { systemPrompt, userPrompt } = req.body || {};
  if (!userPrompt) {
    return res.status(400).json({ error: { message: 'userPrompt required' } });
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt || 'You are a helpful study assistant.' }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.7 }
      })
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      return res.status(response.status || 502).json({ error: data.error || { message: 'AI request failed' } });
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ text });
  } catch (error) {
    console.error('AI proxy error:', error);
    res.status(502).json({ error: { message: 'AI service unavailable' } });
  }
});

const PORT = process.env.PORT || 3000;

// Start server after DB init
initDb().then(() => {
  app.listen(PORT, () => console.log(`StudyFlow server running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
