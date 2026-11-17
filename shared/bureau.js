/* SANIX CRM — « Bureau du jour » : une seule page qui dit ce qui demande VOTRE attention aujourd'hui et ce que les agents ont fait.
   Moteur sans interface (testable sous Node) : le CRM lui passe ce qu'il a lu (agents, missions, incidents, validations, e-mails, À faire) et il renvoie
   une synthèse prête à afficher. Il n'écrit rien et n'invente rien : chaque ligne vient d'une donnée réelle. */
(function (G) {
  "use strict";
  var num = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var ms = function (d) { var t = Date.parse(d); return isNaN(t) ? null : t; };
  function debutJour(now) { var d = now ? new Date(now) : new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  var couper = function (t, n) { t = String(t == null ? "" : t).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

  /** Incidents d'agents, en français courant. */
  var INCIDENTS = {
    cle_ia_absente: "La clé de l'IA (Anthropic) est absente ou refusée : les agents ne peuvent pas travailler.",
    suspension_auto: "Un agent a été suspendu automatiquement après des échecs répétés.",
    erreur_execution: "Un agent a rencontré une erreur pendant l'exécution d'une tâche.",
    budget: "Le budget IA a été atteint : les agents sont mis en attente.",
    difficulte: "Un agent signale une difficulté sur sa mission."
  };
  function libelleIncident(type) { return INCIDENTS[type] || "Incident d'agent (« " + String(type || "inconnu") + " »)."; }

  /** o : { now, session, agents[], tachesOuvertes[], tachesTerminees[], incidents[], validations[], gouvernance, coutJour, mails[], renvoyables[], mailsNouveaux, waReponses, afaire, interactionsJour, adressesACorriger } */
  function construire(o) {
    o = o || {}; var now = o.now ? new Date(o.now).getTime() : Date.now(), j0 = debutJour(o.now), h24 = now - 864e5;
    var agentsOk = !!o.session && Array.isArray(o.agents);
    var nom = {}; (o.agents || []).forEach(function (a) { nom[a.id] = a; });

    // ── Santé des agents ──
    var actifs = 0, suspendus = 0, autres = 0, liste = [];
    (o.agents || []).forEach(function (a) { if (a.etat === "actif") actifs++; else if (a.etat === "suspendu") { suspendus++; liste.push({ nom: a.nom, fonction: a.fonction || "" }); } else autres++; });
    var gov = o.gouvernance || null, enPause = !!gov && gov.actif === false;
    var parType = {};
    (o.incidents || []).forEach(function (i) {
      var t = ms(i.created_at); if (t === null || t < h24) return;
      var k = i.type || "autre", e = parType[k] || (parType[k] = { type: k, nb: 0, critique: false, dernier: null, message: "" });
      e.nb++; if (i.gravite === "critique") e.critique = true; if (e.dernier === null || t > e.dernier) { e.dernier = t; e.message = i.message || ""; }
    });
    var alertes = Object.keys(parType).map(function (k) { var e = parType[k]; return { niveau: e.critique ? "critique" : "attention", type: k, nb: e.nb, texte: libelleIncident(k), detail: couper(e.message, 160), quand: e.dernier }; })
      .sort(function (a, b) { return (b.niveau === "critique") - (a.niveau === "critique") || b.nb - a.nb; });
    if (enPause) alertes.unshift({ niveau: "critique", type: "pause", nb: 1, texte: "L'entreprise IA est en pause (gouvernance) : aucun agent ne travaille.", detail: "", quand: null });

    // ── Ce que les agents ont fait ──
    var qui = function (t) { var a = nom[t.agent_id]; return a ? a.nom : "Agent"; };
    var termineesJour = (o.tachesTerminees || []).filter(function (t) { var f = ms(t.finished_at); return f !== null && f >= j0; })
      .sort(function (a, b) { return ms(b.finished_at) - ms(a.finished_at); })
      .map(function (t) { return { id: t.id, titre: couper(t.titre, 90), agent: qui(t), rapport: couper(t.rapport, 160), quand: t.finished_at }; });
    var ouvertes = (o.tachesOuvertes || []).filter(function (t) { return t.statut !== "terminee" && t.statut !== "annulee"; });
    var bloquees = ouvertes.filter(function (t) { return t.statut === "bloquee"; }).map(function (t) { return { id: t.id, titre: couper(t.titre, 90), agent: qui(t), rapport: couper(t.rapport, 160), quand: t.updated_at }; });
    var enCours = ouvertes.filter(function (t) { return t.statut !== "bloquee"; }).map(function (t) { return { id: t.id, titre: couper(t.titre, 90), agent: qui(t), statut: t.statut, quand: t.updated_at }; });

    // ── Activité commerciale du jour (e-mails envoyés par le CRM) ──
    var mails = o.mails || [], envoyesJour = 0, reponsesJour = 0, sansReponse = 0, nonDistribues = 0;
    mails.forEach(function (m) {
      var e = ms(m.sent_at), r = ms(m.replied_at);
      if (e !== null && e >= j0 && m.status !== "echec") envoyesJour++;
      if (m.status === "repondu" && r !== null && r >= h24) reponsesJour++;
      if (m.status === "envoye" && e !== null && now - e >= num(m.relance_apres_jours || 4) * 864e5 && now - e <= 45 * 864e5) sansReponse++;
      if (m.status === "echec" && /distribu/i.test(m.error || "") && (ms(m.last_checked_at || m.sent_at) || 0) >= now - 14 * 864e5) nonDistribues++;
    });
    var af = o.afaire || {}, rdv = (af.rdv || []).length, argent = (af.argent || []).length, relances = (af.relances || []).length + num(af.relancesAutres), contacts = (af.contacts || []).length;

    // ── Ce qui demande votre action, du plus urgent au moins urgent ──
    var pour = [], add = function (x) { pour.push(x); };
    var valid = o.validations || [];
    if (valid.length) add({ id: "validations", ico: "✅", niveau: "urgent", titre: valid.length + " validation" + (valid.length > 1 ? "s" : "") + " d'agent en attente", detail: valid.slice(0, 3).map(function (v) { return (v.type || "") + (v.entreprise ? " — " + v.entreprise : ""); }).join(" · "), action: { type: "validations" }, n: valid.length });
    if (num(o.mailsNouveaux) > 0) add({ id: "reponses", ico: "📩", niveau: "urgent", titre: o.mailsNouveaux + " réponse" + (o.mailsNouveaux > 1 ? "s" : "") + " ou retour" + (o.mailsNouveaux > 1 ? "s" : "") + " d'e-mail à lire", detail: "Ouvrez la cloche pour voir qui a répondu.", action: { type: "cloche" }, n: o.mailsNouveaux });
    if (num(o.waReponses) > 0) add({ id: "wa_reponses", ico: "💬", niveau: "urgent", titre: o.waReponses + " réponse" + (o.waReponses > 1 ? "s" : "") + " WhatsApp à lire", detail: "Ouvrez la cloche pour voir qui a écrit.", action: { type: "cloche" }, n: o.waReponses });
    var rv = o.renvoyables || [];
    if (rv.length) add({ id: "renvoyer", ico: "↻", niveau: "urgent", titre: rv.length + " e-mail" + (rv.length > 1 ? "s" : "") + " à renvoyer : adresse corrigée", detail: rv.slice(0, 3).map(function (r) { return r.nom; }).join(", "), action: { type: "renvoyer", mailId: rv[0].id }, n: rv.length });
    if (rdv) add({ id: "rdv", ico: "📅", niveau: "normal", titre: rdv + " rendez-vous aujourd'hui", detail: (af.rdv || []).slice(0, 3).map(function (r) { return (r.heure ? r.heure + " " : "") + (r.client || ""); }).join(" · "), action: { type: "afaire" }, n: rdv });
    if (argent) add({ id: "argent", ico: "💶", niveau: "normal", titre: argent + " commande" + (argent > 1 ? "s" : "") + " avec un reste à encaisser", detail: "Total à encaisser : " + Math.round(num(af.aEncaisser)).toLocaleString("fr-FR") + " FCFA", action: { type: "afaire" }, n: argent });
    if (sansReponse) add({ id: "sans_reponse", ico: "⏳", niveau: "normal", titre: sansReponse + " e-mail" + (sansReponse > 1 ? "s" : "") + " sans réponse à relancer", detail: "Le délai de relance est dépassé.", action: { type: "afaire" }, n: sansReponse });
    if (relances) add({ id: "relances", ico: "🤝", niveau: "normal", titre: relances + " affaire" + (relances > 1 ? "s" : "") + " à relancer", detail: "", action: { type: "afaire" }, n: relances });
    if (contacts) add({ id: "contacts", ico: "📞", niveau: "normal", titre: contacts + " premier" + (contacts > 1 ? "s" : "") + " contact" + (contacts > 1 ? "s" : "") + " à passer", detail: "Les prospects les mieux valorisés.", action: { type: "afaire" }, n: contacts });
    var corr = num(o.adressesACorriger);
    if (corr) add({ id: "adresses", ico: "⚠️", niveau: "normal", titre: corr + " adresse" + (corr > 1 ? "s" : "") + " e-mail à corriger", detail: "E-mails revenus en erreur : demandez la bonne adresse.", action: { type: "contacts" }, n: corr });
    if (bloquees.length) add({ id: "bloquees", ico: "🚧", niveau: "normal", titre: bloquees.length + " mission" + (bloquees.length > 1 ? "s" : "") + " d'agent bloquée" + (bloquees.length > 1 ? "s" : ""), detail: bloquees.slice(0, 2).map(function (b) { return b.agent + " : " + b.titre; }).join(" · "), action: { type: "agents" }, n: bloquees.length });
    if (agentsOk && suspendus) add({ id: "suspendus", ico: "🛑", niveau: suspendus >= Math.max(3, Math.round((actifs + suspendus) / 3)) ? "normal" : "info", titre: suspendus + " agent" + (suspendus > 1 ? "s" : "") + " suspendu" + (suspendus > 1 ? "s" : ""), detail: liste.slice(0, 3).map(function (l) { return l.nom; }).join(", ") + (suspendus > 3 ? "…" : ""), action: { type: "agents" }, n: suspendus });
    var ordre = { urgent: 0, normal: 1, info: 2 }; pour = pour.map(function (x, i) { x._i = i; return x; }).sort(function (a, b) { return ordre[a.niveau] - ordre[b.niveau] || a._i - b._i; }).map(function (x) { delete x._i; return x; });

    // ── Coût IA du jour ──
    var budget = gov ? num(gov.budget_jour_usd) : null, jour = o.coutJour === null || o.coutJour === undefined ? null : num(o.coutJour);
    var cout = { jour: jour, budget: budget, pct: jour !== null && budget ? Math.round(jour * 100 / budget) : null, modele: gov ? gov.modele : null, modeleOperationnel: gov ? gov.modele_operationnel : null };

    var urgentes = pour.filter(function (x) { return x.niveau === "urgent"; }).length, critiques = alertes.filter(function (a) { return a.niveau === "critique"; }).length;
    var phrase = !pour.length && !critiques ? "Rien d'urgent : votre bureau est à jour." : (pour.length ? pour.length + " point" + (pour.length > 1 ? "s demandent" : " demande") + " votre attention" + (urgentes ? " (dont " + urgentes + " urgent" + (urgentes > 1 ? "s" : "") + ")" : "") + "." : "Rien à traiter côté CRM.") + (critiques ? " Les agents ont un problème à régler." : "");
    return {
      date: new Date(j0).toISOString().slice(0, 10), phrase: phrase, total: pour.length, pourVous: pour,
      agents: { connecte: agentsOk, actifs: actifs, suspendus: suspendus, autres: autres, total: (o.agents || []).length, enPause: enPause, suspendusListe: liste.slice(0, 5) },
      alertes: alertes, activite: { terminees: termineesJour, bloquees: bloquees, enCours: enCours },
      commercial: { envoyesJour: envoyesJour, reponsesJour: reponsesJour, sansReponse: sansReponse, nonDistribues: nonDistribues, interactionsJour: num(o.interactionsJour), rdv: rdv },
      cout: cout
    };
  }
  var API = { construire: construire, libelleIncident: libelleIncident, INCIDENTS: INCIDENTS };
  G.SanixBureau = API; if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
