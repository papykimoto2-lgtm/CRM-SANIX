// Calculs purs du module Finance de Jarvis : esbuild supabase/functions/_shared/company/jarvis_finance.ts --bundle --format=cjs --platform=node --outfile=/tmp/jt/jf.cjs
//   node supabase/functions/tests/jarvis_finance_node_test.cjs /tmp/jt/jf.cjs /tmp/jt/jarvis.cjs
const assert = require("assert"); const F = require(process.argv[2] || "/tmp/jt/jf.cjs"), J = require(process.argv[3] || "/tmp/jt/jarvis.cjs");
const commandes = [
  { id: "A", client: "Alpha", statut: "livree", ttc: 1180000, htNet: 1000000, tva: 180000, date: "2026-03-10", paiements: [{ montant: 500000, mode: "virement" }, { montant: 100000, mode: "especes" }, { montant: 999999, mode: "virement", supprime: true }] },
  { id: "B", client: "Beta", statut: "confirmee", ttc: 118000, htNet: 100000, tva: 18000, date: "2026-11-05", acompte: 18000 },
  { id: "C", client: "Delta", statut: "brouillon", ttc: 500000, date: "2026-11-06" }, { id: "D", client: "Eps", statut: "annulee", ttc: 700000, date: "2026-11-07" }];
const contrats = [{ id: "K1", client: "Gamma", statut: "signe", montant: 236000, date: "2026-06-01" }, { id: "K2", client: "Lié", statut: "signe", montant: 999, cmdId: "A", date: "2026-06-01" }];
const c = F.compta({ commandes, contrats, now: new Date("2026-11-22") });
assert.strictEqual(c.ventes_ht, 1300000); assert.strictEqual(c.tva_collectee, 234000); assert.strictEqual(c.facture_ttc, 1534000);
assert.strictEqual(c.encaisse, 618000); assert.strictEqual(c.creances_clients, 916000); assert.strictEqual(c.tresorerie_encaissee, 618000);
assert.strictEqual(c.nb_ecritures_auto, 6); assert.strictEqual(c.ventes_ht_exercice, 1300000);
assert.deepStrictEqual(c.plus_grosses_creances.map((x) => x.client), ["Alpha", "Gamma", "Beta"]);
assert.strictEqual(c.encaisse_par_mode.virement, 500000); assert.strictEqual(c.encaisse_par_mode.inconnu, 18000);
assert.strictEqual(c.ca_ht_12_derniers_mois.length, 12); assert.strictEqual(c.ca_ht_12_derniers_mois.at(-1).mois, "2026-11"); assert.strictEqual(c.ca_ht_12_derniers_mois.at(-1).ht, 100000);
assert.strictEqual(F.compta({ commandes: [{ client: "X", statut: "livree", ttc: 1000, htNet: 847, date: "2026-01-01", paiements: [{ montant: 5000, mode: "especes" }] }] }).creances_clients, 0, "un versement en trop ne rend pas le 411 créditeur");
assert.strictEqual(F.cmdHT({ ttc: 1180 }, 18), 1000); assert.strictEqual(F.cmdHT({ ttc: 1180, sansTva: true }), 1180);
const deals = [{ client: "Alpha", commercial: "Apporteur — Koné", logiciel: "", stage: "gagne" }, { client: "Beta", commercial: "Awa", logiciel: "", stage: "gagne" }, { client: "Zeta", commercial: "Awa", stage: "gagne" }, { client: "Beta", commercial: "Awa", stage: "gagne" }, { client: "Alpha", commercial: "X", stage: "prospect" }];
const cm = F.commissions({ deals, commandes });
assert.strictEqual(cm.nb, 2); assert.strictEqual(cm.total_calcule, 105000); assert.strictEqual(cm.liste[0].taux, 10); assert.strictEqual(cm.liste[1].montant, 5000);
const data = { financeurs: [{ id: "f1", nom: "Fonds Alpha Afrique", type: "fonds", pays: "Côte d'Ivoire", statut: "contacte" }, { id: "f2", nom: "Banque Beta", type: "banque", statut: "a_etudier" }, { id: "f3", nom: "Subvention Gamma", type: "subvention", statut: "a_etudier" }], contacts: [{}, {}], brouillons: [{ id: "b1", financeur_id: "f1", statut: "brouillon", objet: "Présentation", canal: "email" }, { id: "b2", statut: "valide" }] };
const lv = F.levee(data, "où en est Fonds Alpha ?");
assert.strictEqual(lv.financeurs.total, 3); assert.deepStrictEqual(lv.financeurs.par_statut, { contacte: 1, a_etudier: 2 }); assert.strictEqual(lv.a_valider.length, 1); assert.strictEqual(lv.a_valider[0].financeur, "Fonds Alpha Afrique");
assert.deepStrictEqual(lv.trouves.map((f) => f.id), ["f1"]); assert.deepStrictEqual(F.levee(data, "les banques").trouves.map((f) => f.id), ["f2"]);
const ids = F.knownFinanceIds({ levee: lv }); assert.deepStrictEqual([...ids].sort(), ["b1", "f1"]);
assert.strictEqual(F.knownFinanceIds(undefined).size, 0);
// actions finance : ids de l'instantané serveur seulement, statuts bornés, « envoye » interdit
const known = new Set(), crm = new Set();
const w = J.parseReply(JSON.stringify({ reply: "ok", actions: [
  { type: "fin_levee_statut", rids: ["f1", "inconnu"], statut: "en_discussion" }, { type: "fin_levee_statut", rids: ["f1"], statut: "gagne" },
  { type: "fin_levee_note", rids: ["f1"], texte: "Rendez-vous fixé jeudi" }, { type: "fin_brouillon", rids: ["b1"], statut: "valide" }, { type: "fin_brouillon", rids: ["b1"], statut: "envoye" }, { type: "fin_brouillon", rids: ["zzz"], statut: "valide" }] }), known, crm, ids);
assert.deepStrictEqual(w.actions, [{ type: "fin_levee_statut", rids: ["f1"], statut: "en_discussion" }, { type: "fin_levee_note", rids: ["f1"], texte: "Rendez-vous fixé jeudi" }, { type: "fin_brouillon", rids: ["b1"], statut: "valide" }], "finance : ids inconnus, statut invalide et « envoye » écartés");
assert.deepStrictEqual(J.parseReply(JSON.stringify({ reply: "ok", actions: [{ type: "fin_levee_statut", rids: ["f1"], statut: "investi" }] }), known, crm).actions, [], "sans instantané serveur, aucune écriture finance");
assert(J.SYSTEM.includes("FINANCE (module Finance") && /TOUJOURS la confirmation/.test(J.SYSTEM));
const ctx = J.buildContext({ finance: { compta_syscohada: { creances_clients: 916000 }, levee: lv } }); assert(ctx.includes("916000") && ctx.includes("Fonds Alpha Afrique"), "instantané finance transmis au modèle");
console.log("jarvis finance (calculs purs) : OK");
