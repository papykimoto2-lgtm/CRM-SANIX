import { diagnoseAgentDependencies } from "./dependency_preflight.ts";

Deno.test("Lead Hunter V1 : précontrôle bloque sans Firecrawl et autorise une clé présente", () => {
  const requiredTools = ["recherche_web", "firecrawl_scrape", "create_prospect"];
  const missing = diagnoseAgentDependencies({ outils: requiredTools }, () => "");
  if (missing.ready) throw new Error("Une mission V1 ne doit pas démarrer sans FIRECRAWL_API_KEY");
  if (!missing.blockers.some((item) => item.includes("FIRECRAWL_API_KEY"))) {
    throw new Error("Le blocage doit nommer explicitement FIRECRAWL_API_KEY");
  }

  const configured = diagnoseAgentDependencies({ outils: requiredTools }, () => "test-key");
  if (!configured.ready) throw new Error("Une configuration présente doit passer le précontrôle statique");
  const key = configured.checks.find((item) => item.dependency === "FIRECRAWL_API_KEY");
  if (key?.status !== "configured_unverified") {
    throw new Error("La présence de la clé ne doit pas être confondue avec une validation réelle");
  }
});

Deno.test("Agent sans création de fiches : une clé Firecrawl absente ne bloque pas ses missions", () => {
  const report = diagnoseAgentDependencies({ outils: ["assigner_mission", "recherche_web", "firecrawl_scrape"] }, () => "");
  if (!report.ready) throw new Error("Un agent sans create_prospect ne doit pas être bloqué par l'absence de FIRECRAWL_API_KEY");
  const key = report.checks.find((item) => item.dependency === "FIRECRAWL_API_KEY");
  if (key?.status !== "missing") throw new Error("L'absence de la clé doit rester visible dans le diagnostic");
});
