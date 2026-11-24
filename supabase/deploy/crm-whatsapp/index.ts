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
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function errMsg(e) {
  return e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
}

// functions/_shared/wacrm.ts
var LIMITE_PAR_JOUR = 150;
var FENETRE_MS = 24 * 36e5;
var VERSION_GRAPH = "v27.0";
var WaError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function normPhone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return /^[0-9]{8,15}$/.test(d) ? d : "";
}
function paramTexte(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 1024);
}
var graph = (d) => "https://graph.facebook.com/" + (d.env("WHATSAPP_GRAPH_VERSION") || VERSION_GRAPH);
function etat(d) {
  const manquants = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"].filter((n) => !d.env(n));
  return { configure: manquants.length === 0, manquants, webhook: !!(d.env("WHATSAPP_VERIFY_TOKEN") && d.env("WHATSAPP_APP_SECRET")) };
}
function exigerConfig(d) {
  const e = etat(d);
  if (!e.configure) throw new WaError(503, "WhatsApp n'est pas configur\xE9 : secret(s) absent(s) \u2014 " + e.manquants.join(", ") + " (voir supabase/WHATSAPP.md)");
  return { token: d.env("WHATSAPP_TOKEN"), phoneId: d.env("WHATSAPP_PHONE_NUMBER_ID") };
}
async function garde(d, phone, sinceDup) {
  const now = d.now();
  if (await d.store.isOptedOut(phone)) throw new WaError(409, "Ce num\xE9ro a demand\xE9 \xE0 ne plus \xEAtre contact\xE9 (STOP) : envoi interdit");
  if (await d.store.countSentSince(new Date(now.getTime() - 24 * 36e5).toISOString()) >= LIMITE_PAR_JOUR) throw new WaError(429, `Plafond de ${LIMITE_PAR_JOUR} messages WhatsApp par 24 h atteint`);
  if (sinceDup && await d.store.recentDuplicate(phone, sinceDup.template, new Date(now.getTime() - 24 * 36e5).toISOString())) throw new WaError(409, "Ce mod\xE8le a d\xE9j\xE0 \xE9t\xE9 envoy\xE9 \xE0 ce num\xE9ro dans les derni\xE8res 24 h");
}
async function poster(d, phoneId, token, payload) {
  const r = await d.fetch(`${graph(d)}/${encodeURIComponent(phoneId)}/messages`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  const wamid = j?.messages?.[0]?.id;
  if (!r.ok || !wamid) return { ok: false, status: r.status, message: String(j?.error?.error_data?.details || j?.error?.message || r.status).slice(0, 300) };
  return { ok: true, wamid: String(wamid) };
}
async function sendTemplate(d, op, i) {
  if (i.consent !== true) throw new WaError(400, "Confirmez que le destinataire a accept\xE9 d'\xEAtre contact\xE9 sur WhatsApp");
  const to = normPhone(i.to);
  if (!to) throw new WaError(400, "Num\xE9ro WhatsApp invalide");
  const template = String(i.template ?? "").trim();
  if (!/^[a-z0-9_]{1,512}$/.test(template)) throw new WaError(400, "Nom de mod\xE8le invalide (minuscules, chiffres et _ uniquement)");
  const lang = String(i.lang ?? "fr").trim();
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(lang)) throw new WaError(400, "Langue du mod\xE8le invalide");
  const params = (Array.isArray(i.params) ? i.params : []).slice(0, 10).map(paramTexte);
  if (params.some((p) => !p)) throw new WaError(400, "Une variable du mod\xE8le est vide : le message n'est pas pr\xEAt");
  const preview = String(i.preview ?? "").trim();
  if (!preview || preview.length > 4096) throw new WaError(400, "Texte du message vide ou trop long");
  const { token, phoneId } = exigerConfig(d);
  await garde(d, to, { template });
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: { name: template, language: { code: lang }, ...params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {} }
  };
  const base = { client_rid: i.client_rid ?? null, to_phone: to, kind: "template", template, body: preview, sent_by: op.nom, sent_by_user: op.user_id, consent_by: op.nom, wa_message_id: null, status: "envoye", error: null };
  const r = await poster(d, phoneId, token, payload);
  if (!r.ok) {
    await d.store.insertMessage({ ...base, status: "echec", error: r.message });
    throw new WaError(r.status === 401 || r.status === 403 ? 409 : 502, "WhatsApp a refus\xE9 l'envoi : " + r.message);
  }
  const id = await d.store.insertMessage({ ...base, wa_message_id: r.wamid });
  if (i.client_rid) await d.store.addInteraction(i.client_rid, { date: d.now().toISOString(), type: "Message WhatsApp", note: "Mod\xE8le \xAB " + template + " \xBB envoy\xE9", ico: "\u{1F4AC}", source: "whatsapp" }).catch(() => {
  });
  await d.store.syncProspectOutbound?.(i.client_rid ?? null, to, d.now().toISOString()).catch(() => {
  });
  return { id, wa_message_id: r.wamid };
}
async function sendText(d, op, i) {
  const to = normPhone(i.to);
  if (!to) throw new WaError(400, "Num\xE9ro WhatsApp invalide");
  const text = String(i.text ?? "").trim();
  if (!text || text.length > 4096) throw new WaError(400, "Message vide ou trop long (4 096 caract\xE8res maximum)");
  const { token, phoneId } = exigerConfig(d);
  const last = await d.store.lastInboundAt(to);
  if (!last || d.now().getTime() - Date.parse(last) >= FENETRE_MS) throw new WaError(409, "La fen\xEAtre de 24 h est ferm\xE9e (le prospect n'a pas \xE9crit depuis plus de 24 h) : seul un mod\xE8le approuv\xE9 peut \xEAtre envoy\xE9");
  await garde(d, to);
  const base = { client_rid: i.client_rid ?? null, to_phone: to, kind: "text", template: null, body: text, sent_by: op.nom, sent_by_user: op.user_id, consent_by: null, wa_message_id: null, status: "envoye", error: null };
  const r = await poster(d, phoneId, token, { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } });
  if (!r.ok) {
    await d.store.insertMessage({ ...base, status: "echec", error: r.message });
    throw new WaError(r.status === 401 || r.status === 403 ? 409 : 502, "WhatsApp a refus\xE9 l'envoi : " + r.message);
  }
  const id = await d.store.insertMessage({ ...base, wa_message_id: r.wamid });
  if (i.client_rid) await d.store.addInteraction(i.client_rid, { date: d.now().toISOString(), type: "Message WhatsApp", note: "R\xE9ponse envoy\xE9e", ico: "\u{1F4AC}", source: "whatsapp" }).catch(() => {
  });
  await d.store.syncProspectOutbound?.(i.client_rid ?? null, to, d.now().toISOString()).catch(() => {
  });
  return { id, wa_message_id: r.wamid };
}

// functions/_shared/wacrm_store.ts
var store = {
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
  async insertMessage(m) {
    const { data, error } = await db().from("crm_wa_messages").insert(m).select("id").single();
    if (error) throw new WaError(500, "Journal des messages indisponible : " + error.message);
    return data.id;
  },
  async getByWamid(wamid) {
    const { data } = await db().from("crm_wa_messages").select("*").eq("wa_message_id", wamid).maybeSingle();
    return data ?? null;
  },
  async updateById(id, patch) {
    await db().from("crm_wa_messages").update(patch).eq("id", id);
  },
  async recentOutbound(phone, sinceIso) {
    const { data } = await db().from("crm_wa_messages").select("client_rid").eq("to_phone", phone).neq("status", "echec").gte("sent_at", sinceIso).order("sent_at", { ascending: false }).limit(1).maybeSingle();
    return data ? { client_rid: data.client_rid ?? null } : null;
  },
  async insertInbound(r) {
    const { error } = await db().from("crm_wa_inbound").insert(r);
    if (error?.code === "23505") return false;
    if (error) throw new WaError(500, "Enregistrement de la r\xE9ponse impossible : " + error.message);
    return true;
  },
  async setOptOut(phone, source) {
    await db().from("crm_wa_optout").upsert({ phone, source, since: (/* @__PURE__ */ new Date()).toISOString() });
  },
  async syncProspectOutbound(clientRid, phone, at) {
    let rows = [];
    if (clientRid) {
      const r = await db().from("ai_prospects").select("id,stage").eq("crm_rid", clientRid).limit(2);
      rows = r.data ?? [];
    }
    if (rows.length === 0 && phone) {
      const r = await db().from("ai_prospects").select("id,stage").eq("phone_norm", phone).limit(2);
      rows = r.data ?? [];
    }
    if (rows.length !== 1) return;
    const p = rows[0];
    await db().from("ai_prospects").update({ last_outbound_at: at, ...(["identifie", "enregistre", "qualifie"].includes(p.stage) ? { stage: "premier_contact" } : {}) }).eq("id", p.id);
  },
  async syncProspectInbound(clientRid, phone, at, optOut = false) {
    let rows = [];
    if (clientRid) {
      const r = await db().from("ai_prospects").select("id,stage").eq("crm_rid", clientRid).limit(2);
      rows = r.data ?? [];
    }
    if (rows.length === 0 && phone) {
      const r = await db().from("ai_prospects").select("id,stage").eq("phone_norm", phone).limit(2);
      rows = r.data ?? [];
    }
    if (rows.length !== 1) return;
    const p = rows[0];
    await db().from("ai_prospects").update({ last_inbound_at: at, relances_sans_reponse: 0, ...(optOut ? { opt_out: true, opt_out_at: at } : p.stage === "premier_contact" ? { stage: "conversation" } : {}) }).eq("id", p.id);
  },
  async addInteraction(clientRid, interaction) {
    const { data } = await db().from("crm_records").select("rid").eq("entity", "clients").eq("rid", clientRid).is("deleted_at", null).maybeSingle();
    if (!data) return;
    await db().rpc("crm_put", { p_entity: "clients", p_rid: clientRid, p_patch: { interactions: [interaction] }, p_origin: "ia", p_actor: "whatsapp", p_protect: false, p_base: null, p_client_ts: null, p_natural: false });
  }
};
var deps = { fetch: (u, i) => fetch(u, { signal: AbortSignal.timeout(2e4), ...i }), now: () => /* @__PURE__ */ new Date(), env: (n) => Deno.env.get(n) ?? "", store };

// functions/crm-whatsapp/index.ts
function fail(req, e) {
  if (e instanceof HttpError || e instanceof WaError) return json(req, { error: e.message }, e.status);
  console.error("crm-whatsapp", errMsg(e));
  return json(req, { error: "Erreur interne" }, 500);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "M\xE9thode non autoris\xE9e" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const op = await requireOperator(req);
    if (action === "status") return json(req, etat(deps));
    if (action === "send_template") {
      const r = await sendTemplate(deps, op, {
        client_rid: typeof body.client_rid === "string" ? body.client_rid.slice(0, 80) : null,
        to: String(body.to ?? ""),
        template: String(body.template ?? ""),
        lang: typeof body.lang === "string" ? body.lang : "fr",
        params: Array.isArray(body.params) ? body.params : [],
        preview: String(body.preview ?? ""),
        consent: body.consent === true
      });
      return json(req, { ok: true, ...r });
    }
    if (action === "send_text") {
      const r = await sendText(deps, op, { client_rid: typeof body.client_rid === "string" ? body.client_rid.slice(0, 80) : null, to: String(body.to ?? ""), text: String(body.text ?? "") });
      return json(req, { ok: true, ...r });
    }
    throw new HttpError(400, "Action inconnue");
  } catch (e) {
    return fail(req, e);
  }
});
