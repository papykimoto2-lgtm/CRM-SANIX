import { validatePublicWebUrl } from "./firecrawl.ts";

Deno.test("Firecrawl URL validation accepts public HTTPS pages", () => {
  const url = validatePublicWebUrl("https://www.example.ci/contact#top");
  if (url.toString() !== "https://www.example.ci/contact") throw new Error("URL should be normalized and fragment removed");
});

Deno.test("Firecrawl URL validation rejects non-HTTPS schemes", () => {
  let rejected = false;
  try { validatePublicWebUrl("http://example.ci"); } catch { rejected = true; }
  if (!rejected) throw new Error("HTTP URL should be rejected");
});

Deno.test("Firecrawl URL validation rejects local and literal IP hosts", () => {
  for (const value of ["https://localhost", "https://127.0.0.1", "https://192.168.1.10", "https://service.internal"]) {
    let rejected = false;
    try { validatePublicWebUrl(value); } catch { rejected = true; }
    if (!rejected) throw new Error(`Expected rejection for ${value}`);
  }
});

Deno.test("Firecrawl URL validation rejects credentials and nonstandard ports", () => {
  for (const value of ["https://user:pass@example.com", "https://example.com:8443"]) {
    let rejected = false;
    try { validatePublicWebUrl(value); } catch { rejected = true; }
    if (!rejected) throw new Error(`Expected rejection for ${value}`);
  }
});
