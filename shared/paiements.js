/* SANIX CRM — Journal des paiements d'une commande (sans interface, testable sous Node).
   Une commande porte une liste `paiements` : { id, date (AAAA-MM-JJ), montant (FCFA), mode, ref (n° de transaction, facultatif), estimee, recu }.
   Le champ historique `acompte` n'est plus saisi : c'est le TOTAL des paiements, recalculé à chaque changement (`recalculer`).
   Une commande ancienne qui n'a qu'un acompte est lue comme un paiement unique « mode non précisé », daté de la vente (date estimée).
   Règles : montant entier > 0 ; jamais plus que le reste dû ; pas de date future ; commande confirmée (ni brouillon ni annulée).
   Comptabilité : une écriture par paiement, à SA date, au compte du mode ; un règlement en nature va en compte d'attente (471), pas en trésorerie. */
(function (G) {
  "use strict";
  var MODES = {
    especes: { lib: "Espèces", compte: "571000", journal: "CA" },
    mobile_money: { lib: "Mobile Money (Wave, Orange, MTN, Moov)", compte: "552000", journal: "BQ" },
    virement: { lib: "Virement bancaire", compte: "521000", journal: "BQ" },
    cheque: { lib: "Chèque", compte: "521000", journal: "BQ" },
    nature: { lib: "Règlement en nature (terrain, matériel…)", compte: "471000", journal: "OD" },
    inconnu: { lib: "Mode non précisé", compte: "552000", journal: "BQ" }
  };
  var num = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var mode = function (m) { return MODES[m] ? m : "inconnu"; };
  var dateOk = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); if (!m) return false; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };

  /** Paiements d'une commande (les lignes sans montant sont ignorées). Ancienne commande : son acompte devient un paiement « estimé ». */
  function liste(c) {
    if (!c) return [];
    if (Array.isArray(c.paiements)) return c.paiements.filter(function (p) { return p && num(p.montant) > 0; });
    return num(c.acompte) > 0 ? [{ id: "p_" + c.id + "_0", date: c.date || "", montant: num(c.acompte), mode: "inconnu", estimee: true }] : [];
  }
  function total(c) { return liste(c).reduce(function (t, p) { return t + num(p.montant); }, 0); }
  function verse(c) { return Math.min(total(c), num(c && c.ttc)); }
  function reste(c) { return Math.max(0, num(c && c.ttc) - total(c)); }
  /** Recalcule les champs historiques : acompte = total des paiements, solde = reste dû. */
  function recalculer(c) { c.acompte = Math.round(total(c)); c.solde = Math.max(0, Math.round(num(c.ttc)) - c.acompte); return c; }
  function figer(c) { if (!Array.isArray(c.paiements)) c.paiements = liste(c).map(function (p) { return Object.assign({}, p); }); return c.paiements; }

  /** Un paiement est-il acceptable ? o : { today (AAAA-MM-JJ), exclure (id du paiement modifié) }. */
  function valider(c, p, o) {
    o = o || {}; var m = Math.round(num(p && p.montant));
    if (!c) return { ok: false, erreur: "commande", msg: "Commande introuvable." };
    if (c.statut === "annulee") return { ok: false, erreur: "statut", msg: "Commande annulée : aucun paiement." };
    if (c.statut === "brouillon") return { ok: false, erreur: "statut", msg: "Commande en brouillon : confirmez-la avant d'enregistrer un paiement (sinon il ne serait pas comptabilisé)." };
    if (!(m > 0)) return { ok: false, erreur: "montant", msg: "Le montant doit être supérieur à 0." };
    if (!dateOk(p.date)) return { ok: false, erreur: "date", msg: "Date invalide (AAAA-MM-JJ)." };
    if (o.today && p.date > o.today) return { ok: false, erreur: "futur", msg: "Un paiement reçu ne peut pas avoir une date future." };
    var autres = liste(c).filter(function (x) { return x.id !== o.exclure; }).reduce(function (t, x) { return t + num(x.montant); }, 0), dispo = num(c.ttc) - autres;
    if (m > dispo + 1e-9) return { ok: false, erreur: "depasse", msg: "Ce paiement (" + m + ") dépasse le reste dû (" + Math.max(0, Math.round(dispo)) + ")." };
    return { ok: true };
  }
  /** Ajoute un paiement ; renvoie { ok, paiement } ou { ok:false, erreur, msg } sans rien modifier. */
  function ajouter(c, p, o) {
    var v = valider(c, p, o); if (!v.ok) return v;
    var l = figer(c), np = { id: p.id || "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: p.date, montant: Math.round(num(p.montant)), mode: mode(p.mode), ref: String(p.ref || "").slice(0, 60) };
    l.push(np); recalculer(c); return { ok: true, paiement: np };
  }
  function modifier(c, id, patch, o) {
    var l = figer(c), p = l.filter(function (x) { return x.id === id; })[0]; if (!p) return { ok: false, erreur: "introuvable", msg: "Paiement introuvable." };
    var cand = Object.assign({}, p, patch), v = valider(c, cand, Object.assign({}, o, { exclure: id })); if (!v.ok) return v;
    p.date = cand.date; p.montant = Math.round(num(cand.montant)); p.mode = mode(cand.mode); p.ref = String(cand.ref || "").slice(0, 60); delete p.estimee; recalculer(c); return { ok: true, paiement: p };
  }
  function supprimer(c, id) { var l = figer(c), n = l.length; c.paiements = l.filter(function (x) { return x.id !== id; }); recalculer(c); return c.paiements.length < n; }

  /** Écritures comptables : une par paiement, à sa date, au compte de son mode, plafonnées au TTC (les versements en trop ne créent pas de créance négative). */
  function ecritures(c) {
    var ttc = num(c && c.ttc), cum = 0, out = [];
    liste(c).map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) { return String(a.p.date).localeCompare(String(b.p.date)) || a.i - b.i; }).forEach(function (x, k) {
      var m = Math.min(num(x.p.montant), ttc - cum); if (!(m > 0)) return; cum += m;
      var md = mode(x.p.mode); out.push({ id: x.p.id, n: k + 1, date: x.p.date, mode: md, lib: MODES[md].lib, compte: MODES[md].compte, journal: MODES[md].journal, montant: m, ref: x.p.ref || "", estimee: !!x.p.estimee });
    });
    return out;
  }
  /** Montant réglé en nature (hors trésorerie). */
  function nature(c) { return ecritures(c).filter(function (e) { return e.mode === "nature"; }).reduce(function (t, e) { return t + e.montant; }, 0); }
  /** Totaux encaissés par mode sur une liste de commandes. */
  function parMode(commandes) {
    var t = {}; Object.keys(MODES).forEach(function (k) { t[k] = 0; });
    (commandes || []).forEach(function (c) { ecritures(c).forEach(function (e) { t[e.mode] += e.montant; }); }); return t;
  }

  var API = { MODES: MODES, liste: liste, total: total, verse: verse, reste: reste, recalculer: recalculer, valider: valider, ajouter: ajouter, modifier: modifier, supprimer: supprimer, ecritures: ecritures, nature: nature, parMode: parMode, dateOk: dateOk };
  G.SanixPaiements = API; if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
