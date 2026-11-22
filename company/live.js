// SANIX AI · Salle de contrôle : vue d'affichage en direct de l'activité des agents (lecture seule).
// Données réelles uniquement (agents, missions, actions, fiches créées) lues dans Supabase avec la session du Bureau (RLS : direction). Aucune valeur inventée.
// Fenêtre ouverte depuis le Bureau (window.open) : la session est copiée puis renouvelée par le Bureau (postMessage), jamais par cette fenêtre,
// pour éviter que deux fenêtres renouvellent le même jeton.
import { SUPABASE_DEFAULT } from "./config.js";
import { initJarvis } from "./live_voice.js";

const $ = (s) => document.querySelector(s);
const LS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const ago = (iso) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : `il y a ${Math.floor(s / 86400)} j`; };
const dur = (ms) => { const m = Math.floor(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
const ORIGIN = location.origin;

const STATES = { run: ["Au travail", "#22D3EE"], wait: ["Coordonne ses équipes", "#A855F7"], valid: ["Attend une validation", "#F59E0B"], bad: ["Mission bloquée", "#EF4444"], queue: ["Mission en attente", "#64748B"], idle: ["Disponible", "#3B5A94"], off: ["Suspendu", "#475569"] };
const TASK_C = { en_cours: "#22D3EE", attente_sous_taches: "#A855F7", attente_validation: "#F59E0B", a_faire: "#64748B", bloquee: "#EF4444", echouee: "#EF4444", terminee: "#22C55E" };
const TASK_L = { en_cours: "En cours", attente_sous_taches: "Attend ses équipes", attente_validation: "À valider", a_faire: "À faire", bloquee: "Bloquée", echouee: "Échouée", terminee: "Terminée", annulee: "Annulée" };
const D = { agents: [], depts: [], tasks: [], actions: [], created: {}, recent: [], todayRows: [], nToday: 0, nTotal: 0, approvals: 0, budget: null, gov: null, sel: null, taskFilter: "all", lastId: 0, first: true, fails: 0 };
let sb = null;

// ───────── Configuration et session ─────────
function readConfig() {
  for (const c of [LS("sanix_crm_supabase_config"), LS("sanix_company_cfg"), SUPABASE_DEFAULT]) if (c?.url && c?.key && !/^sb_secret_/.test(c.key)) return { url: c.url, key: c.key };
  return null;
}
function gate(msg) { $("#gate-msg").textContent = msg; $("#gate").hidden = false; $("#live").hidden = true; }
function conn(state, text) { const el = $("#conn"); el.className = "conn " + state; el.querySelector("span").textContent = text; }
function askSession() { try { window.opener?.postMessage({ type: "sanix-live-need-session" }, ORIGIN); } catch { /* fenêtre d'origine fermée */ } }
window.addEventListener("message", async (ev) => {
  if (ev.origin !== ORIGIN || ev.data?.type !== "sanix-session" || !sb) return;
  try { await sb.auth.setSession?.({ access_token: ev.data.access_token, refresh_token: ev.data.refresh_token }); } catch { /* jeton refusé : le prochain cycle le dira */ }
});

// ───────── Lecture des données ─────────
const safe = async (p, fallback) => { try { const r = await p; if (r?.error) throw new Error(r.error.message); return r; } catch (e) { if (/JWT|401|expired/i.test(String(e.message))) askSession(); safe.err = e; return fallback; } };
const since = (d) => new Date(Date.now() - d * 86400e3).toISOString();
async function pull() {
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  safe.err = null;
  const [ag, tk, ac, cr, nT, nA, rc, td, ap, bu, gv] = await Promise.all([
    safe(sb.from("ai_agents").select("id,code,nom,fonction,niveau,manager_id,departement_id,etat,activite"), null),
    safe(sb.from("ai_agent_tasks").select("id,agent_id,donneur_agent_id,parent_id,type,titre,objectifs,statut,priorite,produit,started_at,updated_at,created_at,executions").gte("updated_at", since(7)).order("updated_at", { ascending: false }).limit(600), null),
    safe(sb.from("ai_actions").select("id,action,agent_id,task_id,payload,ok,at").order("at", { ascending: false }).limit(60), null),
    safe(sb.from("ai_actions").select("task_id").eq("action", "abonnement_prospect_cree").gte("at", since(3)).limit(1500), null),
    safe(sb.from("ai_prospects").select("id", { count: "exact", head: true }).gte("created_at", day.toISOString()), null),
    safe(sb.from("ai_prospects").select("id", { count: "exact", head: true }), null),
    safe(sb.from("ai_prospects").select("id,entreprise,ville,produits_recommandes,telephone,email,source_url,created_at").order("created_at", { ascending: false }).limit(14), null),
    safe(sb.from("ai_prospects").select("telephone,email,source_url").gte("created_at", day.toISOString()).limit(500), null),
    safe(sb.from("ai_approvals").select("id", { count: "exact", head: true }).eq("statut", "en_attente"), null),
    safe(sb.rpc("ai_budget_status"), null),
    safe(sb.from("ai_governance").select("actif,communication_externe").eq("id", 1).maybeSingle(), null),
  ]);
  if (!ag?.data || !tk?.data) throw safe.err ?? new Error("Données indisponibles");
  if (!D.depts.length) { const dp = await safe(sb.from("ai_departments").select("id,nom,couleur"), null); D.depts = dp?.data ?? []; }
  D.agents = ag.data; D.tasks = tk.data; D.actions = ac?.data ?? D.actions;
  if (cr?.data) { D.created = {}; for (const r of cr.data) if (r.task_id) D.created[r.task_id] = (D.created[r.task_id] ?? 0) + 1; }
  D.nToday = nT?.count ?? D.nToday; D.nTotal = nA?.count ?? D.nTotal; D.recent = rc?.data ?? D.recent; D.todayRows = td?.data ?? D.todayRows;
  D.approvals = ap?.count ?? D.approvals; D.budget = bu?.data ?? D.budget; D.gov = gv?.data ?? D.gov;
}

// ───────── États dérivés ─────────
const deptColor = (id) => D.depts.find((d) => d.id === id)?.couleur ?? "#3B82F6";
const agentById = (id) => D.agents.find((a) => a.id === id);
const nameOf = (id) => agentById(id)?.nom ?? "Un agent";
const OPENS = ["en_cours", "attente_sous_taches", "attente_validation", "a_faire"];
function agentState(a) {
  if (a.etat === "suspendu" || a.etat === "archive") return "off";
  const mine = D.tasks.filter((t) => t.agent_id === a.id);
  if (mine.some((t) => t.statut === "en_cours")) return "run";
  if (mine.some((t) => t.statut === "attente_sous_taches")) return "wait";
  if (mine.some((t) => t.statut === "attente_validation")) return "valid";
  if (mine.some((t) => ["bloquee", "echouee"].includes(t.statut) && Date.now() - Date.parse(t.updated_at) < 6 * 3600e3)) return "bad";
  if (["en_mission", "en_analyse", "en_reunion"].includes(a.activite)) return "run";
  return mine.some((t) => t.statut === "a_faire") ? "queue" : "idle";
}
const targetOf = (t) => { const m = /(\d+)\s*(?:nouvelles?\s+)?fiches/i.exec(`${t.titre} ${Array.isArray(t.objectifs) ? t.objectifs.join(" ") : ""}`); return m ? Number(m[1]) : 0; };
function health() {
  const week = D.tasks.filter((t) => ["terminee", "bloquee", "echouee"].includes(t.statut));
  const ok = week.filter((t) => t.statut === "terminee").length, rate = week.length >= 3 ? Math.round(100 * ok / week.length) : null;
  const stale = D.tasks.filter((t) => t.statut === "en_cours" && t.started_at && Date.now() - Date.parse(t.started_at) > 90 * 60000).length;
  const blocked = D.tasks.filter((t) => ["bloquee", "echouee"].includes(t.statut) && Date.now() - Date.parse(t.updated_at) < 24 * 3600e3).length;
  const tr = D.todayRows, good = tr.filter((p) => (p.telephone || p.email) && /^https:\/\//i.test(p.source_url ?? "")).length, qual = tr.length >= 3 ? Math.round(100 * good / tr.length) : null;
  const parts = [[40, rate], [25, stale === 0 ? 100 : stale === 1 ? 70 : stale === 2 ? 45 : 20], [15, blocked === 0 ? 100 : blocked === 1 ? 80 : blocked === 2 ? 60 : 35], [20, qual]].filter((p) => p[1] !== null);
  const score = Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / parts.reduce((s, p) => s + p[0], 0));
  return { score, rate, nClosed: week.length, stale, blocked, qual, nToday: tr.length };
}

// ───────── Rendu des panneaux ─────────
const kpiVals = {};
function tween(el, to, fmt = (v) => String(Math.round(v))) {
  const from = kpiVals[el.id] ?? 0; kpiVals[el.id] = to; if (from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(); (function step(now) { const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); })(t0);
}
function renderKpis() {
  const act = D.agents.filter((a) => !["suspendu", "archive"].includes(a.etat)), run = act.filter((a) => agentState(a) === "run").length;
  const enc = D.tasks.filter((t) => t.statut === "en_cours").length, att = D.tasks.filter((t) => ["a_faire", "attente_sous_taches"].includes(t.statut)).length;
  const b = D.budget, usd = (v) => `${Number(v ?? 0).toFixed(2)} $`;
  const valid = D.tasks.filter((t) => t.statut === "attente_validation").length, blocked = D.tasks.filter((t) => ["bloquee", "echouee"].includes(t.statut)).length;
  const tiles = [["k-run", "Agents au travail", `/ ${act.length} actifs`, "#22D3EE", run], ["k-mis", "Missions en cours", `${att} en attente · ${valid} à valider · ${blocked} bloquées`, "#A855F7", enc], ["k-today", "Fiches créées aujourd'hui", "prospects trouvés", "#22C55E", D.nToday], ["k-tot", "Prospects en base", "tous logiciels", "#FACC15", D.nTotal], ["k-val", "À valider", "décisions du président", "#F59E0B", D.approvals]];
  if (!$("#kpis").children.length) $("#kpis").innerHTML = tiles.map(([id, l, e, c]) => `<div class="kpi" style="--c:${c}"><small>${esc(l)}</small><b id="${id}">0</b><em id="${id}-e">${esc(e)}</em></div>`).join("") + `<div class="kpi" style="--c:#22D3EE"><small>Coût IA du jour</small><b id="k-usd">–</b><em id="k-usd-e"></em></div>`;
  tiles.forEach(([id, , e, , v]) => { tween($("#" + id), v); $("#" + id + "-e").textContent = e; });
  $("#k-usd").textContent = b ? `${Number(b.jour_usd ?? 0).toFixed(2)} $` : "–";
  $("#k-usd-e").textContent = b ? `sur ${usd(b.budget_jour_usd)} · mois ${usd(b.mois_usd)}` : "";
}
function renderMissions() {
  const order = { en_cours: 0, attente_sous_taches: 1, attente_validation: 2, a_faire: 3, bloquee: 4, echouee: 5 };
  const all = D.tasks.filter((t) => t.statut in order && (t.statut !== "bloquee" || Date.now() - Date.parse(t.updated_at) < 24 * 3600e3));
  const counts = {
    run: all.filter((t) => t.statut === "en_cours").length,
    waiting: all.filter((t) => ["a_faire", "attente_sous_taches"].includes(t.statut)).length,
    valid: all.filter((t) => t.statut === "attente_validation").length,
    blocked: all.filter((t) => ["bloquee", "echouee"].includes(t.statut)).length,
  };
  const summary = $("#mission-summary");
  if (summary) summary.textContent = `${all.length} ouvertes · ${counts.run} en cours · ${counts.waiting} en attente · ${counts.valid} à valider · ${counts.blocked} bloquées`;
  document.querySelectorAll("#mission-filters [data-filter]").forEach((b) => {
    const active = b.dataset.filter === D.taskFilter;
    b.classList.toggle("on", active); b.setAttribute("aria-pressed", String(active));
  });
  const matches = (t) => D.taskFilter === "all" ||
    (D.taskFilter === "waiting" && ["a_faire", "attente_sous_taches"].includes(t.statut)) ||
    (D.taskFilter === "blocked" && ["bloquee", "echouee"].includes(t.statut)) ||
    t.statut === D.taskFilter;
  const list = all.filter(matches).sort((a, b) => order[a.statut] - order[b.statut] || a.priorite - b.priorite || Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 40);
  $("#missions").innerHTML = list.map((t) => {
    const c = TASK_C[t.statut], tg = targetOf(t), n = D.created[t.id] ?? 0, pct = tg ? Math.min(100, Math.round(100 * n / tg)) : 0;
    return `<button type="button" class="mis mission-item ${t.statut === "en_cours" ? "run" : ""}" style="--c:${c}" data-agent="${esc(t.agent_id)}" aria-label="Afficher l'agent ${esc(nameOf(t.agent_id))} et sa mission ${esc(t.titre)}">
      <b>${esc(clip(t.titre, 90))}</b><small>${esc(nameOf(t.agent_id))}</small>
      <div><span class="tag" style="--c:${c}">${esc(TASK_L[t.statut])}</span><span class="tag">P${esc(t.priorite)}</span>${t.produit ? `<span class="tag">${esc(t.produit)}</span>` : ""}${t.statut === "en_cours" && t.started_at ? `<small data-start="${esc(t.started_at)}">${dur(Date.now() - Date.parse(t.started_at))}</small>` : ""}</div>
      ${tg ? `<div class="bar"><i style="width:${pct}%"></i></div><small>${n} / ${tg} fiches créées</small>` : ""}
    </button>`;
  }).join("") || `<div class="muted empty-missions">Aucune mission dans ce filtre.</div>`;
}
const ACT = {
  abonnement_reclamee: ["▶️", (p) => `prend la mission « ${clip(p.titre, 70)} »`], abonnement_cloturee: [(p) => (p.statut === "terminee" ? "✅" : "⚠️"), (p) => `clôture « ${clip(p.titre, 60)} » : ${(TASK_L[p.statut] ?? p.statut).toLowerCase()}`],
  abonnement_prospect_cree: ["🆕", (p) => `nouvelle fiche : ${clip(p.entreprise, 50)}`], abonnement_message_prepare: ["✉️", (p) => `message ${esc(p.canal ?? "")} préparé, à valider`],
  abonnement_assignation: ["🧭", (p) => `délègue : ${clip(p.titre, 60)}`], abonnement_evaluation: ["⭐", (p) => `évalue une mission : ${p.note}/100`], abonnement_qualification: ["🎯", () => "qualifie un prospect"],
  abonnement_etape: ["🚦", (p) => `pipeline : ${p.de} → ${p.vers}`], abonnement_rdv: ["📅", () => "rendez-vous réservé"], abonnement_offre: ["💼", () => "offre préparée"], abonnement_escalade: ["🙋", () => "escalade à un humain"],
  abonnement_memorisation: ["🧠", () => "retient une leçon"], abonnement_relance_planifiee: ["⏰", () => "relance planifiée"], abonnement_attente: ["⏳", () => "attend ses équipes"],
};
const actView = (a) => { const d = ACT[a.action], p = a.payload ?? {}; if (!d) return [a.ok === false ? "⚠️" : "⚙️", a.action.replace(/^abonnement_/, "").replace(/_/g, " ")]; return [typeof d[0] === "function" ? d[0](p) : d[0], d[1](p)]; };
function renderFeed(markNew) {
  const fresh = D.actions.filter((a) => a.id > D.lastId);
  $("#feed").innerHTML = D.actions.slice(0, 40).map((a) => { const [ic, tx] = actView(a); return `<div class="it ${markNew && a.id > D.lastId ? "new" : ""}"><span class="ic">${ic}</span><div><b>${esc(nameOf(a.agent_id))}</b> ${tx.replace(/</g, "&lt;")}<small>${ago(a.at)}</small></div></div>`; }).join("") || `<div class="muted">Aucune action récente.</div>`;
  if (markNew) for (const a of fresh.slice(0, 6).reverse()) (view3d ? view3d.fx(a) : fx(a)); if (D.actions.length) D.lastId = Math.max(D.lastId, ...D.actions.map((a) => a.id));
}
function renderHealth() {
  const h = health(), col = h.score >= 85 ? "#22C55E" : h.score >= 65 ? "#22D3EE" : h.score >= 40 ? "#F59E0B" : "#EF4444", lab = h.score >= 85 ? "Excellent" : h.score >= 65 ? "Sous contrôle" : h.score >= 40 ? "À surveiller" : "Critique";
  const C = 2 * Math.PI * 44, b = D.budget, pb = b && Number(b.budget_jour_usd) ? Math.round(100 * Number(b.jour_usd ?? 0) / Number(b.budget_jour_usd)) : null;
  const row = (l, v, c) => `<div><span>${l}</span><span class="${c}">${v}</span></div>`;
  $("#health").innerHTML = `<div class="gauge"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="#12213F" stroke-width="9"/><circle cx="50" cy="50" r="44" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C * h.score / 100).toFixed(1)} ${C.toFixed(1)}" style="filter:drop-shadow(0 0 6px ${col});transition:stroke-dasharray 1s"/></svg><b style="color:${col}">${h.score}</b></div>
    <div class="hl"><h2>Santé · <span style="color:${col}">${lab}</span></h2>
      ${row("Missions réussies (7 j)", h.rate === null ? "n/d" : `${h.rate} % · ${h.nClosed}`, h.rate === null ? "" : h.rate >= 70 ? "ok" : h.rate >= 40 ? "warn" : "bad")}
      ${row("Missions figées (> 90 min)", h.stale, h.stale ? "bad" : "ok")}${row("Blocages (24 h)", h.blocked, h.blocked ? "warn" : "ok")}
      ${row("Fiches avec contact + source", h.qual === null ? "n/d" : `${h.qual} %`, h.qual === null ? "" : h.qual >= 80 ? "ok" : "warn")}
      ${row("Envoi externe", D.gov?.communication_externe === "validation" ? "sur validation" : esc(D.gov?.communication_externe ?? "n/d"), D.gov?.communication_externe === "validation" ? "ok" : "warn")}
      ${row("Budget IA du jour", pb === null ? "n/d" : `${pb} %`, pb === null ? "" : pb > 90 ? "bad" : pb > 70 ? "warn" : "ok")}</div>`;
  $("#health").title = "Indice 0-100 : réussite des missions (40 %), absence de missions figées (25 %), blocages (15 %), qualité des fiches du jour (20 %).";
}
function renderTicker() {
  if (!D.recent.length) return;
  const one = D.recent.map((p) => `<span class="f">🆕 <em>${esc(clip(p.entreprise, 44))}</em> ${p.ville ? "· " + esc(p.ville) : ""} <small>${esc((p.produits_recommandes ?? [])[0] ?? "")} · ${ago(p.created_at)}</small></span>`).join("");
  const tr = $("#ticker"); if (tr.dataset.k !== one) { tr.dataset.k = one; tr.innerHTML = one + one; }
}
function renderLegend() { $("#legend").innerHTML = Object.entries(STATES).map(([, [l, c]]) => `<span><i style="background:${c};box-shadow:0 0 8px ${c}"></i>${l}</span>`).join(""); }
function renderDetail() {
  const el = $("#detail"), a = agentById(D.sel); if (!a) { el.hidden = true; return; }
  const st = STATES[agentState(a)], mine = D.tasks.filter((t) => t.agent_id === a.id && OPENS.includes(t.statut)).slice(0, 4);
  el.hidden = false; el.innerHTML = `<h2>${esc(a.nom)} <span class="tag" style="--c:${st[1]}">${esc(st[0])}</span></h2><div class="muted" style="font-size:12px">${esc(a.fonction ?? "")}</div>${mine.map((t) => `<div class="mis" style="--c:${TASK_C[t.statut]};margin-top:6px"><b>${esc(clip(t.titre, 80))}</b><small>${esc(TASK_L[t.statut])} · P${esc(t.priorite)}</small></div>`).join("") || `<div class="muted" style="margin-top:6px">Aucune mission ouverte.</div>`}`;
}

// ───────── Réseau animé (canvas 2D) ─────────
const cv = $("#net"), ctx = cv.getContext("2d"), tip = $("#tip");
let W = 0, H = 0, DPR = 1, nodes = [], parts = [], bubbles = [], rings = [], stars = [], hover = null, layoutKey = "";
function layout() {
  const key = D.agents.map((a) => a.id + a.niveau + a.departement_id).join("|") + W + "x" + H; if (key === layoutKey || !W) return; layoutKey = key;
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 34, ag = D.agents.filter((a) => a.etat !== "archive");
  const dg = ag.filter((a) => a.niveau === 1), rest = ag.filter((a) => a.niveau !== 1), depts = [...new Set(rest.map((a) => a.departement_id ?? ""))].sort();
  const per = depts.map((d) => rest.filter((a) => (a.departement_id ?? "") === d).length), tot = per.reduce((s, n) => s + n, 0) || 1;
  const old = new Map(nodes.map((n) => [n.id, n])); nodes = [];
  dg.forEach((a, i) => nodes.push(mk(a, cx + (dg.length > 1 ? (i - (dg.length - 1) / 2) * 44 : 0), cy, 1, old)));
  let ang = -Math.PI / 2;
  depts.forEach((d, di) => {
    const span = 2 * Math.PI * per[di] / tot, list = rest.filter((a) => (a.departement_id ?? "") === d);
    for (const lvl of [2, 3, 4, 5]) {
      const row = list.filter((a) => a.niveau === lvl); if (!row.length) continue;
      const r = R * [0, 0, .32, .56, .78, .96][lvl];
      row.forEach((a, i) => { const t = ang + span * ((i + .5) / row.length), rr = r + (i % 2 ? 8 : -8) * (lvl > 3 ? 1 : 0); nodes.push(mk(a, cx + Math.cos(t) * rr, cy + Math.sin(t) * rr, lvl, old)); });
    }
    ang += span;
  });
  stars = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, p: Math.random() * 6.28, s: Math.random() * 1.4 + .3 }));
}
const mk = (a, x, y, lvl, old) => ({ id: a.id, a, x, y, r: [0, 22, 14, 12, 10.5, 9][lvl] * Math.min(1, Math.min(W, H) / 640 + .25), ph: old.get(a.id)?.ph ?? Math.random() * 6.28, st: "idle" });
function resize() {
  const b = cv.parentElement.getBoundingClientRect(); DPR = Math.min(2, window.devicePixelRatio || 1); W = Math.max(200, b.width); H = Math.max(200, b.height);
  cv.width = W * DPR; cv.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); layoutKey = ""; layout();
}
function fx(a) {
  const n = nodes.find((x) => x.id === a.agent_id), c = nodes.find((x) => x.a.niveau === 1) ?? { x: W / 2, y: H / 2 }; if (!n) return;
  const [ic, tx] = actView(a), col = a.action === "abonnement_prospect_cree" ? "#22C55E" : a.ok === false ? "#EF4444" : "#22D3EE";
  parts.push({ x0: n.x, y0: n.y, x1: c.x, y1: c.y, t0: performance.now(), d: 1400, col });
  bubbles.push({ n, text: `${ic} ${clip(tx, 46)}`, t0: performance.now(), col });
  if (a.action === "abonnement_prospect_cree") rings.push({ x: n.x, y: n.y, t0: performance.now(), col });
}
function draw(now) {
  requestAnimationFrame(draw); if (!W || view3d) return; const t = now / 1000;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 34;
  for (const s of stars) { ctx.globalAlpha = .25 + .35 * Math.sin(t * s.s + s.p); ctx.fillStyle = "#9FB6E6"; ctx.fillRect(s.x, s.y, 1.4, 1.4); } ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(34,211,238,.07)"; ctx.lineWidth = 1; for (const k of [.3, .52, .74, .95]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, 6.2832); ctx.stroke(); }
  const sw = t * .5; const g = ctx.createConicGradient ? ctx.createConicGradient(sw, cx, cy) : null;
  if (g) { g.addColorStop(0, "rgba(34,211,238,.16)"); g.addColorStop(.12, "rgba(34,211,238,0)"); g.addColorStop(1, "rgba(34,211,238,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, 6.2832); ctx.fill(); }
  const by = new Map(nodes.map((n) => [n.id, n])); for (const n of nodes) n.st = agentState(n.a);
  for (const n of nodes) { // liens hiérarchiques
    const m = by.get(n.a.manager_id) ?? (n.a.niveau > 1 ? nodes.find((x) => x.a.niveau === 1) : null); if (!m) continue;
    const on = n.st === "run" || n.st === "wait"; ctx.strokeStyle = on ? "rgba(34,211,238,.5)" : "rgba(80,110,170,.22)"; ctx.lineWidth = on ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(n.x, n.y); ctx.stroke();
    if (on) { const k = (t * .45 + n.ph) % 1; ctx.fillStyle = "#67E8F9"; ctx.shadowColor = "#22D3EE"; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(m.x + (n.x - m.x) * k, m.y + (n.y - m.y) * k, 2.4, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0; }
  }
  const nowMs = performance.now();
  for (const p of parts) { const k = Math.min(1, (nowMs - p.t0) / p.d), e = k * k * (3 - 2 * k), x = p.x0 + (p.x1 - p.x0) * e, y = p.y0 + (p.y1 - p.y0) * e; ctx.fillStyle = p.col; ctx.shadowColor = p.col; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(x, y, 4.2 * (1 - k * .4), 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0; }
  parts = parts.filter((p) => nowMs - p.t0 < p.d);
  for (const r of rings) { const k = (nowMs - r.t0) / 1600; ctx.strokeStyle = r.col; ctx.globalAlpha = Math.max(0, 1 - k); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(r.x, r.y, 12 + k * 70, 0, 6.2832); ctx.stroke(); } ctx.globalAlpha = 1; rings = rings.filter((r) => nowMs - r.t0 < 1600);
  for (const n of nodes) {
    const c = n.a.niveau === 1 ? "#FACC15" : deptColor(n.a.departement_id), sc = STATES[n.st][1], run = n.st === "run", pul = run ? 1 + .12 * Math.sin(t * 5 + n.ph) : n.st === "wait" ? 1 + .06 * Math.sin(t * 2 + n.ph) : 1, r = n.r * pul;
    if (n.st !== "idle" && n.st !== "off") { ctx.shadowColor = sc; ctx.shadowBlur = run ? 26 : 14; }
    ctx.fillStyle = n.st === "off" ? "#16213A" : "#0B1630"; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.2832); ctx.fill();
    ctx.lineWidth = n === hover || n.id === D.sel ? 3.4 : 2.2; ctx.strokeStyle = n.st === "bad" ? (Math.sin(t * 9) > 0 ? "#EF4444" : "#7F1D1D") : n.st === "off" ? "#334155" : c; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = sc; ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(3, r * .36), 0, 6.2832); ctx.fill();
    if (run) { ctx.strokeStyle = "#22D3EE"; ctx.lineWidth = 2; ctx.setLineDash([5, 7]); ctx.beginPath(); ctx.arc(n.x, n.y, r + 6, t * 2 + n.ph, t * 2 + n.ph + 4.4); ctx.stroke(); ctx.setLineDash([]); }
    if (n.a.niveau === 1 || ((n.a.niveau <= 2 || run) && W > 560) || n === hover || n.id === D.sel) { ctx.font = `${n.a.niveau === 1 ? 13 : 11}px system-ui,sans-serif`; ctx.textAlign = "center"; const lb = clip(n.a.nom.replace(/^IA\s+/i, ""), 24); ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(5,11,22,.9)"; ctx.strokeText(lb, n.x, n.y + r + 14); ctx.fillStyle = run ? "#E8FBFF" : "#9FB3D9"; ctx.fillText(lb, n.x, n.y + r + 14); }
  }
  for (const b of bubbles) { const k = (nowMs - b.t0) / 6000, y = b.n.y - b.n.r - 18 - k * 14; ctx.globalAlpha = k < .1 ? k * 10 : Math.max(0, 1 - (k - .75) * 4); ctx.font = "12px system-ui,sans-serif"; const w = ctx.measureText(b.text).width + 16, x = Math.min(W - w / 2 - 6, Math.max(w / 2 + 6, b.n.x));
    ctx.fillStyle = "rgba(8,18,36,.92)"; ctx.strokeStyle = b.col; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 14, w, 22, 8); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#EAF6FF"; ctx.textAlign = "center"; ctx.fillText(b.text, x, y + 1); }
  ctx.globalAlpha = 1; bubbles = bubbles.filter((b) => nowMs - b.t0 < 6000);
}
function pick(ev) { const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top; let best = null, bd = 1e9; for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < n.r + 9 && d < bd) { best = n; bd = d; } } return { n: best, x, y }; }
cv.addEventListener("pointermove", (ev) => {
  const { n, x, y } = pick(ev); hover = n; cv.style.cursor = n ? "pointer" : "default";
  if (!n) { tip.hidden = true; return; }
  const cur = D.tasks.find((t) => t.agent_id === n.id && t.statut === "en_cours") ?? D.tasks.find((t) => t.agent_id === n.id && OPENS.includes(t.statut));
  tip.innerHTML = `<b>${esc(n.a.nom)}</b><span class="muted">${esc(n.a.fonction ?? "")}</span><br><span class="tag" style="--c:${STATES[n.st][1]}">${esc(STATES[n.st][0])}</span>${cur ? `<br>${esc(clip(cur.titre, 90))}` : ""}`;
  tip.hidden = false; tip.style.left = Math.min(W - 290, x + 14) + "px"; tip.style.top = Math.max(6, y - 10) + "px";
});
cv.addEventListener("pointerleave", () => { hover = null; tip.hidden = true; });
cv.addEventListener("click", (ev) => { const { n } = pick(ev); D.sel = n && n.id !== D.sel ? n.id : null; renderDetail(); });
$("#mission-filters").addEventListener("click", (ev) => { const b = ev.target.closest("[data-filter]"); if (!b) return; D.taskFilter = b.dataset.filter; renderMissions(); });
$("#missions").addEventListener("click", (ev) => { const m = ev.target.closest("[data-agent]"); if (m) { D.sel = m.dataset.agent; view3d?.focus(D.sel); renderDetail(); } });

// ───────── Vue 3D (repli 2D si WebGL indisponible ou ?2d) ─────────
let view3d = null;
const api3d = {
  get D() { return D; }, STATES, clip, agentState, deptColor, onSelect: (id) => { D.sel = id; renderDetail(); },
  onHover: (h) => { if (!h) { tip.hidden = true; return; } const n = h.n, cur = D.tasks.find((t) => t.agent_id === n.id && t.statut === "en_cours") ?? D.tasks.find((t) => t.agent_id === n.id && OPENS.includes(t.statut));
    tip.innerHTML = `<b>${esc(n.a.nom)}</b><span class="muted">${esc(n.a.fonction ?? "")}</span><br><span class="tag" style="--c:${STATES[n.st][1]}">${esc(STATES[n.st][0])}</span>${cur ? `<br>${esc(clip(cur.titre, 90))}` : ""}`; tip.hidden = false; tip.style.left = Math.min(W - 290, h.x + 14) + "px"; tip.style.top = Math.max(6, h.y - 10) + "px"; },
};
async function init3d() {
  if (/[?&]2d/.test(location.search)) return;
  try { const m = await import("./live3d.js"); view3d = m.create($("#stage3d"), api3d); cv.hidden = true; new ResizeObserver(() => view3d?.resize()).observe($("#stage3d")); }
  catch (e) { console.warn("Vue 3D indisponible, repli sur la vue 2D :", e.message); view3d = null; $("#ctl").hidden = true; $("#hint").hidden = true; }
}
function initControls() {
  $("#ctl").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-c]"); if (!b || !view3d) return; const c = b.dataset.c;
    if (c === "in") view3d.zoom(.72); else if (c === "out") view3d.zoom(1.4); else if (c === "reset") view3d.reset(); else if (c === "auto") b.classList.toggle("on", view3d.toggleAuto()); else if (c === "dyn") b.classList.toggle("on", view3d.toggleDynamic());
    else if (c === "focus") { document.body.classList.toggle("focus"); setTimeout(() => view3d.resize(), 60); } });
  setTimeout(() => $("#hint")?.classList.add("off"), 9000);
}

// ───────── Boucle principale ─────────
function tick() {
  const f = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", hour: "2-digit", minute: "2-digit", second: "2-digit" }); $("#clock").textContent = f.format(new Date());
  document.querySelectorAll("[data-start]").forEach((el) => { el.textContent = " · " + dur(Date.now() - Date.parse(el.dataset.start)); });
}
async function cycle() {
  try {
    await pull(); D.fails = 0; conn("ok", `En direct · ${new Date().toLocaleTimeString("fr-FR", { timeZone: "Africa/Abidjan" })}`);
    layout(); view3d?.update(); renderKpis(); renderMissions(); renderFeed(!D.first); renderHealth(); renderTicker(); renderDetail(); D.first = false;
  } catch (e) { D.fails++; conn("bad", D.fails > 1 ? "Reconnexion… (session ou réseau)" : "Rafraîchissement…"); if (D.fails > 2) askSession(); }
}
async function boot() {
  if (new URLSearchParams(location.search).has("kiosk")) document.body.classList.add("kiosk");
  const cfg = readConfig(); if (!cfg || !window.supabase) { gate("Configuration Supabase introuvable : ouvrez d'abord le Bureau SANIX AI."); return; }
  sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: window.sessionStorage } });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { gate("Session absente : ouvrez cette fenêtre depuis le Bureau SANIX AI (bouton « Salle de contrôle »)."); return; }
  $("#gate").hidden = true; $("#live").hidden = false; renderLegend(); resize(); new ResizeObserver(resize).observe(cv.parentElement);
  $("#fs").addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()));
  requestAnimationFrame(draw); tick(); setInterval(tick, 1000); askSession(); setInterval(askSession, 20 * 60000);
  await init3d(); initControls();
  window.__jarvisApi = { D, sb, STATES, health, agentState, nameOf, agentById, OPENS, TASK_L, targetOf, get view() { return view3d; }, setFocus: (on) => { document.body.classList.toggle("focus", on); setTimeout(() => view3d?.resize(), 60); }, isFocus: () => document.body.classList.contains("focus"), fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()), refresh: () => cycle() };
  initJarvis(window.__jarvisApi, $("#stage3d").parentElement);
  await cycle(); setInterval(() => cycle(), /[?&]fast/.test(location.search) ? 800 : 6000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) cycle(); });
}
if (/[?&]debug/.test(location.search)) window.__live = { D, nodes: () => nodes, cycle, get view3d() { return view3d; } };
boot();
