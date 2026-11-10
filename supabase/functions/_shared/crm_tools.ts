// Outils CRM (prospects, produits, rendez-vous, offres, relances) partagés par les agents v1 et v2.
import type Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { db, env } from "./core.ts";
import { deliverMessage } from "./outbox.ts";
import type { Prospect } from "./channels.ts";

export const AGENT_STAGES = [
  "identifie", "enregistre", "qualifie", "premier_contact", "conversation", "besoin_identifie", "interesse",
  "rdv_propose", "rdv_confirme", "demo_realisee", "offre_transmise", "negociation", "offre_acceptee",
  "contrat_transmis", "paiement_attendu", "perdu", "en_veille",
] as const; // contrat_signe, paiement_confirme, marche_gagne : direction uniquement (garde-fou en base)

export type CrmCtx = {
  agentLabel: string;
  agentId: string | null;
  /** Mode conversation : un seul prospect autorisé. */
  fixedProspect?: string;
  /** Prospects que l'agent a le droit de lire / modifier (issus de lister_prospects, de sa mission ou créés par lui). */
  scope: Set<string>;
  taskId?: string | null;
  missionId?: string | null;
  /** Plafond de prospects créés pendant ce run. */
  createCap: number;
  created: number;
  source: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));

/** Identifiants de prospects cités dans le texte d'une mission : ils entrent dans le périmètre. */
export function uuidsIn(...texts: (string | null | undefined)[]): string[] {
  return [...new Set(texts.flatMap((t) => (t ?? "").match(UUID_G) ?? []).map((x) => x.toLowerCase()))];
}

// ─── Schémas ───────────────────────────────────────────────────────
const S = (o: Record<string, unknown> = {}) => ({ type: "string", ...o });
const nul = (t: string, extra: Record<string, unknown> = {}) => ({ type: [t, "null"], ...extra });
const mk = (name: string, description: string, properties: Record<string, unknown>, strict: boolean): Anthropic.Beta.BetaTool => ({
  name, description, ...(strict ? { strict: true } : {}),
  input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
} as Anthropic.Beta.BetaTool);

const P = { prospect_id: S({ description: "UUID du prospect" }) };

type Props = Record<string, unknown>;
const DEFS: Record<string, { description: string; props: Props }> = {
  lister_prospects: { description: "Liste des prospects du CRM (filtrable). Les prospects listés entrent dans ton périmètre de travail.",
    props: { stage: nul("string"), secteur: nul("string"), ville: nul("string"), score_min: nul("integer"), limite: { type: "integer" } } },
  get_prospect: { description: "Fiche prospect, 30 derniers messages tous canaux, offres, RDV, relances.", props: P },
  recommend_products: { description: "Logiciels SANIX pertinents pour un secteur et des besoins.", props: { secteur: S(), besoins_texte: S() } },
  get_product: { description: "Fonctionnalités réellement livrées, questions de découverte, argumentaire, démo, grille tarifaire.", props: { product_id: S() } },
  update_prospect: { description: "Enrichit / qualifie la fiche. null = inchangé.", props: {
    ...P, secteur: nul("string"), decideur: nul("string"), decideur_fonction: nul("string"),
    email: nul("string"), logiciel_actuel: nul("string"),
    besoins: nul("array", { items: { type: "string" } }),
    produits_recommandes: nul("array", { items: { type: "string" } }),
    budget_estime: nul("integer"), potentiel_fcfa: nul("integer"),
    criteres: nul("object", {
      properties: { produit: { type: "integer" }, besoin: { type: "integer" }, finance: { type: "integer" },
        decideur: { type: "integer" }, court_terme: { type: "integer" }, disponibilite: { type: "integer" } },
      required: ["produit", "besoin", "finance", "decideur", "court_terme", "disponibilite"], additionalProperties: false,
    }),
    resume: nul("string") } },
  set_stage: { description: "Fait avancer le prospect dans le pipeline (étapes engageantes réservées à la direction).",
    props: { ...P, stage: S({ enum: [...AGENT_STAGES] }), motif: S() } },
  send_message: { description: "Envoie un message au prospect (WhatsApp ou e-mail) sous le régime de communication externe fixé par la gouvernance (interdit, validation du président, autonome). Désinscrits bloqués.",
    props: { ...P, canal: S({ enum: ["whatsapp", "email"] }), objet: nul("string"), contenu: S() } },
  get_objection: { description: "Bibliothèque d'objections. code null = liste complète.", props: { code: nul("string") } },
  list_free_slots: { description: "Créneaux libres (heure d'Abidjan) du commercial responsable sur 7 jours.", props: P },
  book_appointment: { description: "Réserve un RDV confirmé par le prospect sur un créneau issu de list_free_slots.", props: {
    ...P, debut: S({ description: "ISO 8601 exact d'un créneau libre" }),
    mode: S({ enum: ["visio", "physique", "telephone"] }), lieu: nul("string"), product_id: nul("string") } },
  record_appointment_report: { description: "Enregistre le compte rendu d'un rendez-vous déjà commencé (déroulé, besoins exprimés, décisions, prochaine étape) et son issue. Il devient consultable dans la fiche du CRM. L'identifiant du rendez-vous est dans le champ rdv de get_prospect.", props: {
    ...P, appointment_id: S({ description: "UUID du rendez-vous (get_prospect → rdv)" }), statut: S({ enum: ["realise", "absent", "annule"] }),
    compte_rendu: S({ description: "Au moins 20 caractères : déroulé, besoins, décisions" }), prochaine_etape: nul("string") } },
  propose_commercial_action: { description: "Propose une action au plan d'actions commercial (relance d'un segment, campagne, démonstration, étude…). Elle n'entre dans le plan qu'après acceptation d'un opérateur humain ; au plus 20 propositions en attente. Appuie-la sur des chiffres du CRM (justification).", props: {
    titre: S({ description: "Action concrète, 5 à 200 caractères" }), justification: nul("string"), responsable: nul("string"),
    echeance: nul("string", { description: "AAAA-MM-JJ" }), objectif_ca: nul("integer", { description: "CA visé en FCFA" }), segment: nul("string") } },
  create_offer: { description: "Calcule une offre depuis la grille officielle. Remise hors délégation → validation direction.", props: {
    ...P, product_id: S(),
    lignes: { type: "array", items: { type: "object", properties: { poste: S(), qte: { type: "integer" } }, required: ["poste", "qte"], additionalProperties: false } },
    remise_pct: { type: "number" } } },
  schedule_followup: { description: "Planifie la prochaine relance.", props: {
    ...P, dans_heures: { type: "integer" }, scenario: S(), canal: S({ enum: ["whatsapp", "email", "telephone"] }) } },
  escalate_to_human: { description: "Transfert à un commercial humain (question technique, demande explicite, litige, grand compte).", props: { ...P, motif: S() } },
  create_prospect: { description: "Enregistre une entreprise trouvée (données professionnelles publiques uniquement).", props: {
    entreprise: S(), secteur: S(), ville: S(), commune: nul("string"), telephone: nul("string"),
    email: nul("string"), site_web: nul("string"), decideur: nul("string"), decideur_fonction: nul("string"),
    source_url: S(), besoins_detectes: { type: "array", items: { type: "string" } }, produit_recommande: S() } },
};
export const CRM_TOOL_NAMES = Object.keys(DEFS);

/** strict = garantie de schéma côté API (limites : 20 outils, 16 paramètres « union » par requête). */
export function crmTool(name: string, strict: boolean): Anthropic.Beta.BetaTool {
  const d = DEFS[name]; if (!d) throw new Error(`Outil CRM inconnu : ${name}`);
  return mk(name, d.description, d.props, strict);
}
export const CRM_DESCRIPTIONS: Record<string, string> = Object.fromEntries(Object.entries(DEFS).map(([k, v]) => [k, v.description]));

function normalize(name: string, input: Record<string, unknown>): Record<string, any> {
  const out: Record<string, any> = { ...(input ?? {}) };
  for (const k of Object.keys(DEFS[name].props)) if (out[k] === undefined) out[k] = null;
  return out;
}

async function loadProspect(id: string): Promise<Prospect & Record<string, any>> {
  const { data, error } = await db().from("ai_prospects").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Prospect introuvable");
  return data;
}

export function assertScope(ctx: CrmCtx, pid: unknown): string {
  if (typeof pid !== "string" || !UUID.test(pid)) throw new Error("prospect_id invalide");
  const id = pid.toLowerCase();
  if (ctx.fixedProspect) {
    if (id !== ctx.fixedProspect.toLowerCase()) throw new Error("Action refusée : hors du prospect en cours");
  } else if (!ctx.scope.has(id)) {
    throw new Error("Prospect hors du périmètre de ta mission : utilise lister_prospects ou un prospect cité dans ta mission");
  }
  return id;
}

export async function runCrmTool(ctx: CrmCtx, name: string, raw: Record<string, unknown>): Promise<unknown> {
  const input = normalize(name, raw);
  const pid = "prospect_id" in DEFS[name].props ? assertScope(ctx, input.prospect_id) : "";

  switch (name) {
    case "lister_prospects": {
      let q = db().from("ai_prospects")
        .select("id, entreprise, secteur, ville, stage, score, priorite, decideur, telephone, email, produits_recommandes, opt_out, resume_ia");
      if (input.stage) q = q.eq("stage", String(input.stage));
      if (input.secteur) q = q.ilike("secteur", `%${String(input.secteur).replace(/[%,()]/g, "")}%`);
      if (input.ville) q = q.ilike("ville", `%${String(input.ville).replace(/[%,()]/g, "")}%`);
      if (input.score_min !== null) q = q.gte("score", clamp(input.score_min, 100));
      const { data, error } = await q.order("score", { ascending: false }).limit(Math.max(1, Math.min(50, Math.round(Number(input.limite) || 20))));
      if (error) throw new Error(error.message);
      for (const p of data ?? []) ctx.scope.add(String(p.id).toLowerCase());
      return data;
    }
    case "get_prospect": {
      const [p, msgs, offers, rdv, fu] = await Promise.all([
        loadProspect(pid),
        db().from("ai_messages").select("canal,sens,auteur,contenu,statut,created_at").eq("prospect_id", pid)
          .order("created_at", { ascending: false }).limit(30),
        db().from("ai_offers").select("reference,product_id,total_ht,remise_pct,statut,created_at").eq("prospect_id", pid),
        db().from("ai_appointments").select("id,debut,mode,statut,product_id,compte_rendu").eq("prospect_id", pid),
        db().from("ai_followups").select("due_at,scenario,statut").eq("prospect_id", pid).eq("statut", "planifiee"),
      ]);
      const fil = (msgs.data ?? []).reverse().map((m) =>
        m.auteur === "prospect" ? { ...m, contenu: `<message_prospect>${m.contenu}</message_prospect>` } : m);
      const rdvs = (rdv.data ?? []).map(({ compte_rendu, ...r }: { compte_rendu: string | null }) => ({ ...r, compte_rendu_enregistre: !!compte_rendu }));
      return { prospect: p, fil, offres: offers.data, rdv: rdvs, relances: fu.data };
    }
    case "recommend_products": {
      const { data } = await db().rpc("ai_recommend_products", { p_secteur: input.secteur, p_texte: input.besoins_texte });
      return data?.length ? data : { info: "Aucun produit évident : poser des questions de découverte." };
    }
    case "get_product": {
      const [{ data: p }, { data: prix }] = await Promise.all([
        db().from("ai_products").select("id,nom,marche_cible,fonctionnalites,questions_decouverte,argumentaire,demo_url,video_url,brochure_url")
          .eq("id", input.product_id).eq("actif", true).maybeSingle(),
        db().from("ai_pricing").select("poste,libelle,prix_ht,unite,remise_agent_max_pct").eq("product_id", input.product_id).eq("actif", true),
      ]);
      if (!p) throw new Error("Produit inconnu");
      return { ...p, grille: prix ?? [], note: prix?.length ? undefined : "Aucun tarif publié : ne donner aucun prix, escalader." };
    }
    case "update_prospect": {
      const patch: Record<string, unknown> = {};
      for (const k of ["secteur", "decideur", "decideur_fonction", "email", "logiciel_actuel", "besoins",
        "produits_recommandes", "budget_estime", "potentiel_fcfa"]) if (input[k] !== null) patch[k] = input[k];
      if (typeof patch.email === "string" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(patch.email)) delete patch.email;
      if (input.resume !== null) patch.resume_ia = String(input.resume).slice(0, 2000);
      const c = input.criteres;
      if (c) Object.assign(patch, {
        crit_produit: clamp(c.produit, 25), crit_besoin: clamp(c.besoin, 20), crit_finance: clamp(c.finance, 15),
        crit_decideur: clamp(c.decideur, 15), crit_court_terme: clamp(c.court_terme, 15), crit_disponibilite: clamp(c.disponibilite, 10),
      });
      if (!Object.keys(patch).length) return { info: "Aucun changement" };
      const { data, error } = await db().from("ai_prospects").update(patch).eq("id", pid).select("score,priorite").single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "set_stage": {
      if (!(AGENT_STAGES as readonly string[]).includes(input.stage)) throw new Error("Étape non autorisée à l'agent");
      const { error } = await db().from("ai_prospects").update({ stage: input.stage }).eq("id", pid);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    case "send_message": {
      const p = await loadProspect(pid);
      return await deliverMessage({ prospect: p, canal: input.canal, objet: input.objet, contenu: String(input.contenu),
        agentId: ctx.agentId, agentLabel: ctx.agentLabel, taskId: ctx.taskId });
    }
    case "get_objection": {
      const q = db().from("ai_objections").select("code,objection,diagnostic,reponse,prochaine_etape");
      const { data } = input.code ? await q.eq("code", input.code) : await q;
      return data;
    }
    case "list_free_slots": {
      const op = await commercialFor(pid);
      if (!op) return { info: "Aucun commercial disponible : escalader." };
      const { data } = await db().rpc("ai_free_slots", { p_operator: op, p_days: 7, p_duree_min: 45 });
      return { operator_id: op, creneaux: (data ?? []).map((s: { debut: string }) => s.debut) };
    }
    case "book_appointment": {
      const p = await loadProspect(pid);
      const debut = new Date(input.debut);
      if (isNaN(+debut) || +debut < Date.now() + 3600e3) throw new Error("Créneau invalide ou trop proche");
      const op = await commercialFor(pid);
      const fin = new Date(+debut + 45 * 60e3);
      const visio = input.mode === "visio" ? env("DEMO_VISIO_URL", false) || null : null;
      const { data, error } = await db().from("ai_appointments").insert({
        prospect_id: pid, operator_id: op, product_id: input.product_id, debut: debut.toISOString(), fin: fin.toISOString(),
        mode: input.mode, lieu: input.lieu, lien_visio: visio, statut: "confirme",
        rappel_at: new Date(+debut - 2 * 3600e3).toISOString(),
        fiche_prep: `${p.entreprise} — ${p.secteur ?? "?"} — score ${p.score}/100\nBesoins : ${(p.besoins as string[] ?? []).join(", ")}\n${p.resume_ia ?? ""}`,
      }).select("id,debut,lien_visio").single();
      if (error) throw new Error(error.code === "23P01" ? "Créneau déjà pris : proposer un autre" : error.message);
      await db().from("ai_prospects").update({ stage: "rdv_confirme", owner_id: op }).eq("id", pid);
      await db().from("ai_approvals").insert({ type: "transfert_humain", prospect_id: pid, objet_id: data.id, agent_id: ctx.agentId,
        motif: `RDV confirmé le ${debut.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })} — préparer la démo`, payload: data });
      return data;
    }
    case "record_appointment_report": {
      const { data: ap } = await db().from("ai_appointments").select("id,debut,compte_rendu").eq("id", String(input.appointment_id)).eq("prospect_id", pid).maybeSingle();
      if (!ap) throw new Error("Rendez-vous introuvable pour ce prospect : utilise get_prospect (champ rdv)");
      if (+new Date(ap.debut) > Date.now()) throw new Error("Ce rendez-vous n'a pas encore commencé : compte rendu impossible");
      const corps = String(input.compte_rendu ?? "").trim();
      if (corps.length < 20) throw new Error("Compte rendu trop court : décris le déroulé, les besoins exprimés, les décisions et la prochaine étape");
      if (ap.compte_rendu) throw new Error("Un compte rendu existe déjà pour ce rendez-vous : ne pas l'écraser");
      const texte = (corps + (input.prochaine_etape ? `\nProchaine étape : ${String(input.prochaine_etape).trim()}` : "")).slice(0, 4000);
      const { error } = await db().from("ai_appointments").update({ statut: input.statut, compte_rendu: texte }).eq("id", ap.id);
      if (error) throw new Error(error.message);
      if (input.statut === "realise") {                                  // la démonstration a eu lieu : l'entonnoir avance (jamais d'étape engageante)
        const p = await loadProspect(pid);
        if (["rdv_propose", "rdv_confirme"].includes(String(p.stage))) await db().from("ai_prospects").update({ stage: "demo_realisee" }).eq("id", pid);
      }
      return { ok: true, rdv: ap.id, statut: input.statut };
    }
    case "propose_commercial_action": {
      const ech = input.echeance ? String(input.echeance).trim() : null;
      if (ech !== null && !/^\d{4}-\d{2}-\d{2}$/.test(ech)) throw new Error("echeance : format AAAA-MM-JJ attendu");
      const { data, error } = await db().rpc("ai_propose_commercial_action", {
        p_agent: ctx.agentId, p_titre: input.titre, p_justification: input.justification, p_responsable: input.responsable,
        p_echeance: ech, p_objectif_ca: Math.max(0, Math.round(Number(input.objectif_ca) || 0)), p_segment: input.segment,
      });
      if (error) throw new Error(error.message);
      return data;
    }
    case "create_offer": {
      const { data: grille } = await db().from("ai_pricing").select("*").eq("product_id", input.product_id).eq("actif", true);
      if (!grille?.length) throw new Error("Aucun tarif officiel pour ce produit : escalader à la direction");
      const lignes = (input.lignes as { poste: string; qte: number }[]).map((l) => {
        const g = grille.find((x) => x.poste === l.poste);
        if (!g) throw new Error(`Poste « ${l.poste} » absent de la grille`);
        const qte = Math.max(1, Math.min(1000, Math.round(l.qte)));
        return { poste: g.poste, libelle: g.libelle, unite: g.unite, qte, pu_ht: Number(g.prix_ht), montant_ht: qte * Number(g.prix_ht),
          _agent: Number(g.remise_agent_max_pct), _dir: Number(g.remise_direction_max_pct) };
      });
      const remise = Math.max(0, Math.min(100, Number(input.remise_pct) || 0));
      const delegAgent = Math.min(...lignes.map((l) => l._agent));
      const delegDir = Math.min(...lignes.map((l) => l._dir));
      if (remise > delegDir) throw new Error(`Remise ${remise}% supérieure au plafond direction (${delegDir}%) : refusée`);
      const brut = lignes.reduce((s, l) => s + l.montant_ht, 0);
      const ht = Math.round(brut * (1 - remise / 100));
      const tva = 18;
      const needsApproval = remise > delegAgent;
      const { data: offer, error } = await db().from("ai_offers").insert({
        prospect_id: pid, product_id: input.product_id,
        lignes: lignes.map(({ _agent, _dir, ...l }) => l),
        total_brut_ht: brut, remise_pct: remise, total_ht: ht, tva_pct: tva, total_ttc: Math.round(ht * (1 + tva / 100)),
        statut: needsApproval ? "a_valider" : "validee",
      }).select("id,reference,total_ht,total_ttc,statut").single();
      if (error) throw new Error(error.message);
      if (needsApproval) {
        const { data: ap } = await db().from("ai_approvals").insert({
          type: "remise", prospect_id: pid, objet_id: offer.id, agent_id: ctx.agentId,
          motif: `Remise ${remise}% > délégation agent ${delegAgent}% sur ${offer.reference}`, payload: offer,
        }).select("id").single();
        await db().from("ai_offers").update({ approval_id: ap?.id }).eq("id", offer.id);
      }
      return { ...offer, consigne: needsApproval
        ? "Offre soumise à validation direction : ne pas communiquer le montant remisé avant accord."
        : "Offre validée : tu peux la présenter (référence + total HT/TTC)." };
    }
    case "schedule_followup": {
      const h = Math.max(2, Math.min(24 * 60, Math.round(Number(input.dans_heures) || 24)));
      const due = new Date(Date.now() + h * 3600e3).toISOString();
      await db().from("ai_followups").update({ statut: "annulee" }).eq("prospect_id", pid).eq("statut", "planifiee");
      await db().from("ai_followups").insert({ prospect_id: pid, due_at: due, scenario: String(input.scenario).slice(0, 300), canal: input.canal });
      await db().from("ai_prospects").update({ next_action_at: due }).eq("id", pid);
      return { due_at: due };
    }
    case "escalate_to_human": {
      await db().from("ai_approvals").insert({ type: "transfert_humain", prospect_id: pid, agent_id: ctx.agentId, motif: String(input.motif).slice(0, 500) });
      return { ok: true, consigne: "Informer le prospect qu'un conseiller le recontacte rapidement." };
    }
    case "create_prospect": {
      if (ctx.created >= ctx.createCap) return { info: `Plafond de ${ctx.createCap} prospects atteint pour cette exécution : arrête et rapporte.` };
      const email = input.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email) ? input.email : null;
      const { data, error } = await db().from("ai_prospects").insert({
        entreprise: String(input.entreprise).slice(0, 200), secteur: input.secteur, ville: input.ville, commune: input.commune,
        telephone: input.telephone, email, site_web: input.site_web, decideur: input.decideur, decideur_fonction: input.decideur_fonction,
        besoins: (input.besoins_detectes ?? []).slice(0, 10), produits_recommandes: [input.produit_recommande],
        source: ctx.source, source_url: input.source_url, stage: "enregistre", mission_id: ctx.missionId ?? null,
      }).select("id").single();
      if (error) return { doublon: error.code === "23505", info: error.code === "23505" ? "Déjà en base" : error.message };
      ctx.created++;
      ctx.scope.add(String(data.id).toLowerCase());
      return { ok: true, prospect_id: data.id, total: ctx.created };
    }
  }
  throw new Error(`Outil inconnu : ${name}`);
}

async function commercialFor(pid: string): Promise<string | null> {
  const p = await loadProspect(pid);
  if (p.owner_id) return p.owner_id as string;
  const { data } = await db().from("ai_operators").select("user_id").eq("role", "commercial").eq("actif", true).limit(1).maybeSingle();
  return data?.user_id ?? null;
}
