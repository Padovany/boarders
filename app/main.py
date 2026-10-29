"""Boarders — a small local kanban board for humans and Claude Code agents."""
import hashlib
import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DB_PATH = os.environ.get("BOARDERS_DB", "/data/boarders.db")
AGENTS_CAN_CLOSE = os.environ.get("AGENTS_CAN_CLOSE", "false").lower() == "true"
HUMAN = "you"

COLUMNS = [
    {"id": "backlog", "name": "Backlog", "color": "#6b7489"},
    {"id": "today", "name": "Today", "color": "#7c8cff", "wip": 6},
    {"id": "doing", "name": "In progress", "color": "#3ecf8e", "wip": 4},
    {"id": "review", "name": "Review", "color": "#f5b14c"},
    {"id": "done", "name": "Done", "color": "#a3abbd"},
]
COLUMN_IDS = [c["id"] for c in COLUMNS]
COLUMN_NAMES = {c["id"]: c["name"] for c in COLUMNS}
TYPES = ["Story", "Task", "Bug"]
ACTIVITIES = ["coding", "data", "planning", "testing", "research", "idle"]
PALETTE = ["#7c8cff", "#3ecf8e", "#f5b14c", "#e879b9", "#4cc9f0", "#c17cff", "#ff8a65", "#a3e635"]
AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,47}$")
PROJECT_RE = re.compile(r"^[A-Z][A-Z0-9]{1,7}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  agent TEXT,
  description TEXT NOT NULL DEFAULT '',
  next_num INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stories (
  key TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  col TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 2,
  type TEXT NOT NULL DEFAULT 'Story',
  agent TEXT,
  blocked TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT 'you',
  source TEXT,
  triaged INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stories_col ON stories(col, position);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_key TEXT NOT NULL,
  project TEXT NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_story ON events(story_key, id);
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  color TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  last_action TEXT NOT NULL DEFAULT '',
  activity TEXT,
  activity_story TEXT,
  activity_at TEXT
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        # Columns added after the first release.
        have = {r["name"] for r in conn.execute("PRAGMA table_info(stories)")}
        for col, ddl in (("created_by", "TEXT NOT NULL DEFAULT 'you'"), ("source", "TEXT"),
                         ("triaged", "INTEGER NOT NULL DEFAULT 1")):
            if col not in have:
                conn.execute(f"ALTER TABLE stories ADD COLUMN {col} {ddl}")
        have = {r["name"] for r in conn.execute("PRAGMA table_info(agents)")}
        for col in ("activity", "activity_story", "activity_at"):
            if col not in have:
                conn.execute(f"ALTER TABLE agents ADD COLUMN {col} TEXT")


def agent_color(name: str) -> str:
    return PALETTE[int(hashlib.md5(name.encode()).hexdigest(), 16) % len(PALETTE)]


def resolve_actor(conn, x_agent: Optional[str], action: str = "") -> str:
    """Agents identify themselves with the X-Agent header; no header means the human."""
    if not x_agent:
        return HUMAN
    name = x_agent.strip().lower()
    if not AGENT_RE.match(name) or name == HUMAN:
        raise HTTPException(400, f"Invalid X-Agent name '{x_agent}'. Use a lowercase slug like 'web-agent'.")
    conn.execute(
        "INSERT INTO agents(name, color, last_seen, last_action) VALUES (?,?,?,?) "
        "ON CONFLICT(name) DO UPDATE SET last_seen=excluded.last_seen, "
        "last_action=CASE WHEN excluded.last_action='' THEN agents.last_action ELSE excluded.last_action END",
        (name, agent_color(name), now(), action),
    )
    return name


def log(conn, story: sqlite3.Row, actor: str, kind: str, body: str = ""):
    conn.execute(
        "INSERT INTO events(story_key, project, actor, kind, body, created_at) VALUES (?,?,?,?,?,?)",
        (story["key"], story["project"], actor, kind, body, now()),
    )


def story_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["column"] = d.pop("col")
    d["checklist"] = json.loads(d["checklist"] or "[]")
    d["triaged"] = bool(d["triaged"])
    total = len(d["checklist"])
    d["progress"] = round(100 * sum(1 for i in d["checklist"] if i.get("done")) / total) if total else None
    return d


def get_story(conn, key: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM stories WHERE key = ?", (key.upper(),)).fetchone()
    if not row:
        raise HTTPException(404, f"Story {key} not found")
    return row


def get_project(conn, pid: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (pid.upper(),)).fetchone()
    if not row:
        raise HTTPException(404, f"Project {pid} not found")
    return row


def place(conn, key: str, col: str, index: Optional[int]):
    """Put a story at `index` within `col` (end when None) and renumber that column."""
    keys = [r["key"] for r in conn.execute(
        "SELECT key FROM stories WHERE col = ? AND key != ? ORDER BY position, created_at", (col, key))]
    if index is None or index > len(keys):
        index = len(keys)
    keys.insert(max(index, 0), key)
    for pos, k in enumerate(keys):
        conn.execute("UPDATE stories SET position = ? WHERE key = ?", (pos, k))
    conn.execute("UPDATE stories SET col = ?, updated_at = ? WHERE key = ?", (col, now(), key))


def clear_activity(conn, key: str):
    """An agent's activity is tied to the story it's working; drop it once that story stops being worked."""
    conn.execute("UPDATE agents SET activity = NULL, activity_story = NULL, activity_at = NULL WHERE activity_story = ?", (key,))


def do_move(conn, story: sqlite3.Row, actor: str, column: str, index: Optional[int]):
    if column not in COLUMN_IDS:
        raise HTTPException(400, f"Unknown column '{column}'. Valid: {', '.join(COLUMN_IDS)}")
    if column == "done" and actor != HUMAN and not AGENTS_CAN_CLOSE:
        raise HTTPException(403, "Agents cannot move stories to Done. Move it to 'review' and the human will close it.")
    place(conn, story["key"], column, index)
    if column != "doing":
        clear_activity(conn, story["key"])
    if actor == HUMAN:
        conn.execute("UPDATE stories SET triaged = 1 WHERE key = ?", (story["key"],))
    if story["col"] != column:
        log(conn, story, actor, "moved", f"{COLUMN_NAMES[story['col']]} → {COLUMN_NAMES[column]}")
        # An agent starting unassigned work owns it.
        if actor != HUMAN and column == "doing" and not story["agent"]:
            conn.execute("UPDATE stories SET agent = ? WHERE key = ?", (actor, story["key"]))
            log(conn, story, actor, "claimed", "")


# ---------- models ----------

class ChecklistItem(BaseModel):
    text: str
    done: bool = False


class ProjectIn(BaseModel):
    id: str = Field(description="Short uppercase key used in story keys, e.g. ING")
    name: str
    color: Optional[str] = None
    agent: Optional[str] = Field(None, description="Default agent that works this project")
    description: str = ""


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    agent: Optional[str] = None
    description: Optional[str] = None


class StoryIn(BaseModel):
    project: str
    title: str
    prompt: str = ""
    priority: int = Field(2, ge=1, le=3)
    type: str = "Story"
    column: str = "backlog"
    agent: Optional[str] = None
    checklist: List[ChecklistItem] = []
    source: Optional[str] = Field(None, description="Key of the story where this work was discovered, e.g. ING-4")


class StoryPatch(BaseModel):
    title: Optional[str] = None
    prompt: Optional[str] = None
    priority: Optional[int] = Field(None, ge=1, le=3)
    type: Optional[str] = None
    agent: Optional[str] = Field(None, description="Agent name; null or empty string unassigns")
    blocked: Optional[str] = Field(None, description="Reason the story is blocked; null or empty string clears it")
    checklist: Optional[List[ChecklistItem]] = None
    column: Optional[str] = None
    triaged: Optional[bool] = Field(None, description="Human only: mark an agent-created story as seen")


class MoveIn(BaseModel):
    column: str
    index: Optional[int] = Field(None, description="Position within the column; omit to append")


class ClaimIn(BaseModel):
    agent: Optional[str] = Field(None, description="Defaults to the X-Agent header")
    force: bool = False


class ActivityIn(BaseModel):
    activity: str = Field(description="One of: " + ", ".join(ACTIVITIES))
    story: Optional[str] = Field(None, description="Key of the story this activity is for")


class CommentIn(BaseModel):
    body: str


# ---------- app ----------

app = FastAPI(
    title="Boarders API",
    description=(
        "Local kanban board. Agents identify themselves with the `X-Agent: <name>` header on every call. "
        "Requests without it are treated as the human. Agents may not move stories to `done`."
    ),
    version="1.0",
)


@app.on_event("startup")
def startup():
    init_db()


@app.get("/api/meta", tags=["meta"])
def meta():
    office = None
    if os.environ.get("OFFICE_LAT") and os.environ.get("OFFICE_LON"):
        office = {"lat": float(os.environ["OFFICE_LAT"]), "lon": float(os.environ["OFFICE_LON"]),
                  "place": os.environ.get("OFFICE_PLACE", "")}
    return {"columns": COLUMNS, "types": TYPES, "priorities": [1, 2, 3], "agents_can_close": AGENTS_CAN_CLOSE,
            "office": office}


# projects

@app.get("/api/projects", tags=["projects"])
def list_projects():
    with db() as conn:
        rows = conn.execute("""
            SELECT p.*, COUNT(s.key) FILTER (WHERE s.col != 'done') AS open_count
            FROM projects p LEFT JOIN stories s ON s.project = p.id
            GROUP BY p.id ORDER BY p.created_at""").fetchall()
        return [dict(r) for r in rows]


@app.post("/api/projects", status_code=201, tags=["projects"])
def create_project(body: ProjectIn, x_agent: Optional[str] = Header(None)):
    pid = body.id.strip().upper()
    if not PROJECT_RE.match(pid):
        raise HTTPException(400, "Project id must be 2-8 uppercase letters/digits starting with a letter")
    with db() as conn:
        resolve_actor(conn, x_agent)
        if conn.execute("SELECT 1 FROM projects WHERE id = ?", (pid,)).fetchone():
            raise HTTPException(409, f"Project {pid} already exists")
        count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        conn.execute(
            "INSERT INTO projects(id, name, color, agent, description, created_at) VALUES (?,?,?,?,?,?)",
            (pid, body.name.strip(), body.color or PALETTE[count % len(PALETTE)],
             (body.agent or "").strip().lower() or None, body.description, now()))
        return dict(get_project(conn, pid))


@app.patch("/api/projects/{pid}", tags=["projects"])
def update_project(pid: str, body: ProjectPatch):
    with db() as conn:
        get_project(conn, pid)
        changes = body.model_dump(exclude_unset=True)
        if "agent" in changes:
            changes["agent"] = (changes["agent"] or "").strip().lower() or None
        for field, value in changes.items():
            conn.execute(f"UPDATE projects SET {field} = ? WHERE id = ?", (value, pid.upper()))
        return dict(get_project(conn, pid))


@app.delete("/api/projects/{pid}", status_code=204, tags=["projects"])
def delete_project(pid: str):
    with db() as conn:
        get_project(conn, pid)
        conn.execute("DELETE FROM events WHERE project = ?", (pid.upper(),))
        conn.execute("DELETE FROM stories WHERE project = ?", (pid.upper(),))
        conn.execute("DELETE FROM projects WHERE id = ?", (pid.upper(),))


# stories

@app.get("/api/stories", tags=["stories"])
def list_stories(
    project: Optional[str] = Query(None, description="Comma-separated project ids"),
    column: Optional[str] = Query(None, description="Comma-separated column ids"),
    agent: Optional[str] = Query(None, description="Agent name, or 'none' for unassigned"),
    blocked: Optional[bool] = None,
    triaged: Optional[bool] = Query(None, description="false = agent-created stories the human hasn't seen yet"),
    created_by: Optional[str] = None,
    q: Optional[str] = Query(None, description="Search key, title and prompt"),
):
    sql, args = "SELECT * FROM stories WHERE 1=1", []
    if project:
        ids = [p.strip().upper() for p in project.split(",") if p.strip()]
        sql += f" AND project IN ({','.join('?' * len(ids))})"
        args += ids
    if column:
        cols = [c.strip() for c in column.split(",") if c.strip()]
        sql += f" AND col IN ({','.join('?' * len(cols))})"
        args += cols
    if agent == "none":
        sql += " AND agent IS NULL"
    elif agent:
        sql += " AND agent = ?"
        args.append(agent.lower())
    if blocked is not None:
        sql += " AND blocked IS NOT NULL" if blocked else " AND blocked IS NULL"
    if triaged is not None:
        sql += " AND triaged = ?"
        args.append(int(triaged))
    if created_by:
        sql += " AND created_by = ?"
        args.append(created_by.lower())
    if q:
        sql += " AND (key LIKE ? OR title LIKE ? OR prompt LIKE ?)"
        args += [f"%{q}%"] * 3
    sql += " ORDER BY position, created_at"
    with db() as conn:
        return [story_dict(r) for r in conn.execute(sql, args)]


@app.post("/api/stories", status_code=201, tags=["stories"])
def create_story(body: StoryIn, x_agent: Optional[str] = Header(None)):
    if body.column not in COLUMN_IDS:
        raise HTTPException(400, f"Unknown column '{body.column}'")
    if body.type not in TYPES:
        raise HTTPException(400, f"type must be one of {TYPES}")
    with db() as conn:
        actor = resolve_actor(conn, x_agent, "created a story")
        proj = get_project(conn, body.project)
        if actor != HUMAN and body.column not in ("backlog", "today"):
            raise HTTPException(403, "Agents can only create stories in 'backlog' or 'today'")
        source = get_story(conn, body.source) if body.source else None
        key = f"{proj['id']}-{proj['next_num']}"
        conn.execute("UPDATE projects SET next_num = next_num + 1 WHERE id = ?", (proj["id"],))
        ts = now()
        conn.execute(
            "INSERT INTO stories(key, project, title, prompt, col, position, priority, type, agent, checklist, "
            "created_by, source, triaged, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (key, proj["id"], body.title.strip(), body.prompt, body.column, 10**6, body.priority, body.type,
             (body.agent or "").strip().lower() or None,
             json.dumps([i.model_dump() for i in body.checklist]),
             actor, source["key"] if source else None, int(actor == HUMAN), ts, ts))
        place(conn, key, body.column, None)
        story = get_story(conn, key)
        log(conn, story, actor, "created", f"in {COLUMN_NAMES[body.column]}" + (f" from {source['key']}" if source else ""))
        if source:
            log(conn, source, actor, "follow_up", key)
        return story_dict(get_story(conn, key))


@app.get("/api/stories/{key}", tags=["stories"])
def read_story(key: str):
    with db() as conn:
        story = story_dict(get_story(conn, key))
        story["events"] = [dict(e) for e in conn.execute(
            "SELECT * FROM events WHERE story_key = ? ORDER BY id DESC", (story["key"],))]
        return story


@app.patch("/api/stories/{key}", tags=["stories"])
def update_story(key: str, body: StoryPatch, x_agent: Optional[str] = Header(None)):
    changes = body.model_dump(exclude_unset=True)
    with db() as conn:
        actor = resolve_actor(conn, x_agent, f"updated {key.upper()}")
        story = get_story(conn, key)
        column = changes.pop("column", None)
        if "triaged" in changes:
            if actor != HUMAN:
                raise HTTPException(403, "Only the human can mark stories as triaged")
            changes["triaged"] = int(bool(changes["triaged"]))
        if "type" in changes and changes["type"] not in TYPES:
            raise HTTPException(400, f"type must be one of {TYPES}")
        if "agent" in changes:
            changes["agent"] = (changes["agent"] or "").strip().lower() or None
            if changes["agent"] != story["agent"]:
                log(conn, story, actor, "assigned", changes["agent"] or "unassigned")
        if "blocked" in changes:
            changes["blocked"] = (changes["blocked"] or "").strip() or None
            if changes["blocked"] and changes["blocked"] != story["blocked"]:
                log(conn, story, actor, "blocked", changes["blocked"])
            elif not changes["blocked"] and story["blocked"]:
                log(conn, story, actor, "unblocked", "")
        if "checklist" in changes:
            changes["checklist"] = json.dumps([i.model_dump() for i in body.checklist or []])
            log(conn, story, actor, "checklist", "")
        edited = [f for f in ("title", "prompt", "priority", "type") if f in changes and changes[f] != story[f]]
        if edited:
            log(conn, story, actor, "updated", ", ".join(edited))
        for field, value in changes.items():
            conn.execute(f"UPDATE stories SET {field} = ? WHERE key = ?", (value, story["key"]))
        conn.execute("UPDATE stories SET updated_at = ? WHERE key = ?", (now(), story["key"]))
        if column and column != story["col"]:
            do_move(conn, get_story(conn, key), actor, column, None)
        return story_dict(get_story(conn, key))


@app.delete("/api/stories/{key}", status_code=204, tags=["stories"])
def delete_story(key: str, x_agent: Optional[str] = Header(None)):
    with db() as conn:
        if resolve_actor(conn, x_agent) != HUMAN:
            raise HTTPException(403, "Only the human can delete stories")
        story = get_story(conn, key)
        conn.execute("DELETE FROM events WHERE story_key = ?", (story["key"],))
        conn.execute("DELETE FROM stories WHERE key = ?", (story["key"],))


@app.post("/api/stories/{key}/move", tags=["stories"])
def move_story(key: str, body: MoveIn, x_agent: Optional[str] = Header(None)):
    with db() as conn:
        actor = resolve_actor(conn, x_agent, f"moved {key.upper()} to {COLUMN_NAMES.get(body.column, body.column)}")
        do_move(conn, get_story(conn, key), actor, body.column, body.index)
        return story_dict(get_story(conn, key))


@app.post("/api/stories/{key}/claim", tags=["stories"])
def claim_story(key: str, body: ClaimIn = ClaimIn(), x_agent: Optional[str] = Header(None)):
    with db() as conn:
        actor = resolve_actor(conn, x_agent, f"claimed {key.upper()}")
        agent = (body.agent or (actor if actor != HUMAN else "")).strip().lower()
        if not agent:
            raise HTTPException(400, "Pass X-Agent header or an 'agent' in the body")
        story = get_story(conn, key)
        if story["agent"] and story["agent"] != agent and not body.force:
            raise HTTPException(409, f"{story['key']} is already assigned to {story['agent']}")
        conn.execute("UPDATE stories SET agent = ?, updated_at = ? WHERE key = ?", (agent, now(), story["key"]))
        log(conn, story, actor, "claimed", agent if agent != actor else "")
        return story_dict(get_story(conn, key))


@app.post("/api/stories/{key}/release", tags=["stories"])
def release_story(key: str, x_agent: Optional[str] = Header(None)):
    with db() as conn:
        actor = resolve_actor(conn, x_agent, f"released {key.upper()}")
        story = get_story(conn, key)
        conn.execute("UPDATE stories SET agent = NULL, updated_at = ? WHERE key = ?", (now(), story["key"]))
        log(conn, story, actor, "released", "")
        clear_activity(conn, story["key"])
        return story_dict(get_story(conn, key))


@app.post("/api/stories/{key}/comments", status_code=201, tags=["stories"])
def add_comment(key: str, body: CommentIn, x_agent: Optional[str] = Header(None)):
    if not body.body.strip():
        raise HTTPException(400, "Comment body is empty")
    with db() as conn:
        actor = resolve_actor(conn, x_agent, f"commented on {key.upper()}")
        story = get_story(conn, key)
        log(conn, story, actor, "comment", body.body.strip())
        conn.execute("UPDATE stories SET updated_at = ? WHERE key = ?", (now(), story["key"]))
        return dict(conn.execute("SELECT * FROM events WHERE id = last_insert_rowid()").fetchone())


# activity & agents

@app.get("/api/events", tags=["activity"])
def list_events(
    since: Optional[str] = Query(None, description="ISO timestamp; only newer events"),
    project: Optional[str] = None,
    story: Optional[str] = None,
    actor: Optional[str] = Query(None, description="Only events by this actor ('you' = the human)"),
    limit: int = Query(100, le=500),
):
    sql, args = "SELECT * FROM events WHERE 1=1", []
    for field, value in (("project", project and project.upper()), ("story_key", story and story.upper()), ("actor", actor)):
        if value:
            sql += f" AND {field} = ?"
            args.append(value)
    if since:
        sql += " AND created_at > ?"
        args.append(since)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with db() as conn:
        return [dict(r) for r in conn.execute(sql, args)]


@app.get("/api/agents", tags=["agents"])
def list_agents():
    with db() as conn:
        agents = {r["name"]: dict(r) for r in conn.execute("SELECT * FROM agents")}
        # Agents named as a project default show up even before they've called the API.
        for p in conn.execute("SELECT agent FROM projects WHERE agent IS NOT NULL"):
            agents.setdefault(p["agent"], {"name": p["agent"], "color": agent_color(p["agent"]), "last_seen": None, "last_action": "",
                                           "activity": None, "activity_story": None, "activity_at": None})
        for a in agents.values():
            a["projects"] = [r["id"] for r in conn.execute("SELECT id FROM projects WHERE agent = ?", (a["name"],))]
            a["active_stories"] = conn.execute(
                "SELECT COUNT(*) FROM stories WHERE agent = ? AND col IN ('today','doing')", (a["name"],)).fetchone()[0]
        return sorted(agents.values(), key=lambda a: a["name"])


@app.put("/api/agents/{name}/activity", tags=["agents"])
def set_activity(name: str, body: ActivityIn):
    """Tell the board what kind of work the agent is doing right now (shown in the office view).
    Cleared automatically when the story leaves In progress or is released."""
    activity = body.activity.strip().lower()
    if activity not in ACTIVITIES:
        raise HTTPException(400, f"activity must be one of {ACTIVITIES}")
    with db() as conn:
        name = resolve_actor(conn, name, f"is {activity}" + (f" on {body.story.upper()}" if body.story else ""))
        story = get_story(conn, body.story)["key"] if body.story else None
        if activity == "idle":
            activity, story = None, None
        conn.execute("UPDATE agents SET activity = ?, activity_story = ?, activity_at = ? WHERE name = ?",
                     (activity, story, now() if activity else None, name))
        return dict(conn.execute("SELECT * FROM agents WHERE name = ?", (name,)).fetchone())


@app.get("/api/agents/{name}/today", tags=["agents"])
def agent_today(
    name: str,
    project: Optional[str] = Query(None, description="Comma-separated project ids; defaults to projects whose default agent is this agent"),
    since: Optional[str] = Query(None, description="ISO timestamp for human instructions; defaults to the last 24h"),
):
    """Everything an agent needs to plan its day: its assigned work, what's available to pick up,
    and comments the human left on its stories."""
    with db() as conn:
        name = resolve_actor(conn, name, "checked today's work")
        if project:
            pids = [p.strip().upper() for p in project.split(",") if p.strip()]
        else:
            pids = [r["id"] for r in conn.execute("SELECT id FROM projects WHERE agent = ?", (name,))]
        marks = ",".join("?" * len(pids))
        assigned = [story_dict(r) for r in conn.execute(
            "SELECT * FROM stories WHERE agent = ? AND col != 'done' ORDER BY "
            "CASE col WHEN 'doing' THEN 0 WHEN 'today' THEN 1 WHEN 'review' THEN 2 ELSE 3 END, priority, position", (name,))]
        available = [story_dict(r) for r in conn.execute(
            f"SELECT * FROM stories WHERE agent IS NULL AND col IN ('backlog','today') AND project IN ({marks}) "
            "ORDER BY CASE col WHEN 'today' THEN 0 ELSE 1 END, priority, position", pids)] if pids else []
        since = since or (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        keys = [s["key"] for s in assigned]
        instructions = [dict(r) for r in conn.execute(
            f"SELECT * FROM events WHERE actor = ? AND kind = 'comment' AND created_at > ? "
            f"AND story_key IN ({','.join('?' * len(keys))}) ORDER BY id", [HUMAN, since, *keys])] if keys else []
        return {"agent": name, "projects": pids, "assigned": assigned, "available": available, "instructions": instructions}


@app.get("/office", include_in_schema=False)
def office():
    return FileResponse(Path(__file__).parent / "static" / "office.html")


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
