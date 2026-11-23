/**
 * Firecrawl v2 — extraction d'une page publique pour le Lead Hunter.
 * Secret exclusivement côté Edge Function. Pas de crawl multi-pages dans ce pilote.
 */
type FirecrawlResult = {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: { title?: string; description?: string; sourceURL?: string; url?: string; statusCode?: number };
  };
};

export type ScrapeOutput = {
  source_url: string;
  final_url: string | null;
  title: string | null;
  description: string | null;
  markdown: string;
  credits_estimes: number;
};

function validatePublicWebUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.length > 2048) throw new Error("URL invalide ou trop longue");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("URL non valide"); }
  if (url.protocol !== "https:") throw new Error("Seules les URL HTTPS sont autorisées");
  if (url.username || url.password) throw new Error("Les identifiants intégrés dans l'URL sont interdits");
  if (url.port && url.port !== "443") throw new Error("Port non standard interdit");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host === "metadata.google.internal" || host.endsWith(".internal") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    throw new Error("Hôte local ou adresse IP interdits");
  }
  url.hash = "";
  return url;
}

export async function firecrawlScrape(rawUrl: unknown): Promise<ScrapeOutput> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("Firecrawl non configuré : FIRECRAWL_API_KEY absente. Utilise web_fetch en solution de repli.");
  const url = validatePublicWebUrl(rawUrl);
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.toString(), formats: ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(25_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    const detail = raw.slice(0, 500);
    if (response.status === 402) throw new Error("Firecrawl : crédits insuffisants ou facturation requise. Repli sur web_fetch.");
    if (response.status === 429) throw new Error("Firecrawl : limite de débit atteinte. Repli sur web_fetch.");
    throw new Error(`Firecrawl HTTP ${response.status}. Repli sur web_fetch. ${detail}`);
  }
  let parsed: FirecrawlResult;
  try { parsed = JSON.parse(raw) as FirecrawlResult; } catch { throw new Error("Firecrawl : réponse JSON illisible. Repli sur web_fetch."); }
  const markdown = typeof parsed.data?.markdown === "string" ? parsed.data.markdown.trim() : "";
  if (!parsed.success || !markdown) throw new Error("Firecrawl n'a retourné aucun contenu exploitable. Repli sur web_fetch.");
  return {
    source_url: url.toString(),
    final_url: parsed.data?.metadata?.url ?? parsed.data?.metadata?.sourceURL ?? null,
    title: parsed.data?.metadata?.title ?? null,
    description: parsed.data?.metadata?.description ?? null,
    markdown: markdown.slice(0, 24_000),
    credits_estimes: 1,
  };
}
