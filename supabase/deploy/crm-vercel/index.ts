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

// functions/_shared/vercel_demo.ts
var VercelError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var API = "https://api.vercel.com";
var DOMAINE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
function normaliserDomaine(x) {
  const d = String(x ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  return DOMAINE.test(d) ? d : "";
}
function cfg(d) {
  return { token: d.env("VERCEL_TOKEN") ?? "", projet: (d.env("VERCEL_PROJECT") || "crm-sanix").trim(), team: (d.env("VERCEL_TEAM_ID") ?? "").trim(), branche: (d.env("VERCEL_DEMO_BRANCH") || "demo").trim() };
}
async function appel(d, c, method, path, body) {
  const url = API + path + (c.team ? (path.includes("?") ? "&" : "?") + "teamId=" + encodeURIComponent(c.team) : "");
  const r = await d.fetch(url, { method, headers: { Authorization: "Bearer " + c.token, "Content-Type": "application/json" }, body: body === void 0 ? void 0 : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
var msg = (j, repli) => String(j?.error?.message || repli).slice(0, 300);
async function statut(d) {
  const c = cfg(d);
  if (!c.token) return { configure: false, projet: c.projet, branche: c.branche, domaines: [] };
  const r = await appel(d, c, "GET", `/v9/projects/${encodeURIComponent(c.projet)}/domains`);
  if (r.status !== 200) throw new VercelError(r.status === 401 || r.status === 403 ? 409 : 502, "Vercel a refus\xE9 la lecture des domaines : " + msg(r.j, String(r.status)));
  const domaines = (Array.isArray(r.j.domains) ? r.j.domains : []).map((x) => ({ nom: String(x.name), branche: x.gitBranch ? String(x.gitBranch) : null, verifie: x.verified !== false }));
  return { configure: true, projet: c.projet, branche: c.branche, domaines };
}
async function attacher(d, domaineBrut) {
  const c = cfg(d), nom = normaliserDomaine(domaineBrut);
  if (!nom) throw new VercelError(400, "Adresse invalide : saisissez par exemple sanix-demo.vercel.app");
  if (!c.token) throw new VercelError(412, "Vercel n'est pas reli\xE9 : ajoutez le secret VERCEL_TOKEN dans Supabase \u2192 Edge Functions \u2192 Secrets");
  if (nom === `${c.projet}.vercel.app`) throw new VercelError(409, "Cette adresse est celle de la production : choisissez-en une autre pour la d\xE9mo");
  const base = `/v10/projects/${encodeURIComponent(c.projet)}/domains`;
  let r = await appel(d, c, "POST", base, { name: nom, gitBranch: c.branche });
  if (r.status === 409 || r.j?.error?.code === "domain_already_in_use") {
    const ex = await appel(d, c, "GET", `/v9/projects/${encodeURIComponent(c.projet)}/domains/${encodeURIComponent(nom)}`);
    if (ex.status !== 200) throw new VercelError(409, "Ce domaine est d\xE9j\xE0 utilis\xE9 par un autre projet Vercel : " + msg(r.j, "conflit"));
    if (!ex.j.gitBranch) throw new VercelError(409, "Ce domaine sert la PRODUCTION : refus\xE9, il ne sera pas d\xE9plac\xE9 vers la branche " + c.branche);
    r = await appel(d, c, "PATCH", `/v9/projects/${encodeURIComponent(c.projet)}/domains/${encodeURIComponent(nom)}`, { gitBranch: c.branche });
  }
  if (r.status < 200 || r.status >= 300) throw new VercelError(r.status === 401 || r.status === 403 ? 409 : 502, "Vercel a refus\xE9 l'attribution : " + msg(r.j, String(r.status)));
  return { domaine: nom, branche: c.branche, verifie: r.j.verified !== false, verification: Array.isArray(r.j.verification) ? r.j.verification : [], url: "https://" + nom };
}

// functions/crm-vercel/index.ts
var deps = { env: (k) => Deno.env.get(k), fetch: (u, i) => fetch(u, i) };
function fail(req, e) {
  if (e instanceof HttpError || e instanceof VercelError) return json(req, { error: e.message }, e.status);
  console.error("crm-vercel", errMsg(e));
  return json(req, { error: "Erreur interne" }, 500);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "M\xE9thode non autoris\xE9e" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const op = await requireOperator(req);
    if (op.role !== "direction" && op.role !== "admin") throw new HttpError(403, "R\xE9serv\xE9 \xE0 la direction");
    if (action === "status") return json(req, await statut(deps));
    if (action === "attach") return json(req, { ok: true, ...await attacher(deps, String(body.domaine ?? "")) });
    throw new HttpError(400, "Action inconnue");
  } catch (e) {
    return fail(req, e);
  }
});
