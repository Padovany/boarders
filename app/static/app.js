// Boarders frontend — vanilla JS, no build step.
const $ = s => document.querySelector(s);
const PALETTE = ["#7c8cff", "#3ecf8e", "#f5b14c", "#e879b9", "#4cc9f0", "#c17cff", "#ff8a65", "#a3e635"];
const POLL_MS = 4000;

const state = {
  meta: { columns: [], types: ["Story", "Task", "Bug"] },
  projects: [], stories: [], agents: [],
  view: load("view", "all"),
  hidden: new Set(load("hidden", [])),   // project ids filtered out
  q: "", prio: "", agent: "",
  openKey: null, dragging: null,
};

function load(k, d) { try { const v = localStorage.getItem("boarders." + k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem("boarders." + k, JSON.stringify(v)); } catch {} }
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = n => n === "you" ? "Y" : n.split(/[-_.]/).filter(Boolean).map(s => s[0]).join("").toUpperCase().slice(0, 2);
const proj = id => state.projects.find(p => p.id === id) || { id, name: id, color: "#6b7489" };
const agentColor = n => n === "you" ? "#c3c9d6" : (state.agents.find(a => a.name === n)?.color || "#a3abbd");
const colName = id => state.meta.columns.find(c => c.id === id)?.name || id;

function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 45) return "now";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}
function when(iso) {
  const d = new Date(iso), s = (Date.now() - d) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    toast(msg, true);
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

let toastTimer;
function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = "toast", 2600);
}

async function refresh() {
  const [projects, stories, agents] = await Promise.all([api("GET", "/projects"), api("GET", "/stories"), api("GET", "/agents")]);
  Object.assign(state, { projects, stories, agents });
  render();
}

/* ---------- filtering ---------- */

function visibleStories() {
  const q = state.q.toLowerCase();
  return state.stories.filter(s =>
    !state.hidden.has(s.project) &&
    (state.view !== "today" || ["today", "doing"].includes(s.column)) &&
    (state.view !== "blocked" || s.blocked) &&
    (state.view !== "inbox" || !s.triaged) &&
    (!state.prio || s.priority == state.prio) &&
    (!state.agent || (state.agent === "none" ? !s.agent : s.agent === state.agent)) &&
    (!q || (s.key + " " + s.title + " " + s.prompt).toLowerCase().includes(q)));
}

/* ---------- render ---------- */

function render() {
  renderSidebar();
  renderToolbar();
  if (!state.dragging) renderBoard();
}

function renderSidebar() {
  const open = state.stories.filter(s => s.column !== "done");
  $("#cAll").textContent = open.length || "";
  $("#cToday").textContent = state.stories.filter(s => ["today", "doing"].includes(s.column)).length || "";
  $("#cBlocked").textContent = state.stories.filter(s => s.blocked).length || "";
  const inbox = state.stories.filter(s => !s.triaged).length;
  $("#cInbox").textContent = inbox || "";
  $("#cInbox").classList.toggle("hot", inbox > 0);
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === state.view));
  $("#viewTitle").textContent = { all: "All stories", today: "Today & in progress", inbox: "New from agents", blocked: "Blocked" }[state.view];

  setHTML($("#projList"), state.projects.length ? state.projects.map(p => `
    <button class="nav-item ${state.hidden.has(p.id) ? "off" : ""}" data-toggle="${p.id}" title="Show/hide ${esc(p.name)}">
      <span class="dot" style="background:${p.color}"></span>${esc(p.name)}
      <span class="count">${p.open_count || ""}</span><span class="edit" data-edit="${p.id}" title="Edit project">✎</span>
    </button>`).join("") : `<div class="empty-side">No projects yet</div>`);

  setHTML($("#agentList"), state.agents.length ? state.agents.map(a => {
    const live = a.last_seen && Date.now() - new Date(a.last_seen) < 15 * 60e3;
    return `<div class="agent-row" title="${esc(a.last_action || "no activity yet")}${a.projects.length ? " · " + a.projects.join(", ") : ""}">
      <span class="status ${live ? "on" : ""}"></span><span class="name mono">${esc(a.name)}</span><small>${a.active_stories ? a.active_stories + " · " : ""}${ago(a.last_seen)}</small></div>`;
  }).join("") : `<div class="empty-side">Agents appear here once they call the API</div>`);

  const live = state.agents.filter(a => a.last_seen && Date.now() - new Date(a.last_seen) < 15 * 60e3).length;
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  $("#sub").textContent = `${today} · ${state.projects.length} project${state.projects.length === 1 ? "" : "s"} · ${live} agent${live === 1 ? "" : "s"} active`;
}

function renderToolbar() {
  setHTML($("#chips"), state.projects.map(p =>
    `<button class="chip ${state.hidden.has(p.id) ? "" : "on"}" data-toggle="${p.id}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join(""));
  const names = [...new Set([...state.agents.map(a => a.name), ...state.stories.map(s => s.agent).filter(Boolean)])].sort();
  setHTML($("#fAgent"), `<option value="">Any</option><option value="none">Unassigned</option>` +
    names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join(""));
  $("#fAgent").value = state.agent;
  $("#fPrio").value = state.prio;
}

function cardHTML(s) {
  const p = proj(s.project);
  return `<div class="card ${s.blocked ? "is-blocked" : ""}" draggable="true" data-key="${s.key}" style="--pc:${p.color}">
    <div class="top"><span class="key mono">${s.key}</span>·<span class="proj">${esc(p.name)}</span><span style="margin-left:auto">${esc(s.type)}</span></div>
    ${s.triaged ? "" : `<div class="new-badge" title="Created by ${esc(s.created_by)} — open it to mark as seen">✦ New from ${esc(s.created_by)}</div>`}
    <div class="title">${esc(s.title)}</div>
    ${s.prompt ? `<div class="prompt">${esc(s.prompt.replace(/^#+\s*/gm, "").slice(0, 300))}</div>` : ""}
    <div class="meta">
      <span class="prio p${s.priority}">P${s.priority}</span>
      ${s.source ? `<span class="src mono" title="Found while working on ${s.source}">↳ ${s.source}</span>` : ""}
      ${s.blocked ? `<span class="blocked" title="${esc(s.blocked)}">⛔ Blocked</span>` : ""}
      ${s.agent ? `<span class="agent">${s.column === "doing" && !s.blocked ? '<span class="pulse"></span>' : ""}<span class="av" style="background:${agentColor(s.agent)}">${initials(s.agent)}</span><span class="mono">${esc(s.agent)}</span></span>`
                : `<span class="agent none">unassigned</span>`}
    </div>
    ${s.progress != null ? `<div class="progress" title="${s.progress}% of plan done"><i style="width:${s.progress}%"></i></div>` : ""}
  </div>`;
}

function renderBoard() {
  const board = $("#board");
  if (!state.projects.length) {
    board.style.display = "flex";
    delete board.dataset.html;
    board.innerHTML = `<div class="welcome">
      <div class="logo"><svg viewBox="0 0 16 16" fill="#0b0d12"><rect x="1" y="2" width="4" height="12" rx="1"/><rect x="6" y="2" width="4" height="8" rx="1"/><rect x="11" y="2" width="4" height="5" rx="1"/></svg></div>
      <h2>Welcome to Boarders</h2>
      <p>Create a project, then add stories whose descriptions are prompts for your Claude Code agents.</p>
      <button class="btn primary" onclick="openProjectModal()">+ Create first project</button></div>`;
    return;
  }
  board.style.display = "";
  const list = visibleStories();
  const html = state.meta.columns.map(col => {
    const items = list.filter(s => s.column === col.id);
    const all = state.stories.filter(s => s.column === col.id).length;
    return `<section class="col">
      <div class="col-head"><span class="bar" style="background:${col.color}"></span>${col.name}<span class="n">${items.length}</span>
        ${col.wip ? `<span class="wip ${all > col.wip ? "over" : ""}">WIP ${all}/${col.wip}</span>` : ""}</div>
      <div class="col-body" data-col="${col.id}">
        ${items.map(cardHTML).join("") || (col.id === "backlog" ? "" : `<div class="col-empty">Nothing here</div>`)}
        ${col.id === "backlog" ? `<button class="add-card" data-add="backlog">+ Add story</button>` : ""}
      </div></section>`;
  }).join("");
  // Polling re-renders every few seconds: leave the DOM alone when nothing changed,
  // and keep each column's scroll position when something did.
  if (html === board.dataset.html) return;
  const scroll = Object.fromEntries([...board.querySelectorAll(".col-body")].map(b => [b.dataset.col, b.scrollTop]));
  const left = board.scrollLeft;
  board.innerHTML = html;
  board.dataset.html = html;
  board.querySelectorAll(".col-body").forEach(b => { b.scrollTop = scroll[b.dataset.col] || 0; });
  board.scrollLeft = left;
}

// Same idea for the sidebar and toolbar, so open dropdowns and hover states survive polling.
function setHTML(el, html) {
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

/* ---------- drag & drop ---------- */

const board = $("#board");
let marker = document.createElement("div");
marker.className = "drop-marker";

function dropIndex(body, y) {
  const cards = [...body.querySelectorAll(".card:not(.dragging)")];
  const i = cards.findIndex(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return { cards, i: i < 0 ? cards.length : i };
}

board.addEventListener("dragstart", e => {
  const card = e.target.closest(".card"); if (!card) return;
  state.dragging = card.dataset.key;
  e.dataTransfer.setData("text/plain", card.dataset.key);
  e.dataTransfer.effectAllowed = "move";
  requestAnimationFrame(() => card.classList.add("dragging"));
});
board.addEventListener("dragend", () => {
  state.dragging = null; marker.remove();
  document.querySelectorAll(".drop").forEach(b => b.classList.remove("drop"));
  delete board.dataset.html;  // the DOM was touched during the drag; force a clean redraw
  renderBoard();
});
board.addEventListener("dragover", e => {
  const body = e.target.closest(".col-body"); if (!body || !state.dragging) return;
  e.preventDefault();
  document.querySelectorAll(".drop").forEach(b => b !== body && b.classList.remove("drop"));
  body.classList.add("drop");
  const { cards, i } = dropIndex(body, e.clientY);
  const ref = cards[i] || body.querySelector(".add-card") || null;
  if (marker.nextSibling !== ref || marker.parentNode !== body) body.insertBefore(marker, ref);
});
board.addEventListener("drop", async e => {
  const body = e.target.closest(".col-body"); if (!body) return;
  e.preventDefault();
  const key = state.dragging, column = body.dataset.col;
  const { cards, i } = dropIndex(body, e.clientY);
  // Translate position among visible cards into an index among all cards in the column.
  const colKeys = state.stories.filter(s => s.column === column && s.key !== key).map(s => s.key);
  const index = cards[i] ? colKeys.indexOf(cards[i].dataset.key) : (cards.length ? colKeys.indexOf(cards[cards.length - 1].dataset.key) + 1 : colKeys.length);
  const s = state.stories.find(x => x.key === key);
  state.dragging = null; marker.remove();
  if (s) {
    // Optimistic reorder.
    state.stories = state.stories.filter(x => x.key !== key);
    s.column = column;
    const before = state.stories.findIndex(x => x.key === colKeys[index]);
    state.stories.splice(before < 0 ? state.stories.length : before, 0, s);
    renderBoard();
  }
  try { await api("POST", `/stories/${key}/move`, { column, index }); } finally { refresh(); reloadStory(key); }
});
board.addEventListener("click", e => {
  const add = e.target.closest("[data-add]");
  if (add) return openStoryModal(add.dataset.add);
  const card = e.target.closest(".card");
  if (card) openStory(card.dataset.key);
});

/* ---------- story drawer ---------- */

async function openStory(key) {
  state.openKey = key;
  const s = await api("GET", `/stories/${key}`);
  if (state.openKey !== key) return;
  drawStory(s);
  if (!s.triaged) api("PATCH", `/stories/${key}`, { triaged: true }).then(refresh).catch(() => {});
  $("#drawer").classList.add("open");
  $("#scrim").classList.add("open");
}

// Redraw the drawer after a change, but only if it is still showing that story.
async function reloadStory(key) {
  if (state.openKey !== key) return;
  const s = await api("GET", `/stories/${key}`).catch(() => null);
  if (s && state.openKey === key) drawStory(s);
}

function eventHTML(e) {
  const c = agentColor(e.actor);
  const who = `<div class="who"><b class="${e.actor === "you" ? "" : "mono"}">${e.actor === "you" ? "You" : esc(e.actor)}</b><span>${when(e.created_at)}</span></div>`;
  const text = {
    comment: `<div class="msg box">${esc(e.body)}</div>`,
    created: `<div class="msg">created this story ${esc(e.body)}</div>`,
    follow_up: `<div class="msg">logged follow-up <a class="link mono" data-open="${esc(e.body)}">${esc(e.body)}</a></div>`,
    moved: `<div class="msg">moved <b>${esc(e.body)}</b></div>`,
    claimed: `<div class="msg">claimed this story${e.body ? ` for <b>${esc(e.body)}</b>` : ""}</div>`,
    released: `<div class="msg">released this story</div>`,
    assigned: `<div class="msg">assigned to <b>${esc(e.body)}</b></div>`,
    blocked: `<div class="msg">marked blocked: <b>${esc(e.body)}</b></div>`,
    unblocked: `<div class="msg">cleared the block</div>`,
    checklist: `<div class="msg">updated the plan</div>`,
    updated: `<div class="msg">edited ${esc(e.body)}</div>`,
  }[e.kind] || `<div class="msg">${esc(e.kind)} ${esc(e.body)}</div>`;
  return `<div class="ev"><div class="av" style="background:${c}">${initials(e.actor)}</div><div>${who}${text}</div></div>`;
}

function drawStory(s) {
  const p = proj(s.project);
  const agents = [...new Set([...state.agents.map(a => a.name), s.agent].filter(Boolean))];
  const done = s.checklist.filter(i => i.done).length;
  const scroll = $("#drawer").dataset.key === s.key ? $(".d-body")?.scrollTop : 0;
  $("#drawer").dataset.key = s.key;
  requestAnimationFrame(() => { if ($(".d-body")) $(".d-body").scrollTop = scroll || 0; });
  $("#drawer").innerHTML = `
    <div class="d-head">
      <div class="row"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}<span>/</span><span class="mono">${s.key}</span>
        <span class="spacer"></span>
        <button class="btn sm" id="copyRef" title="Copy an instruction for an agent">Copy ref</button>
        <button class="icon-btn" id="closeD" title="Close (Esc)">✕</button></div>
      <input class="title-input" id="fTitle" value="${esc(s.title)}">
      ${s.created_by !== "you" || s.source ? `<div class="origin" style="margin:-8px 0 12px">Created by <span class="mono">${s.created_by === "you" ? "you" : esc(s.created_by)}</span>${s.source ? ` while working on <a class="link mono" data-open="${s.source}">${s.source}</a>` : ""}</div>` : ""}
      <div class="fields">
        <div class="field"><label>Status</label><select id="fCol">${state.meta.columns.map(c => `<option value="${c.id}" ${c.id === s.column ? "selected" : ""}>${c.name}</option>`).join("")}</select></div>
        <div class="field"><label>Priority</label><select id="fPri">${[1, 2, 3].map(n => `<option value="${n}" ${n === s.priority ? "selected" : ""}>P${n}</option>`).join("")}</select></div>
        <div class="field"><label>Assignee</label><input id="fAg" list="agentNames" value="${esc(s.agent || "")}" placeholder="unassigned" class="mono">
          <datalist id="agentNames">${agents.map(a => `<option value="${esc(a)}">`).join("")}</datalist></div>
        <div class="field"><label>Type</label><select id="fType">${state.meta.types.map(t => `<option ${t === s.type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      </div>
      ${s.blocked ? `<div class="block-banner">⛔ <span>${esc(s.blocked)}</span><button class="btn sm" id="unblock">Clear</button></div>` : ""}
    </div>
    <div class="d-body">
      <div class="section-label"><span>Agent prompt</span><span class="actions">
        <button class="btn sm" id="copyPrompt">Copy</button><button class="btn sm" id="editPrompt">Edit</button></span></div>
      <div id="promptArea"><pre class="prompt-box ${s.prompt ? "" : "empty"}">${s.prompt ? esc(s.prompt) : "No prompt yet. Click Edit to write one."}</pre></div>

      <div class="gap"></div>
      <div class="section-label"><span>Plan${s.checklist.length ? ` · ${done}/${s.checklist.length}` : ""}</span></div>
      <ul class="checklist">${s.checklist.map((it, i) => `<li class="${it.done ? "done" : ""}">
        <button class="cb" data-check="${i}">${it.done ? "✓" : ""}</button><span class="t">${esc(it.text)}</span><button class="rm" data-rm="${i}" title="Remove">✕</button></li>`).join("")}</ul>
      <input class="add-item" id="addItem" placeholder="+ Add plan step and press Enter">

      <div class="gap"></div>
      <div class="section-label"><span>Activity</span><span class="actions">
        ${s.blocked ? "" : `<button class="btn sm" id="block">Mark blocked</button>`}
        <button class="btn sm danger" id="del">Delete</button></span></div>
      <div class="timeline">${s.events.map(eventHTML).join("")}</div>
    </div>
    <div class="d-foot"><textarea id="comment" placeholder="Comment or instruction for the agent…  (Ctrl+Enter)"></textarea><button class="btn primary" id="send">Send</button></div>`;

  const patch = body => api("PATCH", `/stories/${s.key}`, body).then(() => { refresh(); reloadStory(s.key); });
  const title = $("#fTitle");
  title.onkeydown = e => { if (e.key === "Enter") title.blur(); if (e.key === "Escape") { title.value = s.title; title.blur(); e.stopPropagation(); } };
  title.onblur = () => title.value.trim() && title.value.trim() !== s.title && patch({ title: title.value.trim() });
  $("#fCol").onchange = e => api("POST", `/stories/${s.key}/move`, { column: e.target.value }).finally(() => { refresh(); reloadStory(s.key); });
  $("#fPri").onchange = e => patch({ priority: +e.target.value });
  $("#fType").onchange = e => patch({ type: e.target.value });
  $("#fAg").onchange = e => patch({ agent: e.target.value.trim() || null });
  $("#closeD").onclick = closeStory;
  $("#copyRef").onclick = () => copy(`Work on Boarders story ${s.key}: ${s.title}`, "Reference copied");
  $("#copyPrompt").onclick = () => copy(s.prompt, "Prompt copied");
  $("#editPrompt").onclick = () => {
    $("#promptArea").innerHTML = `<textarea class="prompt-edit" id="promptText">${esc(s.prompt)}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn primary sm" id="savePrompt">Save</button><button class="btn sm" id="cancelPrompt">Cancel</button>
      <span style="color:var(--text-3);font-size:12px;align-self:center">Ctrl+Enter to save</span></div>`;
    const ta = $("#promptText"); ta.focus();
    const savePrompt = () => patch({ prompt: ta.value });
    $("#savePrompt").onclick = savePrompt;
    $("#cancelPrompt").onclick = () => drawStory(s);
    ta.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) savePrompt(); if (e.key === "Escape") { e.stopPropagation(); drawStory(s); } };
  };
  document.querySelectorAll("[data-check]").forEach(b => b.onclick = () => {
    const cl = s.checklist.map(x => ({ ...x })); cl[b.dataset.check].done = !cl[b.dataset.check].done; patch({ checklist: cl });
  });
  document.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => patch({ checklist: s.checklist.filter((_, i) => i != b.dataset.rm) }));
  $("#addItem").onkeydown = e => { if (e.key === "Enter" && e.target.value.trim()) patch({ checklist: [...s.checklist, { text: e.target.value.trim(), done: false }] }); };
  if ($("#unblock")) $("#unblock").onclick = () => patch({ blocked: null });
  if ($("#block")) $("#block").onclick = () => { const r = prompt("What is blocking this story?"); if (r && r.trim()) patch({ blocked: r.trim() }); };
  $("#del").onclick = async () => {
    if (!confirm(`Delete ${s.key} "${s.title}"? This cannot be undone.`)) return;
    await api("DELETE", `/stories/${s.key}`); closeStory(); refresh(); toast(`${s.key} deleted`);
  };
  const c = $("#comment");
  const send = async () => { if (!c.value.trim()) return; await api("POST", `/stories/${s.key}/comments`, { body: c.value }); refresh(); reloadStory(s.key); };
  $("#send").onclick = send;
  c.oninput = () => { c.style.height = "38px"; c.style.height = Math.min(c.scrollHeight + 2, 160) + "px"; };
  c.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); };
}

function closeStory() {
  state.openKey = null;
  $("#drawer").classList.remove("open");
  $("#scrim").classList.remove("open");
}

function copy(text, msg) {
  navigator.clipboard.writeText(text).then(() => toast(msg), () => toast("Clipboard unavailable", true));
}

/* ---------- modals ---------- */

function closeModal() { $("#modal").classList.remove("open"); $("#modal").innerHTML = ""; }

function openStoryModal(column = "backlog") {
  if (!state.projects.length) return openProjectModal();
  const visible = state.projects.filter(p => !state.hidden.has(p.id));
  const def = load("lastProject", null);
  const pid = (visible.find(p => p.id === def) || visible[0] || state.projects[0]).id;
  $("#modal").innerHTML = `<div class="modal"><h3>New story</h3><form id="storyForm">
    <div class="grid">
      <div class="field"><label>Project</label><select name="project">${state.projects.map(p => `<option value="${p.id}" ${p.id === pid ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Column</label><select name="column">${state.meta.columns.filter(c => c.id !== "done").map(c => `<option value="${c.id}" ${c.id === column ? "selected" : ""}>${c.name}</option>`).join("")}</select></div>
      <div class="field"><label>Priority</label><select name="priority"><option value="1">P1</option><option value="2" selected>P2</option><option value="3">P3</option></select></div>
      <div class="field"><label>Type</label><select name="type">${state.meta.types.map(t => `<option>${t}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Title</label><input name="title" required autocomplete="off" placeholder="Short summary"></div>
    <div class="field"><label>Prompt for the agent (markdown)</label><textarea name="prompt" placeholder="What should the agent do? Include context, constraints and acceptance criteria."></textarea></div>
    <div class="foot"><span class="hint">Ctrl+Enter to create</span><span class="spacer"></span>
      <button type="button" class="btn" id="cancel">Cancel</button><button class="btn primary">Create story</button></div>
  </form></div>`;
  $("#modal").classList.add("open");
  const f = $("#storyForm");
  f.title.focus();
  $("#cancel").onclick = closeModal;
  f.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) f.requestSubmit(); };
  f.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const s = await api("POST", "/stories", { ...d, priority: +d.priority });
    save("lastProject", d.project);
    closeModal(); toast(`${s.key} created`); refresh();
  };
}

function openProjectModal(id) {
  const p = id ? state.projects.find(x => x.id === id) : null;
  let color = p?.color || PALETTE[state.projects.length % PALETTE.length];
  $("#modal").innerHTML = `<div class="modal"><h3>${p ? "Edit project" : "New project"}</h3><form id="projForm">
    <div class="grid two">
      <div class="field"><label>Key</label><input name="id" required maxlength="8" placeholder="ING" class="mono" style="text-transform:uppercase" ${p ? `value="${p.id}" disabled` : ""}></div>
      <div class="field"><label>Name</label><input name="name" required placeholder="my-api" value="${esc(p?.name || "")}"></div>
    </div>
    <div class="field"><label>Default agent</label><input name="agent" class="mono" placeholder="e.g. ingest-agent — the agent that plans this project's work" value="${esc(p?.agent || "")}"></div>
    <div class="field"><label>Description</label><input name="description" placeholder="Optional — repo path, context for agents…" value="${esc(p?.description || "")}"></div>
    <div class="field"><label>Color</label><div class="swatches">${PALETTE.map(c => `<button type="button" class="swatch ${c === color ? "on" : ""}" data-c="${c}" style="background:${c}"></button>`).join("")}</div></div>
    <div class="foot">${p ? `<button type="button" class="btn danger" id="delProj">Delete project</button>` : `<span class="hint">Key prefixes story ids, e.g. ING-1</span>`}
      <span class="spacer"></span><button type="button" class="btn" id="cancel">Cancel</button><button class="btn primary">${p ? "Save" : "Create project"}</button></div>
  </form></div>`;
  $("#modal").classList.add("open");
  const f = $("#projForm");
  (p ? f.name : f.id).focus();
  $("#cancel").onclick = closeModal;
  f.querySelectorAll(".swatch").forEach(b => b.onclick = () => {
    color = b.dataset.c; f.querySelectorAll(".swatch").forEach(x => x.classList.toggle("on", x === b));
  });
  if (p) $("#delProj").onclick = async () => {
    if (!confirm(`Delete project ${p.name} and all ${p.open_count} open stories? This cannot be undone.`)) return;
    await api("DELETE", `/projects/${p.id}`); closeModal(); refresh(); toast(`${p.name} deleted`);
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const body = { name: d.name, agent: d.agent || null, description: d.description, color };
    if (p) await api("PATCH", `/projects/${p.id}`, body);
    else await api("POST", "/projects", { ...body, id: d.id.toUpperCase() });
    closeModal(); toast(p ? "Project saved" : "Project created"); refresh();
  };
}

/* ---------- wiring ---------- */

document.addEventListener("click", e => {
  const o = e.target.closest("[data-open]");
  if (o) { e.preventDefault(); return openStory(o.dataset.open); }
  const edit = e.target.closest("[data-edit]");
  if (edit) { e.stopPropagation(); return openProjectModal(edit.dataset.edit); }
  const t = e.target.closest("[data-toggle]");
  if (t) {
    const id = t.dataset.toggle;
    state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
    save("hidden", [...state.hidden]); render();
  }
  const v = e.target.closest("[data-view]");
  if (v) { state.view = v.dataset.view; save("view", state.view); render(); }
});
$("#modal").addEventListener("mousedown", e => { if (e.target.id === "modal") closeModal(); });
$("#scrim").onclick = closeStory;
$("#newStoryBtn").onclick = () => openStoryModal();
$("#newProjectBtn").onclick = () => openProjectModal();
$("#search").oninput = e => { state.q = e.target.value; renderBoard(); };
$("#fPrio").onchange = e => { state.prio = e.target.value; renderBoard(); };
$("#fAgent").onchange = e => { state.agent = e.target.value; renderBoard(); };

const theme = load("theme", "dark");
document.documentElement.dataset.theme = theme;
$("#themeBtn").onclick = () => {
  const t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = t; save("theme", t);
};

document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === "Escape") { if ($("#modal").classList.contains("open")) closeModal(); else closeStory(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "n") { e.preventDefault(); openStoryModal(); }
  if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
});

// Live updates: poll, and refresh the open drawer's activity unless the user is mid-edit.
setInterval(async () => {
  if (document.hidden || state.dragging) return;
  await refresh().catch(() => {});
  const editing = document.activeElement && $("#drawer").contains(document.activeElement) || $("#promptText") || $("#comment")?.value;
  if (state.openKey && !editing) {
    const s = await api("GET", `/stories/${state.openKey}`).catch(() => null);
    if (s && state.openKey === s.key && !$("#promptText")) drawStory(s);
  }
}, POLL_MS);

(async () => {
  state.meta = await api("GET", "/meta");
  await refresh();
  openFromHash();
})();

// Links like /#story=ING-4 (used by the office view) open that story's drawer.
function openFromHash() {
  const m = location.hash.match(/story=([A-Za-z0-9]+-\d+)/);
  if (m) openStory(m[1].toUpperCase());
}
addEventListener("hashchange", openFromHash);
