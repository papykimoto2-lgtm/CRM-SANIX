// Boucle complète CRM → agents → CRM avec le VRAI moteur et les VRAIS outils (seul le modèle de langage est scripté) :
// un prospect saisi dans le CRM arrive chez l'agent de qualification ; la direction confie un rendez-vous puis son compte rendu, puis une offre ;
// chaque outil écrit dans les tables SANIX AI, les déclencheurs émettent les événements, le serveur les traite, le CRM reçoit le résultat.
import pg from "npm:pg@8.13.1";
import { assert, dropAll, eq, freshDb, mkAgent, president, PRESIDENT, rows, val } from "./testkit.ts";
import { sql } from "./fake_supabase.ts";
import { done, reply, results, script, use } from "./fake_anthropic.ts";
import { tickCompany } from "../_shared/company/tick.ts";
import { runCrmTool, type CrmCtx } from "../_shared/crm_tools.ts";

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const COMMERCIAL = "22222222-2222-2222-2222-222222222222";

async function as(uid: string, text: string, params: unknown[] = []): Promise<Record<string, any>[]> {
  const db = String(await val("select current_database()"));
  const c = new pg.Client({ host: "127.0.0.1", port: Number(Deno.env.get("TEST_PG_PORT") ?? 5499), user: "postgres", database: db });
  await c.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [uid]);
    const r = await c.query(text, params); await c.query("commit"); return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { await c.end(); }
}
const rpc = async (uid: string, call: string, params: unknown[] = []) => (await as(uid, `select ${call} as v`, params))[0].v;
const ticks = async (n: number) => { for (let i = 0; i < n; i++) { const r = await tickCompany(); await r.work; } };
const run = async () => (await sql("select crm_process_events(200) as v")).rows[0].v;
const uid = (p: { messages: unknown }) => /prospect_id = ([0-9a-f-]{36})/.exec(JSON.stringify(p.messages))?.[1] ?? "";
const client = async () => (await sql("select * from crm_records where entity = 'clients' and deleted_at is null")).rows;

async function world() {
  await freshDb();
  await president();
  await sql("insert into auth.users(id) values ($1) on conflict do nothing", [COMMERCIAL]);
  await sql("insert into ai_operators(user_id, nom, role) values ($1, 'Aïcha Commercial', 'commercial')", [COMMERCIAL]);
  await sql("insert into ai_availability(operator_id, jour, debut, fin) select $1, d, '08:00', '18:00' from generate_series(1, 7) d", [COMMERCIAL]);
  // produit et grille officielle : ceux des migrations (ImmoSuite ERP : licence annuelle 750 000 FCFA HT, abonnement SaaS 75 000)
  await mkAgent("ia_qualif_1", "IA Lead Qualifier", 4, "sanix_ai_sales_director", ["get_prospect", "update_prospect", "set_stage", "recommend_products", "get_product", "transmettre"]);
  await mkAgent("ia_rdv_1", "IA Appointment Manager", 4, "sanix_ai_sales_director", ["get_prospect", "list_free_slots", "book_appointment", "record_appointment_report", "transmettre"]);
  await mkAgent("ia_nego_1", "IA Sales Negotiator", 4, "sanix_ai_sales_director", ["get_prospect", "get_product", "create_offer", "transmettre"]);
}

T("L1 · boucle réelle : prospect du CRM → qualification → rendez-vous → compte rendu → offre, avec les vrais outils des agents", async () => {
  await world();
  script({
    "IA Lead Qualifier": [
      (p) => reply([
        use("update_prospect", { prospect_id: uid(p), criteres: { produit: 22, besoin: 15, finance: 10, decideur: 12, court_terme: 10, disponibilite: 6 }, produits_recommandes: ["immosuite"], resume: "Promoteur actif, besoin de suivi des ventes" }),
        use("set_stage", { prospect_id: uid(p), stage: "qualifie", motif: "Score 75/100" })]),
      () => done("Prospect qualifié : 75/100, ImmoSuite ERP recommandé.", ["75/100"]),
    ],
    "IA Appointment Manager": [
      (p) => reply([use("list_free_slots", { prospect_id: uid(p) })]),
      (p) => reply([use("book_appointment", { prospect_id: uid(p), debut: results(p)[0].data.creneaux[0], mode: "visio", lieu: null, product_id: "immosuite" })]),
      () => done("Rendez-vous de démonstration confirmé.", ["RDV confirmé"]),
      (p) => reply([use("get_prospect", { prospect_id: uid(p) })]),
      (p) => reply([use("record_appointment_report", { prospect_id: uid(p), appointment_id: results(p)[0].data.rdv[0].id, statut: "realise",
        compte_rendu: "Démonstration faite au directeur et à son comptable : très intéressés par le suivi des ventes et des encaissements ; budget validé en interne.", prochaine_etape: "Envoyer l'offre pour 3 postes" })]),
      () => done("Compte rendu enregistré.", ["compte rendu"]),
    ],
    "IA Sales Negotiator": [
      (p) => reply([use("create_offer", { prospect_id: uid(p), product_id: "immosuite", lignes: [{ poste: "licence", qte: 2 }, { poste: "abonnement_mensuel", qte: 12 }], remise_pct: 0 })]),
      () => done("Offre établie.", ["offre"]),
    ],
  });

  // 1. le CRM crée un prospect (navigateur) ; le serveur le traite ; l'agent de qualification travaille avec ses vrais outils
  await rpc(COMMERCIAL, "crm_sync_push($1, $2::jsonb)", ["device-loop-0001", JSON.stringify([{ op_id: "op-loop-0001", entity: "clients", rid: "c_alpha", data: {
    nom: "Alpha Immobilier", phone: "07 01 02 03 04", email: "", secteur: "Immobilier", statut: "prospect", commercial: "Aïcha", valeur: 800000, adresse: "Cocody", notes: "Promoteur, 2 programmes", interactions: [] } }])]);
  await run();
  const p = (await sql("select * from ai_prospects where crm_rid = 'c_alpha'")).rows[0];
  assert(p && p.stage === "enregistre", "prospect créé dans SANIX AI");
  const t1 = (await sql("select description from ai_agent_tasks where prospect_id = $1", [p.id])).rows[0];
  assert(t1.description.includes(`prospect_id = ${p.id}`), "la consigne de la mission porte l'identifiant du prospect (périmètre de l'agent)");
  await ticks(2); await run();
  eq(await val("select stage from ai_prospects where id = $1", [p.id]), "qualifie", "l'agent a qualifié le prospect avec ses outils (update_prospect, set_stage)");
  let c = (await client())[0];
  eq([c.data.ia.stage, c.data.ia.score], ["qualifie", 75], "le CRM reçoit la qualification faite par l'agent");

  // 2. la direction confie l'organisation d'un rendez-vous ; l'agent choisit un vrai créneau et le réserve
  const rdv = String(await val("select id from ai_agents where code = 'ia_rdv_1'"));
  await rpc(PRESIDENT, "crm_assign_mission($1, $2, 'Organiser une démonstration', 'Proposer un créneau et réserver la démonstration ImmoSuite', 2, 48)", [rdv, p.id]);
  await ticks(3); await run();
  const ap = (await sql("select * from ai_appointments where prospect_id = $1", [p.id])).rows[0];
  assert(ap && ap.statut === "confirme", "l'agent a réservé un rendez-vous (book_appointment)");
  const r1 = (await sql("select * from crm_records where entity = 'rdv' and rid = $1", ["ia_" + ap.id.replace(/-/g, "")])).rows[0];
  assert(r1 && r1.data.statut === "prevu" && r1.data._client_rid === "c_alpha", "le rendez-vous apparaît dans l'agenda du CRM");
  eq(await val("select stage from ai_prospects where id = $1", [p.id]), "rdv_confirme", "étape « rendez-vous confirmé »");

  // 3. garde-fous de l'outil : pas de compte rendu avant le rendez-vous
  const ctx = (): CrmCtx => ({ agentLabel: "test", agentId: null, scope: new Set([p.id]), createCap: 0, created: 0, source: "test" });
  let refus = "";
  try { await runCrmTool(ctx(), "record_appointment_report", { prospect_id: p.id, appointment_id: ap.id, statut: "realise", compte_rendu: "Compte rendu rédigé trop tôt par erreur de l'agent.", prochaine_etape: null }); } catch (e) { refus = (e as Error).message; }
  assert(refus.includes("pas encore commencé"), `compte rendu refusé avant le rendez-vous (${refus})`);

  // 4. le rendez-vous a eu lieu : l'agent rédige le compte rendu
  await sql("update ai_appointments set debut = now() - interval '3 hours', fin = now() - interval '2 hours' where id = $1", [ap.id]);
  await rpc(PRESIDENT, "crm_assign_mission($1, $2, 'Rédiger le compte rendu du rendez-vous', 'Le rendez-vous a eu lieu : enregistrer son compte rendu', 2, 24)", [rdv, p.id]);
  await ticks(3); await run();
  const r2 = (await sql("select * from crm_records where entity = 'rdv' and rid = $1", [r1.rid])).rows[0];
  eq(r2.data.statut, "fait", "rendez-vous réalisé dans l'agenda du CRM");
  assert(r2.data.compte_rendu.includes("très intéressés") && r2.data.compte_rendu.includes("Prochaine étape : Envoyer l'offre"), "compte rendu rédigé par l'agent, consultable dans le CRM");
  eq(await val("select stage from ai_prospects where id = $1", [p.id]), "demo_realisee", "l'entonnoir avance : démonstration réalisée");
  for (const [msg, input, part] of [
    ["double compte rendu", { statut: "realise", compte_rendu: "Un second compte rendu qui ne doit pas écraser le premier enregistré." }, "existe déjà"],
    ["compte rendu trop court", { statut: "realise", compte_rendu: "ok" }, "trop court"],
  ] as const) {
    let e = ""; try { await runCrmTool(ctx(), "record_appointment_report", { prospect_id: p.id, appointment_id: ap.id, prochaine_etape: null, ...input }); } catch (x) { e = (x as Error).message; }
    assert(e.includes(part), `${msg} refusé (${e})`);
  }
  let hors = ""; try { await runCrmTool({ ...ctx(), scope: new Set() }, "record_appointment_report", { prospect_id: p.id, appointment_id: ap.id, statut: "realise", compte_rendu: "Hors périmètre de la mission de l'agent, doit être refusé.", prochaine_etape: null }); } catch (x) { hors = (x as Error).message; }
  assert(hors.includes("périmètre"), `prospect hors périmètre refusé (${hors})`);

  // 5. l'agent de négociation établit l'offre avec la grille officielle
  const nego = String(await val("select id from ai_agents where code = 'ia_nego_1'"));
  await rpc(PRESIDENT, "crm_assign_mission($1, $2, 'Établir l''offre ImmoSuite', 'Offre pour 2 licences et un an d''abonnement', 2, 48)", [nego, p.id]);
  await ticks(3); await run();
  const off = (await sql("select * from ai_offers where prospect_id = $1", [p.id])).rows[0];
  eq([off.total_ht, off.statut], [2400000, "validee"], "offre calculée depuis la grille officielle (2 licences à 750 000 + 12 mois à 75 000)");
  const doc = (await sql("select * from crm_records where entity = 'documents' and rid = $1", ["ia_" + off.id.replace(/-/g, "")])).rows[0];
  assert(doc && doc.data.type === "proforma" && doc.data.html.includes("Licence annuelle"), "l'offre apparaît dans les documents du CRM");
  eq((await sql("select data from crm_records where entity = 'deals' and rid = $1", ["ia_" + p.id.replace(/-/g, "")])).rows[0].data.stage, "proposition", "affaire à l'étape « Proposition »");

  // 6. bilan : une seule fiche, historique complet, aucun événement en échec
  c = (await client())[0];
  eq((await client()).length, 1, "une seule fiche client");
  const types = (c.data.interactions as { type: string }[]).map((i) => i.type);
  for (const t of ["Pris en charge par l'IA", "Prospect qualifié par l'IA", "RDV fixé par l'IA", "Compte rendu de rendez-vous", "Offre générée par l'IA", "Mission terminée par l'IA"]) assert(types.includes(t), `historique du dossier : « ${t} »`);
  const ev = await rows("select status, count(*)::int n from crm_ai_events group by status");
  assert(ev.every((e: any) => e.status === "done" || e.status === "skipped"), `aucun événement en échec : ${JSON.stringify(ev)}`);
  const panel = await rpc(COMMERCIAL, "crm_client_panel('c_alpha')");
  assert(panel.agent && panel.missions.length >= 4 && panel.rdv[0].compte_rendu.includes("très intéressés") && panel.offres.length === 1, "fiche CRM : agent responsable, missions, compte rendu, offre");
});

Deno.test({ name: "nettoyage", fn: async () => { await dropAll(); }, sanitizeOps: false, sanitizeResources: false });
