// SANIX AI · Salle de contrôle — assistant vocal « Jarvis » (Web Speech API du navigateur : aucune clé, aucun service tiers).
// Les réponses sont calculées localement à partir des données réelles de la salle (état, missions, fiches, santé) : instantanées et sans coût.
// Une demande hors périmètre n'est transmise au directeur général IA (instruction du Bureau) qu'APRÈS confirmation à voix haute ou au clavier ;
// sa réponse est ensuite lue dès qu'elle arrive. Commandes de caméra : « zoom avant », « vue d'ensemble », « montre le directeur commercial »…
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const WAKE = /\b(jarvis|jarvi|jarvice|jarviss|jarvys|gervais|gervaise|charvis|djarvis|sanix)\b/;
const PRODUCTS = { autogarage: [/auto ?garage|garage/, "AutoGarage Pro"], angels: [/angel|livraison/, "Angel's Livraison"], immosuite: [/immo/, "ImmoSuite"], avicosuite: [/avico|avicole|avinest|agro/, "AvicoSuite"], aluexpert: [/alu/, "AluExpert"] };

export function initJarvis(A, stage) {
  const D = A.D, SR = window.SpeechRecognition || window.webkitSpeechRecognition, TTS = "speechSynthesis" in window;
  const dock = document.createElement("div"); dock.id = "jarvis";
  dock.innerHTML = `<div id="jv-log" aria-live="polite"></div>
    <div class="jv-bar"><button type="button" id="jv-orb" class="orb" aria-label="Parler à Jarvis" title="Parler à Jarvis"><i></i></button>
    <div class="jv-mid"><input id="jv-in" type="text" autocomplete="off" placeholder="Parlez ou écrivez…" title="Ex. : « où en est AutoGarage ? »" aria-label="Message à Jarvis"><small id="jv-st">Jarvis prêt${SR ? "" : " (micro non pris en charge : utilisez le clavier)"}</small><span id="jv-mic-state" class="mic-state" data-state="${SR ? "idle" : "unsupported"}" role="status" aria-live="polite"><i></i><b>${SR ? "Micro prêt" : "Micro indisponible"}</b></span></div>
    <button type="button" id="jv-auto" class="jb" title="Mode autonome : Jarvis lance consignes, missions et rapports sans confirmation">⚡</button><button type="button" id="jv-ideas" class="jb" title="Propositions d'amélioration de Jarvis">💡<em id="jv-badge" hidden></em></button><button type="button" id="jv-send" class="jb" title="Envoyer">➤</button><button type="button" id="jv-voice" class="jb on" title="Activer ou couper la voix">🔊</button><button type="button" id="jv-voice-style" class="jb" title="Changer la voix française de Jarvis">🎙</button><button type="button" id="jv-hands" class="jb" title="Mains libres : dites « Jarvis » pour m'appeler">🖐</button></div>`;
  stage.appendChild(dock);
  const $ = (s) => dock.querySelector(s), logEl = $("#jv-log"), inEl = $("#jv-in"), st = $("#jv-st"), orb = $("#jv-orb"), micState = $("#jv-mic-state");
  let guard = null, voiceOn = true, hands = false, listening = false, speaking = false, rec = null, pending = null, convo = false, gotResult = false, llmDown = 0, hist = [], awakeUntil = 0, lastSpeechEnd = 0, poll = null;
  let micError = false; const lines = []; const setSt = (t) => { st.textContent = t; }; const setOrb = (c) => { orb.className = "orb " + c; }; const setMicState = (state, label) => { micError = state === "error"; micState.dataset.state = state; micState.querySelector("b").textContent = label; orb.dataset.micState = state; orb.setAttribute("aria-label", label); orb.title = label; };

  function addLine(who, text) { lines.push({ who, text }); if (lines.length > 40) lines.shift();
    const d = document.createElement("div"); d.className = "ln " + who; d.innerHTML = `<b>${who === "me" ? "Vous" : who === "dg" ? "Directeur général" : "Jarvis"}</b> ${esc(text)}`; logEl.appendChild(d); setTimeout(() => d.remove(), 16000); while (logEl.children.length > 3) logEl.firstChild.remove(); logEl.scrollTop = 1e6; }
  const VOICE_KEY = "sanix_jarvis_voice_fr";
  let speechRun = 0;
  function frenchVoices() { return (window.speechSynthesis?.getVoices() ?? []).filter((v) => /^fr([_-]|$)/i.test(v.lang)).sort((a, b) => a.name.localeCompare(b.name)); }
  function voiceFr() {
    const voices = frenchVoices(); let preferred = "";
    try { preferred = localStorage.getItem(VOICE_KEY) || ""; } catch { /* stockage indisponible */ }
    return voices.find((v) => v.name === preferred) || voices.find((v) => /fr-FR/i.test(v.lang) && /google|natural|enhanced/i.test(v.name)) || voices.find((v) => /fr-FR/i.test(v.lang)) || voices[0] || null;
  }
  function cycleVoice() {
    const voices = frenchVoices(); if (!voices.length) { setSt("Aucune voix française installée sur cet appareil."); return; }
    const current = voiceFr(), next = voices[(Math.max(0, voices.findIndex((v) => v.name === current?.name)) + 1) % voices.length];
    try { localStorage.setItem(VOICE_KEY, next.name); } catch { /* préférence non persistée */ }
    $("#jv-voice-style").title = "Voix : " + next.name + " — toucher pour changer";
    setSt("Voix sélectionnée : " + next.name);
    say("Bonjour. Je suis Jarvis. Comment puis-je vous aider ?", "jarvis");
  }
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => {
    const v = voiceFr(); if (v) $("#jv-voice-style").title = "Voix : " + v.name + " — toucher pour changer";
  });
  const clean = (t) => String(t).replace(/[*_`#>]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim();
  function say(text, who = "jarvis") {
    addLine(who, text); if (!voiceOn || !TTS || !text) { setTimeout(afterReply, 200); return; }
    const runId = ++speechRun, synth = window.speechSynthesis;
    clearTimeout(guard); synth.cancel();
    const plain = clean(text), parts = (plain.match(/[^.!?;:]+[.!?;:]?/g) ?? [plain]).map((p) => p.trim()).filter(Boolean).slice(0, 10);
    let index = 0;
    const finish = () => {
      if (runId !== speechRun) return;
      clearTimeout(guard); speaking = false; lastSpeechEnd = Date.now(); A.view?.speaking(false);
      setOrb(listening ? "listen" : ""); setSt(hands ? "Mains libres : dites « Jarvis »" : "Jarvis prêt"); afterReply();
    };
    const next = () => {
      if (runId !== speechRun) return;
      if (index >= parts.length) { finish(); return; }
      const p = parts[index++], u = new SpeechSynthesisUtterance(p);
      u.lang = "fr-FR"; u.rate = 0.96; u.pitch = 1.02; u.volume = 1;
      const v = voiceFr(); if (v) u.voice = v;
      u.onstart = () => { if (runId !== speechRun) return; speaking = true; A.view?.speaking(true); setOrb("speak"); setSt("Jarvis parle…"); };
      u.onend = () => { if (runId === speechRun) setTimeout(next, /[.!?]$/.test(p) ? 150 : 90); };
      u.onerror = () => { if (runId === speechRun) setTimeout(next, 100); };
      synth.speak(u);
    };
    guard = setTimeout(finish, Math.max(9000, plain.length * 115 + parts.length * 700));
    try { next(); } catch { finish(); }
  }

  function stopSpeech() { speechRun++; clearTimeout(guard); window.speechSynthesis?.cancel(); speaking = false; lastSpeechEnd = Date.now(); A.view?.speaking(false); setOrb(listening ? "listen" : ""); }

  // ───────── Réponses locales (données réelles) ─────────
  const run = () => D.agents.filter((a) => A.agentState(a) === "run");
  const openT = (f) => D.tasks.filter((t) => A.OPENS.includes(t.statut) && (!f || f(t)));
  function summary() { const act = D.agents.filter((a) => !["suspendu", "archive"].includes(a.etat)), h = A.health();
    return `${plural(run().length, "agent travaille", "agents travaillent")} sur ${act.length}. ${plural(D.tasks.filter((t) => t.statut === "en_cours").length, "mission en cours", "missions en cours")}, ${openT((t) => t.statut === "a_faire").length} en attente. ${plural(D.nToday, "fiche créée aujourd'hui", "fiches créées aujourd'hui")}, ${D.nTotal} prospects en base. ${plural(D.approvals, "décision à valider", "décisions à valider")}. Indice de santé : ${h.score} sur 100.`; }
  function productReply(id, label) { const ts = D.tasks.filter((t) => t.produit === id && t.statut !== "annulee"); if (!ts.length) return `Aucune mission ${label} dans les 7 derniers jours.`;
    const enc = ts.filter((t) => t.statut === "en_cours").length, af = ts.filter((t) => t.statut === "a_faire").length, ok = ts.filter((t) => t.statut === "terminee").length, bl = ts.filter((t) => ["bloquee", "echouee"].includes(t.statut)).length;
    const cr = ts.reduce((s, t) => s + (D.created[t.id] ?? 0), 0), tg = ts.reduce((s, t) => s + A.targetOf(t), 0);
    return `${label} : ${plural(ts.length, "mission", "missions")}, ${enc} en cours, ${af} à faire, ${ok} terminées, ${bl} bloquées. ${cr} fiches créées${tg ? ` sur ${tg} visées` : ""}.`; }
  function findAgent(q) { const toks = norm(q).split(" ").filter((w) => w.length > 2 && !["les", "des", "agent", "qui", "que", "fait", "sur", "avec", "pour"].includes(w)); if (!toks.length) return null;
    let best = null, bs = 0; for (const a of D.agents) { const n = norm(a.nom + " " + (a.fonction ?? "") + " " + (a.code ?? "")); const s = toks.filter((w) => n.includes(w)).length; if (s > bs) { bs = s; best = a; } } return bs ? best : null; }
  function agentReply(a) { const cur = D.tasks.find((t) => t.agent_id === a.id && t.statut === "en_cours") ?? D.tasks.find((t) => t.agent_id === a.id && A.OPENS.includes(t.statut)); const [lab] = A.STATES[A.agentState(a)];
    return cur ? `${a.nom} : ${lab.toLowerCase()}. Mission : ${clip(cur.titre, 110)}.` : `${a.nom} : ${lab.toLowerCase()}, aucune mission ouverte.`; }
  const view = () => A.view;
  function relationExplanation(r = D.relationSel) {
    if (!r?.agent || !r?.prospect) return "Aucune relation agent prospect n'est sélectionnée. Cliquez sur un lien du réseau, puis demandez-moi son analyse.";
    const ag=r.agent,p=r.prospect,aid=String(ag.id),pid=String(p.id);
    const acts=(D.relationRows||[]).filter(x=>String(x.agent_id||"")===aid&&String(x.prospect_id||"")===pid).sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0));
    const tasks=(D.tasks||[]).filter(x=>String(x.agent_id||"")===aid&&String(x.prospect_id||"")===pid);
    const open=tasks.filter(x=>A.OPENS.includes(x.statut)),blocked=tasks.filter(x=>["bloquee","echouee"].includes(x.statut)),done=tasks.filter(x=>x.statut==="terminee");
    const latest=acts[0],stage=String(p.stage||"non renseigné").replace(/_/g," ");
    const kind=r.kind==="activity"?"une interaction réelle":r.kind==="mission"?"une mission affectée":"une affectation";
    let out=`La relation entre ${ag.nom||"cet agent"} et ${p.entreprise||"ce prospect"} repose sur ${kind}. Le prospect est à l'étape ${stage}. ${acts.length} interaction(s) identifiée(s) et ${tasks.length} mission(s) associée(s), dont ${open.length} ouverte(s), ${done.length} terminée(s) et ${blocked.length} bloquée(s).`;
    if(latest) out+=` La dernière interaction connue est « ${latest.action||"événement"} », ${latest.at?new Date(latest.at).toLocaleString("fr-FR",{timeZone:"Africa/Abidjan"}):"à une date inconnue"}.`;
    if(open.length) out+=` La mission ouverte prioritaire est « ${clip(open.sort((a,b)=>(Number(a.priorite)||99)-(Number(b.priorite)||99))[0].titre,90)} ».`;
    if(blocked.length) out+=` Attention, ${blocked.length} mission(s) est/sont bloquée(s) ou en échec : une intervention est nécessaire.`;
    if(p.next_action_at) out+=` Prochaine action prévue : ${new Date(p.next_action_at).toLocaleString("fr-FR",{timeZone:"Africa/Abidjan"})}.`;
    else out+=" Aucune prochaine action n'est planifiée dans la fiche.";
    if(!acts.length&&r.kind!=="activity") out+=" Je ne vois pas d'interaction historisée attribuée à cet agent pour ce prospect ; le lien visible correspond à une mission ou une affectation, pas à une preuve de contact.";
    out+=" Mon conseil : vérifier la prochaine étape commerciale et consigner chaque échange avec son agent responsable.";
    return out;
  }
  const HELP = "Je peux : donner la situation, le nombre de fiches, qui travaille, les blocages, l'avancement d'un logiciel (par exemple AutoGarage), ce que fait un agent, piloter la caméra (zoom, vue d'ensemble, montre tel agent, rotation, plein cadre) et transmettre une demande au directeur général après votre confirmation.";

  let autoMode = false;
  // ───────── CRM en lecture seule : prospects, clients et leur situation (cache 2 min) ─────────
  let crmC = { at: 0, rows: [] };
  async function loadCrm() {
    if (Date.now() - crmC.at < 120000 && crmC.rows.length) return crmC.rows;
    const [c, p, ix] = await Promise.all([
      A.sb.from("crm_records").select("rid,version,nom:data->>nom,statut:data->>statut,logiciel:data->>logiciel,ville:data->>adresse,ia:data->ia,upd:updated_at").eq("entity", "clients").is("deleted_at", null).order("updated_at", { ascending: false }).limit(900),
      A.sb.from("ai_prospects").select("crm_rid,stage,score,priorite,last_inbound_at,last_outbound_at,next_action_at,opt_out").not("crm_rid", "is", null).limit(1000),
      // Historique des contacts enregistrés dans le CRM (WhatsApp, e-mail, appel) : ce que voit l'écran « Contacté », indépendamment des agents IA
      A.sb.from("crm_records").select("rid,interactions:data->interactions").eq("entity", "clients").is("deleted_at", null).neq("data->>interactions", "[]").limit(1000)]);
    if (c.error) throw new Error(c.error.message);
    const ai = new Map((p.data ?? []).map((x) => [x.crm_rid, x])), hist = new Map();
    for (const r of ix?.data ?? []) {
      const list = Array.isArray(r.interactions) ? r.interactions : [], h = { wa: 0, mail: 0, appel: 0, etape: 0, last: null };
      for (const x of list) {
        const t = String(x?.type ?? ""), et = Number(x?.etape) || 0; h.etape = Math.max(h.etape, et);
        const canal = /whatsapp/i.test(t) ? "WhatsApp" : /mail/i.test(t) ? "E-mail" : /appel|t[ée]l[ée]ph/i.test(t) ? "Appel" : et >= 1 ? "Contact" : "";
        if (!canal) continue; if (canal === "WhatsApp") h.wa++; else if (canal === "E-mail") h.mail++; else if (canal === "Appel") h.appel++;
        const d = Date.parse(x?.date ?? ""); if (!h.last || (d || 0) >= h.last.t) h.last = { t: d || 0, canal, date: x?.date ?? null };
      }
      hist.set(r.rid, h);
    }
    crmC = { at: Date.now(), rows: (c.data ?? []).map((r) => { const a = ai.get(r.rid), i = r.ia ?? {};
      const h = hist.get(r.rid);
      return { contacte: r.statut === "prospect" && !!h && h.etape >= 1, wa: h?.wa ?? 0, mail: h?.mail ?? 0, appel: h?.appel ?? 0, dernier_contact: h?.last?.date ?? null, canal: h?.last?.canal ?? "", rid: r.rid, version: r.version ?? null, nom: r.nom ?? "", statut: r.statut ?? "", logiciel: r.logiciel ?? "", ville: clip(r.ville ?? "", 40), etape: a?.stage ?? i.stage ?? "non traité", score: a?.score ?? i.score ?? null, envoi: a?.last_outbound_at ?? null, reponse: a?.last_inbound_at ?? null, suite: a?.next_action_at ?? null, desinscrit: !!a?.opt_out, maj: r.upd }; }) };
    return crmC.rows;
  }
  const dShort = (x) => (x ? new Date(x).toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan", day: "2-digit", month: "2-digit" }) : "");
  async function crmContext(message) {
    const rows = await loadCrm(), q = norm(message), stop = new Set(["jarvis", "prospect", "prospects", "client", "clients", "situation", "quelle", "quel", "combien", "dans", "pour", "avec", "est", "sont", "les", "des", "que", "qui", "comment", "fiche", "fiches", "crm"]);
    const toks = q.split(" ").filter((w) => w.length >= 4 && !stop.has(w)), line = (r) => ({ rid: r.rid, nom: r.nom, logiciel: r.logiciel, statut: r.contacte ? "contacté" : r.statut, contact: r.canal ? r.canal + " " + dShort(r.dernier_contact) : "", etape: r.desinscrit ? "désinscrit" : r.etape, score: r.score ?? "", ville: r.ville, dernier_envoi: dShort(r.envoi), derniere_reponse: dShort(r.reponse), prochaine_action: dShort(r.suite) });
    const byLog = {}, byStatut = {}; let contactes = 0, repondus = 0;
    const pros = rows.filter((r) => r.statut === "prospect"), parCanal = { prospects_contactes: rows.filter((r) => r.contacte).length, prospects_contactes_whatsapp: pros.filter((r) => r.wa > 0).length, prospects_contactes_mail: pros.filter((r) => r.mail > 0).length, prospects_contactes_appel: pros.filter((r) => r.appel > 0).length };
    for (const r of rows) { byStatut[r.statut || "?"] = (byStatut[r.statut || "?"] ?? 0) + 1; const l = (byLog[r.logiciel || "sans logiciel"] ??= { total: 0, etapes: {} }); l.total++; l.etapes[r.etape] = (l.etapes[r.etape] ?? 0) + 1; if (r.envoi) contactes++; if (r.reponse) repondus++; }
    const match = new Map();
    // Question sur les contacts (« contactés par WhatsApp », « relancer »…) : les fiches réellement contactées, les plus récentes d'abord
    if (/contact|whatsapp|\bwa\b|relanc|appel|mail|ecrit|envoy/.test(q)) {
      const pick = /whatsapp|\bwa\b/.test(q) ? (r) => r.wa > 0 : /mail/.test(q) ? (r) => r.mail > 0 : (r) => r.contacte || r.wa > 0 || r.mail > 0 || r.appel > 0;
      for (const r of rows.filter(pick).sort((a, b) => Date.parse(b.dernier_contact ?? 0) - Date.parse(a.dernier_contact ?? 0)).slice(0, 30)) match.set(r.nom + r.maj, r);
    }
    for (const [, [rx]] of Object.entries(PRODUCTS)) if (rx.test(q)) for (const r of rows) if (rx.test(norm(r.logiciel))) match.set(r.nom + r.maj, r);
    for (const r of rows) if (toks.some((w) => norm(r.nom).includes(w))) match.set(r.nom + r.maj, r);
    return { resume: { total: rows.length, par_statut: byStatut, ...parCanal, contactes, ont_repondu: repondus, par_logiciel: Object.entries(byLog).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([logiciel, v]) => ({ logiciel, total: v.total, etapes: v.etapes })) },
      recents: rows.slice(0, 25).map(line), trouves: [...match.values()].slice(0, 30).map(line) };
  }
  // ───────── Écriture CRM : même chemin que l'écran CRM (crm_sync_push, réservé aux opérateurs, champs sensibles protégés par version) ─────────
  const INTER = { note: ["Note", "📝", null], contact: ["Contact établi", "📞", 1], demo: ["Démo réalisée", "🎬", 2], proposition: ["Proposition envoyée", "📄", 3], negociation: ["Négociation", "🤝", 4], relance: ["Relance", "🔁", null], perdu: ["Perdu", "❌", 0], converti: ["Converti en client", "✅", 5] };
  let deviceId = ""; try { deviceId = sessionStorage.getItem("jarvis_dev") || ""; if (!deviceId) { deviceId = "jarvis-" + crypto.randomUUID(); sessionStorage.setItem("jarvis_dev", deviceId); } } catch { deviceId = "jarvis-" + Math.random().toString(36).slice(2, 12) + Date.now(); }
  const interaction = (type, note, etape) => { const [label, ico, e] = INTER[type] ?? INTER.note; const it = { date: new Date().toISOString(), type: label, note: String(note || label).slice(0, 600), ico, source: "jarvis" }; const et = etape ?? e; if (et !== null && et !== undefined) it.etape = et; return it; };
  async function crmExec(a) {
    crmC.at = 0; await loadCrm().catch(() => {}); const byRid = new Map(crmC.rows.map((r) => [r.rid, r])), ops = [], mk = () => crypto.randomUUID();
    if (a.type === "crm_create") {
      const c = a.champs, rid = "c_j" + mk().replace(/-/g, "").slice(0, 12);
      ops.push({ op_id: mk(), entity: "clients", rid, action: "upsert", data: { nom: c.nom, phone: c.phone ?? "", email: c.email ?? "", secteur: c.secteur ?? "", logiciel: c.logiciel ?? "", adresse: c.adresse ?? "", commercial: c.commercial ?? "", valeur: c.valeur ?? 0, statut: c.statut ?? "prospect", notes: c.notes ?? "", created_at: new Date().toISOString(), source: "Jarvis", interactions: [interaction("note", "Fiche créée par Jarvis sur instruction du président.")] } });
    } else for (const rid of a.rids) {
      const row = byRid.get(rid); if (!row) continue;
      if (a.type === "crm_delete") ops.push({ op_id: mk(), entity: "clients", rid, action: "delete", base_version: row.version });
      else if (a.type === "crm_log") { const data = { interactions: [interaction(a.interaction, a.texte)] }; if (a.interaction === "converti") { data.statut = "client"; data.converted_at = new Date().toISOString(); } ops.push({ op_id: mk(), entity: "clients", rid, action: "upsert", data, base_version: row.version }); }
      else { const { notes, ...champs } = a.champs, data = { ...champs }; if (notes) data.interactions = [interaction("note", notes)]; ops.push({ op_id: mk(), entity: "clients", rid, action: "upsert", data, base_version: row.version }); }   // les notes s'ajoutent à l'historique : jamais d'écrasement
    }
    if (!ops.length) return { ok: 0, ko: 0, raisons: ["aucune fiche correspondante"] };
    const { data, error } = await A.sb.rpc("crm_sync_push", { p_device: deviceId, p_ops: ops });
    if (error) throw new Error(error.message);
    crmC.at = 0; const res = data?.results ?? [], ko = res.filter((r) => r.ok === false || r.conflict), same = res.filter((r) => r.ok !== false && !r.conflict && r.unchanged);
    return { ok: res.length - ko.length - same.length, same: same.length, ko: ko.length, raisons: [...new Set(ko.map((r) => r.reason || r.error || "refusé"))].slice(0, 2) };
  }
  // ───────── Finance : levée de fonds (tables serveur, droits direction). Toujours confirmé ; « envoye » jamais : l'envoi reste humain. ─────────
  const LEVEE_ST = ["a_etudier", "correspond", "contacte", "en_discussion", "decline", "ecarte", "investi"], FIN_LAB = { fin_levee_statut: "financeur(s) mis à jour", fin_levee_note: "financeur(s) annoté(s)", fin_brouillon: "brouillon(s) traité(s)" };
  async function finExec(a) {
    const ids = (a.rids ?? []).slice(0, 25); if (!ids.length) throw new Error("aucune fiche");
    if (a.type === "fin_levee_statut") { if (!LEVEE_ST.includes(a.statut)) throw new Error("statut inconnu"); const { data, error } = await A.sb.from("levee_financeurs").update({ statut: a.statut }).in("id", ids).select("id"); if (error) throw new Error(error.message); return (data ?? []).length; }
    if (a.type === "fin_brouillon") { if (!["valide", "abandonne"].includes(a.statut)) throw new Error("statut de brouillon interdit"); const { data, error } = await A.sb.from("levee_brouillons").update({ statut: a.statut }).in("id", ids).eq("statut", "brouillon").select("id"); if (error) throw new Error(error.message); return (data ?? []).length; }
    if (a.type === "fin_levee_note") {
      const cur = await A.sb.from("levee_financeurs").select("id,notes").in("id", ids); if (cur.error) throw new Error(cur.error.message); let n = 0; const d = new Date().toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" });
      for (const f of cur.data ?? []) { const notes = ((f.notes ? f.notes + "\n" : "") + `[${d}, Jarvis] ${a.texte}`).slice(-2900); const r = await A.sb.from("levee_financeurs").update({ notes }).eq("id", f.id); if (r.error) throw new Error(r.error.message); n++; }
      return n;
    }
    throw new Error("action finance inconnue");
  }
  const CRM_LAB = { crm_update: "modifiée", crm_log: "mise à jour dans l'historique", crm_create: "créée", crm_delete: "supprimée" };
  async function crmLocalReply(t) {
    const rows = await loadCrm(); let sel = rows, lab = "";
    for (const [, [rx, label]] of Object.entries(PRODUCTS)) if (rx.test(t)) { sel = rows.filter((r) => rx.test(norm(r.logiciel))); lab = " " + label; break; }
    if (!sel.length) return "Je ne trouve aucun prospect" + (lab ? " pour" + lab : "") + " dans le CRM.";
    const et = {}; for (const r of sel) et[r.etape] = (et[r.etape] ?? 0) + 1;
    return `${plural(sel.length, "fiche", "fiches")} dans le CRM${lab ? " pour" + lab : ""} : ` + Object.entries(et).map(([k, n]) => `${n} ${k}`).join(", ") + `. ${sel.filter((r) => r.contacte || r.envoi).length} contactées (${sel.filter((r) => r.wa > 0).length} par WhatsApp), ${sel.filter((r) => r.reponse).length} ont répondu.`;
  }
  const RANK = { haute: 0, moyenne: 1, basse: 2 };
  function insights() {
    const out = [], h = A.health(), now = Date.now(), day = 864e5, I = (gravite, constat, piste, texte) => out.push({ gravite, constat, piste, action: texte ? { kind: "instruction", texte } : null });
    const blocked = D.tasks.filter((t) => ["bloquee", "echouee"].includes(t.statut) && now - Date.parse(t.updated_at) < day);
    if (blocked.length) I(blocked.length >= 3 ? "haute" : "moyenne", `${plural(blocked.length, "mission bloquée", "missions bloquées")} sur 24 heures : ${blocked.slice(0, 2).map((t) => clip(t.titre, 50)).join(" ; ")}`, "analyser les causes et relancer autrement", `Analyse les ${blocked.length} missions bloquées ou échouées des dernières 24 heures (${blocked.slice(0, 3).map((t) => t.titre).join(" ; ")}), identifie la cause de chaque blocage et propose-moi un plan de reprise.`);
    if (h.stale) I("haute", `${plural(h.stale, "mission figée", "missions figées")} depuis plus de 90 minutes`, "vérifier et débloquer les agents concernés", "Vérifie les missions en cours depuis plus de 90 minutes sans progression, débloque-les ou reprogramme-les, et dis-moi la cause.");
    const prosp = D.tasks.filter((t) => t.produit && /prospect/i.test(t.titre) && ["terminee", "bloquee", "echouee"].includes(t.statut) && now - Date.parse(t.updated_at) < 2 * day), byP = {};
    for (const t of prosp) { const b = (byP[t.produit] ??= { c: 0, g: 0 }); b.c += D.created[t.id] ?? 0; b.g += A.targetOf(t) || 20; }
    for (const [pid, b] of Object.entries(byP)) if (b.c < b.g * .25) { const lab = PRODUCTS[pid]?.[1] ?? pid; I("haute", `Prospection ${lab} : ${b.c} fiches créées pour ${b.g} visées`, "changer de sources (sites propres, annuaires professionnels, réseaux)", `La prospection ${lab} sous-performe (${b.c} fiches pour ${b.g} visées). Propose une stratégie de recherche différente (sources avec coordonnées publiques) et relance les chasseurs concernés.`); }
    if (h.qual !== null && h.qual < 70) I("moyenne", `${h.qual} % seulement des fiches du jour ont un contact et une source`, "faire contrôler et compléter les fiches", "Demande au Data Analyst de contrôler les fiches créées aujourd'hui et de compléter les contacts et sources manquants.");
    if (h.rate !== null && h.rate < 60) I("moyenne", `Taux de réussite des missions : ${h.rate} % sur 7 jours`, "revoir les consignes des missions qui échouent", "Analyse les missions échouées ou bloquées des 7 derniers jours, trouve les causes communes et propose des consignes plus précises.");
    if (D.approvals) I("moyenne", `${plural(D.approvals, "décision attend", "décisions attendent")} votre validation`, "les traiter depuis le Bureau", null);
    const b = D.budget; if (b && Number(b.jour_usd) < Number(b.budget_jour_usd) * .2 && openT((t) => t.statut === "a_faire").length >= 4) I("basse", `Capacité IA peu utilisée (${Number(b.jour_usd).toFixed(2)} $ sur ${Number(b.budget_jour_usd).toFixed(0)} $) alors que ${openT((t) => t.statut === "a_faire").length} missions attendent`, "passer les agents clés en mode API pour accélérer (réglage Gouvernance)", null);
    for (const [pid, [, lab]] of Object.entries(PRODUCTS)) if (D.tasks.some((t) => t.produit) && !D.tasks.some((t) => t.produit === pid && !["annulee"].includes(t.statut))) I("basse", `Aucune mission récente pour ${lab}`, "lancer une prospection ou un plan d'action", `Prépare un plan d'action commercial pour ${lab} : cibles, canal, objectifs de la semaine.`);
    return out.sort((a, b2) => RANK[a.gravite] - RANK[b2.gravite]).slice(0, 6);
  }
  function ideasReply() {
    const top = insights().slice(0, 3); if (!top.length) return "Tout est sous contrôle : je ne détecte aucun problème. Je peux proposer d'étendre la prospection si vous le souhaitez.";
    const ord = ["Un", "Deux", "Trois"], items = top.map((x) => (x.action ? { kind: "instruction", texte: x.action.texte } : null));
    pending = items.some(Boolean) ? { kind: "multi", items } : null;
    return `J'ai ${plural(top.length, "proposition", "propositions")}. ` + top.map((x, i) => `${ord[i]} : ${x.constat}. Piste : ${x.piste}.`).join(" ") + (pending ? " Laquelle dois-je lancer ? Dites un, deux, trois ou toutes." : "");
  }
  const ACT = { zoom_in: () => view()?.zoom(.7), zoom_out: () => view()?.zoom(1.45), reset_view: () => view()?.reset(), auto_rotate_on: () => view()?.setAuto(true), auto_rotate_off: () => view()?.setAuto(false),
    dynamic_on: () => { view()?.setDynamic(true); document.querySelector('#ctl [data-c="dyn"]')?.classList.add("on"); }, dynamic_off: () => { view()?.setDynamic(false); document.querySelector('#ctl [data-c="dyn"]')?.classList.remove("on"); },
    panels_hide: () => A.setFocus(true), panels_show: () => A.setFocus(false), fullscreen: () => A.fullscreen() };
  function snapshot() {
    const nm = (id) => A.nameOf(id), cur = (a) => { const t = D.tasks.find((x) => x.agent_id === a.id && x.statut === "en_cours") ?? D.tasks.find((x) => x.agent_id === a.id && A.OPENS.includes(x.statut)); return t ? t.titre : ""; };
    const h = A.health();
    return { mode: autoMode ? "autonome" : "prudent", heure: new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", dateStyle: "full", timeStyle: "short" }).format(new Date()),
      kpi: { agents_au_travail: run().length, agents_actifs: D.agents.filter((a) => !["suspendu", "archive"].includes(a.etat)).length, missions_en_cours: D.tasks.filter((t) => t.statut === "en_cours").length, missions_en_attente: openT((t) => t.statut === "a_faire").length, fiches_creees_aujourdhui: D.nToday, prospects_en_base: D.nTotal, decisions_a_valider: D.approvals, sante_0_100: h.score, missions_figees: h.stale, blocages_24h: h.blocked, cout_ia_jour_usd: D.budget?.jour_usd ?? null, budget_jour_usd: D.budget?.budget_jour_usd ?? null },
      insights: insights().map((x) => ({ gravite: x.gravite, constat: x.constat, piste: x.piste })),
      agents: D.agents.filter((a) => a.etat !== "archive").slice(0, 40).map((a) => ({ id: a.id, nom: a.nom, fonction: a.fonction, etat: A.STATES[A.agentState(a)][0], mission: cur(a) })),
      missions: D.tasks.slice(0, 30).map((t) => ({ statut: t.statut, agent: nm(t.agent_id), produit: t.produit ?? "", titre: t.titre, fiches: A.targetOf(t) ? `${D.created[t.id] ?? 0}/${A.targetOf(t)}` : "" })),
      recent: (D.actions ?? []).slice(0, 10).map((a) => ({ quand: new Date(a.at).toLocaleTimeString("fr-FR", { timeZone: "Africa/Abidjan", hour: "2-digit", minute: "2-digit" }), agent: nm(a.agent_id), action: String(a.action ?? "") })) };
  }
  async function askLLM(raw) {
    if (Date.now() < llmDown || !A.sb?.functions?.invoke) return null;
    setOrb("think"); setSt("Jarvis réfléchit…");
    try {
      const ctx = snapshot(); try { const r = await A.sb.from("ai_executive_messages").select("auteur,contenu,created_at").order("created_at", { ascending: false }).limit(6); ctx.dg = (r.data ?? []).reverse().map((m) => ({ auteur: m.auteur, texte: m.contenu })); } catch { /* dialogue indisponible */ }
      try { ctx.crm = await crmContext(raw); } catch { /* CRM indisponible : Jarvis répond avec le reste du contexte */ }
      try { const r = await A.sb.rpc("ai_envoi_etat"); if (r?.data && !r.error) { const e = r.data; ctx.kpi.envoi_planifie = { fenetre_ouverte: e.fenetre_ouverte, prochain_creneau: e.prochain_creneau ? new Date(e.prochain_creneau).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan", weekday: "short", hour: "2-digit", minute: "2-digit" }) : null, horaires: `${e.debut}-${e.fin}`, wa_aujourdhui: `${e.wa_envoyes_aujourdhui}/${e.plafond_wa_jour}`, en_file: e.en_file, a_valider: e.a_valider }; } } catch { /* planification non installée */ }
      const call = A.sb.functions.invoke("ai-jarvis", { body: { message: raw, history: hist.slice(-8), context: ctx } });
      const { data, error } = await Promise.race([call, new Promise((_, rej) => setTimeout(() => rej(new Error("délai dépassé")), 25000))]);
      if (error || !data?.reply) throw new Error(error ? await explain(error) : "réponse vide");
      hist.push({ role: "user", content: raw }, { role: "assistant", content: data.reply }); if (hist.length > 16) hist.splice(0, hist.length - 16);
      let reply = String(data.reply); const acts = Array.isArray(data.actions) ? data.actions : [];
      const props = [];
      for (const a of acts) {
        if (ACT[a.type]) ACT[a.type]();
        else if (a.type === "focus_agent") view()?.focus(a.agent_id);
        else if (a.type === "propose_instruction" && a.texte) props.push({ kind: "instruction", texte: a.texte });
        else if (a.type === "propose_mission" && a.agent_id && a.titre) props.push({ kind: "mission", agent_id: a.agent_id, titre: a.titre, description: a.description, priorite: a.priorite });
        else if (a.type?.startsWith("crm_")) props.push({ kind: "crm", a });
        else if (a.type?.startsWith("fin_")) props.push({ kind: "fin", a });
        else if (a.type === "propose_report" && a.agent_id) props.push({ kind: "report", agent_id: a.agent_id, jours: a.jours || 7 });
        else if (a.type === "propose_report_now" && a.rapport) props.push({ kind: "report_now", type: a.rapport });
      }
      if (autoMode && props.length) { const risky = props.filter((x) => x.kind === "fin" || (x.kind === "crm" && x.a.type === "crm_delete")), safe = props.filter((x) => !risky.includes(x)); pending = risky.length > 1 ? { kind: "multi", items: risky } : risky[0] ?? null; setOrb(listening ? "listen" : ""); say(reply + (risky.length ? " Cette action demande votre confirmation : dites oui." : "")); for (const it of safe) await sendPending(it); return reply; }   // mode autonome : exécution immédiate (actions internes uniquement)
      pending = props.length > 1 ? { kind: "multi", items: props } : props[0] ?? null;
      if (pending && !/\?/.test(reply)) reply += pending.kind === "multi" ? " Laquelle dois-je lancer ? Dites un, deux, trois ou toutes." : " Dois-je le transmettre ? Dites oui pour confirmer.";
      setOrb(listening ? "listen" : ""); say(reply); return reply;
    } catch (e) { llmDown = Date.now() + 45000; setOrb(listening ? "listen" : ""); setSt("Mode local : " + clip(e.message, 50)); return null; }
  }
  function afterReply() { if (convo && !hands && SR && !listening && !pending_busy) { convo = false; setTimeout(() => { gotResult = false; convoNext = true; startRec(); }, 250); } }
  let pending_busy = false, convoNext = false;
  // Message d'erreur réel d'une Edge Function (supabase-js ne donne que « non-2xx » : la raison est dans le corps de la réponse)
  async function explain(error) {
    try { const c = error?.context; if (c) { const j = typeof c.json === "function" ? await c.json() : null; if (j?.error) return String(j.error); } } catch { /* corps illisible */ }
    return String(error?.message ?? error ?? "erreur inconnue");
  }
  const friendly = (m) => (/déjà en cours/.test(m) ? "Une instruction identique est déjà en cours chez le directeur général. Reformulez-la, ou attendez sa réponse." : m);
  async function call(fn, body) { const r = await A.sb.functions.invoke(fn, { body }); if (r.error) throw new Error(friendly(await explain(r.error))); return r.data; }
  async function sendPending(p) {
    if (typeof p === "string") p = { kind: "instruction", texte: p };
    pending_busy = true;
    try {
      if (p.kind === "mission") { await call("ai-company", { action: "assign_mission", agent_id: p.agent_id, titre: p.titre, description: p.description, objectifs: [], priorite: p.priorite }); say(`Mission confiée à ${A.nameOf(p.agent_id)}. Vous la verrez apparaître dans la salle.`); }
      else if (p.kind === "report") { await call("ai-company", { action: "request_report", agent_id: p.agent_id, jours: p.jours }); say(`Rapport demandé à ${A.nameOf(p.agent_id)} sur ${p.jours} jours.`); }
      else if (p.kind === "crm") { const r = await crmExec(p.a); say(r.ok ? `C'est fait : ${plural(r.ok, "fiche", "fiches")} ${CRM_LAB[p.a.type]}${r.same ? `, ${r.same} déjà à jour` : ""}${r.ko ? `, ${r.ko} refusée${r.ko > 1 ? "s" : ""} (${r.raisons.join(" ; ")})` : ""}.` : `Aucune fiche n'a pu être ${CRM_LAB[p.a.type]} : ${r.raisons.join(" ; ") || (r.same ? "elles étaient déjà à jour" : "refusé")}.`); }
      else if (p.kind === "fin") { const n = await finExec(p.a); say(n ? `C'est fait : ${n} ${FIN_LAB[p.a.type]}.` : "Rien n'a été modifié : les éléments étaient déjà à jour ou introuvables."); }
      else if (p.kind === "report_now") { await call("ai-company", { action: "report_now", type: p.type }); say(`Le rapport ${p.type} est généré et envoyé.`); }
      else { const sentAt = Date.now() - 2000; await call("ai-company", { action: "instruction", contenu: p.texte }); say("Instruction transmise au directeur général. Je vous lis sa réponse dès qu'elle arrive."); watchDg(sentAt); }
      return "transmis";
    } catch (e) { say("Je n'ai pas pu exécuter cette action : " + clip(e.message, 160)); return "erreur"; }
    finally { pending_busy = false; }
  }
  const sendInstruction = (texte) => sendPending({ kind: "instruction", texte });
  function watchDg(since) { clearInterval(poll); let n = 0, seen = new Set();
    poll = setInterval(async () => { n++; if (n > 60) { clearInterval(poll); return; }
      try { const r = await A.sb.from("ai_executive_messages").select("id,auteur,contenu,created_at").eq("auteur", "directeur").order("created_at", { ascending: false }).limit(4); const rows = (r.data ?? []).filter((m) => Date.parse(m.created_at) >= since && !seen.has(m.id)).reverse();
        for (const m of rows) { seen.add(m.id); say(clip(clean(m.contenu), 900), "dg"); } } catch { /* nouvel essai au prochain cycle */ } }, 4000); }

  async function handle(raw) {
    let t = norm(raw).replace(/^(ok |hey |dis |salut |bonjour )?(jarvis|jarvi|jarvice|jarviss|jarvys|gervais|gervaise|charvis|djarvis|sanix|assistant)( |$)/, "").trim(); if (!t) { say("À vos ordres."); return "À vos ordres."; }
    addLine("me", raw); const reply = (s) => { say(s); return s; };
    if (/(explique|analyse|etat|situation|bilan|resume).*(relation|lien|selection)|relation.*(selection|actuelle)/.test(t)) return reply(relationExplanation());
    if (pending) {
      const yes = /^(oui|ok|confirme|vas y|transmets|envoie|d accord|affirmatif|lance)\b/.test(t), no = /^(non|annule|laisse tomber|stop|negatif)\b/.test(t);
      if (pending.kind === "multi") {
        const all = /\b(toutes|tout|les trois|les deux|les 3|les 2)\b/.test(t), n = all ? 0 : /\b(3|trois|troisieme)\b/.test(t) ? 3 : /\b(2|deux|deuxieme|seconde)\b/.test(t) ? 2 : /\b(1|un|une|premier|premiere)\b/.test(t) ? 1 : null;
        if (no) { pending = null; return reply("D'accord, j'annule."); }
        if (all || n) { const p = pending, sel = all ? p.items.filter(Boolean) : [p.items[n - 1]].filter(Boolean); if (!sel.length) return reply("Cette proposition est à traiter par vous : je n'ai pas d'action à lancer."); pending = null; for (const it of sel) await sendPending(it); return "transmis"; }
        if (yes) return reply("Laquelle ? Dites un, deux, trois ou toutes.");
        pending = null;
      } else if (yes) { const p = pending; pending = null; await sendPending(p); return "transmis"; }
      else if (no) { pending = null; return reply("D'accord, j'annule."); }
      else pending = null;
    }
    if (/zoom(e)? (avant|plus)|rapproche|agrandi|plus pres/.test(t)) { if (!view()) return reply("La vue 3D n'est pas disponible sur cet appareil."); view().zoom(.7); return reply("Zoom avant."); }
    if (/zoom(e)? (arriere|moins)|recule|eloigne|plus loin|reduis la vue/.test(t)) { if (!view()) return reply("La vue 3D n'est pas disponible."); view().zoom(1.45); return reply("Zoom arrière."); }
    if (/vue d ensemble|reinitialis|recentre|remets la vue|vue globale/.test(t)) { view()?.reset(); return reply("Vue d'ensemble."); }
    if (/(fige|immobilise|arrete|stoppe|coupe|desactive).*(mouvement|dynamique|orbite|agents)|mode (calme|statique|fixe)/.test(t)) { view()?.setDynamic(false); document.querySelector('#ctl [data-c="dyn"]')?.classList.remove("on"); return reply("Mouvement des agents arrêté. Mode calme."); }
    if (/(active|lance|remets|reprends|demarre).*(mouvement|dynamique|orbite|perpetuel)|mode (dynamique|perpetuel|vivant)/.test(t)) { view()?.setDynamic(true); document.querySelector('#ctl [data-c="dyn"]')?.classList.add("on"); return reply("Mode dynamique activé. Mouvement perpétuel."); }
    if (/(arrete|stoppe|coupe|pause).*(rotation|tourner)|ne tourne plus/.test(t)) { view()?.setAuto(false); return reply("Rotation arrêtée."); }
    if (/(lance|active|demarre|reprends).*(rotation|tourner)|fais tourner/.test(t)) { view()?.setAuto(true); return reply("Rotation activée."); }
    if (/(reduis|masque|cache|ferme).*(panneau|colonne)|plein cadre|mode immersion|plein ecran/.test(t)) { if (/plein ecran/.test(t)) A.fullscreen(); else A.setFocus(true); return reply("Mode immersion activé."); }
    if (/(affiche|montre|reouvre|reviens).*(panneau|colonne|tableau)|quitte.*(immersion|plein cadre)/.test(t)) { A.setFocus(false); return reply("Panneaux affichés."); }
    let m;
    if ((m = /^(?:montre|focus|zoom sur|va sur|affiche|approche toi de|selectionne)(?: moi)?(?: l agent| le| la| les)? (.+)/.exec(t))) { const a = findAgent(m[1]); if (a && view()?.focus(a.id)) return reply(`Voici ${a.nom}. ${agentReply(a)}`); if (!a) return reply("Je ne trouve pas cet agent."); }
    if (/mode (autonome|plein pouvoir|pleine capacite|plein regime)|(passe|mets|active).*(autonome)/.test(t)) { setAuto(true); return reply("Mode autonome activé. Je lance moi-même les consignes, missions et rapports, sans vous demander confirmation. Rien n'est envoyé à l'extérieur."); }
    if (/mode (prudent|manuel|confirmation)|(desactive|quitte).*(autonome)/.test(t)) { setAuto(false); return reply("Mode prudent. Je vous demanderai confirmation avant chaque action."); }
    { const L = await askLLM(raw); if (L) return L; }   // conversation : Jarvis comprend la demande en langage naturel ; sans serveur, repli sur les réponses locales ci-dessous
    if (/(prospect|crm|clients?\b|fiches? (client|prospect))/.test(t)) { try { return reply(await crmLocalReply(t)); } catch { /* CRM indisponible */ } }
    if (/quelle heure|il est quelle heure/.test(t)) return reply("Il est " + new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(":", " heures ") + " à Abidjan.");
    if (/^(aide|que sais tu|tu sais faire quoi|commandes|que peux tu)/.test(t)) return reply(HELP);
    for (const [id, [rx, label]] of Object.entries(PRODUCTS)) if (rx.test(t) && /(ou en est|avancement|point sur|situation|bilan|combien|progress|fiches|mission)/.test(t)) return reply(productReply(id, label));
    if (/(que fait|sur quoi travaille|ou en est) (.+)/.test(t)) { const a = findAgent(t.replace(/^.*(que fait|sur quoi travaille|ou en est)/, "")); if (a) return reply(agentReply(a)); }
    if (/(proposition|amelior|suggest|conseil|recommand|optimis|que dois je|que faut il|quoi faire)/.test(t)) return reply(ideasReply());
    if (/(etat|situation|bilan|resume|rapport|comment (ca|vont) |tout va bien|point general)/.test(t)) return reply(summary());
    if (/combien.*(fiche|prospect)/.test(t)) return reply(/aujourd|ce jour|jour/.test(t) ? `${plural(D.nToday, "fiche créée aujourd'hui", "fiches créées aujourd'hui")}.` : `${D.nTotal} prospects en base, dont ${D.nToday} créés aujourd'hui.`);
    if (/(qui|quels agents).*(travaill|actif|occupe|en mission)/.test(t)) { const r = run(); return reply(r.length ? `${plural(r.length, "agent travaille", "agents travaillent")} : ${r.slice(0, 6).map((a) => a.nom.replace(/^IA /, "")).join(", ")}${r.length > 6 ? "…" : ""}.` : "Aucun agent n'est au travail pour le moment."); }
    if (/(bloque|probleme|alerte|souci|fige|erreur)/.test(t)) { const h = A.health(), b = D.tasks.filter((x) => ["bloquee", "echouee"].includes(x.statut) && Date.now() - Date.parse(x.updated_at) < 864e5).slice(0, 3);
      return reply(h.stale || h.blocked ? `${plural(h.stale, "mission figée", "missions figées")} et ${plural(h.blocked, "blocage", "blocages")} sur 24 heures.${b.length ? " Par exemple : " + b.map((x) => clip(x.titre, 60)).join(" ; ") + "." : ""}` : "Aucun blocage ni mission figée. Tout est sous contrôle."); }
    if (/(sante|indice|qualite)/.test(t)) { const h = A.health(); return reply(`Indice de santé : ${h.score} sur 100. ${h.rate === null ? "" : `${h.rate} % de missions réussies sur sept jours. `}${h.qual === null ? "" : `${h.qual} % des fiches du jour ont un contact et une source.`}`); }
    if (/(valider|validation|approuv)/.test(t)) return reply(D.approvals ? `${plural(D.approvals, "décision attend", "décisions attendent")} votre validation.` : "Aucune décision en attente.");
    if (/(budget|cout|depense|combien (ca )?coute)/.test(t)) { const b = D.budget; return reply(b ? `Coût IA du jour : ${Number(b.jour_usd).toFixed(2)} dollars sur ${Number(b.budget_jour_usd).toFixed(0)}. Ce mois : ${Number(b.mois_usd).toFixed(2)} dollars.` : "Le budget n'est pas disponible."); }
    if (/(missions? en cours|en ce moment|actuellement)/.test(t)) { const ts = D.tasks.filter((x) => x.statut === "en_cours").slice(0, 4); return reply(ts.length ? `${plural(ts.length, "mission en cours", "missions en cours")} : ${ts.map((x) => `${A.nameOf(x.agent_id).replace(/^IA /, "")} sur ${clip(x.titre, 50)}`).join(" ; ")}.` : "Aucune mission en cours."); }
    // hors périmètre : proposition de transmission au directeur général, jamais d'envoi sans confirmation
    pending = { kind: "instruction", texte: raw.trim() }; return reply(`Je n'ai pas de réponse directe à cela. Voulez-vous que je le transmette au directeur général : « ${clip(raw.trim(), 140)} » ? Dites oui pour confirmer, non pour annuler.`);
  }

  // ───────── Micro : demande explicite d'autorisation depuis Jarvis ─────────
  let micGranted = false, micRequesting = false;
  async function activateMicAndStart() {
    if (!SR) { setMicState("unsupported", "Micro indisponible"); setSt("La reconnaissance vocale n'est pas prise en charge par ce navigateur. Utilisez le clavier ou ouvrez Jarvis dans Chrome."); return; }
    if (micRequesting) return;
    if (!window.isSecureContext) { setMicState("error", "HTTPS requis"); setSt("Le microphone exige une connexion sécurisée HTTPS. Ouvrez l'application avec son adresse HTTPS."); return; }
    if (!micGranted && navigator.mediaDevices?.getUserMedia) {
      micRequesting = true; setMicState("requesting", "Autorisation…"); setSt("Demande d'autorisation du microphone…");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        micGranted = true; setMicState("idle", "Micro autorisé");
      } catch (e) {
        const messages = { NotAllowedError: "Accès micro refusé. Autorisez le microphone dans les permissions du site puis réessayez.", PermissionDeniedError: "Accès micro refusé. Autorisez le microphone dans les permissions du site puis réessayez.", NotFoundError: "Aucun microphone détecté sur cet appareil.", NotReadableError: "Le microphone est déjà utilisé ou indisponible." };
        setMicState("error", "Accès refusé"); setSt(messages[e.name] || "Impossible d'activer le microphone : " + (e.message || e.name));
        micRequesting = false; return;
      } finally { micRequesting = false; }
    }
    startRec();
  }
  function startRec() {
    if (!SR) { setSt("Micro non pris en charge : utilisez le clavier."); return; }
    if (!rec) { rec = new SR(); rec.lang = "fr-FR"; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.onstart = () => { listening = true; setMicState("listening", "Écoute active"); setOrb(speaking ? "speak" : "listen"); setSt(hands ? "Mains libres : dites « Jarvis »" : "Je vous écoute…"); };
      rec.onresult = (ev) => { if ((speaking && window.speechSynthesis?.speaking) || Date.now() - lastSpeechEnd < 700) return; let fin = "", itm = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; (r.isFinal ? (fin += r[0].transcript) : (itm += r[0].transcript)); }
        if (itm) setSt("… " + itm); if (!fin.trim()) return; const txt = fin.trim();
        const nt = norm(txt); setSt("Entendu : « " + clip(txt, 60) + " »");
        if (hands && !WAKE.test(nt) && Date.now() > awakeUntil) { setSt("Entendu : « " + clip(txt, 40) + " » — dites d'abord « Jarvis »"); return; }   // mains libres : seul « Jarvis » réveille
        if (hands && WAKE.test(nt) && nt.replace(WAKE, "").replace(/\b(ok|hey|dis|salut)\b/g, "").trim() === "") { awakeUntil = Date.now() + 9000; say("À vos ordres."); return; }
        gotResult = true; convo = !hands; stopSpeech(); awakeUntil = Date.now() + 9000; handle(txt); };
      rec.onerror = (e) => { const msg = { "not-allowed": "Autorisez le microphone dans le navigateur.", "no-speech": "Aucune parole détectée.", "audio-capture": "Microphone introuvable." }[e.error]; setMicState(e.error === "no-speech" ? "idle" : "error", e.error === "no-speech" ? "En attente" : "Erreur micro"); setSt(msg ?? "Micro : " + e.error); if (e.error === "not-allowed") { hands = false; $("#jv-hands").classList.remove("on"); } };
      rec.onend = () => { listening = false; setOrb(""); if (convoNext && !gotResult) { convoNext = false; convo = false; } if (hands) { setMicState("listening", "Reconnexion…"); try { rec.start(); } catch { /* déjà actif */ } } else { if (!micError) setMicState("idle", micGranted ? "Micro autorisé" : "Micro prêt"); setSt(micError ? "Vérifiez l'autorisation du microphone puis réessayez." : "Jarvis prêt"); } }; }
    rec.continuous = hands; try { rec.start(); } catch { /* déjà actif */ }
  }
  orb.addEventListener("click", () => { if (listening && !hands) { setMicState("idle", "Micro en pause"); rec?.stop(); return; } if (speaking) { stopSpeech(); return; } activateMicAndStart(); });
  const sendTxt = () => { const v = inEl.value.trim(); if (!v) return; inEl.value = ""; handle(v); };
  const setAuto = (on) => { autoMode = !!on; $("#jv-auto").classList.toggle("on", autoMode); $("#jv-auto").classList.toggle("warn", autoMode); };
  $("#jv-auto").addEventListener("click", () => handle(autoMode ? "mode prudent" : "mode autonome"));
  $("#jv-ideas").addEventListener("click", () => handle("Jarvis, quelles améliorations me proposes-tu ?"));
  let announced = false;
  const refreshIdeas = () => { try { const n = insights().length, b = $("#jv-badge"); b.hidden = !n; b.textContent = n; if (n && !announced && D.agents.length) { announced = true; addLine("jarvis", `J'ai ${plural(n, "proposition d'amélioration", "propositions d'amélioration")}. Touchez 💡 ou dites « propositions ».`); } } catch { /* données pas encore chargées */ } };
  setInterval(refreshIdeas, 15000); setTimeout(refreshIdeas, 3500);
  $("#jv-send").addEventListener("click", sendTxt); inEl.addEventListener("keydown", (e) => { if (e.key === "Enter") sendTxt(); e.stopPropagation(); });
  $("#jv-voice").addEventListener("click", (e) => { voiceOn = !voiceOn; e.currentTarget.classList.toggle("on", voiceOn); e.currentTarget.textContent = voiceOn ? "🔊" : "🔇"; if (!voiceOn) stopSpeech(); setSt(voiceOn ? "Voix activée" : "Voix désactivée"); });
  $("#jv-voice-style").addEventListener("click", cycleVoice);
  $("#jv-hands").addEventListener("click", (e) => { hands = !hands; e.currentTarget.classList.toggle("on", hands); if (hands) { if (!SR) { setMicState("unsupported", "Micro indisponible"); hands = false; e.currentTarget.classList.remove("on"); setSt("Mains libres indisponible : micro non pris en charge."); return; } if (listening) rec.stop(); setTimeout(activateMicAndStart, 150); setSt("Activation du microphone…"); } else { setMicState("idle", "Micro en pause"); rec?.stop(); setSt("Jarvis prêt"); } });
  addLine("jarvis", "Salle de contrôle en ligne. Dites « Jarvis, situation » ou écrivez votre demande.");
  window.__jarvis = { crm: () => crmContext(""), crmRows: () => crmC.rows.slice(), insights, auto: () => autoMode, setLLM: (on) => { llmDown = on ? 0 : Infinity; }, history: () => hist.slice(), ask: (t) => handle(t), lines: () => lines.slice(), pending: () => pending, say, explainRelation: (r) => say(relationExplanation(r)) };
}
