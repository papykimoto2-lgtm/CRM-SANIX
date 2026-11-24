// SANIX AI · Salle de contrôle : vue d'affichage en direct de l'activité des agents (lecture seule).
// Données réelles uniquement (agents, missions, actions, fiches créées) lues dans Supabase avec la session du Bureau (RLS : direction). Aucune valeur inventée.
// Fenêtre ouverte depuis le Bureau (window.open) : la session est copiée puis renouvelée par le Bureau (postMessage), jamais par cette fenêtre,
// pour éviter que deux fenêtres renouvellent le même jeton.
import { SUPABASE_DEFAULT } from "./config.js";
import { initJarvis } from "./live_voice.js";
import { createProspectRelations } from "./live_relations.js";

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
const D = { agents: [], depts: [], tasks: [], tasks90: null, orderRows: null, execRows: null, execConfig: null, products: null, productAliases: null, actions: [], relationRows: [], created: {}, recent: [], todayRows: [], nToday: 0, nTotal: 0, approvals: 0, budget: null, costCenter: null, costCenter90: null, salesRows: null, offerRows: null, whatsapp: null, gov: null, sel: null, taskFilter: "all", lastId: 0, first: true, fails: 0 };
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
  const [ag, tk, ac, cr, nT, nA, rc, td, ap, bu, gv, sales, offers, costs, waStatus, waOut, waIn, waOpt, orders, tasks90, costs90, execRows, execConfig, products, productAliases] = await Promise.all([
    safe(sb.from("ai_agents").select("id,code,nom,fonction,niveau,manager_id,departement_id,etat,activite"), null),
    safe(sb.from("ai_agent_tasks").select("id,agent_id,donneur_agent_id,parent_id,prospect_id,type,titre,objectifs,statut,priorite,produit,started_at,updated_at,created_at,executions,echeance,progression,rapport").gte("updated_at", since(7)).order("updated_at", { ascending: false }).limit(600), null),
    safe(sb.from("ai_actions").select("id,action,agent_id,task_id,payload,ok,at").order("at", { ascending: false }).limit(60), null),
    safe(sb.from("ai_actions").select("task_id").eq("action", "abonnement_prospect_cree").gte("at", since(3)).limit(1500), null),
    safe(sb.from("ai_prospects").select("id", { count: "exact", head: true }).gte("created_at", day.toISOString()), null),
    safe(sb.from("ai_prospects").select("id", { count: "exact", head: true }), null),
    safe(sb.from("ai_prospects").select("id,entreprise,ville,produits_recommandes,telephone,email,source_url,created_at").order("created_at", { ascending: false }).limit(14), null),
    safe(sb.from("ai_prospects").select("telephone,email,source_url").gte("created_at", day.toISOString()).limit(500), null),
    safe(sb.from("ai_approvals").select("id", { count: "exact", head: true }).eq("statut", "en_attente"), null),
    safe(sb.rpc("ai_budget_status"), null),
    safe(sb.from("ai_governance").select("actif,communication_externe").eq("id", 1).maybeSingle(), null),
    safe(sb.from("ai_prospects").select("id,entreprise,ville,telephone,email,stage,potentiel_fcfa,score,next_action_at,opt_out,owner_id,agent_id,produits_recommandes").limit(1500), null),
    safe(sb.from("ai_offers").select("id,total_ttc,statut,created_at").order("created_at", { ascending: false }).limit(500), null),
    safe(sb.rpc("ai_cost_center", { p_days: 30 }), null),
    safe(sb.functions.invoke("crm-whatsapp", { body: { action: "status" } }), null),
    safe(sb.from("crm_wa_messages").select("id,status,kind,template,to_phone,sent_at,error", { count: "exact" }).gte("sent_at", since(7)).order("sent_at", { ascending: false }).limit(100), null),
    safe(sb.from("crm_wa_inbound").select("id,from_phone,body,kind,received_at", { count: "exact" }).gte("received_at", since(7)).order("received_at", { ascending: false }).limit(50), null),
    safe(sb.from("crm_wa_optout").select("phone", { count: "exact", head: true }), null),
    safe(sb.from("crm_records").select("rid,data,updated_at").eq("entity", "commandes").is("deleted_at", null).order("updated_at", { ascending: false }).limit(2000), null),
    safe(sb.from("ai_agent_tasks").select("id,agent_id,statut,updated_at,created_at").gte("updated_at", since(90)).order("updated_at", { ascending: false }).limit(3000), null),
    safe(sb.rpc("ai_cost_center", { p_days: 90 }), null),
    safe(sb.from("crm_records").select("rid,data,updated_at").in("entity", ["pil_depenses","pil_config"]).is("deleted_at", null).limit(1200), null),
    safe(sb.from("crm_records").select("rid,data").eq("entity", "pil_config").eq("rid", "main").is("deleted_at", null).maybeSingle(), null),
    safe(sb.from("ai_products").select("id,nom,actif").eq("actif", true).order("nom"), null),
    safe(sb.from("ai_product_aliases").select("alias,product_id"), null),
  ]);
  const relationRows = await safe(sb.from("ai_actions").select("id,action,agent_id,task_id,prospect_id,payload,ok,at").not("prospect_id", "is", null).order("at", { ascending: false }).limit(500), null);
  if (!ag?.data || !tk?.data) throw safe.err ?? new Error("Données indisponibles");
  if (!D.depts.length) { const dp = await safe(sb.from("ai_departments").select("id,nom,couleur"), null); D.depts = dp?.data ?? []; }
  D.agents = ag.data; D.tasks = tk.data; D.actions = ac?.data ?? D.actions; D.relationRows = relationRows?.data ?? D.relationRows;
  if (cr?.data) { D.created = {}; for (const r of cr.data) if (r.task_id) D.created[r.task_id] = (D.created[r.task_id] ?? 0) + 1; }
  D.nToday = nT?.count ?? D.nToday; D.nTotal = nA?.count ?? D.nTotal; D.recent = rc?.data ?? D.recent; D.todayRows = td?.data ?? D.todayRows;
  D.approvals = ap?.count ?? D.approvals; D.budget = bu?.data ?? D.budget; D.gov = gv?.data ?? D.gov;
  D.salesRows = sales?.data ?? D.salesRows; D.offerRows = offers?.data ?? D.offerRows; D.costCenter = costs?.data ?? D.costCenter;
  D.whatsapp = { status: waStatus?.data ?? null, outgoing: waOut?.data ?? null, outgoingCount: waOut?.count ?? null, incoming: waIn?.data ?? null, incomingCount: waIn?.count ?? null, optoutCount: waOpt?.count ?? null };
  if (orders?.data) D.orderRows = orders.data;
  if (tasks90?.data) D.tasks90 = tasks90.data;
  if (costs90?.data) D.costCenter90 = costs90.data;
  if (execRows?.data) D.execRows = execRows.data;
  if (execConfig?.data?.data) D.execConfig = execConfig.data.data;
  if (products?.data) D.products = products.data;
  if (productAliases?.data) D.productAliases = productAliases.data;
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
function scheduleLabel(t) {
  if (t.statut !== "a_faire" || !t.echeance) return "";
  const due = Date.parse(t.echeance);
  if (!Number.isFinite(due)) return "";
  const when = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(due);
  return due < Date.now() && Number(t.executions ?? 0) === 0 ? "Échéance dépassée · non démarrée (" + when + ")" : "Programmée · " + when;
}
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
  const tiles = [["k-run", "Agents au travail", `/ ${act.length} actifs`, "#22D3EE", run], ["k-mis", "Missions en cours", `${att} en attente · ${valid} à valider · ${blocked} bloquées (7 j)`, "#A855F7", enc], ["k-today", "Fiches créées aujourd'hui", "prospects trouvés", "#22C55E", D.nToday], ["k-tot", "Prospects en base", "tous logiciels", "#FACC15", D.nTotal], ["k-val", "À valider", "décisions du président", "#F59E0B", D.approvals]];
  if (!$("#kpis").children.length) $("#kpis").innerHTML = tiles.map(([id, l, e, c]) => `<div class="kpi" style="--c:${c}"><small>${esc(l)}</small><b id="${id}">0</b><em id="${id}-e">${esc(e)}</em></div>`).join("") + `<div class="kpi" style="--c:#22D3EE"><small>Coût IA du jour</small><b id="k-usd">–</b><em id="k-usd-e"></em></div>`;
  tiles.forEach(([id, , e, , v]) => { tween($("#" + id), v); $("#" + id + "-e").textContent = e; });
  $("#k-usd").textContent = b ? `${Number(b.jour_usd ?? 0).toFixed(2)} $` : "–";
  $("#k-usd-e").textContent = b ? `sur ${usd(b.budget_jour_usd)} · mois ${usd(b.mois_usd)}` : "";
}
function renderWorkflow() {
  const counts = {
    todo: D.tasks.filter(t => t.statut === "a_faire").length,
    running: D.tasks.filter(t => t.statut === "en_cours").length,
    coordination: D.tasks.filter(t => t.statut === "attente_sous_taches").length,
    validation: D.tasks.filter(t => t.statut === "attente_validation").length,
    blocked: D.tasks.filter(t => ["bloquee", "echouee"].includes(t.statut)).length,
    done: D.tasks.filter(t => t.statut === "terminee").length,
  };
  const active = D.agents.filter(a => !["suspendu", "archive"].includes(a.etat));
  const working = active.filter(a => agentState(a) === "run").length;
  const waiting = active.filter(a => ["wait", "valid", "queue"].includes(agentState(a))).length;
  const idle = Math.max(0, active.length - working - waiting);
  $("#agent-health").innerHTML = `<span><i class="dot run"></i>${working} au travail</span><span><i class="dot wait"></i>${waiting} en attente</span><span><i class="dot idle"></i>${idle} disponibles</span>`;
  const steps = [
    ["todo", "À traiter", counts.todo, "a_faire", "muted"],
    ["running", "Exécution", counts.running, "en_cours", "run"],
    ["coordination", "Coordination", counts.coordination, "attente_sous_taches", "wait"],
    ["validation", "Validation", counts.validation, "attente_validation", "valid"],
    ["blocked", "Blocages", counts.blocked, "blocked", "bad"],
    ["done", "Terminées", counts.done, "terminee", "done"],
  ];
  $("#workflow-steps").innerHTML = steps.map(([key,label,n,filter,state],i) => `<button type="button" class="workflow-step ${state} ${D.taskFilter === filter ? "selected" : ""}" data-workflow-filter="${filter}" aria-pressed="${D.taskFilter === filter}" aria-label="Filtrer les missions : ${label}, ${n}"><span>${label}</span><b>${n}</b>${i < steps.length-1 ? '<i class="workflow-arrow" aria-hidden="true">›</i>' : ""}</button>`).join("");
}
function renderMissions() {
  const order = { en_cours: 0, attente_sous_taches: 1, attente_validation: 2, a_faire: 3, bloquee: 4, echouee: 5, terminee: 6 };
  const all = D.tasks.filter((t) => t.statut in order && (t.statut !== "bloquee" || Date.now() - Date.parse(t.updated_at) < 24 * 3600e3));
  const open = all.filter((t) => t.statut !== "terminee");
  const counts = {
    run: open.filter((t) => t.statut === "en_cours").length,
    waiting: open.filter((t) => ["a_faire", "attente_sous_taches"].includes(t.statut)).length,
    valid: open.filter((t) => t.statut === "attente_validation").length,
    blocked: open.filter((t) => ["bloquee", "echouee"].includes(t.statut)).length,
  };
  const summary = $("#mission-summary");
  if (summary) summary.textContent = `${open.length} ouvertes · ${counts.run} en cours · ${counts.waiting} en attente · ${counts.valid} à valider · ${counts.blocked} bloquées (24 h)`;
  document.querySelectorAll("#mission-filters [data-filter]").forEach((b) => {
    const active = b.dataset.filter === D.taskFilter;
    b.classList.toggle("on", active); b.setAttribute("aria-pressed", String(active));
  });
  const matches = (t) => (D.taskFilter === "all" && t.statut !== "terminee") ||
    (D.taskFilter === "waiting" && ["a_faire", "attente_sous_taches"].includes(t.statut)) ||
    (D.taskFilter === "blocked" && ["bloquee", "echouee"].includes(t.statut)) ||
    t.statut === D.taskFilter;
  const list = all.filter(matches).sort((a, b) => order[a.statut] - order[b.statut] || a.priorite - b.priorite || Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 40);
  $("#missions").innerHTML = list.map((t) => {
    const c = TASK_C[t.statut], tg = targetOf(t), n = D.created[t.id] ?? 0, pct = tg ? Math.min(100, Math.round(100 * n / tg)) : 0;
    return `<button type="button" class="mis mission-item ${t.statut === "en_cours" ? "run" : ""}" style="--c:${c}" data-agent="${esc(t.agent_id)}" aria-label="Afficher l'agent ${esc(nameOf(t.agent_id))} et sa mission ${esc(t.titre)}">
      <b>${esc(clip(t.titre, 90))}</b><small>${esc(nameOf(t.agent_id))}</small>
      <div><span class="tag" style="--c:${c}">${esc(TASK_L[t.statut])}</span><span class="tag">P${esc(t.priorite)}</span>${t.produit ? `<span class="tag">${esc(t.produit)}</span>` : ""}${t.statut === "en_cours" && t.started_at ? `<small data-start="${esc(t.started_at)}">${dur(Date.now() - Date.parse(t.started_at))}</small>` : ""}${scheduleLabel(t) ? `<small class="schedule-note">${esc(scheduleLabel(t))}</small>` : ""}${t.statut === "a_faire" && t.echeance ? `<small>${Number(t.executions ?? 0)} exécution(s)</small>` : ""}</div>
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
function renderBusiness() {
  const el = $("#business-panel"); if (!el) return;
  if (!Array.isArray(D.salesRows)) { el.innerHTML = '<h2>Pilotage commercial</h2><p class="panel-muted">Indicateurs commerciaux indisponibles avec les autorisations actuelles.</p>'; return; }
  const closed = new Set(["perdu", "en_veille", "marche_gagne", "client_fidelise"]);
  const qualified = new Set(["qualifie", "premier_contact", "conversation", "besoin_identifie", "interesse", "rdv_propose", "rdv_confirme", "demo_realisee", "offre_transmise", "negociation", "offre_acceptee", "contrat_transmis"]);
  const rdv = new Set(["rdv_propose", "rdv_confirme", "demo_realisee"]);
  const active = D.salesRows.filter(p => !closed.has(p.stage));
  const potential = active.reduce((s,p) => s + Math.max(0, Number(p.potentiel_fcfa) || 0), 0);
  const qualifiedCount = D.salesRows.filter(p => qualified.has(p.stage)).length;
  const rdvCount = D.salesRows.filter(p => rdv.has(p.stage)).length;
  const accepted = (D.offerRows || []).filter(o => o.statut === "acceptee");
  const acceptedAmount = accepted.reduce((s,o) => s + Math.max(0, Number(o.total_ttc) || 0), 0);
  const fmt = n => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " FCFA";
  el.innerHTML = `<div class="panel-head"><h2>Pilotage commercial</h2><span class="panel-source">CRM · données réelles</span></div>
    <div class="business-grid">
      <div><b>${active.length.toLocaleString("fr-FR")}</b><small>Prospects actifs</small></div>
      <div><b>${qualifiedCount.toLocaleString("fr-FR")}</b><small>Qualifiés et avancés</small></div>
      <div><b>${rdvCount.toLocaleString("fr-FR")}</b><small>RDV / démonstrations</small></div>
      <div><b>${accepted.length.toLocaleString("fr-FR")}</b><small>Offres acceptées</small></div>
    </div>
    <div class="business-foot"><span>Potentiel déclaré du pipeline</span><b>${fmt(potential)}</b></div>
    <div class="business-foot"><span>Montant TTC des offres acceptées (500 dernières max.)</span><b>${fmt(acceptedAmount)}</b></div>
    <p class="panel-note">Le potentiel du pipeline n'est pas du chiffre d'affaires réalisé. Les offres acceptées ne valent pas preuve d'encaissement.</p>`;
}
function renderFinance() {
  const el = $("#finance-panel"); if (!el) return;
  const c = D.costCenter;
  if (!c || typeof c !== "object") { el.innerHTML = '<h2>Direction financière</h2><p class="panel-muted">Centre de coûts détaillé indisponible. Le coût journalier reste visible dans les indicateurs du haut.</p>'; return; }
  const money = v => "$" + Number(v || 0).toFixed(2);
  const month = Number(c.mois_usd || 0), forecast = Number(c.prevision_fin_mois_usd || 0), budget = Number(c.budget_mois_usd || 0);
  const pct = budget > 0 ? Math.round(month / budget * 100) : null;
  const top = (c.agents || []).slice(0, 3);
  el.innerHTML = `<div class="panel-head"><h2>Direction financière</h2><span class="panel-source">Coûts IA · 30 jours</span></div>
    <div class="finance-grid">
      <div><b>${money(month)}</b><small>Dépensé ce mois</small></div>
      <div><b>${money(forecast)}</b><small>Prévision fin de mois</small></div>
      <div><b>${budget > 0 ? money(budget) : "Non défini"}</b><small>Budget mensuel</small></div>
    </div>
    <div class="budget-line"><span style="width:${pct === null ? 0 : Math.min(100,pct)}%"></span></div>
    <div class="business-foot"><span>Consommation du budget mensuel</span><b>${pct === null ? "Budget non configuré" : pct + " %"}</b></div>
    <div class="top-costs"><small>Agents les plus coûteux</small>${top.length ? top.map(a => `<div><span>${esc(a.nom)}</span><b>${money(a.cout_usd)}</b></div>`).join("") : '<p class="panel-muted">Aucun coût agent sur la période.</p>'}</div>
    <p class="panel-note">Prévision calculée au rythme de dépense observé. Ce panneau suit les coûts IA, pas la trésorerie ni les charges comptables de l'entreprise.</p>`;
}
function renderAgentPerformance() {
  const el = $("#performance-panel");
  if (!el) return;
  const active = D.agents.filter(a => !["suspendu", "archive"].includes(a.etat));
  const costs = new Map((D.costCenter?.agents || []).map(a => [String(a.nom || "").trim().toLocaleLowerCase(), Number(a.cout_usd) || 0]));
  const stateRank = { bad: 0, run: 1, wait: 2, valid: 3, queue: 4, idle: 5, off: 6 };
  const rows = active.map(a => {
    const mine = D.tasks.filter(t => t.agent_id === a.id);
    const actions = D.actions.filter(x => x.agent_id === a.id);
    const evaluated = actions.filter(x => typeof x.ok === "boolean");
    const successes = evaluated.filter(x => x.ok === true).length;
    const latest = actions.filter(x => Number.isFinite(Date.parse(x.at))).sort((x,y) => Date.parse(y.at)-Date.parse(x.at))[0] ?? null;
    const state = agentState(a);
    return {
      agent: a, state, stateLabel: STATES[state]?.[0] ?? state,
      done: mine.filter(t => t.statut === "terminee").length,
      open: mine.filter(t => OPENS.includes(t.statut)).length,
      blocked: mine.filter(t => ["bloquee", "echouee"].includes(t.statut)).length,
      actions: actions.length, evaluated: evaluated.length, successes, latest,
      cost: costs.get(String(a.nom || "").trim().toLocaleLowerCase()) ?? null
    };
  }).sort((a,b) => (stateRank[a.state] ?? 9)-(stateRank[b.state] ?? 9) || b.blocked-a.blocked || b.open-a.open || b.done-a.done);
  const counts = Object.fromEntries(["run","wait","valid","queue","idle","bad"].map(k => [k, rows.filter(r => r.state === k).length]));
  const fmtCost = v => "$" + Number(v || 0).toFixed(2);
  const signalText = a => !a ? "aucun signal parmi les 60 derniers événements" : (a.ok === false ? "dernier événement en échec" : a.ok === true ? "dernier événement réussi" : "dernier événement sans résultat");
  el.innerHTML = `<div class="panel-head"><h2>Diagnostic des agents</h2><span class="panel-source">État · 7 jours</span></div>
    <div class="performance-summary">
      <div><b>${active.length}</b><small>Agents actifs</small></div>
      <div><b>${counts.run}</b><small>Au travail</small></div>
      <div><b>${counts.bad + counts.wait + counts.valid + counts.queue}</b><small>À examiner / en attente</small></div>
    </div>
    <div class="performance-state-summary"><span>${counts.bad} bloqué(s)</span><span>${counts.wait + counts.valid + counts.queue} en attente</span><span>${counts.idle} disponible(s)</span></div>
    <div class="performance-head"><span>Agent / état / signal</span><span>Terminées</span><span>Ouvertes</span><span>Actions*</span><span>Coût 30 j</span></div>
    <div class="performance-list">${rows.map(r => `<button type="button" class="performance-row" data-performance-agent="${esc(r.agent.id)}" aria-label="Examiner ${esc(r.agent.nom)} — ${esc(r.stateLabel)}" title="${esc(signalText(r.latest))}">
      <span class="performance-name"><b>${esc(r.agent.nom)}</b><small class="performance-state ${esc(r.state)}">${esc(r.stateLabel)} · ${esc(r.latest ? dur(Date.now() - Date.parse(r.latest.at)) : "aucun signal récent")}</small></span>
      <b class="performance-done">${r.done}</b><b>${r.open}</b>
      <span class="performance-actions">${r.evaluated ? `${r.successes}/${r.evaluated}` : `${r.actions} · n/d`}</span>
      <b class="performance-cost">${r.cost === null ? "n/d" : fmtCost(r.cost)}</b>
    </button>`).join("")}</div>
    <p class="panel-note">État déduit des statuts de missions chargées (7 jours) et de l'activité déclarée. Dernier signal : parmi les 60 événements les plus récents, pas un heartbeat réseau. * Actions évaluées uniquement si leur résultat est renseigné. Coûts : 30 jours. Les signaux orientent le contrôle humain, ils ne prouvent pas à eux seuls qu'un agent est déconnecté.</p>`;
}
function renderOperationsDirector() {
  const el = $("#ops-panel");
  if (!el) return;
  const now = Date.now(), hour = 3600e3, day = 24 * hour;
  const activeAgents = D.agents.filter(a => !["suspendu", "archive"].includes(a.etat));
  const openTasks = D.tasks.filter(t => OPENS.includes(t.statut));
  const byAgent = new Map(activeAgents.map(a => [a.id, openTasks.filter(t => t.agent_id === a.id)]));
  const overloaded = activeAgents.filter(a => (byAgent.get(a.id) || []).length >= 4)
    .sort((a,b) => byAgent.get(b.id).length - byAgent.get(a.id).length);
  const idle = activeAgents.filter(a => agentState(a) === "idle" && !(byAgent.get(a.id) || []).length);
  const stalled = D.tasks.filter(t => t.statut === "en_cours" && t.started_at &&
    Number.isFinite(Date.parse(t.started_at)) && now - Date.parse(t.started_at) > 90 * 60000);
  const blocked = D.tasks.filter(t => ["bloquee", "echouee"].includes(t.statut) &&
    Number.isFinite(Date.parse(t.updated_at)) && now - Date.parse(t.updated_at) < day);
  const repeated = D.tasks.filter(t => OPENS.includes(t.statut) && Number(t.executions) >= 3);
  const failures = new Map();
  for (const a of D.actions) {
    if (a.ok !== false || !a.agent_id || !a.action || !Number.isFinite(Date.parse(a.at)) || now - Date.parse(a.at) > day) continue;
    const key = a.agent_id + "|" + a.action;
    failures.set(key, (failures.get(key) || 0) + 1);
  }
  const repeatedFailures = [...failures.entries()].filter(([,n]) => n >= 2);
  const suggestions = [];
  for (const t of [...stalled, ...blocked].slice(0, 8)) {
    const owner = agentById(t.agent_id);
    if (!owner) continue;
    const target = idle.find(a => a.id !== owner.id && a.departement_id && a.departement_id === owner.departement_id);
    if (target) suggestions.push({ task:t, owner, target, reason: t.statut === "en_cours" ? "Mission sans évolution depuis plus de 90 min" : "Mission bloquée ou échouée sur les dernières 24 h" });
  }
  const deptRows = D.depts.map(d => {
    const members = activeAgents.filter(a => a.departement_id === d.id);
    const load = openTasks.filter(t => members.some(a => a.id === t.agent_id)).length;
    const ratio = members.length ? load / members.length : 0;
    return { d, members:members.length, load, ratio };
  }).filter(x => x.members || x.load).sort((a,b) => b.ratio-a.ratio);
  const fmtAgent = a => esc(a?.nom || "Agent non identifié");
  const alertCount = stalled.length + blocked.length + repeated.length + repeatedFailures.length + overloaded.length;
  const recs = [];
  if (stalled.length) recs.push({level:"warn",title: `${stalled.length} mission(s) sans évolution`,detail:"Vérifier les dépendances, les accès et le dernier résultat avant toute relance."});
  if (blocked.length) recs.push({level:"bad",title: `${blocked.length} blocage(s) récent(s)`,detail:"Examiner la cause et décider d'une reprise ou d'une escalade."});
  if (overloaded.length) recs.push({level:"warn",title: `${overloaded.length} agent(s) avec 4 missions ouvertes ou plus`,detail:overloaded.slice(0,3).map(a => `${a.nom} : ${byAgent.get(a.id).length}`).join(" · ")});
  if (repeated.length) recs.push({level:"warn",title: `${repeated.length} mission(s) avec au moins 3 exécutions déclarées`,detail:"Contrôler les critères de sortie et le risque de boucle avant de relancer."});
  if (repeatedFailures.length) recs.push({level:"bad",title: `${repeatedFailures.length} séquence(s) d'échecs répétitifs`,detail:"Même agent et même type d'action en échec au moins deux fois sur les événements disponibles."});
  const recommendationHtml = recs.length ? recs.slice(0,5).map(r => `<div class="ops-recommendation ${r.level}"><i></i><span><b>${esc(r.title)}</b><small>${esc(r.detail)}</small></span></div>`).join("") : '<p class="panel-muted">Aucun signal de dysfonctionnement détecté dans les données chargées.</p>';
  const transferHtml = suggestions.length ? suggestions.slice(0,4).map(s => `<div class="ops-transfer"><span><b>${esc(clip(s.task.titre,48))}</b><small>${esc(s.reason)} · ${fmtAgent(s.owner)}</small></span><span class="ops-arrow">→</span><button type="button" data-ops-agent="${esc(s.target.id)}" title="Examiner l'agent proposé">${fmtAgent(s.target)}</button></div>`).join("") : '<p class="panel-muted">Aucune réaffectation candidate fiable : il faut un agent disponible du même département.</p>';
  const childTasks = new Map();
  for (const child of D.tasks) {
    if (!child.parent_id) continue;
    const list = childTasks.get(child.parent_id) || [];
    list.push(child);
    childTasks.set(child.parent_id, list);
  }
  const taskEvents = new Map();
  for (const event of D.actions) {
    if (!event.task_id || !Number.isFinite(Date.parse(event.at))) continue;
    const prev = taskEvents.get(event.task_id);
    if (!prev || Date.parse(event.at) > Date.parse(prev.at)) taskEvents.set(event.task_id, event);
  }
  const extractSignal = value => {
    if (value == null) return "";
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      try { return extractSignal(JSON.parse(trimmed)); } catch { return trimmed.slice(0, 220); }
    }
    if (Array.isArray(value)) return value.map(extractSignal).filter(Boolean).slice(0,2).join(" · ");
    if (typeof value === "object") {
      for (const key of ["error","erreur","message","details","reason","raison","failure","cause"]) {
        if (value[key] != null) { const found = extractSignal(value[key]); if (found) return found; }
      }
      return "";
    }
    return String(value).slice(0,220);
  };
  const triageTasks = D.tasks.filter(t => {
    const age = now - Date.parse(t.updated_at);
    return ["bloquee","echouee"].includes(t.statut) ||
      (t.statut === "en_cours" && Number.isFinite(age) && age > 90 * 60000) ||
      (OPENS.includes(t.statut) && Number(t.executions) >= 3);
  }).sort((a,b) => {
    const rank = t => ["bloquee","echouee"].includes(t.statut) ? 0 : t.statut === "en_cours" ? 1 : 2;
    return rank(a)-rank(b) || Date.parse(a.updated_at)-Date.parse(b.updated_at);
  }).slice(0,8);
  const triageHtml = triageTasks.length ? triageTasks.map(t => {
    const ageMs = now - Date.parse(t.updated_at);
    const event = taskEvents.get(t.id);
    const eventError = event?.ok === false ? extractSignal(event.payload) : "";
    const reportError = extractSignal(t.rapport);
    const reason = eventError || reportError ||
      (t.statut === "attente_sous_taches" ? "En attente de sous-tâches ; vérifier les tâches enfants visibles." :
       t.statut === "en_cours" ? "Aucune progression récente observée ; vérifier l'exécution et les dépendances." :
       t.statut === "a_faire" ? "Plusieurs exécutions déclarées ; vérifier le résultat et le critère de sortie." :
       "Cause technique non renseignée dans les données chargées.");
    const children = childTasks.get(t.id) || [];
    const childOpen = children.filter(c => OPENS.includes(c.statut)).length;
    const childFailed = children.filter(c => ["bloquee","echouee"].includes(c.statut)).length;
    const dep = children.length ? `${children.length} sous-tâche(s) · ${childOpen} ouverte(s) · ${childFailed} en échec/blocage` :
      t.statut === "attente_sous_taches" ? "Sous-tâches non visibles dans la fenêtre chargée" : "Aucune dépendance enfant observée";
    const action = eventError ? "Examiner le dernier événement en erreur avant toute relance." :
      childFailed ? "Traiter d'abord la sous-tâche en échec ou bloquée." :
      childOpen ? "Vérifier l'achèvement des sous-tâches avant de reprendre le parent." :
      t.statut === "en_cours" ? "Contrôler le dernier résultat et la disponibilité de l'agent." :
      "Compléter le diagnostic de cause avant de décider d'une reprise.";
    const owner = agentById(t.agent_id);
    const severity = ["bloquee","echouee"].includes(t.statut) ? "bad" : "warn";
    return `<div class="ops-triage ${severity}">
      <div class="ops-triage-top"><b>${esc(clip(t.titre,64))}</b><span>${esc(TASK_L[t.statut] || t.statut)}</span></div>
      <small>Agent : ${esc(owner?.nom || "non attribué")} · dernière mise à jour : ${Number.isFinite(ageMs) ? esc(dur(ageMs)) : "inconnue"} · ${Number(t.executions)||0} exécution(s)</small>
      <p><b>Signal :</b> ${esc(clip(reason,190))}</p>
      <p><b>Dépendances :</b> ${esc(dep)}</p>
      <p><b>Action proposée :</b> ${esc(action)}</p>
    </div>`;
  }).join("") : '<p class="panel-muted">Aucune mission à trier dans les données chargées.</p>';
  const incidentGroups = new Map();
  const normalizeIncident = value => String(value || "action_inconnue")
    .replace(/^abonnement_/, "").replace(/[_-]+/g, " ").trim().toLocaleLowerCase();
  for (const event of D.actions) {
    if (event.ok !== false || !Number.isFinite(Date.parse(event.at))) continue;
    const age = now - Date.parse(event.at);
    if (age < 0 || age > 7 * day) continue;
    const key = normalizeIncident(event.action);
    const group = incidentGroups.get(key) || { key, count:0, agents:new Set(), tasks:new Set(), latest:null, samples:[] };
    group.count++;
    if (event.agent_id) group.agents.add(event.agent_id);
    if (event.task_id) group.tasks.add(event.task_id);
    if (!group.latest || Date.parse(event.at) > Date.parse(group.latest.at)) group.latest = event;
    if (group.samples.length < 3) group.samples.push(event);
    incidentGroups.set(key, group);
  }
  const procedures = [
    { match:/firecrawl|scrape|lecture page|url/, title:"Vérifier la lecture de la source", steps:"Contrôler l'URL canonique, l'accès HTTP, le résultat de lecture et les quotas du fournisseur. Ne créer aucune fiche si la page n'a pas été réellement lue." },
    { match:/prospect|crm|create/, title:"Vérifier la création et les doublons", steps:"Contrôler les champs obligatoires, la source consultée, la recherche de doublons et les droits d'écriture. Vérifier si l'enregistrement existe déjà avant toute nouvelle tentative." },
    { match:/supabase|database|query|sql/, title:"Vérifier l'accès aux données", steps:"Contrôler la session, les droits RLS, la disponibilité de Supabase et le message d'erreur exact. Ne pas élargir les permissions pour contourner l'erreur." },
    { match:/anthropic|claude|llm|model|token/, title:"Vérifier le fournisseur IA", steps:"Contrôler la clé, le solde/crédit, les limites de débit, le modèle demandé et la taille de la requête. Ne pas répéter en boucle une requête refusée." },
    { match:/whatsapp|message|webhook/, title:"Vérifier le canal de communication", steps:"Contrôler l'état du webhook, le numéro, le modèle de message, le consentement et le statut Meta. Aucun message externe ne doit être renvoyé sans validation." }
  ];
  const incidentRows = [...incidentGroups.values()].sort((a,b) => b.count-a.count || Date.parse(b.latest.at)-Date.parse(a.latest.at)).slice(0,6);
  const incidentHtml = incidentRows.length ? incidentRows.map(g => {
    const procedure = procedures.find(p => p.match.test(g.key)) || {
      title:"Examiner le journal technique",
      steps:"Ouvrir le payload de l'événement, identifier le code et le message d'erreur, vérifier les prérequis de l'action et reproduire en environnement sûr avant toute correction."
    };
    const when = dur(Math.max(0, now - Date.parse(g.latest.at)));
    const agentNames = [...g.agents].map(id => agentById(id)?.nom || "Agent inconnu").slice(0,3);
    return `<details class="ops-incident">
      <summary><span><b>${esc(g.key)}</b><small>${g.count} échec(s) · ${g.agents.size} agent(s) · ${g.tasks.size} mission(s)</small></span><em>${esc(when)}</em></summary>
      <p><b>Procédure :</b> ${esc(procedure.title)}</p>
      <p>${esc(procedure.steps)}</p>
      <small>Agents concernés : ${esc(agentNames.join(", ") || "non identifiés")} · Dernier événement : ${esc(g.latest.at)}</small>
      <button type="button" class="ops-approve-request" data-incident-approval="1" data-incident-key="${esc(g.key)}" data-incident-recommendation="${esc(procedure.steps)}" data-incident-task="${esc(g.latest.task_id || "")}" data-incident-agent="${esc(g.latest.agent_id || "")}">Soumettre cette correction à validation</button>
    </details>`;
  }).join("") : '<p class="panel-muted">Aucun échec enregistré sur les événements disponibles des 7 derniers jours.</p>';
  const deptHtml = deptRows.length ? deptRows.slice(0,5).map(x => `<div class="ops-dept"><span><b>${esc(x.d.nom)}</b><small>${x.members} agent(s)</small></span><span><b>${x.load}</b><small>missions ouvertes</small></span><span class="${x.ratio >= 4 ? "ops-hot" : x.ratio >= 2 ? "ops-warn" : ""}"><b>${x.ratio.toFixed(1)}</b><small>missions / agent</small></span></div>`).join("") : '<p class="panel-muted">Répartition par département indisponible.</p>';
  el.innerHTML = `<div class="panel-head"><h2>Directeur opérationnel</h2><span class="panel-source">Analyse · lecture seule</span></div>
    <div class="ops-summary"><div><b>${alertCount}</b><small>Signaux à examiner</small></div><div><b>${overloaded.length}</b><small>Agents surchargés</small></div><div><b>${suggestions.length}</b><small>Réaffectations candidates</small></div></div>
    <div class="ops-section"><h3>Recommandations de pilotage</h3>${recommendationHtml}</div>
    <div class="ops-section"><h3>Réaffectations à examiner</h3>${transferHtml}</div>
    <div class="ops-section"><h3>Charge par département</h3>${deptHtml}</div>
    <div class="ops-section"><h3>Diagnostic des missions prioritaires</h3><span class="panel-source">Cause observée · dépendances · action proposée</span>${triageHtml}</div>
    <div class="ops-section"><h3>Centre de résolution des incidents</h3><span class="panel-source">Regroupement des erreurs · procédures proposées · 7 jours</span>${incidentHtml}</div>
    <p class="panel-note">Analyse des missions actualisées sur 7 jours (maximum 600), des 60 derniers événements et des agents actifs. Les incidents sont regroupés par type d'action sur les 7 derniers jours à partir des événements chargés ; ils ne représentent pas nécessairement tous les incidents du système. Seuils d'alerte indicatifs, non assimilables à une évaluation RH. Les réaffectations et actions de triage sont des recommandations : aucune mission n'est modifiée. Les causes ne sont affichées que si elles existent dans les rapports ou événements chargés. La rentabilité par département n'est pas calculable sans données fiables de revenus et de coûts analytiques rapprochées.</p>`;
}
function renderBusinessIntelligence() {
  const el = $("#bi-panel");
  if (!el) return;
  const money = n => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0)) + " FCFA";
  const usd = n => "$" + Number(n || 0).toFixed(2);
  const now = new Date(), dayMs = 864e5;
  const dateOnly = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? new Date(v + "T00:00:00Z") : null;
  const validOrders = (D.orderRows || []).map(r => ({...r, d:r.data || {}})).filter(r =>
    ["confirmee","en_cours","livree"].includes(r.d.statut) && r.d.renouvellement !== true && r.d.renouvellement !== "true" && dateOnly(r.d.date));
  const ht = d => Number(d.htNet) > 0 ? Number(d.htNet) : Number(d.ttc) > 0 ? Math.round(Number(d.ttc) / 1.18) : 0;
  const start30 = new Date(now.getTime() - 30 * dayMs), start90 = new Date(now.getTime() - 90 * dayMs), start60 = new Date(now.getTime() - 60 * dayMs);
  const orders30 = validOrders.filter(r => dateOnly(r.d.date) >= start30);
  const orders90 = validOrders.filter(r => dateOnly(r.d.date) >= start90);
  const signed30 = orders30.reduce((s,r) => s + ht(r.d), 0), signed90 = orders90.reduce((s,r) => s + ht(r.d), 0);
  const ai30 = orders30.filter(r => String(r.d.source || "").toLowerCase() === "ia").reduce((s,r) => s + ht(r.d), 0);
  const cash30 = validOrders.reduce((s,r) => {
    const ratio = Number(r.d.ttc) > 0 ? ht(r.d) / Number(r.d.ttc) : 1;
    return s + (Array.isArray(r.d.paiements) ? r.d.paiements : []).filter(p => p && p.supprime !== true && p.supprime !== "true" && dateOnly(p.date) >= start30)
      .reduce((t,p) => t + Math.max(0, Number(p.montant) || 0) * ratio, 0);
  }, 0);
  const prev30 = validOrders.filter(r => { const d=dateOnly(r.d.date); return d >= start60 && d < start30; }).reduce((s,r) => s + ht(r.d), 0);
  const growth = prev30 > 0 ? Math.round((signed30 - prev30) / prev30 * 100) : null;
  const prospects = D.salesRows || [];
  const weights = { contrat_transmis:.85, offre_acceptee:.8, negociation:.6, offre_transmise:.4, demo_realisee:.3, rdv_confirme:.2, interesse:.15 };
  const pipeline = prospects.filter(p => Object.hasOwn(weights,p.stage)).reduce((s,p) => s + Math.max(0,Number(p.potentiel_fcfa)||0) * weights[p.stage],0);
  const costs30 = Number(D.costCenter?.periode_usd ?? D.costCenter?.mois_usd ?? 0);
  const costs90 = Number(D.costCenter90?.periode_usd ?? 0);
  const tasks = D.tasks90 || [];
  const completed30 = tasks.filter(t => t.statut === "terminee" && Date.parse(t.updated_at) >= start30.getTime()).length;
  const completedPrev30 = tasks.filter(t => t.statut === "terminee" && Date.parse(t.updated_at) >= start60.getTime() && Date.parse(t.updated_at) < start30.getTime()).length;
  const completed90 = tasks.filter(t => t.statut === "terminee").length;
  const productivityDelta = completedPrev30 > 0 ? Math.round((completed30-completedPrev30)/completedPrev30*100) : null;
  const costByAgent = new Map((D.costCenter?.agents || []).map(a => [a.agent_id, Number(a.cout_usd)||0]));
  const byAgent = D.agents.map(a => ({
    a,
    done: tasks.filter(t => t.agent_id === a.id && t.statut === "terminee" && Date.parse(t.updated_at) >= start30.getTime()).length,
    cost: costByAgent.get(a.id) ?? null
  })).filter(x => x.done || x.cost !== null).sort((a,b) => b.done-a.done).slice(0,6);
  const fmtDelta = n => n === null ? "n/d" : (n > 0 ? "+" : "") + n + " %";
  const bars = [0,1,2].map(i => {
    const from = new Date(now.getFullYear(),now.getMonth()-2+i,1);
    const to = new Date(now.getFullYear(),now.getMonth()-1+i,1);
    const value = validOrders.filter(r => dateOnly(r.d.date) >= from && dateOnly(r.d.date) < to).reduce((s,r)=>s+ht(r.d),0);
    return { label:from.toLocaleDateString("fr-FR",{month:"short"}),value };
  });
  const maxBar = Math.max(1,...bars.map(x=>x.value));
  const revenueRows = D.orderRows === null ? '<p class="panel-muted">Commandes CRM non accessibles avec la session actuelle. Vérifier les droits RLS sur crm_records.</p>' :
    !validOrders.length ? '<p class="panel-muted">Aucune commande confirmée, en cours ou livrée avec une date exploitable sur les lignes chargées.</p>' : "";
  el.innerHTML = `<div class="panel-head"><h2>Business Intelligence Center</h2><span class="panel-source">CRM + IA · données réelles</span></div>
    <div class="bi-grid">
      <div><b>${D.orderRows === null ? "n/d" : money(signed30)}</b><small>CA signé HT · 30 jours</small></div>
      <div><b>${D.orderRows === null ? "n/d" : money(cash30)}</b><small>Encaissements HT datés · 30 j</small></div>
      <div><b>${usd(costs30)}</b><small>Coût IA · 30 jours</small></div>
      <div><b>${D.orderRows === null ? "n/d" : money(ai30)}</b><small>Commandes attribuées à l'IA · 30 j</small></div>
    </div>
    <div class="bi-section"><h3>Évolution commerciale</h3>
      <div class="bi-bars">${bars.map(b=>`<div class="bi-bar-wrap"><div class="bi-bar-value">${b.value ? money(b.value) : "—"}</div><div class="bi-bar" style="height:${Math.max(3,Math.round(b.value/maxBar*62))}px"></div><small>${esc(b.label)}</small></div>`).join("")}</div>
      <div class="bi-facts"><span>CA signé HT · 90 jours</span><b>${D.orderRows === null ? "n/d" : money(signed90)}</b></div>
      <div class="bi-facts"><span>Évolution vs 30 jours précédents</span><b>${fmtDelta(growth)}</b></div>
      <div class="bi-facts"><span>Pipeline pondéré indicatif</span><b>${money(pipeline)}</b></div>
    </div>
    <div class="bi-section"><h3>Productivité et consommation IA</h3>
      <div class="bi-facts"><span>Missions terminées · 30 jours</span><b>${D.tasks90 === null ? "n/d" : completed30}</b></div>
      <div class="bi-facts"><span>Évolution vs 30 jours précédents</span><b>${fmtDelta(productivityDelta)}</b></div>
      <div class="bi-facts"><span>Missions terminées · 90 jours</span><b>${D.tasks90 === null ? "n/d" : completed90}</b></div>
      <div class="bi-facts"><span>Coût IA · 90 jours</span><b>${D.costCenter90 ? usd(costs90) : "n/d"}</b></div>
      ${byAgent.length ? `<div class="bi-agent-head"><span>Agent</span><span>Terminées · 30 j</span><span>Coût IA · 30 j</span></div>${byAgent.map(x=>`<div class="bi-agent"><b>${esc(x.a.nom)}</b><span>${x.done}</span><span>${x.cost===null?"n/d":usd(x.cost)}</span></div>`).join("")}` : '<p class="panel-muted">Données individuelles insuffisantes.</p>'}
    </div>
    ${revenueRows}
    <p class="panel-note">CA signé : commandes CRM confirmées, en cours ou livrées, hors renouvellements, ramenées en HT selon la règle du connecteur. Encaissements : paiements datés des 30 derniers jours, hors suppressions ; les anciens acomptes sans détail de paiement daté ne sont pas ventilés dans cette période. Commandes IA : champ source = « IA ». Pipeline pondéré : estimation, pas du CA. Coûts IA en USD, ventes en FCFA : aucun ROI ni bénéfice n'est calculé sans taux de change, coûts complets et attribution fiable. Les historiques sont limités aux 2 000 commandes et 3 000 missions les plus récentes chargées.</p>`;
}
function renderPredictiveDirector() {
  const el = $("#forecast-panel");
  if (!el) return;
  const now = new Date(), startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysElapsed = Math.max(1, Math.ceil((now - startMonth) / 864e5) + 1);
  const daysMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const prospects = (D.salesRows || []).filter(p => !p.opt_out && p.stage !== "perdu" && p.stage !== "en_veille");
  const overdue = prospects.filter(p => p.next_action_at && Date.parse(p.next_action_at) < now.getTime() &&
    !["contrat_signe","paiement_confirme","marche_gagne","client_fidelise"].includes(p.stage));
  const critical = overdue.filter(p => Date.now() - Date.parse(p.next_action_at) > 7*864e5);
  const highPotential = prospects.filter(p => Number(p.score) >= 70 && Number(p.potentiel_fcfa)>0);
  const pendingDecision = prospects.filter(p => ["offre_acceptee","contrat_transmis","paiement_attendu"].includes(p.stage));
  const weighted = prospects.reduce((s,p) => {
    const w = {identifie:.03,enregistre:.05,qualifie:.1,premier_contact:.12,conversation:.18,besoin_identifie:.25,interesse:.3,rdv_propose:.35,rdv_confirme:.4,demo_realisee:.45,offre_transmise:.55,negociation:.65,offre_acceptee:.8,contrat_transmis:.9,paiement_attendu:.95};
    return s + Math.max(0,Number(p.potentiel_fcfa)||0)*(w[p.stage]||0);
  },0);
  const orders = (D.orderRows || []).map(r=>r.data||{}).filter(d=>["confirmee","en_cours","livree"].includes(d.statut) && d.renouvellement!==true && d.renouvellement!=="true" && /^\d{4}-\d{2}-\d{2}$/.test(String(d.date||"")));
  const ht = d => Number(d.htNet)>0?Number(d.htNet):Number(d.ttc)>0?Math.round(Number(d.ttc)/1.18):0;
  const monthOrders=orders.filter(d=>new Date(d.date+"T00:00:00Z")>=startMonth);
  const mtd=monthOrders.reduce((s,d)=>s+ht(d),0);
  const monthForecast=daysElapsed>0?mtd/daysElapsed*daysMonth:0;
  const previousMonthStart=new Date(now.getFullYear(),now.getMonth()-1,1), previousMonthEnd=startMonth;
  const previousMonth=orders.filter(d=>{const x=new Date(d.date+"T00:00:00Z");return x>=previousMonthStart&&x<previousMonthEnd;}).reduce((s,d)=>s+ht(d),0);
  const budgetForecast=Number(D.costCenter?.prevision_fin_mois_usd);
  const budgetLimit=Number(D.budget?.budget_mois_usd);
  const alerts=[];
  if(critical.length)alerts.push({type:"bad",title:critical.length+" relance(s) en retard de plus de 7 jours",detail:"Prioriser ces dossiers et vérifier leur statut avant toute nouvelle prise de contact."});
  else if(overdue.length)alerts.push({type:"warn",title:overdue.length+" prochaine(s) action(s) échue(s)",detail:"Planifier ou actualiser les échéances commerciales."});
  if(pendingDecision.length)alerts.push({type:"warn",title:pendingDecision.length+" dossier(s) proches d'une décision",detail:"Vérifier les offres, contrats transmis et paiements attendus."});
  if(highPotential.length)alerts.push({type:"info",title:highPotential.length+" prospect(s) qualifiés à fort potentiel",detail:"Score de qualification ≥ 70/100 ; confirmer le besoin, le budget et le calendrier."});
  if(Number.isFinite(budgetForecast)&&budgetLimit>0&&budgetForecast>budgetLimit)alerts.push({type:"bad",title:"Dépassement mensuel IA prévisionnel",detail:"Projection "+budgetForecast.toFixed(2)+" $ pour un plafond de "+budgetLimit.toFixed(2)+" $."});
  const alertHtml=alerts.length?alerts.map(a=>`<div class="forecast-alert ${a.type}"><i></i><span><b>${esc(a.title)}</b><small>${esc(a.detail)}</small></span></div>`).join(""):'<p class="panel-muted">Aucune alerte prédictive sur les données actuellement accessibles.</p>';
  const fmt=n=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(Math.round(n||0))+" FCFA";
  const delta=previousMonth>0?Math.round((mtd-previousMonth*(daysElapsed/daysMonth))/(previousMonth*(daysElapsed/daysMonth))*100):null;
  el.innerHTML=`<div class="panel-head"><h2>Directeur prédictif · V12</h2><span class="panel-source">Prévisions & alertes · lecture seule</span></div>
    <div class="forecast-grid">
      <div><b>${D.orderRows===null?"n/d":fmt(monthForecast)}</b><small>CA mensuel projeté · rythme actuel</small></div>
      <div><b>${D.orderRows===null?"n/d":fmt(mtd)}</b><small>CA signé HT · mois en cours</small></div>
      <div><b>${fmt(weighted)}</b><small>Pipeline pondéré indicatif</small></div>
      <div><b>${overdue.length}</b><small>Actions commerciales échues</small></div>
    </div>
    <div class="forecast-section"><h3>Alertes et décisions à anticiper</h3>${alertHtml}</div>
    <div class="forecast-facts"><span>CA du mois précédent</span><b>${D.orderRows===null?"n/d":fmt(previousMonth)}</b></div>
    <div class="forecast-facts"><span>Avancement du mois</span><b>${daysElapsed} / ${daysMonth} jours</b></div>
    <div class="forecast-facts"><span>Prévision coûts IA fin de mois</span><b>${Number.isFinite(budgetForecast)?"$"+budgetForecast.toFixed(2):"n/d"}</b></div>
    <div class="forecast-facts"><span>Plafond IA mensuel</span><b>${budgetLimit>0?"$"+budgetLimit.toFixed(2):"n/d"}</b></div>
    <p class="panel-note">La projection de CA prolonge le rythme moyen du mois en cours ; elle n'est ni un engagement ni une prédiction statistique. Le pipeline pondéré est une estimation par étape, distincte du CA signé. Les alertes reposent sur les échéances saisies et les données chargées. Aucun objectif mensuel n'est inventé : il n'est pas configuré dans la source actuelle. Les alertes ne déclenchent aucun message ni changement automatique.</p>`;
}
function renderExecutiveCommandCenter() {
  const el = $("#executive-panel"); if (!el) return;
  const money = n => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0)) + " FCFA";
  const now = new Date(), month = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0");
  const dateOnly = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? new Date(v + "T00:00:00Z") : null;
  const orders = (D.orderRows || []).map(r => r.data || {}).filter(d =>
    ["confirmee","en_cours","livree"].includes(d.statut) && d.renouvellement !== true && d.renouvellement !== "true" && dateOnly(d.date) && String(d.date).slice(0,7) === month);
  const ht = d => Number(d.htNet) > 0 ? Number(d.htNet) : Number(d.ttc) > 0 ? Math.round(Number(d.ttc)/1.18) : 0;
  const ca = orders.reduce((s,d)=>s+ht(d),0);
  const cfg = D.execConfig || {};
  const goalRaw = cfg["obj_"+month], goal = goalRaw === null || goalRaw === undefined || goalRaw === "" ? null : Number(goalRaw);
  const expenses = (D.execRows || []).filter(r => r.data && /^\d{4}-\d{2}$/.test(String(r.data.mois||"")) && r.data.mois === month && r.data.libelle);
  const expenseActual = expenses.reduce((s,r)=>s+Math.max(0,Number(r.data.reel)||0),0);
  const expenseRetained = expenses.reduce((s,r)=>s+(Number(r.data.reel)>0?Number(r.data.reel):Math.max(0,Number(r.data.prevu)||0)),0);
  const attainment = goal > 0 ? Math.round(ca/goal*100) : null;
  const elapsed = Math.max(1,now.getDate()), days = new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const pace = goal > 0 ? Math.round(ca/goal*100*days/elapsed) : null;
  const normalize = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g," ");
  const aliases = new Map((D.productAliases||[]).map(a=>[normalize(a.alias),a.product_id]));
  const products = D.products || [];
  const productName = new Map(products.map(p=>[p.id,p.nom]));
  const productCA = new Map();
  for (const d of orders) {
    const label = normalize(d.logiciel), pid = products.find(p=>normalize(p.id)===label||normalize(p.nom)===label)?.id || aliases.get(label) || null;
    const key = pid || "hors_perimetre";
    productCA.set(key,(productCA.get(key)||0)+ht(d));
  }
  const productRows = [...productCA.entries()].sort((a,b)=>b[1]-a[1]);
  const missing = D.orderRows === null || D.execRows === null || D.execConfig === null || D.products === null;
  const fmtPct = n => n === null ? "n/d" : n.toLocaleString("fr-FR")+" %";
  const alerts = [];
  if (goal === null || !(goal>0)) alerts.push("Objectif de chiffre d’affaires non renseigné pour ce mois.");
  else if (attainment !== null && attainment < Math.round(elapsed/days*100)) alerts.push("Le rythme de CA est inférieur à la progression calendaire de l’objectif.");
  if (D.execRows !== null && !expenses.length) alerts.push("Aucune dépense de gestion saisie pour le mois.");
  if (productRows.some(([id])=>id==="hors_perimetre")) alerts.push("Certaines commandes ne sont pas encore rattachées à un logiciel du catalogue.");
  const report = "RAPPORT DE DIRECTION SANIX — "+month+"\nCA signé HT : "+money(ca)+"\nObjectif : "+(goal>0?money(goal):"non défini")+"\nAtteinte : "+fmtPct(attainment)+"\nDépenses réelles saisies : "+(D.execRows===null?"indisponibles":money(expenseActual))+"\nDépenses retenues (réel sinon prévu) : "+(D.execRows===null?"indisponibles":money(expenseRetained))+"\nSolde après dépenses suivies (indicateur simplifié, pas un bénéfice) : "+(D.execRows===null?"non calculé":money(ca-expenseRetained));
  el.innerHTML = `<div class="panel-head"><h2>Executive Command Center · V13</h2><span class="panel-source">Pilotage global · lecture seule</span></div>
    <div class="executive-grid">
      <div><b>${D.orderRows===null?"n/d":money(ca)}</b><small>CA signé HT · mois en cours</small></div>
      <div><b>${goal===null?"Non défini":money(goal)}</b><small>Objectif mensuel paramétré</small></div>
      <div><b>${fmtPct(attainment)}</b><small>Atteinte de l’objectif</small></div>
      <div><b>${D.execRows===null?"n/d":money(expenseActual)}</b><small>Dépenses réelles saisies</small></div>
      <div><b>${D.execRows===null?"n/d":money(expenseRetained)}</b><small>Dépenses retenues · réel sinon prévu</small></div>
      <div><b>${D.execRows===null?"n/d":money(ca-expenseRetained)}</b><small>Solde après dépenses suivies · indicatif</small></div>
    </div>
    <div class="executive-section"><h3>Performance par logiciel · CA HT</h3>
      ${productRows.length ? productRows.slice(0,8).map(([id,value])=>`<div class="executive-product"><span>${esc(id==="hors_perimetre"?"Hors périmètre":productName.get(id)||id)}</span><b>${money(value)}</b></div>`).join("") : '<p class="panel-muted">Aucune vente exploitable sur le mois.</p>'}
    </div>
    <div class="executive-section"><h3>Rapport quotidien de direction</h3>
      <p class="panel-note">${esc("Au "+now.toLocaleDateString("fr-FR")+", le CA signé HT du mois atteint "+money(ca)+". "+(goal>0?"L’objectif est atteint à "+fmtPct(attainment)+".":"Aucun objectif mensuel n’est paramétré.")+" Les dépenses suivies totalisent "+(D.execRows===null?"un montant indisponible":money(expenseRetained))+".")}</p>
      <div class="executive-facts"><span>Rythme projeté d’atteinte de l’objectif</span><b>${fmtPct(pace)}</b></div>
      <div class="executive-facts"><span>Commandes prises en compte</span><b>${D.orderRows===null?"n/d":orders.length}</b></div>
      <div class="executive-alerts">${alerts.length?alerts.map(a=>`<div class="executive-alert"><i></i><span>${esc(a)}</span></div>`).join(""):'<p class="panel-muted">Aucun écart de gestion détecté sur les données accessibles.</p>'}</div>
    </div>
    <p class="panel-note">Le solde affiché est le CA HT moins les seules dépenses enregistrées dans le module Budget & actions ; ce n’est ni un bénéfice net ni une marge comptable. Les dépenses ne sont pas ventilées par logiciel : la rentabilité par produit reste indisponible. Les coûts IA restent suivis séparément en USD. ${missing?"Certaines sources de données sont indisponibles avec la session actuelle.":""}</p>
    <button type="button" class="executive-copy" data-executive-copy>Copier le rapport de direction</button>`;
  const copy = el.querySelector("[data-executive-copy]");
  if (copy) copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(report); copy.textContent="Rapport copié"; }
    catch { copy.textContent="Copie non autorisée par le navigateur"; }
  }, { once:true });
}
function renderWhatsApp() {
  const el = $("#whatsapp-panel"); if (!el) return;
  const w = D.whatsapp;
  if (!w) { el.innerHTML = '<h2>WhatsApp Business</h2><p class="panel-muted">État WhatsApp indisponible avec les autorisations actuelles.</p>'; return; }
  const st = w.status || {}, rows = Array.isArray(w.outgoing) ? w.outgoing : [], inbound = Array.isArray(w.incoming) ? w.incoming : [];
  const n = (status) => rows.filter(m => m.status === status).length;
  const configured = st.configure === true, webhookSecrets = st.webhook === true;
  const missing = Array.isArray(st.manquants) ? st.manquants : [];
  const masked = (phone) => { const p = String(phone || "").replace(/\D/g, ""); return p.length > 4 ? "•••• " + p.slice(-4) : "numéro masqué"; };
  const statusText = configured ? "API configurée" : "Configuration incomplète";
  const statusClass = configured ? "wa-ok" : "wa-warn";
  const recent = inbound.slice(0, 3);
  el.innerHTML = `<div class="panel-head"><h2>WhatsApp Business</h2><span class="panel-source">Meta Cloud API</span></div>
    <div class="wa-status ${statusClass}"><i></i><b>${statusText}</b><span>${webhookSecrets ? "Secrets webhook présents" : "Secrets webhook manquants"}</span></div>
    ${!configured ? `<p class="panel-note">À configurer côté Supabase : ${esc(missing.join(", ") || "secrets d'API non vérifiés")}.</p>` : ""}
    <div class="wa-grid">
      <div><b>${w.outgoingCount === null ? "—" : Number(w.outgoingCount).toLocaleString("fr-FR")}</b><small>Messages sortants · 7 j</small></div>
      <div><b>${w.incomingCount === null ? "—" : Number(w.incomingCount).toLocaleString("fr-FR")}</b><small>Réponses reçues · 7 j</small></div>
      <div><b>${n("remis") + n("lu")}</b><small>Remis / lus parmi les 100 derniers</small></div>
      <div><b>${n("echec")}</b><small>Échecs parmi les 100 derniers</small></div>
    </div>
    <div class="business-foot"><span>Désinscriptions enregistrées</span><b>${w.optoutCount === null ? "—" : Number(w.optoutCount).toLocaleString("fr-FR")}</b></div>
    <div class="wa-recent"><small>Dernières réponses reçues</small>
      ${recent.length ? recent.map(m => `<div><span>${esc(masked(m.from_phone))} · ${ago(m.received_at)}</span><b>${esc(clip(m.body || "[" + (m.kind || "message") + "]", 54))}</b></div>`).join("") : '<p class="panel-muted">Aucune réponse enregistrée sur les 7 derniers jours.</p>'}
    </div>
    <p class="panel-note">Vue de supervision en lecture seule. Le statut « secrets webhook présents » ne prouve pas à lui seul que l'abonnement Meta au webhook est actif. Les volumes sortants couvrent les 7 derniers jours ; les statuts sont calculés sur les 100 derniers messages.</p>`;
}
function renderAlerts() {
  const now = Date.now(), day = 24 * 3600e3;
  const items = [];
  for (const t of D.tasks) {
    if (t.statut === "a_faire" && t.echeance && Date.parse(t.echeance) < now && Number(t.executions ?? 0) === 0) {
      items.push({ level: "warn", title: "Mission programmée non démarrée", detail: t.titre + " · échéance dépassée", agent: t.agent_id, at: Date.parse(t.echeance) || 0 });
    }
    if (["bloquee", "echouee"].includes(t.statut) && now - Date.parse(t.updated_at) < day) {
      items.push({ level: "bad", title: t.statut === "echouee" ? "Mission échouée" : "Mission bloquée", detail: t.titre, agent: t.agent_id, at: Date.parse(t.updated_at) || 0 });
    } else if (t.statut === "en_cours" && t.started_at && now - Date.parse(t.started_at) > 90 * 60000) {
      items.push({ level: "warn", title: "Mission sans évolution détectée", detail: t.titre, agent: t.agent_id, at: Date.parse(t.started_at) || 0 });
    }
  }
  for (const a of D.actions) {
    if (a.ok === false && now - Date.parse(a.at) < day) {
      items.push({ level: "bad", title: "Action en erreur", detail: String(a.action || "Action inconnue").replace(/^abonnement_/, "").replace(/_/g, " "), agent: a.agent_id, at: Date.parse(a.at) || 0 });
    }
  }
  const b = D.budget, budgetPct = b && Number(b.budget_jour_usd) > 0 ? 100 * Number(b.jour_usd ?? 0) / Number(b.budget_jour_usd) : null;
  if (budgetPct !== null && budgetPct >= 90) items.push({ level: "warn", title: "Budget IA proche de sa limite", detail: `${Math.round(budgetPct)} % du budget journalier consommé`, at: now });
  items.sort((a, b) => (a.level === b.level ? b.at - a.at : a.level === "bad" ? -1 : 1));
  const shown = items.slice(0, 6), count = items.length;
  const el = $("#alerts");
  el.innerHTML = `<div class="alerts-head"><h2>Points à surveiller</h2><span class="alerts-count ${count ? "has-alert" : ""}">${count} ${count > 1 ? "alertes" : "alerte"}</span></div>` +
    (shown.length ? shown.map((a) => `<button type="button" class="alert-item ${a.level}" ${a.agent ? `data-alert-agent="${esc(a.agent)}"` : ""}><i></i><span><b>${esc(a.title)}</b><small>${esc(a.detail)}${a.agent ? " · " + esc(nameOf(a.agent)) : ""}</small></span></button>`).join("") : `<p class="alerts-clear">Aucun incident détecté sur les données disponibles.</p>`);
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
  $("#health").title = "Indice 0-100 : réussite des missions actualisées sur 7 jours (40 %), absence de missions figées > 90 min (25 %), blocages actualisés sur 24 h (15 %), qualité des fiches créées aujourd’hui (20 %). Les composantes sans données suffisantes sont exclues du calcul.";
}
function renderTicker() {
  if (!D.recent.length) return;
  const one = D.recent.map((p) => `<span class="f">🆕 <em>${esc(clip(p.entreprise, 44))}</em> ${p.ville ? "· " + esc(p.ville) : ""} <small>${esc((p.produits_recommandes ?? [])[0] ?? "")} · ${ago(p.created_at)}</small></span>`).join("");
  const tr = $("#ticker"); if (tr.dataset.k !== one) { tr.dataset.k = one; tr.innerHTML = one + one; }
}
function renderLegend() { $("#legend").innerHTML = Object.entries(STATES).map(([, [l, c]]) => `<span><i style="background:${c};box-shadow:0 0 8px ${c}"></i>${l}</span>`).join(""); }
function renderDetail() {
  const el = $("#detail"), a = agentById(D.sel);
  if (D.relationSel) {
    const r = D.relationSel, p = r.prospect, ag = r.agent;
    const acts = D.relationRows.filter(x => String(x.agent_id) === String(ag.id) && String(x.prospect_id) === String(p.id));
    const tasks = D.tasks.filter(x => String(x.agent_id) === String(ag.id) && String(x.prospect_id) === String(p.id));
    const latest = acts[0], status = r.kind === "activity" ? "Interaction réelle" : r.kind === "mission" ? "Mission affectée" : "Affectation commerciale";
    el.hidden = false;
    el.innerHTML = `<h2>Relation sélectionnée <span class="tag">${esc(status)}</span></h2>
      <div class="mis"><b>${esc(ag.nom || "Agent")}</b><small>Agent commercial</small></div>
      <div class="muted" style="text-align:center;padding:4px">↕ relation avec</div>
      <div class="mis"><b>${esc(p.entreprise || "Prospect")}</b><small>${esc(p.ville || "Localisation non renseignée")} · ${esc(p.stage || "nouveau")}</small></div>
      <div class="muted" style="font-size:11px;margin-top:7px">${acts.length} interaction(s) · ${tasks.length} mission(s) · Score ${Number.isFinite(Number(p.score)) ? esc(p.score) : "n/d"} · Potentiel ${Number(p.potentiel_fcfa)>0 ? new Intl.NumberFormat("fr-FR").format(Number(p.potentiel_fcfa))+" FCFA" : "non renseigné"}</div>
      ${latest ? `<div class="muted" style="font-size:11px;margin-top:5px">Dernière interaction : ${esc(latest.action || "événement")} · ${esc(ago(latest.at))}</div>` : ""}
      ${tasks.length ? `<div class="muted" style="font-size:11px;margin-top:5px">Missions : ${tasks.slice(0,3).map(t=>esc(t.titre)+" ("+esc(TASK_L[t.statut]||t.statut)+")").join(" · ")}</div>` : ""}
      <button type="button" class="btn" id="relation-jarvis" style="margin-top:8px;width:100%">Faire analyser par Jarvis</button>`;
    $("#relation-jarvis")?.addEventListener("click",()=>window.__jarvis?.explainRelation?.(r));
    return;
  }
  if (D.prospectSel) {
    const p = D.prospectSel, prospectTasks = D.tasks.filter((t) => String(t.prospect_id || "") === String(p.id)).sort((a,b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
    const assigned = agentById(p.agent_id) || agentById(prospectTasks[0]?.agent_id);
    const history = D.relationRows.filter((r) => String(r.prospect_id) === String(p.id)).slice(0, 8);
    const tasks = prospectTasks.slice(0, 5);
    const products = Array.isArray(p.produits_recommandes) ? p.produits_recommandes : (p.produits_recommandes ? [p.produits_recommandes] : []);
    const contact = p.telephone ? `<a href="tel:${esc(p.telephone)}">Appeler ${esc(p.telephone)}</a>` : "";
    const email = p.email ? `<a href="mailto:${esc(p.email)}">Écrire par e-mail</a>` : "";
    const next = p.next_action_at ? new Date(p.next_action_at).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }) : "Aucune relance programmée";
    const activityRows = history.length ? history.map((r) => {
      const payload = r.payload && typeof r.payload === "object" ? (r.payload.message || r.payload.resultat || r.payload.reason || r.payload.status || "") : "";
      const summary = payload ? String(payload).slice(0, 150) : (r.ok === false ? "Action signalée en échec" : "Événement enregistré");
      const who = agentById(r.agent_id)?.nom || (r.agent_id ? "Agent non chargé" : "Agent non identifié");
      return `<li><b>${esc(String(r.action || "activité").replace(/_/g, " "))}</b><small>${esc(who)} · ${esc(ago(r.at))} · ${r.ok === false ? "Échec" : "Enregistré"}</small><span>${esc(summary)}</span></li>`;
    }).join("") : "<li>Aucune activité reliée à ce prospect dans les 500 derniers événements chargés.</li>";
    el.hidden = false;
    el.innerHTML = `<div class="prospect-workbench-head"><div><h2>${esc(p.entreprise || "Prospect")} <span class="tag">Prospect</span></h2><div class="muted">${esc(p.ville || "Localisation non renseignée")} · ${esc(p.stage || "nouveau")}</div></div><button type="button" id="prospect-detail-close" aria-label="Fermer la fiche">×</button></div>
      <div class="prospect-workbench-grid"><div><small>Agent responsable</small><b>${esc(assigned?.nom || "Non affecté")}</b></div><div><small>Score CRM</small><b>${p.score != null && Number.isFinite(Number(p.score)) ? esc(p.score) : "Non renseigné"}</b></div><div><small>Potentiel</small><b>${p.potentiel_fcfa != null && Number.isFinite(Number(p.potentiel_fcfa)) ? esc(Number(p.potentiel_fcfa).toLocaleString("fr-FR") + " FCFA") : "Non renseigné"}</b></div><div><small>Prochaine action</small><b>${esc(next)}</b></div></div>
      <div class="prospect-workbench-contact">${contact}${email}</div>
      <div class="prospect-workbench-products"><small>Logiciel(s)</small><b>${esc(products.filter(Boolean).join(" · ") || "Non renseigné")}</b></div>
      <section class="prospect-workbench-section"><h3>Activité commerciale récente</h3><ul class="prospect-history">${activityRows}</ul></section>
      <section class="prospect-workbench-section"><h3>Missions liées à ce prospect</h3>${tasks.length ? tasks.map((t) => `<div class="mis" style="--c:${TASK_C[t.statut]};margin-top:6px"><b>${esc(clip(t.titre, 80))}</b><small>${esc(agentById(t.agent_id)?.nom || "Agent inconnu")} · ${esc(TASK_L[t.statut] || t.statut)} · P${esc(t.priorite)}</small></div>`).join("") : '<div class="muted">Aucune mission liée à ce prospect.</div>'}</section>
      <section class="prospect-workbench-section"><button type="button" class="prospect-assign-toggle" id="prospect-assign-toggle">＋ Créer une mission pour un agent</button><form id="prospect-assign-form" class="prospect-assign-form" hidden>
        <label>Agent IA<select name="agent" required><option value="">Choisir un agent actif</option>${D.agents.filter(a => a.etat === "actif" && a.archived_at == null).sort((a,b) => String(a.nom).localeCompare(String(b.nom),"fr")).map(a => `<option value="${esc(a.id)}" ${assigned?.id === a.id ? "selected" : ""}>${esc(a.nom)} · ${esc(a.code || "")}</option>`).join("")}</select></label>
        <label>Mission<input name="title" type="text" minlength="3" maxlength="200" required placeholder="Ex. Contacter le décideur et qualifier le besoin"></label>
        <label>Consigne<textarea name="description" maxlength="7900" rows="3" placeholder="Contexte, objectif et résultat attendu"></textarea></label>
        <div class="prospect-assign-row"><label>Priorité<select name="priority"><option value="3">Normale</option><option value="4">Haute</option><option value="5">Urgente</option><option value="2">Basse</option><option value="1">Très basse</option></select></label><label>Échéance<select name="deadline"><option value="">Sans échéance</option><option value="24">24 heures</option><option value="72">3 jours</option><option value="168">7 jours</option><option value="336">14 jours</option></select></label></div>
        <button type="submit" class="prospect-assign-submit">Confier la mission</button><small class="prospect-assign-status" id="prospect-assign-status" aria-live="polite"></small>
      </form></section>
      <p class="prospect-workbench-note">La création passe par le contrôle d'accès de la direction. La mission est enregistrée dans le moteur SANIX AI ; aucune relance ou communication externe n'est envoyée automatiquement.</p>`;
    $("#prospect-detail-close")?.addEventListener("click", () => { D.prospectSel = null; el.hidden = true; });
    $("#prospect-assign-toggle")?.addEventListener("click", () => { const form = $("#prospect-assign-form"); form.hidden = !form.hidden; });
    $("#prospect-assign-form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget, submit = form.querySelector('[type="submit"]'), status = $("#prospect-assign-status");
      const fd = new FormData(form), agent = String(fd.get("agent") || ""), title = String(fd.get("title") || "").trim(), description = String(fd.get("description") || "").trim();
      if (!agent || title.length < 3) { status.textContent = "Choisis un agent et renseigne un titre valide."; return; }
      submit.disabled = true; submit.textContent = "Création en cours…"; status.textContent = "";
      try {
        const { data, error } = await sb.rpc("crm_assign_mission", { p_agent: agent, p_prospect: p.id, p_titre: title, p_description: description || title, p_priorite: Number(fd.get("priority") || 3), p_echeance_h: fd.get("deadline") ? Number(fd.get("deadline")) : null });
        if (error) throw error;
        conn("ok", "Mission confiée · actualisation du réseau");
        await cycle();
      } catch (err) {
        submit.disabled = false; submit.textContent = "Confier la mission";
        status.textContent = String(err?.message || err).slice(0, 220);
        conn("bad", "Création de mission refusée");
      }
    });
    return;
  }
  if (!a) { el.hidden = true; return; }
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
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-incident-approval]");
  if (!b || b.disabled) return;
  b.disabled = true; b.textContent = "Envoi de la demande…";
  try {
    const { error } = await sb.rpc("ai_create_incident_approval", {
      p_action: b.dataset.incidentKey || "incident",
      p_recommendation: b.dataset.incidentRecommendation || "",
      p_reason: "Demande de correction issue du centre Jarvis V2.5",
      p_task_id: b.dataset.incidentTask || null,
      p_agent_id: b.dataset.incidentAgent || null
    });
    if (error) throw error;
    b.textContent = "Demande soumise · décision dans Validations";
    b.classList.add("is-submitted");
    conn("ok", "Correction soumise à validation de la direction");
  } catch (e) {
    b.disabled = false; b.textContent = "Soumettre cette correction à validation";
    conn("bad", "Demande refusée : " + String(e.message || e).slice(0,100));
  }
});
$("#alerts").addEventListener("click", (ev) => { const item = ev.target.closest("[data-alert-agent]"); if (!item) return; D.sel = item.dataset.alertAgent; view3d?.focus(D.sel); renderDetail(); });
$("#mission-filters").addEventListener("click", (ev) => { const b = ev.target.closest("[data-filter]"); if (!b) return; D.taskFilter = b.dataset.filter; renderWorkflow(); renderMissions(); });
$("#workflow-steps").addEventListener("click", (ev) => { const b = ev.target.closest("[data-workflow-filter]"); if (!b) return; D.taskFilter = b.dataset.workflowFilter; renderWorkflow(); renderMissions(); });
$("#ops-panel").addEventListener("click", (ev) => { const b = ev.target.closest("[data-ops-agent]"); if (!b) return; D.sel = b.dataset.opsAgent; view3d?.focus(D.sel); renderDetail(); });
$("#performance-panel").addEventListener("click", (ev) => { const b = ev.target.closest("[data-performance-agent]"); if (!b) return; D.sel = b.dataset.performanceAgent; view3d?.focus(D.sel); renderDetail(); });
$("#missions").addEventListener("click", (ev) => { const m = ev.target.closest("[data-agent]"); if (m) { D.sel = m.dataset.agent; view3d?.focus(D.sel); renderDetail(); } });

// ───────── Vue 3D (repli 2D si WebGL indisponible ou ?2d) ─────────
let view3d = null, relationsView = null, relationsMode = false;
const relationFilters = { agent: "", product: "", prospect: "" };
function renderRelationAgentOptions() {
  const select = $("#relations-agent"), current = relationFilters.agent;
  const agents = D.agents.filter(a => a.etat !== "archive").slice().sort((a,b) => String(a.nom || a.code).localeCompare(String(b.nom || b.code), "fr"));
  select.innerHTML = '<option value="">Tous les agents</option>' + agents.map(a => '<option value="' + esc(a.id) + '">' + esc(a.nom || a.code || "Agent") + '</option>').join("");
  select.value = agents.some(a => String(a.id) === current) ? current : "";
  if (select.value !== current) relationFilters.agent = select.value;
}
function renderRelationProductOptions() {
  const select = $("#relations-product"), current = relationFilters.product || select.value;
  const products = (D.products || []).filter(p => p.actif !== false).slice().sort((a,b) => String(a.nom).localeCompare(String(b.nom), "fr"));
  select.innerHTML = '<option value="">Tous les logiciels</option>' + products.map(p => `<option value="${esc(p.id)}">${esc(p.nom)}</option>`).join("");
  select.value = products.some(p => String(p.id) === String(current)) ? String(current) : "";
  relationFilters.product = select.value;
}
function updateRelationFilters() {
  relationFilters.agent = $("#relations-agent").value;
  relationFilters.product = $("#relations-product").value;
  relationFilters.prospect = $("#relations-prospect").value.trim();
  relationsView?.update({ agents: D.agents, prospects: D.salesRows || [], activities: D.relationRows || [], tasks: D.tasks || [], products: D.products || [], aliases: D.productAliases || [], filters: relationFilters });
}
const relationsCanvas = $("#relations-canvas");
const api3d = {
  get D() { return D; }, STATES, clip, agentState, deptColor, onSelect: (id) => { D.sel = id; renderDetail(); },
  onProspect: (p) => { D.relationSel = null; D.sel = null; D.prospectSel = p; renderDetail(); },
  onAgent: (a) => { D.relationSel = null; D.prospectSel = null; D.sel = a.id; renderDetail(); },
  onRelation: (r) => { D.relationSel = r; if (r) { D.sel = r.agent.id; D.prospectSel = r.prospect; renderDetail(); window.__jarvis?.explainRelation?.(r); } else { D.relationSel = null; } },
  onClearSelection: () => { D.relationSel = null; D.prospectSel = null; D.sel = null; $("#detail").hidden = true; renderDetail(); },
  onLegend: (items) => { const el=$("#relations-legend"); if(!el)return; el.innerHTML=items.map(item=>`<span class="relations-legend-item"><i class="relations-legend-dot ${esc(item.type)}" style="--legend-color:${esc(item.color)}"></i><b>${esc(item.label)}</b>${item.count!=null?`<small>${item.count}</small>`:""}</span>`).join(""); },
  onHover: (h) => { if (!h) { tip.hidden = true; return; } const n = h.n, cur = D.tasks.find((t) => t.agent_id === n.id && t.statut === "en_cours") ?? D.tasks.find((t) => t.agent_id === n.id && OPENS.includes(t.statut));
    tip.innerHTML = `<b>${esc(n.a.nom)}</b><span class="muted">${esc(n.a.fonction ?? "")}</span><br><span class="tag" style="--c:${STATES[n.st][1]}">${esc(STATES[n.st][0])}</span>${cur ? `<br>${esc(clip(cur.titre, 90))}` : ""}`; tip.hidden = false; tip.style.left = Math.min(W - 290, h.x + 14) + "px"; tip.style.top = Math.max(6, h.y - 10) + "px"; },
};
async function init3d() {
  if (/[?&]2d/.test(location.search)) return;
  try { const m = await import("./live3d.js"); view3d = m.create($("#stage3d"), api3d); cv.hidden = true; new ResizeObserver(() => view3d?.resize()).observe($("#stage3d")); }
  catch (e) { console.warn("Vue 3D indisponible, repli sur la vue 2D :", e.message); view3d = null; $("#ctl").hidden = true; $("#hint").hidden = true; }
}
function initControls() {
  $("#relations-agent").addEventListener("change", updateRelationFilters);
  $("#relations-product").addEventListener("change", updateRelationFilters);
  $("#relations-prospect").addEventListener("input", updateRelationFilters);
  $("#relations-reset").addEventListener("click", () => {
    relationFilters.agent = ""; relationFilters.product = ""; relationFilters.prospect = "";
    $("#relations-agent").value = ""; $("#relations-product").value = ""; $("#relations-prospect").value = "";
    updateRelationFilters(); relationsView?.reset(); relationsView?.clearSelection();
  });
  $("#relations-filters").addEventListener("click", (ev) => { const b=ev.target.closest("[data-rel-camera]");if(!b||!relationsView)return;const action=b.dataset.relCamera;if(action==="in")relationsView.zoom(1.22);else if(action==="out")relationsView.zoom(.82);else if(action==="reset")relationsView.reset(); });
  $("#ctl").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-c]"); if (!b) return; const c = b.dataset.c;
    if (c === "relations") {
      relationsMode = !relationsMode; b.classList.toggle("on", relationsMode);
      $("#stage3d").hidden = relationsMode; cv.hidden = relationsMode || !!view3d; relationsCanvas.hidden = !relationsMode; $("#relations-filters").hidden = !relationsMode; $("#relations-legend").hidden = !relationsMode;
      if (relationsMode) { renderRelationAgentOptions(); renderRelationProductOptions(); relationsView ??= createProspectRelations(relationsCanvas, { ...api3d, onFilterCount: (n, total) => { $("#relations-filter-count").textContent = n + " / " + total + " prospects"; } }); relationsView.update({ agents: D.agents, prospects: D.salesRows || [], activities: D.relationRows || [], tasks: D.tasks || [], products: D.products || [], aliases: D.productAliases || [], filters: relationFilters }); relationsView.resize(); }
      else view3d?.resize();
      return;
    }
    if (!view3d) return;
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
    layout(); view3d?.update(); if (relationsMode) { renderRelationAgentOptions(); renderRelationProductOptions(); relationsView?.update({ agents: D.agents, prospects: D.salesRows || [], activities: D.relationRows || [], tasks: D.tasks || [], filters: relationFilters }); } renderKpis(); renderWorkflow(); renderMissions(); renderFeed(!D.first); renderAlerts(); renderHealth(); renderBusiness(); renderFinance(); renderWhatsApp(); renderAgentPerformance(); renderOperationsDirector(); renderBusinessIntelligence(); renderPredictiveDirector(); renderExecutiveCommandCenter(); renderTicker(); renderDetail(); D.first = false;
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
