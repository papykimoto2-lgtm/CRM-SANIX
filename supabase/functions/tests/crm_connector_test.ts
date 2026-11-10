// Connecteur CRM ↔ SANIX AI : preuves sur un vrai PostgreSQL (verrous, triggers, RLS, fonctions SQL), sans navigateur ni bureau 3D.
// Les neuf scénarios de la mission (C3 à C10) + droits (C1), import idempotent (C2), événements du CRM (C11), suppressions (C12), curseur (C13), interfaces (C14), isolation du moteur (C15).
import pg from "npm:pg@8.13.1";
import { assert, dropAll, eq, freshDb, mkAgent, president, PRESIDENT, rows, val } from "./testkit.ts";
import { sql } from "./fake_supabase.ts";

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const COMMERCIAL = "22222222-2222-2222-2222-222222222222", STRANGER = "33333333-3333-3333-3333-333333333333";
const DEV_A = "device-aaaa-0001", DEV_B = "device-bbbb-0002";

/** Exécute une requête avec l'identité d'un utilisateur (rôle « authenticated », jwt.sub) ou « anon » ; transaction dédiée, rollback sur erreur. */
async function as(uid: string | null, text: string, params: unknown[] = [], role = true): Promise<Record<string, any>[]> {
  const db = String(await val("select current_database()"));
  const c = new pg.Client({ host: "127.0.0.1", port: Number(Deno.env.get("TEST_PG_PORT") ?? 5499), user: "postgres", database: db });
  await c.connect();
  try {
    await c.query("begin");
    if (role) await c.query(uid ? "set local role authenticated" : "set local role anon");
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [uid ?? "", uid ? "authenticated" : "anon"]);
    const r = await c.query(text, params);
    await c.query("commit");
    return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { await c.end(); }
}
const rpc = async (uid: string | null, call: string, params: unknown[] = []) => (await as(uid, `select ${call} as v`, params))[0].v;
const fails = async (f: () => Promise<unknown>, part: string, msg: string) => {
  try { await f(); } catch (e) { if (!String((e as Error).message).toLowerCase().includes(part.toLowerCase())) throw new Error(`${msg} : erreur inattendue « ${(e as Error).message} »`); return; }
  throw new Error(`${msg} : une erreur était attendue`);
};

const op = (n: string, entity: string, rid: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ op_id: `op-${n}-${rid}`, entity, rid, data, ...extra });
const cl = (nom: string, phone: string, extra: Record<string, unknown> = {}) =>
  ({ nom, phone, email: "", secteur: "Immobilier", statut: "prospect", commercial: "Aïcha", valeur: 500000, adresse: "Abidjan, Cocody", notes: "Promoteur, souhaite un ERP", interactions: [], ...extra });
const push = async (device: string, ops: unknown[], uid: string = COMMERCIAL) => await rpc(uid, "crm_sync_push($1, $2::jsonb)", [device, JSON.stringify(ops)]);
const pull = async (since = 0, uid: string = COMMERCIAL) => await rpc(uid, "crm_sync_pull($1, 1000)", [since]);
const record = async (entity: string, rid: string) => (await sql("select * from crm_records where entity = $1 and rid = $2", [entity, rid])).rows[0];
const run = async () => (await sql("select crm_process_events(200) as v")).rows[0].v;
const ev = async (type: string) => (await sql("select * from crm_ai_events where type = $1 order by seq", [type])).rows;
const interactions = (r: any): any[] => r?.data?.interactions ?? [];

/** Monde de test : président (direction), commercial, étranger, agents de l'équipe commerciale. */
async function world() {
  await freshDb();
  await president();
  await sql("insert into auth.users(id) values ($1), ($2) on conflict do nothing", [COMMERCIAL, STRANGER]);
  await sql("insert into ai_operators(user_id, nom, role) values ($1, 'Aïcha Commercial', 'commercial')", [COMMERCIAL]);
  for (const [code, nom, dept] of [["ia_qualif_1", "IA Lead Qualifier", "commercial"], ["ia_rdv_1", "IA Appointment Manager", "commercial"], ["ia_nego_1", "IA Sales Negotiator", "commercial"],
    ["ia_mail_1", "IA Email Sales", "commercial"], ["ia_docs", "IA Gestionnaire de documents", "administratif"], ["ia_dir_admin", "IA Directeur Administratif", "administratif"],
    ["ia_success", "IA Customer Success", "relation_client"]]) await mkAgent(code, nom, 4, "sanix_ai_sales_director", [], dept);
}
/** Prospect saisi dans le CRM par un navigateur (événement émis), puis traité par le serveur. */
async function crmProspect(rid = "c_alpha1", nom = "Alpha Immobilier", phone = "07 01 02 03 04") {
  await push(DEV_A, [op("1", "clients", rid, cl(nom, phone))]);
  await run();
  return rid;
}
const prospectOf = async (rid: string) => (await sql("select * from ai_prospects where crm_rid = $1", [rid])).rows[0];

T("C1 · droits : anon refusé, étranger refusé, opérateur autorisé ; aucune écriture directe dans les tables", async () => {
  await world();
  await push(DEV_A, [op("1", "clients", "c_a", cl("Alpha", "0701020304"))]);
  await fails(() => as(null, "select crm_sync_pull(0, 10) as v"), "permission denied", "anon : pull");
  await fails(() => as(null, "select crm_sync_push('device-zzzz-0000', '[]'::jsonb) as v"), "permission denied", "anon : push");
  await fails(() => rpc(STRANGER, "crm_sync_pull(0, 10)"), "opérateurs", "authentifié non opérateur : pull");
  await fails(() => rpc(STRANGER, "crm_dashboard()"), "direction", "authentifié non opérateur : tableau de bord");
  await fails(() => rpc(COMMERCIAL, "crm_dashboard()"), "direction", "commercial : tableau de bord réservé à la direction");
  eq((await as(STRANGER, "select count(*)::int n from crm_records"))[0].n, 0, "RLS : l'étranger ne voit aucune ligne");
  eq((await as(COMMERCIAL, "select count(*)::int n from crm_records"))[0].n, 1, "RLS : l'opérateur voit les données");
  await fails(() => as(COMMERCIAL, "insert into crm_records(entity, rid, data) values ('clients', 'x1', '{}')"), "permission denied", "aucune écriture directe (insert)");
  await fails(() => as(COMMERCIAL, "update crm_records set data = '{}'"), "permission denied", "aucune écriture directe (update)");
  await fails(() => as(COMMERCIAL, "select crm_process_events(10)"), "permission denied", "le traitement des événements n'est pas appelable par un opérateur");
  await fails(() => as(COMMERCIAL, "select crm_put('clients','x','{}','crm','x') as v"), "permission denied", "crm_put interne");
});

T("C2 · import initial idempotent : pas d'événement, rejeu sans doublon, convergence multi-appareils, pas de fusion abusive", async () => {
  await world();
  const ops = [op("1", "clients", "c_a", cl("Alpha Immobilier", "07 01 02 03 04")), op("1", "clients", "c_b", cl("Beta Santé", "0505050505")),
    op("1", "commandes", "cmd_1731000000000", { ref: "CMD-2026-001", client: "Alpha Immobilier", date: "2026-11-01", logiciel: "ImmoSuite ERP", ttc: 1000000, acompte: 250000, solde: 750000, statut: "en_cours" }),
    op("1", "rdv", "r_1", { client: "Alpha Immobilier", type: "Démonstration", date: "2026-11-20", heure: "10:00", duree: 30, statut: "prevu" })].map((o) => ({ ...o, import: true }));
  const r1 = await push(DEV_A, ops);
  assert(r1.results.every((x: any) => x.ok && x.created), "import : tout est créé");
  eq(Number(await val("select count(*) from crm_ai_events")), 0, "import initial : aucun événement (pas de mission créée pour l'historique)");
  const r2 = await push(DEV_A, ops);                                               // réponse perdue, le navigateur rejoue
  assert(r2.results.every((x: any) => x.replayed), "rejeu : résultats mémorisés (replayed)");
  eq(Number(await val("select count(*) from crm_records")), 4, "rejeu : aucun doublon");
  const r3 = await push(DEV_A, ops.map((o) => ({ ...o, op_id: o.op_id + "-bis" })));   // nouvelle tentative avec d'autres identifiants d'opération
  assert(r3.results.every((x: any) => x.unchanged), "mêmes données : inchangé, aucune version gaspillée");
  eq(Number((await record("clients", "c_a")).version), 1, "version inchangée");
  // un second appareil a créé le même client sous un autre identifiant local : convergence vers un seul dossier
  const r4 = await push(DEV_B, [op("2", "clients", "c_zzz9", cl("ALPHA immobilier", "+225 0701020304"))]);
  eq(r4.results[0].rid, "c_a", "même téléphone + même nom (casse, accents, indicatif) : fusion sur le dossier existant");
  assert(r4.results[0].merged === true, "marqué fusionné");
  eq(Number(await val("select count(*) from crm_records where entity = 'clients'")), 2, "toujours deux clients");
  // deux entreprises distinctes derrière le même standard : jamais fusionnées
  const r5 = await push(DEV_B, [op("3", "clients", "c_gamma", cl("Gamma BTP", "0701020304"))]);
  eq(r5.results[0].rid, "c_gamma", "même téléphone, nom différent : dossier distinct");
  eq(Number(await val("select count(*) from crm_records where entity = 'clients'")), 3, "trois clients");
  // clé inconnue / opération invalide : refusées sans bloquer le lot
  const r6 = await push(DEV_B, [op("4", "inconnu", "x1", {}), op("5", "clients", "c_ok", cl("Delta", "0909090909"))]);
  assert(r6.results[0].ok === false && r6.results[1].ok === true, "une opération invalide n'empêche pas les autres");
});

T("C3 · scénario 1 : prospect créé dans le CRM → apparaît dans SANIX AI (prospect, agent responsable, mission)", async () => {
  await world();
  const rid = await crmProspect();
  const evs = await ev("crm.prospect.created");
  eq(evs.length, 1, "un événement durable");
  eq(evs[0].status, "done", "traité par le serveur (aucun navigateur)");
  assert(evs[0].processed_at && evs[0].idempotency_key === `clients:${rid}:created`, "horodaté, clé d'idempotence");
  const p = await prospectOf(rid);
  assert(p, "ai_prospects contient le prospect");
  eq([p.entreprise, p.source, p.stage, p.crm_rid], ["Alpha Immobilier", "crm", "enregistre", rid], "champs du prospect");
  const t = (await sql("select t.*, a.code from ai_agent_tasks t join ai_agents a on a.id = t.agent_id where t.prospect_id = $1", [p.id])).rows;
  eq(t.length, 1, "une mission");
  eq([t[0].code, t[0].type, t[0].statut, t[0].priorite], ["ia_qualif_1", "tache", "a_faire", 2], "confiée à l'agent de qualification");
  assert(t[0].titre.includes("Alpha Immobilier") && t[0].crm_event_id === evs[0].id, "titre explicite, traçable jusqu'à l'événement");
  eq(String(p.agent_id), String(await val("select id from ai_agents where code = 'ia_qualif_1'")), "agent responsable du prospect");
  const c = await record("clients", rid);
  eq([c.origin, c.data.ia.agent_code, c.data.ia.prospect_id], ["ia", "ia_qualif_1", p.id], "le dossier CRM porte l'agent responsable et le lien (écrit par le serveur)");
  assert(interactions(c).some((i) => i.type === "Pris en charge par l'IA" && i.source === "ia"), "historique du dossier : prise en charge");
  eq(Object.values(await run()).reduce((a: number, b) => a + Number(b), 0), 0, "second passage : rien à faire");
  eq(Number(await val("select count(*) from ai_prospects")), 1, "pas de doublon de prospect");
  eq(Number(await val("select count(*) from crm_ai_events")), 1, "aucun écho : l'écriture du serveur n'émet pas d'événement vers lui-même");
});

T("C4 · scénario 2 : qualification par un agent → le CRM reçoit le nouveau statut ; une copie locale périmée ne l'écrase pas", async () => {
  await world();
  const rid = await crmProspect();
  const p = await prospectOf(rid);
  const v0 = Number((await record("clients", rid)).version), cur0 = Number(await val("select max(seq) from crm_records"));
  await sql("update ai_prospects set crit_produit=22, crit_besoin=15, crit_finance=10, crit_decideur=12, crit_court_terme=10, crit_disponibilite=6, score_justification='Promoteur identifié sur son site, programme en cours de commercialisation', produits_recommandes='{immosuite}', resume_ia='Promoteur sérieux' where id = $1", [p.id]);
  await sql("update ai_prospects set stage = 'qualifie' where id = $1", [p.id]);                // l'agent qualifie
  const e = (await ev("ia.prospect.qualified"))[0];
  assert(e && e.direction === "ia_to_crm" && e.prospect_id === p.id, "événement IA → CRM créé par le travail de l'agent");
  await run();
  const c = await record("clients", rid);
  eq(c.data.ia.stage, "qualifie", "statut IA dans le dossier");
  eq([c.data.ia.score, c.data.ia.priorite], [75, "interessant"], "score et priorité");
  assert(interactions(c).some((i) => i.type === "Prospect qualifié par l'IA" && i.etape === 1 && i.note.includes("75/100")), "historique : qualification, étape 1 « Contact établi »");
  const pl = await pull(cur0);
  const got = pl.records.find((r: any) => r.rid === rid);
  assert(got && got.origin === "ia" && got.version > v0, "un navigateur reçoit la mise à jour au prochain pull");
  // navigateur resté hors ligne : copie périmée (version v0) qui tente d'écraser le statut IA, mais modifie aussi le téléphone
  const stale = await push(DEV_B, [op("9", "clients", rid, { statut: "prospect", ia: { stage: "enregistre" }, notes: "Rappeler lundi" }, { base_version: v0 })]);
  assert(stale.results[0].ok, "écriture acceptée");
  const c2 = await record("clients", rid);
  eq(c2.data.ia.stage, "qualifie", "champ serveur protégé : le statut IA n'est pas écrasé");
  eq(c2.data.notes, "Rappeler lundi", "les champs du CRM sont bien appliqués");
  assert(interactions(c2).some((i) => i.type === "Prospect qualifié par l'IA"), "l'historique IA est conservé (union des interactions)");
  // l'agent responsable suit l'entonnoir
  await sql("update ai_prospects set stage = 'rdv_confirme' where id = $1", [p.id]);
  eq(String((await prospectOf(rid)).agent_id), String(await val("select id from ai_agents where code = 'ia_rdv_1'")), "responsable = agent de l'étape (rendez-vous)");
});

T("C5 · scénario 3 : mission créée dans le bureau pour un dossier → visible dans le CRM ; mission terminée → historique", async () => {
  await world();
  const rid = await crmProspect();
  const p = await prospectOf(rid);
  const agent = String(await val("select id from ai_agents where code = 'ia_mail_1'"));
  await fails(() => rpc(COMMERCIAL, "crm_assign_mission($1, $2, 'Relancer', 'x', 2, 24)", [agent, p.id]), "direction", "réservé à la direction");
  const tid = await rpc(PRESIDENT, "crm_assign_mission($1, $2, 'Relancer le promoteur Alpha', 'Appeler et envoyer la brochure ImmoSuite', 2, 48)", [agent, p.id]);
  const t = await one_task(tid);
  eq([t.prospect_id, t.type, t.statut, t.priorite], [p.id, "mission", "a_faire", 2], "mission créée pour le dossier");
  assert(t.donneur_user_id === PRESIDENT, "donneur d'ordre : le président");
  await run();
  const c = await record("clients", rid);
  assert(interactions(c).some((i) => i.type === "Mission assignée à l'IA" && i.note.includes("Relancer le promoteur Alpha")), "la mission apparaît dans l'historique du dossier CRM");
  const ov = await rpc(COMMERCIAL, "crm_missions_overview(20)");
  assert(ov.some((m: any) => m.id === tid && m.crm_rid === rid && m.agent_code === "ia_mail_1"), "vue « Missions IA » du CRM");
  const panel = await rpc(COMMERCIAL, "crm_client_panel($1)", [rid]);
  assert(panel.missions.some((m: any) => m.id === tid) && panel.agent.code === "ia_qualif_1" && panel.linked, "fiche CRM : agent responsable et missions liées");
  await sql("update ai_agent_tasks set statut = 'terminee', rapport = 'Promoteur joint par téléphone, brochure envoyée et rendez-vous à fixer.', resultats = '[\"Brochure envoyée au promoteur\"]' where id = $1", [tid]);
  await run();
  assert(interactions(await record("clients", rid)).some((i) => i.type === "Mission terminée par l'IA" && i.note.includes("brochure envoyée")), "mission terminée : compte rendu dans le dossier");
  const board = await rpc(PRESIDENT, "crm_agent_portfolio($1)", [agent]);
  assert(board.missions.some((m: any) => m.id === tid && m.crm_rid === rid), "fiche agent (bureau 3D) : dossier CRM à ouvrir");
});
async function one_task(id: string) { return (await sql("select * from ai_agent_tasks where id = $1", [id])).rows[0]; }

T("C6 · scénario 4 : rendez-vous organisé par l'IA → calendrier du CRM ; compte rendu consultable", async () => {
  await world();
  const rid = await crmProspect();
  const p = await prospectOf(rid);
  const ap = String(await val("insert into ai_appointments(prospect_id, debut, fin, mode, lien_visio, statut, fiche_prep) values ($1, '2026-11-20 09:00+00', '2026-11-20 09:45+00', 'visio', 'https://meet.example/abc', 'confirme', 'Présenter ImmoSuite ERP') returning id", [p.id]));
  await run();
  const rdv = await record("rdv", `ia_${ap.replace(/-/g, "")}`);
  assert(rdv, "un rendez-vous apparaît dans les données CRM");
  eq([rdv.data.date, rdv.data.heure, rdv.data.duree, rdv.data.statut, rdv.data.visio], ["2026-11-20", "09:00", 45, "prevu", "autre"], "date, heure, durée, statut CRM");
  eq([rdv.data._client_rid, rdv.data.client, rdv.data.source, rdv.origin], [rid, "Alpha Immobilier", "IA", "ia"], "rattaché au dossier, source IA");
  assert(interactions(await record("clients", rid)).some((i) => i.type === "RDV fixé par l'IA" && i.etape === 1), "historique du dossier : RDV fixé");
  const pl = await pull(0);
  assert(pl.records.some((r: any) => r.entity === "rdv" && r.rid === rdv.rid), "le navigateur reçoit le rendez-vous (calendrier)");
  await sql("update ai_appointments set statut = 'realise', compte_rendu = 'Client intéressé, demande une offre pour 3 postes.' where id = $1", [ap]);
  await run();
  const rdv2 = await record("rdv", rdv.rid);
  eq([rdv2.data.statut, rdv2.data.compte_rendu], ["fait", "Client intéressé, demande une offre pour 3 postes."], "compte rendu enregistré, rendez-vous réalisé");
  assert(interactions(await record("clients", rid)).some((i) => i.type === "Compte rendu de rendez-vous"), "compte rendu dans l'historique");
  const panel = await rpc(COMMERCIAL, "crm_client_panel($1)", [rid]);
  assert(panel.rdv[0].compte_rendu.includes("3 postes"), "fiche CRM : compte rendu consultable");
});

T("C7 · scénario 5 : offre générée par l'IA → offres du CRM (proforma échappée) ; offre acceptée → commande + affaire", async () => {
  await world();
  const rid = await crmProspect("c_alpha1", "Alpha <script>x</script> & Fils");
  const p = await prospectOf(rid);
  await sql("insert into ai_products(id, nom, marche_cible) values ('immosuite', 'ImmoSuite ERP', 'Promoteurs') on conflict do nothing");
  const o = (await sql("insert into ai_offers(prospect_id, product_id, lignes, total_brut_ht, remise_pct, total_ht, tva_pct, total_ttc, statut) values ($1, 'immosuite', $2::jsonb, 1000000, 10, 900000, 18, 1062000, 'envoyee') returning id, reference",
    [p.id, JSON.stringify([{ poste: "licence", libelle: "Licence ImmoSuite <3 postes>", qte: 3, pu_ht: 300000, montant_ht: 900000 }, { poste: "form", libelle: "Formation", qte: 1, pu_ht: 100000, montant_ht: 100000 }])])).rows[0];
  await run();
  const doc = await record("documents", `ia_${o.id.replace(/-/g, "")}`);
  assert(doc, "l'offre apparaît dans les documents du CRM");
  eq([doc.data.type, doc.data.ref, doc.data.statut, doc.data.source, doc.data._client_rid], ["proforma", o.reference, "envoyee", "IA", rid], "proforma rattachée au client");
  assert(doc.data.html.includes("&lt;3 postes&gt;") && !doc.data.html.includes("<script>") && /1[ ,.]?062[ ,.]?000/.test(doc.data.html), "HTML : contenu échappé, total TTC présent");
  const deal = await record("deals", `ia_${p.id.replace(/-/g, "")}`);
  eq([deal.data.stage, deal.data.valeur, deal.data.commercial], ["proposition", 900000, "IA"], "affaire créée à l'étape « Proposition »");
  assert(interactions(await record("clients", rid)).some((i) => i.type === "Offre générée par l'IA" && i.etape === 3), "historique : offre générée");
  await sql("update ai_offers set statut = 'acceptee' where id = $1", [o.id]);
  await run();
  const cmd = await record("commandes", `ia_${o.id.replace(/-/g, "")}`);
  assert(cmd, "offre acceptée : commande créée");
  eq([cmd.data.statut, cmd.data.ttc, cmd.data.solde, cmd.data.acompte, cmd.data.commercial], ["confirmee", 1062000, 1062000, 0, "IA"], "commande confirmée");
  eq((await record("deals", deal.rid)).data.stage, "negociation", "affaire en négociation (la conversion reste humaine)");
  assert(interactions(await record("clients", rid)).some((i) => i.type === "Offre acceptée" && i.etape === 4), "historique : offre acceptée");
  eq((await record("documents", doc.rid)).data.statut, "acceptee", "statut de l'offre mis à jour");
  const panel = await rpc(COMMERCIAL, "crm_client_panel($1)", [rid]);
  eq(panel.offres[0].reference, o.reference, "fiche CRM : offre listée");
});

T("C8 · scénario 6 : conversion prospect → client : une seule fiche client, jamais de doublon", async () => {
  await world();
  const rid = await crmProspect();
  const p = await prospectOf(rid);
  // un prospect trouvé par la prospection IA, déjà connu du CRM (même téléphone) mais pas encore rattaché
  await push(DEV_A, [op("2", "clients", "c_beta", cl("Beta Santé", "05 05 05 05 05"), { import: true })]);
  const hunt = String(await val("insert into ai_prospects(entreprise, telephone, source, stage) values ('Beta Santé SARL', '0505050505', 'recherche_web', 'identifie') returning id"));
  await sql("update ai_prospects set stage = 'qualifie' where id = $1", [hunt]);
  await run();
  eq(String(await val("select crm_rid from ai_prospects where id = $1", [hunt])), "c_beta", "rattaché au dossier CRM existant (même téléphone)");
  eq(Number(await val("select count(*) from crm_records where entity = 'clients' and deleted_at is null and data->>'nom' like 'Beta%'")), 1, "un seul dossier Beta");
  // prospect brut de la prospection : pas de dossier CRM tant qu'il n'est pas qualifié
  const raw = String(await val("insert into ai_prospects(entreprise, telephone, source, stage) values ('Brut SA', '0102030405', 'recherche_web', 'identifie') returning id"));
  await sql("update ai_prospects set stage = 'enregistre' where id = $1", [raw]);
  eq(Number((await sql("select count(*) n from crm_ai_events where prospect_id = $1", [raw])).rows[0].n), 0, "prospect brut : aucun événement, pas de dossier CRM");
  // conversion : étape engageante réservée à la direction (garde-fou existant)
  await fails(() => sql("update ai_prospects set stage = 'marche_gagne' where id = $1", [p.id]), "réservée à la direction", "le serveur ne peut pas conclure seul");
  const db = String(await val("select current_database()")); const c = new pg.Client({ host: "127.0.0.1", port: Number(Deno.env.get("TEST_PG_PORT") ?? 5499), user: "postgres", database: db });
  await c.connect();
  try { await c.query("begin"); await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [PRESIDENT]); await c.query("update ai_prospects set stage = 'marche_gagne' where id = $1", [p.id]); await c.query("commit"); } finally { await c.end(); }
  await run();
  const client = await record("clients", rid);
  eq(client.data.statut, "client", "le dossier CRM passe à « Client actif »");
  assert(client.data.converted_at && interactions(client).some((i) => i.etape === 5 && i.type === "Marché gagné"), "date de conversion et historique « Converti »");
  eq((await record("deals", `ia_${p.id.replace(/-/g, "")}`)).data.stage, "gagne", "affaire gagnée");
  eq(Number(await val("select count(*) from crm_records where entity = 'clients' and deleted_at is null and data->>'nom' = 'Alpha Immobilier'")), 1, "une seule fiche client Alpha");
  eq(String((await prospectOf(rid)).agent_id), String(await val("select id from ai_agents where code = 'ia_success'")), "le suivi passe à l'agent de relation client");
  // conversion faite à la main dans le CRM : même dossier, l'IA est informée
  await push(DEV_A, [op("3", "clients", "c_beta", { statut: "client" }, { base_version: Number((await record("clients", "c_beta")).version) })]);
  assert((await ev("crm.client.converted")).length === 1, "conversion dans le CRM : événement vers l'IA");
  await run();
  eq(Number(await val("select count(*) from crm_records where entity = 'clients' and deleted_at is null")), 2, "au total deux dossiers (Alpha, Beta) : aucun doublon, aucun dossier pour le prospect brut");
});

T("C8b · sécurité : un nom trouvé sur le web ne peut pas injecter de HTML ni de JavaScript dans le CRM", async () => {
  await world();
  const evil = `Évil <img src=x onerror=alert(1)> "SA" L'Oréal`;
  const hunt = String(await val("insert into ai_prospects(entreprise, telephone, source, stage, resume_ia) values ($1, '0999999999', 'recherche_web', 'identifie', 'Voir <script>alert(1)</script>') returning id", [evil]));
  await sql("update ai_prospects set stage = 'qualifie' where id = $1", [hunt]);
  await run();
  const c = (await sql("select * from crm_records where entity = 'clients' and rid = $1", [`ia_${hunt.replace(/-/g, "")}`])).rows[0];
  assert(c, "dossier créé par l'IA");
  assert(!/[<>"`]/.test(c.data.nom) && !/[<>]/.test(c.data.notes), "nom et notes : aucun caractère d'injection");
  assert(c.data.nom.includes("L'Oréal") && c.data.nom.startsWith("Évil"), "le nom reste lisible");
  assert(!JSON.stringify(c.data.interactions).includes("<"), "historique : rien à échapper");
  await sql("insert into ai_products(id, nom, marche_cible) values ('immosuite', 'ImmoSuite ERP', 'x') on conflict do nothing");
  const o = (await sql("insert into ai_offers(prospect_id, product_id, lignes, total_brut_ht, total_ht, total_ttc, statut) values ($1, 'immosuite', $2::jsonb, 100, 100, 118, 'envoyee') returning id", [hunt, JSON.stringify([{ libelle: "<b onmouseover=alert(1)>x</b>", qte: 1, pu_ht: 100, montant_ht: 100 }])])).rows[0];
  await run();
  const doc = (await sql("select data from crm_records where entity = 'documents' and rid = $1", [`ia_${o.id.replace(/-/g, "")}`])).rows[0].data;
  assert(!doc.html.includes("<b onmouseover") && doc.html.includes("&lt;b onmouseover"), "proforma : balises du web échappées");
});

T("C9 · scénario 7 : tout le flux s'exécute sans navigateur ni bureau 3D (traitement par lots, verrouillage, parallélisme)", async () => {
  await world();
  await sql("update ai_governance set max_taches_agent = 50, max_missions_actives = 200");
  const ids = Array.from({ length: 12 }, (_, i) => `c_p${i}`);
  await push(DEV_A, ids.map((rid, i) => op("b", "clients", rid, cl(`Prospect ${i}`, `07 00 00 00 ${String(i).padStart(2, "0")}`))));
  eq(Number(await val("select count(*) from crm_ai_events where status = 'pending'")), 12, "12 événements en attente, rien n'a été traité par un navigateur");
  // deux traitements simultanés (deux exécutions pg_cron qui se chevauchent) : « skip locked », chaque événement est traité une seule fois
  const [a, b] = await Promise.all([sql("select crm_process_events(6) as v"), sql("select crm_process_events(6) as v")]);
  const n = (a.rows[0].v.done as number) + (b.rows[0].v.done as number);
  eq(n, 12, "chaque événement traité exactement une fois");
  eq(Number(await val("select count(*) from ai_prospects")), 12, "12 prospects, aucun doublon");
  eq(Number(await val("select count(*) from ai_agent_tasks where prospect_id is not null")), 12, "12 missions");
  eq(Number(await val("select count(*) from crm_ai_events where status = 'done'")), 12, "tous terminés");
});

T("C9b · contre-pression : la gouvernance (missions ouvertes par agent) retarde les événements sans les perdre ni les compter en échec", async () => {
  await world();
  await sql("update ai_governance set max_taches_agent = 2");
  await push(DEV_A, Array.from({ length: 5 }, (_, i) => op("w", "clients", `c_w${i}`, cl(`Prospect W${i}`, `07 11 11 11 ${String(i).padStart(2, "0")}`))));
  const r = await run();
  eq([r.done, r.waiting, r.failed, r.dead], [2, 3, 0, 0], "2 missions créées (limite de l'agent), 3 événements en attente de capacité, aucun échec");
  const w = (await sql("select * from crm_ai_events where status = 'pending'")).rows;
  assert(w.length === 3 && w.every((e: any) => e.attempts === 0 && e.last_error.startsWith("En attente de capacité")), "tentatives non consommées, motif explicite");
  await sql("update ai_governance set max_taches_agent = 10");
  await sql("update crm_ai_events set next_attempt_at = now()");
  eq((await run()).done, 3, "capacité rétablie : les trois sont traités");
  eq(Number(await val("select count(*) from ai_agent_tasks where prospect_id is not null")), 5, "cinq missions, une par prospect");
});

T("C10 · scénarios 8 et 9 : panne côté agent → reprises avec délai croissant, sans doublon, puis « mort » rejouable ; panne réseau → rejeu idempotent", async () => {
  await world();
  await sql("update ai_agents set etat = 'suspendu' where code = 'ia_qualif_1'");                    // agent indisponible : la création de mission échoue
  await push(DEV_A, [op("1", "clients", "c_alpha1", cl("Alpha Immobilier", "0701020304"))]);
  let r = await run();
  eq(r.failed, 1, "échec enregistré, pas de perte");
  let e = (await ev("crm.prospect.created"))[0];
  eq([e.status, e.attempts], ["failed", 1], "état failed, 1 tentative");
  assert(e.last_error.includes("indisponible") && new Date(e.next_attempt_at) > new Date(), "erreur lisible, prochaine tentative différée");
  eq(Object.values(await run()).reduce((a: number, b) => a + Number(b), 0), 0, "pas de nouvelle tentative avant l'échéance");
  await sql("update ai_agents set etat = 'actif' where code = 'ia_qualif_1'");
  await sql("update crm_ai_events set next_attempt_at = now()");
  r = await run();
  eq(r.done, 1, "reprise automatique réussie");
  eq(Number(await val("select count(*) from ai_agent_tasks where prospect_id is not null")), 1, "une seule mission après reprise");
  eq(Number(await val("select count(*) from ai_prospects")), 1, "un seul prospect après reprise");
  // échec persistant → état « dead » après 8 tentatives, visible et rejouable par un opérateur
  await sql("update ai_agents set etat = 'suspendu' where code = 'ia_qualif_1'");
  await push(DEV_A, [op("2", "clients", "c_beta", cl("Beta Santé", "0505050505"))]);
  for (let i = 0; i < 8; i++) { await sql("update crm_ai_events set next_attempt_at = now() where status in ('pending','failed')"); await run(); }
  e = (await sql("select * from crm_ai_events where rid = 'c_beta' and type = 'crm.prospect.created'")).rows[0];
  eq([e.status, e.attempts], ["dead", 8], "mort après 8 tentatives");
  const st = await rpc(COMMERCIAL, "crm_sync_status()");
  assert(st.events.dead === 1 && st.failing.some((f: any) => f.id === e.id), "l'état de synchronisation du CRM signale l'événement bloqué");
  await sql("update ai_agents set etat = 'actif' where code = 'ia_qualif_1'");
  await rpc(COMMERCIAL, "crm_event_retry($1)", [e.id]);
  eq((await run()).done, 1, "rejeu par un opérateur : traité");
  eq(Number(await val("select count(*) from ai_agent_tasks where prospect_id is not null")), 2, "deux missions au total, aucun doublon");
  // panne réseau côté navigateur : la réponse du push est perdue, la file est rejouée avec les mêmes identifiants
  const o = [op("3", "clients", "c_gamma", cl("Gamma BTP", "0808080808"))];
  await push(DEV_B, o); await push(DEV_B, o); await push(DEV_B, o);
  eq(Number(await val("select count(*) from crm_records where rid = 'c_gamma'")), 1, "trois envois identiques : une ligne");
  eq(Number(await val("select count(*) from crm_ai_events where rid = 'c_gamma'")), 1, "trois envois identiques : un événement");
});

T("C11 · événements du CRM : commande, paiement, facture, rendez-vous, réclamation, client créé ; aucun écho, aucun faux positif", async () => {
  await world();
  const rid = await crmProspect("c_alpha1", "Alpha Immobilier");
  const cmd = { ref: "CMD-2026-007", client: "Alpha Immobilier", date: "2026-11-05", logiciel: "ImmoSuite ERP", ttc: 1180000, acompte: 0, solde: 1180000, statut: "confirmee", _client_rid: rid };
  await push(DEV_A, [op("1", "commandes", "cmd_1731100000000", cmd)]);
  eq((await ev("crm.commande.created")).length, 1, "commande créée : événement");
  eq((await ev("crm.paiement.enregistre")).length, 0, "pas de paiement à la création (acompte 0)");
  const v = Number((await record("commandes", "cmd_1731100000000")).version);
  await push(DEV_A, [op("2", "commandes", "cmd_1731100000000", { acompte: 300000, solde: 880000 }, { base_version: v })]);
  const pay = (await ev("crm.paiement.enregistre"))[0];
  eq([pay.payload.montant, pay.payload.cumul, pay.payload.solde], [300000, 300000, 880000], "paiement enregistré : montant du versement, cumul, solde");
  await push(DEV_A, [op("3", "commandes", "cmd_1731100000000", { notes: "livraison lundi" }, { base_version: v + 1 })]);
  eq((await ev("crm.paiement.enregistre")).length, 1, "modification sans paiement : aucun événement");
  await push(DEV_A, [op("4", "documents", "doc_1731200000000", { ref: "F-2026-014", type: "facture", client: "Alpha Immobilier", date: "2026-11-08", html: "<p>Facture</p>" }),
    op("5", "documents", "doc_1731200000001", { ref: "P-2026-003", type: "proforma", client: "Alpha Immobilier", date: "2026-11-08", html: "<p>Pro forma</p>" })]);
  eq((await ev("crm.facture.emise")).length, 1, "facture émise : événement ; une proforma n'en déclenche pas");
  assert((await ev("crm.facture.emise"))[0].payload._client_rid === rid, "client retrouvé par son nom (rattachement non ambigu)");
  await push(DEV_A, [op("6", "rdv", "r_9", { clientId: 7, client: "Alpha Immobilier", type: "Démonstration", date: "2026-11-25", heure: "15:00", duree: 30, statut: "prevu" })]);
  eq((await ev("crm.rdv.created")).length, 1, "rendez-vous créé : événement");
  const cv = Number((await record("clients", rid)).version);
  await push(DEV_A, [op("7", "clients", rid, { interactions: [{ date: "2026-11-09T09:00:00.000Z", type: "Réclamation", note: "Livraison de la licence en retard", ico: "⚠️" }] }, { base_version: cv })]);
  const rec = (await ev("crm.reclamation.recue"))[0];
  assert(rec && rec.payload.contexte.includes("en retard"), "réclamation reçue : événement avec le contexte");
  await push(DEV_A, [op("8", "clients", "c_nouveau", cl("Nouveau Client SA", "0707070707", { statut: "client" }))]);
  eq((await ev("crm.client.created")).length, 1, "client créé (statut client) : événement distinct d'un prospect");
  const r = await run();
  eq(r.failed + r.dead, 0, "tous traités sans erreur");
  const tasks = (await sql("select a.code, t.titre, t.description, t.priorite from ai_agent_tasks t join ai_agents a on a.id = t.agent_id where t.crm_event_id is not null order by t.created_at")).rows;
  const by = (code: string) => tasks.filter((t: any) => t.code === code);
  assert(by("ia_docs").some((t: any) => t.titre.includes("CMD-2026-007")), "commande → agent documents");
  assert(by("ia_dir_admin").some((t: any) => t.titre.includes("paiement") && t.description.includes("300")) && by("ia_dir_admin").some((t: any) => t.titre.includes("F-2026-014")), "paiement (montant du versement) et facture → direction administrative");
  assert(by("ia_rdv_1").length === 1, "rendez-vous → agent de rendez-vous");
  eq(by("ia_success").find((t: any) => t.titre.includes("réclamation"))?.priorite, 1, "réclamation → relation client, priorité 1");
  assert(by("ia_success").some((t: any) => t.titre.includes("Accueillir")), "client créé → accueil client");
  await sql("update crm_ai_events set status = 'pending'");                                         // rejeu complet du journal : tout est idempotent
  const n0 = Number(await val("select count(*) from ai_agent_tasks"));
  await run();
  eq(Number(await val("select count(*) from ai_agent_tasks")), n0, "rejeu du journal : aucune mission en double");
});

T("C12 · suppression par tombstone, modification concurrente et résurrection", async () => {
  await world();
  const rid = "c_del";
  await push(DEV_A, [op("1", "clients", rid, cl("Supprimé SA", "0606060606"), { import: true })]);
  const v = Number((await record("clients", rid)).version);
  const d = await push(DEV_A, [{ op_id: "op-del-1xxx", entity: "clients", rid, action: "delete", base_version: v }]);
  assert(d.results[0].ok && d.results[0].deleted, "suppression enregistrée");
  const pl = await pull(0);
  assert(pl.records.find((r: any) => r.rid === rid)?.deleted === true, "le tombstone est transmis aux autres appareils");
  // un autre appareil, resté hors ligne, avait modifié le dossier AVANT la suppression : sa modification est ignorée
  const s = await push(DEV_B, [op("2", "clients", rid, { notes: "ancienne" }, { client_ts: new Date(Date.now() - 3600e3).toISOString() })]);
  assert(s.results[0].skipped && s.results[0].deleted, "modification antérieure à la suppression : ignorée");
  // modification postérieure : le dossier ressuscite (la suppression n'a pas vu cette activité)
  const u = await push(DEV_B, [op("3", "clients", rid, { notes: "rappel du client" }, { client_ts: new Date(Date.now() + 5000).toISOString() })]);
  assert(u.results[0].ok && !u.results[0].skipped, "modification postérieure acceptée");
  eq(await val("select deleted_at is null from crm_records where entity = 'clients' and rid = $1", [rid]), true, "dossier ressuscité");
  // suppression d'un dossier modifié par l'IA depuis la dernière synchro : conflit signalé, rien n'est perdu
  await sql("update crm_records set data = data || '{\"ia\":{\"stage\":\"qualifie\"}}'::jsonb, origin = 'ia' where entity = 'clients' and rid = $1", [rid]);
  const cf = await push(DEV_B, [{ op_id: "op-del-2xxx", entity: "clients", rid, action: "delete", base_version: v }]);
  assert(cf.results[0].ok === false && cf.results[0].conflict, "suppression refusée : l'IA a modifié le dossier depuis");
  eq(await val("select deleted_at is null from crm_records where entity = 'clients' and rid = $1", [rid]), true, "le dossier est conservé");
});

T("C13 · curseur de synchronisation : pagination ordonnée, reprise après coupure sans perte", async () => {
  await world();
  await push(DEV_A, Array.from({ length: 7 }, (_, i) => op("p", "commandes", `cmd_${1731300000000 + i}`, { ref: `C-${i}`, client: "X", ttc: 1000 + i, statut: "en_cours" }, { import: true })));
  const p1 = await rpc(COMMERCIAL, "crm_sync_pull(0, 3)");
  eq([p1.records.length, p1.more], [3, true], "première page : 3, la suite existe");
  const p2 = await rpc(COMMERCIAL, "crm_sync_pull($1, 3)", [p1.cursor]);
  const p3 = await rpc(COMMERCIAL, "crm_sync_pull($1, 3)", [p2.cursor]);
  eq([p2.records.length, p3.records.length, p3.more], [3, 1, false], "pages suivantes");
  const seen = [...p1.records, ...p2.records, ...p3.records].map((r: any) => r.rid);
  eq(new Set(seen).size, 7, "7 enregistrements, sans doublon ni trou");
  assert(seen.every((r, i) => i === 0 || r > seen[i - 1]), "ordre croissant de seq");
  await push(DEV_B, [op("q", "commandes", "cmd_1731300000003", { ttc: 9999 })]);
  const p4 = await rpc(COMMERCIAL, "crm_sync_pull($1, 50)", [p3.cursor]);
  eq(p4.records.map((r: any) => r.rid), ["cmd_1731300000003"], "seules les modifications depuis le curseur sont renvoyées");
  eq(p4.records[0].data.ttc, 9999, "avec la nouvelle valeur");
});

T("C14 · interfaces : tableau de bord du Président, arbitrage des missions, fiche agent, délégation d'un dossier", async () => {
  await world();
  const rid = await crmProspect();
  const p = await prospectOf(rid);
  const tid = String(await val("select id from ai_agent_tasks where prospect_id = $1", [p.id]));
  await sql("update ai_agent_tasks set echeance = now() - interval '2 hours' where id = $1", [tid]);
  await push(DEV_A, [op("1", "commandes", "cmd_1731400000000", { ref: "C-1", client: "Alpha Immobilier", ttc: 2000000, acompte: 500000, statut: "en_cours", source: "IA" }),
    op("2", "rdv", "r_a", { client: "Alpha Immobilier", date: "2999-01-01", heure: "10:00", statut: "prevu" })]);
  await sql("insert into ai_incidents(gravite, type, message, task_id) values ('critique', 'test', 'Anomalie de test sur le prospect', $1)", [tid]);
  await run();
  const d = await rpc(PRESIDENT, "crm_dashboard()");
  eq([d.prospects, d.clients, d.rdv_a_venir, d.objectif_mensuel_fcfa], [1, 0, 1, 1500000], "indicateurs CRM (prospects, clients, rendez-vous, objectif par défaut)");
  assert(d.ca_commandes_mois >= 2000000 && d.encaisse_mois >= 500000 && d.ca_ia_total === 2000000, "ventes : CA du mois, encaissé, part IA");
  assert(d.missions_en_retard.some((m: any) => m.id === tid), "missions en retard listées");
  assert(d.anomalies.some((a: any) => a.message && a.message.includes("Anomalie de test")), "anomalie remontée jusqu'au bureau du Président");
  eq(d.sync.morts, 0, "synchronisation saine");
  assert(interactions(await record("clients", rid)).some((i) => i.type.startsWith("Alerte IA") && i.note.includes("Anomalie de test")), "l'alerte est aussi dans le dossier CRM concerné");
  await fails(() => rpc(COMMERCIAL, "crm_arbitrate_task($1, 'cancel')", [tid]), "direction", "arbitrage réservé à la direction");
  await rpc(PRESIDENT, "crm_arbitrate_task($1, 'prioritize', 1)", [tid]);
  eq(Number(await val("select priorite from ai_agent_tasks where id = $1", [tid])), 1, "mission repriorisée par le Président");
  await rpc(PRESIDENT, "crm_arbitrate_task($1, 'cancel')", [tid]);
  eq(await val("select statut from ai_agent_tasks where id = $1", [tid]), "annulee", "mission annulée par le Président");
  // délégation explicite d'un dossier existant (bouton « Confier à l'IA »)
  await push(DEV_A, [op("3", "clients", "c_old", cl("Ancien Prospect", "0101010101"), { import: true })]);
  const a1 = await rpc(COMMERCIAL, "crm_delegate('c_old')"), a2 = await rpc(COMMERCIAL, "crm_delegate('c_old')");
  assert(a1.event_id && a2.already === true, "délégation : un seul événement par jour et par dossier");
  await run();
  assert(await prospectOf("c_old"), "le dossier délégué est devenu un prospect IA");
});

T("C15 · isolation : une panne du connecteur ne casse jamais le travail des agents ni la saisie du CRM", async () => {
  await world();
  const rid = await crmProspect();
  const p = await prospectOf(rid);
  await sql("alter table crm_ai_events rename to crm_ai_events_off");                                  // le journal devient indisponible
  await sql("update ai_prospects set stage = 'qualifie' where id = $1", [p.id]);                        // l'agent continue de travailler
  eq(await val("select stage from ai_prospects where id = $1", [p.id]), "qualifie", "le travail de l'agent n'échoue pas");
  const r = await push(DEV_A, [op("1", "clients", "c_new", cl("Nouveau", "0909090909"))]);
  assert(r.results[0].ok, "la saisie du CRM n'échoue pas non plus");
  await sql("alter table crm_ai_events_off rename to crm_ai_events");
  // rattrapage : l'opérateur (ou le service) réémet les événements IA → CRM manquants
  const bf = await sql("select crm_backfill_ia() as v");
  assert(bf.rows[0].v.prospects >= 1, "rattrapage : les prospects avancés sont réémis");
  await run();
  eq((await record("clients", rid)).data.ia.stage, "qualifie", "après rattrapage, le CRM est à jour");
});

Deno.test({ name: "nettoyage", fn: async () => { await dropAll(); }, sanitizeOps: false, sanitizeResources: false });
