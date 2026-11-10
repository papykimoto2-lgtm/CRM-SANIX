// Moteur d'exécution d'une mission par un collaborateur IA.
//  claim (SQL, atomique) → brief → boucle d'outils bornée → clôture / mise en attente / report.
// Garde-fous : budget (llm.ts), plafond de tours, échéance d'exécution, nombre d'essais (SQL), suspension automatique.
import type Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { audit, clip, db, errMsg } from "../core.ts";
import { BudgetError, callClaude, textOf, TransientLlmError } from "../llm.ts";
import { loadPortfolio } from "../catalogue.ts";
import { commercialRules, charterToText, COMPANY_RULES, DG_RULES, MANAGER_METHOD } from "../prompts.ts";
import { CRM_TOOL_NAMES, type CrmCtx, uuidsIn } from "../crm_tools.ts";
import { type AgentRow, loadGovernance, OPEN_STATES, Org, type TaskRow } from "./org.ts";
import { type CoCtx, runCompanyTool, toolsFor } from "./tools.ts";
import { flushMoves, Presence, publishActivity } from "./presence.ts";

export type RunOutcome = "terminee" | "bloquee" | "attente" | "reportee" | "echec" | "ignoree";

async function setActivite(agentId: string, activite: string): Promise<void> {
  await db().from("ai_agents").update({ activite }).eq("id", agentId).not("activite", "eq", "en_reunion");
}

export async function incidentOnce(type: string, gravite: string, message: string, fenetreMs: number): Promise<void> {
  const { data } = await db().from("ai_incidents").select("id").eq("type", type)
    .gte("created_at", new Date(Date.now() - fenetreMs).toISOString()).limit(1);
  if (data?.length) return;
  await db().rpc("ai_register_incident", { p_agent: null, p_task: null, p_type: type, p_gravite: gravite, p_message: message, p_echec: false });
}

// ─── Prompt système ────────────────────────────────────────────────
export async function systemPrompt(agent: AgentRow): Promise<string> {
  const { data: ch } = await db().from("ai_agent_charters").select("contenu, version").eq("agent_id", agent.id)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  const hasCrm = agent.outils.some((t) => CRM_TOOL_NAMES.includes(t));
  const manager = agent.niveau <= 4 && agent.outils.includes("assigner_mission");
  return [
    `Tu es ${agent.nom}, ${agent.fonction}, collaborateur IA de SANIX AI VIRTUAL COMPANY.`,
    agent.personnalite ? `Personnalité professionnelle : ${agent.personnalite}` : "",
    agent.specialite ? `Spécialité : ${agent.specialite}` : "",
    COMPANY_RULES,
    manager ? MANAGER_METHOD : "",
    agent.niveau === 1 ? DG_RULES : "",
    hasCrm ? commercialRules(await loadPortfolio()) : "",
    `CAHIER DES CHARGES (version ${ch?.version ?? 0})\n${charterToText(ch?.contenu)}`,
  ].filter(Boolean).join("\n\n");
}

// ─── Brief de mission ──────────────────────────────────────────────
type Brief = { text: string; seeds: string[] };

async function buildBrief(ctx: CoCtx): Promise<Brief> {
  const { agent, task, org, gov } = ctx;
  const seeds: string[] = [task.titre, task.description, task.entrees ?? ""];
  const L: string[] = [];
  const maintenant = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Abidjan", dateStyle: "full", timeStyle: "short" });
  const donneur = task.donneur_agent_id ? org.byId(task.donneur_agent_id)?.nom ?? "un collègue" : "le Président";

  L.push(`## Mission${task.type === "instruction" ? " (instruction du Président)" : ""}`);
  L.push(`Date : ${maintenant} (Abidjan) · Priorité ${task.priorite}/5${task.echeance ? ` · Échéance : ${new Date(task.echeance).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })}` : ""} · Donneur d'ordre : ${donneur}`);
  L.push(`Titre : ${task.titre}\n${task.description}`);
  if (task.objectifs?.length) L.push(`Objectifs :\n${task.objectifs.map((o) => `- ${o}`).join("\n")}`);
  if (task.entrees) L.push(`Données transmises :\n<donnees_transmises>\n${clip(task.entrees, 12000)}\n</donnees_transmises>`);

  // Chaîne de mission : le « pourquoi » de la tâche
  const chain: string[] = [];
  let cur: string | null = task.parent_id;
  for (let n = 0; cur && n < 5; n++) {
    const { data: p } = await db().from("ai_agent_tasks").select("id, parent_id, titre, description, agent_id").eq("id", cur).maybeSingle();
    if (!p) break;
    chain.push(`- ${org.byId(p.agent_id)?.nom ?? "?"} : ${p.titre} — ${clip(p.description, 300)}`);
    cur = p.parent_id;
  }
  if (chain.length) L.push(`Contexte hiérarchique (du plus proche au plus lointain) :\n${chain.join("\n")}`);

  // Résultats des étapes préalables (dépendances)
  const { data: deps } = await db().from("ai_task_dependencies").select("depend_de").eq("task_id", task.id);
  if (deps?.length) {
    const { data: prev } = await db().from("ai_agent_tasks").select("titre, statut, rapport, resultats, agent_id").in("id", deps.map((d) => d.depend_de));
    const blocks = (prev ?? []).map((t) => {
      seeds.push(t.rapport ?? "", ...(Array.isArray(t.resultats) ? t.resultats : []));
      return `<donnees_transmises>\n${org.byId(t.agent_id)?.nom ?? "?"} — ${t.titre} (${t.statut})\n${clip(t.rapport ?? "", 3000)}\n${(Array.isArray(t.resultats) ? t.resultats : []).map((r) => `• ${r}`).join("\n")}\n</donnees_transmises>`;
    });
    L.push(`Résultats des étapes préalables :\n${blocks.join("\n")}`);
  }

  // Reprise : travail déjà accompli
  if (task.progression) L.push(`Travail déjà accompli (reprise de mission) :\n${clip(task.progression, 4000)}`);
  const { data: kids } = await db().from("ai_agent_tasks").select("id, titre, agent_id, statut, rapport, evaluation, priorite")
    .eq("parent_id", task.id).order("created_at");
  if (kids?.length) {
    L.push("Sous-missions déjà créées (ne les recrée pas) :\n" + kids.map((k) => {
      seeds.push(k.rapport ?? "");
      const rap = k.rapport ? `\n  <donnees_transmises>${clip(k.rapport, 1500)}</donnees_transmises>` : "";
      return `- [${k.id}] ${org.byId(k.agent_id)?.code ?? "?"} · ${k.titre} · ${k.statut}${k.evaluation != null ? ` · note ${k.evaluation}/100` : ""}${rap}`;
    }).join("\n"));
  }
  const { data: mt } = await db().from("ai_agent_meetings").select("titre, statut, id").eq("task_id", task.id);
  for (const m of mt ?? []) {
    if (m.statut !== "terminee") { L.push(`Réunion « ${m.titre} » : ${m.statut}.`); continue; }
    const { data: pv } = await db().from("ai_meeting_minutes").select("synthese, decisions").eq("meeting_id", m.id).maybeSingle();
    if (pv) L.push(`Procès-verbal de la réunion « ${m.titre} » :\n${clip(pv.synthese, 3000)}\nDécisions : ${clip(pv.decisions, 1500)}`);
  }

  // Courrier interne non lu
  const { data: inbox } = await db().from("ai_agent_communications").select("id, de_agent_id, type, objet, contenu, created_at")
    .eq("vers_agent_id", agent.id).is("lu_at", null).order("created_at").limit(10);
  if (inbox?.length) {
    L.push("Courrier interne non lu :\n" + inbox.map((c) => `- [${c.type}] ${org.byId(c.de_agent_id ?? "")?.nom ?? "Système"} : ${c.objet}\n  <donnees_transmises>${clip(c.contenu, 800)}</donnees_transmises>`).join("\n"));
    await db().from("ai_agent_communications").update({ lu_at: new Date().toISOString() }).in("id", inbox.map((c) => c.id));
  }

  // Mémoire pertinente
  const { data: mem } = await db().rpc("ai_memory_search", { p_agent: agent.id, p_q: task.titre, p_n: 5 });
  if (mem?.length) L.push("Mémoire pertinente :\n" + mem.map((m: { contenu: string; partage: boolean }) => `- ${m.partage ? "[partagé] " : ""}${clip(m.contenu, 400)}`).join("\n"));

  // Direction : organisation, capacité, historique de la conversation avec le président
  if (agent.outils.includes("assigner_mission") || agent.outils.includes("creer_agent")) {
    const { data: open } = await db().from("ai_agent_tasks").select("agent_id").in("statut", [...OPEN_STATES]).limit(2000);
    const charge = new Map<string, number>();
    for (const t of open ?? []) charge.set(t.agent_id, (charge.get(t.agent_id) ?? 0) + 1);
    const lignes = org.agents.slice(0, 90).map((a) =>
      `${a.code} | ${a.nom} | ${a.fonction} | ${a.departement_id} | N${a.niveau} | ${a.etat}/${a.activite} | chef : ${org.byId(a.manager_id)?.code ?? "—"} | missions ouvertes : ${charge.get(a.id) ?? 0}${a.temporaire ? " | temporaire" : ""}`);
    L.push(`Organisation actuelle (${org.agents.length} agents) :\n${lignes.join("\n")}`);
    const { data: st } = await db().rpc("ai_budget_status");
    if (st) {
      L.push(`Gouvernance : agents actifs ${st.agents_actifs}/${st.max_agents_actifs} · créations aujourd'hui ${st.creations_jour}/${st.max_creations_jour} · missions actives ${st.missions_actives}/${st.max_missions_actives} · budget IA du jour ${st.jour_usd}/${st.budget_jour_usd} $ · du mois ${st.mois_usd}/${st.budget_mois_usd} $ · plafond par agent ${gov.budget_agent_jour_usd} $/jour · création autonome : ${gov.creation_autonome ? "oui" : "non (validation du président)"} · communication externe : ${gov.communication_externe}.`);
    }
  }
  if (task.type === "instruction") {
    const { data: hist } = await db().from("ai_executive_messages").select("auteur, contenu, created_at").order("created_at", { ascending: false }).limit(12);
    if (hist?.length) L.push("Conversation récente avec le Président (du plus ancien au plus récent) :\n" + hist.reverse().map((h) => `${h.auteur === "president" ? "Président" : "Toi"} : ${clip(h.contenu, 1200)}`).join("\n"));
  }
  L.push("Exécute cette mission avec tes outils, puis clôture par terminer_mission (ou attendre_sous_taches si tu attends tes subordonnés).");
  return { text: L.join("\n\n"), seeds };
}

// ─── Boucle d'exécution ────────────────────────────────────────────
type Loop = { kind: "fini" } | { kind: "parque" } | { kind: "texte"; text: string } | { kind: "deadline" } | { kind: "tours" } | { kind: "refusal" };

export async function runTask(taskId: string, opts: { deadline: number }): Promise<RunOutcome> {
  const { data: t } = await db().from("ai_agent_tasks").select("*").eq("id", taskId).maybeSingle();
  const task = t as TaskRow & { cout_usd?: number } | null;
  if (!task || task.statut !== "en_cours") return "ignoree";
  const [org, gov] = await Promise.all([Org.load(), loadGovernance()]);
  const agent = org.byId(task.agent_id);
  if (!agent || agent.etat !== "actif") {
    await db().from("ai_agent_tasks").update({ statut: "bloquee", progression: clip(`${task.progression ?? ""}\n[Système] Agent indisponible`, 8000) }).eq("id", task.id);
    return "bloquee";
  }
  const { data: deps } = await db().from("ai_departments").select("id, nom, responsable_id").order("ordre");
  const crm: CrmCtx = {
    agentLabel: `agent:${agent.code}`, agentId: agent.id, scope: new Set(), taskId: task.id, missionId: null,
    createCap: 100, created: 0, source: `agent:${agent.code}`,
  };
  const ctx: CoCtx = { agent, task, org, gov, departments: deps ?? [], crm, journal: [], posted: [], acted: false, memWrites: 0,
    presence: new Presence(agent.id, task.id), moves: [], assigned: new Set() };
  let cout = 0;
  await setActivite(agent.id, "en_analyse");
  try {
    const system = await systemPrompt(agent);
    const brief = await buildBrief(ctx);
    for (const id of uuidsIn(...brief.seeds)) crm.scope.add(id);
    const tools = toolsFor(agent, ctx.departments.map((d) => d.id));
    await ctx.presence!.activity("consultation_documents");   // lecture de la mission
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: brief.text }];
    let activiteMission = false, relances = 0;
    const result = await (async (): Promise<Loop> => {
      for (let turn = 0; turn < gov.max_tours_execution; turn++) {
        if (Date.now() > opts.deadline) return { kind: "deadline" };
        const { message: res, cost } = await callClaude({
          label: `agent:${agent.code}`, agentId: agent.id, taskId: task.id, system, messages, tools, effort: agent.effort,
        });
        cout += cost;
        // Recherche web (outil serveur) : l'agent consulte des sources → animation d'écran
        if (res.content.some((b) => (b as { type: string; name?: string }).type === "server_tool_use" && (b as { name?: string }).name === "web_search")) {
          await ctx.presence!.activity(agent.outils.includes("create_prospect") ? "recherche_prospects" : "recherche_web");
        }
        if (res.stop_reason === "refusal") return { kind: "refusal" };
        messages.push({ role: "assistant", content: res.content });
        if (res.stop_reason === "pause_turn") continue;
        if (res.stop_reason === "max_tokens") { messages.push({ role: "user", content: "Ta réponse a été tronquée. Reprends en étant plus concis." }); continue; }
        const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (res.stop_reason !== "tool_use" || !uses.length) {
          if (task.type !== "instruction" && relances < 2) {   // une mission ne se clôt jamais par une simple réponse écrite
            relances++;
            messages.push({ role: "user", content: "Tu n'as pas clôturé ta mission. Appelle terminer_mission : statut « terminee » avec un rapport factuel et au moins un résultat vérifiable (livrable, chiffre, identifiant), ou statut « bloquee » avec la raison précise." });
            continue;
          }
          return { kind: "texte", text: textOf(res) };
        }

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const u of uses) {   // séquentiel : l'ordre des écritures compte (créer l'agent avant de lui confier une mission)
          try {
            const out = await runCompanyTool(ctx, u.name, (u.input ?? {}) as Record<string, any>);
            await audit({ agent: `agent:${agent.code}`, action: u.name, agent_id: agent.id, task_id: task.id, payload: { input: clip(u.input, 1500) } });
            results.push({ type: "tool_result", tool_use_id: u.id, content: clip(out ?? null, 30000) });
          } catch (e) {
            const msg = errMsg(e);
            await audit({ agent: `agent:${agent.code}`, action: u.name, agent_id: agent.id, task_id: task.id, ok: false, payload: { input: clip(u.input, 1500), erreur: msg } });
            results.push({ type: "tool_result", tool_use_id: u.id, content: msg, is_error: true });
          }
        }
        await flushMoves(agent, ctx.moves!, ctx.assigned!, task.id);   // déplacements du tour (visites, cadrage, supervision)
        if (ctx.acted && !activiteMission) { activiteMission = true; await setActivite(agent.id, "en_mission"); }
        if (ctx.finish) return { kind: "fini" };
        if (ctx.parked) return { kind: "parque" };
        messages.push({ role: "user", content: results });
      }
      return { kind: "tours" };
    })();
    return await finalize(ctx, result);
  } catch (e) {
    return await onError(ctx, e);
  } finally {
    if (cout > 0) await db().from("ai_agent_tasks").update({ cout_usd: Number(((task.cout_usd ?? 0) + cout).toFixed(6)) }).eq("id", task.id);
  }
}

async function saveJournal(ctx: CoCtx, extra = ""): Promise<string> {
  const lignes = ctx.journal.slice(-25).join("\n");
  return clip(`${ctx.task.progression ?? ""}\n${extra}${lignes ? `\n${lignes}` : ""}`.trim(), 8000);
}

async function finalize(ctx: CoCtx, r: Loop): Promise<RunOutcome> {
  const { agent, task } = ctx;

  if (r.kind === "fini" || r.kind === "texte") {
    // Fin par simple texte : acceptée seulement pour un échange avec le président (instruction), avec la mention honnête qu'aucune action n'a été exécutée ;
    // pour une mission, c'est un blocage (jamais « terminée » sans résultat structuré).
    const f = r.kind === "fini" ? ctx.finish!
      : task.type === "instruction"
        ? { statut: "terminee" as const, rapport: r.text || "Réponse transmise.", resultats: ctx.acted ? [] as string[] : ["Réponse conversationnelle : aucune action n'a été exécutée"] }
        : { statut: "bloquee" as const, rapport: `Clôture sans résultat structuré : l'agent a répondu par texte sans appeler terminer_mission.\nDernière réponse : ${clip(r.text || "(vide)", 3000)}`, resultats: [] as string[] };
    await db().from("ai_agent_tasks").update({
      statut: f.statut, rapport: f.rapport, resultats: f.resultats, progression: await saveJournal(ctx),
    }).eq("id", task.id);
    const ok = f.statut === "terminee";
    await db().from("ai_agents").update({ incidents_consecutifs: ok ? 0 : agent.incidents_consecutifs, activite: ok ? "mission_terminee" : "en_difficulte" })
      .eq("id", agent.id).not("activite", "eq", "en_reunion");
    await publishActivity(agent.id, ok ? "mission_terminee" : "en_difficulte", task.id);
    if (task.donneur_agent_id) {
      await db().from("ai_agent_communications").insert({
        de_agent_id: agent.id, vers_agent_id: task.donneur_agent_id, task_id: task.id, type: ok ? "rapport" : "alerte",
        objet: `${ok ? "Rapport" : "Mission bloquée"} : ${clip(task.titre, 150)}`, contenu: clip(f.rapport, 8000),
      });
    } else if (task.type === "instruction" && f.rapport.trim() !== (ctx.posted.at(-1) ?? "").trim()) {
      await db().from("ai_executive_messages").insert({ auteur: "directeur", contenu: clip(f.rapport, 20000), task_id: task.id });
    }
    if (!ok && agent.manager_id && agent.manager_id !== task.donneur_agent_id) {
      await db().from("ai_agent_communications").insert({ de_agent_id: agent.id, vers_agent_id: agent.manager_id, task_id: task.id, type: "alerte",
        objet: `Mission bloquée : ${clip(task.titre, 150)}`, contenu: clip(f.rapport, 4000) });
    }
    return ok ? "terminee" : "bloquee";
  }

  if (r.kind === "parque") {
    await db().from("ai_agent_tasks").update({ progression: await saveJournal(ctx) }).eq("id", task.id);
    await db().from("ai_agents").update({ activite: ctx.parked === "attente_validation" ? "attente_validation" : "en_mission" })
      .eq("id", agent.id).not("activite", "eq", "en_reunion");
    await publishActivity(agent.id, "attente", task.id);
    return "attente";
  }

  if (r.kind === "refusal") {
    await db().from("ai_agent_tasks").update({ statut: "bloquee", progression: await saveJournal(ctx, "[Système] Requête refusée par les contrôles de sécurité du modèle.") }).eq("id", task.id);
    await db().rpc("ai_register_incident", { p_agent: agent.id, p_task: task.id, p_type: "refus_modele", p_gravite: "attention",
      p_message: `Mission « ${clip(task.titre, 120)} » refusée par le modèle : reformuler ou traiter manuellement`, p_echec: false });
    if (agent.manager_id) await db().from("ai_agent_communications").insert({ de_agent_id: agent.id, vers_agent_id: agent.manager_id, task_id: task.id,
      type: "alerte", objet: `Mission refusée par le modèle : ${clip(task.titre, 120)}`, contenu: "Reformuler la mission ou la traiter manuellement." });
    await db().from("ai_agents").update({ activite: "en_difficulte" }).eq("id", agent.id).not("activite", "eq", "en_reunion");
    await publishActivity(agent.id, "en_difficulte", task.id);
    return "bloquee";
  }

  // deadline | tours : reprise au prochain passage (les essais sont comptés côté SQL)
  await db().from("ai_agent_tasks").update({
    statut: "a_faire",
    progression: await saveJournal(ctx, r.kind === "deadline" ? "[Système] Échéance d'exécution atteinte : reprise." : "[Système] Nombre maximal de tours atteint : reprise."),
  }).eq("id", task.id);
  await db().from("ai_agents").update({ activite: ctx.acted ? "en_mission" : "disponible" }).eq("id", agent.id).not("activite", "eq", "en_reunion");
  await publishActivity(agent.id, "disponible", task.id);
  return "reportee";
}

async function onError(ctx: CoCtx, e: unknown): Promise<RunOutcome> {
  const { agent, task } = ctx;
  const release = async (note: string, rendreEssai: boolean) => {
    await db().from("ai_agent_tasks").update({
      statut: "a_faire", executions: rendreEssai ? Math.max(0, task.executions - 1) : task.executions,
      progression: await saveJournal(ctx, note),
    }).eq("id", task.id);
    await db().from("ai_agents").update({ activite: ctx.acted ? "en_mission" : "disponible" }).eq("id", agent.id).not("activite", "eq", "en_reunion");
    await publishActivity(agent.id, "disponible", task.id);
  };
  if (e instanceof BudgetError) {
    await release(`[Système] ${e.message} : reprise ultérieure.`, true);
    await incidentOnce("budget", "attention", e.message, 6 * 3600e3);
    return "reportee";
  }
  if (e instanceof TransientLlmError) {
    await release("[Système] Service IA indisponible : reprise ultérieure.", true);
    await incidentOnce("llm_indisponible", "attention", `Service IA indisponible : ${clip(e.message, 200)}`, 3 * 60e3);
    return "reportee";
  }
  const msg = errMsg(e);
  console.error("runTask", agent.code, msg);
  await release(`[Système] Erreur d'exécution : ${clip(msg, 300)}`, false);
  await db().rpc("ai_register_incident", { p_agent: agent.id, p_task: task.id, p_type: "erreur_execution", p_gravite: "attention", p_message: clip(msg, 500), p_echec: true });
  await publishActivity(agent.id, "en_difficulte", task.id);
  const { data: a } = await db().from("ai_agents").select("etat").eq("id", agent.id).single();
  if (a?.etat === "suspendu") {
    await db().from("ai_agent_tasks").update({ statut: "bloquee" }).eq("id", task.id);
  }
  return "echec";
}

/** Instruction du président : tâche du directeur général exécutée immédiatement (hors file). */
export async function createInstructionTask(contenu: string, userId: string): Promise<{ task_id: string } | { erreur: string }> {
  const { data: dg } = await db().from("ai_agents").select("id").eq("niveau", 1).neq("etat", "archive").limit(1).maybeSingle();
  if (!dg) return { erreur: "Directeur général IA introuvable" };
  const { data, error } = await db().from("ai_agent_tasks").insert({
    agent_id: dg.id, donneur_user_id: userId, type: "instruction", titre: clip(contenu.replace(/\s+/g, " "), 120), description: contenu,
    priorite: 1, statut: "en_cours", started_at: new Date().toISOString(), executions: 1,
  }).select("id").single();
  if (error) return { erreur: error.code === "23505" ? "Cette instruction est déjà en cours de traitement" : error.message };
  return { task_id: data.id };
}
