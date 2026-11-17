// Envoi d'e-mails des rapports : Resend s'il est configuré (RESEND_API_KEY + EMAIL_FROM), sinon le Gmail connecté au CRM.
// Non configuré = résultat explicite, jamais d'exception.
import { env, errMsg } from "../core.ts";
import { sendSystemMail } from "../gmail.ts";
import { gmailDeps } from "../gmail_store.ts";

export type Mail = { to: string; subject: string; html: string; attachments?: { filename: string; content: Uint8Array }[] };
export type MailResult = { ok: boolean; id?: string; error?: string; nonConfigure?: boolean };

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function sendMail(m: Mail): Promise<MailResult> {
  const key = env("RESEND_API_KEY", false), from = env("EMAIL_FROM", false);
  if (!key || !from) return await viaGmail(m);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [m.to], subject: m.subject.slice(0, 200), html: m.html,
        reply_to: env("EMAIL_REPLY_TO", false) || undefined,
        attachments: m.attachments?.map((a) => ({ filename: a.filename, content: b64(a.content) })),
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, id: j?.id } : { ok: false, error: `Resend ${r.status}: ${j?.message ?? "erreur"}` };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Repli : le Gmail connecté au CRM (Paramétrage → Relances). Gmail non connecté = « non configuré » (le rapport reste généré, à renvoyer). */
async function viaGmail(m: Mail): Promise<MailResult> {
  const NON = "E-mail non configuré : connectez Gmail dans le CRM (Paramétrage → Relances) ou renseignez RESEND_API_KEY et EMAIL_FROM";
  try {
    const d = await gmailDeps();
    const acc = await d.store.getAccount();
    if (!acc || acc.status !== "connecte") return { ok: false, nonConfigure: true, error: NON };
    const r = await sendSystemMail(d, { to: m.to, subject: m.subject, html: m.html, attachments: m.attachments, from_name: "SANIX AI Virtual Company" });
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: "Gmail : " + errMsg(e) };
  }
}
