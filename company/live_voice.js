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
    <div class="jv-mid"><input id="jv-in" type="text" autocomplete="off" placeholder="Parlez ou écrivez…" title="Ex. : « où en est AutoGarage ? »" aria-label="Message à Jarvis"><small id="jv-st">Jarvis prêt${SR ? "" : " (micro non pris en charge : utilisez le clavier)"}</small></div>
    <button type="button" id="jv-auto" class="jb" title="Mode autonome : Jarvis lance consignes, missions et rapports sans confirmation">⚡</button><button type="button" id="jv-ideas" class="jb" title="Propositions d'amélioration de Jarvis">💡<em id="jv-badge" hidden></em></button><button type="button" id="jv-send" class="jb" title="Envoyer">➤</button><button type="button" id="jv-voice" class="jb on" title="Voix de Jarvis">🔊</button><button type="button" id="jv-hands" class="jb" title="Mains libres : dites « Jarvis » pour m'appeler">🖐</button></div>`;
  stage.appendChild(dock);
  const $ = (s) => dock.querySelector(s), logEl = $("#jv-log"), inEl = $("#jv-in"), st = $("#jv-st"), orb = $("#jv-orb");
  let guard = null, voiceOn = true, hands = false, listening = false, speaking = false, rec = null, pending = null, convo = false, gotResult = false, llmDown = 0, hist = [], awakeUntil = 0, lastSpeechEnd = 0, poll = null;
  const lines = []; const setSt = (t) => { st.textContent = t; }; const setOrb = (c) => { orb.className = "orb " + c; };

  function addLine(who, text) { lines.push({ who, text }); if (lines.length > 40) lines.shift();
    const d = document.createElement("div"); d.className = "ln " + who; d.innerHTML = `<b>${who === "me" ? "Vous" : who === "dg" ? "Directeur général" : "Jarvis"}</b> ${esc(text)}`; logEl.appendChild(d); setTimeout(() => d.remove(), 16000); while (logEl.children.length > 3) logEl.firstChild.remove(); logEl.scrollTop = 1e6; }
  function voiceFr() { const v = window.speechSynthesis.getVoices(); return v.find((x) => /^fr(-|_)/i.test(x.lang) && /thomas|paul|henri|male|homme|google fran/i.test(x.name)) || v.find((x) => /^fr(-|_)/i.test(x.lang)) || null; }
  const clean = (t) => String(t).replace(/[*_`#>]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim();
  function say(text, who = "jarvis") {
    addLine(who, text); if (!voiceOn || !TTS || !text) { setTimeout(afterReply, 200); return; }
    clearTimeout(guard); guard = setTimeout(() => { if (speaking) { speaking = false; lastSpeechEnd = Date.now(); A.view?.speaking(false); setOrb(listening ? "listen" : ""); afterReply(); } }, clean(text).length * 90 + 2500);
    try { window.speechSynthesis.cancel(); const parts = clean(text).match(/[^.!?]+[.!?]?/g) ?? [clean(text)];
      parts.slice(0, 8).forEach((p, i, arr) => { const u = new SpeechSynthesisUtterance(p.trim()); u.lang = "fr-FR"; u.rate = 1; u.pitch = .9; const v = voiceFr(); if (v) u.voice = v;
        if (i === 0) u.onstart = () => { speaking = true; A.view?.speaking(true); setOrb("speak"); setSt("Jarvis parle…"); };
        if (i === arr.length - 1) { u.onend = u.onerror = () => { speaking = false; lastSpeechEnd = Date.now(); A.view?.speaking(false); setOrb(listening ? "listen" : ""); setSt(hands ? "Mains libres : dites « Jarvis »" : "Jarvis prêt"); afterReply(); }; }
        window.speechSynthesis.speak(u); }); } catch { /* voix indisponible : la réponse reste affichée */ }
  }

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
  const HELP = "Je peux : donner la situation, le nombre de fiches, qui travaille, les blocages, l'avancement d'un logiciel (par exemple AutoGarage), ce que fait un agent, piloter la caméra (zoom, vue d'ensemble, montre tel agent, rotation, plein cadre) et transmettre une demande au directeur général après votre confirmation.";

  let autoMode = false;
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
        else if (a.type === "propose_report" && a.agent_id) props.push({ kind: "report", agent_id: a.agent_id, jours: a.jours || 7 });
        else if (a.type === "propose_report_now" && a.rapport) props.push({ kind: "report_now", type: a.rapport });
      }
      if (autoMode && props.length) { pending = null; setOrb(listening ? "listen" : ""); say(reply); for (const it of props) await sendPending(it); return reply; }   // mode autonome : exécution immédiate (actions internes uniquement)
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

  // ───────── Micro ─────────
  function startRec() {
    if (!SR) { setSt("Micro non pris en charge : utilisez le clavier."); return; }
    if (!rec) { rec = new SR(); rec.lang = "fr-FR"; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.onstart = () => { listening = true; setOrb(speaking ? "speak" : "listen"); setSt(hands ? "Mains libres : dites « Jarvis »" : "Je vous écoute…"); };
      rec.onresult = (ev) => { if ((speaking && window.speechSynthesis?.speaking) || Date.now() - lastSpeechEnd < 700) return; let fin = "", itm = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; (r.isFinal ? (fin += r[0].transcript) : (itm += r[0].transcript)); }
        if (itm) setSt("… " + itm); if (!fin.trim()) return; const txt = fin.trim();
        const nt = norm(txt); setSt("Entendu : « " + clip(txt, 60) + " »");
        if (hands && !WAKE.test(nt) && Date.now() > awakeUntil) { setSt("Entendu : « " + clip(txt, 40) + " » — dites d'abord « Jarvis »"); return; }   // mains libres : seul « Jarvis » réveille
        if (hands && WAKE.test(nt) && nt.replace(WAKE, "").replace(/\b(ok|hey|dis|salut)\b/g, "").trim() === "") { awakeUntil = Date.now() + 9000; say("À vos ordres."); return; }
        gotResult = true; convo = !hands; window.speechSynthesis?.cancel(); awakeUntil = Date.now() + 9000; handle(txt); };
      rec.onerror = (e) => { const msg = { "not-allowed": "Autorisez le microphone dans le navigateur.", "no-speech": "Aucune parole détectée.", "audio-capture": "Microphone introuvable." }[e.error]; setSt(msg ?? "Micro : " + e.error); if (e.error === "not-allowed") hands = false; };
      rec.onend = () => { listening = false; setOrb(""); if (convoNext && !gotResult) { convoNext = false; convo = false; } if (hands) { try { rec.start(); } catch { /* déjà actif */ } } else setSt("Jarvis prêt"); }; }
    rec.continuous = hands; try { rec.start(); } catch { /* déjà actif */ }
  }
  orb.addEventListener("click", () => { if (listening && !hands) { rec?.stop(); return; } if (speaking) { window.speechSynthesis?.cancel(); return; } startRec(); });
  const sendTxt = () => { const v = inEl.value.trim(); if (!v) return; inEl.value = ""; handle(v); };
  const setAuto = (on) => { autoMode = !!on; $("#jv-auto").classList.toggle("on", autoMode); $("#jv-auto").classList.toggle("warn", autoMode); };
  $("#jv-auto").addEventListener("click", () => handle(autoMode ? "mode prudent" : "mode autonome"));
  $("#jv-ideas").addEventListener("click", () => handle("Jarvis, quelles améliorations me proposes-tu ?"));
  let announced = false;
  const refreshIdeas = () => { try { const n = insights().length, b = $("#jv-badge"); b.hidden = !n; b.textContent = n; if (n && !announced && D.agents.length) { announced = true; addLine("jarvis", `J'ai ${plural(n, "proposition d'amélioration", "propositions d'amélioration")}. Touchez 💡 ou dites « propositions ».`); } } catch { /* données pas encore chargées */ } };
  setInterval(refreshIdeas, 15000); setTimeout(refreshIdeas, 3500);
  $("#jv-send").addEventListener("click", sendTxt); inEl.addEventListener("keydown", (e) => { if (e.key === "Enter") sendTxt(); e.stopPropagation(); });
  $("#jv-voice").addEventListener("click", (e) => { voiceOn = !voiceOn; e.currentTarget.classList.toggle("on", voiceOn); e.currentTarget.textContent = voiceOn ? "🔊" : "🔇"; if (!voiceOn) window.speechSynthesis?.cancel(); setSt(voiceOn ? "Voix activée" : "Voix désactivée"); });
  $("#jv-hands").addEventListener("click", (e) => { hands = !hands; e.currentTarget.classList.toggle("on", hands); if (hands) { if (!SR) { hands = false; e.currentTarget.classList.remove("on"); setSt("Mains libres indisponible : micro non pris en charge."); return; } if (listening) rec.stop(); setTimeout(startRec, 150); setSt("Mains libres : dites « Jarvis »"); } else { rec?.stop(); setSt("Jarvis prêt"); } });
  addLine("jarvis", "Salle de contrôle en ligne. Dites « Jarvis, situation » ou écrivez votre demande.");
  window.__jarvis = { insights, auto: () => autoMode, setLLM: (on) => { llmDown = on ? 0 : Infinity; }, history: () => hist.slice(), ask: (t) => handle(t), lines: () => lines.slice(), pending: () => pending, say };
}
