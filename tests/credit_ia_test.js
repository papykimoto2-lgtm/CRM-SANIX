// SANIX CRM : Crédit IA — calculs de l'écran (solde, plafonds, alertes). node credit_ia_test.js
const { calc } = require("../shared/credit_ia.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const credit = { saisi: true, solde_usd: 80.4, base_usd: 80.89, base_at: "2026-11-19T19:38:45Z", depense_depuis_usd: 0.49, recharges_depuis_usd: 0, rythme_jour_usd: 1.2, jours_restants: 67 };
const c30 = { jour_usd: 0.5, mois_usd: 9.12, prevision_fin_mois_usd: 13.4, budget_jour_usd: 7, budget_mois_usd: 20, jours: [{ jour: "2026-11-18", cout_usd: 3, appels: 20, erreurs: 1 }, { jour: "2026-11-19", cout_usd: 0.5, appels: 4, erreurs: 0 }],
  modeles: [{ modele: "claude-sonnet-5-5", cout_usd: 8, appels: 30, erreurs: 2 }], agents: [{ nom: "DG", fonction: "Directeur", cout_usd: 5, appels: 10, tokens_in: 1000, tokens_out: 200 }, { nom: "X", cout_usd: 0, appels: 0 }] };
const c7 = { periode_usd: 4, agents: [{ tokens_in: 100000, tokens_out: 20000 }, { tokens_in: 50000, tokens_out: 5000 }] };
console.log("▶ Solde et plafonds");
const e = calc.etat(credit, c30, c7);
ok(e.saisi && e.solde === 80.4 && e.niveau === "ok" && e.alertes.length === 0, "solde 80,40 $ : niveau normal, aucune alerte");
ok(e.pctMois === 46 && e.pctJour === 7, "plafond mensuel utilisé à 46 % (9,12 / 20), journalier à 7 %");
ok(e.tokensIn7 === 150000 && e.tokensOut7 === 25000, "jetons sur 7 jours additionnés (150 000 entrée, 25 000 sortie)");
ok(e.agents.length === 1 && e.agents[0].nom === "DG", "seuls les collaborateurs ayant dépensé sont listés");
ok(e.appels30 === 24 && e.erreurs30 === 1, "appels et erreurs sur 30 jours totalisés");
console.log("▶ Alertes");
ok(calc.etat(Object.assign({}, credit, { solde_usd: 3 }), c30, c7).niveau === "bas", "moins de 5 $ : crédit bas");
ok(calc.etat(Object.assign({}, credit, { jours_restants: 4 }), c30, c7).alertes[0].includes("4 jour"), "moins de 7 jours de crédit : alerte avec le nombre de jours");
ok(calc.etat(Object.assign({}, credit, { solde_usd: 0 }), c30, c7).niveau === "epuise", "solde nul : crédit épuisé");
ok(calc.etat(credit, Object.assign({}, c30, { prevision_fin_mois_usd: 25 }), c7).alertes.some((a) => a.includes("dépasserait le plafond mensuel")), "prévision au-dessus du plafond mensuel : alerte");
ok(calc.etat(credit, Object.assign({}, c30, { mois_usd: 17 }), c7).alertes.some((a) => a.includes("85 %")), "plafond mensuel utilisé à 85 % : alerte");
console.log("▶ Données absentes");
ok(calc.etat({ saisi: false }, null, null).saisi === false, "aucun solde déclaré : pas de solde inventé");
const e0 = calc.etat(credit, null, null);
ok(e0.pctMois === undefined && e0.tokensIn7 === undefined, "sans centre des coûts : pas de pourcentage ni de jetons inventés");
const nn = (s) => s.replace(/[\u00a0\u202f]/g, " "); ok(nn(calc.usd(80.89)) === "80,89 $" && nn(calc.nb(1234567)) === "1 234 567", "formats français (80,89 $)");
console.log("\nTOUT EST OK");
