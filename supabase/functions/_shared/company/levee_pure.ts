// Levée de fonds — état lisible par un agent, construit à partir des commandes du CRM et des réglages du module (calculs partagés avec le CRM).
// Fonctions pures : testables sans base ni Deno.
type Calc = Record<string, any>;
export type EntreesLevee = {
  commandes: Array<Record<string, any>>; config: Record<string, any>;
  etat: { config?: Record<string, any>; instantane?: Record<string, any>; updated_at?: string } | null; now?: Date;
};
const STATUT = { ok: "atteint", warn: "à renforcer", ko: "insuffisant", na: "à documenter" } as Record<string, string>;
const age = (iso: string | undefined, now: Date) => iso ? Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 864e5 * 10) / 10) : null;
const r1 = (x: unknown) => typeof x === "number" && isFinite(x) ? Math.round(x * 1000) / 1000 : null;

export function construireEtat(L: Calc, e: EntreesLevee) {
  const now = e.now ?? new Date(), cfg = e.etat?.config ?? {}, ins = e.etat?.instantane ?? {};
  const modele = ins.modele ?? null;
  const m = L.mesurer({ commandes: e.commandes, config: e.config, now: now.toISOString(), pipelinePondere: ins.pipelinePondere ?? null, modele });
  const ev = L.evaluer(m, cfg.seuils, cfg.manuel), sc = L.scores(ev), pl = L.plan(m, cfg.seuils, cfg.manuel);
  const lib = (id: string) => L.CRITERES.find((c: any) => c.id === id)?.lib ?? id;
  const avertissements: string[] = [];
  if (!m.nbCommandes) avertissements.push("Aucune commande exploitable dans le CRM : les indicateurs commerciaux ne sont pas mesurables.");
  if (m.moisAct < 6) avertissements.push(`Historique de ventes court (${m.moisAct} mois) : la croissance n'est pas mesurable avant 6 mois.`);
  if (!e.etat?.updated_at) avertissements.push("Le module Levée de fonds du CRM n'a jamais été ouvert avec une session connectée : réglages et modèle Financement inconnus (critères de dossier non cochés, modèle absent).");
  else if ((age(e.etat.updated_at, now) ?? 0) > 14) avertissements.push(`Réglages et modèle Financement synchronisés il y a ${age(e.etat.updated_at, now)} jours : peuvent être périmés.`);
  if (!modele) avertissements.push("Modèle Financement indisponible : besoin de financement, point mort et projections inconnus.");
  else if (!modele.valide) avertissements.push("Le modèle Financement n'est pas validé par la direction : ses chiffres sont un document de travail.");
  return {
    date: now.toISOString().slice(0, 10),
    mesures: {
      commandes: m.nbCommandes, clients: m.clients, clients_payants: m.clientsPayants, ca_vendu_12m_ht: Math.round(m.vendu12), ca_livre_12m_ht: Math.round(m.livre12),
      mois_activite: m.moisAct, croissance_mensuelle: r1(m.croissance), part_recurrente: r1(m.recurrent), poids_premier_client: r1(m.top1),
      poids_premier_logiciel: r1(m.topLogiciel), part_encaissee: r1(m.encaisse), logiciels_vendus: m.produits,
    },
    eligibilite: L.ROUTES.map((r: any, i: number) => ({
      type: r.id, libelle: r.lib, score: sc[i].score, seuil: sc[i].seuil, verdict: sc[i].verdict,
      a_regler_d_abord: sc[i].bloques.map(lib), prochain_gain: sc[i].manques[0] ? { critere: lib(sc[i].manques[0].id), points: sc[i].manques[0].gain } : null,
    })),
    criteres: L.CRITERES.map((c: any, i: number) => ({ critere: c.lib, statut: STATUT[ev[i].s], valeur: ev[i].texte })),
    plan: pl.slice(0, 8).map((p: any) => ({ action: p.lib, situation: p.texte, comment: p.action, delai_estime_mois: p.delai ?? null, condition_obligatoire_pour: p.bloque })),
    modele: modele ? { besoin_fcfa: modele.besoin, recommande_fcfa: modele.recommande, point_mort_mois: modele.pointMort, valide: !!modele.valide, scenario: modele.scenario ?? null, synchronise_il_y_a_jours: age(e.etat?.updated_at, now) } : null,
    avertissements,
  };
}
