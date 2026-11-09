// Catalogue des outils attribuables aux collaborateurs IA (principe du moindre privilège).
import { CRM_DESCRIPTIONS, CRM_TOOL_NAMES } from "../crm_tools.ts";

export type ToolKind = "base" | "management" | "collab" | "web" | "crm" | "dg";
export type ToolMeta = { name: string; kind: ToolKind; desc: string; maxNiveau: number };

/** Toujours disponibles, jamais stockés dans ai_agents.outils. */
export const BASE_TOOLS = ["terminer_mission", "signaler_difficulte", "memoriser", "rappeler", "consulter_taches", "demander_validation"];

const META: ToolMeta[] = [
  { name: "creer_agent", kind: "management", maxNiveau: 3, desc: "Créer un collaborateur subordonné avec son cahier des charges" },
  { name: "modifier_agent", kind: "management", maxNiveau: 3, desc: "Réviser missions, outils, budget ou charte d'un subordonné" },
  { name: "changer_etat_agent", kind: "management", maxNiveau: 3, desc: "Suspendre, réactiver ou archiver un subordonné" },
  { name: "assigner_mission", kind: "management", maxNiveau: 4, desc: "Confier une mission à un subordonné (avec dépendances)" },
  { name: "attendre_sous_taches", kind: "management", maxNiveau: 4, desc: "Se mettre en attente des missions confiées" },
  { name: "evaluer_tache", kind: "management", maxNiveau: 4, desc: "Noter le travail d'un subordonné" },
  { name: "consulter_performance", kind: "management", maxNiveau: 4, desc: "Statistiques de performance de l'équipe" },
  { name: "consulter_indicateurs", kind: "management", maxNiveau: 3, desc: "Indicateurs de l'entreprise (activité, commercial, finances)" },
  { name: "convoquer_reunion", kind: "management", maxNiveau: 3, desc: "Réunion de travail avec procès-verbal et plan d'action" },
  { name: "demander_ressources", kind: "management", maxNiveau: 3, desc: "Demander plus de budget ou de capacité au président" },
  { name: "repondre_president", kind: "dg", maxNiveau: 1, desc: "Répondre au président dans le bureau exécutif" },
  { name: "transmettre", kind: "collab", maxNiveau: 5, desc: "Transmettre un dossier à un collègue (chaîne de traitement)" },
  { name: "recherche_web", kind: "web", maxNiveau: 5, desc: "Recherche sur le web (annuaires, sites d'entreprises, actualités)" },
  ...CRM_TOOL_NAMES.map((n): ToolMeta => ({
    name: n, kind: "crm", maxNiveau: 5,
    desc: CRM_DESCRIPTIONS[n].split(/[.(]/)[0],
  })),
];

export const CATALOG = META;
export const CATALOG_BY_NAME = new Map(META.map((m) => [m.name, m]));
export const GRANTABLE = META.filter((m) => m.kind !== "dg").map((m) => m.name);
export const EXTERNAL_TOOLS = ["send_message"];          // communication externe
export const MANAGEMENT_TOOLS = META.filter((m) => m.kind === "management").map((m) => m.name);

export function catalogText(): string {
  return META.filter((m) => m.kind !== "dg").map((m) => `${m.name} (${m.desc}${m.maxNiveau < 5 ? `; réservé niveaux ≤ ${m.maxNiveau}` : ""})`).join(" ; ");
}

/**
 * Outils qu'un créateur peut accorder : directeurs (niveau ≤ 2) tout le catalogue attribuable ;
 * responsables et en-dessous : uniquement ce qu'ils possèdent eux-mêmes (pas d'escalade de privilèges).
 */
export function checkGrant(creatorNiveau: number, creatorTools: string[], targetNiveau: number, wanted: string[]): string[] {
  const out: string[] = [];
  for (const t of [...new Set(wanted)]) {
    const m = CATALOG_BY_NAME.get(t);
    if (!m || m.kind === "dg") throw new Error(`Outil inconnu ou non attribuable : ${t}`);
    if (targetNiveau > m.maxNiveau) throw new Error(`L'outil ${t} est réservé aux agents de niveau ≤ ${m.maxNiveau}`);
    if (creatorNiveau > 2 && !creatorTools.includes(t)) throw new Error(`Tu ne peux pas accorder l'outil ${t} : tu ne le possèdes pas`);
    out.push(t);
  }
  return out;
}
