// Organisation : lecture des agents, hiérarchie, périmètres d'autorité.
import { db } from "../core.ts";

export type AgentRow = {
  id: string; code: string; nom: string; fonction: string; departement_id: string; manager_id: string | null;
  niveau: number; personnalite: string | null; specialite: string | null; outils: string[];
  etat: "actif" | "attente_validation" | "suspendu" | "archive";
  activite: string; temporaire: boolean; expire_at: string | null; effort: "low" | "medium" | "high";
  budget_jour_usd: number | null; charte_version: number; incidents_consecutifs: number; role_code?: string | null;
};

export type TaskRow = {
  id: string; parent_id: string | null; racine_id: string | null; reunion_id: string | null;
  agent_id: string; donneur_agent_id: string | null; donneur_user_id: string | null;
  type: "instruction" | "mission" | "tache"; titre: string; description: string; objectifs: string[];
  entrees: string | null; priorite: number; echeance: string | null; profondeur: number;
  statut: string; executions: number; reprises: number; progression: string | null; rapport: string | null;
  created_at: string;
};

export type Governance = {
  actif: boolean; creation_autonome: boolean; communication_externe: "interdite" | "validation" | "autonome";
  validation_outils_externes: boolean; max_agents_actifs: number; max_creations_jour: number;
  budget_jour_usd: number; budget_mois_usd: number; budget_agent_jour_usd: number; max_missions_actives: number;
  max_taches_agent: number; max_sous_taches: number; max_profondeur: number; max_tours_execution: number;
  max_executions_tache: number; max_participants_reunion: number; taches_par_tick: number;
  suspension_apres_incidents: number; modele: string;
};

export const AGENT_COLS = "id, code, nom, fonction, departement_id, manager_id, niveau, personnalite, specialite, outils, etat, activite, temporaire, expire_at, effort, budget_jour_usd, charte_version, incidents_consecutifs, role_code";

export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function slugCode(nom: string, taken: Set<string>): string {
  let base = norm(nom).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 52) || "agent";
  if (base.length < 3) base = `agent_${base}`;
  let code = base, i = 2;
  while (taken.has(code)) code = `${base}_${i++}`.slice(0, 60);
  return code;
}

export class Org {
  private _byId = new Map<string, AgentRow>();
  private _byCode = new Map<string, AgentRow>();
  constructor(public agents: AgentRow[]) {
    for (const a of agents) { this._byId.set(a.id, a); this._byCode.set(a.code, a); }
  }
  static async load(): Promise<Org> {
    const { data, error } = await db().from("ai_agents").select(AGENT_COLS).neq("etat", "archive").limit(1000);
    if (error) throw new Error(error.message);
    return new Org((data ?? []) as AgentRow[]);
  }
  byId(id: string | null | undefined): AgentRow | undefined { return id ? this._byId.get(id) : undefined; }
  byCode(code: string | null | undefined): AgentRow | undefined { return code ? this._byCode.get(String(code).trim().toLowerCase()) : undefined; }
  children(id: string): AgentRow[] { return this.agents.filter((a) => a.manager_id === id); }
  descendants(id: string): Set<string> {
    const out = new Set<string>(), stack = [id];
    while (stack.length) for (const c of this.children(stack.pop()!)) if (!out.has(c.id)) { out.add(c.id); stack.push(c.id); }
    return out;
  }
  ancestors(id: string): AgentRow[] {
    const out: AgentRow[] = []; let cur = this.byId(id);
    while (cur?.manager_id && out.length < 10) { cur = this.byId(cur.manager_id); if (cur) out.push(cur); }
    return out;
  }
  /** Directeur (niveau ≤ 2) dont dépend l'agent : frontière de la collaboration latérale. */
  directorOf(id: string): AgentRow | undefined {
    const a = this.byId(id);
    if (!a) return undefined;
    return a.niveau <= 2 ? a : this.ancestors(id).find((x) => x.niveau <= 2);
  }
  /** Agents que `a` peut solliciter latéralement ou convoquer : sa direction, ou tous pour le DG. */
  collabScope(a: AgentRow): Set<string> {
    if (a.niveau === 1) return new Set(this.agents.map((x) => x.id));
    const d = this.directorOf(a.id);
    const s = d ? this.descendants(d.id) : this.descendants(a.id);
    if (d) s.add(d.id);
    s.add(a.id);
    return s;
  }
  /** Peut-il donner des ordres à `target` ? (hiérarchie descendante uniquement) */
  commands(a: AgentRow, target: AgentRow): boolean {
    return a.id !== target.id && target.niveau > 1 && this.descendants(a.id).has(target.id);
  }
}

export async function loadGovernance(): Promise<Governance> {
  const { data, error } = await db().from("ai_governance").select("*").eq("id", 1).single();
  if (error || !data) throw new Error("Gouvernance introuvable");
  return data as Governance;
}

export const OPEN_STATES = ["a_faire", "en_cours", "attente_sous_taches", "attente_validation"] as const;
