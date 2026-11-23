// SANIX AI — Supervision opérationnelle des collaborateurs IA.
// Lecture seule : aucun changement d'état d'agent, de mission ou de communication externe.
import { ago, clipT, fmtDT, html, num, pill, usd } from "./ui.js";
import { OPEN, S, TASK_ST } from "./state.js";
import { STATUS } from "./activity.js";

const labelEtat = (a) => a.etat === "suspendu" ? ["Suspendu", "#64748B"] : a.etat === "attente_validation" ? ["En attente", "#F59E0B"] : (STATUS[a.activite] ? [STATUS[a.activite].label, STATUS[a.activite].color] : [a.activite || "Inconnu", "#64748B"]);
const sinceText = (iso) => iso ? ago(iso) : "Non renseigné";

export function renderSupervision(main) {
  const now = Date.now();
  const agents = S.agents.filter(a => a.etat !== "archive").slice().sort((a,b) => {
    const rank = x => x.etat === "suspendu" ? 4 : x.activite === "en_difficulte" ? 0 : x.etat === "attente_validation" ? 2 : 1;
    return rank(a)-rank(b) || String(a.nom).localeCompare(String(b.nom), "fr");
  });
  const stats = new Map((S.stats || []).map(x => [x.agent_id,x]));
  const tasksByAgent = new Map();
  for (const t of S.tasks) if (t.agent_id) { const list = tasksByAgent.get(t.agent_id) || []; list.push(t); tasksByAgent.set(t.agent_id,list); }
  const open = S.tasks.filter(t => OPEN.includes(t.statut));
  const late = open.filter(t => t.echeance && new Date(t.echeance).getTime() < now);
  const difficulties = agents.filter(a => a.etat !== "suspendu" && a.activite === "en_difficulte");
  const rows = agents.map(a => {
    const st = stats.get(a.id) || {};
    const ts = (tasksByAgent.get(a.id) || []).slice().sort((x,y) => new Date(y.created_at)-new Date(x.created_at));
    const active = ts.filter(t => OPEN.includes(t.statut));
    const overdue = active.filter(t => t.echeance && new Date(t.echeance).getTime() < now);
    const state = labelEtat(a);
    const stateAge = a.activite_depuis ? Math.max(0, now-new Date(a.activite_depuis).getTime()) : null;
    const prolonged = a.activite === "en_difficulte" && stateAge !== null && stateAge > 60*60*1000;
    return html`<article class="card" style="margin:8px 0">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start"><div><b>${a.nom}</b><div class="small muted">${a.fonction || ""} · ${a.departement_id || "—"}</div></div>${pill(state[0],state[1])}</div>
      <div class="grid g4" style="margin-top:10px"><div><div class="small muted">Missions ouvertes</div><b>${active.length}</b></div><div><div class="small muted">En retard</div><b style="${overdue.length ? "color:var(--danger)" : ""}">${overdue.length}</b></div><div><div class="small muted">Score 7 jours</div><b>${st.score == null ? "—" : num(st.score,1)+"/100"}</b></div><div><div class="small muted">Coût 7 jours</div><b>${usd(st.cout_usd)}</b></div></div>
      <div class="small muted" style="margin-top:8px">État déclaré depuis : ${sinceText(a.activite_depuis)} (${fmtDT(a.activite_depuis)}) · Incidents : ${num(st.incidents ?? a.incidents_consecutifs ?? 0)}</div>
      ${prolonged ? html`<p class="small" style="color:var(--danger);margin:6px 0 0">⚠️ État « en difficulté » inchangé depuis plus d'une heure : contrôle humain recommandé.</p>` : ""}
      ${active.length ? html`<div style="margin-top:8px"><b class="small">Missions ouvertes</b><ul class="small" style="margin:4px 0 0;padding-left:18px">${active.slice(0,3).map(t => html`<li>${clipT(t.titre,100)} — ${TASK_ST[t.statut]?.[0] ?? t.statut}${t.echeance ? " · échéance "+fmtDT(t.echeance) : ""}</li>`)}</ul></div>` : html`<p class="small muted" style="margin:8px 0 0">Aucune mission ouverte attribuée.</p>`}
    </article>`;
  });
  main.innerHTML = html`<section class="panel"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start"><div><h2>Supervision des agents IA</h2><p class="sub">Vue opérationnelle en lecture seule : état des agents, missions ouvertes, retards, performance et coût.</p></div><button class="btn" type="button" data-act="supervision-refresh">Actualiser</button></div>
    <div class="grid g4" style="margin:12px 0"><div class="card kpi"><b>${agents.filter(a=>a.etat==="actif").length}</b><span>Agents actifs</span></div><div class="card kpi"><b style="${difficulties.length?"color:var(--danger)":""}">${difficulties.length}</b><span>En difficulté</span></div><div class="card kpi"><b>${open.length}</b><span>Missions ouvertes</span></div><div class="card kpi"><b style="${late.length?"color:var(--danger)":""}">${late.length}</b><span>Missions en retard</span></div></div>
    ${difficulties.length ? html`<div class="card" style="border-left:4px solid var(--danger);margin-bottom:12px"><b>Agents à examiner</b><div class="small">${difficulties.map(a=>a.nom).join(" · ")}</div></div>` : ""}
    <p class="small muted">« État déclaré depuis » correspond à la date de changement du statut d'activité, pas à un heartbeat réseau. Un état ancien est un signal de contrôle, pas une preuve que l'agent est déconnecté. Les données de performance sont calculées sur les 7 derniers jours.</p>
    ${rows.length ? rows : html`<div class="card muted">Aucun agent disponible.</div>`}</section>`.s;
}
