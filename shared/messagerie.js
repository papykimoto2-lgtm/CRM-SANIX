/* SANIX CRM — Messagerie commerciale : à qui peut-on écrire, par quel canal, et le message est-il prêt à partir ?
   Moteur sans interface (testable sous Node). Le CRM lui passe ce qu'il sait (fiches, qualité des coordonnées, e-mails rejetés, historique)
   et il répond : qui est joignable, qui est exclu et POURQUOI, et ce qu'il manque dans un message. Il n'envoie rien et n'écrit rien. */
(function (G) {
  "use strict";
  var low = function (s) { return String(s == null ? "" : s).toLowerCase(); };
  var strip = function (s) { return low(s).normalize("NFD").replace(/[̀-ͯ]/g, ""); };

  /** Raisons d'exclusion, en français courant (clé → libellé). */
  var RAISONS = {
    sans_numero: "Pas de numéro de téléphone",
    fixe: "Numéro fixe : pas de WhatsApp",
    numero_invalide: "Numéro invalide",
    pas_whatsapp: "Marqué « pas sur WhatsApp »",
    sans_email: "Pas d'adresse e-mail",
    email_invalide: "Adresse e-mail invalide ou incertaine",
    email_rebond: "E-mail déjà revenu en erreur à cette adresse",
    deja_contacte: "Déjà contacté récemment"
  };

  /** Contacts → { retenus:[{c, cible}], exclus:{raison:[c]}, nbExclus, total }.
      ctx : { qualite(c) → {tel:{ok,kind,reason}, em:{ok,principal}, wa, mail}, morte(email) → bool, recent(c, jours) → bool }
      f   : { statut:'prospect'|'client'|'tous', logiciel, secteur, etape (nombre ou ''), texte, joursSansContact (0 = ne pas exclure) }
      etapeDe(c) → nombre (étape de conversion). */
  function cibler(clients, canal, f, ctx, etapeDe) {
    f = f || {}; ctx = ctx || {};
    var retenus = [], exclus = {}, total = 0, st = f.statut || "prospect", q = strip(f.texte || "");
    (clients || []).forEach(function (c) {
      if (!c) return;
      if (st !== "tous" && c.statut !== st) return;
      if (f.logiciel && c.logiciel !== f.logiciel) return;
      if (f.secteur && c.secteur !== f.secteur) return;
      if (f.etape !== "" && f.etape !== undefined && f.etape !== null && etapeDe && etapeDe(c) !== Number(f.etape)) return;
      if (q && strip([c.nom, c.adresse, c.ville, c.contact, c.secteur].join(" ")).indexOf(q) < 0) return;
      total++;
      var raison = "", cible = "", qu = ctx.qualite ? ctx.qualite(c) : null;
      if (canal === "wa") {
        if (!qu) raison = "sans_numero";
        else if (qu.tel.kind === "vide" || (!String(c.phone || "").trim())) raison = "sans_numero";
        else if (!qu.wa) raison = qu.tel.kind === "fixe" ? "fixe" : "numero_invalide";
        else if (c.wa === "non") raison = "pas_whatsapp";
        else cible = qu.tel.num;
      } else {
        if (!String(c.email || "").trim()) raison = "sans_email";
        else if (!qu || !qu.em.ok) raison = "email_invalide";
        else if (ctx.morte && ctx.morte(qu.em.principal)) raison = "email_rebond";
        else cible = qu.em.principal;
      }
      if (!raison && f.joursSansContact > 0 && ctx.recent && ctx.recent(c, f.joursSansContact)) raison = "deja_contacte";
      if (raison) (exclus[raison] = exclus[raison] || []).push(c); else retenus.push({ c: c, cible: cible });
    });
    var nb = 0; Object.keys(exclus).forEach(function (k) { nb += exclus[k].length; });
    return { retenus: retenus, exclus: exclus, nbExclus: nb, total: total };
  }

  /** Ce qui empêche d'envoyer ce texte : { x } non remplis, [passages à compléter], faux numéro. */
  function manques(texte) {
    var t = String(texte == null ? "" : texte), out = [];
    (t.match(/\{[a-zA-Z_]+\}/g) || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    (t.match(/\[[^\]\n]{2,}\]/g) || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    if (/\bXX[ .]XX\b/.test(t)) out.push("XX XX");
    return out;
  }

  /** « Objet : … » en tête d'un modèle e-mail → { objet, corps }. */
  function separerObjet(msg) {
    var m = /^\s*Objet\s*:\s*([^\n]*)\n+([\s\S]*)$/i.exec(String(msg || ""));
    return m ? { objet: m[1].trim(), corps: m[2] } : { objet: "", corps: String(msg || "") };
  }

  /** Combien d'e-mails peut-on encore envoyer aujourd'hui (plafond glissant 24 h) ? mails : [{sent_at,status}] */
  function resteGmail(mails, now, plafond) {
    var lim = (now || Date.now()) - 864e5, n = 0;
    (mails || []).forEach(function (m) { var t = Date.parse(m.sent_at); if (!isNaN(t) && t >= lim && m.status !== "echec") n++; });
    return Math.max(0, (plafond || 100) - n);
  }

  /** Découpe un envoi : combien partent maintenant, combien restent. */
  function lot(nb, reste) { var n = Math.max(0, Math.min(nb, reste)); return { partent: n, restent: Math.max(0, nb - n) }; }

  /** Phrase de synthèse du ciblage. */
  function resume(res, canal) {
    var c = canal === "wa" ? "WhatsApp" : "e-mail", n = res.retenus.length;
    return n + " joignable" + (n > 1 ? "s" : "") + " par " + c + (res.nbExclus ? " · " + res.nbExclus + " exclu" + (res.nbExclus > 1 ? "s" : "") : "") + " sur " + res.total;
  }

  /** Une ligne d'historique des envois. */
  function ligneHistorique(o) {
    return { date: o.date || new Date().toISOString(), canal: o.canal, mode: o.mode, statut: o.statut, client_id: o.client_id == null ? null : o.client_id, nom: String(o.nom || ""), extrait: String(o.extrait || "").replace(/\s+/g, " ").trim().slice(0, 90), commercial: String(o.commercial || "—"), erreur: o.erreur ? String(o.erreur).slice(0, 160) : "" };
  }
  /** Garde les `max` envois les plus récents. */
  function ajouter(hist, ligne, max) { var h = (hist || []).slice(); h.unshift(ligne); return h.slice(0, max || 500); }

  var API = { RAISONS: RAISONS, cibler: cibler, manques: manques, separerObjet: separerObjet, resteGmail: resteGmail, lot: lot, resume: resume, ligneHistorique: ligneHistorique, ajouter: ajouter };
  G.SanixMessagerie = API; if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
