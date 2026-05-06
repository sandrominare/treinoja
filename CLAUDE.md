# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server (auto-reload)
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Run production server
uvicorn main:app --host 0.0.0.0 --port 8000
```

The app is then available at `http://localhost:8000`.

## Architecture

**TreinoJá** is a Python/FastAPI web app for tracking gym workouts — a multi-user server-side version of the original PWA (`TreinoPWA`), which used `localStorage`. All data is now persisted in a SQLite database (`treinoja.db`).

### Backend (`main.py` + `routers/`)

FastAPI app with five router modules:

| Router | Prefix | Responsibility |
|---|---|---|
| `routers/auth.py` | `/api/auth` | Login, register, logout, `/me` |
| `routers/workouts.py` | `/api/workouts` | GET/PUT full workout plan per user |
| `routers/history.py` | `/api/history` | GET list / POST new entry |
| `routers/progress.py` | `/api/progress` | GET/PUT/DELETE in-progress workout tracking |
| `routers/backup.py` | `/api/backup` | Export JSON / Import JSON file |

Authentication uses JWT tokens stored in an httpOnly cookie named `session`. The `get_current_user` dependency (in `routers/auth.py`) validates the cookie on every protected endpoint.

### Database (`database.py` + `models.py`)

SQLAlchemy with SQLite. Four models:

- **`User`**: username + PBKDF2-hashed password
- **`WorkoutPlan`**: one row per user, `data` column (JSON) mirrors the original `DATA` object structure `{"A": {...exercicios}, "B": {...}, ...}` including the `done[]` array per exercise
- **`WorkoutHistory`**: one row per completed workout session
- **`WorkoutProgress`**: one row per user tracking which workout letter is currently in progress

### Frontend (`templates/index.html` + `static/`)

Single-page app (same structure as original PWA). All views are `<div id="view-*">` toggled via `showView()`.

Key change vs. original: all `localStorage.*` calls replaced by `fetch()` calls to `/api/*` endpoints. The `saveData()` function is debounced (500ms) to avoid excessive PUT requests while checking sets.

`apiFetch()` in `app.js` is the central fetch wrapper — it handles 401 responses globally (redirects to login) and surfaces error messages from the API's `detail` field.

### Password rules (same as original)
- Numeric only
- Minimum 4 digits
- All digits must be unique

### Security note
`SECRET_KEY` defaults to a hardcoded string. Set the `SECRET_KEY` environment variable before deploying to production.
