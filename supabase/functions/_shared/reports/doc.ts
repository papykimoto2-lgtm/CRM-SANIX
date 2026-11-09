// Contenu des rapports : un document structuré unique, rendu ensuite en HTML (e-mail / CRM) et en PDF.
import type { ReportType } from "./schedule.ts";

export type Block =
  | { t: "kv"; rows: [string, string][] }
  | { t: "table"; head: string[]; rows: string[][]; widths: number[] }
  | { t: "list"; items: string[]; vide?: string }
  | { t: "p"; text: string };
export type Section = { titre: string; blocks: Block[] };
export type Doc = { titre: string; sousTitre: string; kpis: [string, string][]; sections: Section[]; pied: string };

export type Analyse = {
  resume: string; recommandations: string[]; risques: string[]; informations_manquantes: string[];
  objectifs_commerciaux: string[]; actions_strategiques: string[]; orientations: string[];
};

export const ANALYSE_SCHEMA = (() => {
  const a = { type: "array", items: { type: "string" } };
  const props = { resume: { type: "string" }, recommandations: a, risques: a, informations_manquantes: a, objectifs_commerciaux: a, actions_strategiques: a, orientations: a };
  return { type: "object", additionalProperties: false, properties: props, required: Object.keys(props) };
})();

// deno-lint-ignore no-explicit-any
type D = Record<string, any>;
const n = (v: unknown) => Number(v ?? 0);
export const fmt = (v: unknown) => n(v).toLocaleString("fr-FR");
export const fcfa = (v: unknown) => `${fmt(Math.round(n(v)))} FCFA`;
export const usd = (v: unknown) => `${n(v).toFixed(2)} $`;
const pct = (v: unknown) => (v === null || v === undefined ? "—" : `${n(v)} %`);
const dash = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
const heure = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan", dateStyle: "short", timeStyle: "short" });

/** Analyse sans IA (budget atteint ou panne) : règles simples sur les indicateurs. */
export function fallbackAnalyse(d: D): Analyse {
  const a = d.activite ?? {}, c = d.commercial ?? {}, diff = d.difficultes ?? {};
  const reco: string[] = [], risques: string[] = [];
  if (n(a.missions_bloquees) > 0) reco.push(`Débloquer ${n(a.missions_bloquees)} mission(s) bloquée(s) : réattribuer ou lever la contrainte.`);
  if ((diff.agents_en_difficulte ?? []).length) reco.push(`Réviser le cahier des charges des ${(diff.agents_en_difficulte ?? []).length} agent(s) en difficulté ou les remplacer.`);
  if ((diff.validations_en_attente ?? []).length) reco.push(`Traiter ${(diff.validations_en_attente ?? []).length} validation(s) en attente : elles ralentissent les équipes.`);
  if (n(c.nouveaux_prospects) === 0 && n(a.missions_en_cours) === 0) reco.push("Aucune activité de prospection : lancer une mission de recherche de prospects.");
  if (!reco.length) reco.push("Aucune action corrective automatique : poursuivre le plan en cours.");
  if (n(a.cout_ia_usd) > 0 && n(a.missions_terminees) === 0) risques.push("Coût IA engagé sans mission terminée sur la période.");
  return {
    resume: `${n(a.missions_terminees)} mission(s) terminée(s) sur ${n(a.missions_attribuees)} attribuée(s) ; ${n(c.nouveaux_prospects)} nouveau(x) prospect(s) ; ${n(c.rdv_obtenus)} rendez-vous. (Analyse automatique : le directeur IA n'a pas pu rédiger ses recommandations.)`,
    recommandations: reco, risques, informations_manquantes: [], objectifs_commerciaux: [], actions_strategiques: [], orientations: [],
  };
}

const kvActivite = (a: D): [string, string][] => [
  ["Nombre d'agents actifs", fmt(a.agents_actifs)], ["Nombre d'agents créés", fmt(a.agents_crees)],
  ["Nombre de missions attribuées", fmt(a.missions_attribuees)], ["Nombre de missions terminées", fmt(a.missions_terminees)],
  ["Nombre de missions en cours", fmt(a.missions_en_cours)], ["Nombre de missions bloquées", fmt(a.missions_bloquees)],
  ["Réunions tenues", fmt(a.reunions)], ["Coût IA estimé", usd(a.cout_ia_usd)],
];
const kvCommercial = (c: D): [string, string][] => [
  ["Nouveaux prospects identifiés", fmt(c.nouveaux_prospects)], ["Prospects qualifiés", fmt(c.prospects_qualifies)],
  ["Messages WhatsApp envoyés", fmt(c.whatsapp_envoyes)], ["E-mails envoyés", fmt(c.emails_envoyes)],
  ["Réponses reçues", fmt(c.reponses_recues)], ["Rendez-vous obtenus", fmt(c.rdv_obtenus)],
  ["Démonstrations programmées", fmt(c.demos_programmees)], ["Offres commerciales transmises", fmt(c.offres_transmises)],
  ["Négociations en cours", fmt(c.negociations_en_cours)],
];
const kvFinancier = (f: D): [string, string][] => [
  ["Valeur des opportunités commerciales", fcfa(f.valeur_opportunites)], ["Devis transmis (HT)", fcfa(f.devis_transmis_ht)],
  ["Marchés conclus", fmt(f.marches_conclus)], ["Chiffre d'affaires signé (HT)", fcfa(f.ca_signe_ht)],
  ["Chiffre d'affaires encaissé (HT)", fcfa(f.ca_encaisse_ht)], ["Prévisions commerciales (pondérées)", fcfa(f.prevision_ponderee)],
];
const tableAgents = (agents: D[]): Block => ({
  t: "table",
  head: ["Agent", "Fonction", "Attrib.", "Termin.", "Taux", "Qualité", "Délais", "Coût IA", "Incid.", "Score"],
  widths: [2.3, 2.4, 0.9, 0.9, 0.9, 0.9, 0.9, 1.1, 0.8, 0.9],
  rows: agents.map((g) => [g.nom, g.fonction, fmt(g.attribuees), fmt(g.terminees), pct(g.taux), dash(g.qualite), pct(g.respect_delais), usd(g.cout_usd), fmt(g.incidents), dash(g.score)]),
});
const difficultes = (d: D, an: Analyse): Block[] => {
  const diff = d.difficultes ?? {};
  return [
    { t: "p", text: "Agents bloqués ou en difficulté" },
    { t: "list", items: (diff.agents_en_difficulte ?? []).map((x: D) => `${x.nom} — ${x.fonction} (${x.etat === "suspendu" ? "suspendu" : "en difficulté"})`), vide: "Aucun" },
    { t: "p", text: "Missions non exécutées (bloquées)" },
    { t: "list", items: (diff.missions_bloquees ?? []).map((x: D) => `${x.titre} — ${x.agent}${x.note ? ` : ${x.note.replace(/\s+/g, " ").trim()}` : ""}`), vide: "Aucune" },
    { t: "p", text: "Erreurs et incidents détectés" },
    { t: "list", items: (diff.incidents ?? []).map((x: D) => `[${x.gravite}] ${x.type} — ${x.message} (${heure(x.at)})`), vide: "Aucun" },
    { t: "p", text: "Informations manquantes" },
    { t: "list", items: an.informations_manquantes, vide: "Aucune" },
    { t: "p", text: "Validations humaines en attente" },
    { t: "list", items: (diff.validations_en_attente ?? []).map((x: D) => `${x.type} — ${x.motif} (depuis le ${heure(x.depuis)})`), vide: "Aucune" },
  ];
};
const programme = (d: D, an: Analyse): Block[] => {
  const p = d.programme ?? {};
  return [
    { t: "p", text: "Missions prioritaires" },
    { t: "list", items: (p.missions_prioritaires ?? []).map((x: D) => `P${x.priorite} — ${x.titre} (${x.agent})${x.echeance ? ` · échéance ${heure(x.echeance)}` : ""}`), vide: "Aucune mission en file" },
    { t: "p", text: "Objectifs commerciaux" },
    { t: "list", items: an.objectifs_commerciaux, vide: "Non précisés" },
    { t: "p", text: "Rendez-vous prévus" },
    { t: "list", items: (p.rdv_prevus ?? []).map((x: D) => `${heure(x.debut)} — ${x.prospect} (${x.mode})`), vide: "Aucun dans les 48 h" },
    { t: "p", text: "Actions stratégiques" },
    { t: "list", items: an.actions_strategiques, vide: "Aucune" },
  ];
};

export function buildDoc(type: ReportType, d: D, an: Analyse, periodeLabel: string): Doc {
  const a = d.activite ?? {}, c = d.commercial ?? {}, f = d.financier ?? {}, agents: D[] = d.agents ?? [];
  const pied = "Rapport généré automatiquement par SANIX AI VIRTUAL COMPANY · montants en FCFA · coût IA estimé en dollars US";
  const reco: Section = { titre: "F. DÉCISIONS ET RECOMMANDATIONS", blocks: [
    { t: "p", text: an.resume },
    { t: "list", items: an.recommandations, vide: "Aucune recommandation" },
    ...(an.risques.length ? [{ t: "p", text: "Risques identifiés" } as Block, { t: "list", items: an.risques } as Block] : []),
  ] };
  const kpis: [string, string][] = [
    ["Missions terminées", fmt(a.missions_terminees)], ["Prospects identifiés", fmt(c.nouveaux_prospects)],
    ["Rendez-vous obtenus", fmt(c.rdv_obtenus)], ["CA signé (HT)", fcfa(f.ca_signe_ht)],
  ];

  if (type === "quotidien") return {
    titre: "RAPPORT JOURNALIER – SANIX AI VIRTUAL COMPANY", sousTitre: `Date : ${periodeLabel}.`, kpis, pied,
    sections: [
      { titre: "A. ACTIVITÉ GÉNÉRALE", blocks: [{ t: "kv", rows: kvActivite(a) }] },
      { titre: "B. ACTIVITÉ COMMERCIALE", blocks: [{ t: "kv", rows: kvCommercial(c) }] },
      { titre: "C. RÉSULTATS FINANCIERS", blocks: [{ t: "kv", rows: kvFinancier(f) }] },
      { titre: "D. PERFORMANCE DES COLLABORATEURS", blocks: [tableAgents(agents)] },
      { titre: "E. DIFFICULTÉS RENCONTRÉES", blocks: difficultes(d, an) },
      reco,
      { titre: "G. PROGRAMME DU LENDEMAIN", blocks: programme(d, an) },
    ],
  };
  if (type === "hebdomadaire") return {
    titre: "RAPPORT HEBDOMADAIRE – FINANCES ET PERFORMANCE DES AGENTS", sousTitre: `Période : ${periodeLabel}.`, kpis, pied,
    sections: [
      { titre: "A. SYNTHÈSE DE LA SEMAINE", blocks: [{ t: "kv", rows: kvActivite(a) }, { t: "kv", rows: kvCommercial(c) }] },
      { titre: "B. RÉSULTATS FINANCIERS", blocks: [{ t: "kv", rows: kvFinancier(f) }] },
      { titre: "C. PERFORMANCE DES COLLABORATEURS", blocks: [tableAgents(agents)] },
      { titre: "D. DIFFICULTÉS RENCONTRÉES", blocks: difficultes(d, an) },
      { ...reco, titre: "E. DÉCISIONS ET RECOMMANDATIONS" },
    ],
  };
  if (type === "mensuel") return {
    titre: "RAPPORT STRATÉGIQUE MENSUEL – SANIX AI VIRTUAL COMPANY", sousTitre: `Mois : ${periodeLabel}.`, kpis, pied,
    sections: [
      { titre: "A. ACTIVITÉ GÉNÉRALE", blocks: [{ t: "kv", rows: kvActivite(a) }] },
      { titre: "B. ACTIVITÉ COMMERCIALE", blocks: [{ t: "kv", rows: kvCommercial(c) }] },
      { titre: "C. RÉSULTATS FINANCIERS", blocks: [{ t: "kv", rows: kvFinancier(f) }] },
      { titre: "D. PERFORMANCE DES COLLABORATEURS", blocks: [tableAgents(agents)] },
      { titre: "E. DIFFICULTÉS RENCONTRÉES", blocks: difficultes(d, an) },
      { titre: "F. ORIENTATIONS STRATÉGIQUES", blocks: [{ t: "list", items: an.orientations, vide: "Aucune orientation formulée" }] },
      { ...reco, titre: "G. DÉCISIONS ET RECOMMANDATIONS" },
      { titre: "H. PRIORITÉS DU MOIS SUIVANT", blocks: programme(d, an) },
    ],
  };
  return {
    titre: "ALERTE – INCIDENTS CRITIQUES – SANIX AI VIRTUAL COMPANY", sousTitre: `Émis le ${periodeLabel}.`, kpis: [], pied,
    sections: [
      { titre: "INCIDENTS", blocks: [{ t: "list", items: (d.difficultes?.incidents ?? []).map((x: D) => `[${x.gravite}] ${x.type} — ${x.message} (${heure(x.at)})`), vide: "Aucun" }] },
      { titre: "AGENTS EN DIFFICULTÉ", blocks: [{ t: "list", items: (d.difficultes?.agents_en_difficulte ?? []).map((x: D) => `${x.nom} — ${x.fonction} (${x.etat})`), vide: "Aucun" }] },
      { titre: "ACTIONS RECOMMANDÉES", blocks: [{ t: "list", items: an.recommandations, vide: "Consulter le tableau de bord SANIX AI VIRTUAL COMPANY." }] },
    ],
  };
}
