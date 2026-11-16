// SANIX CRM Pro : moteur de renouvellements et de maintenance (valeurs calculées à la main). node renouvellements_test.js
const R = require("../shared/renouvellements.js");
let n = 0; const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); n++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — obtenu " + JSON.stringify(a) + ", attendu " + JSON.stringify(b));
const now = new Date(2026, 10, 16);                       // 16 novembre 2026
const O = { now, cfg: { maintenancePct: 12, societe: "SANIX", devise: "FCFA" } };
const LOG = [{ nom: "ImmoSuite ERP", prixNum: 750000, prixMensuel: 75000 }];

// Jours restants et paliers
eq(R.ecart("2026-11-16", now), 0, "aujourd'hui = 0"); eq(R.ecart("2026-11-30", now), 14, "+14 jours"); eq(R.ecart("2026-11-15", now), -1, "hier = -1"); eq(R.ecart("2027-01-15", now), 60, "+60 jours");
[[-1, "expire"], [0, "j7"], [7, "j7"], [8, "j15"], [15, "j15"], [16, "j30"], [30, "j30"], [31, "j60"], [60, "j60"], [61, null]].forEach(([j, p]) => eq(R.palier(j), p, "palier de " + j + " jours"));
// Mois : fin de mois, année bissextile
eq(R.ajouterMois("2026-01-31", 1), "2026-02-28", "31 janvier + 1 mois"); eq(R.ajouterMois("2024-01-31", 1), "2024-02-29", "année bissextile"); eq(R.ajouterMois("2026-11-16", 12), "2027-11-16", "+12 mois"); eq(R.ajouterMois("2026-12-31", 2), "2027-02-28", "+2 mois à cheval sur l'année");
// Montants : maintenance 12 % de 750 000 = 90 000 ; mensuel 75 000 ; annuel 10 mensualités ; triennal 3 ans
eq(R.montant({ type: "Perpetuelle" }, LOG[0], { maintenancePct: 12 }), 90000, "maintenance 12 %");
eq(R.montant({ type: "Perpetuelle" }, LOG[0], { maintenancePct: 10 }), 75000, "maintenance 10 % (configuration)");
eq(R.montant({ type: "Perpetuelle", maintPct: 8 }, LOG[0], { maintenancePct: 10 }), 60000, "maintenance 8 % propre à la licence");
eq(R.montant({ type: "Perpetuelle", renouvMontant: 100000 }, LOG[0], {}), 100000, "montant saisi prioritaire");
eq(R.montant({ type: "Mensuelle" }, LOG[0], {}), 75000, "mensuel"); eq(R.montant({ type: "SaaS" }, LOG[0], {}), 75000, "SaaS");
eq(R.montant({ type: "Annuelle" }, LOG[0], {}), 750000, "annuel = 10 mensualités"); eq(R.montant({ type: "Triennale" }, LOG[0], {}), 2250000, "triennal");
eq(R.montant({ type: "Annuelle" }, undefined, {}), 0, "logiciel inconnu : 0 (à saisir)");

// Échéance d'une licence perpétuelle : maintenance 1 an après l'activation
let e = R.echeance({ id: "l1", client: "ABRI 2000", logiciel: "ImmoSuite ERP", type: "Perpetuelle", debut: "2026-01-10", statut: "active" }, LOG, O);
eq([e.kind, e.due, e.jours, e.palier, e.montantHT, e.finPrevue, e.relanceDue], ["maintenance", "2027-01-10", 55, "j60", 90000, "2028-01-10", true], "maintenance d'une licence perpétuelle");
eq(R.echeance({ id: "l1", client: "X", logiciel: "ImmoSuite ERP", type: "Perpetuelle", debut: "2026-01-10", maintNon: true }, LOG, O), null, "sans maintenance : pas d'échéance");
eq(R.echeance({ id: "l1", client: "X", logiciel: "ImmoSuite ERP", type: "Perpetuelle", debut: "2026-01-10", maintFin: "2026-12-01" }, LOG, O).due, "2026-12-01", "fin de maintenance saisie");
// Abonnement : fin de licence ; prolongation depuis l'échéance, ou depuis aujourd'hui si dépassée de plus de 30 jours
e = R.echeance({ id: "l2", client: "Y", logiciel: "ImmoSuite ERP", type: "Annuelle", debut: "2025-10-20", fin: "2026-10-20" }, LOG, O);
eq([e.jours, e.palier, e.finPrevue, e.montantHT], [-27, "expire", "2027-10-20", 750000], "expiré depuis 27 jours : la période repart de l'échéance");
e = R.echeance({ id: "l3", client: "Z", logiciel: "ImmoSuite ERP", type: "Annuelle", debut: "2025-10-01", fin: "2026-10-01" }, LOG, O);
eq([e.jours, e.palier, e.finPrevue], [-46, "expire", "2027-11-16"], "expiré depuis 46 jours : la période repart d'aujourd'hui");
e = R.echeance({ id: "l4", client: "M", logiciel: "ImmoSuite ERP", type: "Mensuelle", debut: "2026-10-30", fin: "2026-11-30" }, LOG, O);
eq([e.jours, e.palier, e.finPrevue, e.montantHT], [14, "j15", "2026-12-30", 75000], "mensuel : +1 mois");
// Cas sans échéance
["Essai", "Perpetuelle-suspendue"].forEach(() => {});
eq(R.echeance({ id: "x", client: "A", logiciel: "ImmoSuite ERP", type: "Essai", fin: "2026-11-20" }, LOG, O), null, "essai ignoré");
eq(R.echeance({ id: "x", client: "A", logiciel: "ImmoSuite ERP", type: "Annuelle", fin: "2026-11-20", statut: "suspendue" }, LOG, O), null, "licence suspendue ignorée");
eq(R.echeance({ id: "x", client: "A", logiciel: "ImmoSuite ERP", type: "Annuelle" }, LOG, O), null, "abonnement sans date de fin ignoré");
// Relances : une seule par palier et par échéance
const base = { id: "l1", client: "ABRI 2000", logiciel: "ImmoSuite ERP", type: "Perpetuelle", debut: "2026-01-10" };
eq(R.echeance(Object.assign({}, base, { relances: [{ due: "2027-01-10", palier: "j60" }] }), LOG, O).relanceDue, false, "palier déjà relancé");
eq(R.echeance(Object.assign({}, base, { relances: [{ due: "2027-01-10", palier: "j30" }] }), LOG, O).relanceDue, true, "autre palier : à relancer");
eq(R.echeance(Object.assign({}, base, { relances: [{ due: "2026-01-10", palier: "j60" }] }), LOG, O).relanceDue, true, "relance d'une ancienne échéance ignorée");
eq(R.echeance(Object.assign({}, base, { debut: "2025-06-01" }), LOG, O).palier, "expire", "maintenance dépassée");
eq(R.echeance(Object.assign({}, base, { debut: "2026-11-01" }), LOG, O).palier, null, "échéance lointaine : pas de palier");

// Tri
const lst = R.echeances([{ id: "a", client: "A", logiciel: "ImmoSuite ERP", type: "Annuelle", fin: "2027-03-01" }, { id: "b", client: "B", logiciel: "ImmoSuite ERP", type: "Annuelle", fin: "2026-12-01" }, { id: "c", client: "C", logiciel: "ImmoSuite ERP", type: "Essai", fin: "2026-12-01" }], LOG, O);
eq(lst.map((x) => x.client), ["B", "A"], "échéances triées, essai écarté");

// Messages
const e30 = R.echeance({ id: "l1", client: "ABRI 2000", logiciel: "ImmoSuite ERP", type: "Perpetuelle", debut: "2025-12-10" }, LOG, O);      // échéance 2026-12-10 = J-24
ok(e30.palier === "j30", "palier J-30 pour 24 jours");
const m30 = R.message(e30, O.cfg); ok(/ABRI 2000/.test(m30) && /90 000 FCFA HT/.test(m30) && /10\/12\/2026/.test(m30) && /maintenance de ImmoSuite ERP/.test(m30), "message J-30 : " + m30);
const mEx = R.message(R.echeance(Object.assign({}, base, { debut: "2025-06-01" }), LOG, O), O.cfg); ok(/arrivé\(e\) à échéance le 01\/06\/2026/.test(mEx), "message expiré : " + mEx);
const m7 = R.message(R.echeance({ id: "l5", client: "Q", logiciel: "ImmoSuite ERP", type: "Annuelle", fin: "2026-11-17" }, LOG, O), O.cfg); ok(/dans 1 jour \(le 17\/11\/2026\)/.test(m7) && /cette semaine/.test(m7), "message J-7 : " + m7);
ok(!/Le renouvellement est de/.test(R.message(Object.assign({}, e30, { montantHT: 0 }), O.cfg)), "pas de montant annoncé quand il est inconnu");

// Facture de renouvellement
const f = R.commande(e30, { tva: 18, ref: "REN-2026-001", today: "2026-11-16", commercial: "Moi" });
eq([f.id, f.htNet, f.tva, f.ttc, f.solde, f.statut, f.renouvellement, f.typeLicence, f.licId, f.renouvDue, f.renouvJusqua, f.sansTva], ["renouv_l1_2026-12-10", 90000, 16200, 106200, 106200, "brouillon", true, "Maintenance", "l1", "2026-12-10", "2027-12-10", false], "facture de renouvellement");
eq(R.commande(e30, { tva: 0 }).ttc, 90000, "sans TVA"); eq(R.idCommande(e30), R.commande(e30, {}).id, "identifiant stable");
// Prolongation
const lic = { id: "l1", client: "ABRI 2000", type: "Perpetuelle", debut: "2025-12-10", statut: "active" };
const pp = R.prolonger(lic, e30, { today: "2026-11-16", cmdId: f.id });
eq([pp.maintFin, pp.fin, pp.statut, pp.renouvellements.length, pp.renouvellements[0].de, pp.renouvellements[0].a, pp.renouvellements[0].cmdId], ["2027-12-10", undefined, "active", 1, "2026-12-10", "2027-12-10", f.id], "prolongation de la maintenance");
const ab = R.echeance({ id: "l2", client: "Y", logiciel: "ImmoSuite ERP", type: "Annuelle", fin: "2026-10-20" }, LOG, O);
eq(R.prolonger({ type: "Annuelle", fin: "2026-10-20" }, ab, {}).fin, "2027-10-20", "prolongation d'un abonnement : nouvelle date de fin");
// Bilan
const b = R.bilan([{ renouvellement: true, statut: "confirmee", htNet: 90000, ttc: 106200, acompte: 0 }, { renouvellement: true, statut: "livree", htNet: 90000, ttc: 106200, acompte: 106200 },
  { renouvellement: true, statut: "brouillon", htNet: 50000, ttc: 59000 }, { renouvellement: true, statut: "annulee", htNet: 1, ttc: 1 }, { statut: "confirmee", htNet: 999, ttc: 999 }]);
eq(b, { n: 2, ht: 180000, ttc: 212400, encaisse: 106200, creance: 106200, brouillons: 1 }, "bilan des renouvellements");
console.log("Renouvellements : " + n + " contrôles passés.");
