# StudyFlow 📚

StudyFlow is a modern, privacy-focused, and highly interactive study application. It allows users to import YouTube videos and playlists, take timestamp-synchronized Markdown notes, generate AI summaries/flashcards, and organize their learning into subjects. 

It is built with **vanilla web technologies** on the frontend and an **Express + SQLite (`sql.js`)** backend, designed to be completely portable, serverless-friendly, and capable of running fully offline.

---

## ✨ Key Features

- **YouTube Integration**: Instantly import public YouTube videos or entire playlists (with built-in fallback strategies for scraping when RSS is limited).
- **Timestamped Markdown Notes**: Take rich-text notes that are permanently synchronized with the video's playback time. Clicking a note jumps the video to that exact timestamp.
- **AI Study Assistant**: A built-in, context-aware AI tutor powered by OpenAI / OpenRouter. Generate flashcards, lecture summaries, pop-quizzes, or ask custom questions based on the current video's context.
- **Offline-First Resilience**: The frontend is heavily optimized to use `localStorage`. If the backend goes down, or the app is launched locally without a server, it still works flawlessly.
- **Glassmorphic UI & Accessibility**: Premium dark/light themes utilizing CSS Variables, native CSS nesting, and responsive flex/grid layouts. Fully accessible with ARIA labels and optimized mobile tap targets.

---

## 📂 Project Structure

This project completely avoids complex build steps (no Webpack, Vite, or React). It's designed so any developer can open it and immediately understand the flow.

```text
studyflow-design/
├── index.html           # Dashboard (Recent notes & continue watching)
├── subject.html         # Subject management workspace
├── video.html           # Core learning view (YouTube player, Notes, AI Chat)
├── settings.html        # App configurations and data resetting
├── assets/
│   ├── css/styles.css   # Global design system, glassmorphism, responsive queries
│   └── js/app.js        # Core frontend logic (State, UI rendering, Server sync)
├── server/
│   ├── index.js         # Express server, sql.js database logic, AI endpoints
│   ├── studyflow.db     # (Generated) SQLite local database file
│   └── .env             # Server environment variables (AI API keys)
└── vercel.json          # Deployment configuration & HTTP Security Headers
```

---

## 🛠️ Architecture & Developer Guide

### 1. The Frontend (`assets/js/app.js`)
All frontend logic lives in `app.js`. It operates on a **"Local-First, Sync-Second"** philosophy.
- Data (Notes, Bookmarks, Subjects) is immediately read from and written to `localStorage` ensuring instant UI feedback.
- Background asynchronous `fetch()` calls quietly synchronize this data to the Express backend (if available). 
- If you need to add a new data type, follow the existing pattern: `loadLocalX()`, `loadX()`, and `saveX()`.

### 2. The Backend (`server/index.js`)
The backend is a lightweight Express app. 
- **Database**: It uses `sql.js` to create an in-memory SQLite database.
- **Debounced Persistence**: To prevent blocking the event loop on high-frequency note taking, changes are written to disk (`studyflow.db`) using a 1-second debounced `saveDb()` function.
- **IDs**: To maintain perfect harmony between offline local-storage sorting and backend sorting, all schema IDs (`notes`, `bookmarks`, `subjects`) are stored as **TEXT Primary Keys** (using stringified `Date.now()` Unix timestamps).

### 3. Styling & CSS (`styles.css`)
- Avoid inline styles where possible. 
- The app uses CSS Variables (`--bg-color`, `--glass-bg`, `--accent-blue`) mapped to `.theme-dark` (default) and `.theme-light`. 
- To add a new UI component, leverage existing utility classes like `.glass-card`, `.btn-primary`, or `.studyflow-toast`.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)

### Installation
1. Clone the repository.
2. Navigate to the server directory and install dependencies:
   ```bash
   cd server
   npm install
   ```
3. Set up your AI configuration. Create a `.env` file in the `/server` directory:
   ```env
   # Choose an AI provider
   OPENAI_API_KEY=your_openai_key_here
   # OR
   OPENROUTER_API_KEY=your_openrouter_key_here
   
   # Specify the model
   AI_MODEL=gpt-4o-mini
   # OR
   AI_MODEL=meta-llama/llama-3-8b-instruct:free
   ```
4. Start the server:
   ```bash
   npm run start
   # Or for auto-reloading during development:
   npm run dev
   ```
5. Open your browser and navigate to `http://localhost:3000`.

---

## 🔒 Security & Deployment
The app is natively configured for serverless deployment on **Vercel**. 
- `vercel.json` intercepts routing, serving static files automatically while routing `/api/*` to the Node backend.
- It enforces strict HTTP security headers: `Content-Security-Policy` (blocking malicious scripts/evals), `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`.
- Backend middleware explicitly blocks external access to the `/server/` directory, preventing source-code or `.env` file leakage.
