StudyFlow Server

Quick start:

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

Notes:
- Uses SQLite (`studyflow.db`) stored in `server/`.
- Drizzle is used in schema definitions; raw SQL (better-sqlite3) is used for table creation and queries for simplicity.
- Endpoints:
  - `GET /api/subjects` — list subjects
  - `POST /api/subjects` — create subject { name }
  - `DELETE /api/subjects/:id` — delete subject
  - `GET /api/subjects/:id/notes?videoId=video1` — list notes
  - `POST /api/subjects/:id/notes` — add note { videoId,time,text }
  - `DELETE /api/notes/:id` — delete note
  - `GET /api/subjects/:id/bookmarks?videoId=video1`
  - `POST /api/subjects/:id/bookmarks` — add bookmark { videoId,time }
  - `DELETE /api/bookmarks/:id`
  - `POST /api/ai/summary` — { subjectId, videoId }

