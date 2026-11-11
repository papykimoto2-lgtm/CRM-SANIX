// Canaux sortants : WhatsApp Business Cloud API, e-mail (Resend).
// Règles : opt-out bloquant, fenêtre 24 h WhatsApp (hors fenêtre → modèle approuvé Meta uniquement),
// mention IA au premier contact, lien de désinscription e-mail.
import { db, env } from "./core.ts";

export type Prospect = {
  id: string; entreprise: string; decideur: string | null; email: string | null;
  whatsapp: string | null; telephone: string | null; phone_norm: string | null;
  opt_out: boolean; last_inbound_at: string | null; last_outbound_at: string | null; consentement: Record<string, unknown>;
};

export const AI_DISCLOSURE =
  "Je suis l'assistant commercial virtuel (IA) de SANIX AFRICA ; un conseiller humain peut prendre le relais à tout moment.";

const WA_WINDOW_MS = 24 * 3600 * 1000;
const GRAPH = "https://graph.facebook.com/v21.0";

/** Vrai seulement si les clés de l'API WhatsApp sont posées ; sinon les messages approuvés restent « a_envoyer » et un opérateur les envoie à la main (mode manuel). */
export const whatsappConfigured = (): boolean => !!(env("WHATSAPP_TOKEN", false) && env("WHATSAPP_PHONE_NUMBER_ID", false));

export type SendResult = { ok: boolean; statut: string; detail: string; external_id?: string; template?: boolean };

export async function sendWhatsApp(p: Prospect, text: string): Promise<SendResult> {
  if (p.opt_out) return { ok: false, statut: "echec", detail: "Prospect désinscrit : envoi interdit" };
  if (!p.phone_norm) return { ok: false, statut: "echec", detail: "Aucun numéro WhatsApp" };
  const token = env("WHATSAPP_TOKEN", false), phoneId = env("WHATSAPP_PHONE_NUMBER_ID", false);
  const inWindow = !!p.last_inbound_at && Date.now() - Date.parse(p.last_inbound_at) < WA_WINDOW_MS;

  // Hors fenêtre 24 h : Meta impose un modèle pré-approuvé. Seul le modèle part ; le texte libre
  // n'est jamais envoyé (l'agent poursuivra dès la réponse du prospect).
  const body = inWindow
    ? { messaging_product: "whatsapp", to: p.phone_norm, type: "text", text: { preview_url: true, body: text.slice(0, 4096) } }
    : {
      messaging_product: "whatsapp", to: p.phone_norm, type: "template",
      template: {
        name: env("WHATSAPP_TEMPLATE_FIRST", false) || "sanix_premier_contact",
        language: { code: "fr" },
        components: [{ type: "body", parameters: [{ type: "text", text: (p.decideur || p.entreprise).slice(0, 60) }] }],
      },
    };
  if (!token || !phoneId) return { ok: false, statut: "a_envoyer", detail: "WhatsApp non configuré : message mis en file" };

  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, statut: "echec", detail: `WhatsApp ${r.status}: ${j?.error?.message ?? "erreur"}` };
  return {
    ok: true,
    statut: "envoye",
    detail: inWindow ? "Envoyé" : "Hors fenêtre 24 h : seul le modèle d'ouverture a été envoyé",
    external_id: j?.messages?.[0]?.id,
    template: !inWindow,
  };
}

export async function sendEmail(p: Prospect, subject: string, text: string): Promise<SendResult> {
  if (p.opt_out) return { ok: false, statut: "echec", detail: "Prospect désinscrit : envoi interdit" };
  if (!p.email) return { ok: false, statut: "echec", detail: "Aucune adresse e-mail" };
  const key = env("RESEND_API_KEY", false), from = env("EMAIL_FROM", false);
  if (!key || !from) return { ok: false, statut: "a_envoyer", detail: "E-mail non configuré : message mis en file" };
  const footer = "\n\n—\nPour ne plus recevoir nos messages, répondez simplement « STOP ».";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [p.email], subject: subject.slice(0, 200), text: text + footer,
      reply_to: env("EMAIL_REPLY_TO", false) || undefined, headers: { "X-Sanix-Prospect": p.id } }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, statut: "echec", detail: `E-mail ${r.status}: ${j?.message ?? "erreur"}` };
  return { ok: true, statut: "envoye", detail: "Envoyé", external_id: j?.id };
}

/** Premier message sortant du fil ? (pour la mention IA obligatoire) */
export async function isFirstOutbound(prospectId: string): Promise<boolean> {
  const { count } = await db().from("ai_messages").select("id", { count: "exact", head: true })
    .eq("prospect_id", prospectId).eq("sens", "sortant").in("statut", ["envoye", "delivre", "lu", "a_envoyer"]);
  return (count ?? 0) === 0;
}
