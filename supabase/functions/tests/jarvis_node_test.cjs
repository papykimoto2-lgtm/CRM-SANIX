// Logique pure de Jarvis (sans Deno) : node supabase/functions/tests/jarvis_node_test.cjs  (après esbuild, voir le script de build)
const assert = require("assert"); const J = require(process.argv[2] || "/tmp/jt/jarvis.cjs");
const ctx = { heure: "10:00", kpi: { n: 1 }, agents: [{ id: "a1", nom: "IA Hunter 1", fonction: "Chasseur", etat: "Au travail", mission: "Prospection" }], missions: [{ statut: "en_cours", titre: "x", agent: "IA Hunter 1", produit: "autogarage", fiches: "1/20" }], recent: [] };
const known = J.knownIds(ctx); assert.deepStrictEqual([...known], ["a1"]);
assert(J.buildContext(ctx).includes("a1 | IA Hunter 1"));
assert(J.buildContext({ ...ctx, insights: [{ gravite: "haute", constat: "3 missions bloquées", piste: "Relancer" }] }).includes("haute | 3 missions bloquées | Relancer"), "constats détectés transmis");
assert(J.SYSTEM.includes("AU PLUS TROIS"));
assert(J.SYSTEM.includes("chef de cabinet opérationnel"), "Jarvis est défini comme chef de cabinet du DG");
assert(J.SYSTEM.includes("Directeur général reste le seul responsable"), "séparation des responsabilités Jarvis / DG");
assert(J.SYSTEM.includes("ne prétends jamais qu'une mission a été lancée"), "Jarvis ne confond pas transmission et exécution");
assert(J.buildContext({ agents: Array.from({ length: 500 }, (_, i) => ({ id: "i" + i, nom: "n".repeat(500) })) }).length <= 14000, "contexte borné");
const ok = J.parseReply(JSON.stringify({ reply: "Bonjour.", actions: [{ type: "zoom_in", agent_id: "", texte: "", titre: "", description: "", priorite: 0 }, { type: "focus_agent", agent_id: "a1", texte: "", titre: "", description: "", priorite: 0 }, { type: "propose_mission", agent_id: "a1", titre: "Relancer la prospection", description: "Cibler 20 garages avec contact public.", priorite: 9 }, { type: "focus_agent", agent_id: "zzz" }, { type: "supprimer_tout" }, { type: "propose_mission", agent_id: "inconnu", titre: "abc", description: "desc desc desc" }, { type: "propose_instruction", texte: "ab" }] }), known);
assert.deepStrictEqual(ok.actions.map((a) => a.type), ["zoom_in", "focus_agent", "propose_mission"], "actions inconnues, agent inexistant et consigne trop courte écartés");
assert.strictEqual(ok.actions[2].priorite, 5, "priorité bornée");
assert.strictEqual(J.parseReply("pas du json", known).actions.length, 0);
assert.strictEqual(J.parseReply('{"reply":"x","actions":[{"type":"propose_instruction","texte":"Prépare un plan AutoGarage"}]}', known).actions[0].texte, "Prépare un plan AutoGarage");
const h = J.cleanHistory([{ role: "assistant", content: "a" }, { role: "user", content: "u1" }, { role: "user", content: "u2" }, { role: "assistant", content: "r" }, { role: "system", content: "x" }]);
assert.deepStrictEqual(h.map((m) => m.role), ["user", "assistant"], "historique : commence par user, alternance stricte"); assert.strictEqual(h[0].content, "u1 u2");
const rp = J.parseReply(JSON.stringify({ reply: "ok", actions: [{ type: "propose_report", agent_id: "a1", jours: 99 }, { type: "propose_report_now", rapport: "hebdomadaire" }, { type: "propose_report_now", rapport: "annuel" }] }), known);
assert.deepStrictEqual(rp.actions, [{ type: "propose_report", agent_id: "a1", jours: 30 }, { type: "propose_report_now", rapport: "hebdomadaire" }], "rapports : bornés et validés");
assert.strictEqual(J.parseReply('{"reply":"Dix-sept agents travaillent, dont \\"Hunter\\" et","actions":[{"type":"zoo', known).reply, 'Dix-sept agents travaillent, dont "Hunter" et', "JSON tronqué : la réponse parlée est récupérée");
assert(J.buildContext({ mode: "autonome" }).includes("MODE AUTONOME") && J.buildContext({}).includes("MODE PRUDENT"));
assert(J.buildContext({ dg: [{ auteur: "directeur", texte: "Plan prêt" }] }).includes("directeur : Plan prêt"));
const cx = J.buildContext({ crm: { resume: { total: 3 }, recents: [{ nom: "GARAGE X", logiciel: "AutoGarage Pro", statut: "prospect", etape: "non traité" }], trouves: [{ nom: "MIDAS", etape: "premier_contact", derniere_reponse: "22/11" }] } });
assert(cx.includes("CRM — RÉSUMÉ") && cx.includes("GARAGE X | AutoGarage Pro | prospect | non traité") && cx.includes("MIDAS") && cx.includes("réponse 22/11"), "CRM transmis à Jarvis");
assert(!/téléphone|phone|@/.test(cx.split("CRM — FICHES")[1].split("ACTIVITÉ")[0]), "aucun contact personnel dans le contexte CRM");
const kc = new Set(["c_1", "c_2"]);
const w = J.parseReply(JSON.stringify({ reply: "ok", actions: [
  { type: "crm_update", rids: ["c_1", "c_inconnu", "c_2"], statut: "client", valeur: 500000, logiciel: "", secteur: "", adresse: "", commercial: "", notes: "", nom: "", phone: "", email: "" },
  { type: "crm_update", rids: ["c_1"], statut: "supprimé", valeur: -1 },
  { type: "crm_log", rids: ["c_1"], interaction: "demo", texte: "Démo réalisée chez le garage" },
  { type: "crm_log", rids: ["c_1"], interaction: "piratage", texte: "x" },
  { type: "crm_delete", rids: ["c_inconnu"] }] }), known, kc);
assert.deepStrictEqual(w.actions, [{ type: "crm_update", rids: ["c_1", "c_2"], champs: { statut: "client", valeur: 500000 } }, { type: "crm_log", rids: ["c_1"], interaction: "demo", texte: "Démo réalisée chez le garage" }], "CRM : fiches inconnues, statuts et interactions invalides écartés");
const cr = J.parseReply(JSON.stringify({ reply: "ok", actions: [{ type: "crm_create", nom: "GARAGE TEST", phone: "+225 07 00 00 00 00", email: "pas-un-email", valeur: -1, statut: "prospect" }, { type: "crm_create", nom: "x" }] }), known, kc);
assert.deepStrictEqual(cr.actions, [{ type: "crm_create", champs: { nom: "GARAGE TEST", phone: "+225 07 00 00 00 00", statut: "prospect" } }], "création : e-mail invalide et nom trop court écartés");
assert.deepStrictEqual([...J.knownCrmIds({ crm: { recents: [{ rid: "c_9" }], trouves: [{ rid: "c_8" }] } })], ["c_9", "c_8"]);
assert(J.buildContext({ crm: { recents: [{ rid: "c_9", nom: "X" }] } }).includes("c_9 | X"), "l'id de fiche est transmis");
const finance = { disponible: true, devise: "FCFA", commandes: { ca_ht_mois: 1500000 }, encaissements: { total_confirme: 500000 }, depenses_gestion: { reel_mois: 100000 } };
const financeCtx = J.buildContext({ finance });
assert(financeCtx.includes("FINANCE CRM") && financeCtx.includes("1500000") && financeCtx.includes("500000"), "données financières transmises à Jarvis");
assert(J.SYSTEM.includes("Distingue toujours CA, encaissements") && J.SYSTEM.includes("bénéfice"), "règles de lecture financière présentes");
console.log("jarvis (logique pure) : OK");
