/* SANIX CRM Pro — connecteur CRM ↔ SANIX AI (navigateur).
   Le CRM garde son stockage local (localStorage) : il continue de fonctionner hors ligne et pendant la migration.
   Ce module le synchronise avec la base centrale (Supabase) par des appels RPC authentifiés (session opérateur), jamais avec une clé secrète :
   - sauvegarde locale avant le premier envoi, import initial idempotent (aucun événement pour l'historique) ;
   - file d'envoi persistante (clés modifiées seulement) : rejeu sans doublon, reprise automatique avec délai croissant ;
   - fusion à la réception : une modification locale non envoyée n'est jamais écrasée ; aucune suppression locale sans suppression explicite ;
   - les agents IA travaillent côté serveur : ce module ne fait que transporter et afficher (fiche client, missions, synchronisation).
   Documentation et correspondance exacte des objets : supabase/CONNECTEUR_CRM_IA.md */
(function () {
  'use strict';
  if (window.SanixCrmSync) return;

  var NS = 'sanix_crm_', STATE_KEY = NS + 'sync_v1', OUTBOX_KEY = NS + 'outbox_v1', BACKUP_PREFIX = NS + 'backup_', AIS_TOK = 'sanix_ais_session', RDV_LS = 'sanix_crm_rdv';
  var BATCH = 100, MAX_BYTES = 1500000, PULL_OVERLAP = 100, POLL_MS = 20000;

  // ── Correspondance magasin du CRM → entité serveur ───────────────────────────
  // idMode « int » : identifiant local propre au navigateur (max + 1) → identifiant stable `_rid` ; « str » : l'identifiant du CRM (préfixe_horodatage) est déjà stable.
  var STORES = {
    clients:       { ls: 'clients',       idMode: 'int', prefix: 'c', get: function () { return LS_STORES.clients.get(); },       set: function (v) { LS_STORES.clients.set(v); } },
    deals:         { ls: 'deals',         idMode: 'int', prefix: 'd', get: function () { return LS_STORES.deals.get(); },         set: function (v) { LS_STORES.deals.set(v); } },
    commandes:     { ls: 'commandes',     idMode: 'str', get: function () { return LS_STORES.commandes.get(); },                  set: function (v) { LS_STORES.commandes.set(v); } },
    contrats:      { ls: 'contrats',      idMode: 'str', get: function () { return LS_STORES.contrats.get(); },                   set: function (v) { LS_STORES.contrats.set(v); } },
    licences:      { ls: 'licences',      idMode: 'str', get: function () { return LS_STORES.licences.get(); },                   set: function (v) { LS_STORES.licences.set(v); } },
    documents:     { ls: 'documents',     idMode: 'str', get: function () { return LS_STORES.documents.get(); },                  set: function (v) { LS_STORES.documents.set(v); } },
    presentations: { ls: 'presentations', idMode: 'str', get: function () { return LS_STORES.presentations.get(); },              set: function (v) { LS_STORES.presentations.set(v); } },
    deployments:   { ls: 'deployments',   idMode: 'str', get: function () { return LS_STORES.deployments.get(); },                set: function (v) { LS_STORES.deployments.set(v); } },
    apporteurs:    { ls: 'apporteurs',    idMode: 'str', get: function () { return LS_STORES.apporteurs.get(); },                 set: function (v) { LS_STORES.apporteurs.set(v); } },
    ecritures:     { ls: 'ecritures',     idMode: 'str', get: function () { return LS_STORES.ecritures.get(); },                  set: function (v) { LS_STORES.ecritures.set(v); } },
    logiciels:     { ls: 'logiciels',     idMode: 'str', get: function () { return LS_STORES.logiciels.get(); },                  set: function (v) { LS_STORES.logiciels.set(v); } },
    rdv:           { ls: RDV_LS,          idMode: 'int', prefix: 'r', get: function () { try { rdvLoad(); } catch (e) {} return RDVS; }, set: function (v) { RDVS = v; } },
    pil_depenses:  { ls: 'pil_depenses',  idMode: 'str', get: function () { return window.SanixPilotage ? window.SanixPilotage.store.get('depenses') : []; }, set: function (v) { if (window.SanixPilotage) window.SanixPilotage.store.set('depenses', v); } },
    pil_actions:   { ls: 'pil_actions',   idMode: 'str', get: function () { return window.SanixPilotage ? window.SanixPilotage.store.get('actions') : []; },  set: function (v) { if (window.SanixPilotage) window.SanixPilotage.store.set('actions', v); } },
    pil_config:    { ls: 'pil_config',    idMode: 'one', get: function () { var c = window.SanixPilotage ? window.SanixPilotage.store.getConfig() : {}; return Object.keys(c).length ? [Object.assign({ id: 'main' }, c)] : []; }, set: function (v) { if (window.SanixPilotage) window.SanixPilotage.store.setConfig(v[0] ? Object.assign({}, v[0]) : {}); } },
    config:        { ls: 'config',        idMode: 'one', get: function () { return [Object.assign({ id: 'main' }, CONFIG)]; },     set: function (v) { if (v[0]) { var o = Object.assign({}, v[0]); delete o.id; Object.assign(CONFIG, o); } } }
  };
  var ORDER = ['clients', 'deals', 'rdv', 'commandes', 'documents', 'presentations', 'contrats', 'licences', 'deployments', 'apporteurs', 'ecritures', 'logiciels', 'config', 'pil_depenses', 'pil_actions', 'pil_config'];
  var KEYMAP = { config: 'config', 'sanix_crm_rdv': 'rdv' };                       // clés lsSave qui ne portent pas le nom de l'entité
  ORDER.forEach(function (e) { if (STORES[e].ls !== RDV_LS && !KEYMAP[STORES[e].ls]) KEYMAP[STORES[e].ls] = e; });
  var HAS_CLIENT = { deals: 1, commandes: 1, presentations: 1, contrats: 1, licences: 1, documents: 1, deployments: 1, rdv: 1 };

  // ── Utilitaires ──────────────────────────────────────────────────────────────
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var norm = function (t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  var rnd = function (n) { var a = new Uint8Array(n); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.prototype.map.call(a, function (b) { return (b % 36).toString(36); }).join(''); };
  var newRid = function (p) { return p + '_' + Date.now().toString(36) + rnd(6); };
  var fnv = function (s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + s.length.toString(36); };
  var stable = function (o) { return JSON.stringify(o, function (k, v) { return v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce(function (a, kk) { a[kk] = v[kk]; return a; }, {}) : v; }); };
  var jget = function (k) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } };
  var jset = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  var cfg = function () { try { return typeof SB_CONFIG !== 'undefined' && SB_CONFIG && SB_CONFIG.url && SB_CONFIG.key ? SB_CONFIG : null; } catch (e) { return null; } };
  var session = function () { try { var s = JSON.parse(sessionStorage.getItem(AIS_TOK) || 'null'); return s && s.exp > Date.now() + 30000 ? s : null; } catch (e) { return null; } };
  var toast = function (m) { try { showToast(m); } catch (e) {} };

  // ── État persistant ──────────────────────────────────────────────────────────
  var state = jget(STATE_KEY) || { device: 'dev-' + rnd(10), cursor: 0, init: false, ver: {}, hash: {}, lastOk: null, lastErr: null, lastPull: null };
  if (!state.device) state.device = 'dev-' + rnd(10);
  var outbox = jget(OUTBOX_KEY) || {};                                              // « entité:rid » → {op_id, entity, rid, action, h, base_version, client_ts, import, natural, attempts, last_error}
  var persistState = function () { jset(STATE_KEY, state); };
  var persistOutbox = function () { jset(OUTBOX_KEY, outbox); };
  var internal = 0;                                                                  // > 0 : écriture du connecteur lui-même (ne pas la ré-analyser)
  var backend = 'unknown', backendAt = 0, backupWarned = false;                                         // 'absent' : fonctions SQL du connecteur non installées (migration non appliquée) → mode local, ancienne sauvegarde conservée
  var origLsSave = null, busy = false, retryTimer = null, scanTimer = {}, retryDelay = 2000, listeners = [], lastMode = 'off', ready = false, pollTimer = null, pulling = false;
  var counters = { pushed: 0, pulled: 0, rejected: 0 };

  var pendingCount = function () { return Object.keys(outbox).length; };
  var emit = function () { try { updatePillFromStatus(); render(); openFromUrl(); } catch (e) {} listeners.forEach(function (f) { try { f(status()); } catch (e) {} }); };

  // ── Identité des enregistrements ─────────────────────────────────────────────
  var ridOf = function (entity, o) { var c = STORES[entity]; return c.idMode === 'int' ? (o && o._rid) : c.idMode === 'one' ? 'main' : (o && o.id != null ? String(o.id) : null); };
  var nextId = function (arr) { return arr.reduce(function (m, o) { var n = parseInt(o && o.id, 10); return n > m ? n : m; }, 0) + 1; };
  var clientRidOf = function (obj, clients) {
    if (obj == null) return null;
    if (obj.clientId != null) { var c = clients.find(function (x) { return String(x.id) === String(obj.clientId); }); if (c && c._rid) return c._rid; }
    var n = norm(obj.client); if (!n) return null;
    var hit = clients.filter(function (x) { return norm(x.nom) === n && x._rid; });
    return hit.length === 1 ? hit[0]._rid : null;
  };
  /** Données envoyées au serveur : l'objet du CRM, sans identifiant propre au navigateur, avec le rattachement stable au client. */
  var payload = function (entity, obj, clients) {
    var c = STORES[entity], d = {};
    Object.keys(obj).forEach(function (k) {
      if (k === '_rid') return;
      if ((c.idMode === 'int' || c.idMode === 'one') && k === 'id') return;
      if ((entity === 'deals' || entity === 'rdv') && k === 'clientId') return;
      d[k] = obj[k];
    });
    if (entity === 'config') delete d.docSecret;                                      // clé de signature des documents : propre à l'appareil, jamais envoyée
    if (HAS_CLIENT[entity]) { var cr = clientRidOf(obj, clients || STORES.clients.get()); if (cr) d._client_rid = cr; }
    return d;
  };

  // ── Détection des changements locaux → file d'envoi ──────────────────────────
  var queue = function (entity, rid, action, h, extra) {
    var key = entity + ':' + rid, prev = outbox[key];
    if (prev && prev.action === action && prev.h === h) return;                      // même contenu déjà en file : même op_id (rejeu sans doublon)
    outbox[key] = Object.assign({ op_id: 'op' + Date.now().toString(36) + rnd(8), entity: entity, rid: rid, action: action, h: h, base_version: state.ver[key] == null ? null : state.ver[key],
      client_ts: new Date().toISOString(), import: !state.init, natural: true, attempts: 0 }, extra || {});
  };
  var allowDeletes = function () { return ready && Date.now() - startedAt > 8000; };
  var startedAt = Date.now();
  /** Compare le magasin local à la dernière version synchronisée ; place les créations, modifications et suppressions dans la file. */
  /** Clé naturelle du client d'une affaire (nom + téléphone) : identique sur tous les appareils, contrairement à l'identifiant du client qui ne converge qu'après la fusion par le serveur. */
  function dealClientKey(o, clients) {
    var c = o && o.clientId != null ? clients.find(function (x) { return String(x.id) === String(o.clientId); }) : null;
    if (!c && o && o.client) { var n = norm(o.client), hit = clients.filter(function (x) { return norm(x.nom) === n; }); c = hit.length === 1 ? hit[0] : null; }
    return c ? norm(c.nom) + '|' + String(c.phone || '').replace(/\D/g, '').slice(-10) : null;
  }
  /** Une affaire « générée depuis le prospect » (une par client, créée automatiquement sur chaque appareil) reçoit un identifiant dérivé de la clé naturelle de son client :
      deux appareils produisent alors la MÊME affaire au lieu d'en créer chacun une (1 474 affaires pour 552 clients en production avant ce correctif). Les autres affaires gardent un identifiant aléatoire. */
  function generatedDealRid(entity, o, clients) {
    if (entity !== 'deals' || !o || !o.fromProspect) return null;
    var k = dealClientKey(o, clients); return k ? 'dp_' + fnv(k) : null;
  }
  /** Un client SANS téléphone n'a pas de clé naturelle côté serveur (nom + téléphone requis) : chaque appareil créait alors sa propre copie des clients amorcés (8 clients réels → 16 fiches en production).
      Son identifiant dérive donc de son nom : deux appareils produisent la MÊME fiche. Les clients avec téléphone gardent leur identifiant aléatoire (le serveur les fusionne déjà). */
  function generatedClientRid(entity, o) {
    if (entity !== 'clients' || !o || !norm(o.nom) || phoneKey(o.phone)) return null;
    return STORES.clients.prefix + '_n' + fnv(norm(o.nom));
  }
  var NOSTAMP = { created_at: 1, updated_at: 1, createdAt: 1, updatedAt: 1 };
  var withoutStamps = function (d) { var o = {}; Object.keys(d).forEach(function (k) { if (!NOSTAMP[k]) o[k] = d[k]; }); return o; };
  var phoneKey = function (p) { return String(p || '').replace(/\D/g, '').slice(-10); };
  /** Deux fiches locales portant le même identifiant stable bouclaient à l'envoi : le serveur fusionne une fiche locale avec celle d'un autre appareil (même nom + même téléphone),
      l'appareil adopte l'identifiant canonique (rekey) alors qu'il a déjà reçu cette fiche, et l'une des deux est renvoyée à chaque échange sans jamais être acquittée.
      On garde la fiche qui correspond à la dernière version synchronisée ; une copie jumelle (même nom + même téléphone pour un client, même contenu sinon) est absorbée
      (ses échanges sont conservés, les affaires et rendez-vous qui la visaient sont rattachés à la fiche gardée) ; toute autre copie reçoit son propre identifiant : aucune donnée perdue. */
  function dedupeRids(entity, arr) {
    var c = STORES[entity]; if (c.idMode !== 'int') return arr;
    var by = {}, dup = false;
    arr.forEach(function (o) { if (o && o._rid) { var g = by[o._rid] || (by[o._rid] = []); g.push(o); if (g.length > 1) dup = true; } });
    if (!dup) return arr;
    var known = state.hash[entity] || {}, clients = entity === 'clients' ? arr : STORES.clients.get(), drop = [], remap = {}, remapped = false;
    Object.keys(by).forEach(function (rid) {
      var g = by[rid]; if (g.length < 2) return;
      var keep = g.find(function (o) { return fnv(stable(payload(entity, o, clients))) === known[rid]; }) || g[0];
      g.forEach(function (o) {
        if (o === keep) return;
        var twin = entity === 'clients' ? norm(o.nom) === norm(keep.nom) && phoneKey(o.phone) === phoneKey(keep.phone)
                 : entity === 'deals' && o.fromProspect && keep.fromProspect ? dealClientKey(o, clients) !== null && dealClientKey(o, clients) === dealClientKey(keep, clients) && o.logiciel === keep.logiciel && Number(o.valeur) === Number(keep.valeur) && o.stage === keep.stage
                 : stable(withoutStamps(payload(entity, o, clients))) === stable(withoutStamps(payload(entity, keep, clients)));
        if (!twin) { o._rid = newRid(c.prefix); return; }
        if (entity === 'clients') {
          remap[o.id] = keep.id; remapped = true;
          if (Array.isArray(o.interactions) && o.interactions.length) {
            var have = {}; keep.interactions = Array.isArray(keep.interactions) ? keep.interactions : [];
            keep.interactions.forEach(function (i) { have[[i.date, i.type, i.note].join('|')] = 1; });
            o.interactions.forEach(function (i) { var k = [i.date, i.type, i.note].join('|'); if (!have[k]) { have[k] = 1; keep.interactions.push(i); } });
          }
        }
        drop.push(o);
      });
    });
    if (remapped) ['deals', 'rdv'].forEach(function (e) {
      var list = STORES[e].get(), ch = false;
      list.forEach(function (o) { if (o && o.clientId != null && remap[o.clientId] != null) { o.clientId = remap[o.clientId]; ch = true; } });
      if (ch) saveLocal(e, list);
    });
    var out = arr.filter(function (o) { return drop.indexOf(o) < 0; });
    saveLocal(entity, out);
    return out;
  }
  function scan(entity) {
    var c = STORES[entity]; if (!c) return 0;
    if (/^pil_/.test(entity) && state.noPil && Date.now() - (state.noPilAt || 0) < 600000) return 0;      // migration du pilotage absente côté serveur
    var arr; try { arr = c.get(); } catch (e) { return 0; }
    if (!Array.isArray(arr)) return 0;
    arr = dedupeRids(entity, arr);
    var known = state.hash[entity] || (state.hash[entity] = {}), seen = {}, changed = 0, touched = false, clients = entity === 'clients' ? arr : STORES.clients.get(), nk = {};
    arr.forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      var rid = ridOf(entity, o);
      if (!rid) { if (c.idMode !== 'int') return; o._rid = rid = generatedDealRid(entity, o, clients) || generatedClientRid(entity, o) || newRid(c.prefix); touched = true; }
      seen[rid] = 1;
      var d = payload(entity, o, clients), h = fnv(stable(d)), extra = {};
      if (entity === 'clients') {                                                    // deux fiches identiques (même nom et même téléphone) : une seule porte la clé naturelle
        var k = norm(o.nom) + '|' + String(o.phone || '').replace(/\D/g, '').slice(-10);
        if (nk[k]) extra.natural = false; else nk[k] = 1;
      }
      if (known[rid] === h) { delete outbox[entity + ':' + rid]; return; }
      queue(entity, rid, 'upsert', h, extra); changed++;
    });
    if (allowDeletes()) {
      var gone = Object.keys(known).filter(function (rid) { return !seen[rid] && !(outbox[entity + ':' + rid] && outbox[entity + ':' + rid].action === 'delete'); });
      var total = Object.keys(known).length;
      if (gone.length && total >= 5 && gone.length > Math.max(3, total * 0.3)) { suspicious(entity, gone.length, total); }          // disparition massive : jamais envoyée sans confirmation
      else gone.forEach(function (rid) { queue(entity, rid, 'delete', 'x', { client_ts: new Date().toISOString() }); changed++; });
    }
    if (touched && c.idMode === 'int') saveLocal(entity, arr);                         // identifiants stables ajoutés aux fiches locales
    if (changed) persistOutbox();
    return changed;
  }
  var suspiciousInfo = null;
  function suspicious(entity, n, total) { suspiciousInfo = { entity: entity, n: n, total: total, at: Date.now() }; }
  function scheduleScan(entity) { clearTimeout(scanTimer[entity]); scanTimer[entity] = setTimeout(function () { if (!ready) return; var n = scan(entity); if (n) { emit(); kick(500); } }, 400); }

  // ── Transport ────────────────────────────────────────────────────────────────
  function authError() { var e = new Error('Session opérateur requise'); e.code = 'AUTH'; return e; }
  function rpc(name, body, timeout, aux) {
    var s = session(), c = cfg(); if (!s || !c) return Promise.reject(authError());
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, timeout || 20000);
    return fetch(c.url.replace(/\/$/, '') + '/rest/v1/rpc/' + name, { method: 'POST', signal: ctl && ctl.signal, headers: { apikey: c.key, Authorization: 'Bearer ' + s.t, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.text().then(function (txt) { var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {} return { r: r, j: j }; }); })
      .then(function (x) {
        if (x.r.status === 401) { try { sessionStorage.removeItem(AIS_TOK); } catch (e) {} throw authError(); }
        if (aux && x.r.status === 404 && /PGRST202|find the function/i.test(JSON.stringify(x.j || ''))) { var nf = new Error('Fonction serveur non installée'); nf.code = 'NOFUNC'; throw nf; }
        if (x.r.status === 404 && /PGRST202|find the function/i.test(JSON.stringify(x.j || ''))) { backend = 'absent'; backendAt = Date.now(); var n = new Error('Connecteur serveur non installé'); n.code = 'NOBACKEND'; throw n; }
        if (!x.r.ok) { var e = new Error((x.j && (x.j.message || x.j.error)) || ('HTTP ' + x.r.status)); e.status = x.r.status; e.code = x.j && x.j.code; throw e; }
        backend = 'ok';
        return x.j;
      }).finally(function () { clearTimeout(t); });
  }

  function saveLocal(entity, arr) {
    var c = STORES[entity]; internal++;
    try { c.set(arr); if (origLsSave) origLsSave(c.ls, c.idMode === 'one' ? c.get()[0] && (function () { var o = Object.assign({}, c.get()[0]); delete o.id; return o; })() : arr); }
    finally { internal--; }
  }

  // ── Envoi ────────────────────────────────────────────────────────────────────
  function buildOps() {
    var ops = [], clients = STORES.clients.get(), maps = {}, bytes = 0;
    Object.keys(outbox).sort(function (a, b) { return ORDER.indexOf(outbox[a].entity) - ORDER.indexOf(outbox[b].entity); }).forEach(function (key) {
      if (ops.length >= BATCH || (ops.length && bytes > MAX_BYTES)) return;          // lots limités en nombre et en poids (documents HTML volumineux)
      var op = outbox[key]; if (op.wait && op.wait > Date.now()) return;               // opération refusée : nouvelle tentative différée
      var out = { op_id: op.op_id, entity: op.entity, rid: op.rid, action: op.action, base_version: op.base_version, client_ts: op.client_ts, import: !!op.import };
      if (op.action === 'upsert') {
        var c = STORES[op.entity], arr = maps[op.entity] || (maps[op.entity] = c.get());
        var obj = arr.find(function (o) { return ridOf(op.entity, o) === op.rid; });
        if (!obj) { delete outbox[key]; return; }                                    // supprimé localement depuis : la suppression est (ou sera) en file
        var d = payload(op.entity, obj, clients), h = fnv(stable(d));
        if (h !== op.h) { op.h = h; op.op_id = 'op' + Date.now().toString(36) + rnd(8); out.op_id = op.op_id; }
        out.data = d; out.natural = op.natural !== false;
      }
      bytes += out.data ? JSON.stringify(out.data).length : 100;
      ops.push(out);
    });
    return ops;
  }
  function flush() {
    if (busy) return Promise.resolve(false);
    if (!session() || !cfg()) { lastMode = pendingCount() ? 'login' : 'idle'; emit(); return Promise.resolve(false); }
    if (!navigator.onLine) { lastMode = 'offline'; emit(); return Promise.resolve(false); }
    var ops = buildOps();
    if (!ops.length) { persistOutbox(); return Promise.resolve(true); }
    busy = true; lastMode = 'sync'; emit();
    return rpc('crm_sync_push', { p_device: state.device, p_ops: ops }, 30000).then(function (res) {
      var bykey = {}; ops.forEach(function (o) { bykey[o.op_id] = o; });
      var retry = false;
      (res.results || []).forEach(function (r) {
        var o = bykey[r.op_id]; if (!o) return;
        var key = o.entity + ':' + o.rid, q = outbox[key];
        if (r.ok) {
          counters.pushed++;
          var rid = r.rid || o.rid;
          if (rid !== o.rid) rekey(o.entity, o.rid, rid);                           // fusion serveur (même client saisi sur un autre appareil) : on adopte l'identifiant canonique
          var nk = o.entity + ':' + rid, expected = (o.base_version == null ? 0 : o.base_version) + 1;
          if (r.version != null && (r.version === expected || (r.unchanged && r.version === o.base_version))) state.ver[nk] = r.version;
          else { delete state.ver[nk]; if (r.seq != null) state.cursor = Math.max(0, Math.min(state.cursor || 0, r.seq - 1)); }   // le serveur a fusionné d'autres données : on les reçoit au prochain échange
          if (o.action === 'delete') { delete (state.hash[o.entity] || {})[o.rid]; delete state.ver[key]; }
          else if (q && q.op_id === o.op_id) (state.hash[o.entity] || (state.hash[o.entity] = {}))[rid] = q.h;
          if (q && q.op_id === o.op_id) delete outbox[key]; else if (q && rid !== o.rid) delete outbox[key];
        } else if (/^pil_/.test(o.entity) && /entity_check|violates check/i.test(r.error || '')) { state.noPil = true; state.noPilAt = Date.now(); delete outbox[key]; }   // pas une erreur du CRM : réessayé dans 10 min
        else if (r.conflict) { delete outbox[key]; delete (state.hash[o.entity] || {})[o.rid]; counters.rejected++; retry = true; }   // la suppression est refusée : le dossier revient au prochain échange
        else { counters.rejected++; if (q) { q.attempts = (q.attempts || 0) + 1; q.last_error = r.error || 'refusée'; q.wait = Date.now() + Math.min(Math.pow(2, q.attempts) * 5000, 3600000); } retry = true; }
      });
      state.lastOk = Date.now(); state.lastErr = null; retryDelay = 2000; persistState(); persistOutbox();
      busy = false; lastMode = 'ok';
      var more = pendingCount() > 0;
      return pull().then(function () { emit(); if (more || retry) kick(retry ? 5000 : 200); return true; });
    }).catch(function (e) { busy = false; return failed(e); });
  }
  function rekey(entity, from, to) {
    var arr = STORES[entity].get(); arr.forEach(function (o) { if (ridOf(entity, o) === from && STORES[entity].idMode === 'int') o._rid = to; });
    var h = state.hash[entity] || {}; if (h[from] !== undefined) { h[to] = h[from]; delete h[from]; }
    var vf = entity + ':' + from; if (state.ver[vf] != null) { state.ver[entity + ':' + to] = state.ver[vf]; delete state.ver[vf]; }
    saveLocal(entity, arr);
  }
  function failed(e) {
    state.lastErr = e && e.message ? e.message : String(e);
    if (e && e.code === 'AUTH') lastMode = 'login'; else if (e && e.code === 'NOBACKEND') lastMode = 'absent'; else lastMode = navigator.onLine ? 'error' : 'offline';
    persistState(); emit();
    if (e && e.code !== 'AUTH' && e.code !== 'NOBACKEND') { retryDelay = Math.min(retryDelay * 2, 60000); kick(retryDelay); }
    return false;
  }
  function kick(ms) { clearTimeout(retryTimer); retryTimer = setTimeout(function () { sync(); }, ms == null ? 0 : ms); }

  // ── Réception ────────────────────────────────────────────────────────────────
  function isDirty(entity, rid, obj) { var kh = (state.hash[entity] || {})[rid]; return obj && kh !== undefined ? fnv(stable(payload(entity, obj))) !== kh : !!outbox[entity + ':' + rid]; }
  function applyBatch(records) {
    var byEntity = {}; records.forEach(function (r) { (byEntity[r.entity] || (byEntity[r.entity] = [])).push(r); });
    var any = false;
    ORDER.forEach(function (entity) {
      var list = byEntity[entity]; if (!list || !STORES[entity]) return;
      var c = STORES[entity], arr = c.get().slice(), clients = entity === 'clients' ? arr : STORES.clients.get(), hs = state.hash[entity] || (state.hash[entity] = {}), changed = false;
      list.forEach(function (r) {
        var key = entity + ':' + r.rid, idx = arr.findIndex(function (o) { return ridOf(entity, o) === r.rid; }), cur = idx >= 0 ? arr[idx] : null;
        if (state.ver[key] != null && r.version <= state.ver[key] && !r.deleted && cur) return;                     // déjà reçu (fenêtre de recouvrement)
        if (cur && (outbox[key] || (hs[r.rid] !== undefined && fnv(stable(payload(entity, cur, clients))) !== hs[r.rid]))) { return; }   // modification locale non envoyée : jamais écrasée
        if (r.deleted) { if (cur) { arr.splice(idx, 1); changed = true; } state.ver[key] = r.version; delete hs[r.rid]; return; }
        var data = Object.assign({}, r.data), obj;
        if (c.idMode === 'int') { obj = Object.assign({}, data, { id: cur ? cur.id : nextId(arr), _rid: r.rid }); }
        else if (c.idMode === 'one') { obj = Object.assign({ id: 'main' }, data); }
        else { obj = Object.assign({}, data, { id: r.rid }); }
        if (HAS_CLIENT[entity] && data._client_rid) {                                // rattachement local : identifiant du client sur cet appareil
          var cl = (STORES.clients.get()).find(function (x) { return x._rid === data._client_rid; });
          if (cl && (entity === 'deals' || entity === 'rdv')) obj.clientId = cl.id;
        }
        delete obj._client_rid;
        if (cur) arr[idx] = obj; else arr.push(obj);
        changed = true; state.ver[key] = r.version; hs[r.rid] = fnv(stable(payload(entity, obj, clients)));
        counters.pulled++;
      });
      if (changed) { saveLocal(entity, arr); any = true; if (entity === 'config') { try { applyConfig(); } catch (e) {} } }
    });
    return any;
  }
  function pull() {
    if (pulling) return Promise.resolve(false);
    if (!session() || !cfg()) return Promise.resolve(false);
    pulling = true;
    var loop = function (since, n) {
      return rpc('crm_sync_pull', { p_since: since, p_limit: 500 }, 30000).then(function (res) {
        var changed = applyBatch(res.records || []);
        if (res.cursor > (state.cursor || 0)) state.cursor = res.cursor;
        state.lastPull = Date.now(); state.lastErr = null; persistState();
        if (changed) refreshViews();
        if (res.more && n < 40) return loop(res.cursor, n + 1).then(function (v) { return v || changed; });          // pages suivantes : sans recouvrement
        return changed;
      });
    };
    return loop(Math.max(0, (state.cursor || 0) - PULL_OVERLAP), 0).then(function (v) { pulling = false; return v; }, function (e) { pulling = false; failed(e); return false; });
  }
  function refreshViews() {
    ['initPipeline', 'initClients', 'initPlanning', 'initCommandes', 'initPresentations', 'initDocuments', 'initContrats', 'initLicences', 'initLogiciels', 'initDashboard360', 'updateSidebarBadges'].forEach(function (fn) {
      try { if (typeof window[fn] === 'function') window[fn](); } catch (e) {}
    });
    try { if (window.SanixPilotage && window.SanixPilotage.refresh) window.SanixPilotage.refresh(); } catch (e) {}
    try { var v = document.querySelector('[id^="view-"]:not(.hidden)'); if (v && v.id === 'view-agenda' && typeof initAgenda === 'function') initAgenda(); } catch (e) {}
  }

  // ── Orchestration ────────────────────────────────────────────────────────────
  function backup() {
    var snap = { at: new Date().toISOString(), stores: {} };
    ORDER.forEach(function (e) { try { snap.stores[e] = STORES[e].get(); } catch (x) {} });
    var key = BACKUP_PREFIX + new Date().toISOString().slice(0, 10), ok = jset(key, snap);
    if (ok) { var keys = Object.keys(localStorage).filter(function (k) { return k.indexOf(BACKUP_PREFIX) === 0; }).sort(); while (keys.length > 2) { try { localStorage.removeItem(keys.shift()); } catch (e) { break; } } }
    return ok;
  }
  function exportBackup() {
    var snap = { at: new Date().toISOString(), device: state.device, stores: {} };
    ORDER.forEach(function (e) { try { snap.stores[e] = STORES[e].get(); } catch (x) {} });
    var blob = new Blob([JSON.stringify(snap)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'sanix-crm-sauvegarde-' + snap.at.slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function initialImport() {
    if (state.init) return Promise.resolve(true);
    if (!state.backupAt || Date.now() - state.backupAt > 864e5) {                    // une sauvegarde par jour au plus, même si le premier envoi est repris plusieurs fois (serveur en panne, migration absente)
      var saved = backup(), first = !state.backupAt;
      if (saved) { state.backupAt = Date.now(); persistState(); if (first) toast('💾 Sauvegarde locale créée avant la première synchronisation'); }
      else if (!backupWarned) { backupWarned = true; toast('⚠️ Sauvegarde locale impossible (espace saturé) : exportez-la depuis le panneau Synchronisation'); }
    }
    ORDER.forEach(function (e) { scan(e); });                                          // tout l'existant est marqué « import » : aucun événement pour l'historique
    persistOutbox();
    var loop = function () {
      var before = pendingCount();
      return flush().then(function (ok) {
        if (!ok) return false;
        var left = Object.keys(outbox).filter(function (k) { return !(outbox[k].attempts > 0); }).length;     // seules les opérations refusées peuvent rester
        if (left && pendingCount() < before) return loop();
        if (left) return false;
        state.init = true; persistState(); return true;
      });
    };
    return loop();
  }
  function sync() {
    if (!ready) return Promise.resolve(false);
    if (!session() || !cfg()) { lastMode = cfg() ? 'login' : 'off'; emit(); return Promise.resolve(false); }
    if (backend === 'absent' && Date.now() - backendAt < 300000) { lastMode = 'absent'; emit(); return Promise.resolve(false); }
    ORDER.forEach(function (e) { scan(e); });
    var p = state.init ? flush() : initialImport();
    return p.then(function (ok) { if (ok) { if (!pulling) return pull().then(function () { emit(); return true; }); } emit(); return ok; });
  }

  // ── Interface : pilule d'état, panneau « Synchronisation », fiche client ─────
  function status() {
    return { mode: lastMode, pending: pendingCount(), lastOk: state.lastOk, lastErr: state.lastErr, cursor: state.cursor, init: state.init, device: state.device, session: !!session(), configured: !!cfg(), online: navigator.onLine,
      backend: backend, counters: counters, suspicious: suspiciousInfo, rejected: Object.keys(outbox).filter(function (k) { return outbox[k].attempts > 0; }).map(function (k) { return { key: k, error: outbox[k].last_error, attempts: outbox[k].attempts }; }) };
  }
  function updatePillFromStatus() {
    if (typeof updatePill !== 'function') return;
    var s = status(), n = s.pending;
    if (!s.configured) return;
    if (s.mode === 'sync') updatePill('syncing', 'Synchronisation…');
    else if (s.mode === 'login') updatePill('pending', n ? n + ' en attente · connexion requise' : 'Connexion opérateur requise');
    else if (s.mode === 'absent') updatePill('offline', 'Local · connecteur serveur absent');
    else if (s.mode === 'offline') updatePill('offline', n ? n + ' en attente · hors ligne' : 'Hors ligne');
    else if (s.mode === 'error') updatePill('error', n ? n + ' en attente · reprise auto' : 'Erreur de synchronisation');
    else updatePill(n ? 'pending' : 'ok', n ? n + ' en attente' : 'Synchronisé');
    var pill = document.getElementById('sync-pill'); if (pill && !pill._crmsync) { pill._crmsync = true; pill.onclick = function () { openPanel(); }; pill.title = 'Synchronisation CRM ↔ IA'; }
  }
  var fmtT = function (t) { return t ? new Date(t).toLocaleString('fr-FR') : '—'; };
  var panelTab = 'etat', serverStatus = null, missions = null;
  function ensureModal() {
    var m = document.getElementById('modal-crmsync'); if (m) return m;
    m = document.createElement('div'); m.id = 'modal-crmsync'; m.className = 'modal-overlay hidden';
    m.innerHTML = '<div class="modal-box" style="max-width:780px;width:94vw"><div class="modal-close" onclick="document.getElementById(\'modal-crmsync\').classList.add(\'hidden\')">✕</div><div id="crmsync-body"></div></div>';
    document.body.appendChild(m); return m;
  }
  function openPanel(tab) { ensureModal().classList.remove('hidden'); if (tab) panelTab = tab; render(); refreshServer(); }
  function refreshServer() {
    if (!session() || !cfg()) return;
    rpc('crm_sync_status', {}).then(function (s) { serverStatus = s; render(); }).catch(function () {});
    rpc('crm_missions_overview', { p_limit: 40 }).then(function (m) { missions = m; render(); }).catch(function () {});
  }
  var MODE_LABEL = { absent: 'Connecteur serveur non installé : mode local (rien n\'est perdu)', off: 'Supabase non configuré (mode local)', idle: 'Synchronisé', ok: 'Synchronisé', sync: 'Synchronisation…', login: 'Connexion opérateur requise', offline: 'Hors ligne : les modifications restent en file', error: 'Erreur : reprise automatique' };
  function render() {
    var el = document.getElementById('crmsync-body'); if (!el || el.closest('.hidden')) { renderAisPane(); return; }
    var s = status(), ss = serverStatus, ev = ss && ss.events || {}, rows = '';
    var tabs = [['etat', '🔗 État'], ['missions', '🛰️ Missions des agents'], ['evenements', '⚠️ Événements en échec']].map(function (t) { return '<span class="tab' + (panelTab === t[0] ? ' active' : '') + '" onclick="SanixCrmSync.openPanel(\'' + t[0] + '\')">' + t[1] + '</span>'; }).join('');
    var body = '';
    if (panelTab === 'etat') {
      body = '<div class="stats-grid" style="margin:10px 0"><div class="stat-card"><div class="stat-label">État</div><div class="stat-value" style="font-size:15px">' + esc(MODE_LABEL[s.mode] || s.mode) + '</div></div>'
        + '<div class="stat-card"><div class="stat-label">En attente d\'envoi</div><div class="stat-value">' + s.pending + '</div></div>'
        + '<div class="stat-card"><div class="stat-label">Dernier envoi</div><div class="stat-value" style="font-size:13px">' + esc(fmtT(s.lastOk)) + '</div></div>'
        + '<div class="stat-card"><div class="stat-label">Événements CRM ↔ IA</div><div class="stat-value" style="font-size:13px">' + (ss ? (ev.done || 0) + ' traités · ' + ((ev.pending || 0) + (ev.failed || 0)) + ' en cours · ' + (ev.dead || 0) + ' bloqués' : '…') + '</div></div></div>'
        + (s.lastErr ? '<p class="page-sub" style="color:var(--danger)">Dernière erreur : ' + esc(s.lastErr) + '</p>' : '')
        + (s.mode === 'absent' ? '<p class="page-sub">Le connecteur n\'est pas installé côté serveur (migration non appliquée) : le CRM fonctionne en local et l\'ancienne sauvegarde reste utilisable. La synchronisation reprend dès l\'installation (bouton « Synchroniser maintenant »).</p>' : '')
        + (!s.session ? '<p class="page-sub">Connectez l\'agent IA (session opérateur) dans l\'onglet « Directeur commercial IA » : la synchronisation reprendra seule, rien n\'est perdu en attendant.</p>' : '')
        + (s.suspicious ? '<div class="card" style="padding:12px;border-color:var(--danger)"><b>⚠️ Suppression massive détectée</b> : ' + s.suspicious.n + ' fiches « ' + esc(s.suspicious.entity) + ' » ont disparu du navigateur. Rien n\'a été envoyé. <button class="btn btn-outline btn-sm" onclick="SanixCrmSync.confirmDeletes()">Confirmer ces suppressions</button> <button class="btn btn-outline btn-sm" onclick="SanixCrmSync.restoreFromServer()">Restaurer depuis le serveur</button></div>' : '')
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button class="btn btn-primary btn-sm" onclick="SanixCrmSync.syncNow()">🔄 Synchroniser maintenant</button><button class="btn btn-outline btn-sm" onclick="SanixCrmSync.exportBackup()">💾 Exporter une sauvegarde</button></div>'
        + '<p class="page-sub">Appareil : ' + esc(s.device) + ' · curseur ' + s.cursor + ' · ' + (s.init ? 'import initial terminé' : 'import initial en attente') + '. Les données restent aussi dans ce navigateur (hors ligne possible).</p>'
        + (ss && ss.records ? '<p class="page-sub">Base centrale : ' + Object.keys(ss.records).map(function (k) { return esc(k) + ' ' + ss.records[k]; }).join(' · ') + '</p>' : '');
    } else if (panelTab === 'missions') {
      body = missions == null ? '<p class="page-sub">Chargement…</p>' : missions.length ? missions.map(function (m) {
        return '<div class="card" style="padding:10px;margin:6px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + esc(m.titre) + '</b><span class="badge badge-muted">' + esc(m.statut) + '</span></div>'
          + '<div style="font-size:12px;color:var(--muted)">' + esc(m.agent) + (m.entreprise ? ' · dossier : ' + esc(m.entreprise) : '') + ' · ' + esc(fmtT(m.created_at)) + '</div>' + (m.rapport ? '<details><summary style="cursor:pointer;font-size:12px">Compte rendu</summary><pre style="white-space:pre-wrap;font-size:12px;font-family:inherit">' + esc(m.rapport) + '</pre></details>' : '') + '</div>';
      }).join('') : '<p class="page-sub">Aucune mission.</p>';
    } else {
      var f = ss && ss.failing || [];
      body = f.length ? f.map(function (e) { return '<div class="card" style="padding:10px;margin:6px 0"><b>' + esc(e.type) + '</b> <span class="badge ' + (e.status === 'dead' ? 'badge-danger' : 'badge-warning') + '">' + esc(e.status) + ' · ' + e.attempts + ' tentative(s)</span><div style="font-size:12px;color:var(--muted)">' + esc(e.last_error || '') + '</div><button class="btn btn-outline btn-sm" onclick="SanixCrmSync.retryEvent(\'' + esc(e.id) + '\')">↻ Rejouer</button></div>'; }).join('') : '<p class="page-sub">Aucun événement en échec. 👌</p>';
    }
    el.innerHTML = '<h2 class="page-title" style="font-size:18px">Synchronisation CRM ↔ SANIX AI</h2><div class="tabs" style="margin:8px 0">' + tabs + '</div>' + body;
    rows = rows; renderAisPane();
  }
  function renderAisPane() { /* l'onglet de la vue Directeur commercial IA affiche l'état résumé */
    var el = document.getElementById('ais-pane-sync'); if (!el) return;
    var s = status();
    el.innerHTML = '<div class="card" style="padding:14px"><b>' + esc(MODE_LABEL[s.mode] || s.mode) + '</b> · ' + s.pending + ' en attente · dernier envoi ' + esc(fmtT(s.lastOk))
      + '<div style="margin-top:8px"><button class="btn btn-primary btn-sm" onclick="SanixCrmSync.openPanel(\'etat\')">Ouvrir le panneau complet</button> <button class="btn btn-outline btn-sm" onclick="SanixCrmSync.syncNow()">🔄 Synchroniser</button></div></div>';
  }
  function injectAisTab() {
    var tabs = document.getElementById('ais-tabs'); if (!tabs || tabs._crm) return; tabs._crm = true;
    var t1 = document.createElement('div'); t1.className = 'tab'; t1.textContent = '🔗 Synchronisation CRM'; t1.onclick = function () { aisTabExtra('sync', t1); };
    var t2 = document.createElement('div'); t2.className = 'tab'; t2.textContent = '📋 Missions des agents'; t2.onclick = function () { openPanel('missions'); };
    tabs.appendChild(t1); tabs.appendChild(t2);
    var pane = document.createElement('div'); pane.id = 'ais-pane-sync'; pane.className = 'hidden'; var last = document.getElementById('ais-pane-valid'); last.parentNode.appendChild(pane);
  }
  function aisTabExtra(t, el) {
    ['score', 'missions', 'valid', 'sync'].forEach(function (k) { var p = document.getElementById('ais-pane-' + k); if (p) p.classList.toggle('hidden', k !== t); });
    document.querySelectorAll('#ais-tabs .tab').forEach(function (x) { x.classList.toggle('active', x === el); });
    renderAisPane();
  }

  // Fiche client : agent responsable, missions, rendez-vous et comptes rendus, offres, événements et état de synchronisation
  var panelCache = {};
  function clientPanel(id) {
    var host = document.getElementById('client-detail-body'); if (!host) return;
    var c = STORES.clients.get().find(function (x) { return String(x.id) === String(id); }); if (!c) return;
    var box = document.getElementById('crm-ia-panel'); if (!box) { box = document.createElement('div'); box.id = 'crm-ia-panel'; box.style.cssText = 'margin-top:14px;border-top:1px solid var(--border);padding-top:12px'; host.appendChild(box); }
    var draw = function (p) {
      var pend = c._rid && outbox['clients:' + c._rid];
      var head = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>🤖 SANIX AI — suivi de ce dossier</b><span class="badge ' + (pend ? 'badge-warning' : 'badge-success') + '">' + (pend ? 'envoi en attente' : 'synchronisé') + '</span></div>';
      if (!p) { box.innerHTML = head + '<p class="page-sub">' + (!session() ? 'Connectez l\'agent IA (session opérateur) pour voir le suivi.' : backend === 'absent' ? 'Connecteur serveur non installé.' : 'Chargement…') + '</p>'; return; }
      if (!p.linked) {
        box.innerHTML = head + '<p class="page-sub">Ce dossier n\'est pas encore suivi par un agent.</p><button class="btn btn-primary btn-sm" onclick="SanixCrmSync.delegate(' + Number(c.id) + ')">🤖 Confier à l\'IA</button> <button class="btn btn-outline btn-sm" onclick="SanixCrmSync.claim(' + Number(c.id) + ')">⚠️ Signaler une réclamation</button>';
        return;
      }
      var st = { a_faire: 'badge-muted', en_cours: 'badge-warning', terminee: 'badge-success', echouee: 'badge-danger', bloquee: 'badge-danger', annulee: 'badge-muted', attente_validation: 'badge-warning' };
      box.innerHTML = head
        + '<div style="margin:8px 0;font-size:13px">Agent responsable : <b>' + esc(p.agent ? p.agent.nom : '—') + '</b>' + (p.agent ? ' <span style="color:var(--muted)">· ' + esc(p.agent.fonction) + '</span>' : '') + '<br>Étape IA : <b>' + esc(p.prospect.stage) + '</b>' + (p.prospect.score != null ? ' · score ' + esc(p.prospect.score) + '/100 (' + esc(p.prospect.priorite) + ')' : '') + (p.prospect.produits && p.prospect.produits.length ? '<br>Produits recommandés : ' + esc(p.prospect.produits.join(', ')) : '') + '</div>'
        + (p.validations && p.validations.length ? '<div class="card" style="padding:8px;border-color:var(--warning)">⏳ ' + p.validations.length + ' validation(s) en attente : ' + p.validations.map(function (v) { return esc(v.type + ' — ' + v.motif); }).join(' · ') + '</div>' : '')
        + '<div style="font-weight:700;margin-top:8px">Missions</div>' + (p.missions.length ? p.missions.map(function (m) { return '<div style="font-size:12px;margin:3px 0"><span class="badge ' + (st[m.statut] || 'badge-muted') + '">' + esc(m.statut) + '</span> ' + esc(m.titre) + ' <span style="color:var(--muted)">· ' + esc(m.agent) + '</span>' + (m.rapport ? '<details><summary style="cursor:pointer">Compte rendu</summary><pre style="white-space:pre-wrap;font-family:inherit">' + esc(m.rapport) + '</pre></details>' : '') + '</div>'; }).join('') : '<div class="page-sub">Aucune mission.</div>')
        + '<div style="font-weight:700;margin-top:8px">Rendez-vous et comptes rendus</div>' + (p.rdv.length ? p.rdv.map(function (r) { return '<div style="font-size:12px;margin:3px 0">' + esc(fmtT(r.debut)) + ' · ' + esc(r.mode) + ' · <i>' + esc(r.statut) + '</i>' + (r.compte_rendu ? '<div style="background:var(--surface2);border-radius:6px;padding:6px;margin-top:2px">📝 ' + esc(r.compte_rendu) + '</div>' : '') + '</div>'; }).join('') : '<div class="page-sub">Aucun rendez-vous.</div>')
        + '<div style="font-weight:700;margin-top:8px">Offres</div>' + (p.offres.length ? p.offres.map(function (o) { return '<div style="font-size:12px;margin:3px 0">' + esc(o.reference) + ' · ' + esc(Number(o.total_ttc).toLocaleString('fr-FR')) + ' FCFA TTC · <i>' + esc(o.statut) + '</i></div>'; }).join('') : '<div class="page-sub">Aucune offre.</div>')
        + '<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px">Journal de synchronisation (' + p.events.length + ')</summary>' + p.events.map(function (e) { return '<div style="font-size:11px;color:var(--muted)">' + esc(fmtT(e.created_at)) + ' · ' + esc(e.type) + ' · ' + esc(e.status) + (e.last_error ? ' · ' + esc(e.last_error) : '') + '</div>'; }).join('') + '</details>'
        + '<div style="margin-top:8px"><button class="btn btn-outline btn-sm" onclick="SanixCrmSync.claim(' + Number(c.id) + ')">⚠️ Signaler une réclamation</button></div>';
    };
    draw(panelCache[c._rid] || null);
    if (!c._rid || !session() || !cfg()) return;
    rpc('crm_client_panel', { p_rid: c._rid }).then(function (p) { panelCache[c._rid] = p; if (document.getElementById('crm-ia-panel') === box) draw(p); }).catch(function () {});
  }
  function delegate(id) {
    var c = STORES.clients.get().find(function (x) { return String(x.id) === String(id); }); if (!c || !c._rid) { toast('⏳ Dossier pas encore synchronisé : réessayez dans un instant'); return Promise.resolve(false); }
    if (!session()) { toast('🔐 Connectez d\'abord l\'agent IA'); return Promise.resolve(false); }
    return flush().then(function () { return rpc('crm_delegate', { p_rid: c._rid }); }).then(function (r) { toast(r && r.already ? 'ℹ️ Déjà confié aujourd\'hui' : '🤖 Dossier confié à l\'IA : traitement côté serveur'); delete panelCache[c._rid]; setTimeout(function () { pull().then(function () { clientPanel(id); }); }, 1500); return true; }).catch(function (e) { toast('❌ ' + e.message); return false; });
  }
  function claim(id) {
    var c = STORES.clients.get().find(function (x) { return String(x.id) === String(id); }); if (!c) return;
    var note = (window.prompt('Réclamation de « ' + c.nom + ' » — décrivez-la :') || '').trim(); if (note.length < 3) return;
    c.interactions = c.interactions || []; c.interactions.push({ date: new Date().toISOString(), type: 'Réclamation', note: note, ico: '⚠️' }); c.updated_at = new Date().toISOString();
    try { saveStore('clients'); } catch (e) {}
    toast('⚠️ Réclamation enregistrée : transmise à l\'agent relation client'); kick(300);
  }

  // Lien depuis le bureau 3D (fiche collaborateur → « Ouvrir dans le CRM ») : index.html?crm_client=<identifiant stable>
  var urlOpened = false;
  function openFromUrl() {
    if (urlOpened) return;
    var rid; try { rid = new URLSearchParams(location.search).get('crm_client'); } catch (e) { urlOpened = true; return; }
    if (!rid) { urlOpened = true; return; }
    try { if (typeof currentUser === 'undefined' || !currentUser) return; } catch (e) { return; }                // attendre l'ouverture de session du CRM
    var c = STORES.clients.get().find(function (x) { return x._rid === rid; }); if (!c) return;               // pas encore reçu : nouvel essai à la prochaine réception
    urlOpened = true;
    try { if (typeof navigate === 'function') navigate('clients', null); showClientDetail(c.id); } catch (e) {}
  }

  // ── Points d'entrée ──────────────────────────────────────────────────────────
  function hook() {
    if (typeof window.lsSave !== 'function' || window.lsSave._crmsync) return;
    origLsSave = window.lsSave;
    var wrapped = function (key, data) {
      var r = origLsSave.apply(this, arguments);
      if (!internal) { var e = KEYMAP[key]; if (e) scheduleScan(e); }
      return r;
    };
    wrapped._crmsync = true; window.lsSave = wrapped;
    // anciennes synchronisations (clé « anon », tables crm_*) : remplacées par le connecteur (la réception ne remplace plus jamais les données locales)
    // Tant que le connecteur n'est pas actif (session opérateur absente ou migration non appliquée), l'envoi hérité reste disponible ; la réception héritée,
    // qui remplaçait les données locales, ne l'est jamais : sans connecteur elle ne fait rien.
    var origPush = window.syncPush, origPull = window.syncPull, active = function () { return !!(cfg() && session() && backend !== 'absent'); };
    window.syncPush = function () { if (active()) return sync(); if (typeof origPush === 'function') return origPush.apply(this, arguments); toast('⚠️ Configurez Supabase d\'abord'); return Promise.resolve(false); };
    window.syncPull = function () { if (active()) return sync(); toast('ℹ️ Réception héritée désactivée (elle remplaçait les données locales) : connectez l\'agent IA pour synchroniser sans risque'); return Promise.resolve(false); };
    var odel = window.aisDelegate; window.aisDelegate = function (id) { return active() ? delegate(id) : (odel ? odel(id) : false); };
    var osd = window.showClientDetail; if (typeof osd === 'function') window.showClientDetail = function (id) { var r = osd.apply(this, arguments); try { clientPanel(id); } catch (e) {} return r; };
    var oia = window.initAiSales; if (typeof oia === 'function') window.initAiSales = function () { var r = oia.apply(this, arguments); try { injectAisTab(); renderAisPane(); } catch (e) {} return r; };
    var oais = window.aisTab; if (typeof oais === 'function') window.aisTab = function (t, el) { var p = document.getElementById('ais-pane-sync'); if (p) p.classList.add('hidden'); return oais.apply(this, arguments); };
  }
  function start() {
    if (ready) return;
    try { if (typeof LS_STORES === 'undefined' || typeof lsSave !== 'function' || !window.DEALS_SEED) return; } catch (e) { return; }
    hook(); ready = true; startedAt = Date.now(); lastMode = cfg() ? (session() ? 'idle' : 'login') : 'off';
    ORDER.forEach(function (e) { try { scan(e); } catch (x) {} });
    emit();
    window.addEventListener('online', function () { kick(500); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(300); });
    pollTimer = setInterval(function () { if (!document.hidden) sync(); openFromUrl(); }, POLL_MS);
    setInterval(openFromUrl, 1500);
    kick(1500);
  }
  var boot = setInterval(function () { start(); if (ready) clearInterval(boot); }, 400);

  window.SanixCrmSync = {
    version: 1, available: function () { return !!(cfg() && session() && backend !== 'absent'); }, rpcAux: function (name, body) { return rpc(name, body, 20000, true); }, status: status, syncNow: function () { backend = 'unknown'; return sync(); }, flush: flush, pull: pull, scan: function (e) { return e ? scan(e) : ORDER.map(scan); },
    openPanel: openPanel, exportBackup: exportBackup, backup: backup, delegate: delegate, claim: claim, clientPanel: clientPanel, onChange: function (f) { listeners.push(f); },
    confirmDeletes: function () { suspiciousInfo = null; var save = allowDeletes; ORDER.forEach(function (e) { var known = state.hash[e] || {}, arr = STORES[e].get(), have = {}; arr.forEach(function (o) { have[ridOf(e, o)] = 1; }); Object.keys(known).forEach(function (rid) { if (!have[rid]) queue(e, rid, 'delete', 'x', { client_ts: new Date().toISOString() }); }); }); persistOutbox(); kick(0); emit(); },
    restoreFromServer: function () { suspiciousInfo = null; state.cursor = 0; ORDER.forEach(function (e) { var known = state.hash[e] || {}, have = {}; STORES[e].get().forEach(function (o) { have[ridOf(e, o)] = 1; }); Object.keys(known).forEach(function (rid) { if (!have[rid]) { delete known[rid]; delete state.ver[e + ':' + rid]; } }); }); persistState(); kick(0); emit(); },
    retryEvent: function (id) { return rpc('crm_event_retry', { p_id: id }).then(function () { toast('↻ Événement remis en file'); refreshServer(); }).catch(function (e) { toast('❌ ' + e.message); }); },
    _state: function () { return state; }, _outbox: function () { return outbox; }, _ready: function () { return ready; }
  };
})();
