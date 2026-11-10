// Outils des collaborateurs IA : schémas + exécuteur. Chaque règle d'autorité, de gouvernance et
// d'anti-boucle est appliquée ICI (et doublée par les triggers SQL) : le modèle ne peut pas la contourner.
import type Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { clip, db, errMsg } from "../core.ts";
import { crmTool, CRM_TOOL_NAMES, type CrmCtx, runCrmTool } from "../crm_tools.ts";
import { CHARTER_KEYS } from "../prompts.ts";
import { BASE_TOOLS, CATALOG_BY_NAME, catalogText, checkGrant, EXTERNAL_TOOLS } from "./catalog.ts";
import { type AgentRow, type Governance, loadGovernance, norm, OPEN_STATES, Org, slugCode, type TaskRow } from "./org.ts";
import { activityFor, type PendingMove, type Presence, publishMove } from "./presence.ts";

export type CoCtx = {
  agent: AgentRow; task: TaskRow; org: Org; gov: Governance;
  departments: { id: string; nom: string; responsable_id: string | null }[];
  crm: CrmCtx;
  journal: string[];
  finish?: { statut: "terminee" | "bloquee"; rapport: string; resultats: string[] };
  parked?: "attente_sous_taches" | "attente_validation";
  posted: string[];
  acted: boolean;
  memWrites: number;
  /** Présence 3D : activité suivie, déplacements du tour, agents à qui une mission a été confiée ce tour. */
  presence?: Presence;
  moves?: PendingMove[];
  assigned?: Set<string>;
};
const move = (ctx: CoCtx, who: string, key: string, m: PendingMove["move"]) => { (ctx.moves ??= []).push({ who, key, move: m }); };

// ─── Schémas ───────────────────────────────────────────────────────
const str = (description?: string, extra: Record<string, unknown> = {}) => ({ type: "string", ...(description ? { description } : {}), ...extra });
const arr = (description?: string, items: Record<string, unknown> = { type: "string" }) => ({ type: "array", items, ...(description ? { description } : {}) });
const int = (description?: string) => ({ type: "integer", ...(description ? { description } : {}) });
const T = (name: string, description: string, properties: Record<string, unknown>, required?: string[]): Anthropic.Beta.BetaTool => ({
  name, description, input_schema: { type: "object", properties, required: required ?? Object.keys(properties), additionalProperties: false },
} as Anthropic.Beta.BetaTool);

const CHARTE_PROPS = {
  mission_principale: str("Mission principale, mesurable"),
  missions_secondaires: arr("Missions secondaires"),
  competences: arr("Compétences requises"),
  donnees: arr("Données accessibles"),
  objectifs: arr("Objectifs quantitatifs (chiffres, échéances)"),
  delais: str("Délais d'exécution attendus"),
  indicateurs: arr("Indicateurs de performance"),
  procedures: arr("Procédures de travail"),
  limites: arr("Limites d'autonomie"),
  reporting: str("Modalités de reporting"),
};

export function companySchemas(departmentIds: string[]): Record<string, Anthropic.Beta.BetaTool> {
  const dep = str("Département", { enum: departmentIds });
  return {
    terminer_mission: T("terminer_mission", "Clôture ta mission avec ton rapport. À appeler quand le travail est terminé ou impossible.", {
      statut: str("terminee ou bloquee", { enum: ["terminee", "bloquee"] }),
      rapport: str("Rapport factuel : réalisé, chiffres, difficultés, suites recommandées"),
      resultats: arr("Livrables et chiffres clés, une ligne chacun"),
    }),
    signaler_difficulte: T("signaler_difficulte", "Signale une difficulté (informe ton responsable ; critique = alerte immédiate au président).", {
      message: str(), gravite: str("info | attention | critique", { enum: ["info", "attention", "critique"] }),
    }),
    memoriser: T("memoriser", "Enregistre un enseignement réutilisable en mémoire (court).", {
      contenu: str(), tags: arr("Mots-clés"), partage: { type: "boolean", description: "Visible de tous les agents (niveaux ≤ 3 uniquement)" },
    }),
    rappeler: T("rappeler", "Recherche dans ta mémoire et la mémoire partagée.", { requete: str("Mots-clés") }),
    consulter_taches: T("consulter_taches", "État des missions : tes sous-tâches ou (responsables) celles de ton équipe.", {
      portee: str("mes_sous_taches | equipe", { enum: ["mes_sous_taches", "equipe"] }),
      statut: str("Filtre optionnel : a_faire, en_cours, terminee, bloquee…"),
    }, ["portee"]),
    demander_validation: T("demander_validation", "Soumet une décision au président et suspend ta mission jusqu'à sa réponse.", {
      motif: str("Décision demandée et justification"), details: str("Éléments utiles à la décision"),
    }, ["motif"]),
    demander_ressources: T("demander_ressources", "Demande une augmentation de ressources au président (justification obligatoire) ; suspend ta mission.", {
      parametre: str("Ressource", { enum: ["budget_jour_usd", "budget_mois_usd", "budget_agent_jour_usd", "max_agents_actifs", "max_creations_jour", "max_missions_actives"] }),
      valeur: { type: "number", description: "Nouvelle valeur demandée" }, justification: str(),
    }),
    transmettre: T("transmettre", "Transmet un dossier à un collègue de ta direction (chaîne de traitement) ; ta mission peut ensuite se terminer. Interdit : renvoyer à quelqu'un déjà intervenu dans la chaîne.", {
      agent_code: str("Code du collègue"), titre: str(), instructions: str(),
      donnees: str("Données à transmettre (texte, listes, identifiants de prospects)"), priorite: int("1 (urgent) à 5"),
    }, ["agent_code", "titre", "instructions", "donnees"]),
    creer_agent: T("creer_agent", `Crée un collaborateur IA subordonné avec son cahier des charges. Vérifie d'abord l'organisation : ne crée pas de doublon. Outils attribuables : ${catalogText()}.`, {
      nom: str("Nom de l'agent (ex. « IA Lead Qualifier »)"), fonction: str(), departement_id: dep,
      manager_code: str("Code du responsable (toi-même par défaut)"),
      personnalite: str("Personnalité professionnelle"), specialite: str(),
      outils: arr("Outils attribués (noms du catalogue)"),
      effort: str("Profondeur de réflexion : low (tâches simples), medium, high", { enum: ["low", "medium", "high"] }),
      temporaire_jours: int("Agent temporaire : durée de vie en jours (1-90)"),
      charte: { type: "object", properties: CHARTE_PROPS, required: Object.keys(CHARTE_PROPS), additionalProperties: false },
    }, ["nom", "fonction", "departement_id", "personnalite", "specialite", "outils", "effort", "charte"]),
    modifier_agent: T("modifier_agent", "Révise un subordonné : personnalité, spécialité, outils, effort, budget journalier (≤ plafond), éléments du cahier des charges. Crée une nouvelle version de la charte.", {
      agent_code: str(), motif: str(),
      personnalite: str(), specialite: str(), outils: arr("Liste complète des outils"),
      effort: str("low | medium | high", { enum: ["low", "medium", "high"] }), budget_jour_usd: { type: "number" },
      charte: { type: "object", properties: CHARTE_PROPS, additionalProperties: false },
    }, ["agent_code", "motif"]),
    changer_etat_agent: T("changer_etat_agent", "Suspend, réactive ou archive un subordonné (archivage : plus aucun subordonné actif).", {
      agent_code: str(), etat: str("suspendu | actif | archive", { enum: ["suspendu", "actif", "archive"] }), motif: str(),
    }),
    assigner_mission: T("assigner_mission", "Confie une mission à un subordonné (sous-mission de ta mission en cours). depend_de : ids de missions de ce lot à terminer d'abord.", {
      agent_code: str(), titre: str(), description: str("Contexte, périmètre, livrable attendu"),
      objectifs: arr("Objectifs chiffrés"), priorite: int("1 (urgent) à 5"), echeance_heures: int("Délai en heures (optionnel)"),
      entrees: str("Données d'entrée (optionnel)"), depend_de: arr("Ids de missions préalables (optionnel)"),
      produit: str("Logiciel concerné : immosuite, aluexpert ou avicosuite (optionnel ; hérité de ta mission si absent)"),
      resultat_attendu: str("Résultat vérifiable attendu à la clôture (optionnel mais recommandé)"),
    }, ["agent_code", "titre", "description", "objectifs", "priorite"]),
    attendre_sous_taches: T("attendre_sous_taches", "Suspend ta mission jusqu'à la fin de tes sous-missions ou de ta réunion ; tu seras relancé avec leurs rapports.", {}),
    evaluer_tache: T("evaluer_tache", "Note (0-100) le travail terminé d'un subordonné.", {
      task_id: str(), note: int("0-100"), commentaire: str(),
    }),
    consulter_performance: T("consulter_performance", "Statistiques de ton équipe (missions, taux, qualité, délais, coût IA, incidents, score).", { jours: int("Période : 1 à 30 jours") }),
    consulter_indicateurs: T("consulter_indicateurs", "Indicateurs de l'entreprise sur la période (activité, commercial, finances, difficultés).", { jours: int("1 à 30 jours") }),
    convoquer_reunion: T("convoquer_reunion", "Convoque une réunion de travail (chaque participant contribue, tu synthétises ; procès-verbal et plan d'action). Appelle ensuite attendre_sous_taches.", {
      titre: str(), ordre_du_jour: str(), participants: arr("Codes des participants"),
    }),
    repondre_president: T("repondre_president", "Envoie un message au président dans le bureau exécutif (plan, synthèse, question).", { message: str() }),
  };
}

// ─── Utilitaires de validation ─────────────────────────────────────
const txt = (v: unknown, max: number, champ: string, min = 1): string => {
  if (typeof v !== "string") throw new Error(`${champ} : texte requis`);
  const t = v.trim();
  if (t.length < min) throw new Error(`${champ} : trop court`);
  return t.slice(0, max);
};
const list = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, maxItems).map((x) => (x as string).trim().slice(0, maxLen))
    : (typeof v === "string" && v.trim() ? [v.trim().slice(0, maxLen)] : []);
const num = (v: unknown, min: number, max: number, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mustFind(ctx: CoCtx, code: unknown, champ = "agent_code"): AgentRow {
  const a = ctx.org.byCode(typeof code === "string" ? code : "");
  if (!a) throw new Error(`${champ} : agent « ${clip(code, 60)} » introuvable (consulte l'organisation de ta mission)`);
  return a;
}
function mustCommand(ctx: CoCtx, target: AgentRow): void {
  if (!ctx.org.commands(ctx.agent, target)) throw new Error(`Autorité insuffisante : ${target.nom} n'est pas ton subordonné`);
}
async function alertManager(ctx: CoCtx, agent: AgentRow, objet: string, contenu: string): Promise<void> {
  const to = agent.manager_id ?? ctx.agent.manager_id;
  if (!to) return;
  await db().from("ai_agent_communications").insert({
    de_agent_id: ctx.agent.id, vers_agent_id: to, task_id: ctx.task.id, type: "alerte", objet: objet.slice(0, 200), contenu: contenu.slice(0, 8000),
  });
}

const ACTION_TOOLS = new Set(["creer_agent", "modifier_agent", "changer_etat_agent", "assigner_mission", "transmettre", "send_message",
  "create_prospect", "update_prospect", "set_stage", "book_appointment", "record_appointment_report", "propose_commercial_action", "create_offer", "schedule_followup", "escalate_to_human",
  "convoquer_reunion", "repondre_president", "evaluer_tache"]);

export function allowedTools(a: AgentRow): string[] {
  return [...BASE_TOOLS, ...a.outils, ...(a.niveau === 1 ? ["repondre_president"] : [])];
}

/** Liste des outils exposés au modèle pour cet agent (CRM non « strict » : plus de 16 paramètres union possibles). */
export function toolsFor(a: AgentRow, departmentIds: string[]): Anthropic.Beta.BetaToolUnion[] {
  const schemas = companySchemas(departmentIds);
  const out: Anthropic.Beta.BetaToolUnion[] = [];
  for (const n of [...new Set(allowedTools(a))]) {
    if (n === "recherche_web") {
      out.push({ type: "web_search_20260209", name: "web_search", max_uses: 10,
        user_location: { type: "approximate", country: "CI", city: "Abidjan", timezone: "Africa/Abidjan" } });
    } else if (schemas[n]) out.push(schemas[n]);
    else if (CRM_TOOL_NAMES.includes(n)) out.push(crmTool(n, false));
  }
  return out;
}

// ─── Exécuteur ─────────────────────────────────────────────────────
export async function runCompanyTool(ctx: CoCtx, name: string, input: Record<string, any>): Promise<unknown> {
  if (!allowedTools(ctx.agent).includes(name)) throw new Error(`Outil non autorisé pour ${ctx.agent.nom} : ${name}`);
  const tag = `${name}(${clip(input, 140)})`;
  try {
    const act = activityFor(name, input ?? {});
    if (act && ctx.presence) await ctx.presence.activity(act);
    const out = CRM_TOOL_NAMES.includes(name) ? await runCrmTool(ctx.crm, name, input) : await IMPL[name](ctx, input ?? {});
    if (ACTION_TOOLS.has(name)) ctx.acted = true;
    if (ctx.journal.length < 60) ctx.journal.push(`${tag} → ${clip(out, 160)}`);
    return out;
  } catch (e) {
    if (ctx.journal.length < 60) ctx.journal.push(`${tag} → ERREUR ${clip(errMsg(e), 140)}`);
    throw e;
  }
}

const IMPL: Record<string, (ctx: CoCtx, i: Record<string, any>) => Promise<unknown>> = {
  async terminer_mission(ctx, i) {
    // Une mission n'est jamais « terminée » sur une simple déclaration : un rapport substantiel et au moins un résultat vérifiable sont exigés.
    const statut = i.statut === "bloquee" ? "bloquee" : "terminee";
    const rapport = txt(i.rapport, 18000, "rapport", statut === "terminee" ? 40 : 15);
    const resultats = list(i.resultats, 20, 300);
    if (statut === "terminee" && !resultats.some((r) => r.length >= 10)) {
      throw new Error("Mission terminée sans résultat exploitable : liste au moins un livrable ou un chiffre vérifiable (ex. « 12 prospects qualifiés, scores enregistrés »). Si tu n'as rien produit, termine avec le statut « bloquee » et explique précisément pourquoi.");
    }
    ctx.finish = { statut, rapport, resultats };
    return { ok: true };
  },

  async signaler_difficulte(ctx, i) {
    const g = ["info", "attention", "critique"].includes(i.gravite) ? i.gravite : "attention";
    const message = txt(i.message, 2000, "message", 3);
    await db().rpc("ai_register_incident", { p_agent: ctx.agent.id, p_task: ctx.task.id, p_type: "difficulte", p_gravite: g, p_message: message, p_echec: false });
    if (g !== "info") await alertManager(ctx, ctx.agent, `Difficulté (${g}) : ${ctx.agent.nom}`, message);
    return { ok: true };
  },

  async memoriser(ctx, i) {
    if (ctx.memWrites >= 5) throw new Error("Limite de 5 mémorisations par exécution");
    const partage = i.partage === true;
    if (partage && ctx.agent.niveau > 3) throw new Error("La mémoire partagée est réservée aux niveaux ≤ 3");
    const { error } = await db().from("ai_agent_memory").insert({
      agent_id: partage ? null : ctx.agent.id, contenu: txt(i.contenu, 4000, "contenu", 3), tags: list(i.tags, 6, 40), importance: 3,
    });
    if (error) throw new Error(error.message);
    ctx.memWrites++;
    return { ok: true };
  },

  async rappeler(ctx, i) {
    const { data, error } = await db().rpc("ai_memory_search", { p_agent: ctx.agent.id, p_q: txt(i.requete, 300, "requete", 2), p_n: 8 });
    if (error) throw new Error(error.message);
    return data?.length ? data : { info: "Rien en mémoire sur ce sujet" };
  },

  async consulter_taches(ctx, i) {
    const equipe = i.portee === "equipe" && ctx.agent.niveau <= 4;
    let q = db().from("ai_agent_tasks").select("id, titre, agent_id, statut, priorite, echeance, progression, rapport, evaluation, created_at");
    if (equipe && ctx.agent.niveau > 1) {
      const ids = [...ctx.org.descendants(ctx.agent.id)].slice(0, 100);   // limite de longueur d'URL
      if (!ids.length) return [];
      q = q.in("agent_id", ids);
    } else if (!equipe) q = q.eq("donneur_agent_id", ctx.agent.id);
    if (typeof i.statut === "string" && i.statut) q = q.eq("statut", i.statut);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(40);
    if (error) throw new Error(error.message);
    return (data ?? []).map((t) => ({ ...t, agent: ctx.org.byId(t.agent_id)?.code ?? t.agent_id, agent_id: undefined,
      progression: clip(t.progression ?? "", 200), rapport: clip(t.rapport ?? "", 500) }));
  },

  async demander_validation(ctx, i) {
    const { error } = await db().from("ai_approvals").insert({
      type: "engagement", agent_id: ctx.agent.id, task_id: ctx.task.id,
      motif: txt(i.motif, 1000, "motif", 3), payload: { details: clip(i.details ?? "", 2000) },
    });
    if (error) throw new Error(error.message);
    await db().from("ai_agent_tasks").update({ statut: "attente_validation" }).eq("id", ctx.task.id);
    ctx.parked = "attente_validation";
    return { ok: true, consigne: "Mission suspendue jusqu'à la décision du président." };
  },

  async demander_ressources(ctx, i) {
    const p = String(i.parametre);
    const g = ctx.gov as unknown as Record<string, number>;
    const actuel = p === "budget_agent_jour_usd" ? (ctx.agent.budget_jour_usd ?? g.budget_agent_jour_usd) : g[p];
    if (actuel === undefined) throw new Error("Paramètre de ressource non pris en charge");
    const valeur = Number(i.valeur);
    if (!Number.isFinite(valeur) || valeur <= actuel) throw new Error(`La valeur demandée doit dépasser la valeur actuelle (${actuel})`);
    if (valeur > actuel * 10) throw new Error("Demande excessive (plus de 10 fois la valeur actuelle) : justifie un palier plus raisonnable");
    const { data: dup } = await db().from("ai_approvals").select("id").eq("type", "ressources").eq("statut", "en_attente")
      .eq("agent_id", ctx.agent.id).limit(1);
    if (dup?.length) throw new Error("Une demande de ressources est déjà en attente pour toi");
    const justification = txt(i.justification, 1500, "justification", 10);
    const { error } = await db().from("ai_approvals").insert({
      type: "ressources", agent_id: ctx.agent.id, task_id: ctx.task.id,
      motif: `${ctx.agent.nom} demande ${p} : ${actuel} → ${valeur}`,
      payload: { parametre: p, valeur: String(valeur), actuel, justification },
    });
    if (error) throw new Error(error.message);
    await db().from("ai_agent_tasks").update({ statut: "attente_validation" }).eq("id", ctx.task.id);
    ctx.parked = "attente_validation";
    return { ok: true, consigne: "Demande transmise au président ; mission suspendue jusqu'à sa décision." };
  },

  async transmettre(ctx, i) {
    const target = mustFind(ctx, i.agent_code);
    if (target.id === ctx.agent.id) throw new Error("Impossible de te transmettre un dossier à toi-même");
    if (target.etat !== "actif") throw new Error(`${target.nom} n'est pas disponible (${target.etat})`);
    if (!ctx.org.collabScope(ctx.agent).has(target.id)) throw new Error(`${target.nom} est hors de ta direction : passe par ton responsable`);
    if (target.niveau <= 2) throw new Error("Un dossier ne se transmet pas à un directeur : remonte-le dans ton rapport");
    const { data: chain } = await db().rpc("ai_task_chain_agents", { p_task: ctx.task.id });
    const ids = new Set<string>((chain ?? []).map((x: unknown) => typeof x === "string" ? x : String((x as Record<string, string>).ai_task_chain_agents ?? Object.values(x as object)[0])));
    if (ids.has(target.id)) throw new Error(`Boucle évitée : ${target.nom} est déjà intervenu dans cette chaîne de traitement`);
    const { data: t, error } = await db().from("ai_agent_tasks").insert({
      parent_id: ctx.task.id, agent_id: target.id, donneur_agent_id: ctx.agent.id, type: "tache",
      titre: txt(i.titre, 200, "titre", 3), description: txt(i.instructions, 8000, "instructions", 3),
      entrees: clip(i.donnees ?? "", 20000), priorite: num(i.priorite, 1, 5, 3),
    }).select("id").single();
    if (error) throw new Error(error.code === "23505" ? "Une mission identique est déjà ouverte pour cet agent : ne la recrée pas" : error.message);
    await db().from("ai_agent_communications").insert({
      de_agent_id: ctx.agent.id, vers_agent_id: target.id, task_id: t.id, type: "transmission",
      objet: clip(i.titre, 200), contenu: clip(i.instructions, 8000), donnees: { task_id: t.id, depuis: ctx.task.id },
    });
    move(ctx, ctx.agent.id, `transmettre:${target.id}`, { lieu: "poste_agent", cible: target.id, ms: 9000, motif: "dossier" });
    return { task_id: t.id, vers: target.code };
  },

  async creer_agent(ctx, i) {
    const me = ctx.agent, gov = ctx.gov;
    const nom = txt(i.nom, 80, "nom", 2), fonction = txt(i.fonction, 120, "fonction", 2);
    const dep = ctx.departments.find((d) => d.id === i.departement_id);
    if (!dep) throw new Error("departement_id inconnu");
    const manager = i.manager_code ? mustFind(ctx, i.manager_code, "manager_code") : me;
    if (manager.id !== me.id && !ctx.org.descendants(me.id).has(manager.id) && me.niveau !== 1) throw new Error("Le responsable doit être toi-même ou l'un de tes subordonnés");
    const niveau = manager.niveau + 1;
    if (niveau > 5) throw new Error("Profondeur hiérarchique maximale atteinte (niveau 5) : choisis un responsable de niveau supérieur");
    const doublon = ctx.org.agents.find((a) => a.departement_id === dep.id && norm(a.fonction) === norm(fonction));
    if (doublon) throw new Error(`Un agent « ${doublon.fonction} » existe déjà dans ce département (code ${doublon.code}, ${doublon.etat}) : utilise-le plutôt que d'en créer un second`);
    const outils = checkGrant(me.niveau, me.outils, niveau, list(i.outils, 25, 40));
    const effort = (["low", "medium", "high"].includes(i.effort) ? i.effort : "medium") as AgentRow["effort"];
    const c = i.charte ?? {};
    const missing = ["mission_principale", "delais", "reporting"].filter((k) => !(typeof c[k] === "string" && c[k].trim())).concat(
      ["objectifs", "limites", "indicateurs"].filter((k) => list(c[k], 8, 300).length === 0));
    if (missing.length) throw new Error(`Cahier des charges incomplet : ${missing.join(", ")}`);
    const jours = i.temporaire_jours ? num(i.temporaire_jours, 1, 90, 30) : null;
    const externe = outils.some((t) => EXTERNAL_TOOLS.includes(t));
    const needsApproval = !gov.creation_autonome || (externe && gov.validation_outils_externes);
    const code = slugCode(nom, new Set(ctx.org.agents.map((a) => a.code)));

    const { data: ag, error } = await db().from("ai_agents").insert({
      code, nom, fonction, departement_id: dep.id, manager_id: manager.id, niveau,
      personnalite: i.personnalite ? txt(i.personnalite, 500, "personnalite") : null,
      specialite: i.specialite ? txt(i.specialite, 500, "specialite") : null,
      outils, effort: niveau >= 4 && effort === "high" ? "medium" : effort,
      etat: needsApproval ? "attente_validation" : "actif", temporaire: jours !== null,
      expire_at: jours !== null ? new Date(Date.now() + jours * 86400e3).toISOString() : null,
      cree_par_agent: me.id, avatar: {},
    }).select("id, code, etat").single();
    if (error) throw new Error(error.message);

    const contenu = {
      identite: `${nom} — ${fonction}, collaborateur IA de SANIX AI VIRTUAL COMPANY`,
      fonction, departement: dep.nom,
      mission_principale: txt(c.mission_principale, 1000, "mission_principale"),
      missions_secondaires: list(c.missions_secondaires, 8, 300), competences: list(c.competences, 10, 200),
      outils: outils.length ? outils.map((t) => `${t} — ${CATALOG_BY_NAME.get(t)?.desc ?? t}`) : ["Outils de base uniquement"],
      donnees: list(c.donnees, 8, 200), objectifs: list(c.objectifs, 8, 300), delais: txt(c.delais, 500, "delais"),
      indicateurs: list(c.indicateurs, 8, 300), procedures: list(c.procedures, 8, 300), limites: list(c.limites, 8, 300),
      responsable: `${manager.nom} (${manager.fonction})`, reporting: txt(c.reporting, 500, "reporting"),
    };
    const { error: e2 } = await db().from("ai_agent_charters").insert({ agent_id: ag.id, version: 1, contenu, motif: "Charte initiale", redige_par: me.id });
    if (e2) { await db().from("ai_agents").update({ etat: "archive" }).eq("id", ag.id); throw new Error(e2.message); }

    if (needsApproval) {
      await db().from("ai_approvals").insert({
        type: externe && gov.creation_autonome ? "outil_externe" : "creation_agent", agent_id: ag.id, task_id: null,
        motif: `Création de ${nom} (${fonction}) par ${me.nom}${externe ? " — outil de communication externe" : ""}`,
        payload: { outils, departement: dep.nom, mission: contenu.mission_principale },
      });
    }
    if (niveau <= 3 && !dep.responsable_id) {
      await db().from("ai_departments").update({ responsable_id: ag.id }).eq("id", dep.id).is("responsable_id", null);
      dep.responsable_id = ag.id;
    }
    ctx.org = await Org.load();
    if (!needsApproval) move(ctx, me.id, `accueil:${ag.id}`, { lieu: "poste_agent", cible: ag.id, ms: 8000, motif: "accueil" });
    return { agent_code: ag.code, etat: ag.etat, niveau,
      consigne: needsApproval ? "Agent en attente de validation du président : ne lui assigne pas de mission pour l'instant." : "Agent actif : tu peux lui assigner des missions." };
  },

  async modifier_agent(ctx, i) {
    const target = mustFind(ctx, i.agent_code);
    mustCommand(ctx, target);
    const motif = txt(i.motif, 500, "motif", 3);
    const patch: Record<string, unknown> = {};
    const notes: string[] = [];
    if (i.personnalite) patch.personnalite = txt(i.personnalite, 500, "personnalite");
    if (i.specialite) patch.specialite = txt(i.specialite, 500, "specialite");
    if (i.effort && ["low", "medium", "high"].includes(i.effort)) patch.effort = target.niveau >= 4 && i.effort === "high" ? "medium" : i.effort;
    if (i.budget_jour_usd !== undefined && i.budget_jour_usd !== null) {
      const v = Number(i.budget_jour_usd);
      if (!Number.isFinite(v) || v < 0) throw new Error("budget_jour_usd invalide");
      if (v > ctx.gov.budget_agent_jour_usd) throw new Error(`Budget au-delà du plafond par agent (${ctx.gov.budget_agent_jour_usd} $) : utilise demander_ressources`);
      patch.budget_jour_usd = v;
    }
    if (Array.isArray(i.outils)) {
      const requested = list(i.outils, 25, 40);
      checkGrant(ctx.agent.niveau, ctx.agent.outils, target.niveau, requested.filter((t) => !target.outils.includes(t)));  // seuls les ajouts sont contrôlés
      let wanted = requested.filter((t) => CATALOG_BY_NAME.get(t)?.kind !== "dg");
      const addedExternal = wanted.filter((t) => EXTERNAL_TOOLS.includes(t) && !target.outils.includes(t));
      if (addedExternal.length && ctx.gov.validation_outils_externes) {
        wanted = wanted.filter((t) => !addedExternal.includes(t));
        await db().from("ai_approvals").insert({ type: "outil_externe", agent_id: target.id,
          motif: `${ctx.agent.nom} souhaite doter ${target.nom} de : ${addedExternal.join(", ")}`, payload: { add_tools: addedExternal } });
        notes.push(`Outil(s) externe(s) ${addedExternal.join(", ")} soumis à validation du président`);
      }
      patch.outils = wanted;
    }
    const chartePatch = (i.charte && typeof i.charte === "object") ? i.charte : {};
    const touchesCharter = Object.keys(chartePatch).length > 0 || "outils" in patch || "personnalite" in patch || "specialite" in patch;
    if (!Object.keys(patch).length && !Object.keys(chartePatch).length) throw new Error("Aucune modification demandée");
    if (Object.keys(patch).length) {
      const { error } = await db().from("ai_agents").update(patch).eq("id", target.id);
      if (error) throw new Error(error.message);
    }
    let version = target.charte_version;
    if (touchesCharter) {
      const { data: last } = await db().from("ai_agent_charters").select("contenu").eq("agent_id", target.id)
        .order("version", { ascending: false }).limit(1).maybeSingle();
      const contenu: Record<string, unknown> = { ...(last?.contenu ?? {}) };
      for (const k of CHARTER_KEYS) {
        if (!(k in chartePatch)) continue;
        const v = (chartePatch as Record<string, unknown>)[k];
        contenu[k] = Array.isArray(v) ? list(v, 10, 300) : txt(v, 1000, k);
      }
      if ("outils" in patch) contenu.outils = (patch.outils as string[]).map((t) => `${t} — ${CATALOG_BY_NAME.get(t)?.desc ?? t}`);
      version = target.charte_version + 1;
      const { error } = await db().from("ai_agent_charters").insert({ agent_id: target.id, version, contenu, motif, redige_par: ctx.agent.id });
      if (error) throw new Error(error.message);
    }
    await db().from("ai_agent_communications").insert({ de_agent_id: ctx.agent.id, vers_agent_id: target.id, task_id: ctx.task.id,
      type: "decision", objet: "Cahier des charges révisé", contenu: `Motif : ${motif}`.slice(0, 8000) });
    ctx.org = await Org.load();
    move(ctx, ctx.agent.id, `revision:${target.id}`, { lieu: "poste_agent", cible: target.id, ms: 8000, motif: "revision" });
    return { ok: true, charte_version: version, notes };
  },

  async changer_etat_agent(ctx, i) {
    const target = mustFind(ctx, i.agent_code);
    mustCommand(ctx, target);
    const etat = String(i.etat);
    if (!["actif", "suspendu", "archive"].includes(etat)) throw new Error("etat invalide");
    if (target.etat === "attente_validation") throw new Error("Agent en attente de validation du président");
    if (etat === "archive" && ctx.org.children(target.id).length) throw new Error("Réaffecte ou archive d'abord ses subordonnés");
    const { error } = await db().rpc("ai_agent_change_etat", { p_agent: target.id, p_etat: etat, p_motif: txt(i.motif, 500, "motif", 3), p_par: `agent:${ctx.agent.code}` });
    if (error) throw new Error(error.message);
    ctx.org = await Org.load();
    return { ok: true, etat };
  },

  async assigner_mission(ctx, i) {
    const target = mustFind(ctx, i.agent_code);
    mustCommand(ctx, target);
    if (target.etat !== "actif") throw new Error(`${target.nom} n'est pas actif (${target.etat})`);
    const deps = list(i.depend_de, 10, 40);
    for (const d of deps) if (!UUID.test(d)) throw new Error("depend_de : identifiant de mission invalide");
    if (deps.length) {
      const { data: ok } = await db().from("ai_agent_tasks").select("id").in("id", deps).eq("parent_id", ctx.task.id);
      if ((ok ?? []).length !== deps.length) throw new Error("depend_de : uniquement des missions que tu as créées dans cette mission");
    }
    const heures = i.echeance_heures ? num(i.echeance_heures, 1, 2160, 24) : null;
    let produit: string | null = (ctx.task as { produit?: string | null }).produit ?? null;     // le logiciel de la mission mère se transmet aux sous-missions
    if (typeof i.produit === "string" && i.produit.trim()) {
      const { data: pr } = await db().from("ai_products").select("id").eq("id", i.produit.trim().toLowerCase()).eq("actif", true).maybeSingle();
      if (!pr) {
        const { data: ok } = await db().from("ai_products").select("id").eq("actif", true);
        throw new Error(`Logiciel hors périmètre commercial actuel : seuls les logiciels actifs du catalogue sont autorisés (${(ok ?? []).map((x: { id: string }) => x.id).join(", ")})`);
      }
      produit = pr.id;
    }
    const { data: t, error } = await db().from("ai_agent_tasks").insert({
      produit, resultat_attendu: typeof i.resultat_attendu === "string" && i.resultat_attendu.trim() ? clip(i.resultat_attendu.trim(), 1000) : null,
      parent_id: ctx.task.id, agent_id: target.id, donneur_agent_id: ctx.agent.id,
      type: ctx.agent.niveau <= 3 ? "mission" : "tache",
      titre: txt(i.titre, 200, "titre", 3), description: txt(i.description, 8000, "description", 3),
      objectifs: list(i.objectifs, 8, 300), entrees: i.entrees ? clip(i.entrees, 20000) : null,
      priorite: num(i.priorite, 1, 5, 3), echeance: heures ? new Date(Date.now() + heures * 3600e3).toISOString() : null,
    }).select("id").single();
    if (error) throw new Error(error.code === "23505" ? "Une mission identique est déjà ouverte pour cet agent : ne la recrée pas" : error.message);
    if (deps.length) {
      const { error: e2 } = await db().from("ai_task_dependencies").insert(deps.map((d) => ({ task_id: t.id, depend_de: d })));
      if (e2) { await db().from("ai_agent_tasks").update({ statut: "annulee" }).eq("id", t.id); throw new Error(e2.message); }
    }
    (ctx.assigned ??= new Set()).add(target.id);
    move(ctx, ctx.agent.id, `assign:${target.id}`, { lieu: "poste_agent", cible: target.id, ms: 12000, motif: "brief" });
    return { task_id: t.id, agent: target.code, statut: "a_faire", depend_de: deps };
  },

  async attendre_sous_taches(ctx) {
    const open = await openChildren(ctx.task.id);
    if (!open) throw new Error("Aucune sous-mission ni réunion en cours : conclus avec terminer_mission");
    const { error } = await db().from("ai_agent_tasks").update({ statut: "attente_sous_taches" }).eq("id", ctx.task.id).eq("statut", "en_cours");
    if (error) throw new Error(error.message);
    ctx.parked = "attente_sous_taches";
    // Course : la dernière sous-mission a pu se terminer avant la mise en attente → reprise immédiate.
    if (!(await openChildren(ctx.task.id))) {
      const { data: t } = await db().from("ai_agent_tasks").select("reprises").eq("id", ctx.task.id).single();
      await db().from("ai_agent_tasks").update({ statut: "a_faire", reprises: (t?.reprises ?? 0) + 1 })
        .eq("id", ctx.task.id).eq("statut", "attente_sous_taches");
    }
    return { ok: true };
  },

  async evaluer_tache(ctx, i) {
    if (!UUID.test(String(i.task_id))) throw new Error("task_id invalide");
    const { data: t } = await db().from("ai_agent_tasks").select("id, titre, agent_id, donneur_agent_id, statut").eq("id", i.task_id).maybeSingle();
    if (!t) throw new Error("Mission introuvable");
    if (!["terminee", "echouee", "bloquee"].includes(t.statut)) throw new Error("Seule une mission terminée peut être évaluée");
    const mine = t.donneur_agent_id === ctx.agent.id || ctx.org.descendants(ctx.agent.id).has(t.agent_id);
    if (!mine) throw new Error("Autorité insuffisante pour évaluer cette mission");
    const note = num(i.note, 0, 100, 0), commentaire = txt(i.commentaire, 2000, "commentaire", 3);
    await db().from("ai_agent_tasks").update({ evaluation: note, evaluation_commentaire: commentaire }).eq("id", t.id);
    await db().from("ai_agent_communications").insert({ de_agent_id: ctx.agent.id, vers_agent_id: t.agent_id, task_id: t.id, type: "decision",
      objet: `Évaluation : ${note}/100 — ${clip(t.titre, 100)}`, contenu: commentaire });
    move(ctx, ctx.agent.id, `eval:${t.agent_id}`, { lieu: "poste_agent", cible: t.agent_id, ms: 8000, motif: "evaluation" });
    return { ok: true };
  },

  async consulter_performance(ctx, i) {
    const jours = num(i.jours, 1, 30, 7);
    const { data, error } = await db().rpc("ai_agent_stats", { p_debut: new Date(Date.now() - jours * 86400e3).toISOString(), p_fin: new Date().toISOString() });
    if (error) throw new Error(error.message);
    move(ctx, ctx.agent.id, "supervision", { lieu: "supervision", ms: 20000, motif: "performance" });
    const scope = ctx.agent.niveau === 1 ? null : ctx.org.descendants(ctx.agent.id);
    return (data ?? []).filter((r: Record<string, any>) => r.etat !== "archive" && (!scope || scope.has(r.agent_id))).slice(0, 40)
      .map((r: Record<string, any>) => ({ code: ctx.org.byId(r.agent_id)?.code ?? r.nom, fonction: r.fonction, etat: r.etat, attribuees: r.attribuees,
        terminees: r.terminees, echouees: r.echouees, ouvertes: r.ouvertes, taux: r.taux, qualite: r.qualite, delais: r.respect_delais,
        cout_usd: r.cout_usd, incidents: r.incidents, score: r.score }));
  },

  async consulter_indicateurs(ctx, i) {
    const jours = num(i.jours, 1, 30, 1);
    move(ctx, ctx.agent.id, "supervision", { lieu: "supervision", ms: 20000, motif: "indicateurs" });
    const { data, error } = await db().rpc("ai_report_data", { p_debut: new Date(Date.now() - jours * 86400e3).toISOString(), p_fin: new Date().toISOString() });
    if (error) throw new Error(error.message);
    const d = data as Record<string, any>;
    return { periode_jours: jours, activite: d.activite, commercial: d.commercial, financier: d.financier,
      difficultes: { agents: d.difficultes?.agents_en_difficulte, missions_bloquees: d.difficultes?.missions_bloquees,
        validations_en_attente: d.difficultes?.validations_en_attente?.length ?? 0 } };
  },

  async convoquer_reunion(ctx, i) {
    const codes = list(i.participants, 12, 80);
    const max = ctx.gov.max_participants_reunion - 1;
    if (!codes.length) throw new Error("Au moins un participant est requis");
    if (codes.length > max) throw new Error(`Gouvernance : ${ctx.gov.max_participants_reunion} participants maximum (toi inclus)`);
    const scope = ctx.org.collabScope(ctx.agent);
    const agents = [...new Set(codes)].map((c) => mustFind(ctx, c, "participants"));
    for (const a of agents) {
      if (a.id === ctx.agent.id) throw new Error("Tu animes déjà la réunion : ne t'invite pas");
      if (a.etat !== "actif") throw new Error(`${a.nom} n'est pas disponible (${a.etat})`);
      if (!scope.has(a.id)) throw new Error(`${a.nom} est hors de ta direction`);
    }
    const jour0 = new Date(); jour0.setUTCHours(0, 0, 0, 0);
    const { count } = await db().from("ai_agent_meetings").select("id", { count: "exact", head: true })
      .eq("convoque_par", ctx.agent.id).neq("statut", "annulee").gte("created_at", jour0.toISOString());
    if ((count ?? 0) >= 3) throw new Error("Plafond de 3 réunions par jour atteint : décide avec les informations disponibles");
    const { data: m, error } = await db().from("ai_agent_meetings").insert({
      titre: txt(i.titre, 200, "titre", 3), ordre_du_jour: txt(i.ordre_du_jour, 4000, "ordre_du_jour", 3),
      convoque_par: ctx.agent.id, statut: "planifiee", task_id: ctx.task.id, phase: "convocation",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const { error: e2 } = await db().from("ai_meeting_participants").insert(agents.map((a, n) => ({ meeting_id: m.id, agent_id: a.id, ordre: n + 1 })));
    if (e2) throw new Error(e2.message);
    // 1. Les participants sont avertis ; 2. ils quittent leur poste pour la salle de réunion (retour automatique à la clôture)
    const titre = clip(i.titre, 150), tous = [ctx.agent.id, ...agents.map((a) => a.id)];
    await db().from("ai_agent_communications").insert(agents.map((a) => ({ de_agent_id: ctx.agent.id, vers_agent_id: a.id, type: "information",
      objet: `Réunion convoquée : ${titre}`, contenu: `Ordre du jour : ${clip(i.ordre_du_jour, 600)}` })));
    for (const id of tous) await publishMove(id, { lieu: "reunion", ms: 8 * 60000, motif: "convocation" }, { kind: "reunion", meetingId: m.id, taskId: ctx.task.id, participants: tous });
    return { meeting_id: m.id, participants: agents.map((a) => a.code), consigne: "Réunion planifiée : appelle attendre_sous_taches pour reprendre avec le procès-verbal." };
  },

  async repondre_president(ctx, i) {
    if (ctx.agent.niveau !== 1) throw new Error("Réservé au directeur général");
    const message = txt(i.message, 20000, "message", 2);
    const { error } = await db().from("ai_executive_messages").insert({ auteur: "directeur", contenu: message, task_id: ctx.task.id });
    if (error) throw new Error(error.message);
    ctx.posted.push(message);
    return { ok: true };
  },
};

/** Sous-missions ouvertes ou réunions planifiées / en cours rattachées à la mission. */
export async function openChildren(taskId: string): Promise<boolean> {
  const [t, m] = await Promise.all([
    db().from("ai_agent_tasks").select("id", { count: "exact", head: true }).eq("parent_id", taskId).in("statut", [...OPEN_STATES]),
    db().from("ai_agent_meetings").select("id", { count: "exact", head: true }).eq("task_id", taskId).in("statut", ["planifiee", "en_cours"]),
  ]);
  return (t.count ?? 0) + (m.count ?? 0) > 0;
}
