// État partagé de l'application, accès aux données (Supabase, RLS) et petits sélecteurs.
import { DEPT_COLORS, STATUS } from "./activity.js";
import { fmtDT, html, pill } from "./ui.js";

export const OPEN = ["a_faire", "en_cours", "attente_sous_taches", "attente_validation"];
export const TASK_ST = {
  a_faire: ["À faire", "#64748B"], en_cours: ["En cours", "#3B82F6"], attente_sous_taches: ["En attente des équipes", "#A855F7"],
  attente_validation: ["En attente de validation", "#F59E0B"], bloquee: ["Bloquée", "#EF4444"], terminee: ["Terminée", "#22C55E"],
  echouee: ["Échouée", "#EF4444"], annulee: ["Annulée", "#64748B"],
};
export const LEVELS = { 1: "Directeur général", 2: "Directeur", 3: "Responsable", 4: "Superviseur", 5: "Agent" };

export const S = {
  cfg: null, sb: null, op: null, tab: "office", agents: [], depts: [], tasks: [], approvals: [], gov: null, budget: null,
  meetings: [], officeMeetings: [], reports: [], settings: [], recipients: [], exec: [], stats: [], statDays: 7, selected: null, office: null, officeEl: null,
  officeOk: null, kpis: null, filters: { statut: "", agent: "", q: "" }, busy: false, pendingInstruction: false, taskStatus: new Map(),
};
export const isDir = () => !!S.op && ["direction", "admin"].includes(S.op.role);
export const live = () => S.agents.filter((a) => a.etat !== "archive");
export const agentBy = (id) => S.agents.find((a) => a.id === id);
export const dgName = () => live().find((a) => a.niveau === 1)?.nom ?? "Directeur général IA";
export const deptColor = (id) => DEPT_COLORS[id] ?? "#64748B";
export const stPill = (a) => { const k = a.etat === "suspendu" ? "suspendu" : a.activite in STATUS ? a.activite : "disponible"; return pill(STATUS[k].label, STATUS[k].color); };

export async function q(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }
export async function callFn(action, body = {}) {
  const { data, error } = await S.sb.functions.invoke("ai-company", { body: { action, ...body } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* corps non JSON */ }
    throw new Error(msg);
  }
  return data;
}
export async function loadExec() { S.exec = await q(S.sb.from("ai_executive_messages").select("*").order("created_at", { ascending: true }).limit(150)); }

/** Missions ouvertes par agent (le bureau 3D s'en sert pour distinguer « libre » de « occupé »). */
export function openByAgent() {
  const m = {}; for (const t of S.tasks) if (OPEN.includes(t.statut) && t.agent_id) m[t.agent_id] = (m[t.agent_id] ?? 0) + 1;
  return m;
}

/** Conversation avec le directeur général : état de réflexion et corps de la discussion (bureau du président et fenêtre de dialogue). */
export function execState() {
  const instr = S.tasks.filter((t) => t.type === "instruction" && OPEN.includes(t.statut));
  const working = S.pendingInstruction || instr.some((t) => ["en_cours", "a_faire"].includes(t.statut));
  const thinking = working || instr.length > 0;
  const waiting = thinking && !working ? S.tasks.filter((t) => OPEN.includes(t.statut) && t.type !== "instruction").length : 0;
  return { working, thinking, waiting };
}
export function chatBody(intro) {
  const { working, thinking, waiting } = execState();
  const msgs = S.exec.map((m) => html`<div class="msg ${m.auteur === "president" ? "p" : "d"}">${m.contenu}<small>${m.auteur === "president" ? "Vous" : dgName()} · ${fmtDT(m.created_at)}</small></div>`);
  return html`${msgs.length ? msgs : intro}${thinking ? html`<div class="think"><i></i>${working ? `${dgName()} travaille sur votre demande…` : `${dgName()} coordonne les équipes (${waiting} mission${waiting > 1 ? "s" : ""} en cours)`}</div>` : ""}`;
}

/** Réunions actives (planifiées / en cours) avec leurs participants : le bureau 3D y installe les agents autour de la table. */
export async function loadOfficeMeetings() {
  const ms = await q(S.sb.from("ai_agent_meetings").select("id,titre,ordre_du_jour,statut,phase,orateur_id,convoque_par").in("statut", ["planifiee", "en_cours"]).order("created_at", { ascending: false }).limit(20));
  const ps = ms.length ? await q(S.sb.from("ai_meeting_participants").select("meeting_id,agent_id").in("meeting_id", ms.map((m) => m.id))) : [];
  S.officeMeetings = ms.map((m) => ({ ...m, participants: ps.filter((p) => p.meeting_id === m.id).map((p) => p.agent_id) }));
}
