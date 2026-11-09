// Pulsation de l'entreprise virtuelle (appelée chaque minute par le planificateur).
import { audit, db, errMsg } from "../core.ts";
import { flushOutbox } from "../outbox.ts";
import { loadGovernance } from "./org.ts";
import { runTask } from "./engine.ts";
import { runMeeting } from "./meetings.ts";

export type TickResult = {
  expires: number; outbox: { envoyes: number; en_file: number }; reunions: number; missions: number;
  ignore?: string; work: Promise<unknown>;
};

/** Budget de temps d'une exécution (ms) : à régler selon la limite d'horloge de la fonction Edge. */
export function runBudgetMs(): number {
  const v = Number(Deno.env.get("AI_RUN_BUDGET_MS"));
  return Number.isFinite(v) && v >= 20_000 ? v : 110_000;
}

export async function tickCompany(): Promise<TickResult> {
  const res: TickResult = { expires: 0, outbox: { envoyes: 0, en_file: 0 }, reunions: 0, missions: 0, work: Promise.resolve() };
  const gov = await loadGovernance();
  if (!gov.actif) return { ...res, ignore: "Entreprise virtuelle en pause" };

  const { data: n } = await db().rpc("ai_expire_agents");
  res.expires = Number(n ?? 0);
  try { res.outbox = await flushOutbox(); } catch (e) { await audit({ agent: "tick", action: "outbox_erreur", ok: false, payload: { e: errMsg(e) } }); }

  // Panne du fournisseur IA récente : on attend (les missions ne sont pas pénalisées)
  const { data: panne } = await db().from("ai_incidents").select("id").eq("type", "llm_indisponible")
    .gte("created_at", new Date(Date.now() - 3 * 60e3).toISOString()).limit(1);
  if (panne?.length) return { ...res, ignore: "Service IA indisponible : pause de 3 minutes" };

  const deadline = Date.now() + runBudgetMs();
  const [{ data: reunions }, { data: missions }] = await Promise.all([
    db().rpc("ai_claim_meetings", { p_n: 1 }),
    db().rpc("ai_claim_tasks", { p_n: gov.taches_par_tick }),
  ]);
  res.reunions = reunions?.length ?? 0;
  res.missions = missions?.length ?? 0;
  res.work = Promise.allSettled([
    ...(reunions ?? []).map((r: { id: string }) => runMeeting(r.id)),
    ...(missions ?? []).map((t: { id: string }) => runTask(t.id, { deadline })),
  ]);
  return res;
}
