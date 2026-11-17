// SANIX CRM Pro : liste « À faire aujourd'hui » (calculs vérifiés à la main). node afaire_test.js
const A = require("../shared/afaire.js");
let n = 0; const ok = (c, m) => { n++; if (!c) throw new Error("ÉCHEC : " + m); };
const NOW = "2026-11-17T09:00:00";   // mardi 17 novembre 2026

ok(A.jour(NOW) === "2026-11-17" && A.ecart("2026-11-10", NOW) === 7 && A.ecart("2026-11-17", NOW) === 0 && A.ecart("2026-11-20", NOW) === 0 && A.ecart("", NOW) === null, "dates : écart en jours, jamais négatif");

const clients = [
  { id: 1, nom: "Contact en retard", statut: "prospect", phone: "0701", logiciel: "ImmoSuite ERP" },
  { id: 2, nom: "Devis à envoyer", statut: "prospect", phone: "0702", logiciel: "ImmoSuite ERP" },
  { id: 3, nom: "Closing", statut: "prospect", phone: "0703", logiciel: "ImmoSuite ERP" },
  { id: 4, nom: "Démo à programmer récente", statut: "prospect", phone: "0704", logiciel: "AluExpert" },
  { id: 5, nom: "Perdu", statut: "prospect", phone: "0705", logiciel: "ImmoSuite ERP" },
  { id: 6, nom: "Client vendu", statut: "client", phone: "0706" },
  { id: 7, nom: "Froid cher", statut: "prospect", phone: "0707", logiciel: "ImmoSuite ERP" },
  { id: 8, nom: "Froid moyen", statut: "prospect", phone: "0708", logiciel: "AluExpert" },
  { id: 9, nom: "Froid sans téléphone", statut: "prospect", phone: "", logiciel: "ImmoSuite ERP" },
  { id: 10, nom: "Froid cher et renseigné", statut: "prospect", phone: "0710", logiciel: "ImmoSuite ERP" },
  { id: 11, nom: "Déjà relancé aujourd'hui", statut: "prospect", phone: "0711", logiciel: "ImmoSuite ERP" }
];
const etapes = { 1: 1, 2: 2, 3: 4, 4: 1, 5: 1, 7: 0, 8: 0, 9: 0, 10: 0, 11: 3 };
const nbas = {
  1: { label: "Relancer + caler démo", urg: 3, overdue: true, days: 9, cadence: 3 },     // retard 6 j
  2: { label: "Envoyer la proposition", urg: 2, overdue: false, days: 1, cadence: 2 },
  3: { label: "Closer", urg: 3, overdue: false, days: 1, cadence: 3 },
  4: { label: "Programmer une démo", urg: 2, overdue: false, days: 1, cadence: 3 },
  11: { label: "Suivre la proposition", urg: 3, overdue: true, days: 0, cadence: 3 }
};
const valeurs = { 1: 4e6, 2: 1e6, 3: 4e6, 4: 6e5, 7: 4e6, 8: 6e5, 9: 4e6, 10: 4e6 };
const f = {
  etape: (c) => etapes[c.id] || 0, nba: (c) => nbas[c.id] || { urg: 1, overdue: false }, valeur: (c) => valeurs[c.id] || 0,
  perdu: (c) => c.id === 5, completude: (c) => (c.id === 10 ? 7 : 3),
  reste: (c) => Math.max(0, c.ttc - (c.paiements || []).reduce((t, p) => t + p.montant, 0)), dernierPaiement: (c) => (c.paiements || []).map((p) => p.date).sort().pop() || null
};
const commandes = [
  { id: "a", ref: "CMD-1", client: "Gros reste", statut: "en_cours", date: "2026-08-05", ttc: 5e6, paiements: [{ date: "2026-09-04", montant: 1e6 }, { date: "2026-11-11", montant: 1e6 }] },   // reste 3 000 000, dernier paiement il y a 6 j
  { id: "b", ref: "CMD-2", client: "Petit reste ancien", statut: "livree", date: "2026-08-05", ttc: 7e5, paiements: [{ date: "2026-09-04", montant: 5e5 }] },                                       // reste 200 000, 74 j
  { id: "c", ref: "CMD-3", client: "Soldée", statut: "livree", date: "2026-10-01", ttc: 4e5, paiements: [{ date: "2026-10-28", montant: 4e5 }] },
  { id: "d", ref: "CMD-4", client: "Brouillon", statut: "brouillon", date: "2026-11-01", ttc: 9e5, paiements: [] },
  { id: "e", ref: "CMD-5", client: "Sans paiement récent", statut: "confirmee", date: "2026-11-01", ttc: 1e6, paiements: [] }                                                                    // reste 1 000 000, 16 j depuis la commande
];
const rdvs = [
  { id: 1, clientId: 1, client: "Contact en retard", date: "2026-11-17", heure: "15:00", statut: "prevu", type: "Démo" },
  { id: 2, clientId: 2, client: "Devis à envoyer", date: "2026-11-17", heure: "09:30", statut: "prevu", type: "Appel" },
  { id: 3, clientId: 3, client: "Closing", date: "2026-11-17", heure: "11:00", statut: "annule" },
  { id: 4, clientId: 4, client: "Démo à programmer récente", date: "2026-11-18", heure: "10:00", statut: "prevu" }
];
const echeances = [{ licId: "L1", client: "Client X", logiciel: "ImmoSuite ERP", libelle: "J-30", due: "2026-12-10", jours: 23, montantHT: 480000, relanceDue: true }, { licId: "L2", client: "Client Y", relanceDue: false }];

const R = A.construire({ now: NOW, clients, commandes, rdvs, echeances, f });
ok(R.date === "2026-11-17", "date du jour");
ok(R.rdv.length === 2 && R.rdv[0].client === "Devis à envoyer" && R.rdv[0].heure === "09:30" && R.rdv[1].heure === "15:00", "rendez-vous du jour : 2 (annulé et lendemain exclus), triés par heure");
ok(R.argent.map((x) => x.ref).join() === "CMD-1,CMD-5,CMD-2", "argent : par reste décroissant (3 000 000, 1 000 000, 200 000) ; soldée et brouillon exclues");
ok(R.argent[0].reste === 3e6 && R.argent[0].jours === 6 && R.argent[0].urgence === "normale", "Gros reste : 3 000 000, dernier paiement il y a 6 jours");
ok(R.argent[1].jours === 16 && R.argent[1].urgence === "moyenne", "sans paiement : ancienneté depuis la commande (16 j) → urgence moyenne");
ok(R.argent[2].jours === 74 && R.argent[2].urgence === "haute", "200 000 impayés depuis 74 jours → urgence haute");
ok(R.aEncaisser === 3e6 + 1e6 + 2e5, "total à encaisser = 4 200 000");
ok(R.echeances.length === 1 && R.echeances[0].palier === "J-30", "renouvellements : seules les échéances à relancer");
ok(R.relances.map((x) => x.id).join() === "1,3,2,4", "relances : en retard d'abord, puis closing, puis proposition, puis démo (urgence puis retard puis valeur)");
ok(R.relances[0].retard === 6 && R.relances[0].enRetard, "contact en retard : 9 jours pour une cadence de 3 = 6 jours de retard");
ok(!R.relances.some((x) => x.id === 5 || x.id === 6), "affaire perdue et client déjà vendu exclus");
ok(!R.relances.some((x) => x.id === 11), "affaire déjà relancée aujourd'hui (0 jour) : sortie de la liste");
ok(R.relancesAutres === 0, "aucune relance au-delà de la limite");
ok(R.contacts.map((x) => x.id).join() === "10,7,8", "contacts à passer : valeur décroissante (4 M), puis fiche la mieux renseignée, puis 600 k ; sans téléphone exclu");
ok(R.total === 2 + 3 + 1 + 4 + 3, "total d'actions = 13");

const L = A.construire({ now: NOW, clients, commandes: [], rdvs: [], echeances: [], f, limites: { relances: 2, contacts: 1 } });
ok(L.relances.length === 2 && L.relancesAutres === 2 && L.contacts.length === 1, "limites : 2 relances affichées, 2 autres signalées, 1 contact");
const V = A.construire({ now: NOW, clients: [], commandes: [], rdvs: [], echeances: [], f });
ok(V.total === 0 && V.argent.length === 0, "rien à faire : liste vide");
console.log("À faire aujourd'hui : " + n + " contrôles passés.");
