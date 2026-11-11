// Pulsation de l'entreprise virtuelle (appelée chaque minute par le planificateur).
import { audit, db, errMsg } from "../core.ts";
import { flushOutbox } from "../outbox.ts";
import { loadGovernance } from "./org.ts";
import { incidentOnce, runTask } from "./engine.ts";
import { llmKeyPresent } from "../llm.ts";
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

  // Clé IA absente des secrets Edge : rien n'est lancé (aucune mission réclamée, aucune faute imputée aux agents) ; incident critique, une seule fois
  if (!llmKeyPresent()) {
    await incidentOnce("cle_ia_absente", "critique", "Secret ANTHROPIC_API_KEY absent : les agents sont en pause. Supabase → Edge Functions → Secrets → ajouter ANTHROPIC_API_KEY.", 6 * 3600e3);
    return { ...res, ignore: "Clé IA absente : pause" };
  }

  // Panne du fournisseur IA récente : on attend (les missions ne sont pas pénalisées)
  const { data: panne } = await db().from("ai_incidents").select("id").eq("type", "llm_indisponible")
    .gte("created_at", new Date(Date.now() - 3 * 60e3).toISOString()).limit(1);
  if (panne?.length) return { ...res, ignore: "Service IA indisponible : pause de 3 minutes" };
  // Pause courte globale en cas de problème de facturation ou d’authentification fournisseur.
  const { data: fournisseurEnErreur } = await db().from("ai_incidents").select("id")
    .in("type", ["fournisseur_credits_insuffisants", "fournisseur_authentification"])
    .gte("created_at", new Date(Date.now() - 10 * 60e3).toISOString()).limit(1);
  if (fournisseurEnErreur?.length) {
    return { ...res, ignore: "Compte IA en vérification : corriger la facturation ou la clé fournisseur avant reprise." };
  }

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
