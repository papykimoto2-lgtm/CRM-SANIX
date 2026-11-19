// SANIX CRM : module « Levée de fonds » — mesures, critères, scores, simulation (calculs purs). node levee_test.js
const { calc } = require("../shared/levee.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const NOW = "2026-11-19";
const cmd = (client, logiciel, ttc, acompte, statut, date, extra) => Object.assign({ client, logiciel, ttc, htNet: Math.round(ttc / 1.18), acompte, statut, date }, extra || {});

console.log("▶ Mesures");
const vide = calc.mesurer({ commandes: [], now: NOW });
ok(vide.nbCommandes === 0 && vide.top1 === null && vide.croissance === null && vide.recurrent === null, "aucune commande : tout est « non mesurable », rien d'inventé");
const C = [cmd("A", "ImmoSuite", 5900000, 2000000, "livree", "2026-10-17"), cmd("B", "AviNest", 1180000, 1180000, "livree", "2026-11-02"), cmd("C", "ImmoSuite", 3540000, 0, "en_cours", "2026-11-10"),
  cmd("D", "Phyto", 590000, 0, "annulee", "2026-11-01"), cmd("A", "Maintenance", 590000, 590000, "livree", "2026-11-05", { renouvellement: true })];
const m = calc.mesurer({ commandes: C, now: NOW, config: { rccm: "CI-X", cc: "123", forme: "SARL", capital: "1000000", banque: "BICICI" }, pipelinePondere: 3000000, modele: { besoin: 10000000, pointMort: 30, valide: true } });
ok(m.nbCommandes === 4, "les commandes annulées sont exclues");
ok(m.clients === 3 && m.clientsPayants === 2, "3 clients dont 2 ont payé");
ok(m.livre12 === Math.round(5900000 / 1.18) + Math.round(1180000 / 1.18) + Math.round(590000 / 1.18), "CA livré = HT des commandes livrées");
ok(m.vendu12 === Math.round(5900000 / 1.18) + Math.round(1180000 / 1.18) + Math.round(3540000 / 1.18) + Math.round(590000 / 1.18), "CA vendu = livrées + en cours");
ok(Math.abs(m.encaisse - (2000000 + 1180000 + 590000) / (5900000 + 1180000 + 3540000 + 590000)) < 1e-9, "part encaissée = acomptes ÷ TTC");
ok(m.recurrent > 0.04 && m.recurrent < 0.06, "part récurrente = renouvellements ÷ total (≈ 5 %)");
ok(Math.abs(m.top1 - (Math.round(5900000 / 1.18) + Math.round(590000 / 1.18)) / m.vendu) < 1e-9, "poids du premier client (renouvellement inclus)");
ok(m.topLogiciel > 0.6 && m.topLogiciel < 0.9, "poids du premier logiciel (renouvellements exclus)");
ok(m.moisAct >= 1.0 && m.moisAct <= 1.2, "ancienneté : un peu plus d'un mois (" + m.moisAct + ")");
ok(m.croissance === null, "croissance non mesurable avant 6 mois d'activité");
ok(m.immat && m.forme && m.banque, "juridique lu dans la fiche société");
ok(m.pipelineMois !== null && m.pipelineMois > 0, "pipeline exprimé en mois de ventes");

console.log("▶ Croissance (historique long)");
const hist = []; for (let k = 0; k < 8; k++) { const d = new Date(2026, 10 - 1 - k, 5); hist.push(cmd("C" + k, "Immo", 1180000 * (k < 3 ? 2 : 1), 1180000, "livree", d.toISOString().slice(0, 10))); }
const mh = calc.mesurer({ commandes: hist, now: NOW });
ok(mh.croissance !== null && mh.croissance > 0.2 && mh.croissance < 0.3, "croissance mensuelle mesurée : " + Math.round(mh.croissance * 100) + " %");

console.log("▶ Critères et scores");
const ev = calc.evaluer(m, {}, {});
const par = (id) => ev.filter((e) => e.id === id)[0];
ok(par("immat").s === "ok" && par("banque").s === "ok", "société immatriculée, compte bancaire : atteints");
ok(par("compta").s === "na" && par("deck").s === "na", "critères de dossier non cochés : « à documenter » (pas « insuffisants »)");
ok(par("livre12").s === "warn", "CA livré 6,2 M : entre 5 et 20 M → à renforcer");
ok(par("croissance").s === "na", "croissance : à documenter");
ok(par("modele").s === "ok" && par("pointMort").s === "ok" && par("besoin").s === "ok", "modèle validé, point mort à 30 mois, besoin chiffré");
const sc = calc.scores(ev);
ok(sc.length === 5 && sc.every((s) => s.score >= 0 && s.score <= 100), "5 scores entre 0 et 100");
ok(sc.find((s) => s.id === "angel").bloques.indexOf("deck") >= 0, "business angels : le pitch deck est une condition obligatoire non atteinte");
ok(sc.find((s) => s.id === "fonds").verdict === "non", "fonds d'amorçage : pas éligible avec 1 mois d'activité");
const man = {}; calc.CRITERES.filter((c) => c.manuel).forEach((c) => { man[c.id] = true; });
const sc2 = calc.scores(calc.evaluer(m, {}, man));
ok(sc2.find((s) => s.id === "angel").score > sc.find((s) => s.id === "angel").score, "cocher les critères de dossier augmente le score");
ok(sc2.find((s) => s.id === "acc").verdict === "eligible", "accélérateur : éligible quand le dossier est prêt");
const tout = Object.assign({}, m, { livre12: 50e6, clients: 20, moisAct: 24, croissance: 0.2, recurrent: 0.5, top1: 0.2, topLogiciel: 0.3, encaisse: 0.9, produits: 5, pipelineMois: 8, pointMort: 20 });
ok(calc.scores(calc.evaluer(tout, {}, man)).every((s) => s.score === 100 && s.verdict === "eligible"), "tout atteint : 100 / 100 et éligible partout");
const sansBanque = calc.scores(calc.evaluer(Object.assign({}, tout, { banque: false }), {}, man));
ok(sansBanque.find((s) => s.id === "dette").verdict !== "eligible" && sansBanque.find((s) => s.id === "dette").bloques.indexOf("banque") >= 0, "sans compte bancaire : le prêt reste bloqué malgré le score");
ok(calc.statutCritere(calc.CRITERES.find((c) => c.id === "pointMort"), Object.assign({}, m, { pointMort: null }), calc.seuils({}), {}).texte === "Jamais rentable", "plan jamais rentable signalé");
ok(calc.palier(0.5, { ok: 0.4, warn: 0.6 }, "bas") === "warn" && calc.palier(0.3, { ok: 0.4, warn: 0.6 }, "bas") === "ok", "critères « plus bas = mieux » : paliers corrects");

console.log("▶ Seuils modifiables");
const evS = calc.evaluer(m, { livre12: { ok: 5e6, warn: 1e6 } }, {});
ok(evS.find((e) => e.id === "livre12").s === "ok", "abaisser le seuil à 5 M rend le CA livré « atteint »");

console.log("▶ Et si ?");
const sim = calc.simulerHypothese(m, {}, man, { livre12: 25e6, clients: 12 });
ok(sim.apres.every((s, i) => s.score >= sim.avant[i].score), "améliorer CA et clients n'abaisse jamais un score");
ok(sim.apres.find((s) => s.id === "fonds").score > sim.avant.find((s) => s.id === "fonds").score, "le score des fonds progresse");
ok(calc.simulerHypothese(m, {}, man, {}).apres.every((s, i) => s.score === sim.avant[i].score), "sans hypothèse : mêmes scores");

console.log("▶ Cibles et délais");
const S = calc.seuils({}), cl = calc.CRITERES.find((c) => c.id === "livre12");
const t = calc.cible(cl, m, S); ok(t.objectif === 20e6 && t.ecart > 13e6, "cible CA livré : 20 M, écart > 13 M");
ok(calc.delai(cl, m, S) === null, "moins de 3 mois d'historique : aucun délai extrapolé");
const mLong = Object.assign({}, m, { moisAct: 6, rythme: 2e6 });
ok(calc.delai(cl, mLong, S) === 7, "6 mois d'historique, 2 M par mois : 13,8 M à combler en 7 mois");
ok(calc.delai(calc.CRITERES.find((c) => c.id === "moisAct"), m, S) >= 5, "ancienneté : le temps seul règle le point");
ok(calc.delai(calc.CRITERES.find((c) => c.id === "recurrent"), m, S) === null, "pas de délai inventé pour un critère qui ne se cumule pas");

console.log("▶ Simulation de la levée");
const mod = { besoin: 30e6, associes: [{ nom: "Fondateur", part: 70 }, { nom: "Associé", part: 30 }], burn: 2e6 };
const mo = calc.montage({ montant: 30e6, preMoney: 90e6 }, mod, m);
ok(Math.abs(mo.part - 0.25) < 1e-9 && mo.post === 120e6, "30 M pour 90 M avant apport : 25 % cédés, 120 M après");
ok(Math.abs(mo.runway - 15) < 1e-9, "autonomie : 30 M ÷ 2 M par mois = 15 mois");
ok(Math.abs(mo.table.reduce((s, r) => s + r.apres, 0) - 1) < 1e-9 && Math.abs(mo.table[0].apres - 0.525) < 1e-9, "tour de table après apport : 100 % au total, fondateur 52,5 %");
ok(mo.alertes.length === 0, "montage sain : aucune alerte");
const m2 = calc.montage({ montant: 60e6, preMoney: 30e6 }, Object.assign({}, mod, { besoin: 80e6, burn: 6e6 }), m);
ok(m2.alertes.length === 3 && m2.manque === 20e6, "part > 30 %, montant sous le besoin, autonomie < 12 mois : 3 alertes");

console.log("▶ Plan d'action");
const pl = calc.plan(m, {}, {});
ok(pl.length > 0 && pl.every((p) => p.s !== "ok"), "le plan ne contient que des critères non atteints");
ok(pl[0].bloque.length >= 1, "les conditions obligatoires passent en premier");
ok(pl.every((p) => p.action && p.lib), "chaque action est expliquée");
ok(calc.CRITERES.every((c) => c.note && c.note.def && c.note.pourquoi && c.note.calcul), "chaque critère a sa note explicative (définition, intérêt, calcul)");
ok(calc.CRITERES.every((c) => calc.POIDS[c.id] && calc.POIDS[c.id].length === 5), "chaque critère a un poids par type de financeur");
console.log("\nTOUT EST OK");
