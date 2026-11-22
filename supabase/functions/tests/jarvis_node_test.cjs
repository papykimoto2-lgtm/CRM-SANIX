// Logique pure de Jarvis (sans Deno) : node supabase/functions/tests/jarvis_node_test.cjs  (après esbuild, voir le script de build)
const assert = require("assert"); const J = require(process.argv[2] || "/tmp/jt/jarvis.cjs");
const ctx = { heure: "10:00", kpi: { n: 1 }, agents: [{ id: "a1", nom: "IA Hunter 1", fonction: "Chasseur", etat: "Au travail", mission: "Prospection" }], missions: [{ statut: "en_cours", titre: "x", agent: "IA Hunter 1", produit: "autogarage", fiches: "1/20" }], recent: [] };
const known = J.knownIds(ctx); assert.deepStrictEqual([...known], ["a1"]);
assert(J.buildContext(ctx).includes("a1 | IA Hunter 1"));
assert(J.buildContext({ agents: Array.from({ length: 500 }, (_, i) => ({ id: "i" + i, nom: "n".repeat(500) })) }).length <= 14000, "contexte borné");
const ok = J.parseReply(JSON.stringify({ reply: "Bonjour.", actions: [{ type: "zoom_in", agent_id: "", texte: "", titre: "", description: "", priorite: 0 }, { type: "focus_agent", agent_id: "a1", texte: "", titre: "", description: "", priorite: 0 }, { type: "propose_mission", agent_id: "a1", titre: "Relancer la prospection", description: "Cibler 20 garages avec contact public.", priorite: 9 }, { type: "focus_agent", agent_id: "zzz" }, { type: "supprimer_tout" }, { type: "propose_mission", agent_id: "inconnu", titre: "abc", description: "desc desc desc" }, { type: "propose_instruction", texte: "ab" }] }), known);
assert.deepStrictEqual(ok.actions.map((a) => a.type), ["zoom_in", "focus_agent", "propose_mission"], "actions inconnues, agent inexistant et consigne trop courte écartés");
assert.strictEqual(ok.actions[2].priorite, 5, "priorité bornée");
assert.strictEqual(J.parseReply("pas du json", known).actions.length, 0);
assert.strictEqual(J.parseReply('{"reply":"x","actions":[{"type":"propose_instruction","texte":"Prépare un plan AutoGarage"}]}', known).actions[0].texte, "Prépare un plan AutoGarage");
const h = J.cleanHistory([{ role: "assistant", content: "a" }, { role: "user", content: "u1" }, { role: "user", content: "u2" }, { role: "assistant", content: "r" }, { role: "system", content: "x" }]);
assert.deepStrictEqual(h.map((m) => m.role), ["user", "assistant"], "historique : commence par user, alternance stricte"); assert.strictEqual(h[0].content, "u1 u2");
console.log("jarvis (logique pure) : OK");
