// WhatsApp du président — sortie : les réponses du directeur général IA (ai_executive_messages, wa_statut « en_attente ») partent sur le WhatsApp du président.
// Module volontairement autonome (core + channels) pour pouvoir être appelé depuis les outils sans dépendance circulaire avec le moteur.
import { audit, db, errMsg } from "../core.ts";
import { sendWhatsAppText, whatsappConfigured } from "../channels.ts";

const FENETRE_MS = 23 * 3600e3;
const PARTIE_MAX = 3500;
const PARTIES_MAX = 3;

/** Découpe un texte long en parties ≤ max, aux sauts de ligne ou espaces ; au plus `parties` parties, la dernière indique la suite dans le bureau. */
export function decouper(texte: string, max = PARTIE_MAX, parties = PARTIES_MAX): string[] {
  const t = texte.trim();
  if (t.length <= max) return [t];
  const out: string[] = [];
  let reste = t;
  while (reste.length > max && out.length < parties - 1) {
    let cut = reste.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = reste.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(reste.slice(0, cut).trim());
    reste = reste.slice(cut).trim();
  }
  // dernière partie : le reste, tronqué avec renvoi vers le bureau s'il dépasse encore
  out.push(reste.length > max ? reste.slice(0, max - 60).trimEnd() + "\n… (suite dans le bureau exécutif)" : reste);
  return out;
}

/** Envoie au président les messages du directeur en attente. Retourne le nombre d'envois et d'échecs. Idempotent : chaque message est réservé (« envoi ») avant l'appel. */
export async function flushPresidentWhatsApp(): Promise<{ envoyes: number; echecs: number }> {
  const res = { envoyes: 0, echecs: 0 };
  const { data: w } = await db().from("ai_president_whatsapp").select("numero, actif, last_inbound_at").eq("id", 1).maybeSingle();
  if (!w?.actif) return res;
  if (!whatsappConfigured()) return res;                       // les messages restent « en_attente » jusqu'à la configuration de l'API
  const { data: msgs } = await db().from("ai_executive_messages").select("id, contenu").eq("auteur", "directeur").eq("wa_statut", "en_attente").order("id").limit(5);
  for (const m of msgs ?? []) {
    const fenetreOuverte = !!w.last_inbound_at && Date.now() - Date.parse(w.last_inbound_at) < FENETRE_MS;
    if (!fenetreOuverte) { await db().from("ai_executive_messages").update({ wa_statut: "hors_fenetre" }).eq("id", m.id).eq("wa_statut", "en_attente"); continue; }
    const { data: pris } = await db().from("ai_executive_messages").update({ wa_statut: "envoi" }).eq("id", m.id).eq("wa_statut", "en_attente").select("id");
    if (!pris?.length) continue;                               // pris par un autre traitement
    try {
      let detail = "Envoyé";
      for (const [i, part] of decouper(String(m.contenu)).entries()) {
        const r = await sendWhatsAppText(w.numero, (i === 0 ? "*Directeur général IA SANIX*\n" : "") + part);
        if (!r.ok) throw new Error(r.detail);
        detail = r.detail;
      }
      await db().from("ai_executive_messages").update({ wa_statut: "envoye", wa_detail: detail }).eq("id", m.id);
      res.envoyes++;
    } catch (e) {
      await db().from("ai_executive_messages").update({ wa_statut: "echec", wa_detail: errMsg(e).slice(0, 300) }).eq("id", m.id);
      await audit({ agent: "president_whatsapp", action: "envoi_echec", ok: false, payload: { message: m.id, e: errMsg(e) } });
      res.echecs++;
    }
  }
  return res;
}
