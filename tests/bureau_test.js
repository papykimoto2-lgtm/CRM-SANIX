// SANIX CRM Pro : « Bureau du jour » (synthèse : ce qui demande votre attention, santé et travail des agents). Calculs vérifiés à la main. node bureau_test.js
const B = require("../shared/bureau.js");
let n = 0; const ok = (c, m) => { n++; if (!c) throw new Error("ÉCHEC : " + m); };
const NOW = "2026-11-17T14:00:00";   // mardi 17 novembre 2026, 14 h
const h = (heures) => new Date(Date.parse(NOW) - heures * 36e5).toISOString();
const j = (jours) => h(jours * 24);

const agents = [{ id: "a1", nom: "Prospection", fonction: "Responsable", etat: "actif" }, { id: "a2", nom: "Qualificateur", fonction: "Qualification", etat: "actif" }, { id: "a3", nom: "Chercheur 1", fonction: "Recherche", etat: "suspendu" }, { id: "a4", nom: "Chercheur 2", fonction: "Recherche", etat: "suspendu" }, { id: "a5", nom: "Rédacteur", fonction: "Contenus", etat: "suspendu" }];
const R = B.construire({
  now: NOW, session: true, agents,
  tachesTerminees: [{ id: "t1", agent_id: "a1", titre: "Qualifier 10 prospects Industrie", statut: "terminee", rapport: "10 prospects qualifiés, 4 prioritaires.", finished_at: h(2) }, { id: "t2", agent_id: "a2", titre: "Tâche d'hier", statut: "terminee", rapport: "ancienne", finished_at: j(1) }, { id: "t3", agent_id: "a1", titre: "Rapport du matin", statut: "terminee", rapport: "", finished_at: h(5) }],
  tachesOuvertes: [{ id: "t4", agent_id: "a2", titre: "Appeler les cliniques", statut: "bloquee", rapport: "Aucun numéro mobile", updated_at: h(1) }, { id: "t5", agent_id: "a1", titre: "Plan de la semaine", statut: "attente_sous_taches", updated_at: h(3) }, { id: "t6", agent_id: "a1", titre: "annulée", statut: "annulee" }],
  incidents: [{ gravite: "critique", type: "suspension_auto", message: "3 échecs", created_at: h(2) }, { gravite: "critique", type: "suspension_auto", message: "3 échecs", created_at: h(4) }, { gravite: "attention", type: "erreur_execution", message: "400 {\"error\":\"credit balance is too low\"}", created_at: h(1) }, { gravite: "critique", type: "cle_ia_absente", message: "ancienne", created_at: j(3) }],
  validations: [{ id: "v1", type: "remise", entreprise: "BACID", created_at: h(1) }],
  gouvernance: { actif: true, budget_jour_usd: 7, modele: "claude-opus-5-5", modele_operationnel: "claude-sonnet-5-5" }, coutJour: 1.4,
  mails: [{ status: "envoye", sent_at: h(1), relance_apres_jours: 4 }, { status: "repondu", sent_at: j(3), replied_at: h(3), relance_apres_jours: 4 }, { status: "envoye", sent_at: j(6), relance_apres_jours: 4 }, { status: "envoye", sent_at: j(2), relance_apres_jours: 4 }, { status: "echec", error: "Non distribué (retour Gmail)", sent_at: j(1), last_checked_at: h(20) }, { status: "echec", error: "Gmail a refusé l'envoi : quota", sent_at: h(2) }, { status: "envoye", sent_at: j(60), relance_apres_jours: 4 }],
  renvoyables: [{ id: "m9", nom: "ABRI 2000" }], mailsNouveaux: 2, adressesACorriger: 1, interactionsJour: 4,
  afaire: { rdv: [{ heure: "10:00", client: "Zahara" }], argent: [{ id: 1 }, { id: 2 }], aEncaisser: 6700000, relances: [{ id: 1 }, { id: 2 }, { id: 3 }], relancesAutres: 4, contacts: [{ id: 9 }] }
});

// santé des agents
ok(R.agents.connecte && R.agents.actifs === 2 && R.agents.suspendus === 3 && R.agents.total === 5 && !R.agents.enPause, "agents : 2 actifs, 3 suspendus sur 5, pas en pause");
ok(R.agents.suspendusListe.map((x) => x.nom).join() === "Chercheur 1,Chercheur 2,Rédacteur", "noms des agents suspendus");
// incidents : seulement les 24 dernières heures, regroupés, critiques d'abord, traduits
ok(R.alertes.length === 2 && R.alertes[0].type === "suspension_auto" && R.alertes[0].nb === 2 && R.alertes[0].niveau === "critique", "incidents des 24 h : 2 suspensions automatiques regroupées, en tête (critique)");
ok(!R.alertes.some((a) => a.type === "cle_ia_absente"), "l'incident vieux de 3 jours n'est plus signalé");
ok(/suspendu automatiquement/.test(R.alertes[0].texte) && /erreur pendant l'exécution/.test(R.alertes[1].texte), "incidents en français courant, pas en code");
// travail des agents
ok(R.activite.terminees.length === 2 && R.activite.terminees[0].agent === "Prospection", "terminées aujourd'hui : 2 (pas celle d'hier), avec le nom de l'agent");
ok(R.activite.terminees.map((t) => t.id).join() === "t1,t3" && R.activite.terminees[0].rapport.startsWith("10 prospects"), "ordre : t1 (il y a 2 h) avant t3 (il y a 5 h) ; rapport repris");
ok(R.activite.bloquees.length === 1 && R.activite.bloquees[0].agent === "Qualificateur" && R.activite.enCours.length === 1 && R.activite.enCours[0].id === "t5", "1 mission bloquée, 1 en cours ; la tâche annulée est ignorée");
// activité e-mail
ok(R.commercial.envoyesJour === 1, "e-mails envoyés aujourd'hui : 1 (l'échec d'envoi n'est pas compté)");
ok(R.commercial.reponsesJour === 1 && R.commercial.sansReponse === 1 && R.commercial.nonDistribues === 1, "1 réponse (24 h) ; 1 seul e-mail sans réponse à relancer (celui de 6 j : celui de 2 j n'a pas atteint son délai de 4 j, celui de 60 j est trop ancien) ; 1 non distribué (pas l'échec de quota)");
ok(R.commercial.interactionsJour === 4 && R.commercial.rdv === 1, "4 échanges et 1 rendez-vous aujourd'hui");
// ce qui demande une action humaine
const ids = R.pourVous.map((x) => x.id);
ok(ids.join() === "validations,reponses,renvoyer,rdv,argent,sans_reponse,relances,contacts,adresses,bloquees,suspendus", "ordre : validations, réponses, renvois (urgents), puis rendez-vous, argent, relances…, agents en dernier : " + ids.join());
ok(R.pourVous.slice(0, 3).every((x) => x.niveau === "urgent") && R.pourVous[3].niveau === "normal", "les 3 premiers sont « urgent »");
ok(R.pourVous.find((x) => x.id === "relances").n === 7, "affaires à relancer : 3 affichées + 4 autres = 7");
ok(/6\s?700\s?000/.test(R.pourVous.find((x) => x.id === "argent").detail.replace(/ | /g, " ")), "argent : « 6 700 000 FCFA » à encaisser");
ok(R.pourVous.find((x) => x.id === "renvoyer").action.mailId === "m9" && R.pourVous.find((x) => x.id === "validations").detail.includes("BACID"), "le renvoi pointe l'e-mail concerné ; la validation cite le prospect");
ok(R.total === 11 && /11 points demandent votre attention \(dont 3 urgents\)/.test(R.phrase) && /problème à régler/.test(R.phrase), "phrase de synthèse : 11 points dont 3 urgents + problème côté agents : " + R.phrase);
// coût
ok(R.cout.jour === 1.4 && R.cout.budget === 7 && R.cout.pct === 20 && R.cout.modeleOperationnel === "claude-sonnet-5-5", "coût IA : 1,4 $ sur 7 $ = 20 %");

// pause de gouvernance
const P = B.construire({ now: NOW, session: true, agents, gouvernance: { actif: false, budget_jour_usd: 7 } });
ok(P.agents.enPause && P.alertes[0].type === "pause" && P.alertes[0].niveau === "critique", "entreprise IA en pause : alerte critique en tête");
// sans session d'agents : le CRM seul
const S = B.construire({ now: NOW, session: false, afaire: { rdv: [], argent: [], relances: [{ id: 1 }], contacts: [] }, mails: [] });
ok(!S.agents.connecte && S.total === 1 && S.pourVous[0].id === "relances" && !S.pourVous.some((x) => x.id === "suspendus"), "sans session d'agents : seules les actions CRM sont listées, aucun agent inventé");
ok(S.cout.jour === null && S.cout.budget === null && S.cout.pct === null, "coût inconnu : null, pas de zéro trompeur");
// rien à faire
const V = B.construire({ now: NOW, session: true, agents: [{ id: "a1", nom: "X", etat: "actif" }], afaire: {} });
ok(V.total === 0 && V.alertes.length === 0 && V.phrase === "Rien d'urgent : votre bureau est à jour.", "tout est à jour : message positif");
// peu d'agents suspendus : simple information
const I = B.construire({ now: NOW, session: true, agents: [{ id: "a1", nom: "A", etat: "actif" }, { id: "a2", nom: "B", etat: "actif" }, { id: "a3", nom: "C", etat: "actif" }, { id: "a4", nom: "D", etat: "actif" }, { id: "a5", nom: "E", etat: "suspendu" }], afaire: {} });
ok(I.pourVous[0].id === "suspendus" && I.pourVous[0].niveau === "info", "1 agent suspendu sur 5 : simple information (pas d'alarme)");
ok(B.libelleIncident("zzz").includes("zzz") && B.libelleIncident("budget").includes("budget"), "incident inconnu : le code est cité, jamais de texte vide");
// réponses WhatsApp (API) : une ligne urgente, au singulier comme au pluriel, rien si zéro
const WA1 = B.construire({ now: NOW, session: true, agents: [], waReponses: 1 }), WA3 = B.construire({ now: NOW, session: true, agents: [], waReponses: 3 }), WA0 = B.construire({ now: NOW, session: true, agents: [], waReponses: 0 });
ok(WA1.pourVous[0].id === "wa_reponses" && WA1.pourVous[0].niveau === "urgent" && WA1.pourVous[0].titre === "1 réponse WhatsApp à lire" && WA1.pourVous[0].action.type === "cloche", "1 réponse WhatsApp : ligne urgente, renvoie vers la cloche");
ok(WA3.pourVous[0].titre === "3 réponses WhatsApp à lire" && !WA0.pourVous.some((x) => x.id === "wa_reponses"), "pluriel correct ; aucune ligne s'il n'y a rien");
console.log("Bureau du jour : " + n + " contrôles passés.");
