// SANIX CRM Pro : envoi Gmail et suivi des réponses — logique serveur testée avec un faux Google et un faux stockage. node gmail_test.js
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const KEY = Buffer.alloc(32, 7).toString("base64");
(async () => {
  const G = await import("../supabase/functions/_shared/gmail.ts");
  const ENV = { SUPABASE_URL: "https://proj.supabase.co", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", GMAIL_TOKEN_KEY: KEY, APP_URL: "https://crm.exemple.app" };
  let T = Date.parse("2026-11-17T10:00:00Z");
  // — faux stockage —
  const S = { account: null, mails: [], inter: [], replies: [], err: undefined };
  const store = {
    getAccount: async () => S.account, saveAccount: async (a) => { S.account = { ...a, status: "connecte" }; }, markAccountError: async (m) => { if (S.account) S.account.status = m ? "erreur" : "connecte"; S.err = m; },
    deleteAccount: async () => { S.account = null; }, insertMail: async (m) => { const id = "m" + (S.mails.length + 1); S.mails.push({ ...m, id, sent_at: new Date(T).toISOString() }); return id; },
    pendingMails: async (since) => S.mails.filter((m) => m.status === "envoye" && m.sent_at > since), updateMail: async (id, p) => { Object.assign(S.mails.find((m) => m.id === id), p); },
    countSentSince: async () => S.mails.length, recentDuplicate: async (to, subj, since) => S.mails.some((m) => m.to_email === to && m.subject === subj && m.sent_at > since),
    recentBounce: async (to) => S.mails.some((m) => m.to_email === to && m.status === "echec" && /distribu/i.test(m.error || "")),
    addInteraction: async (rid, i) => { S.inter.push({ rid, ...i }); },
    saveReplies: async (mailId, rs) => { for (const r of rs) if (!S.replies.some((x) => x.gmail_message_id === r.gmail_message_id)) S.replies.push({ mail_id: mailId, ...r }); },
    repliedWithoutText: async (since, avant) => S.mails.filter((m) => m.status === "repondu" && m.gmail_thread_id && !S.replies.some((r) => r.mail_id === m.id) && (!m.last_checked_at || m.last_checked_at < avant))
  };
  // — faux Google —
  const calls = []; const GOOGLE = { refreshOk: true, sendOk: true, threads: {}, scope: G.GMAIL_SCOPES, refresh: "REFRESH-TOKEN-SECRET" };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      const f = new URLSearchParams(init.body);
      if (f.get("grant_type") === "authorization_code") return f.get("code") === "BON" ? res(200, { access_token: "AT", refresh_token: GOOGLE.refresh, scope: GOOGLE.scope }) : res(400, { error: "invalid_grant" });
      return GOOGLE.refreshOk && f.get("refresh_token") === GOOGLE.refresh ? res(200, { access_token: "AT2", expires_in: 3600 }) : res(400, { error: "invalid_grant" });
    }
    if (url.endsWith("/users/me/profile")) return res(200, { emailAddress: "Sanix@Gmail.com" });
    if (url.endsWith("/messages/send")) return GOOGLE.sendOk ? res(200, { id: "gm1", threadId: "th1" }) : res(403, { error: { message: "Daily limit exceeded" } });
    if (url.includes("/threads/")) { const id = decodeURIComponent(url.split("/threads/")[1].split("?")[0]); return GOOGLE.threads[id] ? res(200, GOOGLE.threads[id]) : res(404, {}); }
    if (url === "https://oauth2.googleapis.com/revoke") return res(200, {});
    return res(500, {});
  };
  const D = { fetch, now: () => new Date(T), env: (n) => ENV[n], store };
  const op = { user_id: "u1", nom: "Awa Koné" };

  console.log("▶ Chiffrement du jeton et signature");
  const enc = await G.encryptToken("jeton-secret", KEY);
  ok(enc.startsWith("v1.") && !enc.includes("jeton-secret"), "le jeton est chiffré (rien de lisible dans la valeur stockée)");
  ok((await G.decryptToken(enc, KEY)) === "jeton-secret", "il se déchiffre avec la bonne clé");
  let bad = null; try { await G.decryptToken(enc, Buffer.alloc(32, 9).toString("base64")); } catch (e) { bad = e; }
  ok(bad && /reconnectez/.test(bad.message), "avec une autre clé : refus clair, jamais de valeur fausse");
  const st = await G.signState({ uid: "u1", exp: T + 1000 }, KEY);
  ok((await G.verifyState(st, KEY, T)).uid === "u1", "state signé : accepté");
  let e1 = null; try { await G.verifyState(st.slice(0, -2) + "xx", KEY, T); } catch (e) { e1 = e; } ok(!!e1, "state falsifié : refusé");
  e1 = null; try { await G.verifyState(st, KEY, T + 5000); } catch (e) { e1 = e; } ok(e1 && /expiré/.test(e1.message), "state expiré : refusé");

  console.log("▶ Message");
  const mime = G.buildMime({ from: "sanix@gmail.com", fromName: "Awa Koné — SANIX", to: "client@exemple.ci", subject: "Démonstration d'ImmoSuite ERP pour Société Générale d'Équipement — très longue ligne d'objet avec accents é è à", text: "Bonjour,\nÀ bientôt é\n" });
  ok(/^From: "=\?UTF-8\?B\?/.test(mime) && /<sanix@gmail\.com>/.test(mime), "nom de l'expéditeur accentué : encodé");
  const subj = mime.split("\r\n\r\n")[0].match(/Subject: ([\s\S]*?)\r\nMIME/)[1];
  ok(subj.split("\r\n ").every((w) => w.length <= 75 && /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(w)), "objet long et accentué : mots encodés de 75 caractères au plus");
  const decoded = subj.split("\r\n ").map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8")).join("");
  ok(decoded.startsWith("Démonstration d'ImmoSuite") && decoded.endsWith("é è à"), "l'objet se relit exactement");
  const corps = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  ok(corps === "Bonjour,\r\nÀ bientôt é\r\n", "corps UTF-8 en base64, fins de ligne CRLF");
  let inj = null; try { G.buildMime({ from: "a@b.ci", to: "x@y.ci", subject: "Salut\r\nBcc: tiers@evil.com", text: "x" }); } catch (e) { inj = e; }
  ok(inj && /interdit/.test(inj.message), "injection d'en-tête (saut de ligne dans l'objet) : refusée");

  console.log("▶ Connexion Google");
  const url = new URL(await G.connectUrl(D, "u1"));
  ok(url.hostname === "accounts.google.com" && url.searchParams.get("access_type") === "offline" && url.searchParams.get("prompt") === "consent", "adresse Google : accès durable demandé");
  ok(url.searchParams.get("scope") === G.GMAIL_SCOPES && /gmail\.send/.test(G.GMAIL_SCOPES) && /gmail\.readonly/.test(G.GMAIL_SCOPES) && !/modify|compose|mail\.google\.com|metadata/.test(url.searchParams.get("scope")), "droits demandés : envoi + lecture seule (jamais modifier, composer ni accès complet ; pas de droit « en-têtes » qui bloquerait la lecture du texte)");
  ok(url.searchParams.get("redirect_uri") === "https://proj.supabase.co/functions/v1/crm-gmail", "retour vers la fonction du projet");
  const stOk = url.searchParams.get("state");
  let back = await G.handleCallback(D, new URLSearchParams({ code: "MAUVAIS", state: stOk }));
  ok(/gmail=erreur/.test(back) && S.account === null, "code refusé par Google : erreur affichée, rien d'enregistré");
  back = await G.handleCallback(D, new URLSearchParams({ code: "BON", state: "falsifie.xxx" }));
  ok(/gmail=erreur/.test(back) && S.account === null, "state falsifié : refus, rien d'enregistré");
  GOOGLE.scope = "https://www.googleapis.com/auth/gmail.send";
  back = await G.handleCallback(D, new URLSearchParams({ code: "BON", state: stOk }));
  ok(/gmail=erreur/.test(back) && /deux/.test(decodeURIComponent(back)) && S.account === null, "une autorisation décochée sur Google : refus explicite");
  GOOGLE.scope = G.GMAIL_SCOPES;
  back = await G.handleCallback(D, new URLSearchParams({ code: "BON", state: stOk }));
  ok(back === "https://crm.exemple.app/?gmail=ok" && S.account.email === "sanix@gmail.com", "connexion réussie : adresse Gmail lue (en minuscules) et retour vers le CRM");
  ok(!S.account.token_enc.includes("REFRESH-TOKEN-SECRET") && (await G.decryptToken(S.account.token_enc, KEY)) === "REFRESH-TOKEN-SECRET", "jeton durable enregistré chiffré");
  back = await G.handleCallback(D, new URLSearchParams({ error: "access_denied" }));
  ok(/refus/i.test(decodeURIComponent(back)), "l'utilisateur refuse sur Google : message clair");

  console.log("▶ Envoi");
  calls.length = 0;
  const r1 = await G.sendMail(D, op, { client_rid: "c_1", to: "contact@promo.ci", subject: "Suite à notre appel", body: "Bonjour\nCordialement,\nAwa", from_name: "Awa Koné — SANIX Africa", relance_jours: 3 });
  const send = calls.find((c) => c.url.endsWith("/messages/send"));
  ok(r1.id === "m1" && r1.thread_id === "th1" && send.init.headers.Authorization === "Bearer AT2", "message envoyé avec un jeton d'accès renouvelé");
  const raw = Buffer.from(JSON.parse(send.init.body).raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  ok(/^From: .*<sanix@gmail\.com>/.test(raw) && /\r\nTo: contact@promo\.ci\r\n/.test(raw), "expéditeur = Gmail connecté, destinataire = prospect");
  ok(S.mails[0].status === "envoye" && S.mails[0].relance_apres_jours === 3 && S.mails[0].sent_by === "Awa Koné", "journal : statut « envoyé », relance dans 3 jours, auteur");
  ok(S.inter.some((i) => i.rid === "c_1" && i.type === "E-mail envoyé"), "l'envoi est inscrit dans l'historique de la fiche");
  for (const [m, i] of [["adresse invalide", { to: "pas-une-adresse", subject: "a", body: "b" }], ["objet vide", { to: "a@b.ci", subject: " ", body: "b" }], ["message vide", { to: "a@b.ci", subject: "a", body: "  " }]]) {
    let e = null; try { await G.sendMail(D, op, i); } catch (x) { e = x; } ok(e && e.status === 400, m + " : refusé (400)");
  }
  let dup = null; try { await G.sendMail(D, op, { client_rid: "c_1", to: "contact@promo.ci", subject: "Suite à notre appel", body: "Bonjour" }); } catch (e) { dup = e; }
  ok(dup && dup.status === 409, "double clic : le même e-mail n'est pas envoyé deux fois");
  GOOGLE.sendOk = false; let gf = null; try { await G.sendMail(D, op, { to: "x@y.ci", subject: "Autre", body: "b" }); } catch (e) { gf = e; }
  ok(gf && /refusé l'envoi/.test(gf.message) && S.mails.at(-1).status === "echec" && /Daily limit/.test(S.mails.at(-1).error), "refus de Gmail : erreur claire, échec noté dans le journal");
  GOOGLE.sendOk = true;
  const gros = { ...store, countSentSince: async () => G.LIMITE_PAR_JOUR }; let lim = null;
  try { await G.sendMail({ ...D, store: gros }, op, { to: "x@y.ci", subject: "Z", body: "b" }); } catch (e) { lim = e; } ok(lim && lim.status === 429, "plafond de " + G.LIMITE_PAR_JOUR + " envois par jour : refusé");

  console.log("▶ Suivi des réponses");
  const msg = (from, t) => ({ internalDate: String(t), payload: { headers: [{ name: "From", value: from }] } });
  S.mails.length = 0; S.inter.length = 0;
  for (const [i, th] of [["A", "thA"], ["B", "thB"], ["C", "thC"], ["D", "thD"]]) await store.insertMail({ client_rid: "c_" + i, to_email: i + "@x.ci", subject: "S" + i, body: "b", sent_by: "x", sent_by_user: null, gmail_message_id: "g" + i, gmail_thread_id: th, status: "envoye", error: null, replied_at: null, reply_from: null, relance_apres_jours: 4, last_checked_at: null });
  GOOGLE.threads = {
    thA: { messages: [msg("Sanix <sanix@gmail.com>", T - 9e6), msg("Marc Dupont <marc@promo.ci>", T - 5e6)] },
    thB: { messages: [msg("sanix@gmail.com", T - 9e6)] },
    thC: { messages: [msg("sanix@gmail.com", T - 9e6), msg("Mail Delivery Subsystem <mailer-daemon@googlemail.com>", T - 8e6)] }
  };
  const sy = await G.syncReplies(D);
  ok(sy.verifies === 3 && sy.reponses === 1 && sy.echecs === 1, "3 fils vérifiés : 1 réponse, 1 retour d'erreur, 1 sans réponse (le 4e fil, introuvable, est ignoré)");
  ok(S.mails[0].status === "repondu" && S.mails[0].reply_from === "marc@promo.ci" && S.mails[0].replied_at, "réponse : statut « répondu », expéditeur et date notés");
  ok(S.mails[1].status === "envoye" && S.mails[1].last_checked_at, "sans réponse : reste « envoyé », vérifié");
  ok(S.mails[2].status === "echec" && /Non distribué/.test(S.mails[2].error), "retour de Gmail (adresse inexistante) : « échec » avec explication");
  ok(S.inter.some((i) => i.type === "Réponse reçue par e-mail" && i.rid === "c_A" && i.etape === 1) && S.inter.some((i) => i.type === "E-mail non distribué" && i.rid === "c_C"), "fiches mises à jour : réponse reçue, e-mail non distribué");
  ok(!S.inter.some((i) => i.rid === "c_B"), "aucune écriture pour la fiche sans réponse");
  ok(calls.filter((c) => c.url.includes("/threads/") && /format=full/.test(c.url)).length === 1 && calls.filter((c) => c.url.includes("/threads/")).every((c) => /format=metadata/.test(c.url) || /thA\?format=full$/.test(c.url)), "le texte n'est demandé (format=full) que pour le fil qui a reçu une réponse ; tous les autres fils : en-têtes seulement");
  const sy2 = await G.syncReplies(D);
  ok(sy2.reponses === 0, "relancé : une réponse déjà notée n'est pas comptée deux fois");
  console.log("▶ Retour d'erreur d'un AUTRE message du même fil (cas ABRI 2000)");
  const rb = (rcpt, t) => ({ internalDate: String(t), payload: { headers: [{ name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" }].concat(rcpt ? [{ name: "X-Failed-Recipients", value: rcpt }] : []) } });
  const A = (msgs, dest) => G.analyseThread({ messages: msgs }, "sanix@gmail.com", dest);
  ok(A([msg("sanix@gmail.com", 1), rb("abri@avisio.cl", 2)], "abri@avisio.ci").bounced === false, "retour d'erreur pour avisio.cl dans le fil d'un message envoyé à avisio.ci : IGNORÉ (ce n'est pas le même destinataire)");
  ok(A([msg("sanix@gmail.com", 1), rb("ABRI@avisio.ci", 2)], "abri@avisio.ci").bounced === true, "retour d'erreur visant bien ce destinataire (casse différente) : retenu");
  ok(A([msg("sanix@gmail.com", 1), msg("sanix@gmail.com", 2), rb("abri@avisio.cl", 3), rb("abri@avisio.ci", 4)], "abri@avisio.ci").bounced === true, "deux retours dans le fil : on retient celui qui concerne ce destinataire");
  ok(A([msg("sanix@gmail.com", 1), rb("a@x.ci, abri@avisio.ci", 2)], "abri@avisio.ci").bounced === true, "plusieurs adresses en échec dans l'en-tête : retenu si la nôtre y figure");
  ok(A([msg("sanix@gmail.com", 1), rb("", 2)], "abri@avisio.ci").bounced === true, "retour sans en-tête dans un fil de 2 messages (le nôtre et le retour) : retenu");
  ok(A([msg("sanix@gmail.com", 1), msg("sanix@gmail.com", 2), rb("", 3)], "abri@avisio.ci").bounced === false, "retour sans en-tête dans un fil plus fourni : ambigu, ignoré (on ne bloque pas une adresse peut-être valide)");
  ok(A([msg("sanix@gmail.com", 1), rb("abri@avisio.cl", 2), msg("Marc <marc@promo.ci>", 3)], "abri@avisio.ci").replied === true, "une vraie réponse arrivée après un retour d'erreur étranger est bien détectée");
  S.mails.push(...[["thE", "e@avisio.ci"], ["thF", "f@avisio.ci"]].map(([th, to], i) => ({ id: "mE" + i, client_rid: null, to_email: to, subject: "Suite à notre échange", body: "b", sent_by: "x", sent_by_user: null, gmail_message_id: "g" + th, gmail_thread_id: th, status: "envoye", error: null, replied_at: null, reply_from: null, relance_apres_jours: 4, last_checked_at: null, sent_at: new Date(T).toISOString() })));
  GOOGLE.threads.thE = { messages: [msg("sanix@gmail.com", T - 5e6), rb("ancienne@avisio.cl", T - 4e6)] };
  GOOGLE.threads.thF = { messages: [msg("sanix@gmail.com", T - 5e6), rb("f@avisio.ci", T - 4e6)] };
  const sy3 = await G.syncReplies(D);
  ok(S.mails.find((m) => m.id === "mE0").status === "envoye" && S.mails.find((m) => m.id === "mF1" || m.id === "mE1").status === "echec", "synchronisation : l'e-mail dont le fil contient le retour d'une AUTRE adresse reste « envoyé » ; celui dont le retour le concerne passe « échec »");
  ok(!calls.filter((c) => c.url.includes("/threads/") && !/format=full/.test(c.url)).some((c) => !/metadataHeaders=X-Failed-Recipients/.test(c.url)), "Gmail est interrogé pour l'en-tête du destinataire en échec (en-têtes seulement hors fils répondus)");
  const own = G.analyseThread({ messages: [msg("sanix@gmail.com", 1), msg("SANIX@gmail.com", 2)] }, "sanix@gmail.com");
  ok(!own.replied, "un message de vous-même dans le fil n'est pas pris pour une réponse");

  console.log("▶ Texte des réponses");
  const avantMails = S.mails.map((m) => ({ ...m })), avantInter = [...S.inter], avantScopes = S.account.scopes;
  const b64 = (t) => Buffer.from(t, "utf8").toString("base64url");
  const msgT = (id, from, t, plain, html) => ({ id, internalDate: String(t), payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: from }], parts: [].concat(plain === undefined ? [] : [{ mimeType: "text/plain", body: { data: b64(plain) } }], html === undefined ? [] : [{ mimeType: "text/html", body: { data: b64(html) } }]) } });
  const cit = "Bonjour,\nOui, une démo mardi me convient.\nCordialement,\nMarc\n\nLe mar. 17 nov. 2026 à 11:08, Sanix <sanix@gmail.com> a écrit :\n> Bonjour Marc,\n> Je vous propose une démonstration.";
  ok(G.retirerCitations(cit) === "Bonjour,\nOui, une démo mardi me convient.\nCordialement,\nMarc", "citation « Le … a écrit : » et lignes citées retirées : seule la réponse du prospect est gardée");
  ok(G.retirerCitations("Merci !\n\nOn Tue, Nov 17, 2026 at 11:08 AM Sanix <sanix@gmail.com>\nwrote:\n> hello") === "Merci !", "introduction de citation coupée sur deux lignes (anglais) : retirée");
  ok(G.retirerCitations("D'accord\n\n-------- Message d'origine --------\nDe : sanix@gmail.com\nObjet : x") === "D'accord", "« Message d'origine » : retiré");
  const th = { messages: [msgT("p1", "Sanix <sanix@gmail.com>", T - 9e6, "Bonjour Marc"), msgT("r1", "Marc <marc@promo.ci>", T - 5e6, cit), msgT("r2", "marc@promo.ci", T - 4e6, undefined, "<div>Voici <b>mes</b> disponibilités&nbsp;:<br>lundi &amp; mardi</div>"), msgT("bd", "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", T - 3e6, "Delivery failed"), msgT("me", "sanix@gmail.com", T - 2e6, "Ma relance")] };
  const reps = G.extractReplies(th, "sanix@gmail.com");
  ok(reps.length === 2 && reps[0].gmail_message_id === "r1" && reps[0].from_email === "marc@promo.ci" && /démo mardi/.test(reps[0].body) && !/a écrit|Je vous propose/.test(reps[0].body), "extraction : réponses du prospect seulement (ni nous, ni retour d'erreur), citation retirée");
  ok(/Voici mes disponibilités :/.test(reps[1].body) && /lundi & mardi/.test(reps[1].body) && !/<|&amp;|&nbsp;/.test(reps[1].body), "réponse en HTML seul : convertie en texte lisible");
  ok(G.textOf({ mimeType: "text/plain", body: { data: b64("Éléphant à côté — 100 % OK") } }) === "Éléphant à côté — 100 % OK", "accents et tirets : décodés en UTF-8");
  S.mails.length = 0; S.inter.length = 0; S.replies.length = 0; calls.length = 0;
  S.account.scopes = G.GMAIL_SCOPES;
  await store.insertMail({ client_rid: "c_R", to_email: "marc@promo.ci", subject: "Démo", body: "Bonjour Marc", sent_by: "x", sent_by_user: null, gmail_message_id: "p1", gmail_thread_id: "thR", status: "envoye", error: null, replied_at: null, reply_from: null, relance_apres_jours: 4, last_checked_at: null });
  GOOGLE.threads = { thR: th };
  const lec = await G.syncReplies(D);
  ok(lec.reponses === 1 && lec.lues === 2 && S.replies.length === 2 && S.replies.every((r) => r.mail_id === "m1"), "synchronisation : la réponse est détectée ET son texte enregistré (2 messages du prospect)");
  const lec2 = await G.syncReplies(D);
  ok(S.replies.length === 2 && lec2.lues === 0, "relancé : aucun doublon, aucune nouvelle lecture");
  S.mails.length = 0; S.replies.length = 0; calls.length = 0;
  S.account.scopes = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata";
  await store.insertMail({ client_rid: "c_R", to_email: "marc@promo.ci", subject: "Démo", body: "Bonjour Marc", sent_by: "x", sent_by_user: null, gmail_message_id: "p1", gmail_thread_id: "thR", status: "envoye", error: null, replied_at: null, reply_from: null, relance_apres_jours: 4, last_checked_at: null });
  const vieux = await G.syncReplies(D);
  ok(vieux.reponses === 1 && vieux.lues === 0 && S.replies.length === 0 && !calls.some((c) => /format=full/.test(c.url)), "ancienne connexion (en-têtes seulement) : la réponse est détectée, mais le texte n'est ni demandé ni lu");
  S.account.scopes = G.GMAIL_SCOPES; calls.length = 0; T += 7 * 3600e3;   // 7 h plus tard : délai de 6 h entre deux tentatives de lecture écoulé
  const rat = await G.syncReplies(D);
  ok(rat.lues === 2 && S.replies.length === 2, "après reconnexion : les réponses déjà détectées sont rattrapées (texte lu)");
  const rat2 = await G.syncReplies(D);
  ok(rat2.lues === 0, "rattrapage fait une fois : pas de relecture inutile");
  S.mails.length = 0; S.mails.push(...avantMails); S.inter.length = 0; S.inter.push(...avantInter); S.replies.length = 0; S.account.scopes = avantScopes;

  console.log("▶ Adresse déjà revenue en erreur");
  let mort = null; try { await G.sendMail(D, op, { client_rid: "c_C", to: "C@x.ci", subject: "Nouvel essai", body: "Bonjour" }); } catch (e) { mort = e; }
  ok(mort && mort.status === 409 && /déjà renvoyé une erreur/.test(mort.message), "adresse dont l'e-mail précédent est revenu « non distribué » : envoi refusé par le serveur (409)");
  ok(!calls.some((c) => c.url.endsWith("/messages/send") && /Nouvel essai/.test(String(c.init && c.init.body))), "rien n'est envoyé à Gmail dans ce cas");
  const okMail = await G.sendMail(D, op, { client_rid: "c_C", to: "corrigee@x.ci", subject: "Nouvel essai", body: "Bonjour" });
  ok(!!okMail.id, "la même fiche, avec une adresse corrigée : l'envoi passe");
  const autre = S.mails.find((m) => m.status === "echec" && m.to_email === "C@x.ci"); ok(!!autre, "l'adresse refusée garde son statut d'échec dans le journal");
  S.mails.push({ id: "mX", client_rid: null, to_email: "refus@x.ci", subject: "S", body: "b", status: "echec", error: "Gmail a refusé l'envoi : Daily limit", sent_at: new Date(T).toISOString() });
  const refus = await G.sendMail(D, op, { to: "refus@x.ci", subject: "Reessai", body: "b" }); ok(!!refus.id, "un échec d'envoi côté Gmail (quota…) ne bloque pas l'adresse : seul un retour « non distribué » compte");

  console.log("▶ Accès retiré par l'utilisateur");
  GOOGLE.refreshOk = false; await store.insertMail({ client_rid: null, to_email: "z@x.ci", subject: "Z", body: "b", sent_by: "x", sent_by_user: null, gmail_message_id: "g", gmail_thread_id: "thB", status: "envoye", error: null, replied_at: null, reply_from: null, relance_apres_jours: 4, last_checked_at: null });
  let rv = null; try { await G.syncReplies(D); } catch (e) { rv = e; }
  ok(rv && rv.status === 409 && S.account.status === "erreur" && /reconnectez/.test(S.err), "accès révoqué sur Google : état « erreur » enregistré, message pour reconnecter");
  let rv2 = null; try { await G.sendMail(D, op, { to: "q@x.ci", subject: "Q", body: "b" }); } catch (e) { rv2 = e; } ok(rv2 && rv2.status === 409, "envoi impossible tant que Gmail n'est pas reconnecté");

  console.log("▶ Déconnexion");
  GOOGLE.refreshOk = true; calls.length = 0; await G.disconnect(D);
  ok(S.account === null && calls.some((c) => c.url.endsWith("/revoke") && /REFRESH-TOKEN-SECRET/.test(c.init.body)), "déconnexion : accès révoqué chez Google et jeton supprimé");
  let nc = null; try { await G.sendMail(D, op, { to: "q@x.ci", subject: "Q2", body: "b" }); } catch (e) { nc = e; } ok(nc && /pas connecté/.test(nc.message), "sans compte connecté : « Gmail n'est pas connecté »");
  console.log("\nGmail (envoi et suivi) : TOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
