# Boarders

A small local kanban board for running several projects in parallel with Claude Code agents.
You write stories whose descriptions are prompts. Agents pick them up, plan, move cards and report progress through a REST API.

## Run

You need Docker (with Compose).

```bash
cp .env.example .env        # optional settings, see below
docker compose up -d --build
```

- Board: http://localhost:8765
- Office: http://localhost:8765/office
- API docs (Swagger): http://localhost:8765/docs

Data lives in `./data/boarders.db` (SQLite), so it survives rebuilds. Back it up by copying that file.

Optional settings go in `.env` (see [.env.example](.env.example)):
- `AGENTS_CAN_CLOSE`: default `false`. Agents can move stories up to Review, and only you move them to Done.
- `OFFICE_LAT` / `OFFICE_LON` / `OFFICE_PLACE`: show the real weather in the office windows. Leave them unset to disable weather.

### Windows without Docker Desktop

If Docker Desktop isn't an option, you can run Docker Engine inside WSL instead:

```bash
wsl -d Ubuntu -- sh -c 'cd "$(wslpath "<path-to-boarders>")" && docker compose up -d --build'
```

The container restarts on its own (`restart: unless-stopped`) whenever the WSL Docker engine starts.

WSL stops a distro (and Docker with it) once nothing is attached to it, and sleep can kill it too. [scripts/boarders-keepalive.vbs](scripts/boarders-keepalive.vbs) prevents that:
- Copy it into your Startup folder (`Win+R` → `shell:startup`).
- At logon it runs a hidden `wsl -d Ubuntu --exec sleep infinity`, and restarts it within about 15 seconds whenever it ends.
- To undo it, delete the file from Startup and end its `wscript.exe` process.

## Using the board

- **Projects**: use the `+` next to Projects in the sidebar. The key (e.g. `ING`) prefixes story ids (`ING-1`). Set a *default agent*, and that agent's daily plan includes the project's unassigned work.
- **Stories**: click `+ New story` or press `N`. The prompt is markdown that the agent will read.
- **Columns**: Backlog → Today → In progress → Review → Done. Drag cards to move them or reorder them.
- **Filters**: click a project in the sidebar (or a chip) to show or hide it. There are also views for "Today & in progress" and "Blocked". Press `/` to search.
- **Card drawer**: edit the title, status, priority, assignee, prompt and plan checklist. Comments you post become *instructions* that the agent receives on its next check-in.
- **New from agents**: agents log out-of-scope bugs and follow-ups as Backlog cards, linked to the story where they found them (`↳ ING-4`). Those cards carry a "New" badge and are listed under *New from agents* until you open or move them.
- **Office** (`/office`, linked in the sidebar): a pixel-art office where each agent is a character.
  - Agents walk to a station based on what they're doing:
    - workbench: coding or testing
    - file cabinet: data
    - drawing board: planning
    - bookshelf: research
    - coffee machine: blocked
    - by the wall board: waiting for review
    - desk: idle
  - Agents report this with `PUT /api/agents/{name}/activity`. When they don't, the station is inferred from their cards.
  - Click a character to see their card, plan progress and latest comment. Click the wall board to open the board.
  - Bubbles:
    - **!**: you left a comment on one of their cards that they haven't picked up yet.
    - **…**: blocked.
    - **zzz**: idle and hasn't checked in for 30 minutes.
  - The room's lighting follows your clock: dawn, day, sunset and night, with monitor and lamp glow. Add `?time=22` to the URL to preview any hour.
  - **Weather**: the windows show the real weather from [Open-Meteo](https://open-meteo.com): clear, clouds, rain, storms with lightning, snow and fog.
    - Sunrise and sunset come from it too, and an umbrella stand fills up when it rains.
    - The location is set by `OFFICE_LAT` / `OFFICE_LON` / `OFFICE_PLACE` in `.env`.
    - Your browser fetches the weather directly (no API key, cached for 15 min), which also works behind TLS-inspecting corporate proxies. Those coordinates are sent to Open-Meteo.
    - Preview a weather with `?weather=rain` (also `clear`, `cloudy`, `fog`, `drizzle`, `storm`, `snow`). It combines with `?time=`.
- The board polls every 4 seconds, so agent activity shows up live.

## Connecting agents

1. Install the skill once for your user, so every Claude Code session has it:

   ```bash
   mkdir -p ~/.claude/skills && cp -r agent-kit/skills/boarders ~/.claude/skills/
   ```

2. In each project folder, add this to `CLAUDE.md` (create the file if needed):

   ```markdown
   ## Boarders
   - Agent: ingest-agent
   - Projects: ING
   ```

3. Start Claude Code in that folder and say *"plan my day from the board"*. The agent will:
   - fetch its work
   - read your comments
   - claim stories, move them to Today and write a plan on each
   - report back before starting

## API summary

Agents identify themselves with the `X-Agent: <name>` header. Requests without it count as you.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/agents/{name}/today` | Assigned work, available work and your instructions |
| GET | `/api/stories?project=&column=&agent=&blocked=&q=` | List or search stories |
| POST | `/api/stories` | Create a story |
| GET / PATCH / DELETE | `/api/stories/{key}` | Read (with activity), update or delete (delete is for you only) |
| POST | `/api/stories/{key}/move` | `{column, index?}` |
| POST | `/api/stories/{key}/claim` · `/release` | Take or drop ownership |
| POST | `/api/stories/{key}/comments` | Add a comment |
| GET | `/api/events?since=&project=&story=&actor=` | Activity feed |
| GET / POST / PATCH / DELETE | `/api/projects[/{id}]` | Manage projects |
| GET | `/api/agents` | Known agents, their current activity and when each was last seen |
| PUT | `/api/agents/{name}/activity` | `{activity, story?}`: `coding`, `data`, `planning`, `testing`, `research` or `idle` |

## Development

The app is FastAPI and SQLite in `app/main.py`, plus a no-build vanilla JS frontend in `app/static/`.
To run it without Docker:

```bash
pip install -r requirements.txt
BOARDERS_DB=./data/boarders.db uvicorn app.main:app --reload --port 8765
```

## Security

Boarders has **no authentication**. Anyone who can reach the port can read and change every story, and agents are identified only by the `X-Agent` header they choose to send.

- `docker-compose.yml` binds to `127.0.0.1`, so only your own machine can reach it. Keep it that way.
- Don't expose it on a network or the internet without putting real authentication in front of it.
- Story prompts are instructions your agents will act on, so treat write access to the board like write access to your agents.

## License

[MIT](LICENSE)
