// Module 13 — présence 3D : activités détaillées, déplacements, briefing, réunion en direct, actions du président.
import { assert, dropAll, eq, freshDb, mkAgent, mkTask, one, president, PRESIDENT, rows, val } from "./testkit.ts";
import { sql } from "./fake_supabase.ts";
import { done, json, reply, results, script, use } from "./fake_anthropic.ts";
import { createInstructionTask, runTask } from "../_shared/company/engine.ts";
import { tickCompany } from "../_shared/company/tick.ts";
import { ANIMATION_OF, activityFor } from "../_shared/company/presence.ts";
import { assignMission, requestReport } from "../_shared/company/president.ts";
import { ACTIVITIES, ANIMATION_OF as CLIENT_ANIMATION_OF } from "../../../company/activity.js";

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const ticks = async (n: number) => { for (let i = 0; i < n; i++) { const r = await tickCompany(); await r.work; } };
const OP = { user_id: PRESIDENT, nom: "Président", role: "direction" };
const dgInstruction = async (texte: string) => {
  await sql("insert into auth.users(id) values ($1) on conflict do nothing", [PRESIDENT]);
  const r = await createInstructionTask(texte, PRESIDENT);
  if ("erreur" in r) throw new Error(r.erreur);
  return r.task_id;
};
const evts = (agent: string) => rows("select e.kind, e.activity, e.animation, e.location, e.duration_ms, e.status, e.department, e.task_id, e.participants, e.target_agent_id, e.created_at from ai_agent_events e join ai_agents a on a.id = e.agent_id where a.code = $1 order by e.id", [agent]);

T("P0 · le vocabulaire d'activités du serveur et celui de l'interface sont identiques", async () => {
  eq(ANIMATION_OF, CLIENT_ANIMATION_OF, "activité → animation identique côté serveur et côté 3D");
  const outils = ["create_prospect", "lister_prospects", "get_prospect", "get_product", "recommend_products", "rappeler", "consulter_taches", "memoriser", "transmettre", "update_prospect",
    "set_stage", "consulter_indicateurs", "consulter_performance", "send_message", "schedule_followup", "list_free_slots", "book_appointment", "create_offer", "get_objection", "escalate_to_human",
    "demander_validation", "demander_ressources", "attendre_sous_taches", "creer_agent", "modifier_agent", "changer_etat_agent", "assigner_mission", "evaluer_tache", "convoquer_reunion", "repondre_president", "terminer_mission", "signaler_difficulte"];
  for (const o of outils) { const a = activityFor(o, { canal: "email", mode: "telephone" }); assert(a === null || a in ACTIVITIES, `${o} → ${a} connue de l'interface`); }
  eq([activityFor("send_message", { canal: "email" }), activityFor("send_message", { canal: "whatsapp" })], ["redaction_email", "conversation_whatsapp"], "e-mail / WhatsApp");
  eq(activityFor("book_appointment", { mode: "telephone" }), "appel_telephonique", "appel téléphonique");
});

T("P1 · les outils réels déclenchent activités et déplacements (état persistant + événements)", async () => {
  await freshDb(); await president();
  await mkAgent("ag_a", "Agent A", 4, "sanix_ai_sales_director", ["send_message", "transmettre", "create_prospect", "lister_prospects"]);
  await mkAgent("ag_b", "Agent B", 4, "sanix_ai_sales_director", ["send_message"]);
  await mkAgent("ag_c", "Agent C", 4, "sanix_ai_sales_director", []);
  await sql("update ai_governance set communication_externe = 'autonome'");
  const pid = String(await val("insert into ai_prospects(entreprise, secteur, whatsapp, email) values ('Promoteur Zeta','Immobilier','+2250707070701','zeta@exemple.ci') returning id"));
  let detailPendantTour: string[] = [];
  script({
    "SANIX AI GENERAL DIRECTOR": [
      () => reply([use("consulter_indicateurs", { jours: 1 })]),                                                                     // → supervision
      async () => reply([                                                                                                          // ≥ 2 missions → cadrage
        use("assigner_mission", { agent_code: "ag_a", titre: "Mission A", description: "Description de la mission A", objectifs: ["o"], priorite: 2 }),
        use("assigner_mission", { agent_code: "ag_b", titre: "Mission B", description: "Description de la mission B", objectifs: ["o"], priorite: 2 })]),
      async () => { detailPendantTour.push(String(await val("select activite_detail from ai_agents where code='sanix_ai_general_director'"))); return reply([use("assigner_mission", { agent_code: "ag_c", titre: "Mission C", description: "Description de la mission C", objectifs: ["o"], priorite: 2 })]); },   // 1 mission → visite
      () => reply([use("attendre_sous_taches", {})]),
      () => done("Synthèse des missions A, B et C"), () => done("Synthèse finale"),
    ],
    "Agent A": [
      () => reply([use("send_message", { prospect_id: pid, canal: "email", objet: "Présentation", contenu: "Bonjour, nous présentons nos logiciels de gestion." })]),
      () => reply([use("send_message", { prospect_id: pid, canal: "whatsapp", contenu: "Bonjour, un message WhatsApp de suivi." })]),
      () => reply([use("transmettre", { agent_code: "ag_b", titre: "Dossier Zeta", instructions: "Poursuivre le dossier du promoteur Zeta", donnees: `prospect ${pid}`, priorite: 3 })]),
      () => done("Dossier transmis à Agent B", ["1 dossier"]),
    ],
    "Agent B": [() => done("Rapport de Agent B"), () => done("Rapport du dossier Zeta"), () => done("Rapport complémentaire")],
    "Agent C": [() => reply([use("terminer_mission", { statut: "bloquee", rapport: "Impossible : source indisponible", resultats: [] })])],
  });
  const t = await dgInstruction("Analyse la situation puis lance les missions A, B et C");
  await sql("update ai_agent_tasks set description = description || $2 where id = $1", [t, ` (prospect ${pid})`]);
  await runTask(t, { deadline: Date.now() + 60000 });

  const dg = await evts("sanix_ai_general_director");
  const kinds = dg.map((e: any) => `${e.kind}:${e.activity ?? e.location}`);
  assert(kinds.includes("activite:consultation_documents"), "lecture de la mission au démarrage");
  assert(kinds.includes("activite:analyse_donnees"), "consultation des indicateurs → analyse de données");
  const sup = dg.find((e: any) => e.kind === "deplacement" && e.location === "supervision");
  assert(sup && sup.duration_ms === 20000, "le directeur se déplace vers la salle de supervision");
  const brief = dg.find((e: any) => e.kind === "briefing");
  assert(brief && brief.location === "collaboration" && brief.participants.length === 3, "plusieurs missions → réunion de cadrage (3 agents)");
  const visite = dg.find((e: any) => e.kind === "deplacement" && e.location === "poste_agent");
  assert(visite && visite.target_agent_id === await val("select id from ai_agents where code='ag_c'"), "une mission → visite au poste du collaborateur");
  eq(String(await val("select lieu from ai_agents where code='sanix_ai_general_director'")), "poste_agent", "état persistant : le DG est chez Agent C");
  assert(new Date(String(await val("select lieu_jusqua from ai_agents where code='ag_a'"))) > new Date(), "agents du cadrage : retour programmé (lieu_jusqua dans le futur)");
  eq(String(await val("select lieu from ai_agents where code='ag_a'")), "collaboration", "Agent A au cadrage");
  for (const e of dg) if (e.activity) eq(e.animation, ANIMATION_OF[e.activity], `animation de ${e.activity}`);
  assert(dg.every((e: any) => e.created_at && e.department === "direction"), "événements horodatés avec département");
  eq(String(await val("select activite_detail from ai_agents where code='sanix_ai_general_director'")), "attente", "le DG attend ses équipes");
  eq(Number(await val("select count(*) from ai_agent_events where kind = 'activite' and activity = 'management'")) >= 1, true, "organisation des équipes");

  await ticks(3);   // Agent A (e-mail → WhatsApp → transmission → fin), Agent B, Agent C
  const a = await evts("ag_a");
  const acts = a.filter((e: any) => e.kind === "activite").map((e: any) => e.activity);
  eq(acts.slice(0, 6), ["consultation_documents", "redaction_email", "conversation_whatsapp", "consultation_documents", "preparation_rapport", "mission_terminee"], "Agent A : e-mail, WhatsApp, dossier, rapport, mission terminée");
  const tr = a.find((e: any) => e.kind === "deplacement" && e.location === "poste_agent");
  assert(tr && tr.target_agent_id === await val("select id from ai_agents where code='ag_b'"), "remise de dossier : Agent A rejoint le poste d'Agent B");
  eq(String(await val("select activite_detail from ai_agents where code='ag_a'")), "mission_terminee", "état final persistant");
  eq(String(await val("select activite from ai_agents where code='ag_a'")), "mission_terminee", "état grossier cohérent");
  eq(String(await val("select activite_detail from ai_agents where code='ag_c'")), "en_difficulte", "mission bloquée → signal d'alerte");
  eq(String(await val("select activite from ai_agents where code='ag_c'")), "en_difficulte", "état grossier : en difficulté");
  // retour au poste à l'échéance (entretien du planificateur)
  await sql("update ai_agents set lieu_jusqua = now() - interval '1 second' where lieu <> 'poste'");
  await ticks(1);
  eq(Number(await val("select count(*) from ai_agents where lieu <> 'poste'")), 0, "tous les agents sont revenus à leur poste");
  // activité périmée (processus interrompu) → disponible
  await sql("update ai_agents set activite = 'en_mission', activite_detail = 'analyse_donnees' where code = 'ag_b'");
  await sql("update ai_agents set activite_depuis = now() - interval '30 minutes' where code = 'ag_b'");   // (le déclencheur réarme l'horloge au changement d'état)
  await ticks(1);
  eq([String(await val("select activite from ai_agents where code='ag_b'")), await val("select activite_detail from ai_agents where code='ag_b'")], ["disponible", null], "activité périmée réinitialisée");
});

T("P2 · réunion en direct : convocation, installation, prises de parole, synthèse, clôture, retour aux postes", async () => {
  await freshDb();
  await mkAgent("ia_marche", "IA Market Research", 3, "sanix_ai_sales_director", []);
  await mkAgent("ia_closing", "IA Closing", 3, "sanix_ai_sales_director", []);
  const obs: Record<string, any> = {};
  const contrib = (nom: string, code: string) => async () => {
    obs[`orateur_${code}`] = await one("select m.phase, m.orateur_id = a.id as parle from ai_agent_meetings m, ai_agents a where a.code = $1", [code]);
    obs[`lieu_${code}`] = await val("select lieu || '/' || activite from ai_agents where code = $1", [code]);
    return json({ analyse: `Analyse de ${nom} sur le marché immobilier d'Abidjan`, conclusions: ["Cibler les promoteurs"], difficultes: [], recommandations: ["Prioriser Abidjan"], actions_proposees: [] });
  };
  script({
    "SANIX AI GENERAL DIRECTOR": [
      () => reply([use("convoquer_reunion", { titre: "Stratégie ImmoSuite", ordre_du_jour: "Élaborer la stratégie de commercialisation d'ImmoSuite ERP.", participants: ["ia_marche", "ia_closing"] }), use("attendre_sous_taches", {})]),
      async () => { obs.synthese = await one("select phase, orateur_id = (select id from ai_agents where code = 'sanix_ai_general_director') as dg from ai_agent_meetings"); return json({ synthese: "Les participants convergent vers les promoteurs agréés d'Abidjan.", decisions: ["Lancer l'étude"], plan_action: [] }); },
      () => done("Plan établi après la réunion"),
    ],
    "IA Market Research": [contrib("Market Research", "ia_marche")],
    "IA Closing": [contrib("Closing", "ia_closing")],
  });
  const t = await dgInstruction("Organise une réunion sur la stratégie ImmoSuite");
  await runTask(t, { deadline: Date.now() + 60000 });
  // 1-2. convocation : participants avertis, avatars envoyés en salle de réunion
  const m = await one("select id, phase, statut from ai_agent_meetings");
  eq([m.phase, m.statut], ["convocation", "planifiee"], "réunion convoquée");
  eq(Number(await val("select count(*) from ai_agent_communications where type = 'information' and objet like 'Réunion convoquée%'")), 2, "participants avertis");
  eq((await rows("select a.code, a.lieu from ai_agents a where a.code in ('ia_marche','ia_closing','sanix_ai_general_director') order by a.code")).map((r: any) => r.lieu), ["reunion", "reunion", "reunion"], "convocation : tous rejoignent la salle de réunion");
  assert(Number(await val("select count(*) from ai_agent_events where kind = 'reunion' and meeting_id = $1", [m.id])) === 3, "événements de convocation");
  await ticks(1);   // la réunion se tient
  eq(obs.orateur_ia_marche, { phase: "echanges", parle: true }, "pendant la contribution de Market Research, c'est lui l'orateur");
  eq(obs.orateur_ia_closing, { phase: "echanges", parle: true }, "puis Closing");
  assert(String(obs.lieu_ia_marche).startsWith("reunion/en_reunion"), `pendant la réunion les agents sont en salle (${obs.lieu_ia_marche})`);
  eq(obs.synthese, { phase: "synthese", dg: true }, "7. le directeur IA synthétise");
  const fin = await one("select phase, statut, orateur_id from ai_agent_meetings");
  eq([fin.phase, fin.statut, fin.orateur_id], ["cloture", "terminee", null], "8. clôture");
  assert(Number(await val("select count(*) from ai_meeting_minutes")) === 1, "procès-verbal enregistré");
  const paroles = await rows("select a.code, e.payload->>'extrait' as extrait from ai_agent_events e join ai_agents a on a.id = e.agent_id where e.kind = 'parole' order by e.id");
  eq(paroles.map((p: any) => p.code), ["ia_marche", "ia_closing", "sanix_ai_general_director"], "trois prises de parole, synthèse du directeur en dernier");
  assert(paroles[0].extrait.includes("marché immobilier") && paroles[2].extrait.includes("promoteurs agréés"), "extraits affichables dans les bulles");
  eq(Number(await val("select count(*) from ai_agents where lieu <> 'poste' or activite = 'en_reunion'")), 0, "retour de tous aux postes");
});

T("P3 · le président attribue une mission ou demande un rapport à un agent", async () => {
  await freshDb(); await president();
  await mkAgent("ia_hunter", "IA Hunter", 4, "sanix_ai_sales_director", ["consulter_taches"]);
  await mkAgent("ia_susp", "IA Suspendu", 4, "sanix_ai_sales_director", []);
  await sql("update ai_agents set etat = 'suspendu' where code = 'ia_susp'");
  const hunter = String(await val("select id from ai_agents where code = 'ia_hunter'"));
  const r = await assignMission(OP, { agent_id: hunter, titre: "Trouver 20 cliniques privées", description: "Recherche des cliniques privées de Cocody et Marcory.", objectifs: ["20 cliniques", "décideurs identifiés"], priorite: 2, echeance_heures: 48 });
  const row = await one("select donneur_user_id, donneur_agent_id, type, statut, priorite, objectifs, echeance from ai_agent_tasks where id = $1", [r.task_id]);
  eq([row.donneur_user_id, row.donneur_agent_id, row.type, row.statut, row.priorite, row.objectifs.length], [PRESIDENT, null, "mission", "a_faire", 2, 2], "mission du président tracée");
  assert(new Date(row.echeance) > new Date(), "échéance fixée");
  const refus = async (f: () => Promise<unknown>, partie: string, msg: string) => { try { await f(); } catch (e) { assert(String((e as Error).message).includes(partie), `${msg} : ${(e as Error).message}`); return; } throw new Error(`${msg} : refus attendu`); };
  await refus(() => assignMission(OP, { agent_id: hunter, titre: "trouver  20 CLINIQUES privées", description: "Doublon de la mission précédente", priorite: 2 }), "identique", "doublon");
  await refus(async () => assignMission(OP, { agent_id: String(await val("select id from ai_agents where code = 'ia_susp'")), titre: "Mission", description: "Description valable" }), "n'est pas actif", "agent suspendu");
  await refus(async () => assignMission(OP, { agent_id: String(await val("select id from ai_agents where niveau = 1")), titre: "Mission", description: "Description valable" }), "dialogue", "directeur général : instruction");
  await refus(() => assignMission(OP, { agent_id: "pas-un-uuid", titre: "Mission", description: "Description valable" }), "invalide", "identifiant invalide");
  await refus(() => assignMission(OP, { agent_id: hunter, titre: "x", description: "Description valable" }), "titre", "titre trop court");
  const rr = await requestReport(OP, { agent_id: hunter, jours: 14 });
  const rep = await one("select titre, priorite, description from ai_agent_tasks where id = $1", [rr.task_id]);
  eq(rep.priorite, 1, "rapport demandé : priorité maximale");
  assert(rep.titre.includes("14 j") && rep.description.includes("14 derniers jours"), "rapport demandé : période");
  // exécution par le planificateur : la mission la plus prioritaire (le rapport) passe d'abord
  script({ "IA Hunter": [
    () => reply([use("consulter_taches", { portee: "mes_sous_taches" })]), () => done("Rapport d'activité : aucune mission terminée, 1 mission du président en cours."),
    () => done("20 cliniques identifiées dans le CRM.", ["20 cliniques"]) ] });
  await ticks(2);
  eq((await rows("select titre, statut from ai_agent_tasks where agent_id = (select id from ai_agents where code = 'ia_hunter') order by finished_at")).map((x: any) => x.statut), ["terminee", "terminee"], "missions du président exécutées");
  assert(String(await val("select rapport from ai_agent_tasks where id = $1", [rr.task_id])).includes("Rapport d'activité"), "rapport remis au président");
});
T("cleanup", async () => { await dropAll(); });
