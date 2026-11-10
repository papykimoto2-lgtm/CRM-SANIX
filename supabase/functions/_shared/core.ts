// Utilitaires communs : env, CORS, client Supabase service, auth opérateur, audit.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.0";

export function env(name: string, required = true): string {
  const v = Deno.env.get(name) ?? "";
  if (required && !v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://crm-sanix.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

let _db: SupabaseClient | null = null;
/** Client service_role : uniquement côté serveur (Edge Function). Jamais exposé au navigateur. */
export function db(): SupabaseClient {
  _db ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _db;
}

export type Operator = { user_id: string; nom: string; role: "direction" | "commercial" | "admin"; remise_max_pct: number };

/** Vérifie le JWT Supabase Auth et l'appartenance à ai_operators (Zero Trust). */
export async function requireOperator(req: Request): Promise<Operator> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Authentification requise");
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Session invalide");
  const { data: op } = await db().from("ai_operators")
    .select("user_id, nom, role, remise_max_pct").eq("user_id", data.user.id).eq("actif", true).maybeSingle();
  if (!op) throw new HttpError(403, "Accès réservé aux opérateurs commerciaux");
  return op as Operator;
}

/** Comparaison à temps constant (secrets cron / signatures). */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let r = 0;
  for (let i = 0; i < ea.length; i++) r |= ea[i] ^ eb[i];
  return r === 0;
}

let _cron: { v: string; at: number } | null = null;
/**
 * Secret du planificateur (en-tête x-cron-secret) : lu dans le Vault par la fonction SQL ai_cron_secret() (réservée au service,
 * créée par supabase/schedule_cron.sql), donc rien à recopier dans les secrets Edge. Repli : secret Edge CRON_SECRET (installations sans Vault).
 * Mémorisé 30 s : un flot de requêtes non authentifiées ne sollicite pas la base à chaque appel.
 */
export async function cronSecret(): Promise<string> {
  if (_cron && Date.now() - _cron.at < 30_000) return _cron.v;
  let v = "";
  try {
    const { data } = await db().rpc("ai_cron_secret");
    if (typeof data === "string") v = data;
  } catch { /* Vault absent : repli sur le secret Edge */ }
  if (!v) v = env("CRON_SECRET");
  _cron = { v, at: Date.now() };
  return v;
}
export function resetCronSecretCache(): void { _cron = null; }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type AuditRow = {
  agent: string; action: string; prospect_id?: string | null; mission_id?: string | null;
  agent_id?: string | null; task_id?: string | null;
  payload?: unknown; ok?: boolean; tokens_in?: number; tokens_out?: number; cout_usd?: number;
};

/** Journal d'audit append-only : ne doit jamais faire échouer l'appelant. */
export async function audit(row: AuditRow): Promise<void> {
  const { error } = await db().from("ai_actions").insert({ ...row, payload: row.payload ?? {} });
  if (error) console.error("audit", error.message);
}

/** Heure de Côte d'Ivoire (UTC+0, sans changement d'heure) : jour courant au format AAAA-MM-JJ. */
export function jourAbidjan(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function clip(v: unknown, max: number): string {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : (e && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message) : String(e);
}
