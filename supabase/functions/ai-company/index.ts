// SANIX AI VIRTUAL COMPANY — point d'entrée unique.
//  Président (JWT opérateur « direction ») : instruction · assign_mission · request_report · report_now · report_resend
//  Planificateur (x-cron-secret)           : tick (chaque minute) · report_tick (toutes les 5 minutes)
import { audit, clip, cors, db, env, errMsg, HttpError, json, requireOperator, safeEqual } from "../_shared/core.ts";
import { BudgetError, TransientLlmError } from "../_shared/llm.ts";
import { createInstructionTask, runTask } from "../_shared/company/engine.ts";
import { assignMission, requestReport } from "../_shared/company/president.ts";
import { runBudgetMs, tickCompany } from "../_shared/company/tick.ts";
import { generateAndSend, reportTick, resend } from "../_shared/reports/builder.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const REPORT_TYPES = ["quotidien", "hebdomadaire", "mensuel"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "tick" || action === "report_tick") {
      if (!safeEqual(req.headers.get("x-cron-secret") ?? "", env("CRON_SECRET"))) throw new HttpError(401, "Non autorisé");
      if (action === "tick") {
        const { work, ...res } = await tickCompany();
        EdgeRuntime.waitUntil(work);
        return json(req, res, 202);
      }
      EdgeRuntime.waitUntil(reportTick().catch((e) => audit({ agent: "rapport", action: "report_tick_erreur", ok: false, payload: { e: errMsg(e) } })));
      return json(req, { ok: true }, 202);
    }

    const op = await requireOperator(req);
    if (op.role === "commercial") throw new HttpError(403, "Réservé à la direction");

    if (action === "instruction") {
      const contenu = typeof body.contenu === "string" ? body.contenu.trim() : "";
      if (contenu.length < 3) throw new HttpError(400, "Instruction trop courte");
      if (contenu.length > 4000) throw new HttpError(400, "Instruction trop longue (4 000 caractères maximum)");

      const { data: b } = await db().rpc("ai_budget_check", { p_agent: null });
      if (b && b.ok === false) {
        await db().from("ai_executive_messages").insert({ user_id: op.user_id, auteur: "president", contenu });
        await db().from("ai_executive_messages").insert({ auteur: "directeur",
          contenu: `⚠️ Je ne peux pas traiter cette instruction : ${b.raison}. Ajustez les budgets ou réactivez l'entreprise dans Gouvernance, puis renvoyez votre instruction.` });
        return json(req, { ok: false, raison: b.raison }, 200);
      }
      const r = await createInstructionTask(contenu, op.user_id);
      if ("erreur" in r) throw new HttpError(409, r.erreur);
      await db().from("ai_executive_messages").insert({ user_id: op.user_id, auteur: "president", contenu, task_id: r.task_id });
      await audit({ agent: "president", action: "instruction", task_id: r.task_id, payload: { par: op.user_id, apercu: clip(contenu, 200) } });
      EdgeRuntime.waitUntil(runTask(r.task_id, { deadline: Date.now() + runBudgetMs() }).catch((e) =>
        audit({ agent: "director", action: "instruction_erreur", task_id: r.task_id, ok: false, payload: { e: errMsg(e) } })));
      return json(req, { ok: true, task_id: r.task_id }, 202);
    }

    if (action === "assign_mission") return json(req, await assignMission(op, body), 201);
    if (action === "request_report") return json(req, await requestReport(op, body), 201);

    if (action === "report_now") {
      const type = REPORT_TYPES.find((t) => t === body.type);
      if (!type) throw new HttpError(400, "Type de rapport invalide");
      return json(req, await generateAndSend(type));
    }

    if (action === "report_resend") {
      if (typeof body.id !== "string" || !UUID.test(body.id)) throw new HttpError(400, "Identifiant invalide");
      return json(req, await resend(body.id));
    }

    throw new HttpError(400, "Action inconnue");
  } catch (e) {
    if (e instanceof BudgetError) return json(req, { error: e.message }, 429);
    if (e instanceof TransientLlmError) return json(req, { error: "Service IA momentanément indisponible, réessayez" }, 503);
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json(req, { error: status === 500 ? "Erreur interne" : (e as Error).message }, status);
  }
});
