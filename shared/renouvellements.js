/* SANIX CRM — Renouvellements et maintenance : moteur d'échéances (sans interface, testable sous Node).
   Une échéance = une licence à renouveler :
     · abonnement (Annuelle, Mensuelle, SaaS, Triennale) : à la date de fin de la licence ;
     · maintenance d'une licence perpétuelle : à la date de fin de maintenance (par défaut 1 an après l'activation ; « sans maintenance » l'exclut).
   Le moteur calcule le palier de relance (J-60, J-30, J-15, J-7, expirée), le montant à facturer, le texte de relance WhatsApp,
   la facture de renouvellement (commande en brouillon, identifiant dérivé de la licence et de l'échéance : jamais en double)
   et la prolongation de la licence. Il n'écrit nulle part : le CRM applique les résultats. */
(function (G) {
  "use strict";
  var PALIERS = [["j7", 7], ["j15", 15], ["j30", 30], ["j60", 60]];
  var ABONNEMENTS = { Annuelle: 1, Mensuelle: 1, SaaS: 1, Triennale: 1 };
  var num = function (v) { v = Number(v); return isFinite(v) && v > 0 ? v : 0; };

  /* Dates en texte AAAA-MM-JJ, calculées en UTC pour ne dépendre d'aucun fuseau horaire. */
  function utc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function jour(now) { var d = now ? new Date(now) : new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  function ecart(date, now) { var u = utc(date); return u === null ? null : Math.round((u - jour(now)) / 864e5); }
  /** Ajoute des mois en gardant le jour (31 janvier + 1 mois = 28 ou 29 février). */
  function ajouterMois(date, n) {
    var u = utc(date); if (u === null) return null; var d = new Date(u), y = d.getUTCFullYear(), m = d.getUTCMonth() + n, j = d.getUTCDate();
    var fin = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return iso(Date.UTC(y, m, Math.min(j, fin)));
  }
  function moisPeriode(type, kind) { return kind === "maintenance" ? 12 : type === "Annuelle" ? 12 : type === "Triennale" ? 36 : 1; }
  function palier(jours) { if (jours === null) return null; if (jours < 0) return "expire"; for (var i = 0; i < PALIERS.length; i++) if (jours <= PALIERS[i][1]) return PALIERS[i][0]; return null; }
  var LIB = { expire: "expirée", j7: "J-7", j15: "J-15", j30: "J-30", j60: "J-60" };

  /** Montant HT d'un renouvellement : valeur saisie sur la licence, sinon prix du catalogue (mensuel ; annuel = 10 mensualités ; maintenance = % du prix de la licence). */
  function montant(lic, log, cfg) {
    var saisi = num(lic.renouvMontant); if (saisi) return Math.round(saisi);
    log = log || {}; cfg = cfg || {}; var mens = num(log.prixMensuel);
    if (lic.type === "Perpetuelle") return Math.round(num(log.prixNum) * (num(lic.maintPct) || num(cfg.maintenancePct) || 12) / 100);
    if (lic.type === "Mensuelle" || lic.type === "SaaS") return Math.round(mens);
    if (lic.type === "Annuelle") return Math.round(mens * 10);
    if (lic.type === "Triennale") return Math.round(mens * 10 * 3);
    return 0;
  }

  /** Échéance d'une licence (ou null : essai, suspendue, sans date, sans maintenance). */
  function echeance(lic, logiciels, o) {
    o = o || {}; if (!lic || lic.statut === "suspendue" || lic.type === "Essai" || lic.statut === "essai") return null;
    var kind, due;
    if (lic.type === "Perpetuelle") { if (lic.maintNon) return null; kind = "maintenance"; due = lic.maintFin || ajouterMois(lic.debut, 12); }
    else if (ABONNEMENTS[lic.type] && lic.fin) { kind = "abonnement"; due = lic.fin; }
    else return null;
    if (!due) return null;
    var jours = ecart(due, o.now); if (jours === null) return null;
    var log = (logiciels || []).filter(function (l) { return l && l.nom === lic.logiciel; })[0];
    var p = palier(jours), rel = (lic.relances || []).filter(function (r) { return r.due === due; }), der = rel.length ? rel[rel.length - 1] : null;
    var deja = !!(p && rel.some(function (r) { return r.palier === p; }));
    return { licId: lic.id, client: lic.client, logiciel: lic.logiciel, type: lic.type, kind: kind, due: due, jours: jours, palier: p, libelle: p ? LIB[p] : null,
      montantHT: montant(lic, log, o.cfg), relanceDue: !!p && !deja, derniere: der, finPrevue: ajouterMois(jours >= -30 ? due : iso(jour(o.now)), moisPeriode(lic.type, kind)) };
  }
  /** Toutes les échéances, triées de la plus urgente à la plus lointaine. */
  function echeances(licences, logiciels, o) {
    return (licences || []).map(function (l) { return echeance(l, logiciels, o); }).filter(Boolean).sort(function (a, b) { return a.jours - b.jours; });
  }

  var fmt = function (n) { return Math.round(n).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " "); };
  var dfr = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; };
  /** Texte de relance WhatsApp adapté au palier. */
  function message(e, cfg) {
    cfg = cfg || {}; var soc = cfg.societe || "SANIX", quoi = e.kind === "maintenance" ? "contrat de maintenance de " + e.logiciel : "licence " + e.logiciel;
    var prix = e.montantHT > 0 ? " Le renouvellement est de " + fmt(e.montantHT) + " " + (cfg.devise || "FCFA") + " HT." : "";
    var tete = "Bonjour " + e.client + ", ";
    if (e.palier === "expire") return tete + "votre " + quoi + " est arrivé(e) à échéance le " + dfr(e.due) + "." + prix + " Souhaitez-vous le/la renouveler pour continuer sans interruption ? " + soc;
    if (e.palier === "j7") return tete + "votre " + quoi + " expire dans " + e.jours + " jour" + (e.jours > 1 ? "s" : "") + " (le " + dfr(e.due) + ")." + prix + " Pouvons-nous régler le renouvellement cette semaine ? " + soc;
    return tete + "votre " + quoi + " arrive à échéance le " + dfr(e.due) + "." + prix + " Je vous envoie la facture de renouvellement dès votre accord. " + soc;
  }

  /** Identifiant de la facture de renouvellement : le même sur tous les appareils pour une même licence et une même échéance. */
  function idCommande(e) { return "renouv_" + String(e.licId).replace(/[^A-Za-z0-9_.:-]/g, "_") + "_" + e.due; }
  /** Facture de renouvellement : commande en brouillon, repérée « renouvellement » pour ne pas être comptée comme une nouvelle vente. */
  function commande(e, o) {
    o = o || {}; var taux = o.tva === undefined ? 18 : o.tva, ht = Math.round(num(e.montantHT)), tva = Math.round(ht * taux / 100);
    return { id: idCommande(e), ref: o.ref || "", client: e.client, date: o.today || iso(jour()), logiciel: e.logiciel, typeLicence: e.kind === "maintenance" ? "Maintenance" : e.type,
      htBrut: ht, remise: 0, htNet: ht, tva: tva, ttc: ht + tva, acompte: 0, solde: ht + tva, sansTva: taux === 0, commercial: o.commercial || "", statut: "brouillon",
      presId: "", notes: (e.kind === "maintenance" ? "Renouvellement de la maintenance" : "Renouvellement de l'abonnement") + " — échéance du " + dfr(e.due) + " → " + dfr(e.finPrevue),
      renouvellement: true, licId: e.licId, renouvDue: e.due, renouvJusqua: e.finPrevue };
  }
  /** Modifications à appliquer à la licence quand le renouvellement est confirmé (la période repart de l'échéance, sauf si elle est dépassée de plus de 30 jours). */
  function prolonger(lic, e, o) {
    o = o || {}; var patch = { statut: "active", alerte30: false, alerte7: false, alerte1: false, updatedAt: new Date().toISOString() };
    if (e.kind === "maintenance") patch.maintFin = e.finPrevue; else patch.fin = e.finPrevue;
    patch.renouvellements = (lic.renouvellements || []).concat([{ date: o.today || iso(jour()), de: e.due, a: e.finPrevue, cmdId: o.cmdId || "", montantHT: e.montantHT }]);
    return patch;
  }
  /** Pour la lecture du modèle financier : total des renouvellements facturés (hors brouillons et annulations). */
  function bilan(commandes) {
    var t = { n: 0, ht: 0, ttc: 0, encaisse: 0, creance: 0, brouillons: 0 };
    (commandes || []).forEach(function (c) {
      if (!c || !c.renouvellement) return; if (c.statut === "brouillon") { t.brouillons++; return; } if (c.statut === "annulee") return;
      var ttc = num(c.ttc) || num(c.htNet), verse = Math.min(ttc, num(c.acompte)); t.n++; t.ht += num(c.htNet); t.ttc += ttc; t.encaisse += verse; t.creance += ttc - verse;
    });
    return t;
  }

  var API = { echeance: echeance, echeances: echeances, montant: montant, message: message, idCommande: idCommande, commande: commande, prolonger: prolonger, bilan: bilan, palier: palier, ecart: ecart, ajouterMois: ajouterMois, LIB: LIB };
  G.SanixRenouv = API; if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
