# StudyFlow 

StudyFlow is a modern, privacy-focused study application built with vanilla web technologies and an optional Node.js backend.

## Features
- **YouTube Integration**: Import playlists and videos instantly.
- **Timestamped Notes & Bookmarks**: Take markdown notes synchronized with video timestamps.
- **AI Assistant**: Built-in context-aware AI tutor powered by OpenAI / OpenRouter.
- **Offline First**: Works fully in the browser via `localStorage` even if the backend is down.
- **Dynamic Theming**: Premium dark and light glassmorphic aesthetics.

## Architecture
- **Frontend**: Vanilla HTML/CSS/JS (no build step). Uses pinned `lucide` scripts with SRI for icons.
- **Backend**: Express + `sql.js` (SQLite). Completely portable and serverless-friendly.
- **Deployment**: Configured for Vercel via `vercel.json` with strict security headers (CSP, X-Frame-Options).

## Quickstart
1. Clone the repository.
2. Navigate to `server/` and run `npm install`.
3. Run `npm run start` and open `http://localhost:3000`.

*Note: For the AI features to work, you must add an `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) and `AI_MODEL` to your `.env` file in the `server/` directory.*
