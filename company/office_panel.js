// SANIX AI VIRTUAL COMPANY — onglet « Bureau 3D » : scène, caméras, supervision temps réel, fiche collaborateur,
// dialogue avec le directeur IA, actions du président (mission, rapport) et état de la synchronisation Realtime.
import { $, ago, clipT, closeModal, esc, fmtD, html, openModal, pill, toast } from "./ui.js";
import { agentBy, callFn, chatBody, deptColor, dgName, isDir, LEVELS, live, loadExec, OPEN, openByAgent, q, S, stPill, TASK_ST } from "./state.js";
import { describeActivity, STATUS, statusOf } from "./activity.js";
import { createOffice, detectQuality } from "./office3d.js";

const H = {};                       // liens vers app.js : go, showTask, showCharter, refreshCore (évite l'import circulaire)
export const initPanel = (h) => Object.assign(H, h);
const P = { sync: "connecting", supQ: "", supSt: "", supLimit: 60, extras: new Map(), supT: null, sheetT: null };
const QUALITY_KEY = "sanix_company_quality";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const narrow = () => matchMedia("(max-width: 980px)").matches;
const PLACE = { poste: "Poste de travail", reunion: "Salle de réunion", supervision: "Salle de supervision", collaboration: "Espace de collaboration", detente: "Espace détente" };

function placeOf(a) {
  const away = a.lieu && a.lieu !== "poste" && (!a.lieu_jusqua || Date.parse(a.lieu_jusqua) > Date.now());
  if (!away) return PLACE.poste;
  if (a.lieu === "poste_agent") return `Poste de ${agentBy(a.lieu_cible_agent)?.nom ?? "un collègue"}`;
  if (a.lieu === "departement") return `Département ${S.depts.find((d) => d.id === a.lieu_cible_dept)?.nom ?? a.lieu_cible_dept}`;
  return PLACE[a.lieu] ?? PLACE.poste;
}
/** Mission en cours de chaque agent (celle réellement exécutée, sinon la première ouverte). */
function currentTasks() {
  const m = new Map();
  for (const t of S.tasks) {
    if (!OPEN.includes(t.statut)) continue;
    const c = m.get(t.agent_id);
    if (!c || (t.statut === "en_cours" && c.statut !== "en_cours")) m.set(t.agent_id, t);
  }
  return m;
}

// ───────────────────────── Scène ─────────────────────────
const legendHtml = () => Object.values(STATUS).map((v) => html`<span><i style="background:${v.color}"></i>${v.label}</span>`);
const stageHtml = () => html`<div class="stage" id="stage">
  <div class="stage-tools" role="toolbar" aria-label="Caméra">
    <select id="view-sel" data-change="view" aria-label="Vue de la caméra"></select>
    <button class="btn sm" type="button" data-act="zoom" data-d="-1" aria-label="Zoom avant" title="Zoom avant">＋</button>
    <button class="btn sm" type="button" data-act="zoom" data-d="1" aria-label="Zoom arrière" title="Zoom arrière">－</button>
    <button class="btn sm" type="button" data-act="reset-view" aria-label="Vue d'ensemble" title="Vue d'ensemble">⟲</button>
    <button class="btn sm" type="button" data-act="toggle-2d" id="b2d">Vue 2D</button></div>
  <div class="stage-right"><span class="chip sync" id="sync-chip" data-s="connecting" role="status"><i></i><span>Connexion…</span></span>
    <select id="q-sel" data-change="quality" aria-label="Qualité graphique"><option value="auto">Qualité : auto</option><option value="high">Élevée</option><option value="low">Réduite</option><option value="eco">Éco</option></select></div>
  <div class="legend" aria-label="Légende des états">${legendHtml()}</div>
  <div class="stage-load" id="stage-load" role="status"><b>Chargement du bureau…</b><div class="bar"><b id="stage-load-bar" style="width:0%"></b></div><span class="small" id="stage-load-n"></span></div>
</div><aside class="side" id="side"><section id="sup"></section><section id="sheet" hidden></section></aside>`;

function officeStats() {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return { agentsActifs: live().filter((a) => a.etat === "actif").length, agentsMax: S.gov?.max_agents_actifs, missionsEnCours: S.tasks.filter((t) => OPEN.includes(t.statut)).length,
    missionsTerminees: S.tasks.filter((t) => t.statut === "terminee" && t.finished_at && new Date(t.finished_at) >= today).length,
    coutJour: S.budget?.jour_usd ?? 0, budgetJour: S.budget?.budget_jour_usd ?? 0, prospects: S.kpis?.prospects_total ?? 0, offres: S.kpis?.offres_transmises ?? 0, validations: S.approvals.length };
}
export function pushOffice() {
  S.office?.update({ agents: live(), departments: S.depts, stats: officeStats(), meetings: S.officeMeetings, openByAgent: openByAgent() });
  scheduleSup(); if (S.selected) scheduleSheet();
}

export function renderOffice(main) {
  if (!S.officeEl) { S.officeEl = document.createElement("section"); S.officeEl.className = "panel full office"; S.officeEl.innerHTML = stageHtml().s; }
  if (main.firstElementChild !== S.officeEl) main.replaceChildren(S.officeEl);
  fillViewOptions(); syncQualitySel(); setSync(P.sync);
  if (S.officeOk === null) initOffice(); else if (S.officeOk === true) pushOffice(); else render2D();
  S.office?.setActive(true);
  renderSide();
}

async function initOffice() {
  S.officeOk = "pending";
  try {
    S.office = await createOffice($("#stage"), { onSelect: (id) => selectAgent(id, { fromScene: true }), onProgress: setProgress, onView: syncViewSel });
    S.officeOk = true; pushOffice(); S.office.setActive(S.tab === "office");
  } catch (e) {
    console.warn("3D indisponible :", e.message);
    S.officeOk = false; $("#stage-load")?.setAttribute("hidden", ""); render2D();
  }
}
function setProgress({ done, total }) {
  const el = $("#stage-load"); if (!el) return;
  $("#stage-load-bar").style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
  $("#stage-load-n").textContent = `${done} / ${total} collaborateurs`;
  el.hidden = done >= total;
}
function render2D() {
  const stage = $("#stage"); if (!stage) return;
  $("#stage-load")?.setAttribute("hidden", "");
  let fb = $("#fb2d");
  if (!fb) { fb = document.createElement("div"); fb.id = "fb2d"; fb.className = "fallback"; stage.appendChild(fb); }
  const by = {}; for (const a of live()) (by[a.departement_id] ??= []).push(a);
  fb.innerHTML = html`${S.officeOk === false ? html`<p class="muted small">La vue 3D n'est pas disponible sur cet appareil : affichage 2D.</p>` : ""}${S.depts.filter((d) => by[d.id]).map((d) => html`
    <h3 style="margin:14px 0 6px;color:${deptColor(d.id)}">${d.nom}</h3><div class="grid g4">${by[d.id].map((a) => html`
    <button type="button" class="node" style="--c:${deptColor(a.departement_id)};text-align:left" data-act="select-agent" data-id="${a.id}"><div><b>${a.nom}</b><small>${a.fonction}</small><br>${stPill(a)}</div></button>`)}</div>`)}`.s;
  fb.style.display = S.officeOk === false || S.force2d ? "" : "none";
  if (S.office) S.office.element.style.visibility = S.force2d ? "hidden" : "";
}

// ───────────────────────── Caméra & qualité ─────────────────────────
function fillViewOptions() {
  const sel = $("#view-sel"); if (!sel) return;
  const cur = sel.value || "general", a = S.selected && agentBy(S.selected);
  const opts = [["general", "Vue d'ensemble"], ["executive", "Étage de direction"], ...S.depts.filter((d) => d.id !== "direction").map((d) => [`dept:${d.id}`, `Département : ${d.nom}`]),
    ["direction", "Bureau du directeur IA"], ["meeting", "Salle de réunion"], ["supervision", "Salle de supervision"], ["activity", "Activités en cours"], ["follow", a ? `Suivre : ${a.nom}` : "Suivre un collaborateur (sélectionnez-en un)"], ["free", "Vue libre"]];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}"${v === "follow" && !a ? " disabled" : ""}${v === "free" ? " hidden" : ""}>${esc(l)}</option>`).join("");
  sel.value = opts.some(([v]) => v === cur) ? cur : "general";
}
function syncViewSel({ mode, arg }) {
  const sel = $("#view-sel"); if (!sel) return;
  const v = mode === "dept" ? `dept:${arg}` : mode;
  if ([...sel.options].some((o) => o.value === v)) sel.value = v;
}
function syncQualitySel() { const s = $("#q-sel"); if (s) s.value = lsGet(QUALITY_KEY) ?? "auto"; }
export function setSync(state) {
  P.sync = state;
  const c = $("#sync-chip"); if (!c) return;
  c.dataset.s = state; c.lastElementChild.textContent = { live: "Temps réel", reconnecting: "Reconnexion…", offline: "Hors ligne", connecting: "Connexion…" }[state] ?? state;
}
export const changes = {
  view: (el) => { const [m, arg] = el.value.split(":"); if (m === "follow") { if (S.selected) S.office?.setView("follow", S.selected); } else if (m !== "free") S.office?.setView(m, arg); },
  quality: (el) => {
    if (el.value === "auto") { try { localStorage.removeItem(QUALITY_KEY); } catch { /* sans stockage */ } S.office?.setQuality(detectQuality("auto"), false); }
    else S.office?.setQuality(el.value);
  },
  "sup-status": (el) => { P.supSt = el.value; P.supLimit = 60; renderSupervision(); },
};
export const inputs = { "sup-q": (el) => { P.supQ = el.value.trim().toLowerCase(); P.supLimit = 60; renderSupervision(); } };

// ───────────────────────── Synchronisation temps réel ─────────────────────────
/** Mise à jour d'un agent publiée par le moteur : aucune rechargement, l'avatar se réconcilie. Faux = structure modifiée (recharger). */
export function agentChanged(row) {
  const cur = agentBy(row.id); if (!cur) return false;
  Object.assign(cur, row);
  if (cur.etat === "archive" || (S.office && !S.office.has(cur.id))) return false;   // structure modifiée (agent retiré / réactivé) : rechargement
  S.office?.patchAgent(cur); scheduleSup(); if (S.selected === cur.id) scheduleSheet();
  return true;
}
export function eventReceived(ev) {
  S.office?.pushEvent(ev); scheduleSup(); if (S.selected === ev.agent_id) scheduleSheet();
}
const later = (key, fn, ms) => { if (!P[key]) P[key] = setTimeout(() => { P[key] = null; fn(); }, ms); };
const scheduleSup = () => later("supT", renderSupervision, 350);
const scheduleSheet = () => later("sheetT", () => { if (S.selected && !$("#sheet").hidden) renderSheet(); }, 400);

// ───────────────────────── Supervision ─────────────────────────
const STATUS_FILTERS = [["", "Tous les états"], ["actif", "🟢 Actifs"], ["attente", "🟡 En attente"], ["difficulte", "🔴 En difficulté"], ["suspendu", "⚪ Suspendus"], ["disponible", "🟢 Disponibles"]];
function ensureSupMarkup() {
  const sup = $("#sup"); if (!sup || sup.dataset.ready) return;
  sup.dataset.ready = "1";
  sup.innerHTML = html`<h2>Supervision en temps réel</h2><p class="sub" id="sup-count"></p>
    <div class="sup-tools"><input type="search" data-input="sup-q" placeholder="Rechercher un collaborateur" aria-label="Rechercher un collaborateur" maxlength="60">
    <select data-change="sup-status" aria-label="Filtrer par statut">${STATUS_FILTERS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
    <div class="scroll sup-scroll"><table class="tbl sup" data-paginate="off"><thead><tr><th>Agent</th><th>Activité</th><th>Statut</th></tr></thead><tbody id="sup-body"></tbody></table></div>
    <div class="actions" id="sup-more" hidden><button class="btn sm" type="button" data-act="sup-more">Afficher plus</button></div>
    <p class="small muted" style="margin-top:12px"><b>Navigation :</b> glisser pour pivoter · molette ou pincement pour zoomer · clic droit ou Maj + glisser pour déplacer · double-clic sur un collaborateur pour le centrer.</p>
    <p class="small muted">Les animations représentent le statut déclaré par le moteur IA. Les traitements s'exécutent sur les serveurs, interface fermée : à la réouverture, les états réels sont restitués.</p>`.s;
}
function renderSupervision() {
  const body = $("#sup-body"); if (!body) return;
  const tasks = currentTasks(), all = live(), counts = { actif: 0, attente: 0, difficulte: 0, suspendu: 0 };
  for (const a of all) { const k = statusOf(a).key; if (k === "suspendu") counts.suspendu++; else if (k === "attente") counts.attente++; else if (k === "difficulte") counts.difficulte++; else counts.actif++; }
  $("#sup-count").textContent = `${all.length} collaborateurs · 🟢 ${counts.actif} actifs · 🟡 ${counts.attente} en attente · 🔴 ${counts.difficulte} en difficulté · ⚪ ${counts.suspendu} suspendus`;
  const match = (a) => {
    const k = statusOf(a).key;
    if (P.supSt === "actif" && !["actif", "termine"].includes(k)) return false;
    if (P.supSt === "disponible" && k !== "disponible") return false;
    if (["attente", "difficulte", "suspendu"].includes(P.supSt) && k !== P.supSt) return false;
    return !P.supQ || `${a.nom} ${a.fonction}`.toLowerCase().includes(P.supQ);
  };
  const list = all.filter(match).sort((a, b) => a.niveau - b.niveau || a.nom.localeCompare(b.nom, "fr"));
  body.innerHTML = (list.slice(0, P.supLimit).map((a) => {
    const st = statusOf(a), t = tasks.get(a.id);
    return html`<tr class="click${a.id === S.selected ? " sel" : ""}" data-act="sup-row" data-id="${a.id}" tabindex="0" aria-label="${a.nom} : ${st.label}"><td><b>${a.nom}</b><span class="small muted">${a.fonction}</span></td>
      <td>${describeActivity(a, t ? clipT(t.titre, 44) : null)}</td><td title="${st.label}"><span>${st.emoji}</span> <span class="stlab">${st.label}</span></td></tr>`.s;
  }).join("")) || `<tr><td colspan="3" class="muted">Aucun collaborateur pour ce filtre.</td></tr>`;
  $("#sup-more").hidden = list.length <= P.supLimit;
}

// ───────────────────────── Fiche collaborateur ─────────────────────────
export function selectAgent(id, o = {}) {
  const a = id ? agentBy(id) : null;
  S.selected = a ? a.id : null;
  S.office?.select(S.selected, !!o.focus);
  fillViewOptions(); renderSide();
  if (a) loadExtras(a).then(() => { if (S.selected === a.id) renderSheet(); }).catch(() => { /* sections facultatives */ });
  if (a && o.fromScene && narrow()) $("#sheet")?.scrollIntoView({ block: "start", behavior: "smooth" });
  if (a && o.fromScene && a.niveau === 1 && isDir()) openDialog();
}
export function renderSide() {
  const sup = $("#sup"), sheet = $("#sheet"); if (!sup || !sheet) return;
  const a = S.selected && agentBy(S.selected);
  if (!a) { S.selected = null; sheet.hidden = true; sup.hidden = false; ensureSupMarkup(); renderSupervision(); return; }
  sup.hidden = true; sheet.hidden = false; renderSheet();
}

async function loadExtras(a) {
  const hit = P.extras.get(a.id); if (hit && Date.now() - hit.at < 30000) return hit;
  const sd = a.role_code === "directeur_commercial" || a.code === "sanix_ai_sales_director";   // le poste, pas un code figé
  const [comms, acts] = await Promise.all([
    q(S.sb.from("ai_agent_communications").select("id,de_agent_id,vers_agent_id,type,objet,contenu,created_at").or(`de_agent_id.eq.${a.id},vers_agent_id.eq.${a.id}`).order("created_at", { ascending: false }).limit(6)),
    isDir() ? q((sd ? S.sb.from("ai_actions").select("prospect_id,at").in("agent", ["sales_assistant", "followup_manager"]) : S.sb.from("ai_actions").select("prospect_id,at").eq("agent_id", a.id))
      .eq("action", "send_message").not("prospect_id", "is", null).order("at", { ascending: false }).limit(20)) : Promise.resolve([]),
  ]);
  const pids = [...new Set(acts.map((x) => x.prospect_id))].slice(0, 4);
  let convs = [];
  if (pids.length) {
    const [pr, ms] = await Promise.all([q(S.sb.from("ai_prospects").select("id,entreprise").in("id", pids)),
      q(S.sb.from("ai_messages").select("id,prospect_id,canal,sens,auteur,contenu,statut,created_at").in("prospect_id", pids).order("created_at", { ascending: false }).limit(20))]);
    convs = pids.map((id) => ({ prospect: pr.find((p) => p.id === id), messages: ms.filter((m) => m.prospect_id === id).slice(0, 3) })).filter((c) => c.prospect);
  }
  let crm = null;   // dossiers CRM suivis par l'agent (fonction SQL du connecteur CRM ↔ IA) ; indisponible = section absente
  try { const r = await S.sb.rpc("crm_agent_portfolio", { p_agent: a.id }); crm = r.error ? null : r.data; } catch { crm = null; }
  const ex = { comms, convs, crm, at: Date.now() }; P.extras.set(a.id, ex); return ex;
}

const CRM_URL = new URL("../index.html", location.href).pathname;
/** Dossiers CRM suivis par ce collaborateur : ouverture dans le CRM, mission pour un dossier (direction), validations en attente. */
function crmSection(c, a) {
  if (!c) return html``;
  const dirOk = isDir() && a.niveau > 1 && a.etat === "actif", ps = c.prospects ?? [], ms = c.missions ?? [], vs = c.validations ?? [];
  return html`<h3 class="sh">Dossiers CRM suivis (${ps.length})</h3>
    ${ps.length ? ps.slice(0, 8).map((p) => html`<div class="small" style="margin:5px 0"><b>${p.entreprise}</b> · ${p.stage}${p.score != null ? html` · ${p.score}/100` : ""}${p.statut_crm ? html` · CRM : ${p.statut_crm}` : ""}
      ${p.crm_rid ? html` <a href="${CRM_URL}?crm_client=${encodeURIComponent(p.crm_rid)}" target="_blank" rel="noopener">Ouvrir dans le CRM</a>` : ""}
      ${dirOk ? html` <button class="btn sm" type="button" data-act="crm-mission" data-agent="${a.id}" data-prospect="${p.id}" data-name="${p.entreprise}">➕ Mission</button>` : ""}</div>`) : html`<p class="small muted">Aucun dossier suivi.</p>`}
    ${ms.length ? html`<div class="small muted" style="margin-top:6px">Missions liées à un dossier</div>${ms.slice(0, 6).map((m) => html`<div class="small" style="margin:3px 0"><a href="#" data-act="task" data-id="${m.id}">${clipT(m.titre, 56)}</a>${m.entreprise ? html` · ${m.entreprise}` : ""} ${pill(...(TASK_ST[m.statut] ?? [m.statut, "#64748B"]))}</div>`)}` : ""}
    ${vs.length ? html`<div class="small" style="margin-top:6px">⏳ ${vs.length} validation(s) en attente · <a href="#" data-act="tab" data-id="valid">ouvrir les validations</a></div>` : ""}`;
}
function renderSheet() {
  const el = $("#sheet"), a = S.selected && agentBy(S.selected); if (!el || !a) return;
  const mgr = agentBy(a.manager_id), subs = live().filter((x) => x.manager_id === a.id), mine = S.tasks.filter((t) => t.agent_id === a.id);
  const open = mine.filter((t) => OPEN.includes(t.statut)), done = mine.filter((t) => t.statut === "terminee").slice(0, 3), cur = open.find((t) => t.statut === "en_cours") ?? open[0];
  const ex = P.extras.get(a.id), st = statusOf(a), dept = S.depts.find((d) => d.id === a.departement_id)?.nom ?? a.departement_id;
  const canAct = isDir() && a.niveau > 1, active = a.etat === "actif";
  el.innerHTML = html`<div class="actions" style="margin:0 0 8px"><button class="btn sm" type="button" data-act="sheet-back">← Supervision</button>${narrow() ? html`<button class="btn sm" type="button" data-act="to-stage">↑ Bureau 3D</button>` : ""}</div>
    <div style="display:flex;gap:10px;align-items:center"><span class="dot" style="--c:${deptColor(a.departement_id)};width:14px;height:14px"></span><div><h2 style="margin:0">${a.nom}</h2><div class="muted">${a.fonction}</div></div></div>
    <div style="margin:10px 0" class="tags">${stPill(a)}<span class="tag">${LEVELS[a.niveau]}</span><span class="tag">${dept}</span>${a.temporaire ? html`<span class="tag">Temporaire · jusqu'au ${fmtD(a.expire_at)}</span>` : ""}</div>
    <div class="card live" style="margin:8px 0"><div class="small muted">Activité en cours</div><b>${describeActivity(a, cur ? clipT(cur.titre, 70) : null)}</b>
      <div class="small muted">${st.emoji} ${st.label} · ${placeOf(a)} · depuis ${ago(a.activite_depuis)}</div></div>
    <dl class="kv"><dt>Responsable</dt><dd>${mgr ? html`<a href="#" data-act="select-agent" data-id="${mgr.id}">${mgr.nom}</a>` : "Président"}</dd>
      <dt>Équipe</dt><dd>${subs.length ? subs.map((s, i) => html`${i ? ", " : ""}<a href="#" data-act="select-agent" data-id="${s.id}">${s.nom}</a>`) : "—"}</dd>
      <dt>Réflexion</dt><dd>${{ low: "rapide", medium: "standard", high: "approfondie" }[a.effort] ?? "—"}</dd><dt>Incidents consécutifs</dt><dd>${a.incidents_consecutifs ?? 0}</dd><dt>Cahier des charges</dt><dd>v${a.charte_version}</dd></dl>
    ${a.specialite ? html`<p class="small"><b>Spécialité :</b> ${a.specialite}</p>` : ""}
    <div class="tags">${(a.outils ?? []).map((o) => html`<span class="tag">${o}</span>`)}</div>
    <h3 class="sh">Missions en cours (${open.length})</h3>${open.length ? open.map((t) => html`<div class="small" style="margin:5px 0"><a href="#" data-act="task" data-id="${t.id}">${clipT(t.titre, 70)}</a><br>${pill(...(TASK_ST[t.statut] ?? [t.statut, "#64748B"]))}</div>`) : html`<p class="small muted">Aucune</p>`}
    <h3 class="sh">Derniers résultats</h3>${done.length ? done.map((t) => html`<div class="small" style="margin:5px 0"><a href="#" data-act="task" data-id="${t.id}">${clipT(t.titre, 70)}</a>${t.evaluation != null ? html` · <b>${t.evaluation}/100</b>` : ""}<br><span class="muted">${clipT(t.rapport, 140)}</span></div>`) : html`<p class="small muted">Aucun</p>`}
    ${crmSection(ex?.crm, a)}
    <h3 class="sh">Échanges internes</h3>${!ex ? html`<p class="small muted">Chargement…</p>` : ex.comms.length ? ex.comms.map((c) => html`<div class="small" style="margin:5px 0"><b>${agentBy(c.de_agent_id)?.nom ?? "Direction"}</b> → <b>${agentBy(c.vers_agent_id)?.nom ?? "—"}</b> · ${c.objet}<br><span class="muted">${clipT(c.contenu, 110)} · ${ago(c.created_at)}</span></div>`) : html`<p class="small muted">Aucun échange récent</p>`}
    ${ex?.convs.length ? html`<h3 class="sh">Conversations avec des prospects</h3>${ex.convs.map((c) => html`<div class="small" style="margin:6px 0"><b>${c.prospect.entreprise}</b>${c.messages.map((m) => html`<div class="muted">${m.sens === "sortant" ? "Agent" : "Prospect"} · ${m.canal} : ${clipT(m.contenu, 90)}</div>`)}</div>`)}` : ""}
    <div class="actions"><button class="btn sm" type="button" data-act="charter" data-id="${a.id}">📄 Cahier des charges</button>
      ${a.niveau === 1 && isDir() ? html`<button class="btn sm pri" type="button" data-act="open-dg">💬 Dialoguer</button>` : ""}
      ${canAct && active ? html`<button class="btn sm pri" type="button" data-act="assign-mission" data-id="${a.id}">➕ Assigner une mission</button><button class="btn sm" type="button" data-act="request-report" data-id="${a.id}">📝 Demander un rapport</button>` : ""}
      ${canAct ? (a.etat === "suspendu" ? html`<button class="btn sm ok" type="button" data-act="agent-etat" data-id="${a.id}" data-etat="actif">▶ Réactiver</button>` : active ? html`<button class="btn sm" type="button" data-act="agent-etat" data-id="${a.id}" data-etat="suspendu">⏸ Suspendre</button>` : "") : ""}
      ${canAct && a.etat !== "attente_validation" ? html`<button class="btn sm bad" type="button" data-act="agent-etat" data-id="${a.id}" data-etat="archive">🗄 Archiver</button>` : ""}</div>`.s;
}

// ───────────────────────── Actions du président ─────────────────────────
function assignModal(id) {
  const a = agentBy(id); if (!a) return;
  openModal(html`<h3>Assigner une mission à ${a.nom}</h3><p class="muted small">${a.fonction}. La mission suit la gouvernance (budget, anti-doublon) et démarre dans la minute.</p>
    <form id="assign-form" class="form1"><label class="f">Titre<input id="am-titre" required minlength="3" maxlength="200" placeholder="Ex. : Trouver 30 cliniques privées à Abidjan"></label>
    <label class="f">Description<textarea id="am-desc" required minlength="3" maxlength="8000" rows="4" placeholder="Contexte, critères, livrable attendu"></textarea></label>
    <label class="f">Objectifs (un par ligne, facultatif)<textarea id="am-obj" rows="3" maxlength="2400"></textarea></label>
    <div class="form"><label class="f">Priorité<select id="am-prio">${[[1, "1 · Urgente"], [2, "2 · Haute"], [3, "3 · Normale"], [4, "4 · Basse"], [5, "5 · Différée"]].map(([v, l]) => html`<option value="${v}" ${v === 2 ? "selected" : ""}>${l}</option>`)}</select></label>
    <label class="f">Échéance<select id="am-ech"><option value="">Aucune</option><option value="4">4 heures</option><option value="24" selected>24 heures</option><option value="72">3 jours</option><option value="168">7 jours</option></select></label></div>
    <div class="err" id="am-err" role="alert"></div><div class="actions"><button class="btn pri" type="submit" id="am-ok">Assigner la mission</button><button class="btn" type="button" data-act="close-modal">Annuler</button></div></form>`);
  $("#assign-form").onsubmit = async (e) => {
    e.preventDefault(); const btn = $("#am-ok"); btn.disabled = true; $("#am-err").textContent = "";
    try {
      const r = await callFn("assign_mission", { agent_id: a.id, titre: $("#am-titre").value.trim(), description: $("#am-desc").value.trim(), priorite: Number($("#am-prio").value),
        echeance_heures: $("#am-ech").value ? Number($("#am-ech").value) : null, objectifs: $("#am-obj").value.split("\n").map((x) => x.trim()).filter(Boolean) });
      closeModal(); toast(`Mission attribuée à ${r?.agent ?? a.nom}`, "ok"); await H.refreshCore();
    } catch (err) { $("#am-err").textContent = err.message; btn.disabled = false; }
  };
}
function crmMissionModal(el) {
  const a = agentBy(el.dataset.agent); if (!a) return;
  openModal(html`<h3>Mission pour ${el.dataset.name}</h3><p class="muted small">Assignée à ${a.nom}. Elle suit la gouvernance (budget, anti-doublon) et apparaît dans la fiche du dossier, dans le CRM.</p>
    <form id="crm-mission-form" class="form1"><label class="f">Titre<input id="cm-titre" required minlength="3" maxlength="200" value="Relancer ${el.dataset.name}"></label>
    <label class="f">Consigne<textarea id="cm-desc" required minlength="3" maxlength="8000" rows="4" placeholder="Contexte, résultat attendu"></textarea></label>
    <div class="form"><label class="f">Priorité<select id="cm-prio">${[[1, "1 · Urgente"], [2, "2 · Haute"], [3, "3 · Normale"], [4, "4 · Basse"]].map(([v, l]) => html`<option value="${v}" ${v === 2 ? "selected" : ""}>${l}</option>`)}</select></label>
    <label class="f">Échéance<select id="cm-ech"><option value="">Aucune</option><option value="24">24 heures</option><option value="72" selected>3 jours</option><option value="168">7 jours</option></select></label></div>
    <div class="err" id="cm-err" role="alert"></div><div class="actions"><button class="btn pri" type="submit" id="cm-ok">Assigner la mission</button><button class="btn" type="button" data-act="close-modal">Annuler</button></div></form>`);
  $("#crm-mission-form").onsubmit = async (e) => {
    e.preventDefault(); const btn = $("#cm-ok"); btn.disabled = true; $("#cm-err").textContent = "";
    try {
      await q(S.sb.rpc("crm_assign_mission", { p_agent: a.id, p_prospect: el.dataset.prospect, p_titre: $("#cm-titre").value.trim(), p_description: $("#cm-desc").value.trim(),
        p_priorite: Number($("#cm-prio").value), p_echeance_h: $("#cm-ech").value ? Number($("#cm-ech").value) : null }));
      closeModal(); toast("Mission assignée pour ce dossier", "ok"); P.extras.delete(a.id); await H.refreshCore(); if (S.selected === a.id) selectAgent(a.id);
    } catch (err) { $("#cm-err").textContent = err.message; btn.disabled = false; }
  };
}
function reportModal(id) {
  const a = agentBy(id); if (!a) return;
  openModal(html`<h3>Demander un rapport à ${a.nom}</h3><p class="muted small">Le collaborateur prépare un rapport factuel sur son activité. Vous êtes notifié dès qu'il est prêt.</p>
    <form id="report-form"><label class="f">Période<select id="rq-j"><option value="1">24 dernières heures</option><option value="7" selected>7 derniers jours</option><option value="30">30 derniers jours</option></select></label>
    <div class="err" id="rq-err" role="alert"></div><div class="actions"><button class="btn pri" type="submit" id="rq-ok">Demander le rapport</button><button class="btn" type="button" data-act="close-modal">Annuler</button></div></form>`);
  $("#report-form").onsubmit = async (e) => {
    e.preventDefault(); const btn = $("#rq-ok"); btn.disabled = true;
    try { const r = await callFn("request_report", { agent_id: a.id, jours: Number($("#rq-j").value) }); closeModal(); toast(`Rapport demandé à ${r?.agent ?? a.nom}`, "ok"); await H.refreshCore(); }
    catch (err) { $("#rq-err").textContent = err.message; btn.disabled = false; }
  };
}

// ───────────────────────── Dialogue avec le directeur IA ─────────────────────────
const dlgIntro = () => html`<div class="muted" style="margin:auto;text-align:center;max-width:420px"><p>Donnez vos instructions à ${dgName()}. Il élabore le plan, constitue les équipes et vous rend compte.</p></div>`;
export async function openDialog() {
  S.dlg = true;
  openModal(html`<h3>💬 Dialogue avec ${dgName()}</h3><div class="card chat dlg" style="padding:0"><div class="msgs" id="dlg-msgs" tabindex="0" aria-label="Conversation avec le directeur général IA"></div>
    <form class="compose" id="dlg-form"><textarea id="dlg-t" rows="2" maxlength="4000" placeholder="Votre instruction…" aria-label="Instruction"></textarea><button class="btn pri" type="submit" id="dlg-send">Envoyer</button></form></div>`, { onClose: () => { S.dlg = false; } });
  $("#dlg-form").onsubmit = submitDialog;
  $("#dlg-t").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("#dlg-form").requestSubmit(); } });
  try { await loadExec(); } catch (e) { toast(e.message, "bad"); }
  renderDialog();
}
export function renderDialog() {
  const el = $("#dlg-msgs"); if (!el || !S.dlg) return;
  const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80 || !el.childElementCount;
  el.innerHTML = chatBody(dlgIntro()).s; if (nearEnd) el.scrollTop = el.scrollHeight;
}
async function submitDialog(e) {
  e.preventDefault();
  const t = $("#dlg-t").value.trim(); if (t.length < 3 || S.busy) return;
  S.busy = true; S.pendingInstruction = true; $("#dlg-send").disabled = true; renderDialog();
  try {
    const r = await callFn("instruction", { contenu: t });
    $("#dlg-t").value = "";
    if (r?.ok === false) toast(r.raison ?? "Instruction non traitée", "bad");
    await loadExec(); await H.refreshCore();
  } catch (err) { toast(err.message, "bad"); }
  finally { S.busy = false; S.pendingInstruction = false; const b = $("#dlg-send"); if (b) b.disabled = false; renderDialog(); }
}

export const acts = {
  "zoom": (el) => S.office?.zoom(Number(el.dataset.d)),
  "reset-view": () => S.office?.resetView(),
  "toggle-2d": (el) => { S.force2d = !S.force2d; el.textContent = S.force2d ? "Vue 3D" : "Vue 2D"; render2D(); },
  "select-agent": (el, ev) => { ev.preventDefault(); selectAgent(el.dataset.id, { focus: true }); if (S.tab !== "office") H.go("office"); },
  "open-agent": async (el) => { S.selected = el.dataset.id; await H.go("office"); selectAgent(el.dataset.id, { focus: true }); },
  "sup-row": (el) => selectAgent(el.dataset.id, { focus: true }),
  "sheet-back": () => selectAgent(null),
  "sup-more": () => { P.supLimit += 60; renderSupervision(); },
  "assign-mission": (el) => assignModal(el.dataset.id),
  "crm-mission": (el) => crmMissionModal(el),
  "request-report": (el) => reportModal(el.dataset.id),
  "open-dg": () => openDialog(),
  "to-stage": () => $("#stage")?.scrollIntoView({ block: "start", behavior: "smooth" }),
};
