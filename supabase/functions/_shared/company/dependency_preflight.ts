/**
 * Contrôle préalable des dépendances nécessaires à un agent.
 * Aucun appel réseau ni appel IA n'est effectué ici : la présence d'un secret
 * ne prouve pas sa validité. Les vérifications réseau réelles sont faites à
 * la première utilisation du fournisseur et leurs erreurs sont classifiées.
 */
export type DependencyAgent = { outils: string[] };
export type DependencyCheck = {
  dependency: string;
  status: "present" | "missing" | "not_required" | "configured_unverified";
  detail: string;
};
export type DependencyReport = {
  ready: boolean;
  checks: DependencyCheck[];
  blockers: string[];
};

export function diagnoseAgentDependencies(
  agent: DependencyAgent,
  readSecret: (name: string) => string = (name) => Deno.env.get(name) ?? "",
): DependencyReport {
  const tools = new Set(agent.outils ?? []);
  const checks: DependencyCheck[] = [];
  const blockers: string[] = [];
  const needsProspecting = tools.has("create_prospect");
  const needsFirecrawl = needsProspecting || tools.has("firecrawl_scrape");

  if (needsProspecting) {
    for (const name of ["recherche_web", "firecrawl_scrape", "create_prospect"]) {
      const present = tools.has(name);
      checks.push({
        dependency: `outil:${name}`,
        status: present ? "present" : "missing",
        detail: present ? "Outil attribué à l'agent" : `Outil requis absent de la fiche de l'agent : ${name}`,
      });
      if (!present) blockers.push(`Attribuer l'outil ${name} à l'agent`);
    }
  } else if (tools.has("firecrawl_scrape")) {
    checks.push({ dependency: "outil:firecrawl_scrape", status: "present", detail: "Outil attribué à l'agent" });
  }

  if (needsFirecrawl) {
    const configured = !!readSecret("FIRECRAWL_API_KEY").trim();
    checks.push({
      dependency: "FIRECRAWL_API_KEY",
      status: configured ? "configured_unverified" : "missing",
      detail: configured
        ? "Secret présent ; validité et crédits non testés (aucun appel payant au précontrôle)"
        : "Secret absent des Edge Functions Supabase",
    });
    if (!configured) blockers.push("Configurer FIRECRAWL_API_KEY dans Supabase → Edge Functions → Secrets");
  }

  return { ready: blockers.length === 0, checks, blockers };
}
