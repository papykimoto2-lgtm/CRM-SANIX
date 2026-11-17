// SANIX CRM Pro : WhatsApp Business (API Meta) — logique serveur testée avec un faux Meta et un faux stockage. node wacrm_test.js
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const refuse = async (p, status, re, m) => { try { await p; } catch (e) { if (e.status === status && re.test(e.message)) { console.log("  ✓ " + m); return; } throw new Error("ÉCHEC : " + m + " — obtenu " + e.status + " « " + e.message + " »"); } throw new Error("ÉCHEC : " + m + " — aucune erreur"); };
(async () => {
  const W = await import("../supabase/functions/_shared/wacrm.ts");
  const ENV = { WHATSAPP_TOKEN: "TOKEN-SECRET", WHATSAPP_PHONE_NUMBER_ID: "123456", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s" };
  let T = Date.parse("2026-11-17T10:00:00Z");
  const S = { msgs: [], inb: [], optout: new Set(), agentsOptout: new Set(), inter: [] };
  const store = {
    countSentSince: async (since) => S.msgs.filter((m) => m.status !== "echec" && m.sent_at > since).length,
    recentDuplicate: async (ph, tpl, since) => S.msgs.some((m) => m.to_phone === ph && m.template === tpl && m.status !== "echec" && m.sent_at > since),
    isOptedOut: async (ph) => S.optout.has(ph) || S.agentsOptout.has(ph),
    lastInboundAt: async (ph) => { const l = S.inb.filter((x) => x.from_phone === ph).map((x) => x.received_at).sort().pop(); return l || null; },
    insertMessage: async (m) => { const id = "w" + (S.msgs.length + 1); S.msgs.push({ ...m, id, sent_at: new Date(T).toISOString() }); return id; },
    getByWamid: async (w) => S.msgs.find((m) => m.wa_message_id === w) || null,
    updateById: async (id, p) => { Object.assign(S.msgs.find((m) => m.id === id), p); },
    recentOutbound: async (ph, since) => { const m = S.msgs.filter((x) => x.to_phone === ph && x.status !== "echec" && x.sent_at > since).pop(); return m ? { client_rid: m.client_rid } : null; },
    insertInbound: async (r) => { if (S.inb.some((x) => x.wa_message_id === r.wa_message_id)) return false; S.inb.push(r); return true; },
    setOptOut: async (ph) => { S.optout.add(ph); },
    addInteraction: async (rid, i) => { S.inter.push({ rid, ...i }); },
  };
  const calls = []; const META = { ok: true, status: 200, error: null };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return META.ok ? res(200, { messages: [{ id: "wamid.N" + calls.length }] }) : res(META.status, { error: META.error }); };
  const d = { fetch, now: () => new Date(T), env: (n) => ENV[n] || "", store };
  const op = { user_id: "u1", nom: "Admin Test" };
  const base = { client_rid: "c1", to: "+225 07 00 00 01 07", template: "sanix_premier_contact", lang: "fr", params: ["Clinique Alpha", "MediCore Suite", "Admin Test"], preview: "Bonjour Clinique Alpha…", consent: true };

  console.log("▶ Outils");
  ok(W.normPhone("+225 07 00 00 01 07") === "2250700000107" && W.normPhone("00225 0700000107") === "2250700000107" && W.normPhone("12") === "" && W.normPhone("abc") === "", "numéros normalisés en chiffres seuls (8 à 15), le reste refusé");
  ok(W.paramTexte("Bonjour\n\n  Alpha\t\t  x    y") === "Bonjour Alpha x y", "une variable de modèle n'a ni retour à la ligne, ni tabulation, ni 4 espaces de suite (règle de Meta)");
  ok(W.estStop("STOP") && W.estStop("  Stop !") && W.estStop("Arrêtez svp") === false && W.estStop("Arrêter") && W.estStop("Désinscrire") && W.estStop("«stop»") && !W.estStop("Je ne veux pas arrêter") && !W.estStop("Bonjour, stop-motion"), "« STOP » reconnu (casse, accents, ponctuation) mais pas dans une phrase ordinaire");
  ok(W.etat(d).configure === true && W.etat({ ...d, env: () => "" }).manquants.join() === "WHATSAPP_TOKEN,WHATSAPP_PHONE_NUMBER_ID", "état de la configuration : secrets manquants nommés");

  console.log("▶ Envoi d'un modèle");
  const r1 = await W.sendTemplate(d, op, base);
  ok(r1.wa_message_id === "wamid.N1" && S.msgs.length === 1 && S.msgs[0].status === "envoye", "message envoyé, journalisé (état « envoyé »)");
  const c0 = calls[0];
  ok(c0.url === "https://graph.facebook.com/v27.0/123456/messages" && c0.init.headers.Authorization === "Bearer TOKEN-SECRET", "appel à l'API Meta (version courante, numéro d'envoi, jeton en en-tête)");
  ok(c0.body.to === "2250700000107" && c0.body.type === "template" && c0.body.template.name === "sanix_premier_contact" && c0.body.template.language.code === "fr", "bon destinataire (chiffres seuls), bon modèle, bonne langue");
  ok(JSON.stringify(c0.body.template.components[0].parameters.map((p) => p.text)) === JSON.stringify(["Clinique Alpha", "MediCore Suite", "Admin Test"]), "les 3 variables partent dans l'ordre");
  ok(S.msgs[0].consent_by === "Admin Test" && S.msgs[0].sent_by === "Admin Test", "qui a envoyé et qui a confirmé l'accord du destinataire sont conservés");
  ok(S.inter.length === 1 && S.inter[0].rid === "c1" && S.inter[0].type === "Message WhatsApp", "l'envoi est tracé sur la fiche du prospect");
  ok(!JSON.stringify(S.msgs).includes("TOKEN-SECRET") && !JSON.stringify(S.inter).includes("TOKEN-SECRET"), "le jeton Meta n'est écrit ni dans le journal ni sur les fiches");

  console.log("▶ Garde-fous à l'envoi");
  await refuse(W.sendTemplate(d, op, { ...base, to: "+225 07 11 11 11 11", consent: false }), 400, /accepté d'être contacté/, "sans confirmation d'accord du destinataire : refusé");
  await refuse(W.sendTemplate(d, op, { ...base, to: "12" }), 400, /Numéro WhatsApp invalide/, "numéro invalide : refusé");
  await refuse(W.sendTemplate(d, op, { ...base, to: "+225 07 11 11 11 11", template: "Mon Modèle!" }), 400, /Nom de modèle invalide/, "nom de modèle invalide : refusé");
  await refuse(W.sendTemplate(d, op, { ...base, to: "+225 07 11 11 11 11", params: ["A", "", "C"] }), 400, /variable du modèle est vide/, "variable vide : le message n'est pas prêt, refusé");
  await refuse(W.sendTemplate(d, op, base), 409, /déjà été envoyé/, "même modèle au même numéro dans les 24 h : refusé (pas de doublon)");
  S.optout.add("2250700000222");
  await refuse(W.sendTemplate(d, op, { ...base, to: "0700000222".replace(/^0/, "2250") }), 409, /STOP/, "numéro désinscrit (STOP) : envoi interdit");
  S.agentsOptout.add("2250700000333");
  await refuse(W.sendTemplate(d, op, { ...base, to: "2250700000333" }), 409, /STOP/, "numéro désinscrit côté agents IA : interdit aussi");
  await refuse(W.sendTemplate({ ...d, env: (n) => (n === "WHATSAPP_TOKEN" ? "" : ENV[n] || "") }, op, { ...base, to: "2250700000444" }), 503, /WHATSAPP_TOKEN/, "secret manquant : message clair indiquant lequel");
  ok(calls.length === 1, "aucun de ces refus n'a appelé Meta");

  console.log("▶ Refus de Meta");
  META.ok = false; META.status = 400; META.error = { message: "(#132001) Template does not exist", error_data: { details: "template name (inconnu) does not exist in fr" } };
  await refuse(W.sendTemplate(d, op, { ...base, to: "2250700000555" }), 502, /does not exist in fr/, "modèle inconnu de Meta : l'opérateur lit la vraie raison");
  ok(S.msgs[S.msgs.length - 1].status === "echec" && /does not exist/.test(S.msgs[S.msgs.length - 1].error), "l'échec est journalisé avec sa raison");
  META.status = 401; META.error = { message: "Invalid OAuth access token" };
  await refuse(W.sendTemplate(d, op, { ...base, to: "2250700000556" }), 409, /Invalid OAuth/, "jeton refusé : erreur de configuration (409), pas une panne");
  META.ok = true;

  console.log("▶ Plafond du jour");
  const avant = S.msgs.length; for (let i = 0; i < W.LIMITE_PAR_JOUR; i++) S.msgs.push({ id: "x" + i, to_phone: "22507" + String(i).padStart(8, "0"), template: "t", status: "envoye", sent_at: new Date(T).toISOString() });
  await refuse(W.sendTemplate(d, op, { ...base, to: "2250700000999" }), 429, /Plafond de 150/, "150 messages en 24 h : le 151e est refusé");
  S.msgs.length = avant;

  console.log("▶ Réponse libre (fenêtre de 24 h)");
  await refuse(W.sendText(d, op, { client_rid: "c1", to: "2250700000107", text: "Merci" }), 409, /fenêtre de 24 h est fermée/, "prospect qui n'a pas écrit : texte libre refusé, seul un modèle est permis");
  const traite = await W.routeInbound(d, { id: "wamid.IN1", from: "2250700000107", timestamp: String(Math.floor(T / 1000)), type: "text", text: { body: "Bonjour, je suis intéressé, pouvez-vous m'appeler ?" } }, "Dr Alpha");
  ok(traite === true && S.inb.length === 1 && S.inb[0].client_rid === "c1", "réponse d'un prospect contacté par le CRM : enregistrée sur sa fiche, traitée par un humain (pas par l'agent IA)");
  ok(S.inter.some((i) => i.type === "Réponse reçue par WhatsApp" && /Dr Alpha/.test(i.note) && i.etape === 1), "l'historique de la fiche indique la réponse (avec un extrait)");
  const rt = await W.sendText(d, op, { client_rid: "c1", to: "+225 0700000107", text: "Avec plaisir, je vous appelle cet après-midi." });
  ok(rt.wa_message_id && calls[calls.length - 1].body.type === "text" && calls[calls.length - 1].body.text.body.startsWith("Avec plaisir"), "fenêtre ouverte : la réponse libre part");
  T += 25 * 3600e3;
  await refuse(W.sendText(d, op, { client_rid: "c1", to: "2250700000107", text: "Et demain ?" }), 409, /fenêtre de 24 h est fermée/, "25 h plus tard : la fenêtre est refermée");
  T -= 25 * 3600e3;

  console.log("▶ Accusés de Meta (remis / lu / échec)");
  const m1 = S.msgs[0];
  ok((await W.recordStatus(d, { id: m1.wa_message_id, status: "sent", timestamp: "1" })) === true && m1.status === "envoye", "« sent » : rien à changer");
  await W.recordStatus(d, { id: m1.wa_message_id, status: "delivered", timestamp: String(Math.floor(T / 1000)) });
  ok(m1.status === "remis" && m1.delivered_at, "« delivered » → remis");
  await W.recordStatus(d, { id: m1.wa_message_id, status: "read", timestamp: String(Math.floor(T / 1000)) });
  ok(m1.status === "lu" && m1.read_at, "« read » → lu");
  await W.recordStatus(d, { id: m1.wa_message_id, status: "delivered", timestamp: "5" });
  ok(m1.status === "lu", "un accusé « delivered » tardif ne fait pas reculer l'état (lu reste lu)");
  const m2 = S.msgs.find((m) => m.wa_message_id && m !== m1 && m.status === "envoye");
  await W.recordStatus(d, { id: m2.wa_message_id, status: "read", timestamp: String(Math.floor(T / 1000)) });
  ok(m2.status === "lu" && m2.delivered_at, "« lu » reçu avant « remis » : l'état est lu et la remise est renseignée");
  S.msgs.push({ id: "wf", wa_message_id: "wamid.FAIL", to_phone: "2250700000888", status: "envoye", template: "t", client_rid: null, sent_at: new Date(T).toISOString() });
  await W.recordStatus(d, { id: "wamid.FAIL", status: "failed", timestamp: "1", errors: [{ code: 131026, title: "Message undeliverable", message: "Message Undeliverable", error_data: { details: "Le destinataire n'est pas sur WhatsApp" } }] });
  const wf = S.msgs.find((m) => m.id === "wf"); ok(wf.status === "echec" && /pas sur WhatsApp/.test(wf.error), "« failed » → échec, avec la raison de Meta (ex. pas sur WhatsApp)");
  ok((await W.recordStatus(d, { id: "wamid.INCONNU", status: "read" })) === false, "accusé d'un message qui n'est pas du CRM (agents IA) : ignoré ici, laissé au circuit des agents");

  console.log("▶ Réponses reçues et désinscription");
  const nb = S.inb.length;
  ok((await W.routeInbound(d, { id: "wamid.IN1", from: "2250700000107", timestamp: "1", type: "text", text: { body: "Bonjour…" } })) === true && S.inb.length === nb, "même message reçu deux fois (Meta réessaie) : enregistré une seule fois");
  ok((await W.routeInbound(d, { id: "wamid.INX", from: "2250709999999", timestamp: "1", type: "text", text: { body: "Salut" } })) === false, "numéro auquel le CRM n'a jamais écrit : laissé au circuit des agents IA");
  ok((await W.routeInbound(d, { id: "wamid.INY", from: "BSUID.ABC123", timestamp: "1", type: "text", text: { body: "Salut" } })) === false, "expéditeur sans numéro (identifiant WhatsApp) : laissé aux agents, pas d'erreur");
  const old = S.msgs[0].sent_at; S.msgs[0].sent_at = new Date(T - 8 * 86400e3).toISOString();
  S.msgs.filter((m) => m.to_phone === "2250700000107").forEach((m) => { m.sent_at = S.msgs[0].sent_at; });
  ok((await W.routeInbound(d, { id: "wamid.IN8", from: "2250700000107", timestamp: "1", type: "text", text: { body: "Re-bonjour" } })) === false, "plus de 7 jours après notre message : c'est de nouveau le circuit des agents");
  S.msgs.filter((m) => m.to_phone === "2250700000107").forEach((m) => { m.sent_at = old; });
  ok((await W.routeInbound(d, { id: "wamid.IN2", from: "2250700000107", timestamp: String(Math.floor(T / 1000)), type: "text", text: { body: "STOP" } })) === true && S.optout.has("2250700000107"), "« STOP » : le numéro est désinscrit");
  ok(S.inter.some((i) => i.type === "Désinscription WhatsApp"), "la fiche indique la désinscription : ne plus lui écrire");
  await refuse(W.sendTemplate(d, op, { ...base, template: "autre_modele" }), 409, /STOP/, "après STOP : plus aucun envoi à ce numéro");
  const bouton = await W.routeInbound(d, { id: "wamid.IN3", from: "2250700000107", timestamp: "1", type: "button", button: { text: "Oui, rappelez-moi" } });
  ok(bouton === true && S.inb[S.inb.length - 1].body === "Oui, rappelez-moi", "un clic sur un bouton de réponse est lu comme du texte");
  const img = await W.routeInbound(d, { id: "wamid.IN4", from: "2250700000107", timestamp: "1", type: "image" });
  ok(img === true && S.inb[S.inb.length - 1].body === "[image reçu]", "un message non textuel est signalé sans être lu");
  console.log("\nWhatsApp CRM : tous les contrôles passent.");
})().catch((e) => { console.error(e.message); process.exit(1); });
