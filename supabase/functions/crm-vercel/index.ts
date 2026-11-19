// SANIX CRM — adresse de la démo : attribue un domaine à la branche Git « demo » du projet Vercel.
//  POST status | attach {domaine} : JWT opérateur « direction » ou « admin » (Verify JWT désactivé : l'authentification est faite ici).
// Secret Edge : VERCEL_TOKEN (à saisir dans le tableau de bord Supabase) ; facultatifs : VERCEL_PROJECT, VERCEL_TEAM_ID, VERCEL_DEMO_BRANCH.
import { cors, errMsg, HttpError, json, requireOperator } from "../_shared/core.ts";
import { attacher, statut, VercelError } from "../_shared/vercel_demo.ts";

const deps = { env: (k: string) => Deno.env.get(k), fetch: (u: string | URL | Request, i?: RequestInit) => fetch(u, i) } as { env: (k: string) => string | undefined; fetch: typeof fetch };

function fail(req: Request, e: unknown): Response {
  if (e instanceof HttpError || e instanceof VercelError) return json(req, { error: e.message }, e.status);
  console.error("crm-vercel", errMsg(e));
  return json(req, { error: "Erreur interne" }, 500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const op = await requireOperator(req);
    if (op.role !== "direction" && op.role !== "admin") throw new HttpError(403, "Réservé à la direction");
    if (action === "status") return json(req, await statut(deps));
    if (action === "attach") return json(req, { ok: true, ...(await attacher(deps, String(body.domaine ?? ""))) });
    throw new HttpError(400, "Action inconnue");
  } catch (e) { return fail(req, e); }
});
