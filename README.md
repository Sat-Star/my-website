# My Website (Thoughts & Learnings)

Small personal website with a lightweight Express + MongoDB backend to store "thoughts" and "learnings".

Quick start

1. Copy `.env.example` to `.env` and set `MONGO_URI`.
2. Install dependencies: npm install
3. Start the server: npm start
4. Open http://localhost:3000

Notes

- The backend exposes GET /api/entries?kind=thought and POST /api/entries to create entries.
