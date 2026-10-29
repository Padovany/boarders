// Boarders office — a live pixel-art view of the agents. Original art, drawn in code.
const W = 352, H = 208;
const POLL_MS = 4000;
const cv = document.getElementById("c");
let g = cv.getContext("2d");
cv.width = W; cv.height = H;
let scale = 2, now = 0, last = performance.now(), selected = null, hover = null;

/* ---------- drawing helpers ---------- */
const r = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

// Sprites are strings of palette characters; "." is transparent.
function sprite(rows, pal) {
  const c = document.createElement("canvas");
  c.width = rows[0].length; c.height = rows.length;
  const x = c.getContext("2d");
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch !== "." && pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, j, 1, 1); }
  }));
  return c;
}

// 3x5 pixel font for the few letters drawn into the scene.
const GLYPHS = {
  B: ["110","101","110","101","110"], O: ["111","101","101","101","111"], A: ["010","101","111","101","101"],
  R: ["110","101","110","101","101"], D: ["110","101","101","101","110"], E: ["111","100","110","100","111"],
  S: ["011","100","010","001","110"], Z: ["111","001","010","100","111"],
};
function text(str, x, y, c) {
  [...str].forEach((ch, k) => (GLYPHS[ch] || []).forEach((row, j) =>
    [...row].forEach((b, i) => b === "1" && r(x + k * 4 + i, y + j, 1, 1, c))));
}

/* ---------- character sprites ---------- */
const FRONT = [
  "....KKKKKKKK....", "...KHHHHHHHHK...", "..KHHHHHHHHHHK..", "..KHHHHHHHHHHK..", "..KHhHHHHHHhHK..",
  "..KhSSSSSSSShK..", "..KSSKSSSSKSSK..", "..KSSKSSSSKSSK..", "..KsSSSSSSSSsK..", "...KsSSSSSSsK...",
  "....KKKKKKKK....", "...KCCCCCCCCK...", "..KCCCCCCCCCCK..", "..KSKCCCCCCKSK..", "..KSKCCCCCCKSK..",
  "...KKccccccKK...", "....KPPPPPPK....", "....KPPKKPPK....", "....KPPKKPPK....", "....KBBKKBBK....",
  ".....KK..KK.....",
];
const BACK = [
  "....KKKKKKKK....", "...KHHHHHHHHK...", "..KHHHHHHHHHHK..", "..KHHHHHHHHHHK..", "..KHHHHHHHHHHK..",
  "..KHhHHHHHHhHK..", "..KhHHHHHHHHhK..", "..KShhHHHHhhSK..", "...KShhhhhhSK...", "....KKKKKKKK....",
  "...KCCCCCCCCK...", "..KCCCCCCCCCCK..", "..KSKCCCCCCKSK..", "..KSKCCCCCCKSK..", "...KKccccccKK...",
  "....KPPPPPPK....", "....KPPKKPPK....", "....KPPKKPPK....", "....KBBKKBBK....", ".....KK..KK.....",
  "................",
];
const SIDE_HEAD = [
  ".....KKKKKKK....", "....KHHHHHHHK...", "...KHHHHHHHHHK..", "...KHHHHHHHHHK..", "...KHHHHHHHHhK..",
  "...KHHhSSSSSSK..", "...KHhSSSSKSSK..", "...KHhSSSSKSSK..", "...KhSSSSSSSsK..", "....KsSSSSSsK...",
  ".....KKKKKKK....", ".....KCCCCK.....", "....KCCCCCCK....", "....KCCSSCCK....", "....KCCSSCCK....",
  ".....KccccK.....", ".....KPPPPK.....",
];
const SIDE_A = [...SIDE_HEAD, "....KPPKKPPK....", "...KPPK..KPPK...", "...KBBK..KBBK...", "....KK....KK...."];
const SIDE_B = [...SIDE_HEAD, ".....KPPPPK.....", ".....KPPPPK.....", ".....KBBBBK.....", "......KKKK......"];
const FRONT_B = [...FRONT.slice(0, 16), "....KPPPPPPK....", "....KPPKKPPK....", ".....KPPKBBK....", ".....KBBKKK.....", "......KK........"];
const BACK_B = [...BACK.slice(0, 15), "....KPPPPPPK....", "....KPPKKPPK....", "....KBBKKPPK....", ".....KKKKBBK....", "........KK......", "................"];

const HAIRS = ["#4a2f22", "#1f2433", "#c9542f", "#d8d8e0", "#8a5a2b", "#e0b04a", "#5b3a6b", "#2e4a3a"];
const SKINS = ["#f2c7a0", "#d9a27a", "#f0c39b", "#c48a62", "#8d5a3b", "#f4d0b0"];
const PANTS = ["#3b4a6b", "#2e3550", "#4a3b2b", "#333a4d", "#2b3a2e", "#5a4a6a"];

function makeSprites(look) {
  const pal = { K: "#262033", H: look.hair, h: shade(look.hair, .72), S: look.skin, s: shade(look.skin, .85),
                C: look.shirt, c: shade(look.shirt, .75), P: look.pants, B: "#2b2b33" };
  const flip = rows => rows.map(row => [...row].reverse().join(""));
  const spr = { front: [sprite(FRONT, pal), sprite(FRONT_B, pal)], back: [sprite(BACK, pal), sprite(BACK_B, pal)],
                right: [sprite(SIDE_A, pal), sprite(SIDE_B, pal)], left: [sprite(flip(SIDE_A), pal), sprite(flip(SIDE_B), pal)] };
  if (look.hardHat) hardHat(spr);
  return spr;
}
// The builder wears a hard hat: a darker band plus a brim over the hair.
function hardHat(spr) {
  const band = "#b8860b", brim = "#ffd84a";
  const paint = (c, cells) => { const x = c.getContext("2d"); cells.forEach(([px, py, w, col]) => { x.fillStyle = col; x.fillRect(px, py, w, 1); }); };
  spr.front.forEach(c => paint(c, [[3, 3, 10, band], [1, 4, 14, brim], [1, 5, 1, "#262033"], [14, 5, 1, "#262033"]]));
  spr.back.forEach(c => paint(c, [[3, 3, 10, band], [1, 4, 14, brim]]));
  spr.right.forEach(c => paint(c, [[4, 3, 9, band], [4, 4, 12, brim]]));
  spr.left.forEach(c => paint(c, [[3, 3, 9, band], [0, 4, 12, brim]]));
}

/* ---------- the room ---------- */
const DESKS = [[16, 64], [64, 64], [112, 64], [16, 124], [64, 124], [112, 124]];
const BOARD = { x: 262, y: 4, w: 80, h: 28 };
const BENCH = { x: 196, y: 106 };
const COFFEE = { x: 290, y: 160 };

// Standing spots per station: sprite top-left, facing, and an optional walkable approach point (feet coords)
// for spots tucked behind furniture.
const STATIONS = {
  bench: [
    { x: BENCH.x + 6, y: BENCH.y - 13, face: "front", approach: [BENCH.x + 14, 100] },
    { x: BENCH.x + 47, y: BENCH.y - 13, face: "front", approach: [BENCH.x + 55, 100] },
    { x: BENCH.x + 16, y: BENCH.y + 22, face: "back" },
    { x: BENCH.x + 44, y: BENCH.y + 22, face: "back" },
  ],
  planning: [{ x: 150, y: 40, face: "back" }, { x: 168, y: 40, face: "back" }],
  data: [{ x: 198, y: 46, face: "back" }, { x: 214, y: 46, face: "back" }],
  research: [{ x: 119, y: 40, face: "back" }, { x: 135, y: 40, face: "back" }],
  coffee: [{ x: 272, y: 150, face: "front" }, { x: 254, y: 146, face: "front" }, { x: 240, y: 130, face: "front" }],
  review: [{ x: 270, y: 38, face: "back" }, { x: 290, y: 38, face: "back" }, { x: 310, y: 38, face: "back" }],
  lounge: [{ x: 140, y: 176, face: "front" }, { x: 120, y: 176, face: "front" }],
};

/* ---------- walkable grid + pathfinding ---------- */
const CELL = 4, GW = W / CELL, GH = H / CELL;
const BLOCKS = [
  [0, 0, W, 40], [112, 6, 30, 46], [150, 8, 32, 42], [196, 10, 31, 40],
  [4, 18, 16, 26], [242, 16, 16, 26], [4, 180, 16, 26], [330, 182, 16, 26],
  [BENCH.x, BENCH.y - 2, 72, 32], [298, 178, 15, 22], [COFFEE.x, COFFEE.y - 20, 54, 48], [164, 166, 68, 26], [236, 168, 10, 30],
  ...DESKS.flatMap(([x, y]) => [[x, y - 2, 36, 28], [x + 11, y + 18, 14, 12]]),
];
const walkable = new Uint8Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
  const px = i * CELL + 2, py = j * CELL + 2;
  const blocked = px < 4 || px > W - 4 || py > H - 3 ||
    BLOCKS.some(([x, y, w, h]) => px > x - 5 && px < x + w + 5 && py > y - 2 && py < y + h + 1);
  walkable[j * GW + i] = blocked ? 0 : 1;
}
const cellOf = (fx, fy) => [Math.max(0, Math.min(GW - 1, Math.floor(fx / CELL))), Math.max(0, Math.min(GH - 1, Math.floor(fy / CELL)))];
function nearestWalkable([ci, cj]) {
  for (let rad = 0; rad < 14; rad++)
    for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < GW && j < GH && walkable[j * GW + i]) return [i, j];
    }
  return [ci, cj];
}
// 4-direction BFS; returns feet waypoints at the corners of the path.
function findPath(from, to) {
  const s = nearestWalkable(cellOf(...from)), t = nearestWalkable(cellOf(...to));
  const prev = new Int32Array(GW * GH).fill(-1), start = s[1] * GW + s[0], goal = t[1] * GW + t[0];
  const queue = [start]; prev[start] = start;
  for (let q = 0; q < queue.length && prev[goal] < 0; q++) {
    const c = queue[q], i = c % GW, j = (c / GW) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, n = nj * GW + ni;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GH || !walkable[n] || prev[n] >= 0) continue;
      prev[n] = c; queue.push(n);
    }
  }
  if (prev[goal] < 0) return [to];
  const cells = [];
  for (let c = goal; c !== start; c = prev[c]) cells.push(c);
  cells.push(start); cells.reverse();
  const pts = cells.map(c => [(c % GW) * CELL + 2, ((c / GW) | 0) * CELL + 2]);
  const corners = pts.filter((p, k) => k === 0 || k === pts.length - 1 ||
    !((pts[k - 1][0] === p[0] && pts[k + 1][0] === p[0]) || (pts[k - 1][1] === p[1] && pts[k + 1][1] === p[1])));
  return corners;
}

/* ---------- live data ---------- */
let data = { agents: [], stories: [], projects: [], events: [] };
const people = new Map();   // name -> character state
let firstLoad = true;

async function poll() {
  try {
    const [agents, stories, projects, events] = await Promise.all(
      ["/api/agents", "/api/stories", "/api/projects", "/api/events?limit=200"].map(u => fetch(u).then(res => res.json())));
    data = { agents, stories, projects, events };
    document.getElementById("live").classList.remove("off");
    const h = hourNow();
    document.getElementById("clock").textContent = `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")} · ${lightName(h)}` +
      (weather ? ` · ${weather.temp}°C ${weather.label}` : "");
    sync();
  } catch {
    document.getElementById("live").classList.add("off");
  }
}

const fresh = (iso, ms) => iso && Date.now() - new Date(iso) < ms;

// Human comments on the agent's open cards that arrived after the agent last called the API.
function unreadFor(a) {
  const keys = new Set(data.stories.filter(s => s.agent === a.name && s.column !== "done").map(s => s.key));
  return data.events.filter(e => e.actor === "you" && e.kind === "comment" && keys.has(e.story_key) && (!a.last_seen || e.created_at > a.last_seen));
}

// Decide where an agent should be, based on its activity and cards.
function decide(a) {
  const mine = data.stories.filter(s => s.agent === a.name && s.column !== "done");
  const byCol = c => mine.filter(s => s.column === c).sort((x, y) => x.priority - y.priority);
  const activityFresh = a.activity && fresh(a.activity_at, 3 * 3600e3);
  const story = (activityFresh && mine.find(s => s.key === a.activity_story)) || byCol("doing")[0] || byCol("today")[0] || byCol("review")[0] || null;
  const doing = byCol("doing");

  if (story && story.blocked) return { station: "coffee", story, why: `Blocked: ${story.blocked}`, emote: "dots" };
  if (activityFresh) {
    const map = { coding: "bench", testing: "bench", data: "data", planning: "planning", research: "research" };
    const verbs = { coding: "Coding at the workbench.", testing: "Running tests at the workbench.", data: "Digging through the data cabinet.",
                    planning: "Planning at the drawing board.", research: "Reading up at the bookshelf." };
    if (map[a.activity]) return { station: map[a.activity], story, why: verbs[a.activity] };
  }
  if (doing.length) {
    const planned = data.events.some(e => e.actor === a.name && e.kind === "checklist" && e.story_key === doing[0].key && fresh(e.created_at, 10 * 60e3));
    return planned ? { station: "planning", story: doing[0], why: "Planning at the drawing board." }
                   : { station: "bench", story: doing[0], why: "Working at the workbench." };
  }
  if (byCol("review").length && !byCol("today").length)
    return { station: "review", story: byCol("review")[0], why: "Waiting by the board for your review." };
  return { station: "desk", story, why: story ? "At their desk. Up next: today's cards." : "At their desk. Nothing assigned." };
}

function sync() {
  const names = data.agents.map(a => a.name).sort();
  // Characters for new agents; drop the ones that disappeared.
  names.forEach((name, i) => {
    if (people.has(name)) return;
    const h = hash(name), a = data.agents.find(x => x.name === name);
    const look = { hair: name === "builder" ? "#f2c230" : HAIRS[h % HAIRS.length], skin: SKINS[(h >>> 3) % SKINS.length], pants: PANTS[(h >>> 6) % PANTS.length],
                   shirt: a.color || "#7c8cff", hardHat: name === "builder" };
    const p = { name, color: a.color, spr: makeSprites(look), x: 0, y: 0, face: "front", seated: false, path: [], placed: false };
    p.tag = document.createElement("div"); p.tag.className = "tag"; p.tag.textContent = name;
    p.tag.style.setProperty("--c", a.color); document.getElementById("tags").appendChild(p.tag);
    people.set(name, p);
  });
  for (const [name, p] of people) if (!names.includes(name)) { p.tag.remove(); people.delete(name); }

  // Desks go to agents in name order; the rest hang out in the lounge.
  const taken = {};
  names.forEach((name, i) => {
    const p = people.get(name), a = data.agents.find(x => x.name === name);
    p.agent = a; p.desk = i < DESKS.length ? i : null;
    const plan = decide(a);
    let station = plan.station === "desk" && p.desk === null ? "lounge" : plan.station;
    let spot;
    if (station === "desk") {
      const [dx, dy] = DESKS[p.desk];
      spot = { x: dx + 10, y: dy + 9, face: "back", seat: true, approach: [dx + 18, dy + 34] };
    } else {
      const list = STATIONS[station], k = (taken[station] = (taken[station] || 0) + 1) - 1;
      const base = list[k % list.length];
      spot = { ...base, x: base.x + Math.floor(k / list.length) * 6 };
    }
    const key = `${station}:${spot.x},${spot.y}`;
    const changed = p.plan?.station !== plan.station;
    p.plan = { ...plan, station };
    p.unread = unreadFor(a);
    p.emote = p.unread.length ? "bang" : plan.emote || ((station === "desk" || station === "lounge") && !fresh(a.last_seen, 30 * 60e3) ? "zzz" : null);
    if (p.spotKey !== key) {
      p.spotKey = key; p.spot = spot;
      if (firstLoad || !p.placed) place(p); else walkTo(p);
    }
    if (changed && selected === p && !firstLoad) showDialog(p);
  });
  firstLoad = false;
  if (selected === "board") showDialog("board");
}

function place(p) {
  p.x = p.spot.x; p.y = p.spot.y; p.face = p.spot.face; p.seated = !!p.spot.seat; p.path = []; p.placed = true;
}
function walkTo(p) {
  let feet = [p.x + 8, p.y + 19];
  const lead = [];
  // Get up from the chair (or out from behind the bench) before pathing.
  if (p.seated && p.desk !== null) { feet = [feet[0], DESKS[p.desk][1] + 34]; lead.push(feet); }
  else if (feet[1] > BENCH.y - 4 && feet[1] < BENCH.y + 28 && feet[0] > BENCH.x - 5 && feet[0] < BENCH.x + 77) { feet = [feet[0], 100]; lead.push(feet); }
  const finalFeet = [p.spot.x + 8, p.spot.y + 19];
  const approach = p.spot.approach || finalFeet;
  const path = [...lead, ...findPath(feet, approach)];
  if (p.spot.approach) { path.push([approach[0], finalFeet[1]]); }
  path.push(finalFeet);
  p.seated = false; p.path = path; p.walking = true;
}
function step(p, dt) {
  if (!p.path.length) return;
  const [tx, ty] = p.path[0];
  const fx = p.x + 8, fy = p.y + 19, sp = dt * 0.045;
  const dx = tx - fx, dy = ty - fy;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
    p.path.shift();
    if (!p.path.length) { p.walking = false; p.face = p.spot.face; p.seated = !!p.spot.seat; p.x = p.spot.x; p.y = p.spot.y; if (selected === p) showDialog(p); }
    return;
  }
  if (Math.abs(dx) >= 0.01) { p.x += Math.sign(dx) * Math.min(sp, Math.abs(dx)); p.face = dx > 0 ? "right" : "left"; }
  else { p.y += Math.sign(dy) * Math.min(sp, Math.abs(dy)); p.face = dy > 0 ? "front" : "back"; }
}

/* ---------- static background, drawn once ---------- */
const bg = document.createElement("canvas"); bg.width = W; bg.height = H;
(function paintBackground() {
  const real = g; g = bg.getContext("2d");
  for (let y = 36, row = 0; y < H; y += 8, row++) {
    r(0, y, W, 8, row % 2 ? "#c48a52" : "#c99058");
    r(0, y + 7, W, 1, "#a36c3a");
    for (let x = (row * 23) % 48; x < W; x += 48) r(x, y, 1, 7, "#a8723f");
    for (let k = 0; k < 18; k++) r(Math.floor(rnd() * W), y + 1 + Math.floor(rnd() * 5), 2, 1, "#b97f49");
  }
  r(0, 0, W, 36, "#efe6d0");
  for (let x = 4; x < W; x += 8) r(x, 3, 1, 29, "#e4d9c0");
  r(0, 0, W, 3, "#5d4a3a");
  r(0, 31, W, 5, "#7a5a3e"); r(0, 31, W, 1, "#9a7656");
  r(0, 36, W, 2, "rgba(0,0,0,.14)");
  for (const x of [22, 72]) {
    r(x, 5, 34, 24, "#5d4a3a"); r(x + 2, 7, 30, 20, "#9fd6f2"); r(x + 2, 18, 30, 9, "#bfe6f8");
    r(x + 6, 11, 9, 2, "#fff"); r(x + 8, 10, 4, 1, "#fff"); r(x + 20, 21, 7, 2, "#fff");
    r(x + 16, 7, 2, 20, "#5d4a3a"); r(x + 2, 16, 30, 2, "#5d4a3a");
    r(x - 2, 28, 38, 3, "#d9c7a3"); r(x - 2, 30, 38, 1, "#a89272");
  }
  r(235, 6, 8, 10, "#5d4a3a"); r(234, 7, 10, 8, "#5d4a3a"); r(235, 7, 8, 8, "#fffaf0");
  r(238, 8, 1, 4, "#333"); r(239, 11, 2, 1, "#333");
  r(184, 94, 104, 48, "#4a5d7a"); r(186, 96, 100, 44, "#5a6f8f");
  for (let x = 190; x < 282; x += 6) r(x, 98, 3, 1, "#7f93b3"), r(x, 137, 3, 1, "#7f93b3");
  r(150, 166, 96, 34, "#7a4a5a"); r(152, 168, 92, 30, "#935a6c");
  for (let x = 156; x < 240; x += 8) r(x, 182, 4, 2, "#b5788a");
  const b = BOARD;
  r(b.x, b.y, b.w, b.h, "#6b4a2a"); r(b.x + 2, b.y + 2, b.w - 4, b.h - 4, "#d9a96a");
  for (let k = 0; k < 40; k++) r(b.x + 3 + Math.floor(rnd() * (b.w - 6)), b.y + 10 + Math.floor(rnd() * 16), 1, 1, "#c48f52");
  r(b.x + 2, b.y + 2, b.w - 4, 8, "#3a3550"); text("BOARDERS", b.x + 25, b.y + 3, "#f5e6c8");
  for (let col = 1; col < 4; col++) r(b.x + 4 + col * 19 - 2, b.y + 11, 1, 15, "#b88a50");
  r(b.x + 2, b.y + b.h, b.w - 4, 1, "rgba(0,0,0,.2)");
  g = real;
})();

// Sticky notes on the wall board reflect the real columns (Backlog, Today, In progress, Review).
function boardNotes() {
  const cols = ["backlog", "today", "doing", "review"];
  cols.forEach((c, col) => {
    const list = data.stories.filter(s => s.column === c).slice(0, 4);
    list.forEach((s, n) => {
      const p = data.projects.find(p => p.id === s.project);
      const x = BOARD.x + 4 + col * 19 + (n % 2) * 8, y = BOARD.y + 12 + Math.floor(n / 2) * 7 + (n % 2) * 2;
      r(x, y, 7, 6, p?.color || "#fff3a3"); r(x + 3, y, 1, 1, s.blocked ? "#222" : "#d33");
    });
  });
}

/* ---------- furniture (drawn per frame so it depth-sorts with characters) ---------- */
function plant(x, y) {
  r(x + 3, y + 13, 10, 9, "#c0643c"); r(x + 2, y + 12, 12, 2, "#d97a4f"); r(x + 4, y + 20, 8, 2, "#9a4c2c");
  const L = ["#3f8f4f", "#56a95e", "#2f6e3c"];
  [[6, 0, 4, 6], [2, 4, 5, 5], [9, 3, 5, 6], [4, 7, 8, 5], [0, 8, 5, 4], [11, 8, 5, 4]].forEach(([dx, dy, w, h], i) => r(x + dx, y + dy, w, h, L[i % 3]));
  r(x + 7, y + 1, 1, 3, "#7cc47f"); r(x + 3, y + 5, 2, 1, "#7cc47f");
}
function bookshelf(x) {
  r(x, 6, 30, 42, "#6e4524"); r(x + 2, 8, 26, 38, "#8d5c31");
  const cols = ["#d94b4b", "#4a8bd9", "#f5b14c", "#3ecf8e", "#c17cff", "#e8e2d6", "#e879b9"];
  for (let shelf = 0; shelf < 3; shelf++) {
    const sy = 8 + shelf * 13;
    r(x + 2, sy + 11, 26, 2, "#6e4524");
    let bx = x + 3;
    for (let k = 0; bx < x + 26; k++) {
      const w = 2 + ((k + shelf) % 3 === 0 ? 1 : 0), h = 8 + ((k * 3 + shelf) % 3);
      if ((k + shelf * 2) % 7 === 5) { bx += 3; continue; }
      r(bx, sy + 11 - h, w, h, cols[(k * 2 + shelf) % cols.length]);
      r(bx, sy + 11 - h + 2, w, 1, "rgba(255,255,255,.35)");
      bx += w;
    }
  }
  r(x, 48, 30, 2, "rgba(0,0,0,.18)");
}
function sofa(x, y) {
  r(x + 2, y + 22, 64, 2, "rgba(0,0,0,.18)");
  r(x + 4, y, 60, 10, "#3f6f73"); r(x + 4, y, 60, 1, "#5f9599");
  r(x, y + 4, 8, 16, "#335b5e"); r(x + 60, y + 4, 8, 16, "#335b5e"); r(x, y + 4, 8, 1, "#4f8387"); r(x + 60, y + 4, 8, 1, "#4f8387");
  r(x + 8, y + 10, 52, 8, "#4b8287"); r(x + 8, y + 10, 52, 1, "#6aa3a8"); r(x + 33, y + 10, 1, 8, "#3f6f73");
  r(x + 8, y + 18, 52, 3, "#2a4a4d");
  r(x + 12, y + 6, 8, 6, "#f5b14c"); r(x + 48, y + 6, 8, 6, "#e879b9");
}
function lamp(x, y) {
  r(x + 1, y + 26, 8, 2, "rgba(0,0,0,.18)"); r(x + 2, y + 25, 6, 2, "#3a3f4b"); r(x + 4, y + 8, 2, 17, "#3a3f4b");
  r(x, y, 10, 8, "#fff1c9"); r(x + 1, y + 1, 8, 6, "#ffe49a"); r(x, y + 7, 10, 1, "#e0c070");
}
function whiteboard(x, busy) {
  r(x + 3, 30, 2, 18, "#6b4a2a"); r(x + 27, 30, 2, 18, "#6b4a2a");
  r(x, 8, 32, 25, "#8a8f99"); r(x + 2, 10, 28, 20, "#fbfbf7");
  r(x + 5, 13, 7, 4, "#7c8cff"); r(x + 19, 13, 7, 4, "#3ecf8e"); r(x + 12, 23, 8, 4, "#f5b14c");
  r(x + 12, 15, 7, 1, "#555"); r(x + 16, 17, 1, 6, "#555"); r(x + 5, 20, 5, 1, "#e06666"); r(x + 22, 20, 4, 1, "#e06666");
  r(x + 1, 32, 30, 2, "#6b6f78"); r(x + 6, 31, 3, 1, "#e33"); r(x + 11, 31, 3, 1, "#33e");
  if (busy) {
    const len = Math.floor(now / 140) % 26;
    for (let i = 0; i < Math.min(len, 22); i++) r(x + 5 + i, 27 + (i % 6 < 3 ? 0 : 1), 1, 1, "#4a5bd9");
  }
}
function cabinets(x, open) {
  for (const k of [0, 1]) {
    const cx = x + k * 16;
    r(cx, 12, 15, 34, "#6c7787"); r(cx + 1, 13, 13, 32, "#9aa6b5");
    for (let i = 0; i < 3; i++) {
      r(cx + 2, 15 + i * 10, 11, 8, "#b3bdca"); r(cx + 5, 18 + i * 10, 5, 2, "#5d6878"); r(cx + 4, 16 + i * 10, 3, 1, "#fff8dc");
    }
  }
  if (open) {
    r(x + 17, 26, 13, 7, "#c5ced9"); r(x + 17, 32, 13, 1, "#6c7787");
    const f = Math.floor(now / 220);
    ["#f5b14c", "#7c8cff", "#e879b9", "#3ecf8e"].forEach((c, i) => { const up = (f % 4) === i ? 2 : 0; r(x + 18 + i * 3, 24 - up, 2, 4 + up, c); });
  }
  r(x, 46, 31, 2, "rgba(0,0,0,.18)");
}
function desk(x, y, screen) {
  r(x + 2, y + 24, 34, 2, "rgba(0,0,0,.15)");
  r(x + 1, y + 18, 3, 6, "#6e4524"); r(x + 32, y + 18, 3, 6, "#6e4524");
  r(x, y, 36, 12, "#b8834e"); r(x, y, 36, 1, "#d39c64"); r(x, y + 12, 36, 6, "#8d5c31"); r(x, y + 12, 36, 1, "#6e4524");
  r(x + 16, y + 2, 4, 3, "#3a3f4b"); r(x + 10, y - 9, 16, 12, "#2b2f3a");
  if (screen === "code") {
    r(x + 11, y - 8, 14, 9, "#16263a");
    const off = Math.floor(now / 350);
    for (let i = 0; i < 4; i++) {
      const w = 3 + ((i + off) * 7) % 9;
      r(x + 12 + (i % 2) * 2, y - 7 + i * 2, w, 1, ["#7c8cff", "#3ecf8e", "#e879b9", "#f5b14c"][(i + off) % 4]);
    }
  } else if (screen === "dim") {
    r(x + 11, y - 8, 14, 9, "#0d1420");
  } else {
    r(x + 11, y - 8, 14, 9, "#1d2a4a");
    const t = now / 900 + x, px = Math.round(x + 13 + (Math.sin(t) + 1) * 5), py = Math.round(y - 6 + (Math.cos(t * 1.3) + 1) * 2.5);
    r(px, py, 2, 2, "#7c8cff");
  }
  r(x + 11, y + 6, 14, 3, "#d8dce3"); r(x + 11, y + 8, 14, 1, "#aeb4bf");
  if (screen === "code") { const k = Math.floor(now / 110); r(x + 12 + (k * 5) % 12, y + 6 + (k % 2), 2, 1, "#ffffff"); }
  r(x + 29, y + 4, 4, 4, "#f4f1ea"); r(x + 33, y + 5, 1, 2, "#f4f1ea"); r(x + 30, y + 4, 2, 1, "#6b3b1e");
  r(x + 3, y + 3, 6, 5, "#fff3a3"); r(x + 4, y + 4, 4, 1, "#c9b25b");
}
function chairSeat(x, y) { r(x + 12, y + 20, 12, 5, "#414a63"); r(x + 16, y + 25, 4, 3, "#2b3142"); r(x + 13, y + 28, 10, 1, "#2b3142"); }
function chairBack(x, y) { r(x + 11, y + 20, 14, 7, "#4d5675"); r(x + 11, y + 20, 14, 1, "#6a759a"); r(x + 11, y + 26, 14, 1, "#3a4258"); }
function bench(x, y, busy) {
  r(x + 2, y + 28, 72, 2, "rgba(0,0,0,.18)");
  r(x + 2, y + 20, 4, 8, "#5c3d22"); r(x + 66, y + 20, 4, 8, "#5c3d22");
  r(x, y, 72, 14, "#a7774a"); r(x, y, 72, 1, "#c99662"); r(x, y + 14, 72, 7, "#7d5532"); r(x, y + 14, 72, 1, "#5c3d22");
  r(x + 4, y + 3, 13, 8, "#d94b4b"); r(x + 4, y + 3, 13, 2, "#e86a6a"); r(x + 8, y + 1, 5, 2, "#555");
  r(x + 28, y + 6, 16, 5, "#c9ced6"); r(x + 30, y - 4, 12, 10, "#2b2f3a"); r(x + 31, y - 3, 10, 8, busy ? "#1e3a5f" : "#141c28");
  if (busy) {
    const off = Math.floor(now / 300);
    for (let i = 0; i < 3; i++) r(x + 32, y - 2 + i * 2, 2 + ((i + off) * 3) % 7, 1, ["#3ecf8e", "#7c8cff", "#f5b14c"][(i + off) % 3]);
  }
  r(x + 50, y + 4, 16, 4, "#4a8bd9"); r(x + 50, y + 4, 2, 4, "#2f6bb5");
  r(x + 20, y + 6, 4, 4, "#9aa3ad"); r(x + 21, y + 7, 2, 2, "#5d6670");
  r(x + 46, y + 9, 3, 3, "#f5b14c");
}
function coffee(x, y) {
  r(x + 2, y + 26, 52, 2, "rgba(0,0,0,.18)");
  r(x, y, 54, 12, "#e8e2d6"); r(x, y, 54, 1, "#fff"); r(x, y + 12, 54, 14, "#9c8f7a");
  r(x + 26, y + 13, 1, 12, "#7d725f"); r(x + 22, y + 18, 2, 2, "#5d5444"); r(x + 29, y + 18, 2, 2, "#5d5444");
  r(x + 5, y - 15, 15, 17, "#3a3f4b"); r(x + 6, y - 14, 13, 4, "#4b5160"); r(x + 15, y - 12, 2, 2, "#ff5555");
  r(x + 10, y - 6, 4, 2, "#222"); r(x + 9, y - 2, 6, 4, "#fff");
  const t = Math.floor(now / 250) % 3;
  r(x + 11 + (t === 1 ? 1 : 0), y - 9 - t, 1, 2, "rgba(255,255,255,.7)"); r(x + 13 - (t === 2 ? 1 : 0), y - 12 - t, 1, 2, "rgba(255,255,255,.5)");
  r(x + 33, y - 19, 11, 11, "#8fd3ff"); r(x + 35, y - 17, 2, 6, "#c9ecff"); r(x + 32, y - 8, 13, 9, "#e6e9ef"); r(x + 37, y - 3, 3, 2, "#4a8bd9");
  r(x + 47, y + 3, 4, 5, "#e879b9"); r(x + 48, y + 1, 2, 2, "#e879b9");
}

/* ---------- weather: Open-Meteo, fetched by the browser (?weather=rain previews one) ---------- */
const params = new URLSearchParams(location.search);
const forcedHour = params.get("time"), forcedWeather = params.get("weather");
let weather = null;   // { kind, intensity, label, cloud, temp, sunrise, sunset, place }

// WMO weather codes -> [kind, intensity, label]
function wmo(code) {
  if (code <= 1) return ["clear", 0, code ? "mostly clear" : "clear sky"];
  if (code === 2) return ["cloudy", .4, "partly cloudy"];
  if (code === 3) return ["cloudy", .8, "overcast"];
  if (code === 45 || code === 48) return ["fog", .8, "fog"];
  if (code >= 51 && code <= 57) return ["rain", .35, "drizzle"];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    if ([65, 67, 82].includes(code)) return ["rain", 1, "heavy rain"];
    if ([61, 80].includes(code)) return ["rain", .5, "light rain"];
    return ["rain", .75, "rain"];
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ["snow", .7, "snow"];
  if (code >= 95) return ["storm", 1, "thunderstorm"];
  return ["cloudy", .5, "cloudy"];
}
const PREVIEW_CODES = { clear: 0, cloudy: 3, fog: 45, drizzle: 51, rain: 63, storm: 95, snow: 73 };
const hourOf = iso => { const t = iso.split("T")[1]; return +t.slice(0, 2) + +t.slice(3, 5) / 60; };

async function loadWeather(office) {
  if (forcedWeather) {
    const [kind, intensity, label] = wmo(PREVIEW_CODES[forcedWeather] ?? 0);
    weather = { kind, intensity, label: `${label} (preview)`, cloud: kind === "clear" ? 5 : 90, temp: 18, place: office?.place || "" };
    return;
  }
  if (!office) return;
  const KEY = "boarders.weather";
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && Date.now() - c.at < 15 * 60e3 && c.lat === office.lat && c.lon === office.lon) { weather = c.w; return; }
  } catch {}
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${office.lat}&longitude=${office.lon}` +
      "&current=temperature_2m,weather_code,cloud_cover&daily=sunrise,sunset&timezone=auto&forecast_days=1";
    const d = await fetch(url).then(res => res.json());
    const [kind, intensity, label] = wmo(d.current.weather_code);
    weather = { kind, intensity, label, cloud: d.current.cloud_cover, temp: Math.round(d.current.temperature_2m),
                sunrise: hourOf(d.daily.sunrise[0]), sunset: hourOf(d.daily.sunset[0]), place: office.place };
    try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), lat: office.lat, lon: office.lon, w: weather })); } catch {}
  } catch { /* offline or blocked: keep the last known weather */ }
}
const wet = () => weather && (weather.kind === "rain" || weather.kind === "storm");

// Lightning: a double flash every 5-14 seconds during storms.
let nextFlash = 0, flashAt = -1e9, flash = false;
function updateFlash() {
  if (weather?.kind !== "storm") { flash = false; return; }
  if (now > nextFlash) { flashAt = now; nextFlash = now + 5000 + Math.random() * 9000; }
  const d = now - flashAt;
  flash = d < 110 || (d > 200 && d < 270);
}

/* ---------- lighting: follows the real sunrise/sunset and the clock (?time=21.5 previews an hour) ---------- */
function hourNow() {
  if (forcedHour !== null) return parseFloat(forcedHour) % 24;
  const d = new Date(); return d.getHours() + d.getMinutes() / 60;
}
const DAY = ["#9fd6f2", "#bfe6f8"], NIGHT = ["#14183a", "#1e2450"];
const sun = () => [weather?.sunrise ?? 6.5, weather?.sunset ?? 18.5];
// [hour, darkness, warm tint, sky top, sky bottom]
function lightKeys() {
  const [sr, ss] = sun();
  return [
    [0, .62, 0, ...NIGHT], [sr - 1, .62, 0, ...NIGHT], [sr, .3, .08, "#e9a0a8", "#f7c9a8"], [sr + 1.5, 0, 0, ...DAY],
    [ss - 1.5, 0, 0, ...DAY], [ss, .12, .3, "#f59e5b", "#f7c27e"], [ss + 1, .45, .1, "#3a2f5a", "#5a4a7a"], [ss + 2, .62, 0, ...NIGHT], [24, .62, 0, ...NIGHT],
  ];
}
const mix = (a, b, t) => "#" + [0, 2, 4].map(i => Math.round(parseInt(a.substr(1 + i, 2), 16) * (1 - t) + parseInt(b.substr(1 + i, 2), 16) * t).toString(16).padStart(2, "0")).join("");
function lightAt(h) {
  const keys = lightKeys();
  const k = keys.findIndex(([kh]) => kh > h), a = keys[k - 1], b = keys[k];
  const t = (h - a[0]) / (b[0] - a[0]);
  const L = { dark: a[1] + (b[1] - a[1]) * t, warm: a[2] + (b[2] - a[2]) * t, skyTop: mix(a[3], b[3], t), skyLow: mix(a[4], b[4], t) };
  // Clouds and rain grey out the sky, kill the sunset glow and dim the room.
  if (weather && weather.kind !== "clear") {
    const grey = weather.kind === "cloudy" ? .55 * weather.intensity : .8;
    L.skyTop = mix(L.skyTop, "#7d8796", grey * (1 - L.dark));
    L.skyLow = mix(L.skyLow, "#9aa3b0", grey * (1 - L.dark));
    L.warm *= 1 - grey;
    L.dark = Math.min(.7, L.dark + grey * (wet() ? .24 : .14));
  }
  return L;
}
function lightName(h) {
  const [sr, ss] = sun();
  return h < sr - 1 || h >= ss + 2 ? "night" : h < sr + 1.5 ? "dawn" : h < ss - 1.5 ? "day" : h < ss + 1 ? "sunset" : "dusk";
}

function paintWindows(L) {
  const kind = weather?.kind || "clear", inten = weather?.intensity || 0;
  for (const x of [22, 72]) {
    g.save(); g.beginPath(); g.rect(x + 2, 7, 30, 20); g.clip();
    r(x + 2, 7, 30, 20, flash ? "#eef2ff" : L.skyTop); r(x + 2, 18, 30, 9, flash ? "#dfe6ff" : L.skyLow);
    if (L.dark < .3) {
      g.globalAlpha = 1 - L.dark * 3;
      const cloudy = kind !== "clear";
      const c = cloudy ? "#c9ced6" : "#fff", drift = Math.floor(now / 700) % 40;
      r(x + 6, 11, 9, 2, c); r(x + 8, 10, 4, 1, c); r(x + 20, 21, 7, 2, c);
      if (cloudy) { r(x - 8 + drift, 9, 14, 4, "#b4bbc6"); r(x - 5 + drift, 8, 7, 1, "#b4bbc6"); r(x + 12 - drift / 2, 12, 12, 3, "#c3c9d2"); }
      g.globalAlpha = 1;
    }
    if (L.dark > .4 && kind === "clear") {
      [[5, 9], [12, 13], [24, 10], [9, 21], [27, 23], [20, 8]].forEach(([dx, dy], i) => (Math.floor(now / 900) + i) % 5 && r(x + dx, dy, 1, 1, "#fff8d0"));
      r(x + 25, 9, 3, 3, "#fff3c0"); r(x + 26, 9, 2, 2, L.skyTop);   // crescent moon
    }
    if (kind === "rain" || kind === "storm") {
      const n = Math.round(5 + inten * 10), drop = flash ? "#ffffff" : "rgba(214,228,255,.6)";
      for (let i = 0; i < n; i++) {
        const fall = now * (.1 + inten * .06) + i * 37, y = 7 + (fall % 22) - 2;
        const px = x + 2 + ((i * 11 + Math.floor(fall / 22) * 7) % 30);
        r(px, y, 1, 4, drop);
      }
      for (let i = 0; i < 4; i++) r(x + 5 + i * 7, 7 + ((now * .006 + i * 53) % 20), 1, 2, "rgba(225,238,255,.9)");   // drops on the glass
      if (flash && x === 72) {   // a lightning bolt in the right-hand window
        const bolt = [[14, 7], [12, 11], [15, 14], [13, 18], [16, 22]];
        bolt.forEach(([bx, by], i) => i && r(x + Math.min(bx, bolt[i - 1][0]), bolt[i - 1][1], Math.abs(bx - bolt[i - 1][0]) + 1, by - bolt[i - 1][1], "#fff8c0"));
      }
    }
    if (kind === "snow") {
      for (let i = 0; i < 14; i++) {
        const y = 7 + ((now * .018 + i * 29) % 21), px = x + 2 + ((i * 13 + Math.round(Math.sin(now / 600 + i) * 2) + 30) % 30);
        r(px, y, 1, 1, "#ffffff");
      }
    }
    if (kind === "fog") { g.globalAlpha = .55 * inten; r(x + 2, 7, 30, 20, "#d5dae0"); g.globalAlpha = 1; }
    g.restore();
    r(x + 16, 7, 2, 20, "#5d4a3a"); r(x + 2, 16, 30, 2, "#5d4a3a");
    if (kind === "snow") { r(x + 2, 25, 30, 2, "#f4f6fa"); r(x + 18, 14, 14, 2, "#f4f6fa"); }   // snow on the sills
  }
}

// An umbrella stand by the coffee corner that fills up on rainy days.
function umbrellaStand(x, y) {
  const n = wet() ? (weather.intensity > .6 ? 3 : 2) : 1;
  const cols = ["#d94b4b", "#4a8bd9", "#f5b14c"];
  for (let k = 0; k < n; k++) {
    r(x + 2 + k * 3, y - 6 + (k % 2), 1, 12, cols[k]); r(x + 1 + k * 3, y - 7 + (k % 2), 2, 1, "#3a3f4b");
    r(x + 1 + k * 3, y - 2 + (k % 2), 3, 5, shade(cols[k], .8));
  }
  r(x, y + 4, 11, 12, "#5d6878"); r(x, y + 4, 11, 1, "#8994a6"); r(x + 1, y + 8, 9, 1, "#4b5566");
  if (wet()) { r(x - 4, y + 16, 19, 2, "rgba(140,185,235,.55)"); r(x + 13, y + 15, 5, 1, "rgba(140,185,235,.45)"); }
  r(x + 1, y + 16, 10, 1, "rgba(0,0,0,.18)");
}

const lightCv = document.createElement("canvas"); lightCv.width = W; lightCv.height = H;
const lg = lightCv.getContext("2d");
function glow(x, y, radius, strength) {
  const grd = lg.createRadialGradient(x, y, 0, x, y, radius);
  grd.addColorStop(0, `rgba(0,0,0,${strength})`); grd.addColorStop(1, "rgba(0,0,0,0)");
  lg.fillStyle = grd; lg.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
function applyLighting(L, list) {
  if (L.warm > .01) { g.fillStyle = `rgba(255,130,50,${L.warm * .45})`; g.fillRect(0, 0, W, H); }
  if (L.dark >= .01) {
    lg.globalCompositeOperation = "source-over"; lg.clearRect(0, 0, W, H);
    lg.fillStyle = `rgba(10,14,38,${L.dark})`; lg.fillRect(0, 0, W, H);
    lg.globalCompositeOperation = "destination-out";
    glow(241, 176, 46, .95);                                  // floor lamp
    glow(BOARD.x + BOARD.w / 2, BOARD.y + 14, 38, .8);        // picture light on the wall board
    glow(COFFEE.x + 15, COFFEE.y - 8, 14, .6);                 // coffee machine
    DESKS.forEach(([x, y], i) => {
      const owner = list.find(p => p.desk === i && p.seated);
      glow(x + 18, y - 2, owner && fresh(owner.agent?.last_seen, 15 * 60e3) ? 30 : 12, owner ? .8 : .35);
    });
    if (list.some(p => !p.walking && p.plan?.station === "bench")) glow(BENCH.x + 36, BENCH.y, 34, .8);
    list.forEach(p => glow(p.x + 8, p.y + 10, 14, .35));     // keep everyone readable
    g.drawImage(lightCv, 0, 0);
    // warm lamp pools on top of the darkness
    g.globalCompositeOperation = "lighter";
    const pool = (x, y, rad, c) => { const grd = g.createRadialGradient(x, y, 0, x, y, rad); grd.addColorStop(0, c); grd.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
    pool(241, 176, 40, `rgba(255,190,90,${.18 * L.dark})`);
    DESKS.forEach(([x, y], i) => list.some(p => p.desk === i && p.seated) && pool(x + 18, y - 3, 18, `rgba(90,130,255,${.22 * L.dark})`));
    g.globalCompositeOperation = "source-over";
  }
  if (flash) { g.fillStyle = "rgba(235,240,255,.3)"; g.fillRect(0, 0, W, H); }
}

/* ---------- emotes ---------- */
function bubble(x, y, w, h) {
  r(x, y, w, h, "#262033"); r(x + 1, y - 1, w - 2, h + 2, "#262033");
  r(x + 1, y + 1, w - 2, h - 2, "#fff"); r(x + 2, y, w - 4, h, "#fff");
  r(x + 3, y + h, 3, 2, "#262033"); r(x + 4, y + h, 1, 1, "#fff");
}
function emote(p) {
  const x = Math.round(p.x) + 10, y = Math.round(p.y) - 12 + (Math.floor(now / 500) % 2);
  if (p.emote === "zzz") { bubble(x, y, 15, 9); text("Z", x + 2, y + 3, "#4a5bd9"); text("Z", x + 7, y + 2, "#4a5bd9"); }
  if (p.emote === "bang") { bubble(x, y, 9, 9); r(x + 4, y + 2, 2, 4, "#e33"); r(x + 4, y + 7, 2, 1, "#e33"); }
  if (p.emote === "dots") { bubble(x, y, 15, 8); for (let i = 0; i < 3; i++) r(x + 3 + i * 4, y + 4, 2, 2, "#262033"); }
}

/* ---------- frame ---------- */
function drawPerson(p) {
  const x = Math.round(p.x), y = Math.round(p.y);
  const frames = p.spr[p.face] || p.spr.front;
  const img = p.walking ? frames[Math.floor(now / 160) % 2] : frames[0];
  if (p.seated) {
    g.drawImage(img, 0, 0, 16, 15, x, y + (Math.floor(now / 700 + p.name.length) % 2), 16, 15);
    return;
  }
  r(x + 3, y + 19, 10, 2, "rgba(0,0,0,.18)");
  g.drawImage(img, x, y - (!p.walking && Math.floor(now / 650 + p.name.length) % 4 === 0 ? 1 : 0));
  if (!p.walking && p.plan?.station === "coffee" && p.face === "front") {
    const sip = ((now / 1000 + p.name.length) % 4) < 1;
    const mx = sip ? x + 9 : x + 12, my = sip ? y + 8 : y + 13;
    r(mx, my, 3, 3, "#fffaf0"); r(mx + 3, my + 1, 1, 1, "#fffaf0"); r(mx, my, 3, 1, "#6b3b1e");
  }
}

function frame(t) {
  const dt = Math.min(50, t - last); last = t; now = t;
  const list = [...people.values()];
  list.forEach(p => step(p, dt));
  g.drawImage(bg, 0, 0);
  updateFlash();
  const L = lightAt(hourNow());
  paintWindows(L);
  boardNotes();

  const at = st => list.some(p => !p.walking && p.plan?.station === st);
  const items = [];
  const add = (base, fn) => items.push({ base, fn });
  add(48, () => whiteboard(150, at("planning")));
  add(46, () => cabinets(196, at("data")));
  add(50, () => bookshelf(112));
  add(40, () => plant(4, 20));
  add(40, () => plant(242, 18));
  add(204, () => plant(4, 182));
  add(204, () => plant(330, 184));
  add(190, () => sofa(164, 168));
  add(196, () => lamp(236, 170));
  add(202, () => umbrellaStand(300, 186));
  DESKS.forEach(([x, y], i) => {
    const owner = list.find(p => p.desk === i && p.seated);
    const screen = owner ? (fresh(owner.agent?.last_seen, 15 * 60e3) ? "code" : "dim") : "saver";
    add(y + 24, () => desk(x, y, screen));
    add(y + 29, () => chairSeat(x, y));
    add(y + 30, () => chairBack(x, y));
  });
  add(BENCH.y + 30, () => bench(BENCH.x, BENCH.y, at("bench")));
  add(COFFEE.y + 28, () => coffee(COFFEE.x, COFFEE.y));
  list.forEach(p => add(p.seated ? DESKS[p.desk][1] + 26 : p.y + 20, () => drawPerson(p)));
  items.sort((p, q) => p.base - q.base).forEach(i => i.fn());
  applyLighting(L, list);

  list.forEach(p => p.emote && (!p.walking || p.emote === "bang") && emote(p));
  if (hover === "board" || selected === "board") { g.strokeStyle = "#fff3a3"; g.lineWidth = 1; g.strokeRect(BOARD.x - 1.5, BOARD.y - 1.5, BOARD.w + 3, BOARD.h + 3); }
  if (selected && selected !== "board" && people.has(selected.name)) {
    const x = Math.round(selected.x) + 6, y = Math.round(selected.y) - 7 - (Math.floor(now / 300) % 2);
    r(x - 1, y - 1, 7, 1, "#262033"); r(x, y, 5, 1, "#fff"); r(x + 1, y + 1, 3, 1, "#fff"); r(x + 2, y + 2, 1, 1, "#fff");
  }
  placeTags(list);
  requestAnimationFrame(frame);
}

/* ---------- name tags, dialog, input ---------- */
function placeTags(list) {
  list.forEach(p => {
    p.tag.style.left = (p.x + 8) * scale + "px";
    p.tag.style.top = (p.y - (p.emote && (!p.walking || p.emote === "bang") ? 14 : 3)) * scale + "px";
    p.tag.style.fontSize = Math.max(6, 3 * scale) + "px";
    p.tag.style.opacity = p === selected || p === hover ? 1 : .8;
  });
}

let typing;
function typeInto(el, html) {
  clearInterval(typing);
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const nodes = [];
  (function walkNodes(n) { n.childNodes.forEach(c => c.nodeType === 3 ? nodes.push(c) : walkNodes(c)); })(tmp);
  const full = nodes.map(n => n.textContent); nodes.forEach(n => n.textContent = "");
  el.innerHTML = ""; el.appendChild(tmp);
  let i = 0, j = 0;
  typing = setInterval(() => {
    for (let k = 0; k < 3 && i < nodes.length; k++) {
      nodes[i].textContent = full[i].slice(0, ++j);
      if (j >= full[i].length) { i++; j = 0; }
    }
    if (i >= nodes.length) clearInterval(typing);
  }, 16);
}

const dialog = document.getElementById("dialog");
const STATION_NAMES = { bench: "the workbench", planning: "the drawing board", data: "the data cabinet", research: "the bookshelf",
                        coffee: "the coffee machine", review: "the board", desk: "their desk", lounge: "the lounge" };

async function showDialog(p) {
  dialog.style.fontSize = Math.max(8, Math.min(12, 5 * scale)) + "px";
  if (p === "board") {
    const open = data.stories.filter(s => s.column !== "done");
    const inbox = data.stories.filter(s => !s.triaged).length;
    typeInto(dialog, `<div class="who">BOARDERS</div>A cork board covered in sticky notes.<br>` +
      `${open.length} open stories across ${data.projects.length} projects` + (inbox ? `, ${inbox} new from agents` : "") + `.<br>` +
      (weather ? `Outside${weather.place ? ` in ${esc(weather.place)}` : ""}: ${esc(weather.label)}, ${weather.temp}°C.<br>` : "") +
      `<a class="btn" href="/">Open the board ▶</a>`);
    return;
  }
  if (!p) {
    typeInto(dialog, people.size
      ? `<div class="who">OFFICE</div>Welcome to the office!<br>Click someone to see what they're working on.<span class="more">▼</span>`
      : `<div class="who">OFFICE</div>The office is empty.<br>Agents show up here once they call the Boarders API.`);
    return;
  }
  const plan = p.plan || {}, s = plan.story;
  const head = `<div class="who" style="background:${p.color};color:#1a1626">${esc(p.name.toUpperCase())}</div>`;
  const status = p.walking ? `On the way to ${STATION_NAMES[plan.station] || "somewhere"}...` : plan.why;
  let body = `${esc(status)}<br>`;
  if (s) {
    const done = s.checklist.filter(i => i.done).length, total = s.checklist.length;
    body += `<a class="card" href="/#story=${s.key}">${esc(s.key)} · ${esc(s.title)}</a><br>`;
    if (total) body += `PLAN<span class="bar"><i style="width:${Math.round(100 * done / total)}%"></i></span>${done}/${total}<br>`;
  }
  const others = data.stories.filter(x => x.agent === p.name && x.column !== "done" && x.key !== s?.key).length;
  if (others) body += `<span class="dim">+${others} more card${others > 1 ? "s" : ""} assigned</span><br>`;
  if (p.unread?.length) body += `<b style="color:#d33">! ${p.unread.length} new instruction${p.unread.length > 1 ? "s" : ""} from you, not read yet (${esc(p.unread[0].story_key)})</b><br>`;
  if (p.emote === "zzz") body += `<span class="dim">Zzz... ${p.agent?.last_seen ? `last checked in ${ago(p.agent.last_seen)}` : "hasn't checked in yet"}.</span><br>`;
  typeInto(dialog, head + body + `<span class="dim">...</span><span class="more">▼</span>`);

  // Latest thing this agent said on the card, fetched on demand.
  let quote = p.agent?.last_action ? `(${p.agent.last_action}, ${ago(p.agent.last_seen)})` : "";
  if (s) {
    try {
      const full = await fetch(`/api/stories/${s.key}`).then(res => res.json());
      const c = full.events.find(e => e.kind === "comment" && e.actor === p.name);
      if (c) quote = `"${c.body.split("\n")[0].slice(0, 140)}${c.body.length > 140 ? "..." : ""}"`;
    } catch {}
  }
  if (selected !== p) return;
  typeInto(dialog, head + body + (quote ? esc(quote) : "") + `<span class="more">▼</span>`);
}
function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function hit(ev) {
  const rect = cv.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / scale, y = (ev.clientY - rect.top) / scale;
  const list = [...people.values()].sort((a, b) => b.y - a.y);
  const p = list.find(p => x >= p.x + 1 && x <= p.x + 15 && y >= p.y - 2 && y <= p.y + (p.seated ? 15 : 21));
  if (p) return p;
  if (x >= BOARD.x && x <= BOARD.x + BOARD.w && y >= BOARD.y && y <= BOARD.y + BOARD.h) return "board";
  return null;
}
cv.addEventListener("mousemove", ev => { hover = hit(ev); cv.style.cursor = hover ? "pointer" : "default"; });
cv.addEventListener("mouseleave", () => hover = null);
cv.addEventListener("click", ev => {
  const h = hit(ev);
  if (h === "board" && selected === "board") { location.href = "/"; return; }
  selected = h; showDialog(selected);
});

function fit() {
  scale = Math.max(1, Math.min(4, Math.floor(Math.min((innerWidth - 32) / W, (innerHeight - 260) / H))));
  cv.style.width = W * scale + "px"; cv.style.height = H * scale + "px";
  document.getElementById("stage").style.width = W * scale + "px";
  showDialog(selected);
}
addEventListener("resize", fit);

(async () => {
  const meta = await fetch("/api/meta").then(res => res.json()).catch(() => ({}));
  await loadWeather(meta.office);
  setInterval(() => loadWeather(meta.office), 5 * 60e3);   // the 15 min cache decides when to actually refetch
  await poll();
  fit();
  requestAnimationFrame(frame);
  setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
})();
