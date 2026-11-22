// SANIX AI · Salle de contrôle — assistant vocal « Jarvis » (Web Speech API du navigateur : aucune clé, aucun service tiers).
// Les réponses sont calculées localement à partir des données réelles de la salle (état, missions, fiches, santé) : instantanées et sans coût.
// Une demande hors périmètre n'est transmise au directeur général IA (instruction du Bureau) qu'APRÈS confirmation à voix haute ou au clavier ;
// sa réponse est ensuite lue dès qu'elle arrive. Commandes de caméra : « zoom avant », « vue d'ensemble », « montre le directeur commercial »…
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const PRODUCTS = { autogarage: [/auto ?garage|garage/, "AutoGarage Pro"], angels: [/angel|livraison/, "Angel's Livraison"], immosuite: [/immo/, "ImmoSuite"], avicosuite: [/avico|avicole|avinest|agro/, "AvicoSuite"], aluexpert: [/alu/, "AluExpert"] };

export function initJarvis(A, stage) {
  const D = A.D, SR = window.SpeechRecognition || window.webkitSpeechRecognition, TTS = "speechSynthesis" in window;
  const dock = document.createElement("div"); dock.id = "jarvis";
  dock.innerHTML = `<div id="jv-log" aria-live="polite"></div>
    <div class="jv-bar"><button type="button" id="jv-orb" class="orb" aria-label="Parler à Jarvis" title="Parler à Jarvis"><i></i></button>
    <div class="jv-mid"><input id="jv-in" type="text" autocomplete="off" placeholder="Dites ou écrivez : « Jarvis, où en est AutoGarage ? »" aria-label="Message à Jarvis"><small id="jv-st">Jarvis prêt${SR ? "" : " (micro non pris en charge : utilisez le clavier)"}</small></div>
    <button type="button" id="jv-send" class="jb" title="Envoyer">➤</button><button type="button" id="jv-voice" class="jb on" title="Voix de Jarvis">🔊</button><button type="button" id="jv-hands" class="jb" title="Mains libres : dites « Jarvis » pour m'appeler">🖐</button></div>`;
  stage.appendChild(dock);
  const $ = (s) => dock.querySelector(s), logEl = $("#jv-log"), inEl = $("#jv-in"), st = $("#jv-st"), orb = $("#jv-orb");
  let voiceOn = true, hands = false, listening = false, speaking = false, rec = null, pending = null, awakeUntil = 0, lastSpeechEnd = 0, poll = null;
  const lines = []; const setSt = (t) => { st.textContent = t; }; const setOrb = (c) => { orb.className = "orb " + c; };

  function addLine(who, text) { lines.push({ who, text }); if (lines.length > 40) lines.shift();
    const d = document.createElement("div"); d.className = "ln " + who; d.innerHTML = `<b>${who === "me" ? "Vous" : who === "dg" ? "Directeur général" : "Jarvis"}</b> ${esc(text)}`; logEl.appendChild(d); setTimeout(() => d.remove(), 16000); while (logEl.children.length > 3) logEl.firstChild.remove(); logEl.scrollTop = 1e6; }
  function voiceFr() { const v = window.speechSynthesis.getVoices(); return v.find((x) => /^fr(-|_)/i.test(x.lang) && /thomas|paul|henri|male|homme|google fran/i.test(x.name)) || v.find((x) => /^fr(-|_)/i.test(x.lang)) || null; }
  const clean = (t) => String(t).replace(/[*_`#>]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim();
  function say(text, who = "jarvis") {
    addLine(who, text); if (!voiceOn || !TTS || !text) return;
    try { window.speechSynthesis.cancel(); const parts = clean(text).match(/[^.!?]+[.!?]?/g) ?? [clean(text)];
      parts.slice(0, 8).forEach((p, i, arr) => { const u = new SpeechSynthesisUtterance(p.trim()); u.lang = "fr-FR"; u.rate = 1; u.pitch = .9; const v = voiceFr(); if (v) u.voice = v;
        if (i === 0) u.onstart = () => { speaking = true; A.view?.speaking(true); setOrb("speak"); setSt("Jarvis parle…"); };
        if (i === arr.length - 1) { u.onend = u.onerror = () => { speaking = false; lastSpeechEnd = Date.now(); A.view?.speaking(false); setOrb(listening ? "listen" : ""); setSt(hands ? "Mains libres : dites « Jarvis »" : "Jarvis prêt"); }; }
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

  async function sendInstruction(text) {
    const sentAt = Date.now() - 2000;
    try { const { error } = await A.sb.functions.invoke("ai-company", { body: { action: "instruction", contenu: text } }); if (error) throw new Error(error.message);
      say("Instruction transmise au directeur général. Je vous lis sa réponse dès qu'elle arrive."); watchDg(sentAt); return "transmis"; }
    catch (e) { say("Je n'ai pas pu transmettre l'instruction : " + clip(e.message, 120)); return "erreur"; }
  }
  function watchDg(since) { clearInterval(poll); let n = 0, seen = new Set();
    poll = setInterval(async () => { n++; if (n > 60) { clearInterval(poll); return; }
      try { const r = await A.sb.from("ai_executive_messages").select("id,auteur,contenu,created_at").eq("auteur", "directeur").order("created_at", { ascending: false }).limit(4); const rows = (r.data ?? []).filter((m) => Date.parse(m.created_at) >= since && !seen.has(m.id)).reverse();
        for (const m of rows) { seen.add(m.id); say(clip(clean(m.contenu), 900), "dg"); } } catch { /* nouvel essai au prochain cycle */ } }, 4000); }

  async function handle(raw) {
    let t = norm(raw).replace(/^(ok |hey |dis |salut |bonjour )?(jarvis|sanix|assistant)( |$)/, "").trim(); if (!t) { say("À vos ordres."); return "À vos ordres."; }
    addLine("me", raw); const reply = (s) => { say(s); return s; };
    if (pending) { if (/^(oui|ok|confirme|vas y|transmets|envoie|d accord|affirmatif)\b/.test(t)) { const p = pending; pending = null; await sendInstruction(p); return "transmis"; }
      if (/^(non|annule|laisse tomber|stop|negatif)\b/.test(t)) { pending = null; return reply("D'accord, j'annule."); } pending = null; }
    if (/zoom(e)? (avant|plus)|rapproche|agrandi|plus pres/.test(t)) { if (!view()) return reply("La vue 3D n'est pas disponible sur cet appareil."); view().zoom(.7); return reply("Zoom avant."); }
    if (/zoom(e)? (arriere|moins)|recule|eloigne|plus loin|reduis la vue/.test(t)) { if (!view()) return reply("La vue 3D n'est pas disponible."); view().zoom(1.45); return reply("Zoom arrière."); }
    if (/vue d ensemble|reinitialis|recentre|remets la vue|vue globale/.test(t)) { view()?.reset(); return reply("Vue d'ensemble."); }
    if (/(arrete|stoppe|coupe|pause).*(rotation|tourner)|ne tourne plus/.test(t)) { view()?.setAuto(false); return reply("Rotation arrêtée."); }
    if (/(lance|active|demarre|reprends).*(rotation|tourner)|fais tourner/.test(t)) { view()?.setAuto(true); return reply("Rotation activée."); }
    if (/(reduis|masque|cache|ferme).*(panneau|colonne)|plein cadre|mode immersion|plein ecran/.test(t)) { if (/plein ecran/.test(t)) A.fullscreen(); else A.setFocus(true); return reply("Mode immersion activé."); }
    if (/(affiche|montre|reouvre|reviens).*(panneau|colonne|tableau)|quitte.*(immersion|plein cadre)/.test(t)) { A.setFocus(false); return reply("Panneaux affichés."); }
    let m;
    if ((m = /^(?:montre|focus|zoom sur|va sur|affiche|approche toi de|selectionne)(?: moi)?(?: l agent| le| la| les)? (.+)/.exec(t))) { const a = findAgent(m[1]); if (a && view()?.focus(a.id)) return reply(`Voici ${a.nom}. ${agentReply(a)}`); if (!a) return reply("Je ne trouve pas cet agent."); }
    if (/quelle heure|il est quelle heure/.test(t)) return reply("Il est " + new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(":", " heures ") + " à Abidjan.");
    if (/^(aide|que sais tu|tu sais faire quoi|commandes|que peux tu)/.test(t)) return reply(HELP);
    for (const [id, [rx, label]] of Object.entries(PRODUCTS)) if (rx.test(t) && /(ou en est|avancement|point sur|situation|bilan|combien|progress|fiches|mission)/.test(t)) return reply(productReply(id, label));
    if (/(que fait|sur quoi travaille|ou en est) (.+)/.test(t)) { const a = findAgent(t.replace(/^.*(que fait|sur quoi travaille|ou en est)/, "")); if (a) return reply(agentReply(a)); }
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
    pending = raw.trim(); return reply(`Je n'ai pas de réponse directe à cela. Voulez-vous que je le transmette au directeur général : « ${clip(raw.trim(), 140)} » ? Dites oui pour confirmer, non pour annuler.`);
  }

  // ───────── Micro ─────────
  function startRec() {
    if (!SR) { setSt("Micro non pris en charge : utilisez le clavier."); return; }
    if (!rec) { rec = new SR(); rec.lang = "fr-FR"; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.onstart = () => { listening = true; setOrb(speaking ? "speak" : "listen"); setSt(hands ? "Mains libres : dites « Jarvis »" : "Je vous écoute…"); };
      rec.onresult = (ev) => { if (speaking || Date.now() - lastSpeechEnd < 700) return; let fin = "", itm = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; (r.isFinal ? (fin += r[0].transcript) : (itm += r[0].transcript)); }
        if (itm) setSt("… " + itm); if (!fin.trim()) return; const txt = fin.trim();
        if (hands && !/jarvis|sanix/.test(norm(txt)) && Date.now() > awakeUntil) return;   // mains libres : seul « Jarvis » réveille
        if (hands && /^(ok |hey |dis )?(jarvis|sanix)$/.test(norm(txt))) { awakeUntil = Date.now() + 9000; say("À vos ordres."); return; }
        window.speechSynthesis?.cancel(); awakeUntil = Date.now() + 9000; handle(txt); };
      rec.onerror = (e) => { const msg = { "not-allowed": "Autorisez le microphone dans le navigateur.", "no-speech": "Aucune parole détectée.", "audio-capture": "Microphone introuvable." }[e.error]; if (msg) setSt(msg); if (e.error === "not-allowed") hands = false; };
      rec.onend = () => { listening = false; setOrb(""); if (hands) { try { rec.start(); } catch { /* déjà actif */ } } else setSt("Jarvis prêt"); }; }
    rec.continuous = hands; try { rec.start(); } catch { /* déjà actif */ }
  }
  orb.addEventListener("click", () => { if (listening && !hands) { rec?.stop(); return; } if (speaking) { window.speechSynthesis?.cancel(); return; } startRec(); });
  const sendTxt = () => { const v = inEl.value.trim(); if (!v) return; inEl.value = ""; handle(v); };
  $("#jv-send").addEventListener("click", sendTxt); inEl.addEventListener("keydown", (e) => { if (e.key === "Enter") sendTxt(); e.stopPropagation(); });
  $("#jv-voice").addEventListener("click", (e) => { voiceOn = !voiceOn; e.currentTarget.classList.toggle("on", voiceOn); e.currentTarget.textContent = voiceOn ? "🔊" : "🔇"; if (!voiceOn) window.speechSynthesis?.cancel(); setSt(voiceOn ? "Voix activée" : "Voix désactivée"); });
  $("#jv-hands").addEventListener("click", (e) => { hands = !hands; e.currentTarget.classList.toggle("on", hands); if (hands) { if (!SR) { hands = false; e.currentTarget.classList.remove("on"); setSt("Mains libres indisponible : micro non pris en charge."); return; } if (listening) rec.stop(); setTimeout(startRec, 150); setSt("Mains libres : dites « Jarvis »"); } else { rec?.stop(); setSt("Jarvis prêt"); } });
  addLine("jarvis", "Salle de contrôle en ligne. Dites « Jarvis, situation » ou écrivez votre demande.");
  window.__jarvis = { ask: (t) => handle(t), lines: () => lines.slice(), pending: () => pending, say };
}
