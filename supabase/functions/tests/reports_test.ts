// Rapports : planification multi-fuseaux, contenu, rendu HTML / PDF, envoi, anti-doublon, alertes.
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { assert, dropAll, eq, freshDb, mkAgent, mkTask, one, rows, val } from "./testkit.ts";
import { sql, storage } from "./fake_supabase.ts";
import { json, llm, script } from "./fake_anthropic.ts";
import { isDue, reportPeriod, type Setting, tzOffsetMinutes, zonedToUtc } from "../_shared/reports/schedule.ts";
import { type Analyse, buildDoc, fallbackAnalyse } from "../_shared/reports/doc.ts";
import { docToHtml } from "../_shared/reports/html.ts";
import { docToPdf } from "../_shared/reports/pdf.ts";
import { flushIncidents, generateAndSend, reportTick, resend } from "../_shared/reports/builder.ts";

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const S = (o: Partial<Setting>): Setting => ({ type: "quotidien", actif: true, heure: "18:00:00", fuseau: "Africa/Abidjan", jour_semaine: 5, jour_mois: 1, format: "html_pdf", dernier_envoi: null, ...o });

T("R1 · fuseaux horaires et échéances", () => {
  eq(zonedToUtc(2026, 11, 9, 18, 0, "Africa/Abidjan").toISOString(), "2026-11-09T18:00:00.000Z", "Abidjan = UTC");
  eq(zonedToUtc(2026, 11, 9, 18, 0, "Europe/Paris").toISOString(), "2026-11-09T17:00:00.000Z", "Paris hiver (UTC+1)");
  eq(zonedToUtc(2026, 7, 1, 18, 0, "Europe/Paris").toISOString(), "2026-07-01T16:00:00.000Z", "Paris été (UTC+2)");
  eq(zonedToUtc(2026, 11, 9, 18, 0, "America/New_York").toISOString(), "2026-11-09T23:00:00.000Z", "New York hiver (UTC-5)");
  eq(tzOffsetMinutes(Date.UTC(2026, 6, 1), "Europe/Paris"), 120, "décalage Paris été");
  const abj = S({});
  eq(isDue(abj, new Date("2026-11-09T17:59:00Z")).due, false, "17 h 59 : pas encore");
  eq(isDue(abj, new Date("2026-11-09T18:00:00Z")).due, true, "18 h 00 : échu");
  eq(isDue({ ...abj, dernier_envoi: "2026-11-09T18:00:30Z" }, new Date("2026-11-09T18:05:00Z")).due, false, "déjà envoyé aujourd'hui");
  eq(isDue({ ...abj, dernier_envoi: "2026-11-08T18:00:30Z" }, new Date("2026-11-09T18:05:00Z")).due, true, "envoyé hier : échu");
  eq(isDue({ ...abj, actif: false }, new Date("2026-11-09T19:00:00Z")).due, false, "désactivé");
  eq(isDue(S({ type: "incident" }), new Date("2026-11-09T19:00:00Z")).due, false, "incident = immédiat, jamais planifié");
  eq(isDue(S({ fuseau: "Europe/Paris" }), new Date("2026-11-09T16:59:00Z")).due, false, "18 h Paris = 17 h UTC (hiver) : pas encore");
  eq(isDue(S({ fuseau: "Europe/Paris" }), new Date("2026-11-09T17:00:00Z")).due, true, "18 h Paris = 17 h UTC : échu");
  eq(isDue(S({ type: "hebdomadaire" }), new Date("2026-11-09T18:30:00Z")).due, false, "lundi : pas vendredi");
  eq(isDue(S({ type: "hebdomadaire" }), new Date("2026-11-13T18:30:00Z")).due, true, "vendredi : échu");
  eq(isDue(S({ type: "mensuel", heure: "08:00" }), new Date("2026-12-01T08:05:00Z")).due, true, "1er du mois : échu");
  eq(isDue(S({ type: "mensuel", heure: "08:00" }), new Date("2026-11-09T08:05:00Z")).due, false, "9 du mois : pas échu");
  const d = reportPeriod("quotidien", new Date("2026-11-09T18:00:00Z"), "Africa/Abidjan");
  eq([d.debut.toISOString(), d.label], ["2026-11-09T00:00:00.000Z", "09 novembre 2026"], "période quotidienne");
  const m = reportPeriod("mensuel", new Date("2026-12-01T08:00:00Z"), "Africa/Abidjan");
  eq([m.debut.toISOString(), m.fin.toISOString(), m.label], ["2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", "novembre 2026"], "mois précédent complet");
  const jan = reportPeriod("mensuel", new Date("2027-01-01T08:00:00Z"), "Africa/Abidjan");
  eq(jan.debut.toISOString(), "2026-12-01T00:00:00.000Z", "passage d'année");
  return Promise.resolve();
});

const DATA = {
  periode: { debut: "2026-11-09T00:00:00Z", fin: "2026-11-09T18:00:00Z" },
  activite: { agents_actifs: 12, agents_crees: 3, missions_attribuees: 20, missions_terminees: 14, missions_en_cours: 5, missions_bloquees: 1, reunions: 2, cout_ia_usd: 7.4 },
  commercial: { nouveaux_prospects: 48, prospects_qualifies: 17, whatsapp_envoyes: 60, emails_envoyes: 35, reponses_recues: 22, rdv_obtenus: 6, demos_programmees: 4, offres_transmises: 3, negociations_en_cours: 2 },
  financier: { valeur_opportunites: 45000000, devis_transmis_ht: 6150000, marches_conclus: 1, ca_signe_ht: 750000, ca_encaisse_ht: 0, prevision_ponderee: 9800000 },
  agents: Array.from({ length: 40 }, (_, i) => ({ nom: `IA Agent numéro ${i + 1} — Œuvre « spéciale »`, fonction: i % 2 ? "Qualification commerciale très détaillée" : "Prospection WhatsApp", attribuees: 5 + i, terminees: 4 + i,
    taux: 80, qualite: 77.5, respect_delais: 90, cout_usd: 0.25 + i / 10, incidents: i % 7 === 0 ? 1 : 0, score: 82.5 - i })),
  difficultes: {
    agents_en_difficulte: [{ nom: "IA Hunter", fonction: "Recherche", etat: "suspendu", activite: "en_difficulte" }],
    missions_bloquees: [{ titre: "Étude <script>alert(1)</script>", agent: "IA Market", note: "Source indisponible & \"bloquée\"" }],
    incidents: [{ gravite: "critique", type: "suspension_auto", message: "IA Hunter suspendu 🚨 → après 3 incidents ≥ seuil", at: "2026-11-09T15:00:00Z" }],
    validations_en_attente: [{ type: "remise", motif: "Remise 12 % ImmoSuite", depuis: "2026-11-09T10:00:00Z" }],
  },
  programme: { missions_prioritaires: [{ titre: "Qualifier 50 promoteurs", agent: "IA Qualifier", priorite: 1, echeance: "2026-11-10T12:00:00Z" }], rdv_prevus: [{ prospect: "Promoteur Alpha", debut: "2026-11-10T09:00:00Z", mode: "visio" }] },
};
const ANALYSE: Analyse = { resume: "Journée solide : 14 missions terminées.", recommandations: ["Débloquer l'étude de marché", "Réactiver IA Hunter après révision de sa charte"], risques: ["Dépendance à une seule source"],
  informations_manquantes: ["Budgets clients"], objectifs_commerciaux: ["8 démos cette semaine"], actions_strategiques: ["Ouvrir le marché de Bouaké"], orientations: ["Renforcer le segment santé"] };

T("R2 · contenu, HTML sûr (échappement) et PDF multipage sans emoji", async () => {
  const doc = buildDoc("quotidien", DATA, ANALYSE, "09 novembre 2026");
  const html = docToHtml(doc);
  for (const t of ["RAPPORT JOURNALIER – SANIX AI VIRTUAL COMPANY", "Date : 09 novembre 2026.", "A. ACTIVITÉ GÉNÉRALE", "B. ACTIVITÉ COMMERCIALE", "C. RÉSULTATS FINANCIERS",
    "D. PERFORMANCE DES COLLABORATEURS", "E. DIFFICULTÉS RENCONTRÉES", "F. DÉCISIONS ET RECOMMANDATIONS", "G. PROGRAMME DU LENDEMAIN",
    "Nombre d&#39;agents actifs", "Valeur des opportunités commerciales", "Validations humaines en attente"]) assert(html.includes(t), `HTML contient « ${t} »`);
  assert(!html.includes("<script>"), "aucun script injecté dans le HTML");
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "contenu hostile échappé");
  assert(!/\son[a-z]+\s*=/i.test(html), "aucun gestionnaire d'événement");
  for (const type of ["hebdomadaire", "mensuel", "incident"] as const) {
    const h = docToHtml(buildDoc(type, DATA, ANALYSE, "période")); assert(h.length > 1500, `rapport ${type} généré`);
  }
  eq(docToHtml(buildDoc("mensuel", DATA, ANALYSE, "novembre 2026")).includes("F. ORIENTATIONS STRATÉGIQUES"), true, "section stratégique mensuelle");
  const pdf = await docToPdf(doc);
  eq(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-", "signature PDF");
  const loaded = await PDFDocument.load(pdf);
  assert(loaded.getPageCount() >= 3, `tableau de 40 agents réparti sur plusieurs pages (${loaded.getPageCount()})`);
  await Deno.writeFile(Deno.env.get("PDF_OUT") ?? "/dev/null", pdf).catch(() => {});
  const vide = await docToPdf(buildDoc("quotidien", { ...DATA, agents: [] }, fallbackAnalyse({ ...DATA, agents: [] }), "x"));
  assert(vide.length > 1000, "PDF sans agent");
  assert(fallbackAnalyse(DATA).recommandations.length >= 2, "analyse de repli sans IA");
});

async function setup(): Promise<{ mails: any[]; restore: () => void }> {
  await freshDb();
  await mkAgent("ia_hunter", "IA Hunter", 4, "sanix_ai_sales_director", []);
  const t = await mkTask("ia_hunter", "Trouver des promoteurs", { donneur: "sanix_ai_sales_director" });
  await sql("update ai_agent_tasks set statut = 'terminee', evaluation = 80, rapport = 'ok' where id = $1", [t]);
  await sql("insert into ai_prospects(entreprise, secteur, crit_produit, crit_besoin) values ('Promoteur Alpha', 'Immobilier', 25, 20)");
  await sql("insert into ai_report_recipients(email, nom, principal) values ('president@sanix-africa.ci', 'Président', true), ('dg@sanix-africa.ci', 'Adjoint', false)");
  await sql("insert into ai_report_recipients(email, types) values ('hebdo@sanix-africa.ci', '{hebdomadaire}')");
  Deno.env.set("RESEND_API_KEY", "re_test"); Deno.env.set("EMAIL_FROM", "SANIX AI <ia@sanix-africa.ci>");
  const mails: any[] = [], real = globalThis.fetch;
  globalThis.fetch = ((url: string, init: any) => { mails.push({ url: String(url), ...JSON.parse(init.body) });
    return Promise.resolve(new Response(JSON.stringify({ id: `mail_${mails.length}` }), { status: 200 })); }) as typeof fetch;
  return { mails, restore: () => { globalThis.fetch = real; Deno.env.delete("RESEND_API_KEY"); Deno.env.delete("EMAIL_FROM"); } };
}

T("R3 · génération, archivage, PDF, envoi aux destinataires abonnés, anti-doublon", async () => {
  const { mails, restore } = await setup();
  try {
    script({ "SANIX AI GENERAL DIRECTOR": [() => json(ANALYSE), () => json(ANALYSE)] });
    const now = new Date("2026-11-09T18:00:10Z");
    const r1 = await reportTick(now);
    eq(r1.generes, ["quotidien:envoye"], "rapport quotidien envoyé à 18 h");
    eq(mails.length, 2, "2 destinataires abonnés au quotidien (pas celui de l'hebdomadaire)");
    eq(mails.map((m) => m.to[0]).sort(), ["dg@sanix-africa.ci", "president@sanix-africa.ci"], "destinataires");
    assert(mails[0].subject.includes("Rapport journalier — 09 novembre 2026"), `objet : ${mails[0].subject}`);
    eq(mails[0].attachments.length, 1, "PDF joint");
    assert(atob(mails[0].attachments[0].content).startsWith("%PDF-"), "pièce jointe = PDF valide");
    const row = await one("select type, statut, destinataires, pdf_path, html, recommandations, cout_usd, periode_debut from ai_daily_reports");
    eq([row.type, row.statut, row.destinataires.length], ["quotidien", "envoye", 2], "historique archivé");
    assert(row.html.includes("RAPPORT JOURNALIER") && row.pdf_path && storage.has(row.pdf_path), "HTML et PDF conservés");
    assert(row.cout_usd > 0, "coût de l'analyse IA comptabilisé");
    eq(JSON.parse(row.recommandations).resume, ANALYSE.resume, "analyse du directeur IA conservée");
    eq(row.periode_debut, "2026-11-09T00:00:00.000Z", "période du jour");
    // anti-doublon : un second passage 5 min plus tard n'envoie rien
    const r2 = await reportTick(new Date("2026-11-09T18:05:00Z"));
    eq([r2.generes.length, mails.length], [0, 2], "pas de second envoi le même jour");
    // lendemain : nouvel envoi
    script({ "SANIX AI GENERAL DIRECTOR": [() => json(ANALYSE)] });
    const r3 = await reportTick(new Date("2026-11-10T18:02:00Z"));
    eq(r3.generes, ["quotidien:envoye"], "envoi du lendemain");
    // vendredi : hebdomadaire (+ quotidien), le destinataire hebdo reçoit
    script({ "SANIX AI GENERAL DIRECTOR": [() => json(ANALYSE), () => json(ANALYSE)] });
    mails.length = 0;
    const r4 = await reportTick(new Date("2026-11-13T18:01:00Z"));
    eq(r4.generes.sort(), ["hebdomadaire:envoye", "quotidien:envoye"], "hebdomadaire le vendredi");
    assert(mails.some((m) => m.to[0] === "hebdo@sanix-africa.ci"), "destinataire hebdomadaire servi");
    // réexpédition depuis l'historique (HTML + PDF stocké)
    const id = await val("select id from ai_daily_reports where type = 'hebdomadaire'");
    mails.length = 0;
    const re = await resend(String(id));
    eq([re.statut, mails.length], ["envoye", 3], "réexpédition à tous les abonnés hebdomadaires + principaux");
    assert(atob(mails[0].attachments[0].content).startsWith("%PDF-"), "PDF relu depuis le stockage");
  } finally { restore(); }
});

T("R4 · reprise sans IA, e-mail non configuré, échec d'envoi, alertes critiques", async () => {
  const { mails, restore } = await setup();
  try {
    // IA indisponible (budget) : le rapport part quand même avec une analyse automatique
    await sql("update ai_governance set budget_jour_usd = 0");
    const r = await generateAndSend("quotidien", new Date("2026-11-09T18:00:00Z"));
    eq(r.statut, "envoye", "rapport envoyé malgré le budget IA atteint");
    eq(llm.calls.length, 0, "aucun appel IA hors budget");
    assert(String((await one("select recommandations from ai_daily_reports order by created_at desc limit 1")).recommandations).includes("Analyse automatique"), "analyse de repli");
    await sql("update ai_governance set budget_jour_usd = 50");

    // e-mail non configuré : généré et archivé, non envoyé
    Deno.env.delete("RESEND_API_KEY");
    script({ "SANIX AI GENERAL DIRECTOR": [() => json(ANALYSE)] });
    const g = await generateAndSend("mensuel", new Date("2026-12-01T08:00:00Z"));
    eq(g.statut, "genere", "non configuré : généré, non envoyé");
    Deno.env.set("RESEND_API_KEY", "re_test");

    // Resend en erreur : statut « echec » + erreur conservée
    const real = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }))) as typeof fetch;
    script({ "SANIX AI GENERAL DIRECTOR": [() => json(ANALYSE)] });
    const f = await generateAndSend("hebdomadaire", new Date("2026-11-13T18:00:00Z"));
    globalThis.fetch = real;
    eq(f.statut, "echec", "échec d'envoi tracé");
    assert(String(f.erreur).includes("domain not verified"), "cause conservée");

    // Alertes critiques : un seul e-mail groupé, marquées notifiées, pas de doublon
    mails.length = 0;
    await sql("select ai_register_incident((select id from ai_agents where code = 'ia_hunter'), null, 'suspension_auto', 'critique', 'IA Hunter suspendu après 3 incidents', false)");
    await sql("select ai_register_incident(null, null, 'budget', 'attention', 'Budget atteint', false)");
    eq(await flushIncidents(new Date("2026-11-09T12:00:00Z")), 1, "une alerte critique notifiée (l'incident « attention » attend le rapport)");
    eq(mails.length, 2, "e-mail d'alerte aux abonnés « incident »");
    assert(mails[0].subject.includes("incident(s) critique(s)") && !mails[0].attachments, "alerte sans pièce jointe");
    eq(await flushIncidents(new Date("2026-11-09T12:05:00Z")), 0, "pas de renvoi");
    eq(Number(await val("select count(*) from ai_incidents where gravite = 'critique' and notifie_at is null")), 0, "incident marqué notifié");
    eq(Number(await val("select count(*) from ai_daily_reports where type = 'incident'")), 1, "alerte archivée dans l'historique");
  } finally { restore(); }
});
T("cleanup", async () => { await dropAll(); });
