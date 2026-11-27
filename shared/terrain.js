/* SANIX CRM — Terrain : logique pure (sans interface, testable sous Node).
   Distances, ordre de visite par proximité, temps de trajet selon la mobilité, sélection des prospects d'une tournée, couleurs d'indicateurs, export CSV. */
(function (G) {
  "use strict";
  var num = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var strip = function (s) { return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };
  var valide = function (lat, lng) { return lat !== null && lat !== "" && lng !== null && lng !== "" && isFinite(Number(lat)) && isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180 && !(Number(lat) === 0 && Number(lng) === 0); };

  /** Distance à vol d'oiseau en mètres (haversine). */
  function distance(a, b) {
    if (!a || !b || !valide(a.lat, a.lng) || !valide(b.lat, b.lng)) return null;
    var R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Vitesse moyenne réaliste en ville (km/h) et coefficient de détour routier selon la mobilité. */
  var MOBILITES = {
    pied: { nom: "À pied", ico: "🚶", kmh: 4, detour: 1.25 },
    velo: { nom: "Vélo", ico: "🚲", kmh: 12, detour: 1.3 },
    moto: { nom: "Moto", ico: "🏍️", kmh: 22, detour: 1.35 },
    voiture: { nom: "Voiture", ico: "🚗", kmh: 18, detour: 1.4 },
    transport: { nom: "Transport en commun", ico: "🚌", kmh: 14, detour: 1.5 }
  };
  function minutesTrajet(metres, mobilite) {
    var m = MOBILITES[mobilite] || MOBILITES.moto;
    return metres === null || metres === undefined ? null : Math.max(1, Math.round((metres * m.detour / 1000) / m.kmh * 60));
  }

  /** Ordonne des étapes par plus proche voisin depuis un point de départ ; celles sans coordonnées restent à la fin, dans leur ordre. */
  function ordonner(etapes, depart) {
    var avec = [], sans = [];
    (etapes || []).forEach(function (e) { (valide(e.lat, e.lng) ? avec : sans).push(e); });
    var cur = depart && valide(depart.lat, depart.lng) ? depart : (avec[0] ? { lat: Number(avec[0].lat), lng: Number(avec[0].lng) } : null), out = [];
    while (avec.length) {
      var bi = 0, bd = Infinity;
      for (var i = 0; i < avec.length; i++) { var d = distance(cur, { lat: Number(avec[i].lat), lng: Number(avec[i].lng) }); if (d !== null && d < bd) { bd = d; bi = i; } }
      var p = avec.splice(bi, 1)[0]; out.push(p); cur = { lat: Number(p.lat), lng: Number(p.lng) };
    }
    return out.concat(sans);
  }

  /** Distance totale (m) et durée estimée (min) d'un parcours ordonné. */
  function parcours(etapes, depart, mobilite) {
    var pts = (etapes || []).filter(function (e) { return valide(e.lat, e.lng); }).map(function (e) { return { lat: Number(e.lat), lng: Number(e.lng) }; });
    if (depart && valide(depart.lat, depart.lng)) pts.unshift({ lat: Number(depart.lat), lng: Number(depart.lng) });
    var m = 0; for (var i = 1; i < pts.length; i++) m += distance(pts[i - 1], pts[i]) || 0;
    return { metres: Math.round(m), minutes: pts.length > 1 ? minutesTrajet(m, mobilite) : 0, geolocalises: pts.length - (depart && valide(depart.lat, depart.lng) ? 1 : 0), sansPosition: (etapes || []).length - pts.length + (depart && valide(depart.lat, depart.lng) ? 1 : 0) };
  }

  /** Prospects candidats à une tournée : filtres ville/secteur/logiciel/texte, jamais visités récemment, tri par proximité. */
  function candidats(clients, f, depart, maintenant) {
    f = f || {}; var q = strip(f.texte || ""), now = maintenant || Date.now(), seuil = (f.joursSansVisite === undefined ? 14 : f.joursSansVisite) * 864e5;
    var liste = (clients || []).filter(function (c) {
      if (!c || c.statut !== "prospect") return false;
      if (f.logiciel && c.logiciel !== f.logiciel) return false;
      if (f.secteur && c.secteur !== f.secteur) return false;
      if (f.ville && strip(c.ville || c.adresse || "").indexOf(strip(f.ville)) < 0) return false;
      if (f.seulementGeolocalises && !valide(c.lat, c.lng)) return false;
      if (q && strip([c.nom, c.adresse, c.ville, c.contact, c.secteur].join(" ")).indexOf(q) < 0) return false;
      if (seuil > 0) { var v = (c.interactions || []).filter(function (i) { return i && i.type === "Visite terrain"; }).map(function (i) { return Date.parse(i.date) || 0; }).sort().pop(); if (v && now - v < seuil) return false; }
      return true;
    }).map(function (c) { return { client_rid: String(c.id), nom: c.nom, adresse: c.adresse || c.ville || "", lat: valide(c.lat, c.lng) ? Number(c.lat) : null, lng: valide(c.lat, c.lng) ? Number(c.lng) : null, secteur: c.secteur || "", logiciel: c.logiciel || "", phone: c.phone || "" }; });
    return ordonner(liste, depart);
  }

  /** Interaction à consigner dans la fiche prospect après une visite. */
  var ISSUES = { interesse: "Intéressé", demo_prevue: "Démo prévue", rdv_pris: "Rendez-vous pris", devis: "Devis demandé", vente: "Vente conclue", sans_suite: "Sans suite" };
  var STATUTS = { a_visiter: "À visiter", visite: "Visité", absent: "Absent", reporte: "Reporté", refuse: "Refus" };
  function interaction(r, quand) {
    var etape = { interesse: 1, demo_prevue: 2, rdv_pris: 2, devis: 3, vente: 5, sans_suite: 0 }[r.issue] || (r.statut === "visite" ? 1 : 0);
    var txt = r.statut === "visite" ? "Visite terrain — " + (ISSUES[r.issue] || "visité") : "Visite terrain — " + (STATUTS[r.statut] || r.statut);
    return { date: new Date(quand || Date.now()).toISOString(), type: "Visite terrain", note: txt + (r.note ? " : " + String(r.note).slice(0, 300) : "") + (r.presence ? " (présence vérifiée GPS)" : ""), etape: etape, ico: "📍" };
  }

  /** Couleur d'un score /100 et d'un pourcentage. */
  function niveau(score) { score = num(score); return score >= 75 ? "bon" : score >= 50 ? "moyen" : "faible"; }
  function duree(min) { min = Math.round(num(min)); return min < 60 ? min + " min" : Math.floor(min / 60) + " h " + String(min % 60).padStart(2, "0"); }
  function km(m) { return (Math.round(num(m) / 100) / 10).toLocaleString("fr-FR") + " km"; }

  /** Export CSV (séparateur « ; », BOM pour Excel) des indicateurs. */
  function csv(kpis) {
    var cols = [["nom", "Commercial"], ["mobilite", "Mobilité"], ["tournees", "Tournées"], ["etapes", "Prospects planifiés"], ["visites", "Visites"], ["taux_realisation_pct", "Réalisation %"], ["absents", "Absents"], ["refus", "Refus"], ["rdv", "RDV"], ["devis", "Devis"], ["ventes", "Ventes"], ["valeur_fcfa", "Valeur FCFA"], ["km", "Km"], ["jours_actifs", "Jours actifs"], ["visites_par_jour", "Visites/jour"], ["duree_visite_min", "Durée visite (min)"], ["presence_pct", "Présence vérifiée %"], ["score", "Score /100"]];
    var esc = function (v) { v = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return "﻿" + [cols.map(function (c) { return esc(c[1]); }).join(";")].concat((kpis || []).map(function (k) { return cols.map(function (c) { return esc(k[c[0]]); }).join(";"); })).join("\r\n");
  }

  G.SanixTerrain = { valide: valide, distance: distance, MOBILITES: MOBILITES, minutesTrajet: minutesTrajet, ordonner: ordonner, parcours: parcours, candidats: candidats, ISSUES: ISSUES, STATUTS: STATUTS, interaction: interaction, niveau: niveau, duree: duree, km: km, csv: csv };
  if (typeof module !== "undefined" && module.exports) module.exports = G.SanixTerrain;
})(typeof window !== "undefined" ? window : globalThis);
