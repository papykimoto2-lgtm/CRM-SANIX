// Catalogue des logiciels ACTIFS : source unique du portefeuille présenté aux agents (aucun logiciel n'est cité dans le code).
import { db } from "./core.ts";
import { portfolioText } from "./prompts.ts";

let cache: { at: number; text: string } | null = null;
const TTL_MS = 60_000;

/** Portefeuille actuel (mis en cache 60 s : un logiciel activé ou désactivé est pris en compte à la minute suivante). */
export async function loadPortfolio(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;
  const { data } = await db().from("ai_products").select("nom, marche_cible").eq("actif", true).order("nom");
  const text = portfolioText((data ?? []) as { nom: string; marche_cible: string }[]);
  cache = { at: Date.now(), text };
  return text;
}
export function resetPortfolioCache(): void { cache = null; }
