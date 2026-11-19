// Levée de fonds : état lisible par un agent (fonctions pures). bun run tests/levee_pure_test.ts   (ou deno run)
import { createRequire } from "node:module";
import { construireEtat } from "../_shared/company/levee_pure.ts";
const { calc } = createRequire(import.meta.url)("../../../shared/levee.js");
const ok = (c: unknown, m: string) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const cmd = (client: string, logiciel: string, ttc: number, acompte: number, statut: string, date: string) => ({ client, logiciel, ttc, htNet: Math.round(ttc / 1.18), acompte, statut, date });
const now = new Date("2026-11-19T08:00:00Z");
const commandes = [cmd("A", "ImmoSuite ERP", 5900000, 2000000, "livree", "2026-10-17"), cmd("B", "AviNest", 1180000, 1180000, "livree", "2026-11-02"), cmd("C", "ImmoSuite ERP", 3540000, 0, "en_cours", "2026-11-10"), cmd("D", "X", 590000, 0, "annulee", "2026-11-01")];

console.log("▶ État sans synchronisation du CRM");
const e0 = construireEtat(calc, { commandes, config: { rccm: "R", cc: "C", forme: "SARL", capital: "1", banque: "B" }, etat: null, now });
ok(e0.mesures.commandes === 3 && e0.mesures.clients === 3, "3 commandes et 3 clients (annulée exclue)");
ok(e0.eligibilite.length === 5 && e0.eligibilite.every((x: any) => x.score >= 0 && x.score <= 100), "5 types de financeurs scorés");
ok(e0.avertissements.some((a: string) => a.includes("jamais été ouvert")), "avertit que le CRM n'a jamais synchronisé");
ok(e0.avertissements.some((a: string) => a.includes("Modèle Financement indisponible")) && e0.modele === null, "modèle Financement absent : signalé, rien d'inventé");
ok(e0.avertissements.some((a: string) => a.includes("Historique de ventes court")), "historique court signalé");
ok(e0.criteres.length === 22 && e0.criteres.some((c: any) => c.statut === "à documenter"), "22 critères, certains « à documenter »");
ok(e0.plan.length > 0 && e0.plan.length <= 8 && e0.plan.every((p: any) => p.action && p.comment), "plan d'action de 8 lignes au plus, expliqué");

console.log("▶ Avec les réglages et le modèle synchronisés");
const etat = { updated_at: "2026-11-18T08:00:00Z", config: { manuel: { deck: true, pacte: true }, seuils: { livre12: { ok: 1e6, warn: 5e5 } } }, instantane: { pipelinePondere: 4e6, modele: { besoin: 3e7, recommande: 3.6e7, pointMort: 30, valide: true, scenario: "réaliste" } } };
const e1 = construireEtat(calc, { commandes, config: { rccm: "R", cc: "C", forme: "SARL", capital: "1", banque: "B" }, etat, now });
ok(e1.modele && e1.modele.besoin_fcfa === 3e7 && e1.modele.valide === true && e1.modele.synchronise_il_y_a_jours === 1, "modèle repris, ancienneté de la synchronisation indiquée (1 jour)");
ok(!e1.avertissements.some((a: string) => a.includes("jamais été ouvert")) && !e1.avertissements.some((a: string) => a.includes("indisponible")), "plus d'avertissement de synchronisation");
ok(e1.criteres.find((c: any) => c.critere.includes("Pitch deck")).statut === "atteint", "critère coché dans le CRM pris en compte");
ok(e1.criteres.find((c: any) => c.critere.includes("Chiffre d'affaires livré")).statut === "atteint", "seuil modifié dans le CRM pris en compte");
const ang = (e: any) => e.eligibilite.find((x: any) => x.type === "angel").score;
ok(ang(e1) > ang(e0), "le score progresse avec les critères cochés");

console.log("▶ Données périmées et vides");
const e2 = construireEtat(calc, { commandes, config: {}, etat: { ...etat, updated_at: "2026-10-01T00:00:00Z" }, now });
ok(e2.avertissements.some((a: string) => a.includes("peuvent être périmés")), "réglages vieux de plus de 14 jours : signalé");
const e3 = construireEtat(calc, { commandes: [], config: {}, etat: null, now });
ok(e3.mesures.commandes === 0 && e3.avertissements.some((a: string) => a.includes("Aucune commande")), "sans commande : avertissement, aucun NaN");
ok(!JSON.stringify(e3).includes("NaN") && !JSON.stringify(e3).includes("undefined"), "aucun NaN ni undefined dans l'état");
console.log("\nTOUT EST OK");
