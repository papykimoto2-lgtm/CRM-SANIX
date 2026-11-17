// SANIX CRM Pro : envoi Gmail et suivi des réponses — logique serveur testée avec un faux Google et un faux stockage. node gmail_test.js
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const KEY = Buffer.alloc(32, 7).toString("base64");
(async () => {
  const G = await import("../supabase/functions/_shared/gmail.ts");
  const ENV = { SUPABASE_URL: "https://proj.supabase.co", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", GMAIL_TOKEN_KEY: KEY, APP_URL: "https://crm.exemple.app" };
  let T = Date.parse("2026-11-17T10:00:00Z");
  // — faux stockage —
  const S = { account: null, mails: [], inter: [], err: undefined };
  const store = {
    getAccount: async () => S.account, saveAccount: async (a) => { S.account = { ...a, status: "connecte" }; }, markAccountError: async (m) => { if (S.account) S.account.status = m ? "erreur" : "connecte"; S.err = m; },
    deleteAccount: async () => { S.account = null; }, insertMail: async (m) => { const id = "m" + (S.mails.length + 1); S.mails.push({ ...m, id, sent_at: new Date(T).toISOString() }); return id; },
    pendingMails: async (since) => S.mails.filter((m) => m.status === "envoye" && m.sent_at > since), updateMail: async (id, p) => { Object.assign(S.mails.find((m) => m.id === id), p); },
    countSentSince: async () => S.mails.length, recentDuplicate: async (to, subj, since) => S.mails.some((m) => m.to_email === to && m.subject === subj && m.sent_at > since),
    addInteraction: async (rid, i) => { S.inter.push({ rid, ...i }); }
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
  ok(url.searchParams.get("scope") === G.GMAIL_SCOPES && !/readonly|modify|compose|mail\.google\.com/.test(url.searchParams.get("scope")), "droits demandés : envoi + en-têtes seulement (jamais la lecture du contenu)");
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
  ok(calls.filter((c) => c.url.includes("/threads/")).every((c) => /format=metadata/.test(c.url) && !/format=full|format=raw/.test(c.url)), "seuls les en-têtes sont demandés à Gmail (format=metadata) : le contenu des e-mails n'est jamais lu");
  const sy2 = await G.syncReplies(D);
  ok(sy2.reponses === 0, "relancé : une réponse déjà notée n'est pas comptée deux fois");
  const own = G.analyseThread({ messages: [msg("sanix@gmail.com", 1), msg("SANIX@gmail.com", 2)] }, "sanix@gmail.com");
  ok(!own.replied, "un message de vous-même dans le fil n'est pas pris pour une réponse");

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
