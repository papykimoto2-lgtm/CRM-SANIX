// Relances commerciales planifiées (ai_followups) : réservation atomique (ai_claim_due_followups), reprise après erreur avec attente
// croissante, aucune perte quand l'IA est indisponible, protection contre le double envoi après une reprise.
import { audit, db } from "./core.ts";
import { BudgetError, TransientLlmError } from "./llm.ts";

export const MAX_RELANCES = 4;        // relances sans réponse avant mise en veille du prospect
export const MAX_TENTATIVES = 5;      // erreurs répétées (hors pannes IA) avant annulation de la relance
const FENETRE_DOUBLON_H = 6;          // reprise : un message déjà parti dans cette fenêtre vaut relance faite

export type Followup = { id: string; prospect_id: string; scenario: string; canal: string; attempts?: number };
export type RunRelance = (f: Followup, p: { relances_sans_reponse: number | null }) => Promise<unknown>;

export async function tickFollowups(runRelance: RunRelance, limit = 10) {
  const { data: due, error } = await db().rpc("ai_claim_due_followups", { p_limit: limit });
  if (error) throw new Error(`Impossible de réserver les relances : ${error.message}`);

  let traites = 0, veille = 0, ignores = 0, reprogrammes = 0;
  const lot = (due ?? []) as Followup[];
  for (let i = 0; i < lot.length; i++) {
    const f = lot[i];
    const { data: p, error: prospectError } = await db().from("ai_prospects")
      .select("opt_out, relances_sans_reponse, stage").eq("id", f.prospect_id).maybeSingle();
    if (prospectError) { await retryFollowup(f, prospectError.message); reprogrammes++; continue; }

    if (!p || p.opt_out || ["perdu", "en_veille", "marche_gagne"].includes(p.stage)) {
      await finishFollowup(f.id, "annulee"); ignores++; continue;
    }
    if ((p.relances_sans_reponse ?? 0) >= MAX_RELANCES) {
      await db().from("ai_prospects").update({ stage: "en_veille" }).eq("id", f.prospect_id);
      await finishFollowup(f.id, "annulee"); veille++; continue;
    }
    if (f.canal === "telephone") {
      const { error: approvalError } = await db().from("ai_approvals").insert({
        type: "transfert_humain", prospect_id: f.prospect_id, motif: `Appel à passer : ${f.scenario}`,
      });
      if (approvalError) { await retryFollowup(f, approvalError.message); reprogrammes++; }
      else { await finishFollowup(f.id, "faite"); traites++; }
      continue;
    }
    // Reprise (2e tentative ou plus) : si un message est déjà parti, la relance a eu lieu ; ne pas écrire deux fois au prospect.
    if ((f.attempts ?? 1) > 1 && await messageDejaParti(f.prospect_id)) {
      await finishFollowup(f.id, "faite");
      await audit({ agent: "followup_manager", action: "relance_deja_envoyee", prospect_id: f.prospect_id, payload: { followup_id: f.id, tentative: f.attempts } });
      traites++; continue;
    }
    try {
      await runRelance(f, { relances_sans_reponse: p.relances_sans_reponse ?? 0 });
      await finishFollowup(f.id, "faite");
      traites++;
    } catch (e) {
      if (e instanceof BudgetError || e instanceof TransientLlmError) {
        // Panne du fournisseur IA, budget atteint ou clé absente : ce n'est pas la faute de la relance (tentative rendue), on s'arrête là.
        await retryFollowup(f, (e as Error).message, { minimumMinutes: 60, refund: true });
        reprogrammes++;
        await releaseFollowups(lot.slice(i + 1));   // les relances réservées dans ce lot mais non traitées repartent intactes
        break;
      }
      await retryFollowup(f, (e as Error).message);
      reprogrammes++;
      await audit({ agent: "followup_manager", action: "tick_erreur", prospect_id: f.prospect_id, ok: false, payload: { followup_id: f.id, tentative: f.attempts, erreur: String(e) } });
    }
  }
  return { traites, mis_en_veille: veille, ignores, reprogrammes };
}

/** Rend des relances réservées mais non traitées : verrou levé, tentative non comptée, échéance inchangée. */
async function releaseFollowups(list: Followup[]) {
  for (const f of list) {
    await db().from("ai_followups").update({ locked_at: null, attempts: Math.max(0, (Number(f.attempts) || 1) - 1) }).eq("id", f.id);
  }
}

async function messageDejaParti(prospectId: string): Promise<boolean> {
  const { data } = await db().from("ai_messages").select("id").eq("prospect_id", prospectId).eq("sens", "sortant")
    .in("statut", ["a_valider", "a_envoyer", "envoye", "delivre", "lu"])
    .gte("created_at", new Date(Date.now() - FENETRE_DOUBLON_H * 3600e3).toISOString()).limit(1);
  return !!data?.length;
}

export async function finishFollowup(id: string, statut: "faite" | "annulee") {
  const { error } = await db().from("ai_followups").update({ statut, locked_at: null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Reprogramme une relance : attente 5 · 2^n minutes (24 h au plus) ; annulée après MAX_TENTATIVES erreurs. `refund` : tentative non comptée. */
export async function retryFollowup(f: { id: string; attempts?: number }, reason: string, o: { minimumMinutes?: number; refund?: boolean } = {}) {
  const attempts = Number(f.attempts) || 1;
  const delayMinutes = Math.max(o.minimumMinutes ?? 0, Math.min(24 * 60, 5 * 2 ** Math.min(attempts, 8)));
  const terminal = !o.refund && attempts >= MAX_TENTATIVES;
  const { error } = await db().from("ai_followups").update({
    statut: terminal ? "annulee" : "planifiee",
    due_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    attempts: o.refund ? Math.max(0, attempts - 1) : attempts,
    locked_at: null,
    last_error: String(reason).slice(0, 1000),
  }).eq("id", f.id);
  if (error) throw new Error(error.message);
}
