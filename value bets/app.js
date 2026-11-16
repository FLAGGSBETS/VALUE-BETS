const REFRESH_MS = 5 * 60 * 1000; // relee la caché cada 5 min (no gasta créditos)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const COLORS = ["#2563eb", "#f59e0b", "#0f9d58"];

let db = {};
try { db = JSON.parse(localStorage.getItem("vb_db") || "{}"); } catch (e) { db = {}; }
let meta = { updated: null, remaining: null };
let rows = [];

const save = () => { try { localStorage.setItem("vb_db", JSON.stringify(db)); } catch (e) {} };
const sportOf = (k) => (k.startsWith("soccer") ? "Fútbol" : k.startsWith("basketball") ? "Baloncesto" : "Tenis");
const pct = (x) => (x * 100).toFixed(1) + "%";
const fmtDate = (iso) => new Date(iso).toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// ---------- Ingesta sin duplicados ----------
function ingest(events, updated) {
  const now = Date.now();
  for (const e of events) {
    if (!e.home_team || !e.away_team || !e.commence_time) continue;
    const sport = sportOf(e.sport_key);
    const key = [sport, norm(e.home_team), norm(e.away_team), e.commence_time.slice(0, 10)].join("|");
    const rec = db[key] || (db[key] = { key, books: {}, first: {}, history: [] });
    // rellena huecos sin crear otra fila
    rec.sport = rec.sport || sport;
    rec.league = rec.league || e.sport_title;
    rec.home = rec.home || e.home_team;
    rec.away = rec.away || e.away_team;
    rec.start = e.commence_time;
    rec.updated = updated;
    const seen = new Set();
    for (const b of e.bookmakers || []) {
      const m = (b.markets || []).find((x) => x.key === "h2h");
      if (!m) continue;
      seen.add(b.title);
      rec.books[b.title] = Object.assign(rec.books[b.title] || {}, Object.fromEntries(m.outcomes.map((o) => [o.name, o.price])));
    }
    for (const name of Object.keys(rec.books)) if (!seen.has(name)) delete rec.books[name];
    const a = analyze(rec);
    if (a) {
      if (!Object.keys(rec.first).length) rec.first = { ...a.avg };
      const last = rec.history[rec.history.length - 1];
      const changed = !last || a.outcomes.some((o) => Math.abs((last.avg[o] || 0) - a.avg[o]) > 0.0005);
      if (changed) rec.history.push({ t: updated, avg: { ...a.avg } });
    }
  }
  // elimina partidos empezados o terminados
  for (const k of Object.keys(db)) if (new Date(db[k].start).getTime() <= now) delete db[k];
  save();
}

// ---------- Cálculos ----------
function analyze(rec) {
  const outcomes = rec.sport === "Fútbol" ? [rec.home, "Draw", rec.away] : [rec.home, rec.away];
  const fairSum = {}, oddsSum = {}, n = {}, best = {};
  const perBook = {};
  for (const [book, odds] of Object.entries(rec.books)) {
    if (!outcomes.every((o) => odds[o] > 1)) continue; // casa incompleta: se ignora hasta que haya datos
    const imp = outcomes.map((o) => 1 / odds[o]);
    const over = imp.reduce((a, b) => a + b, 0); // overround
    perBook[book] = { over };
    outcomes.forEach((o, i) => {
      fairSum[o] = (fairSum[o] || 0) + imp[i] / over; // probabilidad justa sin margen
      oddsSum[o] = (oddsSum[o] || 0) + odds[o];
      n[o] = (n[o] || 0) + 1;
      if (!best[o] || odds[o] > best[o].price) best[o] = { price: odds[o], book };
    });
  }
  if (!n[outcomes[0]]) return null;
  const avg = {}, fair = {}, ev = {};
  for (const o of outcomes) {
    avg[o] = oddsSum[o] / n[o];
    fair[o] = fairSum[o] / n[o];
    ev[o] = fair[o] * best[o].price - 1;
  }
  const topOutcome = outcomes.reduce((a, b) => (ev[b] > ev[a] ? b : a));
  const moves = outcomes.map((o) => (rec.first[o] ? avg[o] / rec.first[o] - 1 : 0));
  const move = moves.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  return { outcomes, avg, fair, ev, best, perBook, topOutcome, move, nBooks: Object.keys(perBook).length };
}

const label = (rec, o) => (o === "Draw" ? "Empate" : o === rec.home ? rec.home + (rec.sport === "Fútbol" ? " (1)" : "") : rec.away + (rec.sport === "Fútbol" ? " (2)" : ""));

// ---------- Panel ----------
function compute() {
  rows = Object.values(db).map((rec) => ({ rec, a: analyze(rec) })).filter((r) => r.a);
}

function render() {
  const th = (parseFloat($("f-th").value) || 0) / 100;
  localStorage.setItem("vb_th", $("f-th").value);
  const fs = $("f-sport").value, fl = $("f-league").value, fd = $("f-date").value;
  const leagues = [...new Set(rows.map((r) => r.rec.league))].sort();
  const cur = $("f-league").value;
  $("f-league").innerHTML = '<option value="">Todas</option>' + leagues.map((l) => `<option ${l === cur ? "selected" : ""}>${esc(l)}</option>`).join("");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let list = rows.filter(({ rec, a }) => {
    if (fs && rec.sport !== fs) return false;
    if (fl && rec.league !== fl) return false;
    if (fd !== "") {
      const d = Math.floor((new Date(rec.start) - today) / 864e5);
      if (fd === "3" ? d > 2 : d !== +fd) return false;
    }
    if ($("f-value").checked && a.ev[a.topOutcome] < th) return false;
    return true;
  });
  const sort = $("f-sort").value;
  list.sort((x, y) => sort === "time" ? new Date(x.rec.start) - new Date(y.rec.start)
    : sort === "move" ? Math.abs(y.a.move) - Math.abs(x.a.move)
    : y.a.ev[y.a.topOutcome] - x.a.ev[x.a.topOutcome]);

  const picks = rows.filter((r) => r.a.ev[r.a.topOutcome] >= th);
  const dayEnd = new Date(today.getTime() + 864e5);
  const todayEv = rows.filter((r) => new Date(r.rec.start) < dayEnd).map((r) => r.a.ev[r.a.topOutcome]);
  $("c-matches").textContent = rows.length;
  $("c-picks").textContent = picks.length;
  $("c-ev").textContent = todayEv.length ? pct(Math.max(...todayEv)) : "–";

  $("rows").innerHTML = list.map(({ rec, a }) => {
    const o = a.topOutcome, v = a.ev[o] >= th;
    const mv = a.move;
    return `<tr class="${v ? "value" : ""}" data-k="${esc(rec.key)}">
      <td>${esc(rec.sport)}</td><td>${esc(rec.league)}</td><td>${esc(rec.home)} – ${esc(rec.away)}</td>
      <td>${fmtDate(rec.start)}</td><td>${esc(label(rec, o))}</td>
      <td>${a.best[o].price.toFixed(2)} · ${esc(a.best[o].book)}</td>
      <td>${pct(a.fair[o])}</td><td>${(a.ev[o] * 100).toFixed(1)}%</td>
      <td class="${mv > 0.001 ? "up" : mv < -0.001 ? "down" : ""}">${mv > 0 ? "▲" : mv < 0 ? "▼" : "–"} ${(Math.abs(mv) * 100).toFixed(1)}%</td></tr>`;
  }).join("");
  $("empty").hidden = list.length > 0;
  $("rows").dataset.n = list.length;
  window._list = list;
}

function openDetail(key) {
  const rec = db[key], a = rec && analyze(rec);
  if (!a) return;
  const head = a.outcomes.map((o) => `<th>${esc(label(rec, o))}</th>`).join("");
  const body = Object.keys(a.perBook).sort().map((b) =>
    `<tr><td>${esc(b)}</td>${a.outcomes.map((o) => {
      const p = rec.books[b][o];
      return `<td class="${p === a.best[o].price ? "best" : ""}">${p.toFixed(2)}</td>`;
    }).join("")}<td>${((a.perBook[b].over - 1) * 100).toFixed(1)}%</td></tr>`).join("");
  const sum = (f) => a.outcomes.map((o) => `<td>${f(o)}</td>`).join("");
  $("detail").innerHTML = `<h2>${esc(rec.home)} – ${esc(rec.away)}</h2>
    <div class="muted">${esc(rec.sport)} · ${esc(rec.league)} · ${fmtDate(rec.start)} · actualizado ${new Date(rec.updated).toLocaleTimeString("es-ES")}</div>
    <div class="table-wrap"><table><thead><tr><th>Casa</th>${head}<th>Margen</th></tr></thead><tbody>${body}
    <tr><td><b>Consenso</b></td>${sum((o) => a.avg[o].toFixed(2))}<td></td></tr>
    <tr><td><b>Prob. justa</b></td>${sum((o) => pct(a.fair[o]))}<td></td></tr>
    <tr><td><b>EV (mejor cuota)</b></td>${sum((o) => (a.ev[o] * 100).toFixed(1) + "%")}<td></td></tr>
    <tr><td><b>Mejor cuota</b></td>${sum((o) => a.best[o].price.toFixed(2) + " · " + esc(a.best[o].book))}<td></td></tr></tbody></table></div>
    <h3>Movimiento de la cuota media</h3>${chart(rec, a)}`;
  $("modal").hidden = false;
}

function chart(rec, a) {
  const h = rec.history;
  if (h.length < 2) return '<p class="muted">Aún no hay movimiento registrado. Se irá guardando en cada actualización.</p>';
  const W = 640, H = 220, P = 34;
  const vals = h.flatMap((p) => a.outcomes.map((o) => p.avg[o]).filter(Boolean));
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const t0 = new Date(h[0].t), t1 = new Date(h[h.length - 1].t), ts = t1 - t0 || 1;
  const X = (t) => P + ((new Date(t) - t0) / ts) * (W - P * 2);
  const Y = (v) => H - P - ((v - min) / span) * (H - P * 2);
  const lines = a.outcomes.map((o, i) => {
    const pts = h.filter((p) => p.avg[o]).map((p) => `${X(p.t).toFixed(1)},${Y(p.avg[o]).toFixed(1)}`).join(" ");
    return `<polyline fill="none" stroke="${COLORS[i]}" stroke-width="2" points="${pts}"/>`;
  }).join("");
  const legend = a.outcomes.map((o, i) => `<span style="color:${COLORS[i]}">● ${esc(label(rec, o))}</span>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}"><text x="4" y="${P}" font-size="11" fill="#888">${max.toFixed(2)}</text><text x="4" y="${H - P}" font-size="11" fill="#888">${min.toFixed(2)}</text>${lines}</svg><div class="legend">${legend}</div>`;
}

function exportCsv() {
  const th = (parseFloat($("f-th").value) || 0) / 100;
  const head = ["Deporte", "Liga", "Local", "Visitante", "Fecha", "Mejor pick", "Cuota", "Casa", "Prob justa", "EV %", "Pick con valor", "Movimiento %", "Ultima actualizacion"];
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = (window._list || []).map(({ rec, a }) => {
    const o = a.topOutcome;
    return [rec.sport, rec.league, rec.home, rec.away, rec.start, label(rec, o), a.best[o].price, a.best[o].book,
      (a.fair[o] * 100).toFixed(2), (a.ev[o] * 100).toFixed(2), a.ev[o] >= th ? "SI" : "NO", (a.move * 100).toFixed(2), rec.updated].map(q).join(",");
  });
  const blob = new Blob(["\ufeff" + [head.map(q).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "value-bets.csv";
  link.click();
}

// ---------- Carga de datos ----------
async function load() {
  try {
    const r = await fetch("/api/odds");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Error del servidor");
    meta = { updated: d.updated, remaining: d.remaining };
    ingest(d.events, d.updated);
    $("status").textContent = `Datos de ${new Date(d.updated).toLocaleTimeString("es-ES")}` + (d.remaining ? ` · créditos API: ${d.remaining}` : "");
  } catch (e) {
    $("status").textContent = "⚠ " + e.message + " (mostrando últimos datos guardados)";
  }
  compute();
  render();
}

// ---------- Eventos ----------
["f-sport", "f-league", "f-date", "f-sort", "f-th", "f-value"].forEach((id) => $(id).addEventListener("input", render));
$("rows").addEventListener("click", (e) => { const tr = e.target.closest("tr"); if (tr) openDetail(tr.dataset.k); });
$("close").onclick = () => ($("modal").hidden = true);
$("modal").onclick = (e) => { if (e.target === $("modal")) $("modal").hidden = true; };
$("csv").onclick = exportCsv;
$("theme").onclick = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  localStorage.setItem("vb_theme", t);
};
document.documentElement.dataset.theme = localStorage.getItem("vb_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
$("f-th").value = localStorage.getItem("vb_th") || "3";

compute();
render();
load();
setInterval(load, REFRESH_MS);
