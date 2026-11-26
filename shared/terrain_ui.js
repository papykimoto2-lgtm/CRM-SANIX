/* SANIX CRM — Terrain : interface (feuille de route, géolocalisation en tournée, supervision, indicateurs).
   Données : fonctions SQL terrain_* (migration 20261220000000) appelées avec la session opérateur (aisApi). Prospects : CLIENTS du CRM.
   Vie privée : la position n'est envoyée que pendant une tournée démarrée, avec consentement ; arrêt à la clôture. */
(function (G) {
  "use strict";
  var T = G.SanixTerrain, S = { tab: "jour", dir: null, profil: null, equipe: [], jour: null, tournees: [], kpi: [], live: [], rapports: [], watch: null, wake: null, dernierEnvoi: 0, pos: null, periode: 30, carte: null, calques: [], sel: {} };
  var $ = function (id) { return document.getElementById(id); };
  var E = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var rpc = function (nom, args) { return G.aisApi("/rest/v1/rpc/" + nom, { method: "POST", body: JSON.stringify(args || {}) }); };
  var toast = function (m) { try { G.showToast(m); } catch (e) { /* ignoré */ } };
  var auj = function () { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  var connecte = function () { try { return !!G.aisSession(); } catch (e) { return false; } };
  var msgErr = function (e) { return E((e && e.message) || "Erreur"); };

  var clients = function () { try { return G.__terrainClients ? G.__terrainClients() : []; } catch (e) { return []; } };
  // Identifiant de l'opérateur connecté : champ « sub » du jeton de session (le serveur revérifie toujours : auth.uid()).
  function uid() { try { var t = (G.aisSession() || {}).t || "", p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(p + "===".slice((p.length + 3) % 4))).sub || ""; } catch (e) { return ""; } }
  function racine() { return $("view-terrain"); }
  function charger() {
    var el = racine(); if (!el) return Promise.resolve();
    if (!connecte()) { el.innerHTML = '<h1 class="page-title">📍 Terrain</h1><div class="card" style="padding:16px">Connectez l\'agent IA (session opérateur) pour utiliser le module Terrain.</div>'; return Promise.resolve(); }
    var jour = S.jour || auj();
    return Promise.all([
      G.aisApi("/rest/v1/terrain_profils?select=*&user_id=eq." + encodeURIComponent(uid())).catch(function () { return null; }),
      rpc("terrain_equipe").then(function (x) { S.dir = true; return x; }).catch(function () { S.dir = false; return []; }),
      rpc("terrain_feuille", { p_jour: jour, p_commercial: null }).catch(function () { return []; })
    ]).then(function (r) {
      S.profil = r[0] && r[0][0] ? r[0][0] : null; S.equipe = r[1] || []; S.tournees = r[2] || [];
      if (!S.dir && !S.profil) return rpc("terrain_feuille", { p_jour: jour }).then(function (t) { S.tournees = t || []; });
    }).then(function () { if (S.dir) return Promise.all([rpc("terrain_live").then(function (x) { S.live = x || []; }), rpc("terrain_rapports_a_valider").then(function (x) { S.rapports = x || []; })]).catch(function () { /* affichage partiel */ }); })
      .then(function () { return S.tab === "perf" ? chargerKpi() : null; }).then(rendre);
  }
  function chargerKpi() {
    var d = new Date(); d.setDate(d.getDate() - (S.periode - 1));
    var depuis = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return rpc("terrain_kpi", { p_depuis: depuis, p_jusqua: auj() }).then(function (k) { S.kpi = k || []; });
  }

  // ─────────── Rendu ───────────
  function rendre() {
    var el = racine(); if (!el) return;
    var nb = (S.rapports || []).filter(function (r) { return r.statut === "soumis"; }).length;
    var onglets = [["jour", "📅 Ma journée"]].concat(S.dir ? [["supervision", "🛰️ Supervision" + (nb ? " (" + nb + ")" : "")]] : []).concat([["perf", "📊 Performance"]]);
    el.innerHTML = '<h1 class="page-title">📍 Terrain</h1><p class="page-sub">Feuille de route, géolocalisation en tournée, rapport de mission et indicateurs</p>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' + onglets.map(function (o) { return '<button class="btn btn-sm ' + (S.tab === o[0] ? "" : "btn-outline") + '" onclick="Terrain.onglet(\'' + o[0] + '\')">' + o[1] + '</button>'; }).join("") + '</div>'
      + '<div id="terrain-corps"></div>';
    var c = $("terrain-corps");
    c.innerHTML = S.tab === "supervision" && S.dir ? vueSupervision() : S.tab === "perf" ? vuePerf() : vueJour();
    if (S.tab === "supervision" && S.dir) setTimeout(carteLive, 50);
    if (S.tab === "jour") reprendreSuivi();
  }

  function bandeauConsentement() {
    if (S.profil && S.profil.geoloc_consent_at) return "";
    return '<div class="card" style="padding:14px;margin-bottom:12px;border-left:4px solid var(--orange)"><b>🔒 Géolocalisation en tournée</b>'
      + '<p style="margin:6px 0;font-size:13px">Votre position est transmise à la direction <b>uniquement pendant une tournée démarrée</b>, jamais en dehors. Elle sert à vérifier votre présence chez les prospects et à calculer la distance parcourue. Conservation : 30 jours. Vous pouvez retirer votre accord à tout moment.</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select class="form-input" id="tr-mob" style="max-width:220px">' + Object.keys(T.MOBILITES).map(function (k) { return '<option value="' + k + '"' + (k === "moto" ? " selected" : "") + '>' + T.MOBILITES[k].ico + " " + T.MOBILITES[k].nom + '</option>'; }).join("") + '</select>'
      + '<button class="btn btn-sm" onclick="Terrain.consentir()">J\'accepte la géolocalisation en tournée</button></div></div>';
  }

  function vueJour() {
    var mob = (S.profil && S.profil.mobilite) || "moto", h = bandeauConsentement();
    var moi = S.tournees.filter(function (t) { return !S.dir || t.commercial === uid(); });
    var liste = S.dir ? S.tournees : moi;
    h += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap"><label class="form-label" style="margin:0">Jour</label><input type="date" class="form-input" style="max-width:170px" value="' + E(S.jour || auj()) + '" onchange="Terrain.jour(this.value)">'
      + '<button class="btn btn-sm" onclick="Terrain.formulairePlanif()">➕ Planifier une tournée</button></div><div id="tr-planif"></div>';
    if (!liste.length) h += '<div class="card" style="padding:16px;color:var(--muted)">Aucune tournée ce jour. Planifiez-en une : choisissez des prospects de la base, l\'ordre de visite se calcule par proximité.</div>';
    liste.forEach(function (t) { h += carteTournee(t, mob); });
    return h;
  }

  function carteTournee(t, mob) {
    var proprio = t.commercial === uid(), etapes = t.etapes || [], faits = etapes.filter(function (e) { return e.statut !== "a_visiter"; }).length;
    var pct = etapes.length ? Math.round(100 * faits / etapes.length) : 0, enCours = t.statut === "en_cours";
    var badge = { planifiee: "badge-muted", en_cours: "badge-success", terminee: "badge-info", annulee: "badge-danger" }[t.statut] || "badge-muted";
    var p = T.parcours(etapes.filter(function (e) { return e.statut === "a_visiter" || e.statut === "reporte" || t.statut !== "en_cours"; }), S.pos, mob);
    var h = '<div class="card" style="padding:14px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b>' + E(t.titre) + '</b>' + (S.dir ? ' · ' + E(t.nom) : '') + '<div style="font-size:12px;color:var(--muted)">' + E(t.zone || "") + ' · ' + etapes.length + ' prospects · ~' + T.km(p.metres) + ' · ~' + T.duree(p.minutes) + ' de trajet</div></div><span class="badge ' + badge + '">' + E({ planifiee: "Planifiée", en_cours: "En cours", terminee: "Terminée", annulee: "Annulée" }[t.statut] || t.statut) + '</span></div>'
      + '<div style="height:8px;background:var(--surface2);border-radius:4px;margin:10px 0"><div style="height:100%;width:' + pct + '%;background:var(--success);border-radius:4px"></div></div>';
    if (enCours && proprio) h += '<div id="tr-suivi" style="font-size:12px;color:var(--success);margin-bottom:8px">📡 Position partagée avec la direction pendant la tournée</div>';
    etapes.forEach(function (e) { h += ligneEtape(t, e, proprio, enCours, mob); });
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">';
    if (proprio && t.statut === "planifiee") h += '<button class="btn btn-sm" onclick="Terrain.demarrer(\'' + t.id + '\')">▶️ Démarrer la tournée</button>';
    if (proprio && enCours) h += '<button class="btn btn-sm" onclick="Terrain.formulaireFin(\'' + t.id + '\')">🏁 Terminer et envoyer le rapport</button>';
    if ((proprio || S.dir) && (t.statut === "planifiee" || enCours)) h += '<button class="btn btn-sm btn-outline" onclick="Terrain.annuler(\'' + t.id + '\')">Annuler</button>';
    h += '</div>';
    if (t.rapport) h += '<div style="margin-top:10px;padding:10px;background:var(--surface2);border-radius:8px;font-size:13px"><b>Rapport de mission</b> · ' + E({ soumis: "transmis à la direction", valide: "validé ✅", a_revoir: "à revoir ⚠️" }[t.rapport.statut] || t.rapport.statut) + '<br>' + E(t.rapport.resume || "") + (t.rapport.commentaire ? '<br><i>Direction : ' + E(t.rapport.commentaire) + '</i>' : '') + '</div>';
    return h + '</div>';
  }

  function ligneEtape(t, e, proprio, enCours, mob) {
    var ico = { a_visiter: "⬜", visite: "✅", absent: "🚪", reporte: "⏭️", refuse: "⛔" }[e.statut] || "⬜", client = clientDe(e.client_rid);
    var nav = T.valide(e.lat, e.lng) ? 'https://www.google.com/maps/dir/?api=1&destination=' + e.lat + ',' + e.lng + '&travelmode=' + ({ pied: "walking", velo: "bicycling", moto: "two-wheeler", voiture: "driving", transport: "transit" }[mob] || "driving") : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((e.nom || "") + " " + (e.adresse || ""));
    var h = '<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--border)"><div style="font-size:18px">' + ico + '</div><div style="flex:1;min-width:0"><div><b>' + e.ordre + '. ' + E(e.nom) + '</b> '
      + (e.presence_verifiee ? '<span class="badge badge-success" title="Position GPS confirmée chez le prospect">📍 présence vérifiée</span>' : e.arrivee_at && e.distance_m != null ? '<span class="badge badge-danger" title="Position éloignée du prospect">⚠ à ' + e.distance_m + ' m</span>' : '') + '</div>'
      + '<div style="font-size:12px;color:var(--muted)">' + E(e.adresse || "adresse non renseignée") + (T.valide(e.lat, e.lng) ? "" : " · 📍 non géolocalisé") + (e.issue ? ' · ' + E(T.ISSUES[e.issue]) : "") + (e.rdv_at ? ' · RDV ' + E(new Date(e.rdv_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })) : "") + '</div>'
      + (e.note ? '<div style="font-size:12px">' + E(e.note) + '</div>' : "")
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><a class="btn btn-sm btn-outline" target="_blank" rel="noopener" href="' + E(nav) + '">🧭 Itinéraire</a>'
      + (client && client.phone ? '<a class="btn btn-sm btn-outline" href="tel:' + E(String(client.phone).replace(/[^+\d]/g, "")) + '">📞</a>' : "")
      + (client ? '<button class="btn btn-sm btn-outline" onclick="showClientDetail(' + client.id + ')">Fiche</button>' : "");
    if (proprio && enCours && (e.statut === "a_visiter" || e.statut === "reporte")) h += '<button class="btn btn-sm" onclick="Terrain.arrivee(\'' + e.id + '\')">📍 Je suis arrivé</button><button class="btn btn-sm" onclick="Terrain.formulaireResultat(\'' + e.id + '\')">📝 Résultat</button>';
    return h + '</div></div></div>';
  }

  function clientDe(rid) { try { return clients().find(function (c) { return String(c.id) === String(rid); }) || null; } catch (e) { return null; } }
  function trouverEtape(id) { var r = null; S.tournees.forEach(function (t) { (t.etapes || []).forEach(function (e) { if (e.id === id) r = { t: t, e: e }; }); }); return r; }

  // ─────────── Actions du commercial ───────────
  function consentir() {
    var m = $("tr-mob") ? $("tr-mob").value : "moto";
    rpc("terrain_consentir", { p_mobilite: m }).then(function (p) { S.profil = p; toast("🔒 Géolocalisation en tournée acceptée"); rendre(); }).catch(function (e) { toast("❌ " + (e.message || e)); });
  }
  function position(un) {
    if (S.pos && S.posAt && Date.now() - S.posAt < 20000) return Promise.resolve(S.pos);   // fix récent du suivi : pas de seconde demande GPS
    return new Promise(function (ok, ko) {
      if (!navigator.geolocation) return ko(new Error("Géolocalisation indisponible sur cet appareil"));
      navigator.geolocation.getCurrentPosition(function (p) { S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy || 0) }; S.posAt = Date.now(); ok(S.pos); },
        function (e) { ko(new Error(e.code === 1 ? "Position refusée : autorisez la localisation dans le navigateur" : "Position indisponible, réessayez en extérieur")); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: un ? 0 : 15000 });
    });
  }
  function demarrer(id) {
    position(true).catch(function () { return null; }).then(function () { return rpc("terrain_demarrer", { p_tournee: id }); })
      .then(function () { toast("▶️ Tournée démarrée : bonne route !"); return charger(); }).catch(function (e) { toast("❌ " + (e.message || e)); });
  }
  function annuler(id) { if (!confirm("Annuler cette tournée ?")) return; rpc("terrain_annuler", { p_tournee: id }).then(function () { arreterSuivi(); return charger(); }).catch(function (e) { toast("❌ " + (e.message || e)); }); }

  // Suivi : un point au plus toutes les 10 s, uniquement tournée en cours et page ouverte (le navigateur suspend le suivi si l'écran est verrouillé).
  function reprendreSuivi() {
    var t = S.tournees.find(function (x) { return x.statut === "en_cours" && x.commercial === uid(); });
    if (!t) { arreterSuivi(); return; }
    if (S.watch !== null || !navigator.geolocation) return;
    S.watch = navigator.geolocation.watchPosition(function (p) {
      S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy || 0) }; S.posAt = Date.now();
      var n = Date.now(); if (n - S.dernierEnvoi < 10000) return; S.dernierEnvoi = n;
      rpc("terrain_position", { p_tournee: t.id, p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_precision: S.pos.precision, p_vitesse: p.coords.speed >= 0 ? p.coords.speed : null }).catch(function () { /* hors ligne : point perdu, sans gravité */ });
    }, function () { var s = $("tr-suivi"); if (s) { s.style.color = "var(--danger)"; s.textContent = "⚠ Position indisponible : vérifiez l'autorisation de localisation"; } }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (w) { S.wake = w; }).catch(function () {}); } catch (e) { /* facultatif */ }
  }
  function arreterSuivi() { if (S.watch !== null) { navigator.geolocation.clearWatch(S.watch); S.watch = null; } try { if (S.wake) { S.wake.release(); S.wake = null; } } catch (e) { /* ignoré */ } }

  function arrivee(idEtape) {
    position(true).then(function (p) { return rpc("terrain_arrivee", { p_etape: idEtape, p_lat: p.lat, p_lng: p.lng, p_precision: p.precision }); })
      .then(function (r) {
        var x = trouverEtape(idEtape), c = x && clientDe(x.e.client_rid);
        if (r.position_prospect_fixee && c && !T.valide(c.lat, c.lng)) { c.lat = r.lat; c.lng = r.lng; c.geo_source = "terrain"; c.updated_at = new Date().toISOString(); try { G.saveStore("clients"); } catch (e) { /* ignoré */ } toast("📍 Position du prospect enregistrée dans sa fiche"); }
        else toast(r.presence_verifiee ? "✅ Présence vérifiée" : "⚠ Vous semblez à " + r.distance_m + " m du prospect");
        return charger();
      }).catch(function (e) { toast("❌ " + (e.message || e)); });
  }

  function modale(html) {
    var m = $("tr-modale"); if (!m) { m = document.createElement("div"); m.id = "tr-modale"; m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center"; document.body.appendChild(m); }
    m.innerHTML = '<div class="card" style="width:100%;max-width:560px;max-height:92vh;overflow:auto;padding:16px;border-radius:16px 16px 0 0;background:var(--surface,#fff)">' + html + '</div>'; m.style.display = "flex";
  }
  function fermer() { var m = $("tr-modale"); if (m) m.style.display = "none"; }

  function formulaireResultat(id) {
    var x = trouverEtape(id); if (!x) return;
    modale('<h3 style="margin:0 0 8px">📝 ' + E(x.e.nom) + '</h3>'
      + '<label class="form-label">Résultat de la visite</label><select class="form-input" id="tr-st" onchange="Terrain.champsIssue()">' + ["visite", "absent", "reporte", "refuse"].map(function (k) { return '<option value="' + k + '">' + E(T.STATUTS[k]) + '</option>'; }).join("") + '</select>'
      + '<div id="tr-issue-bloc"><label class="form-label" style="margin-top:8px">Issue</label><select class="form-input" id="tr-issue">' + Object.keys(T.ISSUES).map(function (k) { return '<option value="' + k + '">' + E(T.ISSUES[k]) + '</option>'; }).join("") + '</select>'
      + '<div id="tr-rdv-bloc"><label class="form-label" style="margin-top:8px">Date du rendez-vous</label><input type="datetime-local" class="form-input" id="tr-rdv"></div>'
      + '<label class="form-label" style="margin-top:8px">Montant estimé (FCFA)</label><input type="number" min="0" class="form-input" id="tr-val" placeholder="0"></div>'
      + '<label class="form-label" style="margin-top:8px">Note (décideur rencontré, besoin, objection…)</label><textarea class="form-input" id="tr-note" rows="3" maxlength="1000"></textarea>'
      + '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn" onclick="Terrain.enregistrerResultat(\'' + id + '\')">Enregistrer</button><button class="btn btn-outline" onclick="Terrain.fermer()">Fermer</button></div>');
    champsIssue();
  }
  function champsIssue() { var v = $("tr-st") && $("tr-st").value === "visite", b = $("tr-issue-bloc"); if (b) b.style.display = v ? "" : "none"; var r = $("tr-rdv-bloc"); if (r && $("tr-issue")) r.style.display = $("tr-issue").value === "rdv_pris" ? "" : "none"; if ($("tr-issue")) $("tr-issue").onchange = champsIssue; }
  function enregistrerResultat(id) {
    var st = $("tr-st").value, issue = st === "visite" ? $("tr-issue").value : null, rdv = $("tr-rdv") && $("tr-rdv").value ? new Date($("tr-rdv").value).toISOString() : null;
    if (issue === "rdv_pris" && !rdv) { toast("Indiquez la date du rendez-vous"); return; }
    var x = trouverEtape(id), note = $("tr-note").value.trim();
    rpc("terrain_resultat", { p_etape: id, p_statut: st, p_issue: issue, p_note: note, p_rdv: rdv, p_valeur: $("tr-val").value ? Math.round(Number($("tr-val").value)) : null }).then(function (r) {
      var c = clientDe(r.client_rid);   // interaction dans la fiche prospect de la base
      if (c) {
        if (!c.interactions) c.interactions = [];
        var it = T.interaction({ statut: st, issue: issue, note: note, presence: r.presence_verifiee }); c.interactions.push(it);
        try { if (typeof G.qlAvancer === "function" && it.etape > (G.aiGetEtape ? G.aiGetEtape(c) : 0)) G.qlAvancer(c, it.etape, issue === "devis" || issue === "vente" ? Number($("tr-val").value) || 0 : 0, true); } catch (e) { /* étape non avancée */ }
        c.updated_at = new Date().toISOString(); try { G.saveStore("clients"); } catch (e) { /* ignoré */ }
      }
      fermer(); toast("✅ Résultat enregistré" + (c ? " dans la fiche de " + c.nom : "")); return charger();
    }).catch(function (e) { toast("❌ " + (e.message || e)); });
    void x;
  }
  function formulaireFin(id) {
    modale('<h3 style="margin:0 0 8px">🏁 Rapport de mission</h3><p style="font-size:12px;color:var(--muted)">Les prospects non visités passent en « reporté ». Le rapport part à la direction avec vos chiffres (visites, RDV, distance).</p>'
      + '<label class="form-label">Résumé de la journée *</label><textarea class="form-input" id="tr-res" rows="4" maxlength="3000" placeholder="Zones couvertes, prospects marquants, suites à donner…"></textarea>'
      + '<label class="form-label" style="margin-top:8px">Difficultés rencontrées</label><textarea class="form-input" id="tr-dif" rows="2" maxlength="2000"></textarea>'
      + '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn" onclick="Terrain.terminer(\'' + id + '\')">Envoyer le rapport</button><button class="btn btn-outline" onclick="Terrain.fermer()">Fermer</button></div>');
  }
  function terminer(id) {
    var r = $("tr-res").value.trim(); if (r.length < 10) { toast("Résumé trop court (10 caractères au moins)"); return; }
    rpc("terrain_terminer", { p_tournee: id, p_resume: r, p_difficultes: $("tr-dif").value.trim() }).then(function (x) { arreterSuivi(); fermer(); toast("🏁 Rapport envoyé : " + x.stats.visites + " visite(s), " + T.km(x.stats.km * 1000)); return charger(); }).catch(function (e) { toast("❌ " + (e.message || e)); });
  }

  // ─────────── Planification (prospects de la base) ───────────
  function formulairePlanif() {
    var el = $("tr-planif"); if (!el) return; if (el.innerHTML) { el.innerHTML = ""; return; }
    var logiciels = [], secteurs = [];
    (clients()).forEach(function (c) { if (c.statut === "prospect") { if (c.logiciel && logiciels.indexOf(c.logiciel) < 0) logiciels.push(c.logiciel); if (c.secteur && secteurs.indexOf(c.secteur) < 0) secteurs.push(c.secteur); } });
    var opt = function (a) { return '<option value="">Tous</option>' + a.sort().map(function (x) { return '<option>' + E(x) + '</option>'; }).join(""); };
    el.innerHTML = '<div class="card" style="padding:14px;margin-bottom:12px"><b>Nouvelle tournée</b>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0">'
      + (S.dir ? '<div><label class="form-label">Commercial</label><select class="form-input" id="tp-com">' + S.equipe.filter(function (m) { return m.role === "commercial"; }).map(function (m) { return '<option value="' + m.user_id + '">' + E(m.nom) + '</option>'; }).join("") + '</select></div>' : "")
      + '<div><label class="form-label">Titre</label><input class="form-input" id="tp-titre" value="Prospection ' + E(new Date().toLocaleDateString("fr-FR")) + '"></div>'
      + '<div><label class="form-label">Zone / ville</label><input class="form-input" id="tp-ville" placeholder="Marcory, Yopougon…" oninput="Terrain.filtrer()"></div>'
      + '<div><label class="form-label">Logiciel</label><select class="form-input" id="tp-log" onchange="Terrain.filtrer()">' + opt(logiciels) + '</select></div>'
      + '<div><label class="form-label">Secteur</label><select class="form-input" id="tp-sec" onchange="Terrain.filtrer()">' + opt(secteurs) + '</select></div></div>'
      + '<label style="font-size:12px"><input type="checkbox" id="tp-geo" onchange="Terrain.filtrer()"> Seulement les prospects géolocalisés</label> · <label style="font-size:12px"><input type="checkbox" id="tp-rec" checked onchange="Terrain.filtrer()"> Exclure les visités ces 14 jours</label>'
      + '<div id="tp-liste" style="max-height:320px;overflow:auto;margin-top:8px"></div>'
      + '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn btn-sm btn-outline" onclick="Terrain.toutCocher(true)">Tout cocher</button><button class="btn btn-sm btn-outline" onclick="Terrain.toutCocher(false)">Tout décocher</button><button class="btn btn-sm" onclick="Terrain.creerTournee()">Créer la tournée (<span id="tp-n">0</span>)</button></div></div>';
    S.sel = {}; position(false).catch(function () { return null; }).then(filtrer);
  }
  function filtrer() {
    var l = $("tp-liste"); if (!l) return;
    S.cand = T.candidats(clients(), { ville: $("tp-ville").value, logiciel: $("tp-log").value, secteur: $("tp-sec").value, seulementGeolocalises: $("tp-geo").checked, joursSansVisite: $("tp-rec").checked ? 14 : 0 }, S.pos);
    var top = S.cand.slice(0, 150);
    l.innerHTML = top.length ? top.map(function (c, i) { return '<label style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px"><input type="checkbox" data-rid="' + E(c.client_rid) + '" ' + (S.sel[c.client_rid] ? "checked" : "") + ' onchange="Terrain.cocher(this.dataset.rid,this.checked)"><span><b>' + (i + 1) + '. ' + E(c.nom) + '</b><br><span style="color:var(--muted);font-size:11px">' + E(c.adresse) + (c.lat === null ? " · 📍 non géolocalisé" : "") + '</span></span></label>'; }).join("") + (S.cand.length > 150 ? '<div style="font-size:12px;color:var(--muted);padding:6px">' + (S.cand.length - 150) + ' autres : affinez les filtres.</div>' : "")
      : '<div style="color:var(--muted);padding:8px">Aucun prospect pour ces critères.</div>';
    majN();
  }
  function cocher(rid, v) { if (v) S.sel[rid] = 1; else delete S.sel[rid]; majN(); }
  function toutCocher(v) { S.sel = {}; if (v) (S.cand || []).slice(0, 60).forEach(function (c) { S.sel[c.client_rid] = 1; }); filtrer(); }
  function majN() { var n = Object.keys(S.sel).length; if ($("tp-n")) $("tp-n").textContent = n; }
  function creerTournee() {
    var choisis = (S.cand || []).filter(function (c) { return S.sel[c.client_rid]; });
    if (!choisis.length) { toast("Cochez au moins un prospect"); return; } if (choisis.length > 60) { toast("60 prospects au plus par tournée"); return; }
    var ord = T.ordonner(choisis, S.pos), com = $("tp-com") ? $("tp-com").value : uid();
    rpc("terrain_planifier", { p_commercial: com, p_jour: S.jour || auj(), p_titre: $("tp-titre").value.trim() || "Prospection", p_zone: $("tp-ville").value.trim() || null, p_etapes: ord.map(function (c) { return { client_rid: c.client_rid, nom: c.nom, adresse: c.adresse, lat: c.lat, lng: c.lng }; }) })
      .then(function () { toast("✅ Tournée créée : " + ord.length + " prospects, ordre par proximité"); S.sel = {}; return charger(); }).catch(function (e) { toast("❌ " + (e.message || e)); });
  }

  // ─────────── Supervision (direction) ───────────
  function vueSupervision() {
    var h = '<div class="card" style="padding:14px;margin-bottom:12px"><b>🛰️ Commerciaux en tournée</b> <span style="font-size:12px;color:var(--muted)">(dernière position connue)</span>'
      + '<div id="tr-carte" style="height:320px;border-radius:10px;margin:10px 0;overflow:hidden"></div>';
    h += S.live.length ? S.live.map(function (l) {
      var min = l.at ? Math.round((Date.now() - Date.parse(l.at)) / 60000) : null;
      return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--border);font-size:13px"><span>' + (T.MOBILITES[l.mobilite] || T.MOBILITES.moto).ico + ' <b>' + E(l.nom) + '</b> · ' + E(l.titre) + '</span><span>' + l.visites + '/' + l.etapes + ' visites · ' + (min === null ? "pas de position" : min < 2 ? "à l\'instant" : "il y a " + min + " min") + '</span></div>';
    }).join("") : '<div style="color:var(--muted);font-size:13px">Aucune tournée en cours.</div>';
    h += '</div><div class="card" style="padding:14px"><b>📨 Rapports de mission</b>';
    h += S.rapports.length ? S.rapports.map(function (r) {
      var s = r.stats || {};
      return '<div style="padding:10px 0;border-top:1px solid var(--border)"><div style="display:flex;justify-content:space-between;gap:8px"><span><b>' + E(r.nom) + '</b> · ' + E(r.titre) + ' · ' + E(r.jour) + '</span><span class="badge ' + (r.statut === "valide" ? "badge-success" : r.statut === "a_revoir" ? "badge-danger" : "badge-warn") + '">' + E({ soumis: "À valider", valide: "Validé", a_revoir: "À revoir" }[r.statut]) + '</span></div>'
        + '<div style="font-size:12px;color:var(--muted)">' + (s.visites || 0) + ' visites sur ' + (s.etapes || 0) + ' · ' + (s.rdv || 0) + ' RDV · ' + (s.devis || 0) + ' devis · ' + (s.ventes || 0) + ' vente(s) · ' + T.km((s.km || 0) * 1000) + ' · présence vérifiée ' + (s.presence_verifiee || 0) + '/' + (s.visites || 0) + '</div>'
        + '<div style="font-size:13px;margin-top:4px">' + E(r.resume) + (r.difficultes ? '<br><i>Difficultés : ' + E(r.difficultes) + '</i>' : "") + '</div>'
        + (r.statut === "soumis" ? '<div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-sm" onclick="Terrain.valider(\'' + r.tournee_id + '\',\'valide\')">✅ Valider</button><button class="btn btn-sm btn-outline" onclick="Terrain.valider(\'' + r.tournee_id + '\',\'a_revoir\')">↩ À revoir</button></div>' : "") + '</div>';
    }).join("") : '<div style="color:var(--muted);font-size:13px;margin-top:6px">Aucun rapport récent.</div>';
    return h + '</div>';
  }
  function valider(id, st) { var com = st === "a_revoir" ? prompt("Commentaire pour le commercial :") : ""; if (st === "a_revoir" && com === null) return; rpc("terrain_valider_rapport", { p_tournee: id, p_statut: st, p_commentaire: com || null }).then(function () { return charger(); }).catch(function (e) { toast("❌ " + (e.message || e)); }); }
  function carteLive() {
    var d = $("tr-carte"); if (!d || !G.L) return;
    if (S.carte) { try { S.carte.remove(); } catch (e) { /* ignoré */ } S.carte = null; }
    S.carte = G.L.map(d).setView([5.3, -4.02], 11); G.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(S.carte);
    var pts = [];
    S.live.forEach(function (l) { if (!T.valide(l.lat, l.lng)) return; pts.push([l.lat, l.lng]); G.L.marker([l.lat, l.lng]).addTo(S.carte).bindPopup("<b>" + E(l.nom) + "</b><br>" + E(l.titre) + "<br>" + l.visites + "/" + l.etapes + " visites"); });
    S.tournees.forEach(function (t) { (t.etapes || []).forEach(function (e) { if (T.valide(e.lat, e.lng)) G.L.circleMarker([e.lat, e.lng], { radius: 5, color: e.statut === "visite" ? "#059669" : "#94a3b8", fillOpacity: .8 }).addTo(S.carte).bindPopup(E(e.nom)); }); });
    if (pts.length) S.carte.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  }

  // ─────────── Performance ───────────
  function vuePerf() {
    var k = S.kpi || [], h = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px"><label class="form-label" style="margin:0">Période</label><select class="form-input" style="max-width:150px" onchange="Terrain.periode(this.value)">' + [7, 30, 90].map(function (p) { return '<option value="' + p + '"' + (S.periode === p ? " selected" : "") + '>' + p + ' jours</option>'; }).join("") + '</select>'
      + (S.dir && k.length ? '<button class="btn btn-sm btn-outline" onclick="Terrain.exporter()">⬇ Export Excel (CSV)</button>' : "") + '</div>';
    if (!k.length) return h + '<div class="card" style="padding:16px;color:var(--muted)">Aucune donnée sur la période.</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">';
    k.forEach(function (x) {
      var n = T.niveau(x.score), col = { bon: "var(--success)", moyen: "var(--orange)", faible: "var(--danger)" }[n];
      h += '<div class="card" style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center"><b>' + (T.MOBILITES[x.mobilite] || T.MOBILITES.moto).ico + ' ' + E(x.nom) + '</b><span style="font-size:22px;font-weight:800;color:' + col + '">' + x.score + '<small style="font-size:11px;color:var(--muted)">/100</small></span></div>'
        + '<div style="height:6px;background:var(--surface2);border-radius:3px;margin:8px 0"><div style="height:100%;width:' + x.score + '%;background:' + col + ';border-radius:3px"></div></div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px"><span>Visites : <b>' + x.visites + '</b> / ' + x.etapes + '</span><span>Réalisation : <b>' + x.taux_realisation_pct + ' %</b></span>'
        + '<span>Visites/jour : <b>' + x.visites_par_jour + '</b> (obj. ' + x.objectif + ')</span><span>Jours actifs : <b>' + x.jours_actifs + '</b></span>'
        + '<span>RDV : <b>' + x.rdv + '</b></span><span>Devis : <b>' + x.devis + '</b></span><span>Ventes : <b>' + x.ventes + '</b></span><span>Valeur : <b>' + Number(x.valeur_fcfa).toLocaleString("fr-FR") + '</b> F</span>'
        + '<span>Distance : <b>' + T.km(x.km * 1000) + '</b></span><span>Durée visite : <b>' + T.duree(x.duree_visite_min) + '</b></span><span>Présence vérifiée : <b>' + x.presence_pct + ' %</b></span><span>Absents/refus : <b>' + x.absents + '/' + x.refus + '</b></span></div></div>';
    });
    return h + '</div><p style="font-size:11px;color:var(--muted);margin-top:10px">Score /100 = activité 40 (visites/jour vs objectif) + présence vérifiée 20 + conversion 30 (RDV, devis, ventes ≥ 30 % des visites) + régularité 10 (jours actifs / jours ouvrés).</p>';
  }
  function exporter() {
    var b = new Blob([T.csv(S.kpi)], { type: "text/csv;charset=utf-8" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "terrain_performance_" + auj() + ".csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  G.Terrain = {
    init: function () { charger(); }, onglet: function (t) { S.tab = t; (t === "perf" ? chargerKpi() : Promise.resolve()).then(function () { if (t === "supervision") return charger(); rendre(); }); },
    jour: function (j) { S.jour = j || auj(); charger(); }, periode: function (p) { S.periode = Number(p) || 30; chargerKpi().then(rendre); },
    consentir: consentir, demarrer: demarrer, annuler: annuler, arrivee: arrivee, formulaireResultat: formulaireResultat, champsIssue: champsIssue, enregistrerResultat: enregistrerResultat,
    formulaireFin: formulaireFin, terminer: terminer, fermer: fermer, formulairePlanif: formulairePlanif, filtrer: filtrer, cocher: cocher, toutCocher: toutCocher, creerTournee: creerTournee, valider: valider, exporter: exporter
  };
})(typeof window !== "undefined" ? window : globalThis);
