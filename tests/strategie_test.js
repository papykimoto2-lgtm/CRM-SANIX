// SANIX CRM Pro : stratégie de conversion par logiciel (calculs vérifiés à la main). node strategie_test.js
const S = require("../shared/strategie.js");
let n = 0; const ok = (c, m) => { n++; if (!c) throw new Error("ÉCHEC : " + m); };
const near = (a, b, m) => ok(Math.abs(a - b) < 1e-6, m + " (obtenu " + a + ", attendu " + b + ")");

ok(S.famille("Angel's Livraison") === "Hub Angel's" && S.famille("Angels Transport") === "Hub Angel's" && S.famille("Angel's Agro") === "Hub Angel's" && S.famille("ImmoSuite ERP") === "ImmoSuite ERP" && S.famille("") === "(sans logiciel)", "familles de logiciels");
ok(S.lundi("2026-11-18") === "2026-11-16" && S.lundi("2026-11-16") === "2026-11-16" && S.lundi("2026-11-15") === "2026-11-09" && S.lundi("2026-11-22") === "2026-11-16", "lundi de la semaine (dimanche = fin de semaine)");

// Commandes fictives
const cmd = (client, logiciel, ht, extra) => Object.assign({ client, logiciel, htNet: ht, statut: "en_cours", date: "2026-11-17" }, extra || {});
const C = [cmd("A", "ImmoSuite ERP", 3e6), cmd("B", "ImmoSuite ERP", 4e6), cmd("C", "Sanix AluExpert ERP", 4e5), cmd("D", "Sanix AluExpert ERP", 6e5),
  cmd("E", "Angel's Livraison", 5e5), cmd("E", "Angel's Transport", 5e5),
  cmd("F", "ImmoSuite ERP", 9e6, { statut: "brouillon" }), cmd("A", "ImmoSuite ERP", 1e6, { renouvellement: true }), cmd("G", "ImmoSuite ERP", 2e6, { statut: "annulee" })];
// Fiches : 10 ImmoSuite (2 gagnées), 50 AluExpert (2 gagnées), 5 Hub (1 gagnée) + 1 doublon + 1 perdue
const deals = [], add = (logiciel, stage, i) => deals.push({ client: logiciel + i, logiciel, stage, history: [] });
for (let i = 0; i < 10; i++) add("ImmoSuite ERP", i < 2 ? "gagne" : "prospect", i);
for (let i = 0; i < 50; i++) add("Sanix AluExpert ERP", i < 2 ? "gagne" : "prospect", i);
for (let i = 0; i < 4; i++) add("Angel's Livraison", i < 1 ? "gagne" : "prospect", i);
add("Angel's Transport", "prospect", 0);
deals.push(Object.assign({}, deals[0])); add("ImmoSuite ERP", "perdu", 99);

const A = S.analyser(C, deals, { cfg: null, logiciels: [{ nom: "ImmoSuite ERP", prixNum: 4e6 }, { nom: "Angel's Livraison", prixNum: 6e5 }, { nom: "Angel's Transport", prixNum: 7e5 }] });
const L = (f) => A.lignes.filter((r) => r.famille === f)[0];
near(A.caTotal, 3e6 + 4e6 + 4e5 + 6e5 + 5e5 + 5e5, "CA total : brouillons, annulées et renouvellements exclus = 9 000 000");
near(L("ImmoSuite ERP").ca, 7e6, "ImmoSuite : 3 M + 4 M"); ok(L("ImmoSuite ERP").ventes === 2 && L("ImmoSuite ERP").nbClients === 2, "ImmoSuite : 2 ventes, 2 clients");
ok(L("ImmoSuite ERP").fiches === 10 && L("ImmoSuite ERP").gagnes === 2, "ImmoSuite : 10 fiches (doublon et fiche perdue exclus), 2 gagnées");
near(L("ImmoSuite ERP").caParFiche, 7e5, "CA par fiche ImmoSuite = 7 000 000 / 10"); near(L("ImmoSuite ERP").conversion, 0.2, "conversion ImmoSuite = 2 / 10"); near(L("ImmoSuite ERP").panier, 3.5e6, "panier moyen = 3 500 000");
near(L("Sanix AluExpert ERP").caParFiche, 2e4, "CA par fiche AluExpert = 1 000 000 / 50"); near(L("Sanix AluExpert ERP").conversion, 0.04, "conversion AluExpert = 2 / 50");
const H = L("Hub Angel's"); near(H.ca, 1e6, "Hub Angel's : Livraison + Transport = 1 000 000"); ok(H.ventes === 2 && H.nbClients === 1 && H.fiches === 5 && H.gagnes === 1, "Hub : 2 ventes, 1 client, 5 fiches, 1 gagnée"); near(H.caParFiche, 2e5, "CA par fiche Hub = 1 000 000 / 5"); near(H.prixCatalogue, 7e5, "prix catalogue = module le plus cher");
near(L("ImmoSuite ERP").prixCatalogue, 4e6, "prix catalogue ImmoSuite 4 000 000");
ok(L("MediCore Suite").ca === 0 && L("MediCore Suite").fiches === 0, "famille de test présente même sans vente");
ok(A.lignes.map((r) => r.famille).join("|") === "ImmoSuite ERP|Hub Angel's|Sanix AluExpert ERP|MediCore Suite", "classement par CA par fiche décroissant");
ok(L("ImmoSuite ERP").indicatif && L("Hub Angel's").indicatif, "moins de 5 ventes : résultat « indicatif »");
near(L("ImmoSuite ERP").partCA, 7 / 9, "part du CA ImmoSuite = 7 / 9");
ok(S.totalParts(A.reglages) === 100, "parts de temps par défaut : 100 %");
ok(S.reglages({ "ImmoSuite ERP": { part: 40 } })["ImmoSuite ERP"].part === 40 && S.reglages({ "ImmoSuite ERP": { part: 40 } })["ImmoSuite ERP"].contacts === 15, "réglages saisis fusionnés avec les valeurs par défaut");

const K = S.concentration(C); near(K.top1, 7e6 / 9e6 * 0 + 4e6 / 9e6, "premier client = B : 4 000 000 / 9 000 000"); near(K.top2, 7e6 / 9e6, "deux premiers = 7 000 000 / 9 000 000"); ok(K.clients === 5, "5 clients distincts");

// Semaine du lundi 16 au dimanche 22 novembre 2026
ok(S.etapeAtteinte({ type: "stage_change", note: "Prospect → Contact" }) === "contact" && S.etapeAtteinte({ type: "stage_change", note: "Démo réalisée" }) === "demo" && S.etapeAtteinte({ type: "stage_change", note: "Proposition envoyée · 5 000 000 FCFA" }) === "proposition" && S.etapeAtteinte({ type: "stage_change", note: "Contact → Gagné ✓" }) === "gagne" && S.etapeAtteinte({ type: "stage_change", note: "En négociation" }) === "negociation" && S.etapeAtteinte({ type: "creation", note: "Contact" }) === null, "lecture des étapes dans l'historique");
const h = (date, note) => ({ date, type: "stage_change", note });
const D2 = [
  { client: "x1", logiciel: "ImmoSuite ERP", stage: "demo", history: [h("2026-11-17T09:00:00Z", "Prospect → Contact"), h("2026-11-17T15:00:00Z", "Contact → Démo"), h("2026-11-18T10:00:00Z", "Démo réalisée")] },   // contact 1, démo 1 (comptée une fois)
  { client: "x2", logiciel: "ImmoSuite ERP", stage: "contact", history: [h("2026-11-10T09:00:00Z", "Prospect → Contact"), h("2026-11-22T23:00:00Z", "Contact → Proposition")] },       // contact de la semaine précédente ignoré ; proposition du dimanche comptée
  { client: "x3", logiciel: "ImmoSuite ERP", stage: "contact", history: [h("2026-11-23T00:00:00Z", "Prospect → Contact")] },                                                       // lundi suivant : hors semaine
  { client: "y1", logiciel: "Angel's Livraison", stage: "contact", history: [h("2026-11-19T09:00:00Z", "Prospect → Contact")] }
];
const W = S.semaine(C, D2, { now: "2026-11-18" }), WL = (f) => W.lignes.filter((r) => r.famille === f)[0];
ok(W.debut === "2026-11-16" && W.fin === "2026-11-22", "semaine du 16 au 22 novembre");
ok(WL("ImmoSuite ERP").contacts === 1 && WL("ImmoSuite ERP").demos === 1 && WL("ImmoSuite ERP").propositions === 1, "ImmoSuite : 1 contact, 1 démo, 1 proposition (étapes comptées une fois, hors semaine ignorées)");
ok(WL("Hub Angel's").contacts === 1 && WL("Hub Angel's").ventes === 2, "Hub : 1 contact, 2 ventes dans la semaine");
ok(WL("ImmoSuite ERP").ventes === 2 && Math.abs(WL("ImmoSuite ERP").ca - 7e6) < 1e-6, "ImmoSuite : 2 ventes datées de la semaine, 7 000 000 HT");
near(WL("ImmoSuite ERP").avancement, (1 / 15 + 1 / 4 + 1 / 2) / 3, "avancement = moyenne de contacts/15, démos/4, propositions/2");
ok(W.lignes.length >= 4, "toutes les familles suivies apparaissent, même sans activité");
console.log("Stratégie par logiciel : " + n + " contrôles passés.");
