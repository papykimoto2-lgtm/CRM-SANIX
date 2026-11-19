// Adresse stable de la démo : attribue un domaine à la branche Git « demo » du projet Vercel, depuis le CRM.
// Secrets Edge (saisis dans Supabase → Edge Functions → Secrets, jamais dans le chat ni dans le CRM) : VERCEL_TOKEN ;
// facultatifs : VERCEL_PROJECT (défaut « crm-sanix »), VERCEL_TEAM_ID, VERCEL_DEMO_BRANCH (défaut « demo »).
// Garde-fou : un domaine déjà utilisé par la PRODUCTION n'est jamais réattribué à la branche demo.
export class VercelError extends Error { constructor(public status: number, message: string) { super(message); } }
export type VDeps = { env: (k: string) => string | undefined; fetch: typeof fetch };
const API = "https://api.vercel.com";
const DOMAINE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** « https://Sanix-Demo.vercel.app/ » → « sanix-demo.vercel.app » (ou chaîne vide si invalide). */
export function normaliserDomaine(x: string): string {
  const d = String(x ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  return DOMAINE.test(d) ? d : "";
}
function cfg(d: VDeps) {
  return { token: d.env("VERCEL_TOKEN") ?? "", projet: (d.env("VERCEL_PROJECT") || "crm-sanix").trim(), team: (d.env("VERCEL_TEAM_ID") ?? "").trim(), branche: (d.env("VERCEL_DEMO_BRANCH") || "demo").trim() };
}
async function appel(d: VDeps, c: ReturnType<typeof cfg>, method: string, path: string, body?: unknown): Promise<{ status: number; j: any }> {
  const url = API + path + (c.team ? (path.includes("?") ? "&" : "?") + "teamId=" + encodeURIComponent(c.team) : "");
  const r = await d.fetch(url, { method, headers: { Authorization: "Bearer " + c.token, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
const msg = (j: any, repli: string) => String(j?.error?.message || repli).slice(0, 300);

export async function statut(d: VDeps) {
  const c = cfg(d);
  if (!c.token) return { configure: false, projet: c.projet, branche: c.branche, domaines: [] as unknown[] };
  const r = await appel(d, c, "GET", `/v9/projects/${encodeURIComponent(c.projet)}/domains`);
  if (r.status !== 200) throw new VercelError(r.status === 401 || r.status === 403 ? 409 : 502, "Vercel a refusé la lecture des domaines : " + msg(r.j, String(r.status)));
  const domaines = (Array.isArray(r.j.domains) ? r.j.domains : []).map((x: any) => ({ nom: String(x.name), branche: x.gitBranch ? String(x.gitBranch) : null, verifie: x.verified !== false }));
  return { configure: true, projet: c.projet, branche: c.branche, domaines };
}

export async function attacher(d: VDeps, domaineBrut: string) {
  const c = cfg(d), nom = normaliserDomaine(domaineBrut);
  if (!nom) throw new VercelError(400, "Adresse invalide : saisissez par exemple sanix-demo.vercel.app");
  if (!c.token) throw new VercelError(412, "Vercel n'est pas relié : ajoutez le secret VERCEL_TOKEN dans Supabase → Edge Functions → Secrets");
  if (nom === `${c.projet}.vercel.app`) throw new VercelError(409, "Cette adresse est celle de la production : choisissez-en une autre pour la démo");
  const base = `/v10/projects/${encodeURIComponent(c.projet)}/domains`;
  let r = await appel(d, c, "POST", base, { name: nom, gitBranch: c.branche });
  if (r.status === 409 || r.j?.error?.code === "domain_already_in_use") {
    const ex = await appel(d, c, "GET", `/v9/projects/${encodeURIComponent(c.projet)}/domains/${encodeURIComponent(nom)}`);
    if (ex.status !== 200) throw new VercelError(409, "Ce domaine est déjà utilisé par un autre projet Vercel : " + msg(r.j, "conflit"));
    if (!ex.j.gitBranch) throw new VercelError(409, "Ce domaine sert la PRODUCTION : refusé, il ne sera pas déplacé vers la branche " + c.branche);
    r = await appel(d, c, "PATCH", `/v9/projects/${encodeURIComponent(c.projet)}/domains/${encodeURIComponent(nom)}`, { gitBranch: c.branche });
  }
  if (r.status < 200 || r.status >= 300) throw new VercelError(r.status === 401 || r.status === 403 ? 409 : 502, "Vercel a refusé l'attribution : " + msg(r.j, String(r.status)));
  return { domaine: nom, branche: c.branche, verifie: r.j.verified !== false, verification: Array.isArray(r.j.verification) ? r.j.verification : [], url: "https://" + nom };
}
