// WhatsApp Business (API officielle Meta) depuis le CRM : envoi de messages modèles et de réponses, suivi remis / lu, réponses reçues, désinscriptions.
// Ce module n'importe rien du runtime (ni Deno, ni supabase-js) : toutes les dépendances sont injectées (`Deps`),
// ce qui permet de tester l'intégralité de la logique sous Node avec un faux Meta (tests/wacrm_test.js).
//
// Règles de Meta que le code applique :
//   • un premier message (ou hors fenêtre de 24 h) passe OBLIGATOIREMENT par un modèle pré-approuvé ;
//   • le texte libre n'est permis que dans les 24 h qui suivent un message du destinataire ;
//   • on n'écrit qu'aux personnes qui ont accepté d'être contactées : l'opérateur le confirme à chaque envoi, et « STOP » désinscrit.

export const LIMITE_PAR_JOUR = 150;                // plafond d'envois par 24 h (le palier de départ de Meta est de 250 destinataires par jour) : protège d'une boucle ou d'une erreur
export const FENETRE_MS = 24 * 3600e3;             // fenêtre de service : texte libre permis après un message du destinataire
export const JOURS_CONVERSATION = 7;               // une réponse reçue moins de 7 jours après notre message appartient au CRM (au-delà : au circuit des agents IA)
export const VERSION_GRAPH = "v27.0";

export class WaError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type MsgRow = {
  id?: string; client_rid: string | null; to_phone: string; kind: "template" | "text"; template: string | null; body: string; sent_by: string | null;
  sent_by_user: string | null; consent_by: string | null; wa_message_id: string | null; status: "envoye" | "remis" | "lu" | "echec"; error: string | null;
  sent_at?: string; delivered_at?: string | null; read_at?: string | null;
};
export type InboundRow = { wa_message_id: string; from_phone: string; client_rid: string | null; body: string; kind: string; received_at: string };

export type Store = {
  countSentSince(sinceIso: string): Promise<number>;
  recentDuplicate(phone: string, template: string, sinceIso: string): Promise<boolean>;
  /** Désinscrit : dans la liste du CRM, ou « opt_out » côté agents IA. */
  isOptedOut(phone: string): Promise<boolean>;
  lastInboundAt(phone: string): Promise<string | null>;
  insertMessage(m: MsgRow): Promise<string>;
  getByWamid(wamid: string): Promise<MsgRow | null>;
  updateById(id: string, patch: Partial<MsgRow>): Promise<void>;
  /** Le CRM a-t-il écrit à ce numéro depuis `sinceIso` ? → { client_rid } de la dernière fiche écrite, ou null. */
  recentOutbound(phone: string, sinceIso: string): Promise<{ client_rid: string | null } | null>;
  /** false si ce message reçu était déjà enregistré (Meta réessaie). */
  insertInbound(r: InboundRow): Promise<boolean>;
  setOptOut(phone: string, source: string): Promise<void>;
  addInteraction(clientRid: string, interaction: Record<string, unknown>): Promise<void>;
  syncProspectOutbound?(clientRid: string | null, phone: string, at: string): Promise<void>;
  syncProspectInbound?(clientRid: string | null, phone: string, at: string): Promise<void>;
};
export type Deps = {
  fetch: (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;
  now: () => Date;
  env: (name: string) => string;
  store: Store;
};

// ───────────────────────── Outils ─────────────────────────
/** « +225 07 00 00 01 07 », « 0022507… » → « 2250700000107 » (chiffres seuls, 8 à 15) ; '' si ce n'est pas un numéro. */
export function normPhone(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return /^[0-9]{8,15}$/.test(d) ? d : "";
}
/** Une variable de modèle ne peut contenir ni retour à la ligne, ni tabulation, ni 4 espaces de suite (règle de Meta) : toute suite d'espaces devient un seul espace. */
export function paramTexte(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 1024);
}
const STOP = /^\s*(stop|arr[eê]t(er)?|d[eé]sinscri(re|ption)|unsubscribe|ne plus (me )?contacter|ne m'?[eé]crivez plus)\b/i;
const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const estStop = (t: string) => STOP.test(sansAccent(t).replace(/^[\s"'«»*_.!]+/, ""));
export const graph = (d: Deps) => "https://graph.facebook.com/" + (d.env("WHATSAPP_GRAPH_VERSION") || VERSION_GRAPH);

/** Ce qu'il manque côté serveur pour envoyer. */
export function etat(d: Deps): { configure: boolean; manquants: string[]; webhook: boolean } {
  const manquants = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"].filter((n) => !d.env(n));
  return { configure: manquants.length === 0, manquants, webhook: !!(d.env("WHATSAPP_VERIFY_TOKEN") && d.env("WHATSAPP_APP_SECRET")) };
}
function exigerConfig(d: Deps): { token: string; phoneId: string } {
  const e = etat(d);
  if (!e.configure) throw new WaError(503, "WhatsApp n'est pas configuré : secret(s) absent(s) — " + e.manquants.join(", ") + " (voir supabase/WHATSAPP.md)");
  return { token: d.env("WHATSAPP_TOKEN"), phoneId: d.env("WHATSAPP_PHONE_NUMBER_ID") };
}

async function garde(d: Deps, phone: string, sinceDup?: { template: string }): Promise<void> {
  const now = d.now();
  if (await d.store.isOptedOut(phone)) throw new WaError(409, "Ce numéro a demandé à ne plus être contacté (STOP) : envoi interdit");
  if (await d.store.countSentSince(new Date(now.getTime() - 24 * 3600e3).toISOString()) >= LIMITE_PAR_JOUR) throw new WaError(429, `Plafond de ${LIMITE_PAR_JOUR} messages WhatsApp par 24 h atteint`);
  if (sinceDup && await d.store.recentDuplicate(phone, sinceDup.template, new Date(now.getTime() - 24 * 3600e3).toISOString())) throw new WaError(409, "Ce modèle a déjà été envoyé à ce numéro dans les dernières 24 h");
}

async function poster(d: Deps, phoneId: string, token: string, payload: unknown): Promise<{ ok: true; wamid: string } | { ok: false; status: number; message: string }> {
  const r = await d.fetch(`${graph(d)}/${encodeURIComponent(phoneId)}/messages`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  const wamid = j?.messages?.[0]?.id;
  if (!r.ok || !wamid) return { ok: false, status: r.status, message: String(j?.error?.error_data?.details || j?.error?.message || r.status).slice(0, 300) };
  return { ok: true, wamid: String(wamid) };
}

// ───────────────────────── Envoi ─────────────────────────
export type SendTemplateInput = { client_rid?: string | null; to: string; template: string; lang?: string; params?: unknown[]; preview: string; consent: boolean };
/** Envoie un modèle approuvé à un prospect. `preview` = le texte tel que le destinataire le lira (conservé dans l'historique). */
export async function sendTemplate(d: Deps, op: { user_id: string; nom: string }, i: SendTemplateInput): Promise<{ id: string; wa_message_id: string }> {
  if (i.consent !== true) throw new WaError(400, "Confirmez que le destinataire a accepté d'être contacté sur WhatsApp");
  const to = normPhone(i.to); if (!to) throw new WaError(400, "Numéro WhatsApp invalide");
  const template = String(i.template ?? "").trim(); if (!/^[a-z0-9_]{1,512}$/.test(template)) throw new WaError(400, "Nom de modèle invalide (minuscules, chiffres et _ uniquement)");
  const lang = String(i.lang ?? "fr").trim(); if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(lang)) throw new WaError(400, "Langue du modèle invalide");
  const params = (Array.isArray(i.params) ? i.params : []).slice(0, 10).map(paramTexte);
  if (params.some((p) => !p)) throw new WaError(400, "Une variable du modèle est vide : le message n'est pas prêt");
  const preview = String(i.preview ?? "").trim(); if (!preview || preview.length > 4096) throw new WaError(400, "Texte du message vide ou trop long");
  const { token, phoneId } = exigerConfig(d);
  await garde(d, to, { template });
  const payload = { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
    template: { name: template, language: { code: lang }, ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}) } };
  const base: MsgRow = { client_rid: i.client_rid ?? null, to_phone: to, kind: "template", template, body: preview, sent_by: op.nom, sent_by_user: op.user_id, consent_by: op.nom, wa_message_id: null, status: "envoye", error: null };
  const r = await poster(d, phoneId, token, payload);
  if (!r.ok) {
    await d.store.insertMessage({ ...base, status: "echec", error: r.message });
    throw new WaError(r.status === 401 || r.status === 403 ? 409 : 502, "WhatsApp a refusé l'envoi : " + r.message);
  }
  const id = await d.store.insertMessage({ ...base, wa_message_id: r.wamid });
  const sentAt = d.now().toISOString();
  if (i.client_rid) await d.store.addInteraction(i.client_rid, { date: sentAt, type: "Message WhatsApp", note: "Modèle « " + template + " » envoyé", ico: "💬", source: "whatsapp" }).catch(() => {});
  await d.store.syncProspectOutbound?.(i.client_rid ?? null, to, sentAt).catch(() => {});
  return { id, wa_message_id: r.wamid };
}

export type SendTextInput = { client_rid?: string | null; to: string; text: string };
/** Répond librement à un prospect qui vient d'écrire (fenêtre de 24 h ouverte). */
export async function sendText(d: Deps, op: { user_id: string; nom: string }, i: SendTextInput): Promise<{ id: string; wa_message_id: string }> {
  const to = normPhone(i.to); if (!to) throw new WaError(400, "Numéro WhatsApp invalide");
  const text = String(i.text ?? "").trim(); if (!text || text.length > 4096) throw new WaError(400, "Message vide ou trop long (4 096 caractères maximum)");
  const { token, phoneId } = exigerConfig(d);
  const last = await d.store.lastInboundAt(to);
  if (!last || d.now().getTime() - Date.parse(last) >= FENETRE_MS) throw new WaError(409, "La fenêtre de 24 h est fermée (le prospect n'a pas écrit depuis plus de 24 h) : seul un modèle approuvé peut être envoyé");
  await garde(d, to);
  const base: MsgRow = { client_rid: i.client_rid ?? null, to_phone: to, kind: "text", template: null, body: text, sent_by: op.nom, sent_by_user: op.user_id, consent_by: null, wa_message_id: null, status: "envoye", error: null };
  const r = await poster(d, phoneId, token, { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } });
  if (!r.ok) {
    await d.store.insertMessage({ ...base, status: "echec", error: r.message });
    throw new WaError(r.status === 401 || r.status === 403 ? 409 : 502, "WhatsApp a refusé l'envoi : " + r.message);
  }
  const id = await d.store.insertMessage({ ...base, wa_message_id: r.wamid });
  const sentAt = d.now().toISOString();
  if (i.client_rid) await d.store.addInteraction(i.client_rid, { date: sentAt, type: "Message WhatsApp", note: "Réponse envoyée", ico: "💬", source: "whatsapp" }).catch(() => {});
  await d.store.syncProspectOutbound?.(i.client_rid ?? null, to, sentAt).catch(() => {});
  return { id, wa_message_id: r.wamid };
}

// ───────────────────────── Réception (webhook Meta) ─────────────────────────
const RANG: Record<string, number> = { envoye: 0, remis: 1, lu: 2 };
const iso = (ts: unknown, d: Deps) => { const t = Number(ts) * 1000; return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : d.now().toISOString(); };

/** Accusé de Meta pour un de NOS messages : envoyé → remis → lu, ou échec. Un accusé tardif ne fait jamais reculer l'état. Retourne true si le message est un message du CRM. */
export async function recordStatus(d: Deps, s: any): Promise<boolean> {
  const wamid = String(s?.id ?? ""); if (!wamid) return false;
  const m = await d.store.getByWamid(wamid); if (!m || !m.id) return false;
  const at = iso(s.timestamp, d), rang = RANG[m.status] ?? 0;
  if (s.status === "delivered" && rang < 1) await d.store.updateById(m.id, { status: "remis", delivered_at: at });
  else if (s.status === "read" && rang < 2) await d.store.updateById(m.id, { status: "lu", read_at: at, delivered_at: m.delivered_at ?? at });
  else if (s.status === "failed" && rang < 1) {
    const e = s.errors?.[0] ?? {};
    await d.store.updateById(m.id, { status: "echec", error: String(e.error_data?.details || e.message || e.title || "Échec de distribution").slice(0, 300) });
  }
  return true;
}

/** Message reçu d'un prospect. Si le CRM lui a écrit depuis moins de 7 jours : on l'enregistre ici (un humain répondra) et on retourne true.
    Sinon : false → c'est le circuit des agents IA qui le traite. « STOP » désinscrit le numéro. */
export async function routeInbound(d: Deps, m: any, profileName?: string): Promise<boolean> {
  const phone = normPhone(m?.from); if (!phone) return false;
  const since = new Date(d.now().getTime() - JOURS_CONVERSATION * 86400e3).toISOString();
  const conv = await d.store.recentOutbound(phone, since); if (!conv) return false;
  const texte = String(m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type ?? "message"} reçu]`).slice(0, 4000);
  const neuf = await d.store.insertInbound({ wa_message_id: String(m.id ?? ""), from_phone: phone, client_rid: conv.client_rid, body: texte, kind: String(m.type ?? "text"), received_at: iso(m.timestamp, d) });
  if (!neuf) return true;                                   // déjà reçu : Meta réessaie
  const stop = estStop(texte);
  if (stop) await d.store.setOptOut(phone, "STOP par WhatsApp");
  await d.store.syncProspectInbound?.(conv.client_rid, phone, iso(m.timestamp, d)).catch(() => {});
  if (conv.client_rid) {
    const nom = profileName ? profileName + " : " : "";
    await d.store.addInteraction(conv.client_rid, stop
      ? { date: iso(m.timestamp, d), type: "Désinscription WhatsApp", note: "A demandé à ne plus être contacté : ne plus lui écrire", ico: "⛔", source: "whatsapp" }
      : { date: iso(m.timestamp, d), type: "Réponse reçue par WhatsApp", note: nom + "« " + texte.replace(/\s+/g, " ").slice(0, 80) + (texte.length > 80 ? "…" : "") + " »", etape: 1, ico: "💬", source: "whatsapp" }).catch(() => {});
  }
  return true;
}
