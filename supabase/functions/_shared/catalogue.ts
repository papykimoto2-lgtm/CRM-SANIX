// Catalogue des logiciels ACTIFS : source unique du portefeuille présenté aux agents (aucun logiciel n'est cité dans le code).
import { db } from "./core.ts";
import { portfolioText } from "./prompts.ts";

let cache: { at: number; text: string } | null = null;
const TTL_MS = 60_000;

/** Portefeuille actuel (mis en cache 60 s : un logiciel activé ou désactivé est pris en compte à la minute suivante). */
export async function loadPortfolio(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;
  const { data } = await db().from("ai_products").select("id, nom, marche_cible").eq("actif", true).order("nom");
  const { data: refs } = await db().from("ai_product_references").select("product_id, client").eq("citable", true).order("client");   // seulement les références autorisées par la direction
  const parProduit = new Map<string, string[]>();
  for (const r of (refs ?? []) as { product_id: string; client: string }[]) parProduit.set(r.product_id, [...(parProduit.get(r.product_id) ?? []), r.client]);
  const text = portfolioText(((data ?? []) as { id: string; nom: string; marche_cible: string }[]).map((p) => ({ nom: p.nom, marche_cible: p.marche_cible, references: parProduit.get(p.id) })));
  cache = { at: Date.now(), text };
  return text;
}
export function resetPortfolioCache(): void { cache = null; }
