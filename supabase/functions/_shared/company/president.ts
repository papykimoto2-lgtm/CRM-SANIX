// Actions directes du président sur un collaborateur (depuis le bureau virtuel) :
// attribuer une mission, demander un rapport. Les missions passent par la file normale (gouvernance, budget, anti-doublon).
import { audit, clip, db, HttpError } from "../core.ts";

export type Operator = { user_id: string; nom: string; role: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v: unknown, max: number, champ: string, min = 3): string => {
  if (typeof v !== "string" || v.trim().length < min) throw new HttpError(400, `${champ} : texte de ${min} caractères minimum requis`);
  return v.trim().slice(0, max);
};
const int = (v: unknown, min: number, max: number, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};

async function target(agentId: unknown): Promise<{ id: string; nom: string }> {
  if (typeof agentId !== "string" || !UUID.test(agentId)) throw new HttpError(400, "agent_id invalide");
  const { data: a } = await db().from("ai_agents").select("id, nom, niveau, etat").eq("id", agentId).maybeSingle();
  if (!a) throw new HttpError(404, "Agent introuvable");
  if (a.niveau === 1) throw new HttpError(409, "Pour le directeur général, utilisez le dialogue : c'est une instruction");
  if (a.etat !== "actif") throw new HttpError(409, `${a.nom} n'est pas actif (${a.etat}) : validez ou réactivez-le d'abord`);
  return { id: a.id, nom: a.nom };
}

async function create(op: Operator, agent: { id: string; nom: string }, row: Record<string, unknown>, action: string): Promise<{ task_id: string; agent: string }> {
  const { data, error } = await db().from("ai_agent_tasks").insert({
    agent_id: agent.id, donneur_user_id: op.user_id, type: "mission", statut: "a_faire", ...row,
  }).select("id").single();
  if (error) {
    throw new HttpError(409, error.code === "23505" ? "Une mission identique est déjà ouverte pour cet agent" : error.message);
  }
  await audit({ agent: "president", action, agent_id: agent.id, task_id: data.id, payload: { par: op.user_id, titre: clip(row.titre, 120) } });
  return { task_id: data.id, agent: agent.nom };
}

export async function assignMission(op: Operator, body: Record<string, unknown>) {
  const agent = await target(body.agent_id);
  const objectifs = Array.isArray(body.objectifs) ? body.objectifs.filter((x) => typeof x === "string" && x.trim()).slice(0, 8).map((x) => String(x).trim().slice(0, 300)) : [];
  const heures = body.echeance_heures ? int(body.echeance_heures, 1, 2160, 24) : null;
  return await create(op, agent, {
    titre: text(body.titre, 200, "titre"), description: text(body.description, 8000, "description"), objectifs,
    priorite: int(body.priorite, 1, 5, 2), echeance: heures ? new Date(Date.now() + heures * 3600e3).toISOString() : null,
  }, "president_mission");
}

export async function requestReport(op: Operator, body: Record<string, unknown>) {
  const agent = await target(body.agent_id);
  const jours = int(body.jours, 1, 30, 7);
  return await create(op, agent, {
    titre: `Rapport d'activité demandé par le président (${jours} j)`,
    description: `Le président demande un rapport factuel sur ton activité des ${jours} derniers jours : missions terminées et en cours, résultats chiffrés, difficultés rencontrées, besoins et suites recommandées. Appuie-toi sur consulter_taches et rappeler ; n'invente aucun chiffre. Termine par terminer_mission avec ce rapport.`,
    objectifs: ["Rapport factuel, chiffré et daté", "Difficultés et besoins explicites"], priorite: 1,
  }, "president_rapport");
}
