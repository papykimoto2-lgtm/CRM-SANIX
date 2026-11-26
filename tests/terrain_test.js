// Logique pure du module Terrain : node tests/terrain_test.js
const assert = require("assert"); const T = require("../shared/terrain.js");
const abj = { lat: 5.3, lng: -4.0 };
assert(Math.abs(T.distance(abj, { lat: 5.31, lng: -4.0 }) - 1112) < 15, "1 centième de degré de latitude ≈ 1,1 km");
assert.strictEqual(T.distance(abj, { lat: null, lng: 0 }), null, "coordonnées absentes : pas de distance");
assert(!T.valide(0, 0) && !T.valide("", "") && !T.valide(95, 0) && T.valide(5.3, -4), "validité des coordonnées (0,0 écarté)");
const et = [{ nom: "Loin", lat: 5.5, lng: -4.0 }, { nom: "Sans GPS" }, { nom: "Près", lat: 5.301, lng: -4.0 }, { nom: "Milieu", lat: 5.35, lng: -4.0 }];
assert.deepStrictEqual(T.ordonner(et, abj).map((e) => e.nom), ["Près", "Milieu", "Loin", "Sans GPS"], "plus proche voisin, sans GPS en fin");
const p = T.parcours(T.ordonner(et, abj), abj, "moto"); assert(p.metres > 20000 && p.minutes > 0 && p.sansPosition === 1, "parcours : distance, durée, prospects sans position");
assert(T.minutesTrajet(4000, "pied") > T.minutesTrajet(4000, "moto"), "la moto est plus rapide que la marche");
const clients = [
  { id: 1, nom: "Garage A", statut: "prospect", ville: "Marcory", lat: 5.30, lng: -4.01, logiciel: "AutoGarage Pro", interactions: [] },
  { id: 2, nom: "Client B", statut: "client", ville: "Marcory" },
  { id: 3, nom: "Hôtel Café", statut: "prospect", ville: "Yopougon", interactions: [{ type: "Visite terrain", date: new Date(Date.now() - 3 * 864e5).toISOString() }] },
  { id: 4, nom: "Résidence Étoile", statut: "prospect", adresse: "Marcory Zone 4", interactions: [{ type: "Visite terrain", date: new Date(Date.now() - 30 * 864e5).toISOString() }] }];
assert.deepStrictEqual(T.candidats(clients, {}, abj).map((c) => c.client_rid).sort(), ["1", "4"], "clients exclus ; prospect visité il y a 3 jours exclu, il y a 30 jours conservé");
assert.deepStrictEqual(T.candidats(clients, { ville: "marcory", joursSansVisite: 0 }, abj).map((c) => c.client_rid).sort(), ["1", "4"], "filtre ville sans accents ni casse");
assert.deepStrictEqual(T.candidats(clients, { seulementGeolocalises: true }, abj).map((c) => c.client_rid), ["1"], "filtre géolocalisés");
assert.deepStrictEqual(T.candidats(clients, { logiciel: "AutoGarage Pro" }, abj).map((c) => c.client_rid), ["1"], "filtre logiciel");
const it = T.interaction({ statut: "visite", issue: "rdv_pris", note: "Décideur rencontré", presence: true });
assert(it.type === "Visite terrain" && it.etape === 2 && /Rendez-vous pris/.test(it.note) && /présence vérifiée/.test(it.note), "interaction consignée dans la fiche");
assert.strictEqual(T.interaction({ statut: "absent" }).etape, 0);
assert.strictEqual(T.niveau(80), "bon"); assert.strictEqual(T.niveau(60), "moyen"); assert.strictEqual(T.niveau(10), "faible");
assert.strictEqual(T.duree(135), "2 h 15"); assert.strictEqual(T.duree(40), "40 min");
const csv = T.csv([{ nom: "=CMD()", mobilite: "moto", score: 80 }]); assert(csv.startsWith("﻿Commercial;") && csv.includes("'=CMD()"), "CSV : BOM Excel et neutralisation des formules");
console.log("terrain (logique pure) : OK");
