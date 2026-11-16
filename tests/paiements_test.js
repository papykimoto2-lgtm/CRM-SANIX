// SANIX CRM Pro : journal des paiements (règles, plafonds, écritures par mode). Valeurs calculées à la main. node paiements_test.js
const P = require("../shared/paiements.js");
let n = 0; const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); n++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — obtenu " + JSON.stringify(a) + ", attendu " + JSON.stringify(b));
const cmd = (o) => Object.assign({ id: "c1", date: "2026-11-10", ttc: 118000, statut: "confirmee" }, o || {});
const T = { today: "2026-11-16" };

// Ancienne commande : l'acompte devient un paiement estimé
let c = cmd({ acompte: 50000 }); let l = P.liste(c);
eq([l.length, l[0].montant, l[0].mode, l[0].date, l[0].estimee], [1, 50000, "inconnu", "2026-11-10", true], "acompte ancien lu comme un paiement unique daté de la vente");
eq([P.total(c), P.reste(c), P.verse(c)], [50000, 68000, 50000], "total, reste et versé d'une ancienne commande");
eq(P.liste(cmd({ acompte: 0 })), [], "sans acompte : aucun paiement"); eq(P.liste(null), [], "commande absente : liste vide");

// Ajout : l'acompte et le solde se recalculent ; le paiement ancien est conservé
let r = P.ajouter(c, { date: "2026-11-12", montant: 40000, mode: "especes", ref: "RC-1" }, T);
ok(r.ok && c.paiements.length === 2 && c.acompte === 90000 && c.solde === 28000, "40 000 ajoutés : acompte 90 000, solde 28 000 (l'ancien acompte est conservé)");
eq([c.paiements[0].mode, c.paiements[1].mode, c.paiements[1].ref], ["inconnu", "especes", "RC-1"], "modes et référence enregistrés");
// Refus
let avant = JSON.stringify(c);
r = P.ajouter(c, { date: "2026-11-13", montant: 30000, mode: "virement" }, T); ok(!r.ok && r.erreur === "depasse" && JSON.stringify(c) === avant, "30 000 > reste 28 000 : refusé, rien n'est modifié");
r = P.ajouter(c, { date: "2026-11-13", montant: 28000, mode: "virement" }, T); ok(r.ok && c.acompte === 118000 && c.solde === 0 && P.reste(c) === 0, "28 000 = reste exact : accepté, commande soldée");
r = P.ajouter(c, { date: "2026-11-13", montant: 1, mode: "virement" }, T); ok(!r.ok && r.erreur === "depasse", "commande soldée : plus aucun paiement");
c = cmd(); ["0", -5, "abc", null, undefined].forEach((m) => ok(!P.ajouter(c, { date: "2026-11-12", montant: m, mode: "especes" }, T).ok, "montant invalide refusé : " + m));
eq(P.ajouter(c, { date: "2026-11-17", montant: 1000, mode: "especes" }, T).erreur, "futur", "date future refusée");
["2026-13-01", "2026-02-30", "12/11/2026", "", undefined].forEach((d) => ok(P.ajouter(c, { date: d, montant: 1000, mode: "especes" }, T).erreur === "date", "date invalide refusée : " + d));
eq(P.ajouter(cmd({ statut: "brouillon" }), { date: "2026-11-12", montant: 1000, mode: "especes" }, T).erreur, "statut", "commande en brouillon : refusé (il ne serait pas comptabilisé)");
eq(P.ajouter(cmd({ statut: "annulee" }), { date: "2026-11-12", montant: 1000, mode: "especes" }, T).erreur, "statut", "commande annulée : refusé");
ok(P.ajouter(c, { date: "2026-11-12", montant: 1000, mode: "bitcoin" }, T).ok && c.paiements[0].mode === "inconnu", "mode inconnu : ramené à « mode non précisé »");
c = cmd(); ok(P.ajouter(c, { date: "2026-11-12", montant: 1000.6, mode: "especes" }, T).ok && c.paiements[0].montant === 1001, "montant arrondi au franc");
ok(P.ajouter(c, { date: "2026-11-12", montant: 500 }, {}).ok, "sans date du jour fournie, la date future n'est pas contrôlée");

// Modification et suppression
c = cmd({ acompte: 50000 }); P.ajouter(c, { date: "2026-11-12", montant: 40000, mode: "especes" }, T); const idNouveau = c.paiements[1].id, idAncien = c.paiements[0].id;
r = P.modifier(c, idNouveau, { montant: 70000 }, T); ok(!r.ok && r.erreur === "depasse" && c.acompte === 90000, "modifier : 70 000 + 50 000 > 118 000 refusé, acompte inchangé (90 000)");
r = P.modifier(c, idNouveau, { montant: 68000, date: "2026-11-14", mode: "mobile_money" }, T); ok(r.ok && c.acompte === 118000 && c.solde === 0 && c.paiements[1].mode === "mobile_money" && c.paiements[1].date === "2026-11-14", "modifier : 68 000 en Mobile Money le 14/11, commande soldée");
r = P.modifier(c, idAncien, { mode: "virement", date: "2026-11-11" }, T); ok(r.ok && !("estimee" in c.paiements[0]) && c.paiements[0].mode === "virement", "préciser un ancien paiement : la mention « estimée » disparaît");
eq(P.modifier(c, "inexistant", { montant: 1 }, T).erreur, "introuvable", "paiement inexistant");
ok(P.supprimer(c, idNouveau) && c.acompte === 50000 && c.solde === 68000 && c.paiements.length === 1, "suppression : acompte 50 000, solde 68 000"); ok(!P.supprimer(c, "inexistant"), "supprimer un paiement inconnu : sans effet");
ok(P.supprimer(c, idAncien) && c.acompte === 0 && c.solde === 118000 && Array.isArray(c.paiements) && c.paiements.length === 0, "tous supprimés : acompte 0 ; la liste vide est conservée (l'ancien acompte ne réapparaît pas)");

// Écritures : une par paiement, à sa date, au compte du mode, plafonnées au TTC, triées par date
c = cmd({ paiements: [{ id: "a", date: "2026-11-15", montant: 50000, mode: "mobile_money" }, { id: "b", date: "2026-11-11", montant: 60000, mode: "especes" }, { id: "c", date: "2026-11-12", montant: 30000, mode: "virement" }] });
let e = P.ecritures(c);
eq(e.map((x) => [x.id, x.date, x.compte, x.journal, x.montant]), [["b", "2026-11-11", "571000", "CA", 60000], ["c", "2026-11-12", "521000", "BQ", 30000], ["a", "2026-11-15", "552000", "BQ", 28000]], "tri par date, comptes 571 / 521 / 552, plafond : le dernier est ramené à 28 000 (118 000 − 90 000)");
eq([P.total(c), P.verse(c), P.reste(c)], [140000, 118000, 0], "versé plafonné au TTC (140 000 saisis dans les données, 118 000 retenus)");
c = cmd({ paiements: [{ id: "n", date: "2026-11-11", montant: 30000, mode: "nature" }, { id: "m", date: "2026-11-12", montant: 20000, mode: "mobile_money" }] });
eq([P.nature(c), P.ecritures(c)[0].compte, P.ecritures(c)[0].journal], [30000, "471000", "OD"], "règlement en nature : 30 000, compte d'attente 471 (pas la trésorerie)");
eq(P.ecritures(cmd({ ttc: 0, acompte: 50 })), [], "commande à 0 : aucune écriture"); eq(P.ecritures(cmd({ acompte: 0 })), [], "aucun paiement : aucune écriture");
e = P.ecritures(cmd({ acompte: 118000 })); eq([e.length, e[0].mode, e[0].compte, e[0].estimee, e[0].date], [1, "inconnu", "552000", true, "2026-11-10"], "ancienne commande : une écriture « mode non précisé » (552, comme avant), date de la vente, marquée estimée");
// Totaux par mode
const pm = P.parMode([c, cmd({ id: "c2", paiements: [{ id: "z", date: "2026-11-13", montant: 10000, mode: "especes" }, { id: "y", date: "2026-11-14", montant: 5000, mode: "mobile_money" }] })]);
eq([pm.nature, pm.mobile_money, pm.especes, pm.virement], [30000, 25000, 10000, 0], "totaux par mode sur deux commandes");
ok(P.dateOk("2026-02-28") && !P.dateOk("2026-02-29") && P.dateOk("2028-02-29"), "dates : 28 février valide, 29 février 2026 invalide, 29 février 2028 valide (bissextile)");
console.log("Journal des paiements : " + n + " contrôles passés.");
