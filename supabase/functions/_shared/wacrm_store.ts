// Accès base de données de WhatsApp CRM (service_role, côté serveur uniquement) : partagé par `crm-whatsapp` et `whatsapp-webhook`.
import { db } from "./core.ts";
import { WaError, type Deps, type MsgRow, type Store } from "./wacrm.ts";

export const store: Store = {
  async countSentSince(sinceIso) {
    const { count } = await db().from("crm_wa_messages").select("id", { count: "exact", head: true }).neq("status", "echec").gte("sent_at", sinceIso);
    return count ?? 0;
  },
  async recentDuplicate(phone, template, sinceIso) {
    const { count } = await db().from("crm_wa_messages").select("id", { count: "exact", head: true }).eq("to_phone", phone).eq("template", template).neq("status", "echec").gte("sent_at", sinceIso);
    return (count ?? 0) > 0;
  },
  async isOptedOut(phone) {
    const a = await db().from("crm_wa_optout").select("phone", { count: "exact", head: true }).eq("phone", phone);
    if ((a.count ?? 0) > 0) return true;
    const b = await db().from("ai_prospects").select("id", { count: "exact", head: true }).eq("phone_norm", phone).eq("opt_out", true);
    return (b.count ?? 0) > 0;
  },
  async lastInboundAt(phone) {
    const { data } = await db().from("crm_wa_inbound").select("received_at").eq("from_phone", phone).order("received_at", { ascending: false }).limit(1).maybeSingle();
    return data?.received_at ?? null;
  },
  async insertMessage(m: MsgRow) {
    const { data, error } = await db().from("crm_wa_messages").insert(m).select("id").single();
    if (error) throw new WaError(500, "Journal des messages indisponible : " + error.message);
    return data.id as string;
  },
  async getByWamid(wamid) {
    const { data } = await db().from("crm_wa_messages").select("*").eq("wa_message_id", wamid).maybeSingle();
    return (data ?? null) as MsgRow | null;
  },
  async updateById(id, patch) { await db().from("crm_wa_messages").update(patch).eq("id", id); },
  async recentOutbound(phone, sinceIso) {
    const { data } = await db().from("crm_wa_messages").select("client_rid").eq("to_phone", phone).neq("status", "echec").gte("sent_at", sinceIso).order("sent_at", { ascending: false }).limit(1).maybeSingle();
    return data ? { client_rid: data.client_rid ?? null } : null;
  },
  async insertInbound(r) {
    const { error } = await db().from("crm_wa_inbound").insert(r);
    if (error?.code === "23505") return false;
    if (error) throw new WaError(500, "Enregistrement de la réponse impossible : " + error.message);
    return true;
  },
  async setOptOut(phone, source) { await db().from("crm_wa_optout").upsert({ phone, source, since: new Date().toISOString() }); },
  async syncProspectOutbound(clientRid, phone, at) {
    let rows = [];
    if (clientRid) {
      const r = await db().from("ai_prospects").select("id,stage").eq("crm_rid", clientRid).limit(2);
      rows = r.data ?? [];
    }
    if (rows.length !== 1 && phone) {
      const r = await db().from("ai_prospects").select("id,stage").eq("phone_norm", phone).limit(2);
      rows = r.data ?? [];
    }
    if (rows.length !== 1) return;
    const p = rows[0];
    await db().from("ai_prospects").update({ last_outbound_at: at, ...(p.stage === "qualifie" ? { stage: "premier_contact" } : {}) }).eq("id", p.id);
  },
  async syncProspectInbound(clientRid, phone, at) {
    let rows = [];
    if (clientRid) {
      const r = await db().from("ai_prospects").select("id,stage").eq("crm_rid", clientRid).limit(2);
      rows = r.data ?? [];
    }
    if (rows.length !== 1 && phone) {
      const r = await db().from("ai_prospects").select("id,stage").eq("phone_norm", phone).limit(2);
      rows = r.data ?? [];
    }
    if (rows.length !== 1) return;
    const p = rows[0];
    await db().from("ai_prospects").update({ last_inbound_at: at, relances_sans_reponse: 0, ...(p.stage === "premier_contact" ? { stage: "conversation" } : {}) }).eq("id", p.id);
  },
  async addInteraction(clientRid, interaction) {
    // Jamais de création de fiche : on n'écrit que sur une fiche cliente qui existe déjà.
    const { data } = await db().from("crm_records").select("rid").eq("entity", "clients").eq("rid", clientRid).is("deleted_at", null).maybeSingle();
    if (!data) return;
    await db().rpc("crm_put", { p_entity: "clients", p_rid: clientRid, p_patch: { interactions: [interaction] }, p_origin: "ia", p_actor: "whatsapp", p_protect: false, p_base: null, p_client_ts: null, p_natural: false });
  },
};
export const deps: Deps = { fetch: (u, i) => fetch(u, { signal: AbortSignal.timeout(20000), ...i }), now: () => new Date(), env: (n) => Deno.env.get(n) ?? "", store };

