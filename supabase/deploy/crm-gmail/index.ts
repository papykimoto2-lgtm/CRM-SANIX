// functions/_shared/core.ts
import { createClient } from "npm:@supabase/supabase-js@2.110.0";
function env(name, required = true) {
  const v = Deno.env.get(name) ?? "";
  if (required && !v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}
var ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://crm-sanix.vercel.app").split(",").map((s) => s.trim()).filter(Boolean);
function cors(req) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}
function json(req, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
var _db = null;
function db() {
  _db ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return _db;
}
async function requireOperator(req) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Authentification requise");
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Session invalide");
  const { data: op } = await db().from("ai_operators").select("user_id, nom, role, remise_max_pct").eq("user_id", data.user.id).eq("actif", true).maybeSingle();
  if (!op) throw new HttpError(403, "Acc\xE8s r\xE9serv\xE9 aux op\xE9rateurs commerciaux");
  return op;
}
function safeEqual(a, b) {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let r = 0;
  for (let i = 0; i < ea.length; i++) r |= ea[i] ^ eb[i];
  return r === 0;
}
var _cron = null;
async function cronSecret() {
  if (_cron && Date.now() - _cron.at < 3e4) return _cron.v;
  let v = "";
  try {
    const { data } = await db().rpc("ai_cron_secret");
    if (typeof data === "string") v = data;
  } catch {
  }
  if (!v) v = env("CRON_SECRET");
  _cron = { v, at: Date.now() };
  return v;
}
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function errMsg(e) {
  return e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
}

// functions/_shared/gmail.ts
var GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata";
var LIMITE_PAR_JOUR = 100;
var JOURS_SUIVI = 45;
var GmailError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function b64url(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - t.length % 4) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
var std64 = (bytes) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
async function aesKey(keyB64) {
  const raw = fromB64url(keyB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  if (raw.length !== 32) throw new GmailError(500, "GMAIL_TOKEN_KEY doit contenir 32 octets (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptToken(plain, keyB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), new TextEncoder().encode(plain)));
  return "v1." + b64url(iv) + "." + b64url(ct);
}
async function decryptToken(enc, keyB64) {
  const [v, iv, ct] = enc.split(".");
  if (v !== "v1" || !iv || !ct) throw new GmailError(500, "Jeton illisible");
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(keyB64), fromB64url(ct)));
  } catch {
    throw new GmailError(500, "Jeton illisible : la cl\xE9 de chiffrement a chang\xE9, reconnectez Gmail");
  }
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signState(p, secret) {
  const body = b64url(JSON.stringify(p));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body)));
  return body + "." + b64url(sig);
}
async function verifyState(state, secret, nowMs) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) throw new GmailError(400, "Retour Google invalide");
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), new TextEncoder().encode(body)).catch(() => false);
  if (!ok) throw new GmailError(400, "Retour Google invalide");
  let p;
  try {
    p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch {
    throw new GmailError(400, "Retour Google invalide");
  }
  if (!p.exp || p.exp < nowMs) throw new GmailError(400, "La demande de connexion a expir\xE9 : recommencez");
  return { uid: p.uid };
}
var validEmail = (s) => /^[^@\s<>()",;:\\]+@[^@\s<>()",;:\\]+\.[^@\s<>()",;:\\]{2,}$/.test(s) && s.length <= 254;
var headerSafe = (s) => !/[\r\n\0]/.test(s);
function encodeWord(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const parts = [];
  let cur = "";
  for (const ch of s) {
    if (new TextEncoder().encode(cur + ch).length > 42) {
      parts.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => "=?UTF-8?B?" + std64(new TextEncoder().encode(p)) + "?=").join("\r\n ");
}
function buildMime(o) {
  for (const v of [o.from, o.fromName ?? "", o.to, o.subject]) if (!headerSafe(v)) throw new GmailError(400, "Caract\xE8re interdit dans l'en-t\xEAte");
  if (!validEmail(o.to)) throw new GmailError(400, "Adresse du destinataire invalide");
  const name = o.fromName ? `"${encodeWord(o.fromName.replace(/["\\]/g, ""))}" <${o.from}>` : o.from;
  const body = std64(new TextEncoder().encode(o.text.replace(/\r?\n/g, "\r\n"))).replace(/(.{76})/g, "$1\r\n");
  return [`From: ${name}`, `To: ${o.to}`, `Subject: ${encodeWord(o.subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
}
var addressOf = (header) => {
  const m = /<([^>]+)>/.exec(header) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(header);
  return (m ? m[1] : header).trim().toLowerCase();
};
function analyseThread(thread, myEmail) {
  const me = myEmail.toLowerCase(), msgs = Array.isArray(thread?.messages) ? thread.messages : [];
  const first = msgs.length ? Number(msgs[0].internalDate) || 0 : 0;
  for (const m of msgs.slice(1)) {
    const h = (m?.payload?.headers ?? []).find((x) => String(x.name).toLowerCase() === "from");
    if (!h) continue;
    const from = addressOf(String(h.value));
    if (!from || from === me) continue;
    const t = Number(m.internalDate) || 0;
    if (first && t && t < first) continue;
    const at = t ? new Date(t).toISOString() : void 0;
    return /^(mailer-daemon|postmaster)@/.test(from) ? { replied: false, bounced: true, from, at } : { replied: true, bounced: false, from, at };
  }
  return { replied: false, bounced: false };
}
async function formPost(d, url, form) {
  return d.fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
}
var redirectUri = (d) => d.env("SUPABASE_URL").replace(/\/$/, "") + "/functions/v1/crm-gmail";
async function connectUrl(d, uid) {
  const state = await signState({ uid, exp: d.now().getTime() + 10 * 6e4 }, d.env("GMAIL_TOKEN_KEY"));
  const q = new URLSearchParams({
    client_id: d.env("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(d),
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + q.toString();
}
async function handleCallback(d, params) {
  const app = (d.env("APP_URL") || "https://crm-sanix.vercel.app").replace(/\/$/, "");
  const back = (ok, m = "") => app + "/?gmail=" + (ok ? "ok" : "erreur") + (m ? "&m=" + encodeURIComponent(m.slice(0, 200)) : "");
  try {
    if (params.get("error")) return back(false, params.get("error") === "access_denied" ? "Connexion refus\xE9e sur Google" : String(params.get("error")));
    const { uid } = await verifyState(params.get("state") ?? "", d.env("GMAIL_TOKEN_KEY"), d.now().getTime());
    const code = params.get("code");
    if (!code) return back(false, "Code Google absent");
    const r = await formPost(d, "https://oauth2.googleapis.com/token", {
      code,
      client_id: d.env("GOOGLE_CLIENT_ID"),
      client_secret: d.env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(d),
      grant_type: "authorization_code"
    });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.access_token) return back(false, "Google a refus\xE9 le code (" + (t.error_description || t.error || r.status) + ")");
    const granted = String(t.scope || "");
    for (const need2 of GMAIL_SCOPES.split(" ")) if (!granted.includes(need2)) return back(false, "Il faut accepter les deux autorisations demand\xE9es (envoi et en-t\xEAtes)");
    if (!t.refresh_token) return back(false, "Google n'a pas remis de jeton durable : retirez l'acc\xE8s du CRM dans votre compte Google puis recommencez");
    const p = await d.fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: "Bearer " + t.access_token } });
    const prof = await p.json().catch(() => ({}));
    if (!p.ok || !prof.emailAddress) return back(false, "Impossible de lire l'adresse Gmail connect\xE9e");
    await d.store.saveAccount({ email: String(prof.emailAddress).toLowerCase(), token_enc: await encryptToken(t.refresh_token, d.env("GMAIL_TOKEN_KEY")), scopes: granted, connected_by: uid });
    return back(true);
  } catch (e) {
    return back(false, e instanceof GmailError ? e.message : "Erreur inattendue");
  }
}
async function accessToken(d) {
  const acc = await d.store.getAccount();
  if (!acc) throw new GmailError(409, "Gmail n'est pas connect\xE9");
  const refresh = await decryptToken(acc.token_enc, d.env("GMAIL_TOKEN_KEY"));
  const r = await formPost(d, "https://oauth2.googleapis.com/token", { client_id: d.env("GOOGLE_CLIENT_ID"), client_secret: d.env("GOOGLE_CLIENT_SECRET"), refresh_token: refresh, grant_type: "refresh_token" });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    if (t.error === "invalid_grant") {
      await d.store.markAccountError("Acc\xE8s Gmail retir\xE9 ou expir\xE9 : reconnectez Gmail");
      throw new GmailError(409, "Acc\xE8s Gmail retir\xE9 ou expir\xE9 : reconnectez Gmail");
    }
    throw new GmailError(502, "Google indisponible (" + (t.error || r.status) + ")");
  }
  if (acc.status !== "connecte") await d.store.markAccountError(null);
  return { token: t.access_token, email: acc.email };
}
async function sendMail(d, op, i) {
  const to = String(i.to ?? "").trim(), subject = String(i.subject ?? "").trim(), body = String(i.body ?? "");
  if (!validEmail(to)) throw new GmailError(400, "Adresse du destinataire invalide");
  if (!subject || subject.length > 300) throw new GmailError(400, "Objet vide ou trop long (300 caract\xE8res maximum)");
  if (!body.trim() || body.length > 2e4) throw new GmailError(400, "Message vide ou trop long (20 000 caract\xE8res maximum)");
  const jours = Math.min(60, Math.max(1, Math.round(Number(i.relance_jours) || 4)));
  const now = d.now();
  if (await d.store.countSentSince(new Date(now.getTime() - 24 * 36e5).toISOString()) >= LIMITE_PAR_JOUR) throw new GmailError(429, `Plafond de ${LIMITE_PAR_JOUR} e-mails par 24 h atteint`);
  if (await d.store.recentDuplicate(to, subject, new Date(now.getTime() - 12e4).toISOString())) throw new GmailError(409, "Cet e-mail vient d\xE9j\xE0 d'\xEAtre envoy\xE9 \xE0 ce destinataire");
  const { token, email } = await accessToken(d);
  const fromName = String(i.from_name ?? "").replace(/[\r\n"\\]/g, " ").trim().slice(0, 80) || void 0;
  const raw = b64url(buildMime({ from: email, fromName, to, subject, text: body }));
  const base = {
    client_rid: i.client_rid ?? null,
    to_email: to,
    subject,
    body,
    sent_by: op.nom,
    sent_by_user: op.user_id,
    gmail_message_id: null,
    gmail_thread_id: null,
    status: "envoye",
    error: null,
    replied_at: null,
    reply_from: null,
    relance_apres_jours: jours,
    last_checked_at: null
  };
  const r = await d.fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) {
    const msg = String(j?.error?.message || r.status).slice(0, 300);
    await d.store.insertMail({ ...base, status: "echec", error: msg });
    throw new GmailError(r.status === 401 || r.status === 403 ? 409 : 502, "Gmail a refus\xE9 l'envoi : " + msg);
  }
  const id = await d.store.insertMail({ ...base, gmail_message_id: String(j.id), gmail_thread_id: j.threadId ? String(j.threadId) : null });
  if (i.client_rid) await d.store.addInteraction(i.client_rid, { date: now.toISOString(), type: "E-mail envoy\xE9", note: subject + " \u2192 " + to, ico: "\u{1F4E7}", source: "gmail" }).catch(() => {
  });
  return { id, thread_id: j.threadId ? String(j.threadId) : null };
}
async function syncReplies(d) {
  const acc = await d.store.getAccount();
  if (!acc || acc.status !== "connecte") return { verifies: 0, reponses: 0, echecs: 0 };
  const since = new Date(d.now().getTime() - JOURS_SUIVI * 864e5).toISOString();
  const pending = (await d.store.pendingMails(since, 60)).filter((m) => m.gmail_thread_id);
  if (!pending.length) return { verifies: 0, reponses: 0, echecs: 0 };
  const { token, email } = await accessToken(d);
  let verifies = 0, reponses = 0, echecs = 0;
  for (const m of pending) {
    try {
      const r = await d.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(String(m.gmail_thread_id))}?format=metadata&metadataHeaders=From&metadataHeaders=Date`, { headers: { Authorization: "Bearer " + token } });
      if (r.status === 404) {
        await d.store.updateMail(m.id, { last_checked_at: d.now().toISOString() });
        continue;
      }
      if (!r.ok) continue;
      const a = analyseThread(await r.json(), email);
      verifies++;
      if (a.replied) {
        await d.store.updateMail(m.id, { status: "repondu", replied_at: a.at ?? d.now().toISOString(), reply_from: a.from ?? null, last_checked_at: d.now().toISOString() });
        reponses++;
        if (m.client_rid) await d.store.addInteraction(m.client_rid, { date: a.at ?? d.now().toISOString(), type: "R\xE9ponse re\xE7ue par e-mail", note: "R\xE9ponse de " + (a.from ?? "le prospect") + " \xE0 : " + m.subject, etape: 1, ico: "\u{1F4E9}", source: "gmail" }).catch(() => {
        });
      } else if (a.bounced) {
        await d.store.updateMail(m.id, { status: "echec", error: "Non distribu\xE9 (retour Gmail) : adresse inexistante ou bo\xEEte pleine", last_checked_at: d.now().toISOString() });
        echecs++;
        if (m.client_rid) await d.store.addInteraction(m.client_rid, { date: a.at ?? d.now().toISOString(), type: "E-mail non distribu\xE9", note: "L'adresse " + m.to_email + " semble incorrecte : \xE0 v\xE9rifier", ico: "\u26A0\uFE0F", source: "gmail" }).catch(() => {
        });
      } else await d.store.updateMail(m.id, { last_checked_at: d.now().toISOString() });
    } catch {
    }
  }
  return { verifies, reponses, echecs };
}
async function disconnect(d) {
  const acc = await d.store.getAccount();
  if (acc) {
    try {
      const refresh = await decryptToken(acc.token_enc, d.env("GMAIL_TOKEN_KEY"));
      await formPost(d, "https://oauth2.googleapis.com/revoke", { token: refresh });
    } catch {
    }
  }
  await d.store.deleteAccount();
}

// functions/crm-gmail/index.ts
var store = {
  async getAccount() {
    const { data } = await db().from("crm_mail_account").select("email, token_enc, status").eq("id", 1).maybeSingle();
    return data ?? null;
  },
  async saveAccount(a) {
    const { error } = await db().from("crm_mail_account").upsert({ id: 1, email: a.email, token_enc: a.token_enc, scopes: a.scopes, connected_by: a.connected_by, status: "connecte", last_error: null, connected_at: (/* @__PURE__ */ new Date()).toISOString(), updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    if (error) throw new GmailError(500, "Enregistrement impossible : " + error.message);
  },
  async markAccountError(msg) {
    await db().from("crm_mail_account").update({ status: msg ? "erreur" : "connecte", last_error: msg, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", 1);
  },
  async deleteAccount() {
    await db().from("crm_mail_account").delete().eq("id", 1);
  },
  async insertMail(m) {
    const { data, error } = await db().from("crm_mails").insert(m).select("id").single();
    if (error) throw new GmailError(500, "Journal des e-mails indisponible : " + error.message);
    return data.id;
  },
  async pendingMails(sinceIso, limit) {
    const { data } = await db().from("crm_mails").select("*").eq("status", "envoye").not("gmail_thread_id", "is", null).gte("sent_at", sinceIso).order("last_checked_at", { ascending: true, nullsFirst: true }).limit(limit);
    return data ?? [];
  },
  async updateMail(id, patch) {
    await db().from("crm_mails").update(patch).eq("id", id);
  },
  async countSentSince(sinceIso) {
    const { count } = await db().from("crm_mails").select("id", { count: "exact", head: true }).neq("status", "echec").gte("sent_at", sinceIso);
    return count ?? 0;
  },
  async recentDuplicate(toEmail, subject, sinceIso) {
    const { count } = await db().from("crm_mails").select("id", { count: "exact", head: true }).eq("to_email", toEmail).eq("subject", subject).neq("status", "echec").gte("sent_at", sinceIso);
    return (count ?? 0) > 0;
  },
  async addInteraction(clientRid, interaction) {
    const { data } = await db().from("crm_records").select("rid").eq("entity", "clients").eq("rid", clientRid).is("deleted_at", null).maybeSingle();
    if (!data) return;
    await db().rpc("crm_put", { p_entity: "clients", p_rid: clientRid, p_patch: { interactions: [interaction] }, p_origin: "ia", p_actor: "gmail", p_protect: false, p_base: null, p_client_ts: null, p_natural: false });
  }
};
async function tokenKey() {
  const explicit = Deno.env.get("GMAIL_TOKEN_KEY");
  if (explicit) return explicit;
  const base = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!base) return "";
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base + ":crm-gmail-token-key")));
  let bin = "";
  for (const b of h) bin += String.fromCharCode(b);
  return btoa(bin);
}
var TOKEN_KEY = await tokenKey();
var deps = { fetch: (u, i) => fetch(u, i), now: () => /* @__PURE__ */ new Date(), env: (n) => n === "GMAIL_TOKEN_KEY" ? TOKEN_KEY : Deno.env.get(n) ?? "", store };
function fail(req, e) {
  if (e instanceof HttpError || e instanceof GmailError) return json(req, { error: e.message }, e.status);
  console.error("crm-gmail", errMsg(e));
  return json(req, { error: "Erreur interne" }, 500);
}
var need = (n) => {
  if (!deps.env(n)) throw new HttpError(503, `Configuration incompl\xE8te : secret \xAB ${n} \xBB absent (voir supabase/GMAIL.md)`);
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method === "GET") {
    const dest = await handleCallback(deps, new URL(req.url).searchParams);
    return new Response(null, { status: 302, headers: { Location: dest, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  if (req.method !== "POST") return json(req, { error: "M\xE9thode non autoris\xE9e" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    if (action === "sync" && req.headers.get("x-cron-secret")) {
      if (!safeEqual(req.headers.get("x-cron-secret") ?? "", await cronSecret())) throw new HttpError(401, "Non autoris\xE9");
      return json(req, { ok: true, ...await syncReplies(deps) });
    }
    const op = await requireOperator(req);
    const direction = op.role === "direction" || op.role === "admin";
    if (action === "status") {
      const { data } = await db().from("crm_mail_account").select("email, status, last_error, connected_at").eq("id", 1).maybeSingle();
      return json(req, { connecte: !!data && data.status === "connecte", email: data?.email ?? null, erreur: data?.last_error ?? null, peut_connecter: direction });
    }
    if (action === "connect_url") {
      if (!direction) throw new HttpError(403, "R\xE9serv\xE9 \xE0 la direction");
      need("GOOGLE_CLIENT_ID");
      need("GOOGLE_CLIENT_SECRET");
      need("GMAIL_TOKEN_KEY");
      return json(req, { url: await connectUrl(deps, op.user_id) });
    }
    if (action === "disconnect") {
      if (!direction) throw new HttpError(403, "R\xE9serv\xE9 \xE0 la direction");
      await disconnect(deps);
      return json(req, { ok: true });
    }
    if (action === "sync") return json(req, { ok: true, ...await syncReplies(deps) });
    if (action === "send") {
      need("GOOGLE_CLIENT_ID");
      need("GOOGLE_CLIENT_SECRET");
      need("GMAIL_TOKEN_KEY");
      const r = await sendMail(deps, op, {
        client_rid: typeof body.client_rid === "string" ? body.client_rid.slice(0, 80) : null,
        to: String(body.to ?? ""),
        subject: String(body.subject ?? ""),
        body: String(body.body ?? ""),
        from_name: typeof body.from_name === "string" ? body.from_name : void 0,
        relance_jours: Number(body.relance_jours) || void 0
      });
      return json(req, { ok: true, ...r });
    }
    throw new HttpError(400, "Action inconnue");
  } catch (e) {
    return fail(req, e);
  }
});
