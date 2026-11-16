// SANIX CRM Pro : modèle de financement (calculs purs, sans navigateur). node financement_test.js
const { calc } = require("../shared/financement.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= (tol == null ? 1e-6 : tol), `${m} (obtenu ${a}, attendu ${b})`);

// Cas d'école : 12 clients/an à 1 000 000, aucune croissance, aucun coût, sauf 100 000 de charges fixes par mois
const base = () => Object.assign(calc.defauts({}), {
  clientsAn1: 12, prixLicence: 1000000, hausseAn: 0, maintenancePct: 0, servicesPct: 0, baseInstallee: 0, delaiEncaissement: 0, retentionPct: 100,
  croiss: [0, 0, 0, 0], croissSans: [0, 0, 0, 0], directsPct: 0, commissionPct: 0, iaMensuel: 0, marketingPct: 0, marketingMin: 0, marketingBoost: 0,
  fixesMensuels: 100000, chargesSocialesPct: 0, augmentationSalairesPct: 0, impotPct: 0, tresoDepart: 0, postes: [], margeSecuritePct: 0 });

console.log("▶ Ventes et trésorerie");
let h = base(), s = calc.simuler(h, "avec", {});
near(s.annees[0].ca, 12e6, 1e-3, "CA année 1 = 12 clients × 1 000 000");
near(s.annees[0].opex, 1.2e6, 1e-3, "charges année 1 = 12 × 100 000");
near(s.tresoFin, 60 * (1e6 - 1e5), 1e-2, "trésorerie à 60 mois = somme des flux (aucun impôt, aucune dette)");
near(s.annees[0].clients, 12, 1e-9, "12 nouveaux clients la 1re année");

console.log("▶ Croissance, prix, maintenance");
h = base(); h.croiss = [100, 0, 0, 0]; h.hausseAn = 10;
s = calc.simuler(h, "avec", {});
near(s.annees[1].clients, 24, 1e-9, "année 2 : +100 % de nouveaux clients");
near(s.annees[1].lic, 24 * 1.1e6, 1e-2, "année 2 : prix +10 %");
h = base(); h.maintenancePct = 12; h.baseInstallee = 10e6; h.retentionPct = 100;
s = calc.simuler(h, "avec", {});
near(s.mois[0].maint, 10e6 * 0.12 / 12, 1e-6, "maintenance du mois 1 = 12 % / 12 de la base installée");
ok(s.mois[1].maint > s.mois[0].maint, "la maintenance augmente avec les licences vendues");
h = base(); h.retentionPct = 50; h.maintenancePct = 12; h.baseInstallee = 10e6; h.clientsAn1 = 0;
s = calc.simuler(h, "avec", {}); near(s.mois[12].maint / s.mois[0].maint, 0.5, 1e-9, "rétention 50 % : la base de maintenance est divisée par 2 en un an");

console.log("▶ Point mort");
h = base(); s = calc.simuler(h, "avec", {}); ok(s.pointMort === 0, "rentable dès le premier mois : point mort au mois 0");
h = base(); h.fixesMensuels = 2000000; s = calc.simuler(h, "avec", {}); ok(s.pointMort === null, "jamais rentable : pas de point mort");
h = base(); h.fixesMensuels = 1500000; h.croiss = [100, 0, 0, 0]; s = calc.simuler(h, "avec", {}); ok(s.pointMort === 12, "le CA double à l'année 2 et passe au-dessus des charges : point mort au mois 12");
h = base(); h.fixesMensuels = 1500000; h.croiss = [100, -80, 0, 0]; s = calc.simuler(h, "avec", {}); ok(s.pointMort === null, "rentable puis de nouveau déficitaire : pas de point mort durable");

console.log("▶ Délai d'encaissement");
h = base(); h.delaiEncaissement = 2; h.clientsAn1 = 12; h.croiss = [0, 0, 0, 0];
s = calc.simuler(h, "avec", {}); near(s.mois[5].recu, s.mois[3].ca, 1e-9, "l'encaissement a 2 mois de retard");

console.log("▶ Salaires et plan sans financement");
h = base(); h.postes = [{ id: "a", nom: "En place", nb: 1, cout: 500000, debut: 0, finance: false }, { id: "b", nom: "Recruté", nb: 2, cout: 300000, debut: 6, finance: true }];
let av = calc.simuler(h, "avec", {}), sa = calc.simuler(h, "sans", {});
near(av.mois[0].sal, 500000, 1e-6, "avec : seul le poste en place le mois 0");
near(av.mois[6].sal, 500000 + 600000, 1e-6, "avec : les recrues financées arrivent au mois 6");
near(sa.mois[6].sal, 500000, 1e-6, "sans financement : aucune embauche financée");
h.chargesSocialesPct = 20; near(calc.simuler(h, "sans", {}).mois[0].sal, 600000, 1e-6, "charges sociales de 20 %");
h.augmentationSalairesPct = 10; near(calc.simuler(h, "sans", {}).mois[12].sal, 660000, 1e-6, "augmentation annuelle des salaires au 13e mois");

console.log("▶ Impôt avec report des pertes");
h = base(); h.fixesMensuels = 0; h.impotPct = 25; h.clientsAn1 = 0; h.baseInstallee = 0;
h.postes = [{ id: "x", nom: "x", nb: 1, cout: 1000000, debut: 0, finance: false }]; h.clientsAn1 = 24;   // ventes 2 000 000 / mois, salaires 1 000 000
s = calc.simuler(h, "sans", {}); near(s.mois[0].impot, 250000, 1e-6, "25 % de 1 000 000 de bénéfice");
h.postes[0].cout = 3000000; h.postes[0].debut = 0; s = calc.simuler(h, "sans", {});
ok(s.mois[0].impot === 0 && s.mois[0].ebitda < 0, "perte : pas d'impôt");
h = base(); h.fixesMensuels = 0; h.impotPct = 25; h.clientsAn1 = 24; h.postes = [{ id: "x", nom: "x", nb: 1, cout: 2000000, debut: 0, finance: false }];
h.postes[0].debut = 0; s = calc.simuler(h, "sans", {});   // ventes 2 M, salaire 2 M : résultat nul
near(sum(s.mois, "impot"), 0, 1e-6, "résultat nul : aucun impôt");
function sum(a, k) { return a.reduce((t, x) => t + x[k], 0); }

console.log("▶ Dette : échéancier");
h = base(); h.clientsAn1 = 120; h.fixesMensuels = 0;
s = calc.simuler(h, "avec", { dette: { montant: 12e6, taux: 12, duree: 24, differe: 6 } });
near(sum(s.mois, "princ"), 12e6, 1e-3, "le capital est entièrement remboursé");
near(s.detteRestante, 0, 1e-3, "plus de dette à la fin");
near(s.mois[1].interet, 12e6 * 0.01, 1e-6, "intérêt du 1er mois = 1 % du capital");
ok(s.mois[6].princ === 0 && s.mois[7].princ > 0, "différé de 6 mois : capital remboursé à partir du mois 7");
near(s.mois[7].princ, 12e6 / 18, 1e-6, "amortissement linéaire sur les 18 mois restants");
near(s.mois[24].princ > 0 ? 1 : 0, 1, 0, "dernière échéance au mois 24"); ok(s.mois[25].princ === 0, "rien après l'échéance finale");

console.log("▶ Dimensionnement du besoin");
h = base(); h.fixesMensuels = 2000000; h.clientsAn1 = 12;   // charges 24 M/an pour 12 M de CA : déficit constant
let d = calc.dimensionner(h, "subvention");
ok(d.sim.tresoMin >= -0.5, "la trésorerie ne passe jamais sous zéro avec l'apport");
const sansMarge = calc.simuler(h, "avec", { subvention: d.xMin - 1000 });
ok(sansMarge.tresoMin < -0.5, "avec 1 000 de moins, la trésorerie passe sous zéro : le montant est bien le minimum");
near(d.xMin, -calc.simuler(h, "avec", {}).tresoMin, 1e-3, "subvention : besoin = point bas de trésorerie sans apport");
h.margeSecuritePct = 20; d = calc.dimensionner(h, "subvention"); near(d.montant, d.xMin * 1.2, 1e-6, "marge de sécurité de 20 %");
h = base(); h.fixesMensuels = 2000000; h.margeSecuritePct = 0; let dd = calc.dimensionner(h, "dette");
ok(dd.viable || !dd.viable, "dimensionnement dette terminé"); ok(dd.sim.tresoMin >= -0.5 || !dd.viable, "dette : trésorerie couverte ou montage déclaré non viable");
h = base(); h.margeSecuritePct = 0; ok(calc.dimensionner(h, "capital").montant === 0, "plan bénéficiaire : aucun apport nécessaire");

console.log("▶ Capital : valorisation, dilution, rendement");
h = base(); h.fixesMensuels = 2000000; h.margeSecuritePct = 0; h.preMoney = 30e6; h.multSortie = 2;
d = calc.dimensionner(h, "capital"); let ind = calc.indicateurs(h, d);
near(ind.equity.part, d.montant / (30e6 + d.montant), 1e-12, "part cédée = apport / (valorisation + apport)");
const a5 = d.sim.annees[4]; near(ind.equity.valeurSortie, 2 * a5.ca + d.sim.tresoFin, 1e-3, "valeur de sortie = 2 × CA an 5 + trésorerie");
near(ind.equity.moic, ind.equity.produit / d.montant, 1e-9, "multiple = produit de sortie / mise");
if (ind.equity.moic > 0) near(Math.pow(1 + ind.equity.tri, 5), ind.equity.moic, 1e-9, "TRI cohérent avec le multiple sur 5 ans");
h.preMoney = null; h.multEntree = 2; near(calc.preMoney(h, 10e6), 20e6, 0, "valorisation automatique = 2 × CA de l'année 1");

console.log("▶ Comparaison complète (valeurs par défaut)");
const D = calc.defauts({ commandes12m: 9, prixMoyen: 2000000, caTotal: 40e6, commissionDefaut: 10 });
ok(D.clientsAn1 === 9 && D.prixLicence === 2000000 && D.baseInstallee === 40e6, "valeurs initiales lues dans le CRM");
const C = calc.comparer(D);
ok(C.options.length === 4 && C.options.map((o) => o.opt).join() === "capital,dette,subvention,mix", "quatre options comparées");
ok(C.options.every((o) => !o.viable || o.sim.tresoMin >= -0.5), "chaque option viable couvre le besoin");
ok(C.sans.annees[4].ca < C.avec0.annees[4].ca, "le plan de croissance dépasse l'activité sans financement");
ok(C.recommande >= C.besoin, "montant recommandé ≥ besoin");
const mix = C.options[3]; near(mix.struct.equity + mix.struct.dette.montant + mix.struct.subvention, mix.montant, 1e-6, "le mix répartit le montant total");
if (C.emplois) near(C.emplois.depenses - C.emplois.recu - C.emplois.tresoDepart, C.besoin, 1, "emplois : dépenses − encaissements = besoin");
const nan = JSON.stringify(C).includes("null") ? (JSON.stringify(C).match(/NaN|Infinity/g) || []) : [];
ok(!/NaN|Infinity/.test(JSON.stringify(C.options.map((o) => o.ind))) , "aucun résultat invalide (NaN) dans les indicateurs");
console.log("\nTous les contrôles du modèle de financement sont passés.");
