// Client Supabase simulé (navigateur) : jeu de données réel exporté de PostgreSQL ; journalise toutes les requêtes.
(() => {
  const FX = window.__FIX, Q = (window.__Q = []), CALLS = (window.__CALLS = []);
  for (const a of window.__NOREFRESH ? [] : FX.ai_agents) {
    if (a.lieu_jusqua) a.lieu_jusqua = new Date(Date.now() + 2 * 3600e3).toISOString();   // déplacements « en cours » au chargement de la page
    if (["ia_qualif_2", "ia_social"].includes(a.code)) a.activite_depuis = new Date().toISOString();   // disponible depuis un instant : reste à son poste
  }
  for (const m of FX.ai_agent_meetings) if (m.statut === "en_cours") m.debut_at = new Date().toISOString();
  const OP = FX.ai_operators[0].user_id;
  const T = (n) => FX[n];
  const uid = () => crypto.randomUUID();
  const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? 1 : b === null || b === undefined ? -1 : a < b ? -1 : 1);
  function builder(table) {
    const s = { table, op: "select", cols: "*", f: [], orders: [], lim: null, one: null, payload: null, ret: false, count: false, head: false };
    const api = {
      select(cols = "*", o) { if (s.op === "select") { s.cols = cols; s.count = !!o?.count; s.head = !!o?.head; } else { s.ret = true; s.cols = cols; } return api; },
      insert(p) { s.op = "insert"; s.payload = p; return api; }, update(p) { s.op = "update"; s.payload = p; return api; }, delete() { s.op = "delete"; return api; },
      eq: (c, v) => (s.f.push([c, "eq", v]), api), neq: (c, v) => (s.f.push([c, "neq", v]), api), in: (c, v) => (s.f.push([c, "in", v]), api), is: (c, v) => (s.f.push([c, "is", v]), api),
      gte: (c, v) => (s.f.push([c, "gte", v]), api), lte: (c, v) => (s.f.push([c, "lte", v]), api), ilike: (c, v) => (s.f.push([c, "ilike", v]), api), not: (c, o, v) => (s.f.push([c, "not." + o, v]), api),
      or: (str) => (s.f.push([null, "or", str.split(",").map((p) => { const [c, op, ...v] = p.split("."); return [c, op, v.join(".")]; })]), api),
      order: (c, o) => (s.orders.push([c, o?.ascending !== false]), api), limit: (n) => ((s.lim = n), api),
      single: () => ((s.one = "single"), api), maybeSingle: () => ((s.one = "maybe"), api),
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      const rows = T(table);
      if (!rows) return { data: null, error: { message: `Table inconnue : ${table}` } };
      Q.push({ table, op: s.op, cols: s.cols, filters: s.f.map(([c, o]) => [c, o]), orders: s.orders.map((o) => o[0]), payload: s.payload && !Array.isArray(s.payload) ? Object.keys(s.payload) : s.payload ? Object.keys(s.payload[0] ?? {}) : null, one: s.one });
      const ok = (r) => s.f.every(([c, o, v]) => {
        if (o === "or") return v.some(([cc, oo, vv]) => oo === "eq" && String(r[cc]) === vv);
        const x = r[c];
        if (o === "eq") return x === v; if (o === "neq") return x !== v; if (o === "in") return v.includes(x); if (o === "is") return v === null ? x === null || x === undefined : x === v;
        if (o === "gte") return x >= v; if (o === "lte") return x <= v; if (o === "ilike") return String(x ?? "").toLowerCase().includes(String(v).replace(/%/g, "").toLowerCase());
        if (o === "not.eq") return x !== v; if (o === "not.is") return v === null ? x !== null && x !== undefined : x !== v; return true;
      });
      let out;
      if (s.op === "insert") { const arr = Array.isArray(s.payload) ? s.payload : [s.payload]; out = arr.map((p) => { const r = { id: uid(), created_at: new Date().toISOString(), principal: false, actif: true, types: ["quotidien", "hebdomadaire", "mensuel", "incident"], ...p }; rows.push(r); return r; }); }
      else if (s.op === "update") { out = rows.filter(ok); out.forEach((r) => Object.assign(r, s.payload)); }
      else if (s.op === "delete") { out = rows.filter(ok); out.forEach((r) => rows.splice(rows.indexOf(r), 1)); }
      else out = rows.filter(ok);
      if (s.op === "select") for (const [c, asc] of [...s.orders].reverse()) out = [...out].sort((a, b) => (asc ? 1 : -1) * cmp(a[c], b[c]));
      if (s.lim !== null) out = out.slice(0, s.lim);
      if (s.op === "select" || s.ret) {
        if (s.cols.includes("ai_prospects(")) out = out.map((r) => ({ ...r, ai_prospects: r.prospect_id ? (({ entreprise, decideur, phone_norm, telephone, whatsapp }) => ({ entreprise: entreprise ?? null, decideur, phone_norm, telephone, whatsapp }))(T("ai_prospects").find((p) => p.id === r.prospect_id) ?? {}) : null }));
        else if (s.cols !== "*") { const cols = s.cols.split(",").map((c) => c.trim()); out = out.map((r) => Object.fromEntries(cols.map((c) => { const m = /^(\w+):(\w+)(?:->>?(\w+))?$/.exec(c); return m ? [m[1], m[3] ? r[m[2]]?.[m[3]] : r[m[2]]] : [c, r[c]]; }))); }
      }
      if (s.head) return { data: null, error: null, count: out.length };
      if (s.op !== "select" && !s.ret) return { data: null, error: null };
      if (s.one === "single") return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      if (s.one === "maybe") return { data: out[0] ?? null, error: null };
      return { data: JSON.parse(JSON.stringify(out)), error: null };
    }
    return api;
  }
  const rpc = (name, args = {}) => {
    Q.push({ rpc: name, args: Object.keys(args) }); CALLS.push({ rpc: name, args });
    const R = FX.rpc;
    if (name === "ai_budget_status") return Promise.resolve({ data: R.ai_budget_status, error: null });
    // Crédit API (test credit_test.js) : état tenu en mémoire ; absent du jeu de données = fonction non installée
    if (name === "ai_credit_status") return Promise.resolve(R.ai_credit_status ? { data: R.ai_credit_status, error: null } : { data: null, error: { message: "Could not find the function" } });
    if (name === "ai_credit_ajouter") { R.ai_credit_status = { saisi: true, solde_usd: args.p_type === "solde_constate" ? args.p_montant : (R.ai_credit_status?.solde_usd ?? 0) + args.p_montant, base_usd: args.p_montant, base_at: new Date().toISOString(), recharges_depuis_usd: 0, depense_depuis_usd: 0, rythme_jour_usd: 1.5, jours_restants: 3 }; return Promise.resolve({ data: { ok: true }, error: null }); }
    // Centre des coûts IA (test ui_test.js) : présent seulement si le jeu de données le porte ; sinon « fonction non installée »
    if (name === "ai_cost_center") { CALLS[CALLS.length - 1].days = args.p_days; return Promise.resolve(R.ai_cost_center ? { data: R.ai_cost_center, error: null } : { data: null, error: { message: "Could not find the function public.ai_cost_center" } }); }
    // État de la connexion Gmail (test ui_test.js) : présent seulement si le jeu de données le porte
    if (name === "crm_mail_state") return Promise.resolve(R.crm_mail_state ? { data: R.crm_mail_state, error: null } : { data: null, error: { message: "Could not find the function public.crm_mail_state" } });
    if (name === "ai_agent_stats") return Promise.resolve({ data: R.ai_agent_stats, error: null });
    if (name === "ai_decide_approval") { T("ai_approvals").splice(0, T("ai_approvals").length, ...T("ai_approvals").filter((a) => a.id !== args.p_id)); return Promise.resolve({ data: null, error: null }); }
    if (name === "ai_decide_approvals_batch") { T("ai_approvals").splice(0, T("ai_approvals").length, ...T("ai_approvals").filter((a) => !args.p_ids.includes(a.id))); return Promise.resolve({ data: args.p_ids.length, error: null }); }
    // WhatsApp en mode manuel (test wa_manuel_test.js) : seulement si le jeu de données porte la table ai_messages
    if (name.startsWith("ai_wa_") && T("ai_messages")) {
      const m = T("ai_messages").find((x) => x.id === args.p_id);
      if (name === "ai_wa_marquer_envoye" && m) { m.statut = "envoye"; m.meta = { ...(m.meta ?? {}), mode: "manuel", envoye_le: new Date().toISOString(), note: args.p_note }; }
      if (name === "ai_wa_annuler" && m) { m.statut = "echec"; m.meta = { ...(m.meta ?? {}), motif: args.p_motif }; }
      if (name === "ai_wa_reponse") T("ai_messages").push({ id: 900 + T("ai_messages").length, prospect_id: args.p_prospect, canal: "whatsapp", sens: "entrant", auteur: "prospect", contenu: args.p_texte, statut: "recu", meta: {}, created_at: new Date().toISOString() });
      return Promise.resolve({ data: { ok: true, desinscrit: false }, error: null });
    }
    if (name === "ai_set_agent_etat") { const a = T("ai_agents").find((x) => x.id === args.p_agent); if (a) a.etat = args.p_etat; return Promise.resolve({ data: null, error: null }); }
    // connecteur CRM ↔ IA (fonctions SQL réservées aux opérateurs) : actives seulement si le jeu de données porte un bloc « crm » (test crm_office_test.js)
    if (FX.crm && name === "crm_dashboard") return Promise.resolve({ data: FX.crm.dashboard, error: null });
    if (FX.crm && name === "crm_agent_portfolio") return Promise.resolve({ data: FX.crm.portfolio[args.p_agent] ?? { prospects: [], missions: [], validations: [] }, error: null });
    if (FX.crm && name === "crm_assign_mission") {
      const id = "00000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12);
      T("ai_agent_tasks").push({ id, agent_id: args.p_agent, prospect_id: args.p_prospect, type: "mission", titre: args.p_titre, description: args.p_description, statut: "a_faire", priorite: args.p_priorite, objectifs: [], resultats: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return Promise.resolve({ data: id, error: null });
    }
    if (FX.crm && name === "crm_arbitrate_task") {
      const t = T("ai_agent_tasks").find((x) => x.id === args.p_task); if (t && args.p_action === "cancel") t.statut = "annulee";
      FX.crm.dashboard.missions_en_retard = FX.crm.dashboard.missions_en_retard.filter((m) => m.id !== args.p_task);
      return Promise.resolve({ data: null, error: null });
    }
    if (name === "crm_sync_push") {
      const rows = T("crm_records"), results = args.p_ops.map((op) => {
        const r = rows.find((x) => x.rid === op.rid);
        if (op.action === "delete") { if (!r) return { op_id: op.op_id, ok: true, unchanged: true }; r.deleted_at = new Date().toISOString(); r.version = (r.version ?? 1) + 1; return { op_id: op.op_id, ok: true, deleted: true }; }
        if (window.__crmReject) return { op_id: op.op_id, ok: false, error: "refusé par le serveur" };
        if (!r) { rows.push({ rid: op.rid, entity: op.entity, deleted_at: null, version: 1, updated_at: new Date().toISOString(), data: { ...op.data } }); return { op_id: op.op_id, ok: true, created: true }; }
        for (const [k, v] of Object.entries(op.data)) r.data[k] = k === "interactions" ? [...(r.data.interactions ?? []), ...v] : v;
        r.version = (r.version ?? 1) + 1; return { op_id: op.op_id, ok: true };
      });
      return Promise.resolve({ data: { ok: true, results, cursor: 1 }, error: null });
    }
    return Promise.resolve({ data: null, error: { message: `rpc inconnue ${name}` } });
  };
  const invoke = async (fn, { body }) => {
    Q.push({ fn, action: body.action }); CALLS.push({ fn, body });
    if (fn === "ai-jarvis") {
      const m = body.message, ag = body.context.agents;
      if (window.__jarvisDown) return { data: null, error: { message: "Service IA indisponible" } };
      if (/mission/.test(m)) return { data: { reply: `Je propose de confier cette mission à ${ag[0].nom}. Dois-je la transmettre ?`, actions: [{ type: "propose_mission", agent_id: ag[0].id, titre: "Relancer la prospection", description: "Cibler vingt garages avec contact public.", priorite: 2 }] }, error: null };
      if (/amélior|proposition/.test(m)) return { data: { reply: "Deux propositions. Un : relancer les missions bloquées. Deux : confier un contrôle des fiches au Data Analyst. Laquelle dois-je lancer ?", actions: [{ type: "propose_instruction", texte: "Analyse les missions bloquées et propose un plan de reprise." }, { type: "propose_mission", agent_id: ag[0].id, titre: "Contrôler les fiches du jour", description: "Contrôler et compléter les fiches créées aujourd'hui.", priorite: 2 }] }, error: null };
      if (/exécute la consigne/.test(m)) return { data: { reply: "Je transmets cette consigne au directeur général.", actions: [{ type: "propose_instruction", texte: "Relance la prospection AutoGarage avec auto.ci. " + (/DOUBLON/.test(m) ? "DOUBLON" : "") }] }, error: null };
      if (/CRMTEST/.test(m)) { const f = body.context.crm.trouves, ids = f.map((x) => x.rid), k = (m.match(/CRMTEST-(\w+)/) ?? [])[1];
        if (k === "demo") return { data: { reply: "J'enregistre la démonstration.", actions: [{ type: "crm_log", rids: [ids[0]], interaction: "demo", texte: "Démonstration réalisée sur place." }] }, error: null };
        if (k === "update") return { data: { reply: "Je passe ces fiches en client.", actions: [{ type: "crm_update", rids: ids, champs: { statut: "client", valeur: 400000 } }] }, error: null };
        if (k === "create") return { data: { reply: "Je crée la fiche.", actions: [{ type: "crm_create", champs: { nom: "GARAGE NOUVEAU TEST", phone: "+225 07 11 22 33 44", logiciel: "AutoGarage Pro" } }] }, error: null };
        if (k === "delete") return { data: { reply: "Je supprime cette fiche.", actions: [{ type: "crm_delete", rids: [ids[0]] }] }, error: null }; }
      if (/gros plan/.test(m)) return { data: { reply: "Bien sûr, je rapproche la vue.", actions: [{ type: "zoom_in" }] }, error: null };
      return { data: { reply: `Il y a ${body.context.kpi.agents_au_travail} agents au travail et ${body.context.kpi.fiches_creees_aujourdhui} fiches créées aujourd'hui.`, actions: [] }, error: null };
    }
    if (body.action === "instruction" && /DOUBLON/.test(body.contenu)) return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "Cette instruction est déjà en cours de traitement" }) } } };
    if (body.action === "instruction") {
      T("ai_executive_messages").push({ id: uid(), user_id: OP, auteur: "president", contenu: body.contenu, created_at: new Date().toISOString() });
      setTimeout(() => { T("ai_executive_messages").push({ id: uid(), user_id: null, auteur: "directeur", contenu: "Bien reçu. Je prépare le plan et reviens vers vous.", created_at: new Date().toISOString() }); window.__emit("ai_executive_messages", "INSERT", T("ai_executive_messages")[T("ai_executive_messages").length - 1]); }, 400);
      return { data: { ok: true, task_id: uid() }, error: null };
    }
    if (body.action === "assign_mission" || body.action === "request_report") {
      const ag = T("ai_agents").find((a) => a.id === body.agent_id);
      if (!ag) return { data: null, error: { message: "Agent introuvable", context: { json: async () => ({ error: "Agent introuvable" }) } } };
      const t = { id: uid(), agent_id: ag.id, donneur_user_id: OP, donneur_agent_id: null, parent_id: null, racine_id: null, type: "mission", titre: body.titre ?? "Rapport d'activité demandé par le président", statut: "a_faire", priorite: body.priorite ?? 1, created_at: new Date().toISOString(), progression: null, rapport: null, resultats: [], objectifs: body.objectifs ?? [], executions: 0, profondeur: 1, cout_usd: 0 };
      window.__emit("ai_agent_tasks", "INSERT", t);
      return { data: { task_id: t.id, agent: ag.nom }, error: null };
    }
    if (fn === "ai-sales-director" && ["qualifier", "contacter"].includes(body.action)) return { data: { ok: true }, error: null };
    if (fn === "crm-gmail" && body.action === "verifier_adresses") return { data: { ok: true, traitees: 3, a_confirmer: 2, invalides: 1, restantes: 0 }, error: null };
    if (body.action === "report_now" || body.action === "report_resend") return { data: { id: uid(), statut: "envoye", envoyes: ["president@sanix-africa.ci"] }, error: null };
    return { data: null, error: { message: "action inconnue", context: { json: async () => ({ error: "action inconnue" }) } } };
  };
  const RT = (window.__RT = []), STATUSCB = (window.__RTST = []);
  const chan = { on(_t, f, cb) { RT.push({ table: f.table, event: f.event, cb }); return chan; }, subscribe(cb) { if (cb) { STATUSCB.push(cb); setTimeout(() => cb("SUBSCRIBED"), 0); } return chan; } };
  /** Simule un changement publié par Postgres : met à jour la table puis notifie les abonnés (comme Supabase Realtime). */
  window.__emit = (table, event, row) => {
    const rows = T(table); let cur = rows.find((r) => r.id === row.id);
    if (event === "INSERT" && !cur) { rows.push(row); cur = row; } else if (cur) Object.assign(cur, row);
    const payload = { schema: "public", table, eventType: event, new: JSON.parse(JSON.stringify(cur ?? row)), old: { id: row.id }, errors: null };
    RT.filter((r) => r.table === table && (r.event === "*" || r.event === event)).forEach((r) => r.cb(payload));
  };
  window.__rtStatus = (st) => STATUSCB.forEach((cb) => cb(st));
  window.supabase = { createClient: () => ({
    from: builder, rpc, functions: { invoke }, channel: () => chan,
    // __NOSESSION : l'écran de connexion s'affiche ; __SIGNIN_ERR : erreur renvoyée par Supabase Auth (null = succès)
    auth: { getSession: async () => ({ data: { session: window.__NOSESSION && !window.__SIGNED ? null : { user: { id: OP } } } }),
      signInWithPassword: async (c) => { (window.__SIGNINS = window.__SIGNINS || []).push(c.email); if (window.__SIGNIN_ERR) return { error: window.__SIGNIN_ERR }; window.__SIGNED = true; return { error: null }; }, signOut: async () => ({}) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "about:blank" }, error: null }) }) },
  }) };
})();
