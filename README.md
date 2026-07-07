# IAPS — Integrated Academic Productivity Suite

A classroom management platform I built to replace the mess of WhatsApp groups, shared spreadsheets, and paper notices that most college classes still run on. One app for timetables, marks, academic calendars, file sharing, announcements, and class chat — plus a few AI tools for studying from lecture PDFs.

Built solo, backend and frontend both, over several iterations as real classmates used it and told me what was broken.

## Stack

**Backend:** Flask, MongoDB, Socket.IO (real-time chat/DMs), JWT auth, Groq (LLM inference), ChromaDB + sentence-transformers (retrieval).
**Frontend:** React + Vite, React Router, Chart.js.
**Testing:** pytest + mongomock on the backend, Vitest + React Testing Library on the frontend.

## The parts worth looking at

**Hybrid RAG for the study tools** ([routes/ai_routes.py](iaps-backend/routes/ai_routes.py)) — students upload a lecture PDF and can ask it questions or get a summary. Retrieval isn't a single vector search: it runs dense retrieval (bge-small embeddings in ChromaDB) and BM25 keyword search in parallel, fuses the two rankings with reciprocal rank fusion, then reranks the merged candidates with a cross-encoder before handing the top chunks to the LLM. If ChromaDB is unavailable it falls back to BM25-only rather than failing outright. PDF indexing runs in a background thread so the upload request doesn't block on embedding a 40-page document.

**Encrypted messages at rest** ([utils/encryption.py](iaps-backend/utils/encryption.py)) — chat and DM text is AES-256-GCM encrypted before it hits MongoDB. Key comes from an `ENCRYPTION_KEY` env var if set, otherwise it's derived from the JWT secret via SHA-256, so a fresh deploy doesn't need a second secret just to boot. Decryption is backwards-compatible with plaintext strings from before encryption was added, so old messages don't break.

**Timetable extraction from a photo** ([utils/timetable_ml.py](iaps-backend/utils/timetable_ml.py)) — instead of manually entering a weekly timetable, you can photograph the one on the classroom wall and a Groq vision model parses it into structured periods. The model doesn't reliably follow "no markdown" instructions or fill in empty cells, so there's post-processing to strip code fences and backfill gaps it leaves out.

**Real-time chat and DMs** — Socket.IO handles classroom chat, direct messages, typing indicators, read receipts, and reactions. Rooms are scoped per classroom and per DM pair so a user only ever receives events relevant to them, not a global broadcast.

**Role-based access baked into the data model** — every classroom has CRs (class representatives) with elevated permissions (posting announcements, viewing DM stats, managing the timetable) tracked per-semester rather than per-classroom, since who's CR can change every semester.

## Everything else

- Classrooms, semesters, subjects
- Academic calendar (with PDF extraction of semester schedules)
- Marks tracking with per-subject and class-wide analytics
- File/document sharing per classroom
- Announcements
- Todos and personal settings

## Running it locally

**Backend**

```
cd iaps-backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in `.env` — you'll need a MongoDB URI (local `mongod` or Atlas), a JWT secret, mail credentials for verification emails, and a Groq API key for the AI features. Then:

```
python app.py
```

Runs on `:5001`.

**Frontend**

```
cd iaps-frontend
npm install
npm run dev
```

Runs on `:5173`. Set `VITE_API_URL` in a `.env` to point it at the backend.

## Tests

```
cd iaps-backend && pytest          # 13 test modules, mongomock — no real DB needed
cd iaps-frontend && npm test       # Vitest + RTL
```

## Deploying

Backend runs under gunicorn with the eventlet worker (see the [Procfile](iaps-backend/Procfile)) — I run it on Render. Frontend is a static Vite build, deployable anywhere. Set `FRONTEND_URL` on the backend and `VITE_API_URL` on the frontend to match your actual deployment URLs, or CORS and cookies won't work across origins.

**Database:** local `mongod` is dev-only. Production needs [MongoDB Atlas](https://www.mongodb.com/atlas):
1. Create a cluster, add a DB user, whitelist Render's outbound IPs (or `0.0.0.0/0` to start).
2. Set `MONGO_URI` on Render to the `mongodb+srv://...` connection string.
3. To carry over existing local data: `mongodump --uri="mongodb://localhost:27017/iaps" --out=./dump` then `mongorestore --uri="<atlas-uri>" ./dump`.

### Built to scale out, run as a single instance today

Real-time chat/DM presence, rate limiting, the AI PDF-indexing pipeline, and file storage are all designed to work correctly whether the app runs as one instance or several — but only one instance actually runs in production right now, since this app doesn't have the traffic to justify the extra infrastructure cost. Each piece is a genuine no-op until you opt in:

| Concern | Single instance (today, default) | Multiple instances (opt in) |
|---|---|---|
| Socket.IO presence/rooms | In-process | Set `REDIS_URL` → cross-instance fan-out via Redis, presence tracked in Redis hashes instead of a local dict ([utils/presence.py](iaps-backend/utils/presence.py)) |
| Rate limiting | In-process (`memory://`) | Same `REDIS_URL` → shared limits across instances ([limiter_instance.py](iaps-backend/limiter_instance.py)) |
| PDF indexing (AI study tools) | Background thread on the web process | Same `REDIS_URL` → dispatched to a Celery worker instead ([celery_app.py](iaps-backend/celery_app.py), `_dispatch_index_pdf` in [ai_routes.py](iaps-backend/routes/ai_routes.py)) — run it with `celery -A celery_worker worker` |
| Vector index (ChromaDB) | Local disk (`PersistentClient`) | Set `CHROMA_HOST` → talks to a standalone Chroma server instead, required once indexing and querying can happen on different machines |
| File uploads (PDFs) | Local disk | Set `S3_BUCKET` → stored in S3/R2 instead ([utils/storage.py](iaps-backend/utils/storage.py)) — required once the instance that saves a file isn't the same one that later reads it |

Not yet wired to the swappable storage layer: chat/DM file uploads, avatars, and academic resource uploads still go straight to local disk. Same pattern as `utils/storage.py` would apply if that becomes necessary.

The one thing this doesn't gate behind an env var: the AI generation endpoints (quiz, flashcards, mindmap, mock tests, study planner, etc.) stay synchronous, since making them async would mean an API contract change across ten endpoints. PDF indexing was the one actually capable of blocking the server for other users indefinitely outside of any request a client was waiting on — the generation endpoints, while slow, at least only hold up the one request that's already waiting on them.
