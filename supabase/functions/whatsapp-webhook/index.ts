// Webhook WhatsApp Business Cloud API (Meta). Déployer avec --no-verify-jwt (Meta n'envoie pas de JWT) :
// l'authenticité est garantie par la signature HMAC X-Hub-Signature-256.
import { audit, db, env, safeEqual } from "../_shared/core.ts";
import { runAgent } from "../_shared/agent.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type WaMsg = { id: string; from: string; timestamp: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: any };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" &&
      safeEqual(url.searchParams.get("hub.verify_token") ?? "", env("WHATSAPP_VERIFY_TOKEN"));
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const raw = await req.text();
  if (raw.length > 1_000_000) return new Response("Payload Too Large", { status: 413 });
  const sig = (req.headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
  if (!sig || !safeEqual(sig, await hmacHex(env("WHATSAPP_APP_SECRET"), raw))) return new Response("Forbidden", { status: 403 });

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("Bad Request", { status: 400 }); }

  for (const entry of payload?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      const v = ch?.value ?? {};
      // Accusés de livraison / lecture
      for (const s of v.statuses ?? []) {
        const statut = ({ sent: "envoye", delivered: "delivre", read: "lu", failed: "echec" } as Record<string, string>)[s.status];
        if (statut) await db().from("ai_messages").update({ statut }).eq("canal", "whatsapp").eq("external_id", s.id);
      }
      for (const m of (v.messages ?? []) as WaMsg[]) {
        const name = v.contacts?.find((c: any) => c.wa_id === m.from)?.profile?.name as string | undefined;
        EdgeRuntime.waitUntil(handleInbound(m, name));
      }
    }
  }
  return new Response("OK"); // réponse < 5 s exigée par Meta ; traitement en arrière-plan
});

async function handleInbound(m: WaMsg, profileName?: string) {
  const texte = (m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ??
    `[${m.type} reçu]`).slice(0, 4000);
  const phone = m.from.replace(/\D/g, "");

  // Continuité omnicanale : un seul dossier par numéro, quel que soit le canal d'origine
  let { data: p } = await db().from("ai_prospects").select("id, opt_out").eq("phone_norm", phone).maybeSingle();
  if (!p) {
    const ins = await db().from("ai_prospects").insert({
      entreprise: (profileName || `Contact WhatsApp +${phone}`).slice(0, 200), whatsapp: `+${phone}`,
      stage: "conversation", source: "whatsapp_entrant",
      consentement: { whatsapp: { at: new Date().toISOString(), preuve: "message entrant", wamid: m.id } },
    }).select("id, opt_out").single();
    p = ins.data;
  }
  if (!p) return;

  const { error } = await db().from("ai_messages").insert({
    prospect_id: p.id, canal: "whatsapp", sens: "entrant", auteur: "prospect", contenu: texte, statut: "recu",
    external_id: m.id, created_at: new Date(Number(m.timestamp) * 1000).toISOString(),
  });
  if (error?.code === "23505") return; // doublon (Meta réessaie) → déjà traité

  // Le trigger SQL a pu passer opt_out à true (« STOP ») : accusé unique, aucune relance
  const { data: fresh } = await db().from("ai_prospects").select("opt_out").eq("id", p.id).single();
  if (fresh?.opt_out) {
    await db().from("ai_followups").update({ statut: "annulee" }).eq("prospect_id", p.id).eq("statut", "planifiee");
    await db().from("ai_prospects").update({ stage: "en_veille" }).eq("id", p.id);
    await audit({ agent: "whatsapp_manager", action: "desinscription", prospect_id: p.id });
    return;
  }

  try {
    await runAgent({ mode: "conversation", prospect_id: p.id },
      `Nouveau message WhatsApp du prospect ${p.id} :
<message_prospect>${texte}</message_prospect>
Consulte get_prospect (historique tous canaux), puis réponds via send_message (canal whatsapp) en poursuivant la conversation là où elle en est. Mets à jour la qualification et l'étape si l'échange apporte des faits, puis planifie la suite.`);
  } catch (e) {
    await audit({ agent: "whatsapp_manager", action: "erreur_agent", prospect_id: p.id, ok: false, payload: { e: String(e) } });
    await db().from("ai_approvals").insert({ type: "transfert_humain", prospect_id: p.id, motif: "Agent indisponible : répondre manuellement" });
  }
}
