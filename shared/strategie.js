/* SANIX CRM — Stratégie de conversion par logiciel (sans interface, testable sous Node).
   Mesure ce que rapporte réellement chaque logiciel (chiffre d'affaires HT des commandes, fiches du pipeline, CA par fiche),
   répartit le temps commercial selon le rendement observé et suit chaque semaine les contacts, démos, propositions et ventes.
   L'activité de la semaine se lit dans l'historique des fiches (changements d'étape) et dans les commandes : aucune saisie en double. */
(function (G) {
  "use strict";
  var ACTIFS = { prospect: 1, contact: 1, demo: 1, proposition: 1, negociation: 1 };
  var num = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var ROLES = {
    prioritaire: "Prioritaire : appels et démos",
    groupe: "Offres groupées (modules)",
    automatise: "Automatisé : WhatsApp / e-mail",
    test: "Test pilote : 10 démos d'abord",
    autre: "À définir"
  };
  /** Stratégie de départ (à ajuster dans l'écran) : fondée sur le CA par fiche observé, avec seulement quelques ventes : indicatif. */
  var DEFAUT = {
    "ImmoSuite ERP": { part: 50, role: "prioritaire", contacts: 15, demos: 4, propositions: 2 },
    "Angel's Livraison": { part: 20, role: "groupe", contacts: 6, demos: 2, propositions: 1 },
    "Sanix AluExpert ERP": { part: 20, role: "automatise", contacts: 30, demos: 3, propositions: 2 },
    "MediCore Suite": { part: 10, role: "test", contacts: 10, demos: 3, propositions: 1 }
  };

  /** Un logiciel = une ligne (un client comme Angel's Group n'est pas une famille de produits). */
  function famille(nom) { nom = String(nom || "").trim(); return nom || "(sans logiciel)"; }
  /** Réglages : valeurs par défaut fusionnées avec ceux saisis (cfg = CONFIG.strategie). */
  function reglages(cfg) {
    var out = {}, src = cfg && typeof cfg === "object" ? cfg : {};
    Object.keys(DEFAUT).forEach(function (k) { out[k] = Object.assign({}, DEFAUT[k], src[k] || {}); });
    Object.keys(src).forEach(function (k) { if (!out[k]) out[k] = Object.assign({ part: 0, role: "autre", contacts: 0, demos: 0, propositions: 0 }, src[k]); });
    return out;
  }

  function utc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  /** Lundi de la semaine contenant `now` (AAAA-MM-JJ, calcul en UTC). */
  function lundi(now) { var u = typeof now === "string" ? utc(now) : null; if (u === null) { var d = now ? new Date(now) : new Date(); u = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); } var w = (new Date(u).getUTCDay() + 6) % 7; return iso(u - w * 864e5); }
  /** Étape atteinte décrite par une ligne d'historique (« Prospect → Contact », « Démo réalisée », « Devis envoyé »…), ou null. */
  function etapeAtteinte(h) {
    if (!h || h.type !== "stage_change") return null;
    var t = String(h.note || ""), i = t.lastIndexOf("→"); t = (i >= 0 ? t.slice(i + 1) : t).toLowerCase();
    if (/gagn/.test(t)) return "gagne"; if (/n[ée]goc/.test(t)) return "negociation"; if (/propos|devis/.test(t)) return "proposition"; if (/d[ée]mo/.test(t)) return "demo"; if (/contact/.test(t)) return "contact";
    return null;
  }

  /** Une fiche par couple client + logiciel (les doublons d'import ne comptent pas deux fois). */
  function fichesUniques(deals) {
    var vu = {}, out = [];
    (deals || []).forEach(function (d) { if (!d) return; var k = String(d.client || "").trim().toLowerCase() + "|" + String(d.logiciel || "").trim().toLowerCase(); if (vu[k]) return; vu[k] = 1; out.push(d); });
    return out;
  }

  /** Rendement par famille de logiciels. o : { ht(c) → HT d'une commande, statuts [..], logiciels (catalogue), cfg }. */
  function analyser(commandes, deals, o) {
    o = o || {}; var ht = o.ht || function (c) { return num(c.htNet); }, statuts = o.statuts || ["confirmee", "en_cours", "livree"], rg = reglages(o.cfg), rows = {};
    var get = function (nom) { var f = famille(nom); return rows[f] || (rows[f] = { famille: f, ca: 0, ventes: 0, clients: {}, fiches: 0, gagnes: 0, enCours: 0, prixCatalogue: 0, modules: {} }); };
    (commandes || []).forEach(function (c) {
      if (!c || statuts.indexOf(c.statut) < 0 || c.renouvellement) return;
      var r = get(c.logiciel); r.ca += ht(c); r.ventes++; r.clients[String(c.client || "").trim().toLowerCase()] = 1; r.modules[c.logiciel] = 1;
    });
    fichesUniques(deals).forEach(function (d) { if (d.stage === "perdu") return; var r = get(d.logiciel); r.fiches++; if (d.stage === "gagne") r.gagnes++; else if (ACTIFS[d.stage]) r.enCours++; });
    Object.keys(rg).forEach(function (k) { get(k); });
    (o.logiciels || []).forEach(function (l) { var r = rows[famille(l.nom)]; if (r) r.prixCatalogue = Math.max(r.prixCatalogue, num(l.prixNum)); });
    var total = 0, list = Object.keys(rows).map(function (k) { var r = rows[k]; r.nbClients = Object.keys(r.clients).length; delete r.clients; r.caParFiche = r.fiches > 0 ? r.ca / r.fiches : 0; r.conversion = r.fiches > 0 ? r.gagnes / r.fiches : 0; r.panier = r.ventes > 0 ? r.ca / r.ventes : 0; r.indicatif = r.ventes < 5; r.reglage = rg[k] || null; total += r.ca; return r; });
    list.forEach(function (r) { r.partCA = total > 0 ? r.ca / total : 0; });
    list.sort(function (a, b) { return b.caParFiche - a.caParFiche || b.ca - a.ca; });
    return { lignes: list, caTotal: total, ventes: list.reduce(function (t, r) { return t + r.ventes; }, 0), fiches: list.reduce(function (t, r) { return t + r.fiches; }, 0), reglages: rg };
  }

  /** Part du CA du premier client (concentration) : alerte si > 40 %. */
  function concentration(commandes, o) {
    o = o || {}; var ht = o.ht || function (c) { return num(c.htNet); }, statuts = o.statuts || ["confirmee", "en_cours", "livree"], par = {}, tot = 0;
    (commandes || []).forEach(function (c) { if (!c || statuts.indexOf(c.statut) < 0 || c.renouvellement) return; var k = String(c.client || "").trim().toLowerCase(); par[k] = (par[k] || 0) + ht(c); tot += ht(c); });
    var v = Object.keys(par).map(function (k) { return par[k]; }).sort(function (a, b) { return b - a; });
    return { top1: tot > 0 ? v[0] / tot : 0, top2: tot > 0 ? (v[0] + (v[1] || 0)) / tot : 0, clients: v.length };
  }

  /** Activité de la semaine par famille (du lundi au dimanche) : contacts, démos, propositions, ventes. */
  function semaine(commandes, deals, o) {
    o = o || {}; var d0 = o.debut || lundi(o.now), u0 = utc(d0), u1 = u0 + 7 * 864e5, rg = reglages(o.cfg), ht = o.ht || function (c) { return num(c.htNet); }, statuts = o.statuts || ["confirmee", "en_cours", "livree"], out = {};
    var get = function (nom) { var f = famille(nom); return out[f] || (out[f] = { famille: f, contacts: 0, demos: 0, propositions: 0, gagnes: 0, ventes: 0, ca: 0 }); };
    Object.keys(rg).forEach(function (k) { get(k); });
    var ordre = { contact: 1, demo: 2, proposition: 3, negociation: 4, gagne: 5 };
    fichesUniques(deals).forEach(function (d) {
      var r = get(d.logiciel), vus = {};
      (d.history || []).forEach(function (h) {
        var t = h && h.date ? Date.parse(h.date) : NaN; if (isNaN(t) || t < u0 || t >= u1) return;
        var e = etapeAtteinte(h); if (!e || vus[e]) return; vus[e] = 1;     // une étape compte une fois par fiche et par semaine
        if (e === "contact") r.contacts++; else if (e === "demo") r.demos++; else if (e === "proposition") r.propositions++; else if (e === "gagne") r.gagnes++;
      });
    });
    (commandes || []).forEach(function (c) { var u = utc(c.date); if (!c || statuts.indexOf(c.statut) < 0 || c.renouvellement || u === null || u < u0 || u >= u1) return; var r = get(c.logiciel); r.ventes++; r.ca += ht(c); });
    var lignes = Object.keys(out).map(function (k) { var r = out[k], g = rg[k] || { contacts: 0, demos: 0, propositions: 0 }; r.objectif = { contacts: num(g.contacts), demos: num(g.demos), propositions: num(g.propositions) };
      var pc = [["contacts", "contacts"], ["demos", "demos"], ["propositions", "propositions"]].filter(function (x) { return r.objectif[x[0]] > 0; }).map(function (x) { return Math.min(1, r[x[1]] / r.objectif[x[0]]); });
      r.avancement = pc.length ? pc.reduce(function (a, b) { return a + b; }, 0) / pc.length : null; return r; });
    return { debut: d0, fin: iso(u1 - 864e5), lignes: lignes };
  }

  /** Les parts de temps font-elles 100 % ? */
  function totalParts(rg) { return Object.keys(rg).reduce(function (t, k) { return t + num(rg[k].part); }, 0); }

  var API = { famille: famille, reglages: reglages, analyser: analyser, concentration: concentration, semaine: semaine, lundi: lundi, etapeAtteinte: etapeAtteinte, fichesUniques: fichesUniques, totalParts: totalParts, ROLES: ROLES, DEFAUT: DEFAUT };
  G.SanixStrategie = API; if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
