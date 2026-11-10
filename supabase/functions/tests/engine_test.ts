// Scénarios d'intégration : vrai PostgreSQL (triggers, contraintes, fonctions SQL) + faux Claude scripté.
import { asPresident, assert, dropAll, eq, freshDb, mkAgent, mkTask, one, PRESIDENT, president, rows, val } from "./testkit.ts";
import { sql } from "./fake_supabase.ts";
import { done, json, llm, reply, results, script, use, txt } from "./fake_anthropic.ts";
import { flushOutbox } from "../_shared/outbox.ts";
import { runAgent } from "../_shared/agent.ts";
import { runTask, createInstructionTask } from "../_shared/company/engine.ts";
import { tickCompany } from "../_shared/company/tick.ts";
import { cronSecret, resetCronSecretCache } from "../_shared/core.ts";

const CHARTE = {
  mission_principale: "Mission principale mesurable", missions_secondaires: ["Secondaire"], competences: ["Compétence"], donnees: ["Prospects CRM"],
  objectifs: ["Objectif chiffré"], delais: "48 h", indicateurs: ["Prospects par jour"], procedures: ["Procédure"], limites: ["Aucun engagement"], reporting: "Rapport de fin de mission",
};
const agentDef = (nom: string, fonction: string, niveauOutils: string[], extra: Record<string, unknown> = {}) => ({
  nom, fonction, departement_id: "commercial", personnalite: "Rigoureux", specialite: "Prospection", outils: niveauOutils, effort: "low", charte: CHARTE, ...extra,
});
const ticks = async (n: number) => { for (let i = 0; i < n; i++) { const r = await tickCompany(); await r.work; } };
const dgTask = async (texte = "Vendre 20 licences ImmoSuite ce mois-ci : organise les équipes et présente-moi ton plan.") => {
  await sql("insert into auth.users(id) values ($1) on conflict do nothing", [PRESIDENT]);
  const r = await createInstructionTask(texte, PRESIDENT);
  if ("erreur" in r) throw new Error(r.erreur);
  return r;
};
const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });

T("T1 · instruction → organisation → exécution en chaîne → synthèse au président", async () => {
  await freshDb();
  let respCode = "", hunterCode = "", qualifCode = "", hunterTask = "";
  script({
    "SANIX AI GENERAL DIRECTOR": [
      () => reply([
        use("assigner_mission", { agent_code: "sanix_ai_sales_director", titre: "Plan commercial ImmoSuite : 20 licences", description: "Organiser les équipes et atteindre 20 licences ImmoSuite.", objectifs: ["20 licences ImmoSuite"], priorite: 1, echeance_heures: 720 }),
        use("repondre_president", { message: "Plan : la direction commerciale organise prospection → qualification → démos." }),
        use("attendre_sous_taches", {}),
      ]),
      () => done("Synthèse : 3 prospects trouvés, 2 qualifiés. Poursuite du plan.", ["3 prospects"]),
    ],
    "SANIX AI SALES DIRECTOR": [
      () => reply([use("creer_agent", agentDef("IA Responsable Prospection", "Responsable prospection", ["assigner_mission", "attendre_sous_taches", "evaluer_tache", "transmettre"]))]),
      (p) => {
        respCode = results(p)[0].data.agent_code;
        return reply([
          use("creer_agent", agentDef("IA Prospect Hunter", "Chercheur de promoteurs", ["recherche_web", "create_prospect", "transmettre"], { manager_code: respCode })),
          use("creer_agent", agentDef("IA Lead Qualifier", "Qualification commerciale", ["lister_prospects", "update_prospect", "set_stage"], { manager_code: respCode })),
        ]);
      },
      (p) => {
        [hunterCode, qualifCode] = results(p).map((r) => r.data.agent_code);
        return reply([use("assigner_mission", { agent_code: hunterCode, titre: "Trouver 3 promoteurs immobiliers à Abidjan", description: "Recherche web, enregistrement CRM.", objectifs: ["3 promoteurs"], priorite: 2 })]);
      },
      (p) => {
        hunterTask = results(p)[0].data.task_id;
        return reply([use("assigner_mission", { agent_code: qualifCode, titre: "Qualifier les promoteurs trouvés", description: "Score /100 et étape qualifie.", objectifs: ["Scorer chaque prospect"], priorite: 2, depend_de: [hunterTask] })]);
      },
      () => reply([use("attendre_sous_taches", {})]),
      // reprise : évaluation puis rapport
      (p) => {
        const brief = String(p.messages[0].content);
        const m = [...brief.matchAll(/\[([0-9a-f-]{36})\] (\S+) · ([^·]+)/g)].find((x) => x[2] === hunterCode)!;
        return reply([use("evaluer_tache", { task_id: m[1], note: 85, commentaire: "Bon travail, sources vérifiables." })]);
      },
      () => done("Équipe commerciale en place : 3 prospects trouvés, 2 qualifiés.", ["3 prospects", "2 qualifiés"]),
    ],
    "IA Prospect Hunter": [
      () => reply([
        use("create_prospect", { entreprise: "Promoteur Alpha", secteur: "Immobilier", ville: "Abidjan", telephone: "0707000001", source_url: "https://exemple.ci/alpha", besoins_detectes: ["suivi des ventes"], produit_recommande: "immosuite" }),
        use("create_prospect", { entreprise: "Promoteur Beta", secteur: "Immobilier", ville: "Abidjan", telephone: "0707000002", email: "contact@beta.ci", source_url: "https://exemple.ci/beta", besoins_detectes: [], produit_recommande: "immosuite" }),
        use("create_prospect", { entreprise: "Promoteur Gamma", secteur: "Immobilier", ville: "Abidjan", source_url: "https://exemple.ci/gamma", besoins_detectes: [], produit_recommande: "immosuite" }),
        use("memoriser", { contenu: "Les annuaires immobiliers d'Abidjan listent les promoteurs agréés", tags: ["annuaire"], partage: false }),
      ]),
      (p) => done(`3 promoteurs enregistrés : ${results(p).filter((r) => r.data?.prospect_id).map((r) => r.data.prospect_id).join(", ")}`, ["3 prospects"]),
    ],
    "IA Lead Qualifier": [
      () => reply([use("lister_prospects", { stage: "enregistre", secteur: "Immobilier", limite: 10 })]),
      (p) => {
        const liste = results(p)[0].data as { id: string; entreprise: string }[];
        return reply(liste.flatMap((x) => [
          use("update_prospect", { prospect_id: x.id, criteres: { produit: 25, besoin: 12, taille: 8, decideur: x.entreprise.endsWith("Gamma") ? 2 : 10, maturite: 10, fiabilite: 6 }, justification_score: "Promoteur actif, fiche vérifiée sur le registre et le site de l'entreprise", resume: "Promoteur actif" }),
          use("set_stage", { prospect_id: x.id, stage: "qualifie", motif: "Score suffisant" }),
        ]));
      },
      () => done("3 prospects scorés et qualifiés.", ["3 qualifiés"]),
    ],
  });

  const instr = await dgTask();
  await runTask(instr.task_id, { deadline: Date.now() + 60000 });
  eq(await val("select statut from ai_agent_tasks where id = $1", [instr.task_id]), "attente_sous_taches", "DG en attente de la direction commerciale");
  await ticks(6);

  const st = await rows("select t.titre, t.statut, a.code, t.profondeur, t.evaluation from ai_agent_tasks t join ai_agents a on a.id = t.agent_id order by t.created_at");
  for (const t of st) eq(t.statut, "terminee", `mission « ${t.titre} » terminée`);

  eq(Number(await val("select count(*) from ai_agents")), 5, "5 agents (2 d'origine + responsable + chercheur + qualificateur)");
  eq(Number(await val("select count(*) from ai_agent_charters where jsonb_typeof(contenu->'objectifs') = 'array' and version = 1")), 5, "cahiers des charges v1");
  const hierarchy = await rows("select a.code, a.niveau, m.code as chef from ai_agents a left join ai_agents m on m.id = a.manager_id order by a.niveau, a.code");
  eq(hierarchy.map((r: any) => `N${r.niveau} ${r.code} ← ${r.chef ?? "—"}`), [
    "N1 sanix_ai_general_director ← —", "N2 sanix_ai_sales_director ← sanix_ai_general_director", "N3 ia_responsable_prospection ← sanix_ai_sales_director",
    "N4 ia_lead_qualifier ← ia_responsable_prospection", "N4 ia_prospect_hunter ← ia_responsable_prospection"], "hiérarchie créée par les agents");

  const prospects = await rows("select entreprise, stage, score, priorite, source from ai_prospects order by entreprise");
  eq(prospects.map((p: any) => [p.entreprise, p.stage, p.score]), [["Promoteur Alpha", "qualifie", 71], ["Promoteur Beta", "qualifie", 71], ["Promoteur Gamma", "qualifie", 63]], "prospects créés puis qualifiés");
  assert(prospects.every((p: any) => p.source.startsWith("agent:")), "source tracée");

  const exec = await rows("select auteur, left(contenu, 40) c from ai_executive_messages order by id");
  eq(exec.map((e: any) => e.auteur), ["directeur", "directeur"], "plan puis synthèse finale du directeur (le message du président est ajouté par la fonction HTTP)");
  eq(Number(await val("select evaluation from ai_agent_tasks where titre like 'Trouver 3%'")), 85, "évaluation enregistrée");
  eq(await val("select incidents_consecutifs from ai_agents where code like '%hunter%'"), 0, "aucun incident");
  eq(await val("select activite from ai_agents where code like '%hunter%'"), "mission_terminee", "activité de fin de mission");
  assert(Number(await val("select count(*) from ai_agent_memory")) === 1, "mémoire enregistrée");
  eq(Number(await val("select count(*) from ai_agent_communications where type = 'rapport'")), 3, "rapports hiérarchiques tracés (chercheur→responsable, qualificateur→responsable, directeur commercial→DG)");

  const cout = Number(await val("select coalesce(sum(cout_usd),0) from ai_actions where action = 'llm_turn'"));
  eq(Number(await val("select count(*) from ai_actions where action = 'llm_turn'")), llm.calls.length, "chaque appel IA est journalisé");
  assert(Math.abs(cout - llm.calls.length * 0.014) < 1e-6, `coût cumulé cohérent (${cout})`);
  eq(Number(await val("select count(*) from ai_incidents")), 0, "aucun incident");
  const stats = await rows("select nom, attribuees, terminees from ai_agent_stats(now() - interval '1 day', now() + interval '1 minute') where terminees > 0 order by nom");
  assert(stats.length >= 4, "statistiques de performance disponibles");
});


// ─── Aides de scénario ──────────────────────────────────────────────
const errs = (p: any) => results(p).filter((r) => r.is_error).map((r) => String(r.content));

// ─── T2 · gouvernance ───────────────────────────────────────────────
T("T2 · gouvernance : validation des créations, plafond d'agents, demande de ressources", async () => {
  await freshDb(); await president();
  await sql("update ai_governance set creation_autonome = false, max_agents_actifs = 4");
  let seen: string[] = [];
  script({ "SANIX AI GENERAL DIRECTOR": [
    () => reply([
      use("creer_agent", agentDef("IA Directeur Marketing", "Directeur marketing", [], { departement_id: "marketing" })),
      use("creer_agent", agentDef("IA Directeur Intelligence", "Directeur intelligence économique", [], { departement_id: "intelligence" })),
      use("creer_agent", agentDef("IA Directeur Client", "Directeur relation client", [], { departement_id: "relation_client" })),
      use("assigner_mission", { agent_code: "ia_directeur_marketing", titre: "Campagne", description: "x", objectifs: ["x"], priorite: 3 }),
    ]),
    (p) => {
      seen = errs(p);
      return reply([use("demander_ressources", { parametre: "max_agents_actifs", valeur: 6, justification: "Trois directions à créer pour couvrir marketing, intelligence et relation client." })]);
    },
    () => done("Organisation complétée."),
  ] });
  const t = await dgTask("Déploie les directions marketing, intelligence et relation client.");
  await runTask(t.task_id, { deadline: Date.now() + 60000 });
  eq(seen.length, 2, "2 erreurs remontées au modèle");
  assert(seen[0].includes("Gouvernance : 4 agents actifs maximum"), `plafond d'agents appliqué (${seen[0]})`);
  assert(seen[1].includes("n'est pas actif"), "pas de mission pour un agent non validé");
  eq(await rows("select code, etat from ai_agents where niveau = 2 and code <> 'sanix_ai_sales_director' order by code"),
    [{ code: "ia_directeur_intelligence", etat: "attente_validation" }, { code: "ia_directeur_marketing", etat: "attente_validation" }], "agents en attente de validation");
  eq(await val("select statut from ai_agent_tasks where id = $1", [t.task_id]), "attente_validation", "DG suspendu dans l'attente");
  const ap = await rows("select id, type, motif from ai_approvals where statut = 'en_attente' order by type");
  eq(ap.map((a: any) => a.type), ["creation_agent", "creation_agent", "ressources"], "3 validations demandées");

  const res = ap.find((a: any) => a.type === "ressources").id;
  await asPresident(`select ai_decide_approval('${res}', true, 'Accordé')`);
  eq(Number(await val("select max_agents_actifs from ai_governance")), 6, "ressources accordées");
  eq(await val("select statut from ai_agent_tasks where id = $1", [t.task_id]), "a_faire", "mission du DG relancée par la décision");
  const [a1, a2] = ap.filter((a: any) => a.type === "creation_agent");
  await asPresident(`select ai_decide_approval('${a1.id}', true, null); select ai_decide_approval('${a2.id}', false, 'Inutile')`);
  eq((await rows("select etat from ai_agents where niveau = 2 and code <> 'sanix_ai_sales_director' order by etat")).map((r: any) => r.etat), ["actif", "archive"], "un agent validé, l'autre refusé et archivé");
  await ticks(1);
  eq(await val("select statut from ai_agent_tasks where id = $1", [t.task_id]), "terminee", "DG termine après décision");
  eq(Number(await val("select count(*) from ai_agent_communications where type = 'decision'")), 1, "décision communiquée à l'agent");
});

// ─── T3 · autorité, anti-boucle, moindre privilège ─────────────────
T("T3 · autorité hiérarchique, anti-boucle, doublons, privilèges", async () => {
  await freshDb();
  await mkAgent("resp", "Resp", 3, "sanix_ai_sales_director", ["assigner_mission", "attendre_sous_taches", "transmettre", "creer_agent"]);
  await mkAgent("agent_a1", "A1", 4, "resp", ["transmettre"]);
  await mkAgent("agent_a2", "A2", 4, "resp", ["transmettre"]);
  await mkAgent("autre", "Autre", 3, "sanix_ai_general_director", [], "marketing");
  const racine = await mkTask("resp", "Mission racine", { donneur: "sanix_ai_sales_director" });
  const tA1 = await mkTask("agent_a1", "Étape 1", { parent: racine, donneur: "resp" });
  let e1: string[] = [], e2: string[] = [], e3: string[] = [];
  script({
    "Resp": [
      () => reply([
        use("assigner_mission", { agent_code: "agent_a1", titre: "Travail A", description: "Description suffisante de la mission", objectifs: ["o"], priorite: 3 }),
        use("assigner_mission", { agent_code: "agent_a1", titre: "  travail   A ", description: "Description suffisante de la mission", objectifs: ["o"], priorite: 3 }),   // doublon
        use("assigner_mission", { agent_code: "autre", titre: "Hors équipe", description: "Description suffisante de la mission", objectifs: ["o"], priorite: 3 }),  // pas son subordonné
        use("assigner_mission", { agent_code: "sanix_ai_sales_director", titre: "Ordre à son chef", description: "Description suffisante de la mission", objectifs: ["o"], priorite: 3 }),
        use("creer_agent", agentDef("Escalade", "Agent avec outil non possédé", ["send_message"], { effort: "low" })),             // privilège non possédé
        use("creer_agent", agentDef("Doublon fonction", "Qualification commerciale", ["transmettre"])),
        use("creer_agent", agentDef("Doublon fonction 2", "qualification   COMMERCIALE", ["transmettre"])),
      ]),
      (p) => { e1 = errs(p); return done("Rapport de fin de mission"); },
    ],
    "A1": [
      () => reply([
        use("transmettre", { agent_code: "agent_a2", titre: "Suite", instructions: "Traiter le dossier transmis", donnees: "d", priorite: 3 }),                // légitime
        use("transmettre", { agent_code: "resp", titre: "Retour", instructions: "Instructions suffisantes", donnees: "d", priorite: 3 }),                // retour à l'ancêtre
        use("transmettre", { agent_code: "autre", titre: "Hors direction", instructions: "Instructions suffisantes", donnees: "d", priorite: 3 }),
        use("transmettre", { agent_code: "sanix_ai_sales_director", titre: "Vers directeur", instructions: "Instructions suffisantes", donnees: "d", priorite: 3 }),
        use("creer_agent", agentDef("Interdit", "Fonction interdite", [])),                                                       // outil non autorisé
      ]),
      (p) => { e2 = errs(p); return done("Rapport de fin A1"); },
    ],
    "A2": [
      () => reply([use("transmettre", { agent_code: "agent_a1", titre: "Ping-pong", instructions: "Instructions suffisantes", donnees: "d", priorite: 3 })]),   // A1 est dans la chaîne
      (p) => { e3 = errs(p); return done("Rapport de fin A2"); },
    ],
  });
  const o1 = await runTask(racine, { deadline: Date.now() + 60000 });
  const o2 = await runTask(tA1, { deadline: Date.now() + 60000 });
  eq([o1, o2], ["terminee", "terminee"], "missions terminées malgré les refus");
  assert(e1[0].includes("identique est déjà ouverte"), `doublon refusé : ${e1[0]}`);
  assert(e1[1].includes("pas ton subordonné"), `autorité : ${e1[1]}`);
  assert(e1[2].includes("pas ton subordonné"), `ordre à un supérieur refusé : ${e1[2]}`);
  assert(e1[3].includes("tu ne le possèdes pas"), `escalade de privilèges refusée : ${e1[3]}`);
  assert(e1.some((x) => x.includes("existe déjà dans ce département")), "doublon de fonction refusé (normalisé)");
  assert(e2[0].includes("Boucle évitée"), `retour à l'ancêtre refusé : ${e2[0]}`);
  assert(e2[1].includes("hors de ta direction"), `hors direction : ${e2[1]}`);
  assert(e2[2].includes("directeur"), `pas de transmission à un directeur : ${e2[2]}`);
  assert(e2[3].includes("Outil non autorisé"), `outil non attribué : ${e2[3]}`);
  const tA2 = await val("select id from ai_agent_tasks where titre = 'Suite'");
  assert(tA2, "transmission légitime créée");
  await runTask(String(tA2), { deadline: Date.now() + 60000 }).catch(() => {});
  eq(Number(await val("select count(*) from ai_agent_communications where type = 'transmission'")), 1, "transmission tracée");
});


// ─── T4 · communication externe sous gouvernance ───────────────────
T("T4 · communication externe : validation → envoi ; interdite ; autonome ; désinscrit ; cloisonnement", async () => {
  await freshDb(); await president();
  const pid = String(await val("insert into ai_prospects(entreprise, secteur, whatsapp, email) values ('Promoteur Delta','Immobilier','+225 07 07 07 07 07','delta@exemple.ci') returning id"));
  const autre = String(await val("insert into ai_prospects(entreprise, secteur) values ('Autre Société','Immobilier') returning id"));
  await mkAgent("ia_whatsapp", "IA WhatsApp Sales", 4, "sanix_ai_sales_director", ["send_message", "lister_prospects"]);
  const envoi = (contenu: string, id = pid) => use("send_message", { prospect_id: id, canal: "whatsapp", contenu });
  const lancer = async (...appels: any[]) => {
    const t = await mkTask("ia_whatsapp", `Contacter Delta ${Math.random()}`, { description: `Contacter le prospect ${pid}` });
    let e: string[] = [], r: any[] = [];
    script({ "IA WhatsApp Sales": [() => reply(appels), (p) => { e = errs(p); r = results(p).map((x) => x.data); return done("Rapport de fin de mission"); }] });
    await runTask(t, { deadline: Date.now() + 60000 });
    return { e, r };
  };
  const fetches: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, init: any) => { fetches.push({ url: String(url), body: JSON.parse(init.body) });
    return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: "wamid.TEST" }] }), { status: 200 })); }) as typeof fetch;
  try {
    // 1. régime « validation » (défaut) : brouillon + approbation, rien ne part
    const a = await lancer(envoi("Bonjour, je présente nos logiciels de gestion immobilière."));
    eq(a.r[0].statut, "a_valider", "message mis en validation");
    const m = await one("select id, statut, contenu from ai_messages order by id desc limit 1");
    assert(m.contenu.includes("assistant commercial virtuel (IA)"), "mention IA ajoutée au premier contact");
    eq(fetches.length, 0, "rien n'est parti");
    eq(await val("select type from ai_approvals where statut = 'en_attente'"), "message", "approbation de message");
    // 2. approbation → file d'envoi → envoi (hors fenêtre 24 h : modèle Meta seulement)
    const ap = await val("select id from ai_approvals where type = 'message'");
    await asPresident(`select ai_decide_approval('${ap}', true, null)`);
    eq(await val("select statut from ai_messages where id = $1", [m.id]), "a_envoyer", "message approuvé");
    await flushOutbox();
    eq(await val("select statut from ai_messages where id = $1", [m.id]), "a_envoyer", "WhatsApp non configuré : reste en file");
    Deno.env.set("WHATSAPP_TOKEN", "tok"); Deno.env.set("WHATSAPP_PHONE_NUMBER_ID", "123");
    const f = await flushOutbox();
    eq(f.envoyes, 1, "envoi après configuration");
    eq(await val("select statut from ai_messages where id = $1", [m.id]), "envoye", "message envoyé");
    eq(fetches[0].body.type, "template", "hors fenêtre 24 h : seul le modèle approuvé part");
    assert(fetches[0].url.includes("/123/messages"), "bonne URL");
    eq(await val("select phone_norm from ai_prospects where id = $1", [pid]), "2250707070707", "numéro normalisé");
    eq(await val("select relances_sans_reponse from ai_prospects where id = $1", [pid]), 1, "relance comptée");
    // 3. régime « interdite »
    await sql("update ai_governance set communication_externe = 'interdite'");
    const b = await lancer(envoi("Autre message pour Delta, suite au premier."));
    assert(b.e[0].includes("interdite"), `communication interdite : ${b.e[0]}`);
    // 4. régime « autonome » + dans la fenêtre 24 h → texte libre direct
    await sql("update ai_governance set communication_externe = 'autonome'");
    await sql("update ai_prospects set last_inbound_at = now() where id = $1", [pid]);
    fetches.length = 0;
    const c = await lancer(envoi("Merci pour votre retour, voici un créneau de démonstration."));
    eq(c.r[0].statut, "envoye", "envoi autonome");
    eq(fetches[0].body.type, "text", "dans la fenêtre 24 h : texte libre");
    // 5. cloisonnement : prospect hors périmètre de la mission
    const d = await lancer(envoi("Message vers un prospect étranger à la mission", autre));
    assert(d.e[0].includes("hors du périmètre"), `périmètre de mission : ${d.e[0]}`);
    // 6. désinscription
    await sql("update ai_prospects set opt_out = true where id = $1", [pid]);
    const e = await lancer(envoi("Relance malgré la désinscription du prospect."));
    assert(e.e[0].includes("désinscrit"), `désinscrit : ${e.e[0]}`);
  } finally { globalThis.fetch = realFetch; Deno.env.delete("WHATSAPP_TOKEN"); Deno.env.delete("WHATSAPP_PHONE_NUMBER_ID"); }

  // v1 (conversation) : cloisonnement strict sur le prospect en cours
  script({ "SANIX AI SALES DIRECTOR": [
    () => reply([use("get_prospect", { prospect_id: autre })]),
    (p) => { eq(errs(p).length, 1, "conversation : prospect étranger refusé"); assert(errs(p)[0].includes("hors du prospect en cours"), "message de cloisonnement"); return reply([txt("Fin")], "end_turn"); },
  ] });
  const out = await runAgent({ mode: "conversation", prospect_id: pid }, `Nouveau message du prospect ${pid}`);
  eq(out.resume, "Fin", "run v1 terminé");
});

// ─── T5 · budget et pannes ──────────────────────────────────────────
T("T5 · budget IA, panne du fournisseur, erreurs d'exécution et suspension automatique", async () => {
  await freshDb(); await president();
  // Budget : 2 appels passent (0,014 $ chacun), le 3e est refusé
  await sql("update ai_governance set budget_jour_usd = 0.02");
  script({ "SANIX AI GENERAL DIRECTOR": [
    () => reply([use("consulter_indicateurs", { jours: 1 })]), () => reply([use("consulter_indicateurs", { jours: 1 })]), () => reply([use("consulter_indicateurs", { jours: 1 })]),
  ] });
  const t = await dgTask("Analyse les indicateurs");
  eq(await runTask(t.task_id, { deadline: Date.now() + 60000 }), "reportee", "mission reportée faute de budget");
  eq(llm.calls.length, 2, "aucun appel IA au-delà du budget");
  const row = await one("select statut, executions from ai_agent_tasks where id = $1", [t.task_id]);
  eq([row.statut, row.executions], ["a_faire", 0], "essai non compté, mission à reprendre");
  eq(Number(await val("select count(*) from ai_incidents where type = 'budget'")), 1, "incident budget enregistré");
  const r = await tickCompany(); await r.work;
  eq(r.missions, 0, "aucune mission lancée tant que le budget est atteint");
  await sql("update ai_governance set budget_jour_usd = 50");
  await sql("update ai_governance set actif = false");
  const r2 = await tickCompany();
  eq(r2.ignore, "Entreprise virtuelle en pause", "interrupteur général");
  await sql("update ai_governance set actif = true");

  // Panne du fournisseur : mission reportée sans pénalité, pause du planificateur
  llm.handler = () => { const e: any = new Error("overloaded"); e.status = 529; throw e; };
  const tr = await dgTask("Autre analyse après une panne");
  const out = await runTask(tr.task_id, { deadline: Date.now() + 60000 });
  eq(out, "reportee", "panne transitoire");
  eq(await val("select executions from ai_agent_tasks where id = $1", [tr.task_id]), 0, "essai rendu");
  eq(Number(await val("select incidents_consecutifs from ai_agents where niveau = 1")), 0, "l'agent n'est pas sanctionné");
  eq((await tickCompany()).ignore, "Service IA indisponible : pause de 3 minutes", "pause du planificateur");

  // Erreurs d'exécution : 3 échecs consécutifs ⇒ suspension automatique + mission bloquée + alerte
  await sql("delete from ai_incidents");
  await mkAgent("agent_fragile", "Fragile", 4, "sanix_ai_sales_director", []);
  llm.handler = () => { throw new Error("réponse corrompue"); };
  for (let i = 0; i < 3; i++) {
    const id = await mkTask("agent_fragile", `Mission fragile ${i}`, { donneur: "sanix_ai_sales_director" });
    await runTask(id, { deadline: Date.now() + 60000 });
  }
  eq(await val("select etat from ai_agents where code = 'agent_fragile'"), "suspendu", "suspension automatique après 3 incidents");
  eq(Number(await val("select count(*) from ai_incidents where type = 'suspension_auto' and gravite = 'critique'")), 1, "incident critique");
  eq(Number(await val("select count(*) from ai_agent_communications where type = 'alerte' and objet like 'Suspension automatique%'")), 1, "responsable alerté");
  const id4 = await mkTask("agent_fragile", "Mission après suspension", { statut: "a_faire" }).catch((e) => String(e.message));
  assert(String(id4).includes("Agent indisponible"), "plus de mission pour un agent suspendu");
});

// ─── T6 · réunions ──────────────────────────────────────────────────
T("T6 · réunion entre agents : contributions, procès-verbal, plan d'action, reprise du convocateur", async () => {
  await freshDb();
  await mkAgent("ia_marche", "IA Market Research", 3, "sanix_ai_sales_director", ["recherche_web"]);
  await mkAgent("ia_closing", "IA Closing", 3, "sanix_ai_sales_director", ["get_product"]);
  const contrib = (nom: string) => () => json({ analyse: `Analyse de ${nom}`, conclusions: ["Cibler les promoteurs agréés"], difficultes: ["Données incomplètes"],
    recommandations: ["Prioriser Abidjan"], actions_proposees: [{ titre: `Action ${nom}`, description: "Faire le nécessaire", responsable_code: "ia_marche", priorite: 2 }] });
  let brief2 = "";
  script({
    "SANIX AI GENERAL DIRECTOR": [
      () => reply([use("convoquer_reunion", { titre: "Stratégie de commercialisation ImmoSuite", ordre_du_jour: "Élaborer le plan de commercialisation d'ImmoSuite ERP.", participants: ["ia_marche", "ia_closing", "sanix_ai_sales_director"] }), use("attendre_sous_taches", {})]),
      () => json({ synthese: "Les trois contributions convergent : cibler les promoteurs agréés d'Abidjan.", decisions: ["Lancer une étude de marché", "Préparer le discours closing"],
        plan_action: [{ titre: "Étude des promoteurs agréés", description: "Recenser les promoteurs agréés et leurs besoins.", responsable_code: "ia_marche", priorite: 2, echeance_jours: 5 },
          { titre: "Argumentaire closing ImmoSuite", description: "Rédiger l'argumentaire de conclusion.", responsable_code: "ia_closing", priorite: 3, echeance_jours: 7 },
          { titre: "Mission fantôme", description: "Responsable inexistant", responsable_code: "inconnu", priorite: 3, echeance_jours: 3 }] }),
      (p) => { brief2 = String(p.messages[0].content); return done("Plan d'action établi suite à la réunion."); },
    ],
    "IA Market Research": [contrib("Market Research"), () => done("Étude réalisée.")],
    "IA Closing": [contrib("Closing"), () => done("Argumentaire rédigé.")],
    "SANIX AI SALES DIRECTOR": [contrib("Sales Director")],
  });
  // le DG n'a pas l'outil par défaut de convoquer avec ces participants ? (si) → l'instruction passe directement
  const t = await dgTask("Organise une réunion pour élaborer la stratégie de commercialisation d'ImmoSuite ERP.");
  await runTask(t.task_id, { deadline: Date.now() + 60000 });
  eq(await val("select statut from ai_agent_tasks where id = $1", [t.task_id]), "attente_sous_taches", "DG attend la réunion");
  await ticks(1);   // réunion
  const mt = await one("select statut, cout_usd from ai_agent_meetings");
  eq(mt.statut, "terminee", "réunion terminée");
  assert(mt.cout_usd > 0.04, `coût de la réunion comptabilisé (${mt.cout_usd})`);
  const pv = await one("select synthese, decisions, plan_action from ai_meeting_minutes");
  assert(pv.synthese.includes("promoteurs agréés"), "procès-verbal enregistré");
  eq(pv.decisions.length, 2, "décisions");
  eq(pv.plan_action.map((a: any) => !!a.task_id), [true, true, false], "plan d'action : 2 missions créées, 1 refusée (responsable inconnu)");
  eq(Number(await val("select count(*) from ai_meeting_participants where contribution is not null")), 3, "contributions des participants");
  eq(await val("select statut from ai_agent_tasks where id = $1", [t.task_id]), "a_faire", "DG relancé par la fin de la réunion");
  eq(Number(await val("select count(*) from ai_agents where activite = 'en_reunion'")), 0, "agents libérés");
  await ticks(2);   // reprise du DG + missions du plan
  assert(brief2.includes("Procès-verbal de la réunion"), "le PV est fourni au DG à la reprise");
  eq(await val("select statut from ai_agent_tasks where id = $1", [t.task_id]), "terminee", "mission du DG terminée");
  eq(Number(await val("select count(*) from ai_agent_tasks where reunion_id is not null and statut = 'terminee'")), 2, "actions du plan exécutées et tracées");
});
// ─── T7 · clé IA absente des secrets Edge ──────────────────────────
T("T7 · clé ANTHROPIC_API_KEY absente : pause générale, aucune faute imputée aux agents, reprise dès que la clé est posée", async () => {
  await freshDb(); await president();
  const t = await dgTask("Analyse les indicateurs");
  await sql("update ai_agent_tasks set statut = 'a_faire', executions = 0 where id = $1", [t.task_id]);   // la mission d'instruction naît « en cours » : on la rend réclamable par le planificateur
  Deno.env.delete("ANTHROPIC_API_KEY");
  try {
    const r = await tickCompany(); await r.work;
    eq(r.ignore, "Clé IA absente : pause", "le planificateur n'agit pas sans clé IA");
    eq(r.missions, 0, "aucune mission réclamée");
    const row = await one("select statut, executions from ai_agent_tasks where id = $1", [t.task_id]);
    eq([row.statut, row.executions], ["a_faire", 0], "mission intacte, essai non compté");
    eq(Number(await val("select count(*) from ai_incidents where type = 'cle_ia_absente' and gravite = 'critique'")), 1, "incident critique enregistré");
    for (let i = 0; i < 3; i++) await (await tickCompany()).work;
    eq(Number(await val("select count(*) from ai_incidents where type = 'cle_ia_absente'")), 1, "un seul incident, sans répétition");
    eq(Number(await val("select count(*) from ai_agents where etat = 'suspendu'")), 0, "aucun agent suspendu après plusieurs passages");
    // exécution directe (chat du président, rapports…) : reportée sans pénalité
    await sql("update ai_agent_tasks set statut = 'en_cours', executions = 1 where id = $1", [t.task_id]);
    eq(await runTask(t.task_id, { deadline: Date.now() + 60000 }), "reportee", "mission reportée");
    eq(await val("select executions from ai_agent_tasks where id = $1", [t.task_id]), 0, "essai rendu");
    eq(Number(await val("select incidents_consecutifs from ai_agents where niveau = 1")), 0, "l'agent n'est pas sanctionné");
  } finally { Deno.env.set("ANTHROPIC_API_KEY", "test"); }
  // clé posée : le planificateur reprend (la pause de 3 minutes liée à la panne simulée ci-dessus est levée)
  await sql("delete from ai_incidents where type = 'llm_indisponible'");
  script({ "SANIX AI GENERAL DIRECTOR": [() => done("Indicateurs analysés.", ["ok"])] });
  const r2 = await tickCompany(); await r2.work;
  eq(r2.missions, 1, "reprise dès que la clé est posée");
  eq(await val("select statut from ai_agent_tasks where id = $1", [t.task_id]), "terminee", "mission terminée");
});

// ─── T8 · secret du planificateur lu dans le Vault ─────────────────
T("T8 · secret du planificateur : lu dans le Vault (ai_cron_secret), repli sur le secret Edge, mémorisé 30 s", async () => {
  await freshDb(); resetCronSecretCache();
  eq(await cronSecret(), "secret", "sans fonction SQL (installation sans Vault) : repli sur le secret Edge");
  await sql("create schema if not exists vault");
  await sql("create table vault.decrypted_secrets(name text, decrypted_secret text)");
  await sql("insert into vault.decrypted_secrets values ('ai_cron_secret', 'valeur-du-vault')");
  await sql("create function public.ai_cron_secret() returns text language sql as $$ select decrypted_secret from vault.decrypted_secrets where name = 'ai_cron_secret' $$");
  eq(await cronSecret(), "secret", "valeur mémorisée 30 s : pas de nouvelle lecture");
  resetCronSecretCache();
  eq(await cronSecret(), "valeur-du-vault", "le Vault l'emporte sur le secret Edge");
  await sql("update vault.decrypted_secrets set decrypted_secret = 'nouvelle-valeur'");
  eq(await cronSecret(), "valeur-du-vault", "rotation : l'ancienne valeur reste en mémoire jusqu'à expiration");
  resetCronSecretCache();
  eq(await cronSecret(), "nouvelle-valeur", "rotation prise en compte après expiration");
  await sql("delete from vault.decrypted_secrets");
  resetCronSecretCache();
  eq(await cronSecret(), "secret", "secret absent du Vault : repli sur le secret Edge");
  Deno.env.delete("CRON_SECRET"); resetCronSecretCache();
  try {
    let msg = "";
    try { await cronSecret(); } catch (e) { msg = (e as Error).message; }
    assert(msg.includes("CRON_SECRET"), "ni Vault ni secret Edge : erreur explicite");
  } finally { Deno.env.set("CRON_SECRET", "secret"); resetCronSecretCache(); }
});

T("cleanup", async () => { await dropAll(); });
