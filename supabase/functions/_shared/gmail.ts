// Envoi d'e-mails par le Gmail de l'entreprise et suivi des réponses (API Gmail, OAuth 2.0).
// Ce module n'importe rien du runtime (ni Deno, ni supabase-js) : toutes les dépendances sont injectées (`Deps`),
// ce qui permet de tester l'intégralité de la logique sous Node avec un faux Google (tests/gmail_test.js).
//
// Droits demandés à Google (le strict nécessaire) :
//   • gmail.send     — envoyer un message ;
//   • gmail.readonly — lire les fils que le CRM a lui-même ouverts (expéditeur, date et TEXTE des réponses) : savoir si le prospect a répondu et lire sa réponse.
//   Le CRM ne lit QUE ces fils (identifiants conservés à l'envoi) : jamais le reste de la boîte. Une connexion plus ancienne (envoi + en-têtes seulement) continue de
//   fonctionner : elle détecte les réponses sans en lire le texte, jusqu'à la reconnexion de Gmail.

export const SCOPE_LECTURE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.send " + SCOPE_LECTURE;
export const LIMITE_PAR_JOUR = 100;          // plafond d'envois par 24 h (Gmail : 500 pour un compte gratuit) : protège d'une boucle ou d'une erreur
export const JOURS_SUIVI = 45;
export const JOURS_ADRESSE_MORTE = 30;       // une adresse qui a renvoyé « non distribué » est refusée pendant 30 jours               // au-delà, un e-mail sans réponse n'est plus surveillé

export class GmailError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type MailRow = {
  id?: string; client_rid: string | null; to_email: string; subject: string; body: string; sent_by: string | null; sent_by_user: string | null;
  gmail_message_id: string | null; gmail_thread_id: string | null; status: "envoye" | "repondu" | "echec"; error: string | null;
  sent_at?: string; replied_at: string | null; reply_from: string | null; relance_apres_jours: number; last_checked_at: string | null;
};
export type MailAccount = { email: string; token_enc: string; status: string; scopes?: string | null };
export type ReplyRow = { gmail_message_id: string; from_email: string | null; received_at: string; body: string };

export type Store = {
  getAccount(): Promise<MailAccount | null>;
  saveAccount(a: { email: string; token_enc: string; scopes: string; connected_by: string | null }): Promise<void>;
  markAccountError(msg: string | null): Promise<void>;
  deleteAccount(): Promise<void>;
  insertMail(m: MailRow): Promise<string>;
  pendingMails(sinceIso: string, limit: number): Promise<MailRow[]>;
  updateMail(id: string, patch: Partial<MailRow>): Promise<void>;
  countSentSince(sinceIso: string): Promise<number>;
  /** E-mails non échoués envoyés par cet expéditeur (ex. « Agent IA ») depuis cette date. */
  countSentBy(sentBy: string, sinceIso: string): Promise<number>;
  recentDuplicate(toEmail: string, subject: string, sinceIso: string): Promise<boolean>;
  /** Un e-mail récent à cette adresse est revenu « non distribué » (adresse inexistante ou boîte pleine). */
  recentBounce(toEmail: string, sinceIso: string): Promise<boolean>;
  addInteraction(clientRid: string, interaction: Record<string, unknown>): Promise<void>;
  /** Enregistre le texte des réponses d'un e-mail (sans doublon : un message Gmail n'est enregistré qu'une fois). */
  saveReplies(mailId: string, replies: ReplyRow[]): Promise<void>;
  /** Un prospect a répondu (texte lu ou non) : met à jour sa fiche côté agents (dernier échange, relances remises à zéro) et, si la réponse demande l'arrêt (« STOP »), le désinscrit. Facultatif. */
  onProspectReply?(m: MailRow, textes: string[] | null): Promise<void>;
  /** Adresse en échec : les relances prévues vers ce prospect sont annulées (inutile de payer des tours d'IA pour un e-mail qui ne peut pas arriver). */
  onBounce?(m: MailRow): Promise<void>;
  /** Statut de qualité de l'adresse sur la fiche prospect (inconnu | a_confirmer | verifiee | invalide). */
  adresseStatut?(email: string): Promise<string>;
  /** Enregistre le statut ; une adresse « verifiee » (a répondu) n'est jamais rétrogradée, sauf par un retour « non distribué ». */
  /** Adresses e-mail de prospects jamais vérifiées (statut « inconnu »). */
  adressesAVerifier?(limite: number): Promise<string[]>;
  marquerAdresse?(email: string, statut: "a_confirmer" | "verifiee" | "invalide", detail: string): Promise<void>;
  /** E-mails déjà marqués « répondu » dont le texte n'a pas été lu (reconnexion tardive), non vérifiés depuis `checkedBeforeIso`. */
  repliedWithoutText(sinceIso: string, checkedBeforeIso: string, limit: number): Promise<MailRow[]>;
};
export type Deps = {
  fetch: (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;
  now: () => Date;
  env: (name: string) => string;
  store: Store;
};

// ───────────────────────── Encodage ─────────────────────────
export function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const std64 = (bytes: Uint8Array) => { let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin); };

// ───────────────────────── Chiffrement du jeton (AES-GCM 256) ─────────────────────────
async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64url(keyB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  if (raw.length !== 32) throw new GmailError(500, "GMAIL_TOKEN_KEY doit contenir 32 octets (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptToken(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), new TextEncoder().encode(plain)));
  return "v1." + b64url(iv) + "." + b64url(ct);
}
export async function decryptToken(enc: string, keyB64: string): Promise<string> {
  const [v, iv, ct] = enc.split(".");
  if (v !== "v1" || !iv || !ct) throw new GmailError(500, "Jeton illisible");
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(keyB64), fromB64url(ct))); }
  catch { throw new GmailError(500, "Jeton illisible : la clé de chiffrement a changé, reconnectez Gmail"); }
}

// ───────────────────────── Paramètre « state » signé (anti-falsification du retour Google) ─────────────────────────
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signState(p: { uid: string; exp: number }, secret: string): Promise<string> {
  const body = b64url(JSON.stringify(p));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body)));
  return body + "." + b64url(sig);
}
export async function verifyState(state: string, secret: string, nowMs: number): Promise<{ uid: string }> {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) throw new GmailError(400, "Retour Google invalide");
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), new TextEncoder().encode(body)).catch(() => false);
  if (!ok) throw new GmailError(400, "Retour Google invalide");
  let p: { uid: string; exp: number };
  try { p = JSON.parse(new TextDecoder().decode(fromB64url(body))); } catch { throw new GmailError(400, "Retour Google invalide"); }
  if (!p.exp || p.exp < nowMs) throw new GmailError(400, "La demande de connexion a expiré : recommencez");
  return { uid: p.uid };
}

// ───────────────────────── Message (RFC 5322) ─────────────────────────
export const validEmail = (s: string) => /^[^@\s<>()",;:\\]+@[^@\s<>()",;:\\]+\.[^@\s<>()",;:\\]{2,}$/.test(s) && s.length <= 254;
export const headerSafe = (s: string) => !/[\r\n\0]/.test(s);

/** Mot encodé RFC 2047 (UTF-8, base64), découpé en morceaux ≤ 75 caractères ; ASCII pur inchangé. */
export function encodeWord(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const parts: string[] = []; let cur = "";
  for (const ch of s) {
    if (new TextEncoder().encode(cur + ch).length > 42) { parts.push(cur); cur = ""; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => "=?UTF-8?B?" + std64(new TextEncoder().encode(p)) + "?=").join("\r\n ");
}
export function buildMime(o: { from: string; fromName?: string; to: string; subject: string; text: string }): string {
  for (const v of [o.from, o.fromName ?? "", o.to, o.subject]) if (!headerSafe(v)) throw new GmailError(400, "Caractère interdit dans l'en-tête");
  if (!validEmail(o.to)) throw new GmailError(400, "Adresse du destinataire invalide");
  const name = o.fromName ? `"${encodeWord(o.fromName.replace(/["\\]/g, ""))}" <${o.from}>` : o.from;
  const body = std64(new TextEncoder().encode(o.text.replace(/\r?\n/g, "\r\n"))).replace(/(.{76})/g, "$1\r\n");
  return [`From: ${name}`, `To: ${o.to}`, `Subject: ${encodeWord(o.subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
}

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");
const safeFile = (n: string) => (String(n ?? "").split(/[\\/]/).pop()!.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80) || "piece-jointe");
/** Message HTML avec pièces jointes éventuelles (rapports) : une seule partie HTML, ou « multipart/mixed » (HTML + pièces jointes en base64). */
export function buildMimeHtml(o: { from: string; fromName?: string; to: string; subject: string; html: string; attachments?: { filename: string; content: Uint8Array }[]; boundary?: string }): string {
  for (const v of [o.from, o.fromName ?? "", o.to, o.subject]) if (!headerSafe(v)) throw new GmailError(400, "Caractère interdit dans l'en-tête");
  if (!validEmail(o.to)) throw new GmailError(400, "Adresse du destinataire invalide");
  const name = o.fromName ? `"${encodeWord(o.fromName.replace(/["\\]/g, ""))}" <${o.from}>` : o.from;
  const head = [`From: ${name}`, `To: ${o.to}`, `Subject: ${encodeWord(o.subject)}`, "MIME-Version: 1.0"];
  const html = wrap76(std64(new TextEncoder().encode(o.html)));
  const atts = o.attachments ?? [];
  if (!atts.length) return [...head, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", html].join("\r\n");
  const b = o.boundary ?? "sx" + b64url(crypto.getRandomValues(new Uint8Array(12)));
  const parts = [`--${b}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", html];
  for (const a of atts) {
    const f = safeFile(a.filename);
    parts.push(`--${b}`, `Content-Type: application/octet-stream; name="${f}"`, `Content-Disposition: attachment; filename="${f}"`, "Content-Transfer-Encoding: base64", "", wrap76(std64(a.content)));
  }
  parts.push(`--${b}--`, "");
  return [...head, `Content-Type: multipart/mixed; boundary="${b}"`, "", ...parts].join("\r\n");
}
const MAX_MAIL_OCTETS = 20 * 1024 * 1024;   // Gmail refuse au-delà de 25 Mo : marge pour l'encodage

/** Envoi d'un e-mail du système (rapports de direction) par le Gmail connecté. N'écrit PAS dans le journal des e-mails de prospects (ni relance, ni statistiques de prospection). */
export async function sendSystemMail(d: Deps, m: { to: string; subject: string; html: string; attachments?: { filename: string; content: Uint8Array }[]; from_name?: string }): Promise<{ id: string }> {
  const to = String(m.to ?? "").trim(), subject = String(m.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
  if (!validEmail(to)) throw new GmailError(400, "Adresse du destinataire invalide");
  if (!subject) throw new GmailError(400, "Objet vide");
  if ((m.attachments ?? []).reduce((t, a) => t + a.content.length, 0) + m.html.length > MAX_MAIL_OCTETS) throw new GmailError(413, "Message trop volumineux pour Gmail");
  const { token, email } = await accessToken(d);
  const fromName = String(m.from_name ?? "").replace(/[\r\n"\\]/g, " ").trim().slice(0, 80) || undefined;
  const raw = b64url(buildMimeHtml({ from: email, fromName, to, subject, html: m.html, attachments: m.attachments }));
  const r = await d.fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new GmailError(r.status === 401 || r.status === 403 ? 409 : 502, "Gmail a refusé l'envoi : " + String(j?.error?.message || r.status).slice(0, 300));
  return { id: String(j.id) };
}

// ───────────────────────── Lecture d'un fil (en-têtes seulement) ─────────────────────────
export const addressOf = (header: string): string => { const m = /<([^>]+)>/.exec(header) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(header); return (m ? m[1] : header).trim().toLowerCase(); };
/** Adresses citées dans l'en-tête X-Failed-Recipients d'un retour d'erreur (Gmail y met le destinataire en échec). */
const failedRecipients = (m: any): string[] => {
  const h = (m?.payload?.headers ?? []).find((x: any) => String(x.name).toLowerCase() === "x-failed-recipients");
  return h ? String(h.value).split(/[,;\s]+/).map((a) => addressOf(a)).filter(Boolean) : [];
};
/**
 * Y a-t-il eu une réponse (ou un retour d'erreur) à CE message ? `destinataire` = adresse à laquelle il a été envoyé.
 * Gmail range dans un même fil des messages qui ont le même objet : un retour d'erreur concernant un AUTRE destinataire
 * (par exemple un essai précédent à une adresse fautive) peut s'y trouver. Un retour d'erreur ne compte donc que s'il vise bien ce
 * destinataire ; sans l'en-tête qui l'indique, il n'est retenu que dans un fil de deux messages (le nôtre et le retour), jamais dans un fil plus fourni.
 */
export function analyseThread(thread: any, myEmail: string, destinataire?: string): { replied: boolean; bounced: boolean; from?: string; at?: string } {
  const me = myEmail.toLowerCase(), dest = destinataire ? destinataire.toLowerCase() : "", msgs: any[] = Array.isArray(thread?.messages) ? thread.messages : [];
  const first = msgs.length ? Number(msgs[0].internalDate) || 0 : 0;
  for (const m of msgs.slice(1)) {
    const h = (m?.payload?.headers ?? []).find((x: any) => String(x.name).toLowerCase() === "from");
    if (!h) continue;
    const from = addressOf(String(h.value));
    if (!from || from === me) continue;
    const t = Number(m.internalDate) || 0; if (first && t && t < first) continue;
    const at = t ? new Date(t).toISOString() : undefined;
    if (/^(mailer-daemon|postmaster)@/.test(from)) {
      const cibles = failedRecipients(m);
      if (cibles.length ? (dest && !cibles.includes(dest)) : msgs.length > 2) continue;      // retour d'erreur pour un autre message : ignoré
      return { replied: false, bounced: true, from, at };
    }
    return { replied: true, bounced: false, from, at };
  }
  return { replied: false, bounced: false };
}

// ───────────────────────── Texte des réponses ─────────────────────────
const decode = (data?: string): string => { try { return new TextDecoder().decode(fromB64url(String(data ?? ""))); } catch { return ""; } };
const findPart = (p: any, mime: string): string | null => {
  if (!p) return null;
  if (String(p.mimeType).toLowerCase() === mime && p.body?.data) return decode(p.body.data);
  for (const c of Array.isArray(p.parts) ? p.parts : []) { const r = findPart(c, mime); if (r !== null) return r; }
  return null;
};
const htmlToText = (h: string): string => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
/** Texte brut d'un message Gmail (partie text/plain, sinon text/html nettoyé). */
export function textOf(payload: any): string {
  let t = findPart(payload, "text/plain");
  if (t === null) { const h = findPart(payload, "text/html"); t = h === null ? "" : htmlToText(h); }
  return t.replace(/\r\n?/g, "\n");
}
/** Ne garde que ce que le prospect a écrit : coupe à « Le … a écrit : » / « On … wrote: » / « Message d'origine », retire les lignes citées (« > »). */
export function retirerCitations(texte: string): string {
  const lignes = String(texte ?? "").replace(/\r\n?/g, "\n").split("\n"), out: string[] = [];
  const coupe = /^\s*(Le\s.{3,300}(a\s)?écrit\s*:\s*$|On\s.{3,300}wrote:\s*$|-{2,}\s*(Original Message|Message d.origine|Forwarded message|Message transmis)|_{8,}\s*$|De\s*:\s.+@|From\s*:\s.+@)/i;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (coupe.test(l) || (/^\s*(Le|On)\s/i.test(l) && coupe.test(l + " " + (lignes[i + 1] ?? "").trim()))) break;   // l'introduction de la citation peut être coupée sur deux lignes
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
}
/** Réponses d'un fil : messages d'un autre expéditeur que nous, postérieurs au premier message, hors retours d'erreur. */
export function extractReplies(thread: any, myEmail: string): ReplyRow[] {
  const me = myEmail.toLowerCase(), msgs: any[] = Array.isArray(thread?.messages) ? thread.messages : [], first = msgs.length ? Number(msgs[0].internalDate) || 0 : 0, out: ReplyRow[] = [];
  for (const m of msgs.slice(1)) {
    const h = (m?.payload?.headers ?? []).find((x: any) => String(x.name).toLowerCase() === "from");
    if (!h || !m.id) continue;
    const from = addressOf(String(h.value)); if (!from || from === me || /^(mailer-daemon|postmaster)@/.test(from)) continue;
    const t = Number(m.internalDate) || 0; if (first && t && t < first) continue;
    const brut = textOf(m.payload), body = retirerCitations(brut) || brut.trim().slice(0, 20000);
    out.push({ gmail_message_id: String(m.id), from_email: from, received_at: t ? new Date(t).toISOString() : new Date().toISOString(), body: body || "(message sans texte)" });
  }
  return out;
}
/** La réponse demande-t-elle d'arrêter les messages ? Strict : le message commence par STOP / « désinscription » / « ne plus recevoir » / « arrêtez » (pas un « stop » au milieu d'une phrase). */
export function estDesinscription(texte: string): boolean {
  const t = String(texte ?? "").replace(/^[\s"'«»>*_-]+/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /^(stop\b|unsubscribe\b|desinscri|desabonn|ne plus recevoir|ne m'?envoyez plus|arretez\b|merci de ne plus)/.test(t);
}
const lecturePermise = (acc: MailAccount) => String(acc.scopes ?? "").includes(SCOPE_LECTURE);
/** Lit le fil en entier (droit de lecture requis) et enregistre le texte des réponses ; renvoie leur nombre. Un échec n'interrompt pas le suivi. */
async function lireReponses(d: Deps, token: string, m: MailRow, email: string): Promise<number> {
  try {
    const r = await d.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(String(m.gmail_thread_id))}?format=full`, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return 0;
    const reps = extractReplies(await r.json(), email);
    if (reps.length) { await d.store.saveReplies(m.id!, reps); await d.store.onProspectReply?.(m, reps.map((r) => r.body)).catch(() => {}); }
    return reps.length;
  } catch { return 0; }
}

// ───────────────────────── Google ─────────────────────────
async function formPost(d: Deps, url: string, form: Record<string, string>) {
  return d.fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
}
const redirectUri = (d: Deps) => d.env("SUPABASE_URL").replace(/\/$/, "") + "/functions/v1/crm-gmail";

export async function connectUrl(d: Deps, uid: string): Promise<string> {
  const state = await signState({ uid, exp: d.now().getTime() + 10 * 60_000 }, d.env("GMAIL_TOKEN_KEY"));
  const q = new URLSearchParams({ client_id: d.env("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(d), response_type: "code", scope: GMAIL_SCOPES,
    access_type: "offline", prompt: "consent", state });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + q.toString();
}

/** Retour de Google : échange le code, vérifie les droits accordés, enregistre le jeton chiffré. Renvoie l'adresse de retour vers le CRM. */
export async function handleCallback(d: Deps, params: URLSearchParams): Promise<string> {
  const app = (d.env("APP_URL") || "https://crm-sanix.vercel.app").replace(/\/$/, "");
  const back = (ok: boolean, m = "") => app + "/?gmail=" + (ok ? "ok" : "erreur") + (m ? "&m=" + encodeURIComponent(m.slice(0, 200)) : "");
  try {
    if (params.get("error")) return back(false, params.get("error") === "access_denied" ? "Connexion refusée sur Google" : String(params.get("error")));
    const { uid } = await verifyState(params.get("state") ?? "", d.env("GMAIL_TOKEN_KEY"), d.now().getTime());
    const code = params.get("code"); if (!code) return back(false, "Code Google absent");
    const r = await formPost(d, "https://oauth2.googleapis.com/token", { code, client_id: d.env("GOOGLE_CLIENT_ID"), client_secret: d.env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(d), grant_type: "authorization_code" });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.access_token) return back(false, "Google a refusé le code (" + (t.error_description || t.error || r.status) + ")");
    const granted = String(t.scope || "");
    for (const need of GMAIL_SCOPES.split(" ")) if (!granted.includes(need)) return back(false, "Il faut accepter les deux autorisations demandées (envoi et lecture des réponses)");
    if (!t.refresh_token) return back(false, "Google n'a pas remis de jeton durable : retirez l'accès du CRM dans votre compte Google puis recommencez");
    const p = await d.fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: "Bearer " + t.access_token } });
    const prof = await p.json().catch(() => ({}));
    if (!p.ok || !prof.emailAddress) return back(false, "Impossible de lire l'adresse Gmail connectée");
    await d.store.saveAccount({ email: String(prof.emailAddress).toLowerCase(), token_enc: await encryptToken(t.refresh_token, d.env("GMAIL_TOKEN_KEY")), scopes: granted, connected_by: uid });
    return back(true);
  } catch (e) {
    return back(false, e instanceof GmailError ? e.message : "Erreur inattendue");
  }
}

async function accessToken(d: Deps): Promise<{ token: string; email: string }> {
  const acc = await d.store.getAccount();
  if (!acc) throw new GmailError(409, "Gmail n'est pas connecté");
  const refresh = await decryptToken(acc.token_enc, d.env("GMAIL_TOKEN_KEY"));
  const r = await formPost(d, "https://oauth2.googleapis.com/token", { client_id: d.env("GOOGLE_CLIENT_ID"), client_secret: d.env("GOOGLE_CLIENT_SECRET"), refresh_token: refresh, grant_type: "refresh_token" });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    if (t.error === "invalid_grant") { await d.store.markAccountError("Accès Gmail retiré ou expiré : reconnectez Gmail"); throw new GmailError(409, "Accès Gmail retiré ou expiré : reconnectez Gmail"); }
    throw new GmailError(502, "Google indisponible (" + (t.error || r.status) + ")");
  }
  if (acc.status !== "connecte") await d.store.markAccountError(null);
  return { token: t.access_token, email: acc.email };
}

// ───────────────────────── Envoi ─────────────────────────
export type SendInput = { client_rid?: string | null; to: string; subject: string; body: string; from_name?: string; relance_jours?: number };
export async function sendMail(d: Deps, op: { user_id: string | null; nom: string }, i: SendInput): Promise<{ id: string; thread_id: string | null }> {
  const to = String(i.to ?? "").trim(), subject = String(i.subject ?? "").trim(), body = String(i.body ?? "");
  if (!validEmail(to)) throw new GmailError(400, "Adresse du destinataire invalide");
  if (!subject || subject.length > 300) throw new GmailError(400, "Objet vide ou trop long (300 caractères maximum)");
  if (!body.trim() || body.length > 20000) throw new GmailError(400, "Message vide ou trop long (20 000 caractères maximum)");
  const jours = Math.min(60, Math.max(1, Math.round(Number(i.relance_jours) || 4)));
  const now = d.now();
  if (await d.store.countSentSince(new Date(now.getTime() - 24 * 3600e3).toISOString()) >= LIMITE_PAR_JOUR) throw new GmailError(429, `Plafond de ${LIMITE_PAR_JOUR} e-mails par 24 h atteint`);
  if (await d.store.recentDuplicate(to, subject, new Date(now.getTime() - 120e3).toISOString())) throw new GmailError(409, "Cet e-mail vient déjà d'être envoyé à ce destinataire");
  if (await d.store.recentBounce(to, new Date(now.getTime() - JOURS_ADRESSE_MORTE * 86400e3).toISOString())) throw new GmailError(409, "Cette adresse a déjà renvoyé une erreur de distribution (adresse inexistante ou boîte pleine) : corrigez-la avant de réécrire");
  const { token, email } = await accessToken(d);
  const fromName = String(i.from_name ?? "").replace(/[\r\n"\\]/g, " ").trim().slice(0, 80) || undefined;
  const raw = b64url(buildMime({ from: email, fromName, to, subject, text: body }));
  const base: MailRow = { client_rid: i.client_rid ?? null, to_email: to, subject, body, sent_by: op.nom, sent_by_user: op.user_id, gmail_message_id: null, gmail_thread_id: null,
    status: "envoye", error: null, replied_at: null, reply_from: null, relance_apres_jours: jours, last_checked_at: null };
  const r = await d.fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) {
    const msg = String(j?.error?.message || r.status).slice(0, 300);
    await d.store.insertMail({ ...base, status: "echec", error: msg });
    throw new GmailError(r.status === 401 || r.status === 403 ? 409 : 502, "Gmail a refusé l'envoi : " + msg);
  }
  const id = await d.store.insertMail({ ...base, gmail_message_id: String(j.id), gmail_thread_id: j.threadId ? String(j.threadId) : null });
  if (i.client_rid) await d.store.addInteraction(i.client_rid, { date: now.toISOString(), type: "E-mail envoyé", note: subject + " → " + to, ico: "📧", source: "gmail" }).catch(() => {});
  return { id, thread_id: j.threadId ? String(j.threadId) : null };
}

export const ADRESSE_GENERIQUE = /^(info|infos|contact|contacts|admin|direction|commercial|accueil|secretariat|hello|bonjour|service)\d*@/i;
export type VerifAdresse = { statut: "a_confirmer" | "verifiee" | "invalide"; detail: string };
/** Statut d'une adresse sans rien envoyer : syntaxe + domaine (gratuit). « verifiee » ne s'obtient que par une réponse du prospect (voir onProspectReply). */
export async function classerAdresse(d: Deps, email: string): Promise<VerifAdresse> {
  const e = String(email ?? "").trim();
  if (!validEmail(e)) return { statut: "invalide", detail: "Adresse invalide (syntaxe)" };
  const v = await verifierDomaine(d, e);
  if (!v.ok) return { statut: "invalide", detail: `Adresse invalide : ${v.raison}` };
  if (ADRESSE_GENERIQUE.test(e)) return { statut: "a_confirmer", detail: "Domaine valide ; adresse générique : la boîte n'est pas garantie" };
  return { statut: "a_confirmer", detail: "Domaine valide ; la boîte n'est confirmée que par une réponse du prospect" };
}

/** Vérification en lot (gratuite, sans IA) des adresses jamais vérifiées : un seul contrôle DNS par domaine. */
export async function verifierAdressesEnLot(d: Deps, limite = 150): Promise<{ traitees: number; a_confirmer: number; invalides: number; restantes: number }> {
  const adresses = (await d.store.adressesAVerifier?.(limite + 1)) ?? [];
  const lot = adresses.slice(0, limite);
  const parDomaine = new Map<string, string[]>();
  for (const a of lot) { const dom = a.slice(a.lastIndexOf("@") + 1).toLowerCase(); parDomaine.set(dom, [...(parDomaine.get(dom) ?? []), a]); }
  let a_confirmer = 0, invalides = 0;
  const domaines = [...parDomaine.keys()];
  for (let i = 0; i < domaines.length; i += 8) {
    await Promise.all(domaines.slice(i, i + 8).map(async (dom) => {
      const mails = parDomaine.get(dom)!;
      const v = await verifierDomaine(d, mails[0]);
      for (const m of mails) {
        const statut = !validEmail(m.trim()) || !v.ok ? "invalide" : "a_confirmer";
        const detail = statut === "invalide" ? (validEmail(m.trim()) ? `Adresse invalide : ${v.raison}` : "Adresse invalide (syntaxe)")
          : ADRESSE_GENERIQUE.test(m) ? "Domaine valide ; adresse générique : la boîte n'est pas garantie" : "Domaine valide ; la boîte n'est confirmée que par une réponse du prospect";
        await d.store.marquerAdresse?.(m, statut, detail).catch(() => {});
        if (statut === "invalide") invalides++; else a_confirmer++;
      }
    }));
  }
  return { traitees: lot.length, a_confirmer, invalides, restantes: Math.max(0, adresses.length - lot.length) };
}

// ───────────────────────── E-mails des agents IA ─────────────────────────
export const LIMITE_AGENTS_PAR_JOUR = 30;     // plafond d'e-mails des agents sur 24 h (en plus du plafond de 100 du compte)
export const SIGNATAIRE_AGENT = "Agent IA";

/**
 * Vérification gratuite du domaine du destinataire avant un premier envoi d'agent : un domaine qui n'existe pas ou qui ne reçoit pas de courrier
 * (ni MX, ni A) ne peut que renvoyer « non distribué ». Interroge DNS-over-HTTPS (Google) ; si le service ne répond pas, on laisse passer
 * (jamais de blocage sur une panne). Ne peut PAS savoir si la boîte elle-même existe (info@… sur un domaine valide) : seul un retour Gmail le dira.
 */
export async function verifierDomaine(d: Deps, email: string): Promise<{ ok: boolean; raison?: string }> {
  const domaine = email.slice(email.lastIndexOf("@") + 1).toLowerCase().trim();
  if (!domaine || !/^[a-z0-9.-]+$/.test(domaine) || !domaine.includes(".")) return { ok: false, raison: "domaine invalide" };
  if (/(^|\.)(example\.(com|org|net)|test|invalid|localhost)$/.test(domaine)) return { ok: false, raison: "domaine factice" };
  const interroge = async (type: "MX" | "A"): Promise<{ status: number; reponses: number } | null> => {
    try {
      const r = await d.fetch(`https://dns.google/resolve?name=${encodeURIComponent(domaine)}&type=${type}`, { headers: { accept: "application/dns-json" } });
      if (!r.ok) return null;
      const j = await r.json();
      if (typeof j?.Status !== "number") return null;
      return { status: j.Status, reponses: Array.isArray(j.Answer) ? j.Answer.length : 0 };
    } catch { return null; }
  };
  const mx = await interroge("MX");
  if (!mx) return { ok: true };                       // service DNS indisponible : pas de blocage
  if (mx.status === 3) return { ok: false, raison: "le domaine n'existe pas" };
  if (mx.reponses > 0) return { ok: true };
  const a = await interroge("A");                     // sans MX, le courrier est livré à l'adresse A du domaine (RFC 5321)
  if (!a) return { ok: true };
  return a.reponses > 0 ? { ok: true } : { ok: false, raison: "le domaine ne reçoit pas de courrier (aucun serveur de messagerie)" };
}
export type AgentSend = { ok: boolean; statut: string; detail: string; external_id?: string };
/**
 * Envoie l'e-mail d'un agent par le Gmail connecté. Il entre dans le journal des e-mails du CRM (donc dans « Relances », avec lecture des réponses
 * et fiche client mise à jour). Gmail non connecté, plafond atteint ou panne passagère : statut « a_envoyer » (le message reste en file pour un prochain essai).
 * Refus définitif (adresse invalide ou en erreur, doublon) : statut « echec ».
 */
export async function sendAgentMail(d: Deps, i: { client_rid?: string | null; to: string; subject: string; body: string }): Promise<AgentSend> {
  const enFile = (detail: string): AgentSend => ({ ok: false, statut: "a_envoyer", detail });
  const acc = await d.store.getAccount();
  if (!acc || acc.status !== "connecte") return enFile("E-mail non configuré : connectez Gmail dans le CRM (Paramétrage → Relances) ; message mis en file");
  if (await d.store.countSentBy(SIGNATAIRE_AGENT, new Date(d.now().getTime() - 24 * 3600e3).toISOString()) >= LIMITE_AGENTS_PAR_JOUR)
    return enFile(`Plafond de ${LIMITE_AGENTS_PAR_JOUR} e-mails d'agents par 24 h atteint : message gardé en file`);
  if (!validEmail(i.to.trim())) return { ok: false, statut: "echec", detail: "Adresse du destinataire invalide" };
  if ((await d.store.adresseStatut?.(i.to.trim()).catch(() => "inconnu")) === "invalide") return { ok: false, statut: "echec", detail: "Adresse marquée invalide sur la fiche : envoi évité" };
  const v = await classerAdresse(d, i.to.trim());
  await d.store.marquerAdresse?.(i.to.trim(), v.statut, v.detail).catch(() => {});
  if (v.statut === "invalide") return { ok: false, statut: "echec", detail: `Adresse non vérifiée, envoi évité : ${v.detail}` };
  try {
    const r = await sendMail(d, { user_id: null, nom: SIGNATAIRE_AGENT }, { client_rid: i.client_rid ?? null, to: i.to, subject: i.subject.slice(0, 300), body: i.body, relance_jours: 4 });
    return { ok: true, statut: "envoye", detail: "Envoyé par Gmail", external_id: r.id };
  } catch (e) {
    if (e instanceof GmailError) return e.status === 429 || e.status === 502 ? enFile(e.message + " : message gardé en file") : { ok: false, statut: "echec", detail: e.message };
    return { ok: false, statut: "echec", detail: e instanceof Error ? e.message : String(e) };
  }
}

// ───────────────────────── Suivi des réponses ─────────────────────────
export async function syncReplies(d: Deps): Promise<{ verifies: number; reponses: number; echecs: number; lues: number }> {
  const acc = await d.store.getAccount();
  if (!acc || acc.status !== "connecte") return { verifies: 0, reponses: 0, echecs: 0, lues: 0 };
  const since = new Date(d.now().getTime() - JOURS_SUIVI * 86400e3).toISOString(), lecture = lecturePermise(acc);
  const pending = (await d.store.pendingMails(since, 60)).filter((m) => m.gmail_thread_id);
  const rattrapage = lecture ? (await d.store.repliedWithoutText(since, new Date(d.now().getTime() - 6 * 3600e3).toISOString(), 20)).filter((m) => m.gmail_thread_id) : [];
  if (!pending.length && !rattrapage.length) return { verifies: 0, reponses: 0, echecs: 0, lues: 0 };
  const { token, email } = await accessToken(d);
  let verifies = 0, reponses = 0, echecs = 0, lues = 0;
  for (const m of rattrapage) { lues += await lireReponses(d, token, m, email); await d.store.updateMail(m.id!, { last_checked_at: d.now().toISOString() }).catch(() => {}); }
  for (const m of pending) {
    try {
      const r = await d.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(String(m.gmail_thread_id))}?format=metadata&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=X-Failed-Recipients`, { headers: { Authorization: "Bearer " + token } });
      if (r.status === 404) { await d.store.updateMail(m.id!, { last_checked_at: d.now().toISOString() }); continue; }
      if (!r.ok) continue;
      const a = analyseThread(await r.json(), email, m.to_email); verifies++;
      if (a.replied) {
        await d.store.updateMail(m.id!, { status: "repondu", replied_at: a.at ?? d.now().toISOString(), reply_from: a.from ?? null, last_checked_at: d.now().toISOString() }); reponses++;
        await d.store.onProspectReply?.(m, null).catch(() => {});
        if (lecture) lues += await lireReponses(d, token, m, email);
        if (m.client_rid) await d.store.addInteraction(m.client_rid, { date: a.at ?? d.now().toISOString(), type: "Réponse reçue par e-mail", note: "Réponse de " + (a.from ?? "le prospect") + " à : " + m.subject, etape: 1, ico: "📩", source: "gmail" }).catch(() => {});
      } else if (a.bounced) {
        await d.store.updateMail(m.id!, { status: "echec", error: "Non distribué (retour Gmail) : adresse inexistante ou boîte pleine", last_checked_at: d.now().toISOString() }); echecs++;
        await d.store.onBounce?.(m).catch(() => {});
        if (m.client_rid) await d.store.addInteraction(m.client_rid, { date: a.at ?? d.now().toISOString(), type: "E-mail non distribué", note: "L'adresse " + m.to_email + " semble incorrecte : à vérifier", ico: "⚠️", source: "gmail" }).catch(() => {});
      } else await d.store.updateMail(m.id!, { last_checked_at: d.now().toISOString() });
    } catch { /* un fil en erreur ne bloque pas les autres */ }
  }
  return { verifies, reponses, echecs, lues };
}

export async function disconnect(d: Deps): Promise<void> {
  const acc = await d.store.getAccount();
  if (acc) {
    try { const refresh = await decryptToken(acc.token_enc, d.env("GMAIL_TOKEN_KEY")); await formPost(d, "https://oauth2.googleapis.com/revoke", { token: refresh }); } catch { /* révocation au mieux */ }
  }
  await d.store.deleteAccount();
}
