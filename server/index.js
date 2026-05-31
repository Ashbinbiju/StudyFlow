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

// Simple ping should not wait on database startup.
app.get('/api/ping', (req, res) => res.json({ ok: true }));

function decodeXmlText(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeJsonString(value = '') {
  try {
    return JSON.parse(`"${String(value).replace(/"/g, '\\"')}"`);
  } catch (_) {
    return String(value).replace(/\\u0026/g, '&').replace(/\\"/g, '"');
  }
}

function parseYouTubeFeed(xml) {
  const entries = String(xml || '').match(/<entry[\s\S]*?<\/entry>/g) || [];
  return entries.map((entry, index) => {
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim();
    const rawTitle = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || `Lecture ${index + 1}`;
    if (!videoId) return null;
    return {
      id: `yt-${videoId}-${Date.now()}-${index}`,
      title: decodeXmlText(rawTitle).trim() || `Lecture ${index + 1}`,
      youtubeId: videoId,
      duration: '--:--'
    };
  }).filter(Boolean);
}

function parseYouTubePlaylistPage(html) {
  const chunks = String(html || '').split('"playlistVideoRenderer":{').slice(1);
  const seen = new Set();
  const lectures = [];

  for (const chunk of chunks) {
    const videoId = chunk.match(/"videoId":"([A-Za-z0-9_-]{11})"/)?.[1];
    if (!videoId || seen.has(videoId)) continue;

    const rawTitle =
      chunk.match(/"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/)?.[1] ||
      chunk.match(/"title":\{"simpleText":"((?:\\.|[^"\\])*)"/)?.[1] ||
      `Lecture ${lectures.length + 1}`;
    const title = decodeJsonString(rawTitle).trim();
    if (!title || /^(deleted|private) video$/i.test(title)) continue;

    const rawDuration =
      chunk.match(/"lengthText":\{"simpleText":"([^"]+)"/)?.[1] ||
      chunk.match(/"lengthText":[\s\S]*?"simpleText":"([^"]+)"/)?.[1] ||
      '--:--';

    seen.add(videoId);
    lectures.push({
      id: `yt-${videoId}-${Date.now()}-${lectures.length}`,
      title,
      youtubeId: videoId,
      duration: decodeJsonString(rawDuration)
    });
  }

  return lectures;
}

function parseYouTubeVideoPage(html, videoId) {
  const page = String(html || '');
  const title =
    page.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ||
    page.match(/"title":"((?:\\.|[^"\\])*)"/)?.[1] ||
    `YouTube video ${videoId}`;
  const lengthSeconds = page.match(/"lengthSeconds":"?(\d+)"?/)?.[1];
  const approxDurationMs = page.match(/"approxDurationMs":"?(\d+)"?/)?.[1];
  const durationSeconds = lengthSeconds
    ? Number(lengthSeconds)
    : approxDurationMs
    ? Number(approxDurationMs) / 1000
    : 0;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = Math.floor(durationSeconds % 60);

  return {
    id: `yt-${videoId}-${Date.now()}-0`,
    title: decodeJsonString(decodeXmlText(title)).trim() || `YouTube video ${videoId}`,
    youtubeId: videoId,
    duration: durationSeconds > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : '--:--'
  };
}

app.get('/api/youtube/playlist', async (req, res) => {
  const playlistId = String(req.query.playlistId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(playlistId)) {
    return res.status(400).json({ error: 'valid playlistId required' });
  }

  try {
    let lectures = [];
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`, {
      headers: {
        'User-Agent': 'StudyFlow/1.0 (+https://rcstudyflow.vercel.app)'
      }
    });
    const feedText = await response.text();
    if (response.ok) {
      lectures = parseYouTubeFeed(feedText);
    }

    if (!lectures.length) {
      const pageResponse = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      const pageHtml = await pageResponse.text();
      if (pageResponse.ok) {
        lectures = parseYouTubePlaylistPage(pageHtml);
      }
    }

    if (!lectures.length) {
      return res.status(404).json({ error: 'No public videos found in this playlist' });
    }

    res.json({ lectures });
  } catch (error) {
    console.error('YouTube playlist import failed:', error);
    res.status(502).json({ error: 'YouTube playlist service unavailable' });
  }
});

app.get('/api/youtube/video', async (req, res) => {
  const videoId = String(req.query.videoId || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'valid videoId required' });
  }

  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const pageHtml = await response.text();
    if (!response.ok) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({ lecture: parseYouTubeVideoPage(pageHtml, videoId) });
  } catch (error) {
    console.error('YouTube video import failed:', error);
    res.status(502).json({ error: 'YouTube video service unavailable' });
  }
});

// Setup SQL.js
const dbFile = process.env.VERCEL ? path.join('/tmp', 'studyflow.db') : path.join(__dirname, 'studyflow.db');
let db = null;
let dbReady = null;

async function initDb() {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });
  
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
    CREATE TABLE IF NOT EXISTS lectures (
      subjectId TEXT NOT NULL,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      youtubeId TEXT,
      duration TEXT,
      position INTEGER NOT NULL,
      PRIMARY KEY (subjectId, id)
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

app.use(async (req, res, next) => {
  try {
    if (dbReady) await dbReady;
    next();
  } catch (error) {
    next(error);
  }
});

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

// Subjects
app.get('/api/subjects', (req, res) => {
  const rows = getAll('SELECT id, name FROM subjects ORDER BY name');
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
  runQuery('DELETE FROM lectures WHERE subjectId = ?', [id]);
  runQuery('DELETE FROM notes WHERE subjectId = ?', [id]);
  runQuery('DELETE FROM bookmarks WHERE subjectId = ?', [id]);
  res.json({ ok: true });
});

// Lectures
app.get('/api/subjects/:id/lectures', (req, res) => {
  const { id } = req.params;
  const rows = getAll(
    'SELECT id, title, youtubeId, duration FROM lectures WHERE subjectId = ? ORDER BY position, rowid',
    [id]
  );
  res.json(rows);
});

app.put('/api/subjects/:id/lectures', (req, res) => {
  const { id } = req.params;
  const lectures = Array.isArray(req.body?.lectures) ? req.body.lectures : null;
  if (!lectures) return res.status(400).json({ error: 'lectures array required' });

  try {
    db.run('BEGIN TRANSACTION');
    db.run('DELETE FROM lectures WHERE subjectId = ?', [id]);
    lectures.forEach((lecture, index) => {
      const lectureId = String(lecture?.id || lecture?.youtubeId || `lecture-${index + 1}`);
      const title = String(lecture?.title || `Lecture ${index + 1}`).trim();
      const youtubeId = lecture?.youtubeId ? String(lecture.youtubeId) : null;
      const duration = lecture?.duration ? String(lecture.duration) : '--:--';
      db.run(
        'INSERT INTO lectures (subjectId, id, title, youtubeId, duration, position) VALUES (?, ?, ?, ?, ?, ?)',
        [id, lectureId, title || `Lecture ${index + 1}`, youtubeId, duration, index]
      );
    });
    db.run('COMMIT');
    saveDb();
    res.json({ ok: true, count: lectures.length });
  } catch (error) {
    try { db.run('ROLLBACK'); } catch (_) {}
    console.error('Failed to save lectures:', error);
    res.status(500).json({ error: 'failed to save lectures' });
  }
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

dbReady = initDb().catch(err => {
  console.error('Failed to initialize database:', err);
  throw err;
});

if (!process.env.VERCEL) {
  dbReady.then(() => {
    app.listen(PORT, () => console.log(`StudyFlow server running on http://localhost:${PORT}`));
  }).catch(() => {
    process.exit(1);
  });
}

export default app;
