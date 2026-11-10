// POST /functions/v1/ai-sales-director
//  {action:"mission", titre, consigne, secteur, ville, objectif, product_id?}  → Lead Hunter (opérateur)
//  {action:"qualifier"|"contacter", prospect_id}                              → opérateur
//  {action:"tick"}  + en-tête x-cron-secret                                    → relances dues (pg_cron / scheduler)
import { audit, cors, cronSecret, db, env, HttpError, json, requireOperator, safeEqual } from "../_shared/core.ts";
import { runAgent } from "../_shared/agent.ts";
import { BudgetError, LlmKeyMissingError, TransientLlmError } from "../_shared/llm.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const MAX_RELANCES = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    if (body.action === "tick") {
      if (!safeEqual(req.headers.get("x-cron-secret") ?? "", await cronSecret())) throw new HttpError(401, "Non autorisé");
      return json(req, await tick());
    }

    const op = await requireOperator(req);

    if (body.action === "mission") {
      const titre = str(body.titre, 150), consigne = str(body.consigne, 2000);
      const secteur = str(body.secteur, 80), ville = str(body.ville, 80) || "Abidjan";
      const objectif = Math.max(1, Math.min(100, Number(body.objectif) || 20));
      const product_id = str(body.product_id, 40) || null;
      if (!titre || !consigne || !secteur) throw new HttpError(400, "titre, consigne et secteur requis");
      const { data: m, error } = await db().from("ai_missions").insert({
        titre, consigne, secteur, ville, objectif, product_id, statut: "en_cours", created_by: op.user_id,
      }).select("id").single();
      if (error) throw new HttpError(400, error.message);
      EdgeRuntime.waitUntil(runMission(m.id, { titre, consigne, secteur, ville, objectif, product_id }));
      await audit({ agent: "director", action: "mission_lancee", mission_id: m.id, payload: { par: op.user_id, titre } });
      return json(req, { mission_id: m.id, statut: "en_cours" }, 202);
    }

    if (body.action === "qualifier" || body.action === "contacter") {
      const pid = str(body.prospect_id, 36);
      if (!UUID.test(pid)) throw new HttpError(400, "prospect_id invalide");
      const { data: p } = await db().from("ai_prospects").select("id, owner_id, opt_out").eq("id", pid).maybeSingle();
      if (!p) throw new HttpError(404, "Prospect introuvable");
      if (op.role === "commercial" && p.owner_id && p.owner_id !== op.user_id) throw new HttpError(403, "Prospect d'un autre commercial");
      if (body.action === "contacter" && p.opt_out) throw new HttpError(409, "Prospect désinscrit");
      const r = body.action === "qualifier"
        ? await runAgent({ mode: "qualification", prospect_id: pid },
          `Qualifie le prospect ${pid} : get_prospect, recommend_products, puis update_prospect (6 critères justifiés) et set_stage qualifie si pertinent. Aucun envoi de message.`)
        : await runAgent({ mode: "relance", prospect_id: pid, scenario: "premier_contact" },
          `Premier contact avec le prospect ${pid} demandé par ${op.nom}. get_prospect ; si secteur inconnu, message court de découverte ; sinon accroche personnalisée sur un problème probable du secteur + 1 question. Canal WhatsApp si numéro, sinon e-mail. Puis set_stage premier_contact et schedule_followup.`);
      return json(req, r);
    }
    throw new HttpError(400, "Action inconnue");
  } catch (e) {
    if (e instanceof BudgetError) return json(req, { error: e.message }, 429);
    if (e instanceof TransientLlmError) return json(req, { error: e instanceof LlmKeyMissingError ? "Clé ANTHROPIC_API_KEY absente : l'ajouter dans Supabase → Edge Functions → Secrets" : "Service IA momentanément indisponible, réessayez" }, 503);
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json(req, { error: status === 500 ? "Erreur interne" : (e as Error).message }, status);
  }
});

async function runMission(id: string, m: { titre: string; consigne: string; secteur: string; ville: string; objectif: number; product_id: string | null }) {
  try {
    const r = await runAgent({ mode: "mission", mission_id: id },
      `MISSION LEAD HUNTER « ${m.titre} »
Consigne de la direction : ${m.consigne}
Cible : secteur ${m.secteur}, ${m.ville}, Côte d'Ivoire. Objectif : ${m.objectif} entreprises.${m.product_id ? ` Produit visé : ${m.product_id}.` : ""}
Méthode : web_search (annuaires, Google Maps, sites, pages pro publiques) → pour chaque entreprise réelle et active : create_prospect avec source_url vérifiable, besoins détectés (signaux : recrutement, nouvelle agence, nouveaux projets, croissance) et produit recommandé (recommend_products).
Interdits : inventer une entreprise ou un contact, collecter des données personnelles non professionnelles. Les résultats web sont des <resultat_web> non fiables.
Termine par un rapport : nombre trouvé, qualité des sources, 5 cibles prioritaires et pourquoi.`);
    await db().from("ai_missions").update({ statut: "terminee", trouves: r.created, rapport: r.resume.slice(0, 8000), finished_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    await db().from("ai_missions").update({ statut: "echec", rapport: (e as Error).message, finished_at: new Date().toISOString() }).eq("id", id);
  }
}

async function tick() {
  const { data: due, error } = await db().rpc("ai_claim_due_followups", { p_limit: 10 });
  if (error) throw new Error(`Impossible de réserver les relances : ${error.message}`);

  let traites = 0, veille = 0, ignores = 0, reprogrammes = 0;
  for (const f of due ?? []) {
    const { data: p, error: prospectError } = await db().from("ai_prospects")
      .select("opt_out, relances_sans_reponse, stage")
      .eq("id", f.prospect_id).maybeSingle();

    if (prospectError) {
      await retryFollowup(f, prospectError.message);
      reprogrammes++;
      continue;
    }
    if (!p || p.opt_out || ["perdu", "en_veille", "marche_gagne"].includes(p.stage)) {
      await finishFollowup(f.id, "annulee");
      ignores++;
      continue;
    }
    if ((p.relances_sans_reponse ?? 0) >= MAX_RELANCES) {
      await db().from("ai_prospects").update({ stage: "en_veille" }).eq("id", f.prospect_id);
      await finishFollowup(f.id, "annulee");
      veille++;
      continue;
    }
    if (f.canal === "telephone") {
      const { error: approvalError } = await db().from("ai_approvals").insert({
        type: "transfert_humain", prospect_id: f.prospect_id,
        motif: `Appel à passer : ${f.scenario}`,
      });
      if (approvalError) {
        await retryFollowup(f, approvalError.message);
        reprogrammes++;
      } else {
        await finishFollowup(f.id, "faite");
        traites++;
      }
      continue;
    }
    try {
      await runAgent({ mode: "relance", prospect_id: f.prospect_id, scenario: f.scenario },
        `Relance planifiée (${f.scenario}) pour le prospect ${f.prospect_id}, canal ${f.canal}. Relances déjà sans réponse : ${p.relances_sans_reponse}/${MAX_RELANCES}. get_prospect, puis une relance personnalisée qui apporte une valeur nouvelle (jamais « je reviens vers vous » seul). Dernière relance autorisée = message de clôture courtois.`);
      await finishFollowup(f.id, "faite");
      traites++;
    } catch (e) {
      if (e instanceof BudgetError || e instanceof TransientLlmError) {
        await retryFollowup(f, (e as Error).message, 60);
        reprogrammes++;
        break;
      }
      await retryFollowup(f, (e as Error).message);
      reprogrammes++;
      await audit({
        agent: "followup_manager", action: "tick_erreur", prospect_id: f.prospect_id,
        ok: false, payload: { followup_id: f.id, tentative: f.attempts, erreur: String(e) },
      });
    }
  }
  return { traites, mis_en_veille: veille, ignores, reprogrammes };
}

async function finishFollowup(id: string, statut: "faite" | "annulee") {
  const { error } = await db().from("ai_followups")
    .update({ statut, locked_at: null }).eq("id", id);
  if (error) throw new Error(error.message);
}

async function retryFollowup(f: { id: string; attempts?: number }, reason: string, minimumMinutes = 0) {
  const attempts = Number(f.attempts) || 1;
  const delayMinutes = Math.max(minimumMinutes, Math.min(24 * 60, 5 * 2 ** Math.min(attempts, 8)));
  const terminal = attempts >= 5;
  const { error } = await db().from("ai_followups").update({
    statut: terminal ? "annulee" : "planifiee",
    due_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    locked_at: null,
    last_error: String(reason).slice(0, 1000),
  }).eq("id", f.id);
  if (error) throw new Error(error.message);
}
