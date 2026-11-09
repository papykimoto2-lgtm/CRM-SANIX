// Réunions entre agents : chaque participant contribue (sortie structurée), le convocateur synthétise,
// le procès-verbal est enregistré et le plan d'action devient des missions traçables.
import { audit, clip, db, errMsg } from "../core.ts";
import { BudgetError, callClaude, jsonOf, TransientLlmError } from "../llm.ts";
import { charterToText, COMPANY_RULES } from "../prompts.ts";
import { type AgentRow, loadGovernance, Org } from "./org.ts";
import { openChildren } from "./tools.ts";
import { publishActivity, publishMove, publishSpeech } from "./presence.ts";

type Contribution = {
  analyse: string; conclusions: string[]; difficultes: string[]; recommandations: string[];
  actions_proposees: { titre: string; description: string; responsable_code: string; priorite: number }[];
};
type Minutes = {
  synthese: string; decisions: string[];
  plan_action: { titre: string; description: string; responsable_code: string; priorite: number; echeance_jours: number }[];
};

const strArr = { type: "array", items: { type: "string" } };
const CONTRIB_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    analyse: { type: "string" }, conclusions: strArr, difficultes: strArr, recommandations: strArr,
    actions_proposees: { type: "array", items: { type: "object", additionalProperties: false,
      properties: { titre: { type: "string" }, description: { type: "string" }, responsable_code: { type: "string" }, priorite: { type: "integer" } },
      required: ["titre", "description", "responsable_code", "priorite"] } },
  },
  required: ["analyse", "conclusions", "difficultes", "recommandations", "actions_proposees"],
};
const MINUTES_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    synthese: { type: "string" }, decisions: strArr,
    plan_action: { type: "array", items: { type: "object", additionalProperties: false,
      properties: { titre: { type: "string" }, description: { type: "string" }, responsable_code: { type: "string" },
        priorite: { type: "integer" }, echeance_jours: { type: "integer" } },
      required: ["titre", "description", "responsable_code", "priorite", "echeance_jours"] } },
  },
  required: ["synthese", "decisions", "plan_action"],
};

async function persona(a: AgentRow): Promise<string> {
  const { data: ch } = await db().from("ai_agent_charters").select("contenu, version").eq("agent_id", a.id)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  return [`Tu es ${a.nom}, ${a.fonction}.`, a.personnalite ? `Personnalité : ${a.personnalite}` : "", COMPANY_RULES,
    `CAHIER DES CHARGES\n${charterToText(ch?.contenu)}`].filter(Boolean).join("\n\n");
}

const effortOf = (a: AgentRow) => (a.effort === "high" ? "medium" : a.effort);
const fmtContrib = (c: Contribution) =>
  `Analyse : ${c.analyse}\nConclusions : ${c.conclusions.join(" ; ")}\nDifficultés : ${c.difficultes.join(" ; ") || "aucune"}\nRecommandations : ${c.recommandations.join(" ; ")}\nActions proposées : ${c.actions_proposees.map((a) => `${a.titre} (${a.responsable_code}, P${a.priorite})`).join(" ; ") || "aucune"}`;

async function release(_meetingId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db().from("ai_agents").update({ activite: "disponible" }).in("id", ids).eq("activite", "en_reunion");
  for (const id of ids) {   // fin de réunion : retour au poste
    await publishMove(id, { lieu: "poste", ms: 0, motif: "fin_reunion" }, { kind: "deplacement" });
    await publishActivity(id, "disponible");
  }
}
const setPhase = async (id: string, phase: string, orateur: string | null = null) =>
  await db().from("ai_agent_meetings").update({ phase, orateur_id: orateur }).eq("id", id);
const extrait = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 220);

export async function runMeeting(meetingId: string): Promise<"terminee" | "reportee" | "echouee"> {
  const { data: m } = await db().from("ai_agent_meetings").select("*").eq("id", meetingId).maybeSingle();
  if (!m || m.statut !== "en_cours") return "echouee";
  const [org, gov] = await Promise.all([Org.load(), loadGovernance()]);
  const convener = org.byId(m.convoque_par);
  const { data: parts } = await db().from("ai_meeting_participants").select("agent_id, ordre").eq("meeting_id", m.id).order("ordre");
  const participants = (parts ?? []).map((p) => org.byId(p.agent_id)).filter((a): a is AgentRow => !!a && a.etat === "actif");
  const everyone = convener ? [convener, ...participants] : participants;
  let cout = 0;

  try {
    if (!convener || convener.etat !== "actif" || !participants.length) throw new Error("Convocateur ou participants indisponibles");
    await db().from("ai_agents").update({ activite: "en_reunion" }).in("id", everyone.map((a) => a.id));
    // 2-4. Les avatars rejoignent la salle et prennent place autour de la table
    await setPhase(m.id, "installation");
    const ids = everyone.map((a) => a.id);
    for (const id of ids) {
      await publishMove(id, { lieu: "reunion", ms: 10 * 60000, motif: "reunion" }, { kind: "reunion", meetingId: m.id, participants: ids });
      await publishActivity(id, "reunion");
    }

    const { data: ind } = await db().rpc("ai_report_data", { p_debut: new Date(Date.now() - 7 * 86400e3).toISOString(), p_fin: new Date().toISOString() });
    const { agents: _agents, ...indicateurs } = (ind ?? {}) as Record<string, unknown>;
    const equipe = everyone.map((a) => `${a.code} — ${a.nom} (${a.fonction}, ${a.departement_id})`).join("\n");
    const contexte = `RÉUNION : ${m.titre}\nConvoquée par : ${convener.nom}\nParticipants :\n${equipe}\n\nORDRE DU JOUR :\n${m.ordre_du_jour}\n\nINDICATEURS (7 derniers jours) :\n${clip(indicateurs, 5000)}`;

    const contributions: { agent: AgentRow; c: Contribution | null }[] = [];
    for (const [n, p] of participants.entries()) {
      const precedentes = contributions.filter((x) => x.c).map((x) => `### ${x.agent.nom}\n${fmtContrib(x.c!)}`).join("\n\n");
      try {
        await setPhase(m.id, "echanges", p.id);   // 6. prise de parole
        const { message, cost } = await callClaude({
          label: `agent:${p.code}`, agentId: p.id, system: await persona(p), effort: effortOf(p), maxTokens: 4000, format: CONTRIB_SCHEMA,
          messages: [{ role: "user", content: `${contexte}\n\n${precedentes ? `CONTRIBUTIONS PRÉCÉDENTES :\n${precedentes}\n\n` : ""}Tu es participant n°${n + 1}. Apporte ton analyse depuis ton domaine, tes conclusions, les difficultés, des recommandations et des actions concrètes (responsable_code = code d'un participant ou de ton équipe). Sois factuel et bref.` }],
        });
        cout += cost;
        const c = jsonOf<Contribution>(message);
        contributions.push({ agent: p, c });
        await publishSpeech(p.id, m.id, c.analyse || c.conclusions[0] || "");
        await db().from("ai_meeting_participants").update({ contribution: clip(fmtContrib(c), 12000) }).eq("meeting_id", m.id).eq("agent_id", p.id);
      } catch (e) {
        if (e instanceof BudgetError || e instanceof TransientLlmError) throw e;
        await audit({ agent: `agent:${p.code}`, action: "reunion_contribution_echec", agent_id: p.id, ok: false, payload: { e: errMsg(e) } });
        contributions.push({ agent: p, c: null });
      }
    }

    const ok = contributions.filter((x) => x.c);
    if (!ok.length) throw new Error("Aucune contribution exploitable");
    await setPhase(m.id, "synthese", convener.id);   // 7. le directeur synthétise
    const { message: sm, cost: sc } = await callClaude({
      label: `agent:${convener.code}`, agentId: convener.id, system: await persona(convener), effort: effortOf(convener), maxTokens: 6000, format: MINUTES_SCHEMA,
      messages: [{ role: "user", content: `${contexte}\n\nCONTRIBUTIONS :\n${ok.map((x) => `### ${x.agent.nom} (${x.agent.code})\n${fmtContrib(x.c!)}`).join("\n\n")}\n\nEn tant que convocateur, rédige le procès-verbal : synthèse fidèle, décisions, puis plan d'action (au plus ${gov.max_sous_taches} actions, chacune avec un responsable_code parmi les participants ou ton équipe, une priorité 1-5 et une échéance en jours). Aucune action redondante.` }],
    });
    cout += sc;
    const pv = jsonOf<Minutes>(sm);
    await publishSpeech(convener.id, m.id, extrait(pv.synthese));

    // Plan d'action → missions traçables (les plafonds de gouvernance s'appliquent)
    const portee = org.collabScope(convener);
    const plan: Record<string, unknown>[] = [];
    for (const a of pv.plan_action.slice(0, gov.max_sous_taches)) {
      const resp = org.byCode(a.responsable_code);
      if (!resp || resp.etat !== "actif" || !portee.has(resp.id)) {
        plan.push({ ...a, task_id: null, erreur: "responsable indisponible ou hors périmètre" });
        continue;
      }
      const { data: t, error } = await db().from("ai_agent_tasks").insert({
        reunion_id: m.id, agent_id: resp.id, donneur_agent_id: convener.id, type: "tache",
        titre: clip(a.titre, 200), description: clip(a.description, 8000), priorite: Math.max(1, Math.min(5, Math.round(a.priorite) || 3)),
        echeance: new Date(Date.now() + Math.max(1, Math.min(90, Math.round(a.echeance_jours) || 7)) * 86400e3).toISOString(),
      }).select("id").single();
      plan.push({ ...a, responsable_code: resp.code, task_id: t?.id ?? null, ...(error ? { erreur: error.message } : {}) });
    }
    await db().from("ai_meeting_minutes").insert({ meeting_id: m.id, synthese: clip(pv.synthese, 20000), decisions: pv.decisions.slice(0, 20), plan_action: plan });
    // 8. procès-verbal enregistré, clôture
    await db().from("ai_agent_meetings").update({ statut: "terminee", phase: "cloture", orateur_id: null, fin_at: new Date().toISOString(), cout_usd: Number(cout.toFixed(6)) }).eq("id", m.id);
    await release(m.id, everyone.map((a) => a.id));

    // Reprise du convocateur si plus rien n'est en attente
    if (m.task_id && !(await openChildren(m.task_id))) {
      const { data: t } = await db().from("ai_agent_tasks").select("reprises").eq("id", m.task_id).single();
      await db().from("ai_agent_tasks").update({ statut: "a_faire", reprises: (t?.reprises ?? 0) + 1 })
        .eq("id", m.task_id).eq("statut", "attente_sous_taches");
    }
    return "terminee";
  } catch (e) {
    await release(m.id, everyone.map((a) => a.id));
    if (e instanceof BudgetError || e instanceof TransientLlmError) {
      await db().from("ai_agent_meetings").update({ statut: "planifiee", phase: "convocation", orateur_id: null, debut_at: null, cout_usd: Number(cout.toFixed(6)) }).eq("id", m.id);
      return "reportee";
    }
    await db().from("ai_agent_meetings").update({ statut: "echouee", phase: "cloture", orateur_id: null, fin_at: new Date().toISOString(), cout_usd: Number(cout.toFixed(6)) }).eq("id", m.id);
    await db().rpc("ai_register_incident", { p_agent: m.convoque_par, p_task: m.task_id, p_type: "reunion_echouee", p_gravite: "attention", p_message: `Réunion « ${m.titre} » : ${clip(errMsg(e), 300)}`, p_echec: false });
    if (m.task_id) {   // le convocateur reprend sans PV
      const { data: t } = await db().from("ai_agent_tasks").select("reprises").eq("id", m.task_id).single();
      await db().from("ai_agent_tasks").update({ statut: "a_faire", reprises: (t?.reprises ?? 0) + 1, progression: "[Système] La réunion a échoué : décide avec les informations disponibles." })
        .eq("id", m.task_id).eq("statut", "attente_sous_taches");
    }
    return "echouee";
  }
}
