---
name: boarders
description: Use the local Boarders kanban board (http://localhost:8765) to plan the day, pick up stories, move cards, post progress and read the human's instructions. Use when asked to "plan the day", "check the board", "pick up tasks", "work on <KEY>-<n>", or to report progress on a story.
---

# Boarders board

Boarders is the human's local kanban board. Each story's **prompt** is your instructions for that piece of work.
Base URL: `http://localhost:8765/api` (full OpenAPI docs at `http://localhost:8765/docs`).

## Who you are

Your agent name and project keys are in this folder's `CLAUDE.md`, in a block like this:

```
## Boarders
- Agent: ingest-agent
- Projects: ING
```

If that block is missing, ask the human for your agent name and project key before calling the API.

**Every request must send `X-Agent: <your-agent-name>`.** Requests without it are recorded as the human's.

## Columns

`backlog` → `today` → `doing` (In progress) → `review` → `done`

- You may move cards anywhere **except `done`**. When your work is finished, move the card to `review`. The human closes it.
- Only the human can delete stories.

## Calling the API

Use `curl` from Bash. Send JSON bodies with a heredoc, so quotes and newlines are safe:

```bash
A="X-Agent: ingest-agent"; B=http://localhost:8765/api
curl -s -H "$A" "$B/agents/ingest-agent/today"
curl -s -H "$A" -H "Content-Type: application/json" -X POST "$B/stories/ING-4/comments" --data @- <<'EOF'
{"body": "Done with the watermark logic.\nStarting on late-arriving rows."}
EOF
```

| What | Call |
|---|---|
| Plan the day: what's assigned to you, what's available, the human's instructions | `GET /agents/{agent}/today` (`?project=ING,WEB` overrides your default projects; `?since=<ISO>` for instructions) |
| List or search stories | `GET /stories?project=ING&column=backlog,today&agent=none&q=text` |
| Read a story with its full activity log | `GET /stories/{key}` |
| Claim a story | `POST /stories/{key}/claim` (409 if someone else has it) |
| Release a story | `POST /stories/{key}/release` |
| Move a story | `POST /stories/{key}/move` `{"column":"doing","index":0}` (`index` is optional and sets the position) |
| Update fields | `PATCH /stories/{key}` with any of `title`, `prompt`, `priority` (1-3), `type`, `agent`, `blocked`, `checklist` |
| Set your plan | `PATCH /stories/{key}` `{"checklist":[{"text":"Write tests","done":false}, ...]}` (sends the whole list every time) |
| Mark blocked / unblocked | `PATCH /stories/{key}` `{"blocked":"Need DB credentials"}`; send `{"blocked":null}` to clear it |
| Comment | `POST /stories/{key}/comments` `{"body":"..."}` |
| Say what kind of work you're doing | `PUT /agents/{agent}/activity` `{"activity":"coding","story":"ING-4"}`. `activity` is one of `coding`, `data`, `planning`, `testing`, `research`, `idle`. |
| Log a follow-up / bug you found | `POST /stories` `{"project":"ING","title":"...","prompt":"...","priority":2,"type":"Bug","column":"backlog","source":"ING-4"}` (see below) |

## Workflows

### "Plan my day" / "check the board"
1. `GET /agents/{you}/today`.
2. Read `instructions` first. They are comments the human left on your stories. Act on them.
3. Choose today's work from `assigned` plus `available`. Order by column (doing > today > backlog) and then priority (P1 first). Be realistic: about 3-5 stories.
4. For each story you pick: `claim` it, move it to `today`, and `PATCH` a `checklist` with your step-by-step plan.
5. Report the plan back to the human in chat as a short table (key, title, why, first step). **Do not start coding until the human says go**, unless they already told you to proceed.

### Working a story
1. `GET /stories/{key}` and read the prompt and every comment.
2. Move it to `doing`.
   - Whenever you switch kinds of work, set your activity:
     - `planning`: reading and designing
     - `coding`: writing code
     - `data`: SQL, files, data inspection
     - `testing`: running and fixing tests
     - `research`: docs and investigation
   - The human's office view uses this to show where you are. It clears itself when the story leaves `doing`.
3. As you finish plan steps, `PATCH` the checklist so progress shows on the card. Post a comment at meaningful milestones: what changed, which files, any decision you made.
4. If you get stuck on something only the human can resolve, set `blocked` with a clear one-line reason, comment with the details, and move on to your next story.
5. When it's done: post a summary comment (what changed, how to verify, follow-ups), then move the card to `review`.
6. Don't change a story's `prompt` unless the human asks you to. Put your notes in comments.

### Logging follow-ups and bugs you find
While working you'll spot things that are out of scope for the current story: a bug in nearby code, missing tests, tech debt, a needed migration, an idea. **Don't fix them now, and don't let them get lost. Create a card.**

1. Check it isn't already on the board: `GET /stories?project=ING&q=<keyword>`. If it is, comment on that story instead.
2. `POST /stories` with:
   - `project`: the project the work belongs to. This can be a different project if you found something there.
   - `title`: short and specific, e.g. "Claims loader drops rows with null member_id".
   - `type`: `Bug` for defects, `Task` for tech debt and chores, `Story` for features.
   - `priority`: your honest estimate. 1 means it's breaking something now, 2 means it should be done soon, 3 means nice to have.
   - `column`: `backlog`. Use `today` only if it blocks today's work.
   - `source`: the key of the story you were working on, so the human can see where it came from.
   - `prompt`: **write it as a prompt for the agent who will pick it up later**, who won't have your current context. Include what you observed, where it is (file paths, functions, line numbers), how to reproduce it, what you think the fix is, and acceptance criteria.
3. Leave it unassigned. Don't claim it or start it unless the human asks.
4. Mention the new key in your next comment on the source story, and in your chat report to the human.

Your new cards show up for the human under **New from agents** until they open them.

### Following up
When the human asks for status, re-read `/agents/{you}/today` and the stories you're working on. Answer with what moved, what's blocked, and what's next.
