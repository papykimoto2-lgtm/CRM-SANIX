// SANIX AI VIRTUAL COMPANY — application de pilotage (plateforme indépendante, connectée à SANIX CRM par Supabase).
// Sécurité : session Supabase Auth + RLS ; aucune clé secrète acceptée ; tout texte dynamique est échappé (html``).
import { $, ago, askText, clipT, closeModal, esc, fmtD, fmtDT, html, num, openModal, pill, raw, toast, usd } from "./ui.js";
import { agentBy, callFn, chatBody, deptColor, dgName, isDir, LEVELS, live, loadExec, loadOfficeMeetings, OPEN, q, S, stPill, TASK_ST, loadCrm } from "./state.js";
import * as P from "./office_panel.js";
import { LOGIN_ALIASES, SUPABASE_DEFAULT } from "./config.js";
import * as SALES from "./sales.js";
import * as CFG from "./config_panel.js";

// ───────────────────────── Configuration & session ─────────────────────────
const LS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const CRM_CFG = "sanix_crm_supabase_config";   // configuration du CRM (même origine) : une seule saisie pour les deux applications
const OWN_CFG = "sanix_company_cfg";            // ancienne configuration propre à cette plateforme (reprise tant qu'elle est valide)
const LAST_LOGIN = "sanix_company_login";
/** Même accès que le CRM : sa configuration d'abord, puis l'ancienne configuration propre, puis les valeurs publiques par défaut. */
function readConfig() {
  for (const c of [LS(CRM_CFG), LS(OWN_CFG), SUPABASE_DEFAULT]) if (c?.url && c?.key && !keyProblem(c.key)) return { url: c.url, key: c.key };
  return null;
}
function jwtRole(key) { try { return JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; } catch { return null; } }
function keyProblem(key) {
  if (/^sb_secret_/.test(key) || jwtRole(key) === "service_role") return "Clé secrète détectée : n'utilisez jamais la clé service_role dans un navigateur. Saisissez la clé publique (anon / publishable).";
  // seule une clé publique est acceptée : un secret (« JWT Secret » compris) donnerait un accès total à la base à quiconque lit ce navigateur
  if (keyKind(key) === "inconnue") return "Ce n'est pas une clé publique. Saisissez la clé « publishable » (sb_publishable_…) ou « anon » (eyJ…) : Supabase → Project Settings → API Keys. Le « JWT Secret » est un secret : ne le collez jamais ici.";
  return null;
}
const keyKind = (key) => (/^sb_publishable_/.test(key) ? "publishable" : jwtRole(key) === "anon" ? "anon (JWT)" : "inconnue");
function cfgSummary(cfg) { try { return `${new URL(cfg.url).hostname} · clé ${keyKind(cfg.key)} …${String(cfg.key).slice(-4)}`; } catch { return "configuration illisible"; } }
/** Message de connexion fidèle à la cause : identifiants (400) ≠ clé du projet refusée (401) ≠ réseau. Rendu en texte brut. */
function loginMessage(e, host = "") {
  const s = e?.status ?? 0, c = String(e?.code ?? ""), m = String(e?.message ?? "").slice(0, 160);
  if (c === "invalid_credentials" || /invalid login credentials/i.test(m)) return "Identifiants invalides.";
  if (c === "email_not_confirmed") return "E-mail non confirmé : validez d'abord le lien reçu par e-mail.";
  if (s === 429 || /rate.?limit/i.test(c + m)) return "Trop de tentatives auprès de Supabase : patientez avant de réessayer.";
  if (s === 401 || (s === 403 && /api key/i.test(m))) return `Clé du projet refusée par Supabase (${s} · ${m}). Cliquez sur « Changer de projet Supabase » et saisissez la clé publique active (publishable ou anon) du projet ${host}.`;
  if (!s) return "Supabase injoignable : réseau, URL du projet ou projet en pause.";
  return `Connexion refusée (${s}) : ${m}`;
}
function gate(content) { $("#gate-box").innerHTML = content.s; $("#gate").hidden = false; $("#app").hidden = true; }
function hideGate() { $("#gate").hidden = true; $("#app").hidden = false; }

function showConfig(msg = "") {
  const url = LS(CRM_CFG)?.url || LS(OWN_CFG)?.url || SUPABASE_DEFAULT.url;
  gate(html`<h1 id="gate-title">SANIX AI VIRTUAL COMPANY</h1><div class="muted small">Connexion à votre projet Supabase</div>
    <form id="cfg-form"><label class="f">URL du projet<input id="cfg-url" type="url" required value="${url}" placeholder="https://xxxx.supabase.co" autocomplete="off"></label>
    <label class="f">Clé publique (anon / publishable)<input id="cfg-key" type="text" required autocomplete="off" spellcheck="false"></label>
    <div class="err" id="cfg-err">${msg}</div><button class="btn pri" type="submit">Continuer</button></form>`);
  $("#cfg-form").onsubmit = (e) => {
    e.preventDefault();
    const url = $("#cfg-url").value.trim().replace(/\/$/, ""), key = $("#cfg-key").value.trim();
    if (!/^https:\/\//.test(url)) { $("#cfg-err").textContent = "L'URL doit commencer par https://"; return; }
    const p = keyProblem(key); if (p) { $("#cfg-err").textContent = p; return; }
    localStorage.setItem(CRM_CFG, JSON.stringify({ url, key })); localStorage.removeItem(OWN_CFG); location.reload();   // une seule configuration, partagée avec le CRM
  };
}

let fails = 0, lockUntil = 0;
/** Identifiant du CRM (ex. kessie) → e-mail du compte opérateur : annuaire publié par le CRM, sinon table de config.js. Un e-mail est repris tel quel. */
function resolveLogin(id) {
  const v = id.trim(), k = v.toLowerCase(); if (v.includes("@")) return v;
  const u = (LS("sanix_crm_directory") ?? []).find((x) => [x.login, x.nom].some((n) => String(n ?? "").toLowerCase() === k));
  return u?.email ?? LOGIN_ALIASES[k] ?? v;
}
/** Identifiant proposé : le dernier utilisé ici, sinon l'utilisateur connecté au CRM, sinon le compte principal du CRM (jamais le mot de passe). */
const loginHint = () => { try { return localStorage.getItem(LAST_LOGIN) || LS("sanix_crm_whoami")?.login || Object.keys(LOGIN_ALIASES)[0] || ""; } catch { return ""; } };
function showLogin(msg = "") {
  gate(html`<h1 id="gate-title">SANIX AI VIRTUAL COMPANY</h1><div class="muted small">Accès réservé aux opérateurs de SANIX AFRICA</div>
    <form id="login-form"><label class="f">Identifiant ou e-mail<input id="l-mail" type="text" required value="${loginHint()}" autocomplete="username" autocapitalize="off" spellcheck="false"></label>
    <label class="f">Mot de passe<input id="l-pass" type="password" required autocomplete="current-password"></label>
    <div class="err" id="l-err" role="alert">${msg}</div><button class="btn pri" type="submit">Se connecter</button></form>
    <p class="small muted" id="cfg-info" style="margin:12px 0 0">Projet : ${cfgSummary(S.cfg)} · <a href="#" id="cfg-reset">Changer de projet Supabase</a></p>`);
  $("#cfg-reset").onclick = (e) => { e.preventDefault(); showConfig(); };
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const err = $("#l-err");
    if (Date.now() < lockUntil) { err.textContent = "Trop de tentatives : patientez une minute."; return; }
    const id = $("#l-mail").value.trim(), email = resolveLogin(id);
    if (!email.includes("@")) { err.textContent = "Identifiant inconnu : saisissez l'e-mail de votre compte opérateur."; return; }
    const { error } = await S.sb.auth.signInWithPassword({ email, password: $("#l-pass").value });
    $("#l-pass").value = "";
    if (error) { if (++fails >= 5) { lockUntil = Date.now() + 60000; fails = 0; } err.textContent = loginMessage(error, (() => { try { return new URL(S.cfg.url).hostname; } catch { return ""; } })()); return; }
    fails = 0; try { localStorage.setItem(LAST_LOGIN, id); } catch { /* stockage indisponible : sans conséquence */ }
    await start();
  };
}

// ───────────────────────── Données ─────────────────────────
const TASK_COLS = "id,parent_id,racine_id,agent_id,donneur_agent_id,donneur_user_id,type,titre,statut,priorite,echeance,progression,rapport,resultats,evaluation,evaluation_commentaire,cout_usd,created_at,finished_at,reunion_id,objectifs,executions,profondeur";

async function loadCore() {
  const [agents, depts, tasks, approvals] = await Promise.all([
    q(S.sb.from("ai_agents").select("*").order("niveau").order("nom")),
    q(S.sb.from("ai_departments").select("*").order("ordre")),
    q(S.sb.from("ai_agent_tasks").select(TASK_COLS).order("created_at", { ascending: false }).limit(400)),
    q(S.sb.from("ai_approvals").select("*, ai_prospects(entreprise)").eq("statut", "en_attente").order("created_at")),
  ]);
  Object.assign(S, { agents, depts, tasks, approvals });
  const first = !S.taskStatus.size; for (const t of tasks) noteTask(t, first);
  try { await loadOfficeMeetings(); } catch (e) { console.warn("réunions", e.message); }
  if (isDir()) {
    const [gov, budget] = await Promise.all([q(S.sb.from("ai_governance").select("*").eq("id", 1).single()), q(S.sb.rpc("ai_budget_status"))]);
    Object.assign(S, { gov, budget });
  }
  try { S.kpis = (await q(S.sb.from("ai_kpis").select("*")))[0] ?? null; } catch { S.kpis = null; }
  try { S.products = await q(S.sb.from("ai_products").select("id,nom").eq("actif", true).order("nom")); } catch { S.products = []; }
}
async function loadMeetings() { S.meetings = await q(S.sb.from("ai_agent_meetings").select("*").order("created_at", { ascending: false }).limit(40)); }
async function loadReports() {
  const [reports, settings, recipients] = await Promise.all([
    q(S.sb.from("ai_daily_reports").select("id,type,periode_debut,periode_fin,statut,destinataires,pdf_path,erreur,cout_usd,created_at,envoye_at").order("created_at", { ascending: false }).limit(60)),
    q(S.sb.from("ai_report_settings").select("*")), q(S.sb.from("ai_report_recipients").select("*").order("created_at")),
  ]);
  Object.assign(S, { reports, settings, recipients });
}
async function loadStats() {
  const fin = new Date(), debut = new Date(fin.getTime() - S.statDays * 86400e3);
  S.stats = await q(S.sb.rpc("ai_agent_stats", { p_debut: debut.toISOString(), p_fin: fin.toISOString() }));
}
CFG.setHooks({ reloadCore: () => loadCore() });
const LOADERS = { exec: async () => { await loadExec(); await loadCrm(); }, meet: loadMeetings, reports: loadReports, perf: loadStats, sales: SALES.loadSales, cfg: CFG.loadConfig };

/** Notifie le président quand une mission qu'il a demandée change d'issue (terminée, bloquée, échouée). */
function noteTask(t, firstLoad = false) {
  const prev = S.taskStatus.get(t.id); S.taskStatus.set(t.id, t.statut);
  if (firstLoad || !prev || prev === t.statut || !S.op || t.donneur_user_id !== S.op.user_id) return;
  const who = agentBy(t.agent_id)?.nom ?? "Un collaborateur";
  if (t.statut === "terminee") toast(`✅ ${who} a terminé : ${clipT(t.titre, 70)} — voir le résultat`, "ok", () => showTask(t.id));
  else if (["echouee", "bloquee"].includes(t.statut)) toast(`⚠️ ${who} : mission ${TASK_ST[t.statut][0].toLowerCase()} — ${clipT(t.titre, 60)}`, "bad", () => showTask(t.id));
}

let refreshT = null;
async function refreshNow() {
  try {
    await loadCore(); if (LOADERS[S.tab]) await LOADERS[S.tab]();
    if (S.dlg) { await loadExec(); P.renderDialog(); }
    render(true);
  } catch (e) { console.warn("refresh", e.message); }
}
function scheduleRefresh(ms = 500) { clearTimeout(refreshT); refreshT = setTimeout(refreshNow, ms); }

let wasDown = false, hiddenAt = 0;
function subscribe() {
  try {
    const ch = S.sb.channel("vc-live"), on = (table, event, cb) => ch.on("postgres_changes", { event, schema: "public", table }, cb);
    // état et activité des agents : mise à jour incrémentale (aucun rechargement, les avatars se réconcilient)
    on("ai_agents", "UPDATE", (p) => { if (!P.agentChanged(p.new)) scheduleRefresh(); });
    on("ai_agents", "INSERT", () => scheduleRefresh());
    on("ai_agent_events", "INSERT", (p) => P.eventReceived(p.new));
    on("ai_agent_meetings", "*", async () => { try { await loadOfficeMeetings(); S.office?.setMeetings(S.officeMeetings); } catch (e) { console.warn("réunions", e.message); } if (S.tab === "meet") scheduleRefresh(); });
    on("ai_meeting_participants", "INSERT", async () => { try { await loadOfficeMeetings(); S.office?.setMeetings(S.officeMeetings); } catch { /* repris au prochain rafraîchissement */ } });
    on("ai_agent_tasks", "*", (p) => { if (p.new?.id) noteTask(p.new); scheduleRefresh(); });
    for (const t of ["ai_executive_messages", "ai_approvals"]) on(t, "*", () => scheduleRefresh());
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") { P.setSync("live"); if (wasDown) { wasDown = false; scheduleRefresh(50); } }   // rattrapage de ce qui a été manqué
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) { wasDown = true; P.setSync("reconnecting"); }
    });
  } catch (e) { console.warn("realtime", e.message); P.setSync("offline"); }
  setInterval(() => { if (S.heartbeat !== false && !document.hidden) scheduleRefresh(); }, 20000);   // (S.heartbeat = false : désactivé par les tests de synchronisation incrémentale)   // filet de sécurité si le temps réel est coupé
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (Date.now() - hiddenAt > 15000) scheduleRefresh(50);   // retour sur l'onglet : état réel immédiat
  });
  addEventListener("online", () => scheduleRefresh(50));
  addEventListener("offline", () => P.setSync("offline"));
}

// ───────────────────────── Navigation ─────────────────────────
const TABS = [
  { id: "office", label: "🏢 Bureau 3D" }, { id: "exec", label: "👔 Bureau du Président", dir: true }, { id: "org", label: "🧩 Organisation" },
  { id: "tasks", label: "📋 Missions" }, { id: "sales", label: "💼 Commercial" }, { id: "meet", label: "🤝 Réunions" }, { id: "perf", label: "📈 Performance" },
  { id: "reports", label: "📨 Rapports", dir: true }, { id: "gov", label: "⚖️ Gouvernance", dir: true }, { id: "cfg", label: "🛠️ Paramétrage", dir: true }, { id: "valid", label: "✅ Validations" },
];
const visibleTabs = () => TABS.filter((t) => !t.dir || isDir());

function renderTabs() {
  $("#tabs").innerHTML = visibleTabs().map((t) => `<button role="tab" type="button" data-act="tab" data-id="${t.id}" aria-selected="${t.id === S.tab}">${esc(t.label)}${t.id === "valid" && S.approvals.length ? `<span class="badge">${S.approvals.length}</span>` : ""}</button>`).join("");
}
async function go(tab) {
  if (!visibleTabs().some((t) => t.id === tab)) tab = "office";
  S.tab = tab; history.replaceState(null, "", `#${tab}`);
  try { if (LOADERS[tab]) await LOADERS[tab](); } catch (e) { toast(e.message, "bad"); }
  render();
}

function renderChips() {
  const g = S.gov, b = S.budget, c = [];
  const n = live().filter((a) => a.etat === "actif").length;
  c.push(html`<span class="chip ok" title="Collaborateurs actifs / plafond"><i></i>${n}${g ? ` / ${g.max_agents_actifs}` : ""} agents</span>`);
  c.push(html`<span class="chip" title="Missions actives"><i></i>${S.tasks.filter((t) => OPEN.includes(t.statut)).length} missions</span>`);
  if (b) c.push(html`<span class="chip ${b.jour_usd >= b.budget_jour_usd * 0.85 ? "warn" : ""}" title="Coût IA du jour / budget quotidien"><i></i>IA ${num(b.jour_usd, 2)} / ${num(b.budget_jour_usd, 0)} $</span>`);
  if (g && !g.actif) c.push(html`<span class="chip bad"><i></i>Entreprise en pause</span>`);
  if (g) c.push(html`<span class="chip ${g.communication_externe === "autonome" ? "warn" : ""}" title="Communication externe vers les prospects"><i></i>Com. externe : ${{ interdite: "interdite", validation: "validée par vous", autonome: "autonome" }[g.communication_externe]}</span>`);
  $("#status-chips").innerHTML = c.map((x) => x.s).join("");
  $("#who").textContent = `${S.op.nom} · ${S.op.role}`;
}

function render(soft = false) {
  renderTabs(); renderChips();
  const main = $("#main");
  if (S.tab !== "office") S.office?.setActive(false);
  if (S.tab === "office") { P.renderOffice(main); return; }
  if (soft && ["exec"].includes(S.tab)) { renderExec(main, true); return; }
  const R = { exec: renderExec, org: renderOrg, tasks: renderTasks, sales: SALES.renderSales, meet: renderMeetings, perf: renderPerf, reports: renderReports, gov: renderGov, cfg: CFG.renderConfig, valid: renderValid }[S.tab];
  const keepScroll = main.scrollTop;
  R(main); if (soft) main.scrollTop = keepScroll;
}

// ───────────────────────── Bureau du Président ─────────────────────────
/** Résultats commerciaux du CRM (données centrales partagées avec le CRM) : ventes, objectif, rendez-vous, missions en retard, anomalies ; arbitrage direct des missions. */
const FCFA = (n) => `${num(n ?? 0)} FCFA`;
function crmCard() {
  const c = S.crm; if (!c) return html``;
  const pct = c.objectif_mensuel_fcfa ? Math.min(100, Math.round((c.ca_commandes_mois / c.objectif_mensuel_fcfa) * 100)) : 0;
  const retard = c.missions_en_retard ?? [], anos = c.anomalies ?? [], offres = Object.entries(c.offres ?? {}).map(([k, v]) => `${v} ${k}`).join(", ");
  return html`<h3 style="margin:0 0 6px" id="crm-card-h">Activité commerciale (CRM)</h3>
    <div class="small">Prospects <b>${c.prospects}</b> · Clients <b>${c.clients}</b> · Rendez-vous à venir <b>${c.rdv_a_venir}</b></div>
    <div class="small">Ventes du mois <b>${FCFA(c.ca_commandes_mois)}</b> · encaissé ${FCFA(c.encaisse_mois)}</div>
    <div class="small muted">Objectif mensuel ${FCFA(c.objectif_mensuel_fcfa)} : ${pct} %</div>
    <div style="height:8px;background:rgba(148,163,184,.3);border-radius:4px;margin:3px 0 6px"><i style="display:block;height:8px;width:${pct}%;background:#22c55e;border-radius:4px"></i></div>
    <div class="small">Ventes obtenues par l'IA : <b>${FCFA(c.ca_ia_total)}</b> · Offres : ${offres || "aucune"}</div>
    <div class="small muted">Missions ouvertes ${c.missions_ouvertes} · validations ${c.validations_en_attente} · synchronisation : ${c.sync?.en_attente ?? 0} en attente, ${c.sync?.en_echec ?? 0} en reprise, ${c.sync?.morts ?? 0} bloqué(s)</div>
    ${retard.length ? html`<h4 style="margin:8px 0 2px">Missions en retard</h4>${retard.slice(0, 5).map((m) => html`<div class="small" style="margin:3px 0"><a href="#" data-act="task" data-id="${m.id}">${clipT(m.titre, 46)}</a> · ${m.agent}
      <button class="btn sm" type="button" data-act="crm-arb" data-task="${m.id}" data-a="prioritize">⬆ Prioriser</button> <button class="btn sm bad" type="button" data-act="crm-arb" data-task="${m.id}" data-a="cancel">✖ Annuler</button></div>`)}` : ""}
    ${anos.length ? html`<h4 style="margin:8px 0 2px">Anomalies remontées</h4>${anos.slice(0, 5).map((x) => html`<div class="small" style="margin:3px 0">⚠️ ${clipT(x.message ?? x.type, 90)} <span class="muted">${ago(x.created_at)}</span></div>`)}` : ""}
    <hr style="border:0;border-top:1px solid rgba(148,163,184,.3);margin:10px 0">`;
}
/** Exemples d'instructions : bâtis sur les logiciels actifs du catalogue (aucun nom de logiciel figé dans le code). */
function quickInstructions() {
  const noms = (S.products ?? []).map((p) => p.nom), a = noms[0], b = noms[1];
  return [
    a ? `Notre priorité ce mois-ci est de développer les ventes de ${a}${b ? ` et de ${b}` : ""}. Organise les équipes nécessaires et présente-moi ton plan.` : "Présente-moi l'organisation actuelle et propose un plan d'action commercial.",
    "Analyse les performances de tous les agents cette semaine.",
    "Pourquoi l'équipe commerciale n'a-t-elle obtenu aucun contrat cette semaine ?",
    "Identifie les agents les moins performants et propose une réorganisation.",
    a ? `Prépare une stratégie de développement de ${a} sur un nouveau marché et constitue l'équipe nécessaire.` : "Prépare une stratégie de développement commercial.",
  ];
}
function renderExec(main, soft = false) {
  const intro = html`<div class="muted" style="margin:auto;text-align:center;max-width:460px"><h2>SANIX AI EXECUTIVE OFFICE</h2><p>Donnez vos instructions directement à ${dgName()}. Il élabore le plan, crée les collaborateurs nécessaires, supervise l'exécution et vous demande validation au-delà de ses délégations.</p></div>`;
  const body = chatBody(intro).s;
  if (soft && $("#msgs")) {
    const el = $("#msgs"), nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    el.innerHTML = body; if (nearEnd) el.scrollTop = el.scrollHeight;
    const side = $("#exec-side"); if (side) side.innerHTML = crmCard().s + approvalsInline().s;
    return;
  }
  main.innerHTML = html`<section class="panel"><div class="exec"><div class="card chat" style="padding:0"><div class="msgs" id="msgs" tabindex="0" aria-label="Conversation avec le directeur général IA">${raw(body)}</div>
    <div class="quick">${quickInstructions().map((t, i) => html`<button type="button" data-act="quick" data-i="${i}">${clipT(t, 54)}</button>`)}</div>
    <form class="compose" id="exec-form"><textarea id="exec-t" rows="2" maxlength="4000" placeholder="Votre instruction au directeur général IA…" aria-label="Instruction"></textarea><button class="btn pri" type="submit" id="exec-send">Envoyer</button></form></div>
    <aside class="card" id="exec-side" style="overflow:auto">${crmCard()}${approvalsInline()}</aside></div></section>`.s;
  const el = $("#msgs"); el.scrollTop = el.scrollHeight;
  $("#exec-form").onsubmit = sendInstruction;
  $("#exec-t").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("#exec-form").requestSubmit(); } });
  if (S.prefill) { $("#exec-t").value = S.prefill; S.prefill = null; $("#exec-t").focus(); }
}
const approvalsInline = () => html`<h3 style="margin:0 0 6px">Décisions attendues</h3>${S.approvals.length ? S.approvals.slice(0, 8).map(approvalCard) : html`<p class="muted small">Aucune validation en attente.</p>`}${S.approvals.length > 8 ? html`<button class="btn sm" data-act="tab" data-id="valid">Voir les ${S.approvals.length} validations</button>` : ""}`;
async function sendInstruction(e) {
  e.preventDefault();
  const t = $("#exec-t").value.trim(); if (t.length < 3 || S.busy) return;
  S.busy = true; $("#exec-send").disabled = true; S.pendingInstruction = true;
  try {
    const r = await callFn("instruction", { contenu: t });
    $("#exec-t").value = "";
    if (r?.ok === false) toast(r.raison ?? "Instruction non traitée", "bad"); else toast("Instruction transmise au directeur général", "ok");
    await loadExec(); await loadCore();
  } catch (err) { toast(err.message, "bad"); }
  finally { S.busy = false; S.pendingInstruction = false; if (S.tab === "exec") renderExec($("#main"), true); }
}

// ───────────────────────── Validations ─────────────────────────
const APP_LABEL = { remise: "💸 Remise commerciale", contrat: "📝 Contrat", paiement: "💰 Paiement", engagement: "⚖️ Engagement", transfert_humain: "🙋 Transfert à un humain", message: "💬 Message externe", creation_agent: "🧑‍💼 Création d'agent", ressources: "📈 Demande de ressources", mission: "📋 Mission", outil_externe: "📡 Outil de communication externe" };
function approvalDetail(a) {
  const p = a.payload ?? {};
  if (a.type === "message") return html`<div class="small muted" style="white-space:pre-wrap">${clipT(p.apercu, 600)}</div>`;
  if (a.type === "ressources") return html`<div class="small muted">${p.justification}</div>`;
  if (a.type === "remise") return html`<div class="small">Offre ${p.reference} · ${num(p.total_ht)} FCFA HT</div>`;
  if (a.type === "creation_agent" || a.type === "outil_externe") return html`<div class="small muted">${p.mission ? html`${p.mission}<br>` : ""}Outils : ${(p.outils ?? p.add_tools ?? []).join(", ") || "—"}</div>`;
  if (a.type === "engagement" && p.details) return html`<div class="small muted">${p.details}</div>`;
  return "";
}
function approvalCard(a) {
  const ag = agentBy(a.agent_id);
  return html`<div class="card" style="margin:8px 0;padding:11px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${APP_LABEL[a.type] ?? a.type}</b><span class="small muted">${ago(a.created_at)}</span></div>
    <div class="small">${a.ai_prospects?.entreprise ? html`<b>${a.ai_prospects.entreprise}</b> — ` : ""}${a.motif}</div>${approvalDetail(a)}${ag ? html`<div class="small muted">Demandé par ${ag.nom}</div>` : ""}
    ${isDir() ? html`<div class="actions"><button class="btn sm ok" type="button" data-act="decide" data-id="${a.id}" data-ok="1">✔ Approuver</button><button class="btn sm bad" type="button" data-act="decide" data-id="${a.id}" data-ok="0">✖ Refuser</button></div>` : ""}</div>`;
}
function renderValid(main) {
  const groups = {}; for (const a of S.approvals) (groups[a.type] ??= []).push(a);
  main.innerHTML = html`<section class="panel"><h2>Validations en attente</h2><p class="sub">Décisions qui dépassent les délégations des collaborateurs IA.</p>
    ${Object.keys(groups).length ? Object.entries(groups).map(([t, l]) => html`<div style="display:flex;align-items:center;gap:10px;margin:16px 0 4px"><h3 style="margin:0">${APP_LABEL[t] ?? t} (${l.length})</h3>
      ${isDir() && l.length > 1 ? html`<button class="btn sm ok" type="button" data-act="decide-batch" data-type="${t}" data-ok="1">Tout approuver</button><button class="btn sm bad" type="button" data-act="decide-batch" data-type="${t}" data-ok="0">Tout refuser</button>` : ""}</div><div class="grid g2" data-paginate data-pg-size="10" data-pg-sizes="10,25,50">${l.map(approvalCard)}</div>`) : html`<div class="card muted">Aucune validation en attente. 👌</div>`}</section>`.s;
}
async function decide(ids, ok, commentaire = null) {
  try {
    if (ids.length === 1) await q(S.sb.rpc("ai_decide_approval", { p_id: ids[0], p_ok: ok, p_commentaire: commentaire }));
    else await q(S.sb.rpc("ai_decide_approvals_batch", { p_ids: ids, p_ok: ok, p_commentaire: commentaire }));
    toast(ok ? "Validé" : "Refusé", "ok"); await loadCore(); render();
  } catch (e) { toast(e.message, "bad"); }
}

// ───────────────────────── Organisation ─────────────────────────
function renderOrg(main) {
  const l = live(), kids = (id) => l.filter((a) => a.manager_id === id);
  const node = (a) => html`<li><div class="node" style="--c:${deptColor(a.departement_id)}" role="button" tabindex="0" data-act="open-agent" data-id="${a.id}"><div><b>${a.nom}</b><small>${a.fonction} · ${LEVELS[a.niveau]}</small></div><div style="margin-left:auto">${stPill(a)}</div></div>${kids(a.id).length ? html`<ul>${kids(a.id).map(node)}</ul>` : ""}</li>`;
  const roots = l.filter((a) => !a.manager_id || !agentBy(a.manager_id) || agentBy(a.manager_id).etat === "archive");
  const byDept = {}; for (const a of l) byDept[a.departement_id] = (byDept[a.departement_id] ?? 0) + 1;
  main.innerHTML = html`<section class="panel"><h2>Organisation</h2><p class="sub">Direction SANIX AFRICA → directeur général IA → directions → équipes. Chaque responsable gère ses collaborateurs dans les limites de ses autorisations.</p>
    <div class="tags" style="margin-bottom:12px">${S.depts.map((d) => html`<span class="pill" style="--c:${deptColor(d.id)}"><i></i>${d.nom} · ${byDept[d.id] ?? 0}</span>`)}</div>
    <ul class="tree">${roots.map(node)}</ul></section>`.s;
}

// ───────────────────────── Missions ─────────────────────────
function renderTasks(main) {
  const f = S.filters, byParent = {};
  for (const t of S.tasks) (byParent[t.parent_id ?? ""] ??= []).push(t);
  const ids = new Set(S.tasks.map((t) => t.id));
  const match = (t) => (!f.statut || t.statut === f.statut) && (!f.agent || t.agent_id === f.agent) && (!f.q || (t.titre ?? "").toLowerCase().includes(f.q.toLowerCase()));
  const subtree = (t) => match(t) || (byParent[t.id] ?? []).some(subtree);
  const row = (t) => html`<details class="t" ${(t.profondeur ?? 0) <= 1 ? "open" : ""}><summary>${pill(...TASK_ST[t.statut] ?? [t.statut, "#64748B"])}<b style="flex:1;min-width:180px">${clipT(t.titre, 110)}</b>
    <span class="small muted">${agentBy(t.agent_id)?.nom ?? "—"}</span><span class="tag">P${t.priorite}</span>${t.echeance ? html`<span class="small muted">⏱ ${fmtDT(t.echeance)}</span>` : ""}${t.evaluation != null ? html`<span class="tag">Note ${t.evaluation}/100</span>` : ""}<span class="small muted">${usd(t.cout_usd)}</span>
    <button class="btn sm" type="button" data-act="task" data-id="${t.id}">Détail</button></summary><div class="in">${(byParent[t.id] ?? []).filter(subtree).map(row)}${t.rapport ? html`<div class="small muted" style="margin:6px 0">${clipT(t.rapport, 260)}</div>` : ""}</div></details>`;
  const roots = S.tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id)).filter(subtree);
  main.innerHTML = html`<section class="panel"><h2>Missions</h2><p class="sub">Arbre des missions : instruction du président → directions → équipes. Chaque délégation et chaque transmission est tracée.</p>
    <div class="filters"><select id="f-st" aria-label="Statut"><option value="">Tous les statuts</option>${Object.entries(TASK_ST).map(([k, v]) => html`<option value="${k}" ${f.statut === k ? "selected" : ""}>${v[0]}</option>`)}</select>
    <select id="f-ag" aria-label="Agent"><option value="">Tous les agents</option>${live().map((a) => html`<option value="${a.id}" ${f.agent === a.id ? "selected" : ""}>${a.nom}</option>`)}</select>
    <input id="f-q" type="search" placeholder="Rechercher une mission" value="${f.q}"></div>
    ${roots.length ? html`<div id="task-roots" data-paginate data-pg-size="10" data-pg-sizes="10,25,50">${roots.map(row)}</div>` : html`<div class="card muted">Aucune mission${S.tasks.length ? " pour ces filtres" : " pour le moment : donnez une instruction au directeur général IA"}.</div>`}</section>`.s;
  $("#f-st").onchange = (e) => { f.statut = e.target.value; renderTasks(main); };
  $("#f-ag").onchange = (e) => { f.agent = e.target.value; renderTasks(main); };
  $("#f-q").oninput = (e) => { f.q = e.target.value; clearTimeout(S.qt); S.qt = setTimeout(() => { renderTasks(main); const i = $("#f-q"); i.focus(); i.setSelectionRange(f.q.length, f.q.length); }, 250); };
}
async function showTask(id) {
  const t = await q(S.sb.from("ai_agent_tasks").select("*").eq("id", id).single());
  const ag = agentBy(t.agent_id), don = agentBy(t.donneur_agent_id);
  openModal(html`<h3>${t.titre}</h3><div class="tags">${pill(...TASK_ST[t.statut] ?? [t.statut, "#64748B"])}<span class="tag">P${t.priorite}</span><span class="tag">${t.type}</span><span class="tag">Profondeur ${t.profondeur}</span></div>
    <dl class="kv"><dt>Responsable</dt><dd>${ag?.nom ?? "—"}</dd><dt>Donneur d'ordre</dt><dd>${don?.nom ?? (t.donneur_user_id ? "Président" : "—")}</dd><dt>Créée</dt><dd>${fmtDT(t.created_at)}</dd>
    <dt>Échéance</dt><dd>${fmtDT(t.echeance)}</dd><dt>Terminée</dt><dd>${fmtDT(t.finished_at)}</dd><dt>Exécutions</dt><dd>${t.executions} (reprises ${t.reprises})</dd><dt>Coût IA</dt><dd>${usd(t.cout_usd)}</dd>
    ${t.evaluation != null ? html`<dt>Évaluation</dt><dd>${t.evaluation}/100 — ${t.evaluation_commentaire ?? ""}</dd>` : ""}</dl>
    <h4>Description</h4><div class="pv">${t.description}</div>${(t.objectifs ?? []).length ? html`<h4>Objectifs</h4><ul>${t.objectifs.map((o) => html`<li>${o}</li>`)}</ul>` : ""}
    ${t.rapport ? html`<h4>Rapport</h4><div class="pv">${t.rapport}</div>` : ""}${(t.resultats ?? []).length ? html`<h4>Résultats</h4><ul>${t.resultats.map((r) => html`<li>${r}</li>`)}</ul>` : ""}
    ${t.progression ? html`<h4>Journal d'exécution</h4><div class="pv small muted">${t.progression}</div>` : ""}`);
}

// ───────────────────────── Réunions ─────────────────────────
function renderMeetings(main) {
  main.innerHTML = html`<section class="panel"><h2>Réunions entre collaborateurs</h2><p class="sub">Ordre du jour, contributions de chaque participant, procès-verbal et plan d'action.</p>
    ${S.meetings.length ? html`<div class="scroll"><table class="tbl"><thead><tr><th>Réunion</th><th>Convoquée par</th><th>Statut</th><th>Date</th><th class="num">Coût IA</th></tr></thead><tbody>
    ${S.meetings.map((m) => html`<tr class="click" data-act="meeting" data-id="${m.id}"><td><b>${m.titre}</b></td><td>${agentBy(m.convoque_par)?.nom ?? "—"}</td><td>${pill(...({ planifiee: ["Planifiée", "#64748B"], en_cours: ["En cours", "#A855F7"], terminee: ["Terminée", "#22C55E"], annulee: ["Annulée", "#64748B"], echouee: ["Échouée", "#EF4444"] }[m.statut]))}</td><td>${fmtDT(m.fin_at ?? m.created_at)}</td><td class="num">${usd(m.cout_usd)}</td></tr>`)}</tbody></table></div>` : html`<div class="card muted">Aucune réunion. Demandez au directeur général IA d'en convoquer une (ex. « Organise une réunion avec les responsables commercial, marketing et intelligence économique pour élaborer la stratégie d'ImmoSuite ERP »).</div>`}</section>`.s;
}
async function showMeeting(id) {
  const [m, parts, pv] = await Promise.all([q(S.sb.from("ai_agent_meetings").select("*").eq("id", id).single()), q(S.sb.from("ai_meeting_participants").select("*").eq("meeting_id", id).order("ordre")),
    q(S.sb.from("ai_meeting_minutes").select("*").eq("meeting_id", id).maybeSingle())]);
  openModal(html`<h3>${m.titre}</h3><p class="muted small">Convoquée par ${agentBy(m.convoque_par)?.nom ?? "—"} · ${fmtDT(m.created_at)} · coût ${usd(m.cout_usd)}</p><h4>Ordre du jour</h4><div class="pv">${m.ordre_du_jour}</div>
    <h4>Contributions</h4>${parts.map((p) => html`<div class="card" style="margin:6px 0"><b>${agentBy(p.agent_id)?.nom ?? "?"}</b><div class="pv small">${p.contribution ?? "— pas de contribution —"}</div></div>`)}
    ${pv ? html`<h4>Procès-verbal</h4><div class="pv">${pv.synthese}</div><h4>Décisions</h4><ul>${(pv.decisions ?? []).map((d) => html`<li>${d}</li>`)}</ul><h4>Plan d'action</h4>
      <ul>${(pv.plan_action ?? []).map((a) => html`<li><b>${a.titre}</b> — ${a.responsable_code} (P${a.priorite}, ${a.echeance_jours} j)${a.task_id ? "" : html` <span class="muted">· non créée${a.erreur ? ` : ${a.erreur}` : ""}</span>`}</li>`)}</ul>` : html`<p class="muted">Procès-verbal non disponible.</p>`}`);
}

// ───────────────────────── Performance ─────────────────────────
function renderPerf(main) {
  const rows = [...S.stats].filter((r) => r.etat !== "archive").sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const weak = rows.filter((r) => (r.score !== null && r.score < 50) || r.incidents >= 2 || r.etat === "suspendu");
  const tot = rows.reduce((s, r) => ({ a: s.a + r.attribuees, t: s.t + r.terminees, c: s.c + Number(r.cout_usd) }), { a: 0, t: 0, c: 0 });
  const bar = (v) => html`<div class="bar ${v >= 70 ? "" : v >= 50 ? "mid" : "low"}"><b style="width:${Math.max(0, Math.min(100, v ?? 0))}%"></b></div>`;
  main.innerHTML = html`<section class="panel"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div><h2>Performance des collaborateurs</h2><p class="sub">Évaluation automatique : réalisation, qualité, délais, coût IA, incidents.</p></div>
    <select id="p-days" aria-label="Période">${[1, 7, 30].map((d) => html`<option value="${d}" ${S.statDays === d ? "selected" : ""}>${d === 1 ? "Aujourd'hui" : `${d} derniers jours`}</option>`)}</select></div>
    <div class="grid g4" style="margin-bottom:12px"><div class="card kpi"><b>${tot.a}</b><span>Missions attribuées</span></div><div class="card kpi"><b>${tot.t}</b><span>Missions terminées</span></div><div class="card kpi"><b>${tot.a ? Math.round(tot.t / tot.a * 100) : 0} %</b><span>Taux de réalisation</span></div><div class="card kpi"><b>${usd(tot.c)}</b><span>Coût IA</span></div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Agent</th><th class="num">Attrib.</th><th class="num">Termin.</th><th class="num">Taux</th><th class="num">Qualité</th><th class="num">Délais</th><th class="num">Productivité</th><th class="num">Coût IA</th><th class="num">Incid.</th><th>Score</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr class="click" data-act="open-agent" data-id="${r.agent_id}"><td><b>${r.nom}</b><br><span class="small muted">${r.fonction}</span></td><td class="num">${r.attribuees}</td><td class="num">${r.terminees}</td><td class="num">${r.taux ?? "—"}${r.taux != null ? " %" : ""}</td><td class="num">${num(r.qualite, 1)}</td><td class="num">${r.respect_delais ?? "—"}${r.respect_delais != null ? " %" : ""}</td><td class="num">${r.productivite}</td><td class="num">${usd(r.cout_usd)}</td><td class="num">${r.incidents}</td><td style="min-width:120px">${r.score != null ? html`<b>${r.score}</b>${bar(r.score)}` : html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table></div>
    ${weak.length ? html`<div class="card" style="margin-top:12px"><h3 style="margin:0 0 6px">Collaborateurs à examiner</h3><ul>${weak.map((r) => html`<li><b>${r.nom}</b> — ${r.etat === "suspendu" ? "suspendu" : r.incidents >= 2 ? `${r.incidents} incidents` : `score ${r.score}`}</li>`)}</ul>
      ${isDir() ? html`<button class="btn pri sm" type="button" data-act="ask-reorg">Demander une réorganisation au directeur général</button>` : ""}</div>` : ""}</section>`.s;
  $("#p-days").onchange = async (e) => { S.statDays = Number(e.target.value); await loadStats(); renderPerf(main); };
}

// ───────────────────────── Rapports ─────────────────────────
const RT = { quotidien: "Quotidien", hebdomadaire: "Hebdomadaire", mensuel: "Mensuel", incident: "Incident" };
const ST_REPORT = { genere: ["Généré (non envoyé)", "#F59E0B"], envoye: ["Envoyé", "#22C55E"], echec: ["Échec d'envoi", "#EF4444"] };
const TZS = ["Africa/Abidjan", "Africa/Dakar", "Africa/Douala", "Africa/Lagos", "Africa/Casablanca", "Europe/Paris", "Europe/Brussels", "America/Montreal", "UTC"];
const DOW = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
function renderReports(main) {
  const sRow = (s) => html`<tr data-type="${s.type}"><td><b>${RT[s.type]}</b></td><td><label class="chk"><input type="checkbox" data-f="actif" ${s.actif ? "checked" : ""}> Actif</label></td>
    <td><input type="time" data-f="heure" value="${String(s.heure).slice(0, 5)}" ${s.type === "incident" ? "disabled" : ""}></td>
    <td><select data-f="fuseau">${[...new Set([s.fuseau, ...TZS])].map((z) => html`<option ${z === s.fuseau ? "selected" : ""}>${z}</option>`)}</select></td>
    <td>${s.type === "hebdomadaire" ? html`<select data-f="jour_semaine">${DOW.map((d, i) => html`<option value="${i + 1}" ${s.jour_semaine === i + 1 ? "selected" : ""}>${d}</option>`)}</select>` : s.type === "mensuel" ? html`<select data-f="jour_mois">${Array.from({ length: 28 }, (_, i) => html`<option value="${i + 1}" ${s.jour_mois === i + 1 ? "selected" : ""}>le ${i + 1}</option>`)}</select>` : html`<span class="muted small">${s.type === "incident" ? "immédiat" : "chaque jour"}</span>`}</td>
    <td><select data-f="format"><option value="html_pdf" ${s.format === "html_pdf" ? "selected" : ""}>HTML + PDF</option><option value="html" ${s.format === "html" ? "selected" : ""}>HTML</option></select></td>
    <td class="small muted">${s.dernier_envoi ? fmtDT(s.dernier_envoi) : "—"}</td><td><button class="btn sm" type="button" data-act="save-setting">Enregistrer</button></td></tr>`;
  main.innerHTML = html`<section class="panel"><h2>Rapports automatiques</h2><p class="sub">Le rapport quotidien part chaque jour à l'heure choisie (18 h, heure de Côte d'Ivoire par défaut) : vous n'avez pas besoin d'ouvrir le CRM.</p>
    <div class="actions" style="margin:0 0 12px"><button class="btn pri" type="button" data-act="gen" data-type="quotidien">Générer le rapport journalier maintenant</button><button class="btn" type="button" data-act="gen" data-type="hebdomadaire">Hebdomadaire</button><button class="btn" type="button" data-act="gen" data-type="mensuel">Mensuel</button></div>
    <h3>Planification</h3><div class="scroll"><table class="tbl"><thead><tr><th>Rapport</th><th>État</th><th>Heure</th><th>Fuseau</th><th>Fréquence</th><th>Format</th><th>Dernier envoi</th><th></th></tr></thead><tbody>${S.settings.sort((a, b) => ["quotidien", "hebdomadaire", "mensuel", "incident"].indexOf(a.type) - ["quotidien", "hebdomadaire", "mensuel", "incident"].indexOf(b.type)).map(sRow)}</tbody></table></div>
    <h3 style="margin-top:18px">Destinataires</h3><div class="scroll"><table class="tbl"><thead><tr><th>E-mail</th><th>Nom</th><th>Rapports reçus</th><th>Principal</th><th></th></tr></thead><tbody>
    ${S.recipients.map((r) => html`<tr data-id="${r.id}"><td>${r.email}</td><td>${r.nom ?? ""}</td><td>${Object.keys(RT).map((t) => html`<label class="chk" style="display:inline-flex;margin-right:10px"><input type="checkbox" data-act="rcp-type" data-t="${t}" ${(r.types ?? []).includes(t) ? "checked" : ""}> ${RT[t]}</label>`)}</td><td>${r.principal ? "★" : ""}</td><td><button class="btn sm bad" type="button" data-act="rcp-del">Retirer</button></td></tr>`)}</tbody></table></div>
    <form id="rcp-form" class="form" style="margin-top:10px;align-items:end"><label class="f">Nouvelle adresse<input id="rc-mail" type="email" required maxlength="200"></label><label class="f">Nom<input id="rc-nom" maxlength="120"></label><label class="chk"><input id="rc-main" type="checkbox"> Destinataire principal</label><button class="btn" type="submit">Ajouter</button></form>
    <h3 style="margin-top:22px">Historique (conservé dans SANIX CRM)</h3>
    ${S.reports.length ? html`<div class="scroll"><table class="tbl"><thead><tr><th>Rapport</th><th>Période</th><th>Statut</th><th>Destinataires</th><th class="num">Coût IA</th><th></th></tr></thead><tbody>${S.reports.map((r) => html`<tr><td><b>${RT[r.type]}</b><br><span class="small muted">${fmtDT(r.created_at)}</span></td><td class="small">${fmtD(r.periode_debut)}${r.type === "quotidien" ? "" : ` → ${fmtD(r.periode_fin)}`}</td><td>${pill(...ST_REPORT[r.statut])}${r.erreur ? html`<div class="small muted">${clipT(r.erreur, 90)}</div>` : ""}</td><td class="small">${(r.destinataires ?? []).join(", ") || "—"}</td><td class="num">${usd(r.cout_usd)}</td>
      <td class="nowrap"><button class="btn sm" type="button" data-act="rpt-view" data-id="${r.id}">Voir</button>${r.pdf_path ? html` <button class="btn sm" type="button" data-act="rpt-pdf" data-path="${r.pdf_path}">PDF</button>` : ""} <button class="btn sm" type="button" data-act="rpt-resend" data-id="${r.id}">Renvoyer</button></td></tr>`)}</tbody></table></div>` : html`<div class="card muted">Aucun rapport pour le moment.</div>`}</section>`.s;
  $("#rcp-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await q(S.sb.from("ai_report_recipients").insert({ email: $("#rc-mail").value.trim(), nom: $("#rc-nom").value.trim() || null, principal: $("#rc-main").checked }));
      toast("Destinataire ajouté", "ok"); await loadReports(); renderReports(main);
    } catch (err) { toast(/duplicate|unique/i.test(err.message) ? "Adresse déjà enregistrée" : err.message, "bad"); }
  };
}

// ───────────────────────── Gouvernance ─────────────────────────
const GOV_NUM = [
  ["max_agents_actifs", "Agents actifs simultanés (max)", 1, 500, 1], ["max_creations_jour", "Créations d'agents par jour (max)", 0, 200, 1],
  ["max_missions_actives", "Missions simultanées (max)", 1, 2000, 1], ["max_taches_agent", "Missions ouvertes par agent (max)", 1, 50, 1],
  ["max_sous_taches", "Sous-missions par mission (max)", 1, 100, 1], ["max_profondeur", "Profondeur de délégation (max)", 1, 10, 1],
  ["max_tours_execution", "Tours de réflexion par exécution", 1, 30, 1], ["max_executions_tache", "Essais par mission avant blocage", 1, 20, 1],
  ["max_participants_reunion", "Participants par réunion (max)", 2, 12, 1], ["taches_par_tick", "Missions exécutées en parallèle", 1, 20, 1],
  ["suspension_apres_incidents", "Suspension auto après N incidents", 1, 20, 1],
  ["budget_jour_usd", "Budget IA quotidien ($)", 0, 100000, 0.5], ["budget_mois_usd", "Budget IA mensuel ($)", 0, 1000000, 1], ["budget_agent_jour_usd", "Budget IA par agent et par jour ($)", 0, 10000, 0.5],
];
function gauge(label, v, max, fmt = (x) => x) {
  const r = max ? Math.min(100, v / max * 100) : 0;
  return html`<div class="gauge"><div class="l"><span>${label}</span><b>${fmt(v)} / ${fmt(max)}</b></div><div class="bar ${r > 90 ? "low" : r > 70 ? "mid" : ""}"><b style="width:${r}%"></b></div></div>`;
}
function renderGov(main) {
  const g = S.gov, b = S.budget;
  if (!g) { main.innerHTML = html`<section class="panel"><div class="card muted">Gouvernance non disponible.</div></section>`.s; return; }
  main.innerHTML = html`<section class="panel"><h2>Gouvernance de l'autonomie</h2><p class="sub">Le directeur général IA agit dans ces limites. Il peut demander plus de ressources en justifiant son besoin (vous le verrez dans Validations).</p>
    <div class="grid g2"><div class="card"><h3 style="margin-top:0">Consommation</h3>${gauge("Budget IA du jour", b.jour_usd, b.budget_jour_usd, usd)}${gauge("Budget IA du mois", b.mois_usd, b.budget_mois_usd, usd)}${gauge("Agents actifs", b.agents_actifs, b.max_agents_actifs)}${gauge("Missions actives", b.missions_actives, b.max_missions_actives)}${gauge("Créations d'agents aujourd'hui", b.creations_jour, b.max_creations_jour)}</div>
    <div class="card"><h3 style="margin-top:0">Autorisations</h3><label class="chk"><input type="checkbox" id="g-actif" ${g.actif ? "checked" : ""}> Entreprise virtuelle active (décocher = pause générale)</label>
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="g-auto" ${g.creation_autonome ? "checked" : ""}> Le directeur peut créer des agents sans validation</label>
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="g-ext" ${g.validation_outils_externes ? "checked" : ""}> Valider les agents dotés d'outils de communication externe</label>
      ${"consentement_requis" in g ? html`<label class="chk" style="margin-top:8px"><input type="checkbox" id="g-consent" ${g.consentement_requis ? "checked" : ""}> Exiger une preuve de consentement avant tout envoi (WhatsApp, e-mail) : un prospect sans preuve ne reçoit rien</label>` : ""}
      <label class="f" style="margin-top:10px">Communication externe (WhatsApp, e-mail aux prospects)<select id="g-comm"><option value="interdite" ${g.communication_externe === "interdite" ? "selected" : ""}>Interdite</option><option value="validation" ${g.communication_externe === "validation" ? "selected" : ""}>Chaque message validé par le président</option><option value="autonome" ${g.communication_externe === "autonome" ? "selected" : ""}>Autonome (messages envoyés directement)</option></select></label>
      <label class="f" style="margin-top:10px">Modèle d'IA<select id="g-model">${["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"].map((m) => html`<option ${g.modele === m ? "selected" : ""}>${m}</option>`)}</select></label></div></div>
    <form id="gov-form" class="card" style="margin-top:12px"><h3 style="margin-top:0">Limites</h3><div class="form">${GOV_NUM.map(([k, l, mn, mx, st]) => html`<label class="f">${l}<input type="number" name="${k}" min="${mn}" max="${mx}" step="${st}" value="${g[k]}" required></label>`)}</div>
    <div class="actions"><button class="btn pri" type="submit">Enregistrer la gouvernance</button></div></form></section>`.s;
  $("#gov-form").onsubmit = async (e) => {
    e.preventDefault();
    const patch = { actif: $("#g-actif").checked, creation_autonome: $("#g-auto").checked, validation_outils_externes: $("#g-ext").checked, communication_externe: $("#g-comm").value, modele: $("#g-model").value };
    if ($("#g-consent")) patch.consentement_requis = $("#g-consent").checked;
    for (const [k, , mn, mx] of GOV_NUM) {
      const v = Number(e.target.elements[k].value);
      if (!Number.isFinite(v) || v < mn || v > mx) { toast(`Valeur invalide : ${k}`, "bad"); return; }
      patch[k] = v;
    }
    try { await q(S.sb.from("ai_governance").update(patch).eq("id", 1)); toast("Gouvernance enregistrée", "ok"); await loadCore(); render(); }
    catch (err) { toast(err.message, "bad"); }
  };
}

// ───────────────────────── Actions (délégation d'événements) ─────────────────────────
async function showCharter(id) {
  const a = agentBy(id); const rows = await q(S.sb.from("ai_agent_charters").select("*").eq("agent_id", id).order("version", { ascending: false }));
  const c = rows[0]?.contenu ?? {};
  const L = { identite: "Identité", fonction: "Fonction", departement: "Département", mission_principale: "Mission principale", missions_secondaires: "Missions secondaires", competences: "Compétences requises", outils: "Outils accessibles", donnees: "Données accessibles", objectifs: "Objectifs quantitatifs", delais: "Délais d'exécution", indicateurs: "Indicateurs de performance", procedures: "Procédures de travail", limites: "Limites d'autonomie", responsable: "Responsable hiérarchique", reporting: "Modalités de reporting" };
  openModal(html`<h3>Cahier des charges — ${a?.nom}</h3><p class="muted small">Version ${rows[0]?.version ?? "—"}${rows.length > 1 ? ` · ${rows.length} versions` : ""}${rows[0] ? ` · rédigé ${fmtDT(rows[0].created_at)}` : ""}</p>
    <div class="charter">${Object.entries(L).map(([k, label], i) => html`<h4>${i + 1}. ${label}</h4>${Array.isArray(c[k]) ? html`<ul>${c[k].map((x) => html`<li>${x}</li>`)}</ul>` : html`<p>${c[k] ?? "—"}</p>`}`)}</div>`);
}
async function viewReport(id) {
  const r = await q(S.sb.from("ai_daily_reports").select("html,type").eq("id", id).single());
  openModal(html`<h3>Rapport ${RT[r.type].toLowerCase()}</h3><iframe class="rpt" sandbox="" title="Rapport"></iframe>`);
  $("#modal-box iframe").srcdoc = r.html;   // aucun script autorisé (sandbox) ; contenu échappé à la génération
}

const ACT = {
  ...P.acts,
  "sales-new": (el) => SALES.salesAction(el),
  "sales-open": (el) => SALES.salesAction(el),
  "sales-refresh": (el) => SALES.salesAction(el),
  "sales-more": (el) => SALES.salesAction(el),
  "sales-qualify": (el) => SALES.salesAction(el),
  "sales-contact": (el) => SALES.salesAction(el),
  "tab": (el) => go(el.dataset.id),
  "crm-arb": async (el) => {
    try { await q(S.sb.rpc("crm_arbitrate_task", { p_task: el.dataset.task, p_action: el.dataset.a, p_priorite: 1 })); toast(el.dataset.a === "cancel" ? "Mission annulée" : "Mission passée en priorité 1", "ok"); await loadCore(); await loadCrm(); render(true); }
    catch (e) { toast(e.message, "bad"); }
  },
  "close-modal": () => { closeModal(); $("#modal").dispatchEvent(new Event("close-ask")); },
  "task": (el, ev) => { ev.preventDefault(); return showTask(el.dataset.id); },
  "meeting": (el) => showMeeting(el.dataset.id),
  "charter": (el) => showCharter(el.dataset.id),
  "quick": (el) => { const t = $("#exec-t"); t.value = quickInstructions()[Number(el.dataset.i)]; t.focus(); },
  "ask-reorg": () => { S.prefill = "Identifie les agents les moins performants et propose une réorganisation."; go("exec"); },
  "decide": async (el) => {
    const ok = el.dataset.ok === "1";
    const c = ok ? null : await askText("Refuser la demande", "Motif (transmis à l'agent)", { requis: false });
    if (!ok && c === null) return;
    await decide([el.dataset.id], ok, c || null);
  },
  "decide-batch": async (el) => {
    const ids = S.approvals.filter((a) => a.type === el.dataset.type).map((a) => a.id), ok = el.dataset.ok === "1";
    if (!ids.length) return;
    const c = await askText(`${ok ? "Approuver" : "Refuser"} ${ids.length} demande(s)`, "Commentaire (optionnel)", { requis: false });
    if (c === null) return;
    await decide(ids, ok, c || null);
  },
  "agent-etat": async (el) => {
    const a = agentBy(el.dataset.id), etat = el.dataset.etat;
    const motif = await askText(`${{ actif: "Réactiver", suspendu: "Suspendre", archive: "Archiver" }[etat]} ${a.nom}`, "Motif", { placeholder: "Ex. : résultats insuffisants, mission terminée…" });
    if (!motif) return;
    try { await q(S.sb.rpc("ai_set_agent_etat", { p_agent: a.id, p_etat: etat, p_motif: motif })); toast("État mis à jour", "ok"); await loadCore(); render(); } catch (e) { toast(e.message, "bad"); }
  },
  "gen": async (el) => {
    el.disabled = true; toast("Génération du rapport en cours…");
    try { const r = await callFn("report_now", { type: el.dataset.type }); toast(r.statut === "envoye" ? "Rapport envoyé" : r.statut === "genere" ? "Rapport généré (e-mail non configuré ou sans destinataire)" : "Rapport généré, envoi en échec", r.statut === "echec" ? "bad" : "ok"); await loadReports(); render(); }
    catch (e) { toast(e.message, "bad"); } finally { el.disabled = false; }
  },
  "rpt-view": (el) => viewReport(el.dataset.id),
  "rpt-pdf": async (el) => {
    const { data, error } = await S.sb.storage.from("ai-reports").createSignedUrl(el.dataset.path, 120);
    if (error) toast(error.message, "bad"); else window.open(data.signedUrl, "_blank", "noopener");
  },
  "rpt-resend": async (el) => {
    try { const r = await callFn("report_resend", { id: el.dataset.id }); toast(r.statut === "envoye" ? "Rapport renvoyé" : "Renvoi impossible : " + (r.erreur ?? r.statut), r.statut === "envoye" ? "ok" : "bad"); await loadReports(); render(); } catch (e) { toast(e.message, "bad"); }
  },
  "save-setting": async (el) => {
    const tr = el.closest("tr"), type = tr.dataset.type, patch = {};
    for (const f of tr.querySelectorAll("[data-f]")) {
      const k = f.dataset.f; patch[k] = f.type === "checkbox" ? f.checked : ["jour_semaine", "jour_mois"].includes(k) ? Number(f.value) : f.value;
    }
    if (patch.heure && !/^\d{2}:\d{2}$/.test(patch.heure)) { toast("Heure invalide", "bad"); return; }
    try { await q(S.sb.from("ai_report_settings").update(patch).eq("type", type)); toast("Planification enregistrée", "ok"); await loadReports(); render(); } catch (e) { toast(e.message, "bad"); }
  },
  "rcp-type": async (el) => {
    const tr = el.closest("tr"), id = tr.dataset.id;
    const types = [...tr.querySelectorAll("[data-act=rcp-type]")].filter((c) => c.checked).map((c) => c.dataset.t);
    try { await q(S.sb.from("ai_report_recipients").update({ types }).eq("id", id)); toast("Abonnements mis à jour", "ok"); } catch (e) { toast(e.message, "bad"); }
  },
  "rcp-del": async (el) => {
    const id = el.closest("tr").dataset.id;
    try { await q(S.sb.from("ai_report_recipients").delete().eq("id", id)); await loadReports(); render(); } catch (e) { toast(e.message, "bad"); }
  },
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]"); if (!el || el.tagName === "INPUT") return;
  if (el.dataset.act.startsWith("cfg-")) { CFG.configAction(el, e); return; }     // écran Paramétrage : actions gérées par config_panel.js
  const f = ACT[el.dataset.act]; if (!f) return;
  Promise.resolve(f(el, e)).catch((err) => toast(err.message, "bad"));
});
document.addEventListener("change", (e) => {
  const cfgEl = e.target.closest("[data-act-change^=cfg-]"); if (cfgEl) { CFG.configAction(cfgEl, e); return; }
  const salesStage = e.target.closest("[data-sales-stage]"); if (salesStage) { SALES.changeSalesStage(salesStage); return; }
  const el = e.target.closest("[data-act=rcp-type]"); if (el) { ACT["rcp-type"](el); return; }
  const c = e.target.closest("[data-change]"); if (c) P.changes[c.dataset.change]?.(c);
});
document.addEventListener("input", (e) => { const c = e.target.closest("[data-input]"); if (c) P.inputs[c.dataset.input]?.(c); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modal").hidden) { ACT["close-modal"](); return; }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".node[data-act], tr[data-act]")) { e.preventDefault(); e.target.click(); }
});
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") ACT["close-modal"](); });
$("#logout").addEventListener("click", async () => { await S.sb.auth.signOut(); location.reload(); });
window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (t && t !== S.tab) go(t); });

// ───────────────────────── Démarrage ─────────────────────────
async function start() {
  const { data: { session } } = await S.sb.auth.getSession();
  if (!session) { showLogin(); return; }
  try {
    const op = await q(S.sb.from("ai_operators").select("user_id,nom,role,actif").eq("user_id", session.user.id).maybeSingle());
    if (!op || op.actif === false) {
      gate(html`<h1 id="gate-title">Accès refusé</h1><p class="muted">Ce compte n'est pas autorisé à utiliser SANIX AI VIRTUAL COMPANY. Demandez à la direction de vous enregistrer comme opérateur.</p><button class="btn" id="deny-out" type="button">Changer de compte</button>`);
      $("#deny-out").onclick = async () => { await S.sb.auth.signOut(); location.reload(); }; return;
    }
    S.op = op;
    P.initPanel({ go, showTask, showCharter, refreshCore: refreshNow });
    await loadCore();
    S.tab = visibleTabs().some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : "office";
    if (LOADERS[S.tab]) await LOADERS[S.tab]();
    hideGate(); render(); subscribe();
  } catch (e) {
    gate(html`<h1 id="gate-title">Connexion impossible</h1><p class="err">${e.message}</p><p class="muted small">Vérifiez que les migrations SQL sont appliquées sur ce projet Supabase.</p><button class="btn" id="retry" type="button">Réessayer</button>`);
    $("#retry").onclick = () => location.reload();
  }
}
if (new URLSearchParams(location.search).has("debug")) window.__vc = S;
(function boot() {
  S.cfg = readConfig();
  if (!S.cfg) {   // aucune configuration publique valide : si une clé non publique était enregistrée, on l'efface du navigateur et on dit pourquoi
    const bad = [CRM_CFG, OWN_CFG].map((k) => [k, LS(k)]).find(([, c]) => c?.key && keyProblem(c.key));
    if (bad) { localStorage.setItem(bad[0], JSON.stringify({ url: bad[1].url, key: "" })); localStorage.removeItem(OWN_CFG); }
    showConfig(bad ? keyProblem(bad[1].key) : ""); return;
  }
  if (!window.supabase) { gate(html`<h1>Bibliothèque indisponible</h1><p class="muted">Impossible de charger supabase-js (réseau ou bloqueur). Rechargez la page.</p>`); return; }
  S.sb = window.supabase.createClient(S.cfg.url, S.cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: window.sessionStorage } });
  start();
})();
