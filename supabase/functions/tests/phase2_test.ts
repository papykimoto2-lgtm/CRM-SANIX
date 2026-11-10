// Phase 2 — fiabilisation : « terminée » exige une preuve, un texte seul n'est jamais une exécution, mission par logiciel, score justifié.
// Vrai PostgreSQL + faux Claude scripté.
import { assert, dropAll, eq, freshDb, mkAgent, mkTask, one, president, rows, val } from "./testkit.ts";
import { sql } from "./fake_supabase.ts";
import { done, llm, reply, results, script, txt, use } from "./fake_anthropic.ts";
import { runTask } from "../_shared/company/engine.ts";
import { runCrmTool, type CrmCtx } from "../_shared/crm_tools.ts";

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const run = (id: string) => runTask(id, { deadline: Date.now() + 60000 });
const OUTILS = ["lister_prospects", "update_prospect", "transmettre"];
const world = async () => { await freshDb(); await president(); await mkAgent("ia_t", "IA Testeur", 4, "sanix_ai_sales_director", OUTILS); };   // le directeur commercial IA est créé par les migrations

T("P1 · terminer_mission refuse un rapport vide ou sans résultat ; l'agent corrige et la mission est terminée avec ses résultats", async () => {
  await world(); const t = await mkTask("ia_t", "Qualifier les promoteurs", { donneur: "sanix_ai_sales_director" });
  let erreurs: string[] = [];
  script({ "IA Testeur": [
    () => reply([use("terminer_mission", { statut: "terminee", rapport: "fait", resultats: [] })]),
    (p) => { erreurs.push(String(results(p)[0].data)); return reply([use("terminer_mission", { statut: "terminee", rapport: "Mission réalisée : tous les promoteurs de la liste ont été examinés.", resultats: [] })]); },
    (p) => { erreurs.push(String(results(p)[0].data)); return reply([use("terminer_mission", { statut: "terminee", rapport: "Mission réalisée : tous les promoteurs de la liste ont été examinés.", resultats: ["12 promoteurs examinés, 4 qualifiés"] })]); },
  ] });
  eq(await run(t), "terminee", "mission terminée après correction");
  assert(erreurs[0].includes("trop court"), `rapport « fait » refusé (${erreurs[0]})`);
  assert(erreurs[1].includes("sans résultat exploitable"), `aucun résultat : refusé (${erreurs[1]})`);
  const m = await one("select statut, rapport, resultats from ai_agent_tasks where id = $1", [t]);
  eq([m.statut, m.resultats], ["terminee", ["12 promoteurs examinés, 4 qualifiés"]], "résultat enregistré avec la mission");
  await dropAll();
});

T("P2 · un agent qui répond par texte sans clôturer est relancé deux fois, puis la mission est BLOQUÉE (jamais « terminée »)", async () => {
  await world(); const t = await mkTask("ia_t", "Qualifier les promoteurs", { donneur: "sanix_ai_sales_director" });
  script({ "IA Testeur": [() => reply([txt("J'ai terminé, tout est bon.")], "end_turn"), () => reply([txt("Oui, terminé.")], "end_turn"), () => reply([txt("Terminé, vraiment.")], "end_turn")] });
  eq(await run(t), "bloquee", "mission bloquée");
  const m = await one("select statut, rapport, resultats from ai_agent_tasks where id = $1", [t]);
  eq(m.statut, "bloquee", "statut en base");
  assert(m.rapport.includes("Clôture sans résultat structuré") && m.rapport.includes("Terminé, vraiment"), "rapport honnête, dernière réponse conservée");
  eq(m.resultats, [], "aucun résultat inventé");
  assert(llm.calls.length === 3, `deux relances seulement (${llm.calls.length} appels)`);
  eq(Number(await val("select count(*) from ai_agent_tasks where statut = 'terminee'")), 0, "aucune mission terminée");
  await dropAll();
});

T("P3 · une relance suffit : l'agent clôture correctement au second essai", async () => {
  await world(); const t = await mkTask("ia_t", "Qualifier les promoteurs", { donneur: "sanix_ai_sales_director" });
  script({ "IA Testeur": [() => reply([txt("Tout est fait.")], "end_turn"), () => done("Qualification terminée sur la liste complète des promoteurs.", ["4 promoteurs qualifiés"])] });
  eq(await run(t), "terminee", "terminée après la relance");
  await dropAll();
});

T("P4 · garde-fou en base : une mission ne passe pas à « terminée » sans rapport substantiel ni résultat (sauf un échange avec le président)", async () => {
  await world(); const t = await mkTask("ia_t", "Qualifier", { donneur: "sanix_ai_sales_director" });
  const tente = async (sets: string) => { try { await sql(`update ai_agent_tasks set statut = 'terminee', ${sets} where id = $1`, [t]); return ""; } catch (e) { return (e as Error).message; } };
  assert((await tente("rapport = 'ok'")).includes("sans preuve"), "rapport trop court refusé");
  assert((await tente("rapport = 'Rapport suffisamment long pour être substantiel, mais sans résultat.'")).includes("sans preuve"), "aucun résultat refusé");
  eq(await tente(`rapport = 'Rapport suffisamment long pour être substantiel et daté.', resultats = '["3 prospects enrichis"]'`), "", "rapport + résultat acceptés");
  const i = await mkTask("ia_t", "Question du président", { type: "instruction" });
  eq(await (async () => { try { await sql("update ai_agent_tasks set statut = 'terminee' where id = $1", [i]); return ""; } catch (e) { return (e as Error).message; } })(), "", "un échange avec le président n'est pas soumis à la règle");
  await dropAll();
});

T("P5 · échange avec le président terminé par un texte : accepté, avec la mention honnête qu'aucune action n'a été exécutée", async () => {
  await world(); const t = await mkTask("sanix_ai_sales_director", "Présente les opportunités de la semaine", { type: "instruction" });
  script({ "SANIX AI SALES DIRECTOR": [() => reply([txt("Voici mon analyse des opportunités de la semaine.")], "end_turn")] });
  eq(await run(t), "terminee", "réponse acceptée");
  eq((await one("select resultats from ai_agent_tasks where id = $1", [t])).resultats, ["Réponse conversationnelle : aucune action n'a été exécutée"], "mention honnête");
  await dropAll();
});

T("P6 · mission par logiciel : produit hérité par les sous-missions, logiciel hors catalogue actif refusé", async () => {
  await world(); await sql("update ai_products set actif = false where id = 'medicor'");
  const chef = await mkTask("sanix_ai_sales_director", "Campagne ImmoSuite", { donneur: null });
  await sql("update ai_agent_tasks set produit = 'immosuite' where id = $1", [chef]);
  let refus = "";
  script({ "SANIX AI SALES DIRECTOR": [
    () => reply([use("assigner_mission", { agent_code: "ia_t", titre: "Qualifier les promoteurs", description: "Qualification des promoteurs du CRM.", objectifs: ["10 fiches"], priorite: 2, resultat_attendu: "10 prospects scorés avec justification" })]),
    () => reply([use("assigner_mission", { agent_code: "ia_t", titre: "Autre mission santé", description: "Hors périmètre.", objectifs: ["x"], priorite: 3, produit: "medicor" })]),
    (p) => { refus = String(results(p)[0].data); return done("Plan lancé : une sous-mission créée pour ImmoSuite.", ["1 sous-mission créée, 1 refus hors périmètre"]); },
  ] });
  await run(chef);
  const sous = await one("select produit, resultat_attendu from ai_agent_tasks where parent_id = $1", [chef]);
  eq([sous.produit, sous.resultat_attendu], ["immosuite", "10 prospects scorés avec justification"], "produit hérité et résultat attendu enregistré");
  assert(refus.includes("hors périmètre") && refus.includes("immosuite"), `logiciel désactivé refusé (${refus})`);
  eq(Number(await val("select count(*) from ai_agent_tasks where parent_id = $1", [chef])), 1, "aucune mission créée pour le logiciel refusé");
  await dropAll();
});

T("P7 · score /100 : justification obligatoire, barème du cahier des charges, plafonds par critère", async () => {
  await freshDb();
  const id = String(await val("insert into ai_prospects(entreprise, secteur) values ('Promoteur Test', 'Immobilier') returning id"));
  const ctx: CrmCtx = { agentLabel: "test", agentId: null, scope: new Set([id]), createCap: 0, created: 0, source: "test" };
  const crit = { produit: 25, besoin: 25, taille: 15, decideur: 15, maturite: 10, fiabilite: 10 };
  const base = { prospect_id: id, secteur: null, decideur: null, decideur_fonction: null, email: null, logiciel_actuel: null, besoins: null, produits_recommandes: null, budget_estime: null, potentiel_fcfa: null, resume: null };
  let e = ""; try { await runCrmTool(ctx, "update_prospect", { ...base, criteres: crit, justification_score: "court" }); } catch (x) { e = (x as Error).message; }
  assert(e.includes("non justifié"), `score sans justification refusé (${e})`);
  eq(Number(await val("select score from ai_prospects where id = $1", [id])), 0, "aucun score enregistré");
  const r = await runCrmTool(ctx, "update_prospect", { ...base, criteres: { ...crit, besoin: 99, maturite: 40 }, justification_score: "Promoteur identifié (site officiel), programme en commercialisation, décideur joignable" }) as { score: number; priorite: string };
  eq([r.score, r.priorite], [100, "prioritaire"], "plafonds : besoin 25 et maturité 10, total 100 = priorité stratégique");
  const p = await one("select crit_besoin, crit_court_terme, score_justification from ai_prospects where id = $1", [id]);
  eq([p.crit_besoin, p.crit_court_terme, p.score_justification.startsWith("Promoteur identifié")], [25, 10, true], "critères et justification enregistrés");
  await sql("update ai_prospects set crit_produit = 10, crit_besoin = 10, crit_finance = 10, crit_decideur = 10, crit_court_terme = 5, crit_disponibilite = 5 where id = $1", [id]);
  eq(String(await val("select priorite from ai_prospects where id = $1", [id])), "a_developper", "50/100 : potentiel à approfondir (seuils 80 / 60 / 40)");
  let sans = ""; try { await sql("insert into ai_prospects(entreprise, crit_produit, score_justification) values ('Sans preuve', 20, null)"); } catch (x) { sans = (x as Error).message; }
  assert(sans.includes("score_justifie"), "la base refuse aussi un score sans justification");
  await dropAll();
});
