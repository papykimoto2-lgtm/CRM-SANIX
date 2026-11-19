// Levée de fonds : outils des agents IA (lecture de l'état de préparation, annuaire des financeurs sourcés).
import "../../../../shared/levee.js";     // calculs du CRM, partagés : définit globalThis.SanixLevee
import { clip } from "../core.ts";
import { db } from "../core.ts";
import { construireEtat } from "./levee_pure.ts";

export const FINANCEUR_TYPES = ["business_angel", "fonds", "banque", "subvention", "accelerateur", "autre"] as const;
export const FINANCEUR_STATUTS = ["a_etudier", "correspond", "contacte", "en_discussion", "decline", "ecarte", "investi"] as const;
const calc = () => (globalThis as any).SanixLevee.calc;
const txtOpt = (v: unknown, max: number) => typeof v === "string" && v.trim() ? clip(v.replace(/\s+/g, " ").trim(), max) : null;
const montant = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };

/** État de préparation à la levée de fonds : mesures recalculées depuis les commandes du CRM, réglages et modèle Financement tels que synchronisés par le CRM. */
export async function consulterLevee() {
  const [cmds, cfg, etat] = await Promise.all([
    db().from("crm_commandes").select("ref,client,date,logiciel,ttc,statut,data").limit(5000),
    db().from("crm_config").select("data").limit(1),
    db().from("levee_etat").select("config,instantane,updated_at").eq("id", 1).maybeSingle(),
  ]);
  if (cmds.error) throw new Error(cmds.error.message);
  const commandes = (cmds.data ?? []).map((r: any) => ({ ...(r.data ?? {}), ref: r.ref, client: r.client, date: r.date, logiciel: r.logiciel, ttc: Number(r.ttc), statut: r.statut }));
  return construireEtat(calc(), { commandes, config: cfg.data?.[0]?.data ?? {}, etat: etat.data ?? null });
}

export async function listerFinanceurs(i: Record<string, any>) {
  let q = db().from("levee_financeurs").select("id,nom,type,pays,ticket_min,ticket_max,devise,conditions,url_source,statut,notes,created_at").order("created_at", { ascending: false }).limit(60);
  if ((FINANCEUR_TYPES as readonly string[]).includes(i.type)) q = q.eq("type", i.type);
  if ((FINANCEUR_STATUTS as readonly string[]).includes(i.statut)) q = q.eq("statut", i.statut);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { nombre: data?.length ?? 0, financeurs: data ?? [] };
}

/** Enregistre (ou met à jour, par nom) un financeur. La source est obligatoire : un lien https vérifiable, jamais une adresse supposée. */
export async function enregistrerFinanceur(agentId: string, i: Record<string, any>) {
  const nom = txtOpt(i.nom, 160); if (!nom || nom.length < 2) throw new Error("nom obligatoire");
  const type = String(i.type ?? ""); if (!(FINANCEUR_TYPES as readonly string[]).includes(type)) throw new Error(`type invalide (${FINANCEUR_TYPES.join(", ")})`);
  const url = txtOpt(i.url_source, 500);
  if (!url || !/^https:\/\/[^\s]+$/i.test(url)) throw new Error("url_source obligatoire : lien https de la page qui décrit ce financeur (jamais une adresse supposée)");
  const statut = (FINANCEUR_STATUTS as readonly string[]).includes(i.statut) ? i.statut : "a_etudier";
  const { count } = await db().from("levee_financeurs").select("id", { count: "exact", head: true });
  const row = {
    nom, type, pays: txtOpt(i.pays, 80), ticket_min: montant(i.ticket_min), ticket_max: montant(i.ticket_max), devise: txtOpt(i.devise, 8) ?? "FCFA",
    conditions: txtOpt(i.conditions, 3000), url_source: url, statut, notes: txtOpt(i.notes, 3000), ajoute_par: agentId, updated_at: new Date().toISOString(),
  };
  const { data: ex } = await db().from("levee_financeurs").select("id").eq("nom_norm", nom.toLowerCase().replace(/\s+/g, " ")).maybeSingle();
  if (ex) {
    const { error } = await db().from("levee_financeurs").update(row).eq("id", ex.id);
    if (error) throw new Error(error.message);
    return { ok: true, id: ex.id, mis_a_jour: true };
  }
  if ((count ?? 0) >= 300) throw new Error("Annuaire plein (300 financeurs) : demande au président de faire le tri");
  const { data, error } = await db().from("levee_financeurs").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return { ok: true, id: data.id, mis_a_jour: false };
}
