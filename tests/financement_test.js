// SANIX CRM Pro : modèle de financement (calculs purs, sans navigateur). node financement_test.js
const { calc } = require("../shared/financement.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= (tol == null ? 1e-6 : tol), `${m} (obtenu ${a}, attendu ${b})`);

// Cas d'école : 12 clients/an à 1 000 000, aucune croissance, aucun coût, sauf 100 000 de charges fixes par mois
const base = () => Object.assign(calc.defauts({}), {
  clientsAn1: 12, prixLicence: 1000000, hausseAn: 0, maintenancePct: 0, servicesPct: 0, baseInstallee: 0, delaiEncaissement: 0, retentionPct: 100,
  croiss: [0, 0, 0, 0], croissSans: [0, 0, 0, 0], directsPct: 0, commissionPct: 0, iaMensuel: 0, marketingPct: 0, marketingMin: 0, marketingBoost: 0,
  fixesMensuels: 100000, chargesSocialesPct: 0, augmentationSalairesPct: 0, impotPct: 0, tresoDepart: 0, postes: [], margeSecuritePct: 0,
  supabaseFixeUsd: 0, supabaseProjetUsd: 0, projetsBase: 0, clientsDepart: 0, vercelSiegeUsd: 0, githubSiegeUsd: 0, iaMensuelUsd: 0, fraisPaiementPct: 0 });   // coûts techniques neutralisés : les cas ci-dessous ne testent que le reste

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
console.log("▶ Optimisation");
const Dop = calc.defauts({ commandes12m: 10, prixMoyen: 1059543, caTotal: 12.5e6, commissionDefaut: 10 });
const O = calc.optimiser(Dop), B = calc.evaluer(Dop);
near(O.base.besoin, B.besoin, 1e-6, "situation de départ = évaluation du plan");
ok(O.leviers.length === 13, "treize leviers applicables avec les valeurs par défaut");
ok(O.leviers.every((l, i) => i === 0 || O.leviers[i - 1].dTreso >= l.dTreso), "leviers classés du plus au moins utile (trésorerie an 5)");
O.leviers.forEach((l) => { const lv = calc.LEVIERS.filter((x) => x.id === l.id)[0]; const m = calc.evaluer(Object.assign({}, Dop, lv.f(Dop))); near(l.m.tresoFin, m.tresoFin, 1e-6, "levier « " + l.id + " » : résultats = plan recalculé avec le levier"); });
ok(O.leviers.filter((l) => l.cat === "Ventes").every((l) => l.dEbitda5 > 0), "chaque levier de ventes améliore l'EBITDA");
const lv = (id) => O.leviers.filter((l) => l.id === id)[0];
near(lv("delai").dEbitda5, 0, 1e-6, "encaisser plus vite : aucun effet sur l'EBITDA…"); ok(lv("delai").dTreso > 0, "…mais améliore la trésorerie");
ok(lv("embauches").arbitrer && lv("etaler").arbitrer && lv("marketing").arbitrer && !lv("prix").arbitrer, "les leviers qui touchent la croissance sont marqués « à arbitrer »");
const sc = O.seuils.clients, rentable = (hh) => calc.simuler(hh, "avec", {}).pointMort !== null;
ok(!sc.deja && sc.valeur > Dop.clientsAn1, "seuil de clients au-dessus de la situation actuelle");
ok(rentable(Object.assign({}, Dop, { clientsAn1: sc.valeur })) && !rentable(Object.assign({}, Dop, { clientsAn1: sc.valeur * 0.98 })), "seuil de clients : rentable au seuil, pas 2 % en dessous");
const sp = O.seuils.prix; ok(rentable(Object.assign({}, Dop, { prixLicence: sp.valeur })) && !rentable(Object.assign({}, Dop, { prixLicence: sp.valeur * 0.98 })), "seuil de prix : rentable au seuil, pas 2 % en dessous");
const E = O.combine.etapes; ok(E.length > 0, "un plan combiné est proposé");
ok(E.every((e, i) => i === 0 || e.m.tresoFin > E[i - 1].m.tresoFin), "chaque étape améliore la trésorerie");
const iArb = E.findIndex((e) => e.arbitrer); ok(iArb < 0 || E.slice(iArb).every((e) => e.arbitrer), "leviers sûrs d'abord, leviers « à arbitrer » ensuite");
near(calc.evaluer(O.combine.h).tresoFin, O.combine.final.tresoFin, 1e-6, "les hypothèses finales redonnent le résultat annoncé");
ok(O.combine.rentable === (O.combine.final.pointMort !== null), "plan combiné : indicateur de rentabilité cohérent");
const sain = calc.optimiser(base()); ok(sain.combine.etapes.length === 0, "plan déjà rentable et autofinancé : aucun levier à enchaîner");
const h0 = base(); h0.retentionPct = 100; h0.postes = []; h0.marketingBoost = 0; h0.fixesMensuels = 2000000;
const O0 = calc.optimiser(h0); ok(!O0.leviers.some((l) => ["retention", "embauches", "etaler", "marketing"].includes(l.id)), "leviers sans effet possible : non proposés");
const hz = base(); hz.directsPct = 60; hz.commissionPct = 60; hz.fixesMensuels = 2000000; ok(calc.seuil(hz, "clientsAn1") === null, "seuil hors de portée (coûts proportionnels > 100 %) : null, pas de boucle infinie");

console.log("▶ Bilan et flux : l'équilibre comptable");
const cas = [[{}, "sans apport"], [{ equity: 50e6 }, "capital"], [{ subvention: 30e6 }, "subvention"], [{ dette: { montant: 40e6, taux: 12, duree: 48, differe: 12 } }, "dette"],
  [{ equity: 20e6, subvention: 10e6, dette: { montant: 30e6, taux: 10, duree: 36, differe: 6 } }, "mix"]];
[0, 1, 3].forEach((delai) => cas.forEach(([fin, nom]) => ["avec", "sans"].forEach((plan) => {
  const hb = calc.defauts({ commandes12m: 10, prixMoyen: 1059543, caTotal: 12.5e6 }); hb.delaiEncaissement = delai; hb.tresoDepart = 5e6; hb.postes[0].debut = 0;
  const sm = calc.simuler(hb, plan, fin), ecart = Math.max.apply(null, sm.annees.map((x) => Math.abs(x.bilan.actif - x.bilan.passif)));
  ok(ecart < 1, `bilan équilibré (délai ${delai} mois, ${nom}, plan ${plan}) : écart max ${ecart.toExponential(1)}`);
  const f = Math.max.apply(null, sm.annees.map((x) => Math.abs(x.fExpl + x.fFin - x.flux))); ok(f < 1, `flux d'exploitation + de financement = flux total (${nom}, délai ${delai})`);
})));
h = base(); h.delaiEncaissement = 2; s = calc.simuler(h, "avec", {});
near(s.annees[0].bilan.creances, s.mois[11].ca + s.mois[10].ca, 1e-6, "créances clients = ventes des 2 derniers mois (délai de 2 mois)");
h = base(); h.delaiEncaissement = 0; s = calc.simuler(h, "avec", {}); near(s.annees[0].bilan.creances, 0, 1e-9, "encaissement immédiat : aucune créance");
h = base(); h.tresoDepart = 7e6; s = calc.simuler(h, "avec", { equity: 10e6 });
near(s.annees[0].bilan.capitaux, 7e6 + 10e6 + sum(s.mois.slice(0, 12), "ebitda") /* ouverture sans créance (délai 0), intérêts et impôts nuls */, 1e-3, "capitaux propres = ouverture + apport + résultat cumulé");
near(s.annees[0].arr, s.mois[11].maint * 12, 1e-9, "revenu récurrent annuel = maintenance du dernier mois × 12");

console.log("▶ Traction : chiffres réels");
const NOW = "2026-11-16", day = (n) => new Date(Date.parse(NOW) - n * 864e5).toISOString().slice(0, 10);
const cmds = [
  { client: "Alpha SARL", date: day(10), statut: "livree", typeLicence: "Perpetuelle", htNet: 1e6, ttc: 1.18e6, acompte: 500000 },
  { client: "ALPHA sarl", date: day(200), statut: "confirmee", typeLicence: "Mensuelle", htNet: 2e6, ttc: 2.36e6, acompte: 2.36e6 },
  { client: "Bêta", date: day(120), statut: "en_cours", typeLicence: "Perpetuelle", htNet: 500000, ttc: 590000, acompte: 0 },
  { client: "Gamma", date: day(5), statut: "brouillon", htNet: 9e6, ttc: 9e6, acompte: 0 }, { client: "Delta", date: day(5), statut: "annulee", htNet: 9e6, ttc: 9e6, acompte: 0 },
  { client: "Epsilon", date: day(40), statut: "livree", typeLicence: "Perpetuelle", htNet: 100000, ttc: 100000, acompte: 150000 }];
let T = calc.analyserTraction(cmds, { now: NOW });
ok(T.lignes.length === 3 && T.tous.commandes === 4, "brouillons et commandes annulées exclus ; « Alpha SARL » et « ALPHA sarl » fusionnés (casse, accents)");
near(T.tous.factureHT, 3.6e6, 1e-6, "facturé HT total"); near(T.tous.factureTTC, 4.23e6, 1e-6, "facturé TTC total");
near(T.tous.encaisse, 500000 + 2.36e6 + 0 + 100000, 1e-6, "encaissé (versement supérieur au montant : plafonné au facturé)");
near(T.tous.creance, 680000 + 590000, 1e-6, "créances = facturé TTC − encaissé"); near(T.tous.taux, 2.96e6 / 4.23e6, 1e-9, "taux d'encaissement");
near(T.top1, 3e6 / 3.6e6, 1e-9, "concentration : 1er client"); near(T.tous.recurrent, 2e6, 1e-6, "revenu récurrent : seule la licence mensuelle est comptée");
near(T.tous.partRecurrent, 2e6 / 3.6e6, 1e-9, "part récurrente du facturé");
near(T.ages.j30, 680000, 1e-6, "créances de moins de 30 jours"); near(T.ages.j90, 0, 1e-6, "créances de 31 à 90 jours : aucune (Epsilon est soldé, Bêta a 120 jours)");
near(T.ages.plus, 590000, 1e-6, "créances de plus de 90 jours");
const cl = calc.cle("Alpha SARL"); T = calc.analyserTraction(cmds, { now: NOW, liens: { [cl]: { lie: true } } });
near(T.retraite.factureHT, 600000, 1e-6, "vue retraitée : sans la partie liée"); near(T.partLies, 3e6 / 3.6e6, 1e-9, "part du facturé venant de parties liées"); ok(T.nbLies === 1, "une partie liée");
T = calc.analyserTraction(cmds, { now: NOW, liens: { [calc.cle("Bêta")]: { nature: true }, [calc.cle("epsilon")]: { nature: true } } });
near(T.encaisseNature, 100000, 1e-6, "règlement en nature : montant isolé"); near(T.encaisseMonetaire, 2.86e6, 1e-6, "encaissé monétaire = encaissé − règlements en nature");
const a12 = calc.analyserTraction([{ client: "X", date: "2025-01-15", statut: "livree", htNet: 1e6, ttc: 1e6, acompte: 1e6 }, { client: "X", date: day(30), statut: "livree", htNet: 3e6, ttc: 3e6, acompte: 3e6 }], { now: NOW });
near(a12.tous.ht12, 3e6, 1e-6, "12 derniers mois : la vente d'il y a plus d'un an est écartée"); near(a12.tous.prixMoyen, 3e6, 1e-6, "prix moyen sur 12 mois");
ok(calc.analyserTraction([], { now: NOW }).tous.taux === 0 && calc.analyserTraction(null).lignes.length === 0, "aucune commande : aucun calcul invalide");

console.log("▶ Économie unitaire");
h = base(); h.hausseAn = 0; h.directsPct = 10; h.commissionPct = 10; h.servicesPct = 20; h.maintenancePct = 12; h.retentionPct = 100; h.prixLicence = 1e6; h.marketingMin = 500000; h.marketingPct = 0; h.clientsAn1 = 12; h.baseInstallee = 0;
h.postes = [{ id: "c", nom: "Commercial", nb: 1, cout: 400000, debut: 0, finance: false, acquisition: true }, { id: "d", nom: "Dev", nb: 2, cout: 500000, debut: 0, finance: false }]; h.chargesSocialesPct = 0;
s = calc.simuler(h, "avec", {}); let U = calc.economieUnitaire(h, s)[0];
near(U.margeInit, 1e6 * 0.8 + 1e6 * 0.2 * 0.9, 1e-6, "marge de la 1re vente = prix × (1 − coûts directs − commission) + services");
near(U.ltv, 980000 + 4 * 1e6 * 0.12 * 0.9, 1e-6, "valeur d'un client sur 5 ans = marge initiale + 4 ans de maintenance");
near(U.cac, (12 * 500000 + 12 * 400000) / 12, 1e-6, "coût d'acquisition = (marketing + équipe d'acquisition) / nouveaux clients");
near(U.ltvCac, U.ltv / U.cac, 1e-12, "rapport valeur client / coût d'acquisition"); ok(U.retour === 0, "marge de la 1re vente ≥ coût d'acquisition : retour immédiat");
h.marketingMin = 5000000; U = calc.economieUnitaire(h, calc.simuler(h, "avec", {}))[0]; ok(U.retour > 0, "coût d'acquisition > marge initiale : délai de retour en mois"); near(U.retour, (U.cac - U.margeInit) / (1e6 * 0.12 * 0.9 / 12), 1e-6, "délai de retour = écart / maintenance mensuelle");
h.clientsAn1 = 0; U = calc.economieUnitaire(h, calc.simuler(h, "avec", {}))[0]; ok(U.cac === null && U.ltvCac === null, "aucun nouveau client : indicateurs non calculés (null)");
ok(calc.economieUnitaire(base(), calc.simuler(base(), "avec", {}))[0].caParSalarie === null, "sans salarié : productivité non calculée (null)");

console.log("▶ Tour de table");
h = base(); h.esopPct = 10; let R = calc.tourDeTable(h, 0.2);
near(sum(R, "apres"), 1, 1e-12, "après l'apport, le total fait 100 %"); near(R[0].apres, 0.7, 1e-12, "un fondateur à 100 % passe à 70 % (20 % investisseur, 10 % pool)");
h.associes = [{ id: "1", nom: "A", part: 60 }, { id: "2", nom: "B", part: 40 }, { id: "3", nom: "Zéro", part: 0 }]; h.esopPct = 0; R = calc.tourDeTable(h, 0.25);
near(R[0].apres, 0.45, 1e-12, "60 % → 45 % après dilution de 25 %"); ok(R.length === 3, "associé à 0 % ignoré (A, B, investisseur)"); near(sum(R, "avant"), 1, 1e-12, "avant l'apport : 100 %");
h.associes = [{ id: "1", nom: "A", part: 30 }, { id: "2", nom: "B", part: 20 }]; near(calc.tourDeTable(h, 0)[0].avant, 0.6, 1e-12, "parts normalisées à 100 % (30 et 20 → 60 % et 40 %)");

console.log("▶ Coûts techniques : Supabase, Vercel, GitHub, Anthropic");
const tech = () => { const t = base(); Object.assign(t, { usdFcfa: 600, fraisPaiementPct: 0, supabaseFixeUsd: 25, supabaseProjetUsd: 10, projetsBase: 1, projetParClient: true, clientsDepart: 8, vercelSiegeUsd: 20, githubSiegeUsd: 4, githubSeuil: 3, iaMensuelUsd: 200, iaCroissanceAn: 25, clientsAn1: 0, retentionPct: 100, fixesMensuels: 0,
  postes: [{ id: "f", nom: "Fondateur", nb: 1, cout: 0, debut: 0, finance: false }] }); return t; };
h = tech(); s = calc.simuler(h, "avec", {});
near(s.mois[0].supa, (25 + 8 * 10) * 600, 1e-6, "Supabase : abonnement 25 $ + 8 projets clients à 10 $ (le 1er projet est inclus) = 105 $ au taux de 600");
near(s.mois[0].vercel, 20 * 600, 1e-6, "Vercel : 1 poste technique (le fondateur) à 20 $"); near(s.mois[0].github, 0, 1e-9, "GitHub : gratuit sous 3 postes");
near(s.mois[0].ia, 200 * 600, 1e-6, "Anthropic : 200 $ par mois"); near(s.mois[12].ia, 250 * 600, 1e-6, "Anthropic : +25 % la 2e année");
near(s.mois[0].infra, s.mois[0].supa + s.mois[0].vercel + s.mois[0].github, 1e-9, "infrastructure = Supabase + Vercel + GitHub");
near(s.mois[0].ebitda, -(s.mois[0].infra + s.mois[0].ia), 1e-6, "sans vente ni autre charge, l'EBITDA est l'opposé des coûts techniques");
near(s.annees[0].infra, sum(s.mois.slice(0, 12), "infra"), 1e-6, "cumul annuel de l'infrastructure");
h = tech(); h.postes.push({ id: "d", nom: "Dév", nb: 2, cout: 0, debut: 0, finance: true, tech: true }); s = calc.simuler(h, "avec", {});
near(s.mois[0].vercel, 3 * 20 * 600, 1e-6, "3 postes techniques (fondateur + 2 développeurs) : Vercel × 3"); near(s.mois[0].github, 3 * 4 * 600, 1e-6, "3 postes : GitHub Team à 4 $ par poste");
near(calc.simuler(h, "sans", {}).mois[0].github, 0, 1e-9, "plan sans financement : les développeurs financés n'existent pas, GitHub reste gratuit");
h = tech(); h.clientsAn1 = 12; s = calc.simuler(h, "avec", {});
near(s.mois[0].parc, 9, 1e-9, "parc hébergé : 8 clients + 1 nouveau le 1er mois"); near(s.mois[11].parc, 20, 1e-9, "parc : 8 + 12 nouveaux clients");
near(s.mois[11].supa, (25 + 20 * 10) * 600, 1e-6, "chaque nouveau client ajoute un projet Supabase à 10 $"); near(s.annees[0].parcFin, 20, 1e-9, "clients hébergés en fin d'année");
h = tech(); h.retentionPct = 50; s = calc.simuler(h, "avec", {}); near(s.mois[11].parc, 4, 1e-9, "rétention 50 % : le parc hébergé est divisé par 2 en un an"); near(s.mois[11].supa, (25 + 4 * 10) * 600, 1e-6, "les clients perdus ne coûtent plus de projet");
h = tech(); h.projetParClient = false; h.clientsAn1 = 12; s = calc.simuler(h, "avec", {}); near(s.mois[11].supa, 25 * 600, 1e-6, "clients regroupés (multi-locataire) : coût Supabase constant");
h = tech(); h.fraisPaiementPct = 10; s = calc.simuler(h, "avec", {}); near(s.mois[0].supa, 105 * 600 * 1.1, 1e-6, "frais de change et de carte de 10 % appliqués"); near(s.mois[0].ia, 200 * 600 * 1.1, 1e-6, "… y compris sur Anthropic");
h = tech(); h.supabaseFixeUsd = 0; h.supabaseProjetUsd = 0; h.projetsBase = 0; near(calc.simuler(h, "avec", {}).mois[0].supa, 0, 1e-9, "aucun projet : aucun coût Supabase");
const bz = calc.simuler(tech(), "avec", { equity: 80e6 }), eqz = Math.max.apply(null, bz.annees.map((x) => Math.abs(x.bilan.actif - x.bilan.passif))); ok(eqz < 1, "le bilan reste équilibré avec les coûts techniques");
h = tech(); h.prixLicence = 1e6; h.hausseAn = 0; h.directsPct = 10; h.commissionPct = 10; h.servicesPct = 20; h.maintenancePct = 12; h.clientsAn1 = 12; h.marketingMin = 0; h.marketingPct = 0;
U = calc.economieUnitaire(h, calc.simuler(h, "avec", {}))[0];
near(U.heberg, 10 * 12 * 600, 1e-6, "hébergement d'un client = 10 $ × 12 mois × taux"); near(U.maintNette, 108000 - 72000, 1e-6, "maintenance nette de l'hébergement : 108 000 − 72 000");
near(U.ltv, 980000 + 4 * 36000, 1e-6, "valeur d'un client : la maintenance nette de l'hébergement"); h.projetParClient = false; near(calc.economieUnitaire(h, calc.simuler(h, "avec", {}))[0].heberg, 0, 1e-9, "clients regroupés : pas d'hébergement par client");
h = tech(); h.clientsAn1 = 12; h.prixLicence = 1e6; const sx = calc.simuler(h, "avec", {}), ux = calc.economieUnitaire(h, sx)[0];
near(ux.margeBrute, (sx.annees[0].ca - sx.annees[0].directs - sx.annees[0].commissions - sx.annees[0].infra) / sx.annees[0].ca, 1e-12, "marge brute : l'infrastructure est un coût de service");
const Dh = calc.defauts({ commandes12m: 10, prixMoyen: 1059543, caTotal: 12.5e6, clientsFactures: 8, usdFcfa: 0 });
ok(Dh.clientsDepart === 8 && Dh.usdFcfa === 595 && Dh.projetParClient === true, "valeurs initiales : 8 clients hébergés lus dans le CRM, taux de 595 par défaut");
ok(calc.defauts({ usdFcfa: 580 }).usdFcfa === 580, "le taux saisi dans le Pilotage est repris");
const Ch = calc.comparer(Dh); ok(!Ch.emplois || Ch.emplois.lignes.some((l) => l[0].indexOf("Infrastructure technique") === 0 && l[1] > 0) , "utilisation des fonds : ligne « Infrastructure technique »");
const Oh = calc.optimiser(Dh); const lh = Oh.leviers.filter((l) => l.id === "hebergement")[0]; ok(lh && lh.dEbitda5 > 0 && !lh.arbitrer, "levier « regrouper les clients » : améliore l'EBITDA, sans contrepartie cachée");
const li = Oh.leviers.filter((l) => l.id === "ia")[0]; ok(li && li.dEbitda5 > 0 && li.arbitrer, "levier « réduire l'IA » : améliore l'EBITDA mais à arbitrer (qualité)");

console.log("▶ Logiciels : licence perpétuelle, abonnement annuel, abonnement mensuel");
const prod = (o) => Object.assign({ id: "a", nom: "A", mode: "perpetuelle", prixLicence: 1e6, prixAnnuel: 120000, prixMensuel: 8000, initial: 200000, maintPct: 12, part: 100 }, o);
const bp = (produits, extra) => { const t = base(); Object.assign(t, { clientsAn1: 12, hausseAn: 0, retentionPct: 100, commissionPct: 10, baseInstallee: 0, produits }, extra || {}); return t; };
h = bp([prod({})]); s = calc.simuler(h, "avec", {});
near(s.mois[0].lic, 1e6, 1e-6, "perpétuelle : 1 licence par mois à 1 000 000"); near(s.mois[0].serv, 200000, 1e-6, "perpétuelle : frais initiaux de 200 000 par client");
near(s.mois[0].maint, 0, 1e-9, "perpétuelle : pas de maintenance le mois de la vente"); near(s.mois[1].maint, 1e6 * 0.12 / 12, 1e-6, "perpétuelle : maintenance 12 %/an sur la licence vendue le mois précédent");
near(s.mois[0].commissions, 1e5, 1e-6, "perpétuelle : commission de 10 % sur la licence"); near(s.mois[0].ca, 1.2e6, 1e-6, "perpétuelle : CA = licence + frais initiaux");
h = bp([prod({ mode: "annuelle", initial: 50000 })]); s = calc.simuler(h, "avec", {});
near(s.mois[0].abo, 10000, 1e-6, "annuel : 120 000 par an = 10 000 par mois dès la signature"); near(s.mois[5].abo, 6 * 10000, 1e-6, "annuel : 6 abonnés au 6e mois");
near(s.mois[0].lic, 0, 1e-9, "annuel : pas de licence perpétuelle"); near(s.mois[3].serv, 50000, 1e-6, "annuel : frais initiaux de mise en exploitation à chaque nouveau client");
near(s.mois[0].commissions, 12000, 1e-6, "annuel : commission de 10 % sur la 1re année d'abonnement (120 000), à la signature"); near(s.mois[0].maint, 0, 1e-9, "annuel : la maintenance est comprise dans la redevance");
h = bp([prod({ mode: "mensuelle", initial: 30000 })]); s = calc.simuler(h, "avec", {});
near(s.mois[0].abo, 8000, 1e-6, "mensuel : 8 000 par mois et par abonné"); near(s.mois[11].abo, 12 * 8000, 1e-6, "mensuel : 12 abonnés à la fin de la 1re année");
near(s.mois[0].commissions, 9600, 1e-6, "mensuel : commission sur 12 mois de redevance (96 000)"); near(s.mois[4].serv, 30000, 1e-6, "mensuel : frais initiaux");
near(s.annees[0].abo, 8000 * 78, 1e-6, "mensuel : somme des abonnements de l'année (1+2+…+12 abonnés)");
h = bp([prod({ mode: "annuelle", initial: 0 })], { retentionPct: 50 }); s = calc.simuler(h, "avec", {});
const rm = Math.pow(0.5, 1 / 12); let ab = 0; for (let t = 0; t < 24; t++) { ab = ab * rm + 1; if (t === 23) near(s.mois[23].abo, ab * 10000, 1e-6, "rétention 50 % : les abonnés s'érodent mois après mois"); }
h = bp([prod({ id: "a", mode: "perpetuelle", initial: 200000 }), prod({ id: "b", nom: "B", mode: "annuelle", initial: 50000 })].map((x) => Object.assign(x, { part: 50 }))); s = calc.simuler(h, "avec", {});
near(s.mois[0].lic, 0.5e6, 1e-6, "mix 50/50 : la moitié des clients achète la licence"); near(s.mois[0].serv, 0.5 * 200000 + 0.5 * 50000, 1e-6, "mix : frais initiaux pondérés"); near(s.mois[0].abo, 0.5 * 10000, 1e-6, "mix : abonnement de la moitié des clients");
near(s.mois[0].commissions, 0.1 * (0.5e6 + 0.5 * 120000), 1e-6, "mix : commissions sur licence et sur 1re année d'abonnement");
h = bp([prod({ id: "a", part: 30 }), prod({ id: "b", nom: "B", part: 20 }), prod({ id: "c", nom: "C", part: 0 })]); s = calc.simuler(h, "avec", {});
near(s.mois[0].lic, 1e6, 1e-6, "parts 30 et 20 ramenées à 100 % (le logiciel à 0 % est ignoré) : 12 clients × 1 M / 12"); ok(calc.produitsActifs(h).length === 2 && Math.abs(calc.produitsActifs(h)[0].part - 0.6) < 1e-12, "parts normalisées (60 % et 40 %)");
near(s.annees[0].produits[0].clients + s.annees[0].produits[1].clients, 12, 1e-9, "clients répartis entre les logiciels");
console.log("▶ Logiciels : cohérence avec l'ancien modèle et avec les totaux");
const hl = base(); Object.assign(hl, { clientsAn1: 12, retentionPct: 80, hausseAn: 5, commissionPct: 10, prixLicence: 1e6, servicesPct: 20, maintenancePct: 12, baseInstallee: 5e6, produits: [] });
const he = JSON.parse(JSON.stringify(hl)); he.produits = [{ id: "m", nom: "M", mode: "perpetuelle", prixLicence: 1e6, prixAnnuel: 0, prixMensuel: 0, initial: 200000, maintPct: 12, part: 100 }];
const sl = calc.simuler(hl, "avec", {}), se = calc.simuler(he, "avec", {});
ok(sl.mois.every((x, i) => Math.abs(x.ca - se.mois[i].ca) < 1e-6 && Math.abs(x.serv - se.mois[i].serv) < 1e-6 && Math.abs(x.maint - se.mois[i].maint) < 1e-6 && Math.abs(x.comm - se.mois[i].comm) < 1e-6), "sans logiciel renseigné = un logiciel unique équivalent : mêmes chiffres sur 60 mois");
ok(calc.produitsActifs(Object.assign({}, hl, { produits: [prod({ part: 0 })] }))[0].legacy === true, "tous les logiciels à 0 % : retour au produit moyen");
h = bp([prod({ id: "a", part: 50 }), prod({ id: "b", nom: "B", mode: "annuelle", part: 30 }), prod({ id: "c", nom: "C", mode: "mensuelle", part: 20 })], { retentionPct: 85, hausseAn: 4, clientsDepart: 3 });
s = calc.simuler(h, "avec", {});
ok(s.annees.every((a) => Math.abs(a.produits.reduce((t, x) => t + x.total, 0) - a.ca) < 1e-6 && Math.abs(a.produits.reduce((t, x) => t + x.clients, 0) - a.clients) < 1e-9), "chaque année : la somme des logiciels = chiffre d'affaires et clients");
ok(s.annees.every((a) => Math.abs(a.lic + a.serv + a.maint + a.abo - a.ca) < 1e-6), "CA = licences + frais initiaux + maintenance + abonnements");
near(s.annees[1].arr, (s.mois[23].maint + s.mois[23].abo) * 12, 1e-6, "revenu récurrent annualisé : maintenance + abonnements");
const eqp = Math.max.apply(null, [{}, { equity: 30e6 }, { dette: { montant: 20e6, taux: 10, duree: 36, differe: 6 } }].map((f) => Math.max.apply(null, calc.simuler(h, "avec", f).annees.map((x) => Math.abs(x.bilan.actif - x.bilan.passif))))); ok(eqp < 1, "le bilan reste équilibré avec des abonnements (délai d'encaissement, dette, apport)");
console.log("▶ Logiciels : valeur d'un client par contrat");
h = bp([prod({ id: "a", initial: 200000, part: 50 }), prod({ id: "b", nom: "B", mode: "annuelle", initial: 50000, part: 50 })], { directsPct: 10, commissionPct: 10 });
const ct = calc.contratsParLogiciel(h), ca = ct[0], cb = ct[1];
near(ca.margeInit, 1e6 * 0.8 + 200000 * 0.9, 1e-6, "perpétuelle : marge de la 1re vente"); near(ca.recBrut, 120000, 1e-6, "perpétuelle : maintenance annuelle brute"); near(ca.ltv, 980000 + 4 * 108000, 1e-6, "perpétuelle : valeur sur 5 ans (maintenance dès la 2e année)");
near(cb.margeInit, 50000 * 0.9 - 0.1 * 120000, 1e-6, "annuel : marge initiale = frais initiaux − commission sur la 1re année"); near(cb.recBrut, 120000, 1e-6, "annuel : redevance annuelle"); near(cb.ltv, 33000 + 5 * 108000, 1e-6, "annuel : valeur sur 5 ans (redevance dès la 1re année)");
const um = calc.economieUnitaire(h, calc.simuler(h, "avec", {}))[0]; near(um.ltv, 0.5 * ca.ltv + 0.5 * cb.ltv, 1e-6, "valeur d'un client = moyenne pondérée des logiciels");
const cm = calc.contratsParLogiciel(bp([prod({ mode: "mensuelle", initial: 0 })], { directsPct: 0, commissionPct: 0 }))[0]; near(cm.recBrut, 96000, 1e-6, "mensuel : 8 000 × 12 = 96 000 par an"); near(cm.ltv, 5 * 96000, 1e-6, "mensuel : 5 ans de redevance sans coût");
console.log("▶ Logiciels : valeurs initiales issues du catalogue et des ventes");
const cat = [{ id: "x", nom: "ImmoSuite ERP", typeLicence: "Perpetuelle", prixNum: 750000, prixMensuel: 75000 }, { id: "y", nom: "Le Grenier", typeLicence: "SaaS", prixNum: 400000, prixMensuel: 40000 }, { id: "z", nom: "Zed Pro", typeLicence: "Annuelle", prixNum: 500000, prixMensuel: 50000 }];
const pd = calc.produitsDefaut({ logiciels: cat, ventesLogiciel: [{ cle: calc.cle("immosuite erp"), n: 2, ht: 7.6e6 }, { cle: calc.cle("zed pro"), n: 1, ht: 500000 }, { cle: "inconnu", n: 5, ht: 1 }] });
ok(pd.length === 3 && pd[0].mode === "perpetuelle" && pd[1].mode === "mensuelle" && pd[2].mode === "annuelle", "mode de vente repris du catalogue (SaaS = mensuel)");
near(pd[0].prixLicence, 750000, 1e-6, "prix = prix du catalogue (la maintenance se calcule sur la licence, pas sur des factures qui peuvent contenir autre chose)"); near(pd[0].observe, 3.8e6, 1e-6, "prix moyen réellement facturé conservé pour comparaison"); near(pd[1].observe, 0, 1e-9, "logiciel jamais vendu : pas de prix observé");
near(pd[0].part + pd[2].part, 100, 0.11, "parts des ventes : 2/3 et 1/3 (les ventes d'un logiciel inconnu sont ignorées)"); near(pd[1].part, 0, 1e-9, "logiciel jamais vendu : 0 %");
near(pd[0].prixMensuel, 75000, 1e-6, "prix mensuel du catalogue"); near(pd[0].prixAnnuel, 750000, 1e-6, "prix annuel de départ = 10 mois de redevance (à fixer)"); near(pd[0].initial, 150000, 1e-6, "frais initiaux de départ = 20 % du prix du catalogue (à fixer)");
ok(calc.produitsDefaut({}).length === 0 && calc.defauts({}).produits.length === 0, "sans catalogue : aucun logiciel, ancien comportement");
const tl = calc.analyserTraction([{ client: "A", logiciel: "ImmoSuite ERP", date: "2026-11-01", statut: "livree", htNet: 3e6, ttc: 3e6, acompte: 3e6 }, { client: "B", logiciel: "immosuite erp", date: "2026-11-02", statut: "livree", htNet: 1e6, ttc: 1e6, acompte: 0 }, { client: "C", logiciel: "Zed Pro", date: "2026-11-03", statut: "livree", htNet: 1e6, ttc: 1e6, acompte: 0 }], { now: "2026-11-16" });
ok(tl.parLogiciel.length === 2 && tl.parLogiciel[0].n === 2 && tl.parLogiciel[0].ht === 4e6, "ventes par logiciel : casse ignorée, tri par chiffre d'affaires"); near(tl.topLogiciel, 4 / 5, 1e-9, "concentration par logiciel : 80 %");
console.log("▶ Logiciels : leviers et seuils avec plusieurs logiciels");
const hp = bp([prod({ id: "a", initial: 200000, part: 70 }), prod({ id: "b", nom: "B", mode: "annuelle", initial: 50000, part: 30 })], { fixesMensuels: 2000000, commissionPct: 10, directsPct: 4 });
const x2 = calc.scalePrix(hp, 2); near(x2.produits[0].prixLicence, 2e6, 1e-6, "doubler les prix : licence"); near(x2.produits[1].prixAnnuel, 240000, 1e-6, "… abonnement annuel"); near(x2.produits[1].prixMensuel, 16000, 1e-6, "… abonnement mensuel"); near(x2.produits[0].initial, 400000, 1e-6, "… frais initiaux");
const lp = calc.LEVIERS.filter((l) => l.id === "prix")[0].f(hp); ok(Object.keys(lp).join() === "prixLicence,produits" && lp.produits[1].prixAnnuel > hp.produits[1].prixAnnuel, "levier prix : modifie les logiciels");
const lm = calc.LEVIERS.filter((l) => l.id === "maintenance")[0].f(hp); near(lm.produits[0].maintPct, 17, 1e-9, "levier maintenance : +5 points sur les licences perpétuelles"); near(lm.produits[1].maintPct, 12, 1e-9, "… pas sur les abonnements");
const Op = calc.optimiser(hp), spx = Op.seuils.prix; ok(spx && spx.valeur === null && spx.facteur > 1 && !spx.deja, "seuil de prix avec plusieurs logiciels : un facteur sur tous les prix");
ok(calc.simuler(Object.assign({}, hp, calc.scalePrix(hp, spx.facteur)), "avec", {}).pointMort !== null && calc.simuler(Object.assign({}, hp, calc.scalePrix(hp, spx.facteur * 0.98)), "avec", {}).pointMort === null, "seuil de prix : rentable au seuil, pas 2 % en dessous");
ok(Op.leviers.filter((l) => l.id === "prix")[0].dEbitda5 > 0, "levier prix : améliore l'EBITDA avec les logiciels");

console.log("\nTous les contrôles du modèle de financement sont passés.");
