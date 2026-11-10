// Présence des agents dans le bureau virtuel : activité détaillée, déplacements, prises de parole.
// Le moteur publie l'état RÉEL (pas de mouvement aléatoire) ; l'interface 3D s'en inspire via Realtime.
// Règle d'or : la présence ne doit JAMAIS faire échouer une mission (toute erreur est avalée).
import { db, errMsg } from "../core.ts";
import type { AgentRow } from "./org.ts";

export type Place = "poste" | "poste_agent" | "reunion" | "supervision" | "collaboration" | "detente" | "departement";
export type Move = { lieu: Place; cible?: string | null; dept?: string | null; ms: number; motif?: string };
export type PendingMove = { who: string; move: Move; key: string };

/** Activité détaillée → animation 3D (doit rester identique à company/activity.js : vérifié par un test). */
export const ANIMATION_OF: Record<string, string> = {
  disponible: "idle", recherche_prospects: "screen", recherche_web: "screen", consultation_documents: "documents",
  analyse_donnees: "multiscreen", redaction_email: "typing", conversation_whatsapp: "terminal", appel_telephonique: "headset",
  planification_rdv: "documents", negociation: "talk", management: "present", preparation_rapport: "documents",
  reunion: "meeting", mission_terminee: "celebrate", en_difficulte: "alert", attente: "pause",
};

async function safe<T>(f: () => Promise<T>): Promise<T | null> {
  try { return await f(); } catch (e) { console.warn("presence:", errMsg(e)); return null; }
}

async function rpc(args: Record<string, unknown>): Promise<void> {
  const { error } = await db().rpc("ai_agent_presence", args);
  if (error) console.warn("presence:", error.message);
}

export async function publishActivity(agentId: string, activity: string, taskId: string | null = null): Promise<void> {
  await safe(() => rpc({ p_agent: agentId, p_kind: "activite", p_activity: activity, p_animation: ANIMATION_OF[activity] ?? null, p_task: taskId }));
}

export async function publishMove(agentId: string, m: Move, o: { kind?: "deplacement" | "briefing" | "reunion"; taskId?: string | null; meetingId?: string | null; participants?: string[] } = {}): Promise<void> {
  await safe(() => rpc({
    p_agent: agentId, p_kind: o.kind ?? "deplacement", p_animation: "walk", p_lieu: m.lieu, p_cible_agent: m.cible ?? null, p_cible_dept: m.dept ?? null,
    p_task: o.taskId ?? null, p_meeting: o.meetingId ?? null, p_participants: o.participants ?? [], p_duree_ms: m.ms, p_payload: m.motif ? { motif: m.motif } : {},
  }));
}

export async function publishSpeech(agentId: string, meetingId: string, extrait: string): Promise<void> {
  await safe(() => rpc({ p_agent: agentId, p_kind: "parole", p_activity: "reunion", p_animation: "speak", p_meeting: meetingId, p_payload: { extrait: extrait.replace(/\s+/g, " ").trim().slice(0, 220) } }));
}

/** Suit l'activité d'un agent pendant une exécution (évite les écritures redondantes). */
export class Presence {
  private last = "";
  constructor(public agentId: string, public taskId: string | null = null) {}
  async activity(a: string): Promise<void> {
    if (this.last === a) return;
    this.last = a;
    await publishActivity(this.agentId, a, this.taskId);
  }
}

export function activityFor(tool: string, input: Record<string, any>): string | null {
  switch (tool) {
    case "create_prospect": case "lister_prospects": return "recherche_prospects";
    case "get_prospect": case "get_product": case "recommend_products": case "rappeler": case "consulter_taches": case "memoriser": case "transmettre":
      return "consultation_documents";
    case "update_prospect": case "set_stage": case "consulter_indicateurs": case "consulter_performance": return "analyse_donnees";
    case "send_message": return input?.canal === "email" ? "redaction_email" : "conversation_whatsapp";
    case "schedule_followup": return input?.canal === "telephone" ? "appel_telephonique" : "planification_rdv";
    case "list_free_slots": return "planification_rdv";
    case "book_appointment": return input?.mode === "telephone" ? "appel_telephonique" : "planification_rdv";
    case "create_offer": case "get_objection": return "negociation";
    case "escalate_to_human": case "demander_validation": case "demander_ressources": case "attendre_sous_taches": return "attente";
    case "creer_agent": case "modifier_agent": case "changer_etat_agent": case "assigner_mission": case "evaluer_tache":
    case "convoquer_reunion": case "repondre_president": return "management";
    case "terminer_mission": case "record_appointment_report": case "propose_commercial_action": return "preparation_rapport";
    case "signaler_difficulte": return "en_difficulte";
    default: return null;
  }
}

/**
 * Fin de tour : traduit les actions du tour en déplacements.
 *  - ≥ 2 missions confiées à des agents distincts → réunion de cadrage dans l'espace de collaboration ;
 *  - sinon une visite au poste du collaborateur concerné (brief, remise de dossier, évaluation) ;
 *  - consultation des indicateurs → salle de supervision.
 */
export async function flushMoves(agent: AgentRow, moves: PendingMove[], assigned: Set<string>, taskId: string | null): Promise<void> {
  const todo = moves.splice(0);
  const group = assigned.size >= 2 ? [agent.id, ...assigned] : null;
  assigned.clear();
  if (group) {
    for (const id of group) await publishMove(id, { lieu: "collaboration", ms: 25000, motif: "cadrage" }, { kind: "briefing", taskId, participants: group });
  }
  const done = new Set<string>();
  for (const m of todo) {
    if (group && m.key.startsWith("assign:")) continue;   // remplacé par la réunion de cadrage
    const k = `${m.who}:${m.key}`;
    if (done.has(k)) continue;
    done.add(k);
    await publishMove(m.who, m.move, { taskId });
  }
}
