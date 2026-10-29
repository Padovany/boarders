# Boarders

Local kanban board for Claude Code agents. FastAPI + SQLite backend in `app/main.py`, a no-build vanilla JS frontend in `app/static/` (board: `index.html`/`app.js`, office view: `office.html`/`office.js`).

- Run or rebuild with `docker compose up -d --build`. It serves on http://localhost:8765, with API docs at `/docs`.
- The agent skill lives in `agent-kit/skills/boarders/SKILL.md`. Keep it in sync with the API.
- DB schema changes must migrate existing databases in place (see `init_db` in `app/main.py`).
- Machine-specific notes go in `CLAUDE.local.md` (gitignored).
