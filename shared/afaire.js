/* SANIX CRM — « À faire aujourd'hui » : la liste du jour, triée par urgence (sans interface, testable sous Node).
   Quatre blocs : rendez-vous du jour, argent à encaisser, affaires engagées à relancer, premiers contacts à passer.
   Le moteur ne lit rien lui-même : le CRM lui passe ses données et ses fonctions (étape d'un prospect, prochaine action, valeur, reste dû). */
(function (G) {
  "use strict";
  var num = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  function jour(now) { var d = now ? new Date(now) : new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function utc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function ecart(depuis, now) { var a = utc(depuis), b = utc(jour(now)); return a === null ? null : Math.max(0, Math.round((b - a) / 864e5)); }
  var STATUTS = ["confirmee", "en_cours", "livree"];

  /** o : { now, clients, commandes, rdvs, echeances,
            f : { etape(c), nba(c), valeur(c), reste(cmd), perdu(c), completude(c), dernierPaiement(cmd) },
            limites : { relances, contacts } } */
  function construire(o) {
    o = o || {}; var f = o.f || {}, lim = Object.assign({ relances: 10, contacts: 5 }, o.limites || {}), auj = jour(o.now);
    var rdv = (o.rdvs || []).filter(function (r) { return r && r.date === auj && r.statut !== "annule" && r.statut !== "fait" && r.statut !== "termine"; })
      .sort(function (a, b) { return String(a.heure || "").localeCompare(String(b.heure || "")); })
      .map(function (r) { return { id: r.id, clientId: r.clientId, client: r.client, heure: r.heure || "", type: r.type || "", lieu: r.lieu || "", visio: r.visio || "" }; });

    var argent = (o.commandes || []).filter(function (c) { return c && STATUTS.indexOf(c.statut) >= 0 && num(f.reste ? f.reste(c) : c.solde) > 0; })
      .map(function (c) {
        var reste = Math.round(num(f.reste ? f.reste(c) : c.solde)), dernier = f.dernierPaiement ? f.dernierPaiement(c) : null, depuis = ecart(dernier || c.date, o.now);
        return { id: c.id, ref: c.ref, client: c.client, reste: reste, ttc: num(c.ttc), jours: depuis, urgence: depuis !== null && depuis > 30 ? "haute" : depuis !== null && depuis > 14 ? "moyenne" : "normale", renouvellement: !!c.renouvellement };
      })
      .sort(function (a, b) { return b.reste - a.reste; });

    var echeances = (o.echeances || []).filter(function (e) { return e && e.relanceDue; })
      .map(function (e) { return { licId: e.licId, client: e.client, logiciel: e.logiciel, palier: e.libelle, due: e.due, jours: e.jours, montantHT: e.montantHT }; });

    var relancesTous = (o.clients || []).filter(function (c) { return c && c.statut === "prospect" && !(f.perdu && f.perdu(c)) && num(f.etape ? f.etape(c) : 0) >= 1; })
      .map(function (c) { var n = f.nba ? f.nba(c) : {}; return { id: c.id, nom: c.nom, logiciel: c.logiciel || "", etape: num(f.etape(c)), label: n.label || "", urg: num(n.urg), retard: n.overdue ? Math.max(1, num(n.days) - num(n.cadence)) : 0, jours: n.days === null || n.days === undefined ? null : n.days, valeur: f.valeur ? f.valeur(c) : num(c.valeur), phone: c.phone || "", enRetard: !!n.overdue }; })
      .filter(function (x) { return x.jours !== 0 && (x.enRetard || x.urg >= 2); })      // une affaire déjà touchée aujourd'hui sort de la liste jusqu'à demain
      .sort(function (a, b) { return b.urg - a.urg || b.retard - a.retard || b.valeur - a.valeur || String(a.nom).localeCompare(String(b.nom)); });
    var relances = relancesTous.slice(0, lim.relances);

    var contacts = (o.clients || []).filter(function (c) { return c && c.statut === "prospect" && !(f.perdu && f.perdu(c)) && num(f.etape ? f.etape(c) : 0) === 0 && String(c.phone || "").trim(); })
      .map(function (c) { return { id: c.id, nom: c.nom, logiciel: c.logiciel || "", valeur: f.valeur ? f.valeur(c) : num(c.valeur), phone: c.phone, k: f.completude ? f.completude(c) : 0 }; })
      .sort(function (a, b) { return b.valeur - a.valeur || b.k - a.k || String(a.nom).localeCompare(String(b.nom)); })
      .slice(0, lim.contacts);

    // E-mails envoyés par le CRM (Gmail) restés sans réponse au-delà de leur délai de relance.
    var mails = (o.mails || []).filter(function (m) { return m && m.status === "envoye"; })
      .map(function (m) { var j = ecart(m.sent_at, o.now); return { id: m.id, clientId: m.clientId || null, client: m.client || m.to_email, to: m.to_email, sujet: m.subject, jours: j === null ? 0 : j, relanceJours: num(m.relance_apres_jours) || 4 }; })
      .filter(function (m) { return m.jours >= m.relanceJours && m.jours <= 45; })
      .sort(function (x, y) { return y.jours - x.jours; }).slice(0, 10);

    var total = rdv.length + argent.length + echeances.length + relances.length + contacts.length + mails.length;
    return { date: auj, rdv: rdv, argent: argent, echeances: echeances, relances: relances, relancesAutres: Math.max(0, relancesTous.length - relances.length), contacts: contacts, mails: mails, total: total,
      aEncaisser: argent.reduce(function (t, x) { return t + x.reste; }, 0) };
  }
  var API = { construire: construire, jour: jour, ecart: ecart };
  G.SanixAFaire = API; if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
