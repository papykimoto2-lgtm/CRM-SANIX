// Vocabulaire partagé : activités publiées par le moteur IA → libellé, animation 3D, groupe d'état.
// Doit rester identique à supabase/functions/_shared/company/presence.ts (ANIMATION_OF) : un test le vérifie.
export const ACTIVITIES = {
  disponible:             { label: "Disponible",                         anim: "idle" },
  recherche_prospects:    { label: "Recherche de prospects",             anim: "screen" },
  recherche_web:          { label: "Recherche sur le web",               anim: "screen" },
  consultation_documents: { label: "Consultation de documents",          anim: "documents" },
  analyse_donnees:        { label: "Analyse de données",                 anim: "multiscreen" },
  redaction_email:        { label: "Rédaction d'un e-mail",              anim: "typing" },
  conversation_whatsapp:  { label: "Conversation WhatsApp",              anim: "terminal" },
  appel_telephonique:     { label: "Planification d'un appel",           anim: "headset" },
  planification_rdv:      { label: "Planification de rendez-vous",       anim: "documents" },
  negociation:            { label: "Négociation commerciale",            anim: "talk" },
  management:             { label: "Organisation des équipes",           anim: "present" },
  preparation_rapport:    { label: "Préparation d'un rapport",           anim: "documents" },
  reunion:                { label: "En réunion",                         anim: "meeting" },
  mission_terminee:       { label: "Mission terminée",                   anim: "celebrate" },
  en_difficulte:          { label: "En difficulté",                      anim: "alert" },
  attente:                { label: "En attente",                         anim: "pause" },
};
export const ANIMATION_OF = Object.fromEntries(Object.entries(ACTIVITIES).map(([k, v]) => [k, v.anim]));

/** Animation de repli quand seul l'état grossier est connu (ancien moteur, événement perdu). */
export const COARSE_ANIM = { disponible: "idle", en_mission: "typing", en_reunion: "meeting", en_analyse: "multiscreen", attente_validation: "pause", en_difficulte: "alert", mission_terminee: "celebrate" };
const COARSE_DETAIL = { disponible: "disponible", en_mission: null, en_reunion: "reunion", en_analyse: null, attente_validation: "attente", en_difficulte: "en_difficulte", mission_terminee: "mission_terminee" };

export const PLACES = ["poste", "poste_agent", "reunion", "supervision", "collaboration", "detente", "departement"];

/** Activité détaillée effective d'un agent (détail publié par le moteur, sinon déduite de l'état grossier). */
export function detailOf(agent) {
  if (agent.etat === "suspendu") return "attente";
  const d = agent.activite_detail;
  if (d && ACTIVITIES[d]) return d;
  return COARSE_DETAIL[agent.activite] ?? null;
}
export function animOf(agent) {
  if (agent.etat === "suspendu") return "pause";
  const d = agent.activite_detail;
  if (d && ANIMATION_OF[d]) return ANIMATION_OF[d];
  return COARSE_ANIM[agent.activite] ?? "idle";
}

/** Groupe d'état affiché dans le tableau de supervision. */
export function statusOf(agent) {
  if (agent.etat === "suspendu") return { key: "suspendu", emoji: "⚪", label: "Suspendu", color: "#64748B" };
  if (agent.etat === "attente_validation") return { key: "attente", emoji: "🟡", label: "En attente", color: "#F59E0B" };
  const a = agent.activite;
  if (a === "en_difficulte") return { key: "difficulte", emoji: "🔴", label: "En difficulté", color: "#EF4444" };
  if (a === "attente_validation" || agent.activite_detail === "attente") return { key: "attente", emoji: "🟡", label: "En attente", color: "#F59E0B" };
  if (a === "mission_terminee") return { key: "termine", emoji: "🟢", label: "Mission terminée", color: "#EAB308" };
  if (a === "disponible" && (!agent.activite_detail || agent.activite_detail === "disponible")) return { key: "disponible", emoji: "🟢", label: "Disponible", color: "#22C55E" };
  return { key: "actif", emoji: "🟢", label: "Actif", color: "#22C55E" };
}

/** Texte d'activité du tableau de supervision : « Recherche de prospects · Trouver 50 promoteurs ». */
export function describeActivity(agent, taskTitle) {
  const d = detailOf(agent);
  const base = d ? ACTIVITIES[d].label : ({ en_mission: "En mission", en_analyse: "En analyse" }[agent.activite] ?? "Disponible");
  const showTask = taskTitle && !["disponible", "mission_terminee"].includes(d ?? "");
  return showTask ? `${base} · ${taskTitle}` : base;
}
