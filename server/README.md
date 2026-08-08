# StudyFlow Server

## Quick start:

1. Install dependencies
```bash
cd studyflow-design/server
npm install
```

2. Start server
```bash
npm run start
# or for development
npm run dev
```

The server will run on `http://localhost:3000` and serves the frontend files as static assets. API endpoints are under `/api/*`.

## Notes:
- Uses SQLite (`studyflow.db`) via `sql.js` (in-memory, flushed to disk via debounced writes) stored in `server/`.
- No ORMs (Drizzle) or native drivers (better-sqlite3) are used in production to ensure maximum compatibility across serverless environments.

## Endpoints:
- `GET /api/ping` — healthcheck
- `GET /api/settings` — get all settings
- `PUT /api/settings/:key` — update a setting
- `GET /api/subjects` — list subjects
- `POST /api/subjects` — create subject { id, name }
- `DELETE /api/subjects/:id` — delete subject
- `PUT /api/subjects/:id/lectures` — bulk update lectures
- `GET /api/subjects/:id/notes?videoId=video1` — list notes
- `POST /api/subjects/:id/notes` — add note { videoId, time, text }
- `DELETE /api/notes/:id` — delete note
- `GET /api/subjects/:id/bookmarks?videoId=video1`
- `POST /api/subjects/:id/bookmarks` — add bookmark { videoId, time }
- `DELETE /api/bookmarks/:id` — delete bookmark
- `DELETE /api/reset` — reset all database data
- `POST /api/ai/chat` — generic AI chat { messages }
- `GET /api/youtube/video?videoId=...` — fetch single video metadata
- `GET /api/youtube/playlist?playlistId=...` — fetch playlist metadata (scrapes or uses RSS fallback)
