// Adresse de démo : attribution d'un domaine à la branche « demo » (Vercel simulé). bun run tests/vercel_demo_test.ts
import { attacher, normaliserDomaine, statut, VercelError, type VDeps } from "../_shared/vercel_demo.ts";
const ok = (c: unknown, m: string) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const rep = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
function sim(env: Record<string, string>, h: (m: string, u: string, b: any) => Response) {
  const appels: { m: string; u: string; b: any; auth: string | null }[] = [];
  const d: VDeps = { env: (k) => env[k], fetch: (async (u: any, i: any) => { const b = i?.body ? JSON.parse(i.body) : undefined; appels.push({ m: i?.method, u: String(u), b, auth: new Headers(i?.headers).get("authorization") }); return h(i?.method, String(u), b); }) as any };
  return { d, appels };
}
const echoue = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as VercelError; } };

console.log("▶ Adresse");
ok(normaliserDomaine(" https://Sanix-Demo.vercel.app/accueil?x=1 ") === "sanix-demo.vercel.app", "protocole, majuscules et chemin retirés");
ok(normaliserDomaine("pas un domaine") === "" && normaliserDomaine("a_b.com") === "" && normaliserDomaine("localhost") === "", "adresses invalides refusées");

console.log("▶ Sans jeton");
const s0 = sim({}, () => rep(500, {}));
ok((await statut(s0.d)).configure === false && s0.appels.length === 0, "statut : non configuré, aucun appel Vercel");
const e0 = await echoue(attacher(s0.d, "sanix-demo.vercel.app"));
ok(e0 && e0.status === 412 && /VERCEL_TOKEN/.test(e0.message), "attribution impossible, message explique le secret à ajouter");

console.log("▶ Attribution");
const s1 = sim({ VERCEL_TOKEN: "tok", VERCEL_TEAM_ID: "team_x" }, (m) => m === "POST" ? rep(200, { name: "sanix-demo.vercel.app", verified: true, gitBranch: "demo" }) : rep(200, { domains: [] }));
const r1 = await attacher(s1.d, "https://sanix-demo.vercel.app");
ok(r1.url === "https://sanix-demo.vercel.app" && r1.verifie && r1.branche === "demo", "domaine attribué à la branche demo");
ok(s1.appels[0].u === "https://api.vercel.com/v10/projects/crm-sanix/domains?teamId=team_x" && s1.appels[0].b.gitBranch === "demo" && s1.appels[0].auth === "Bearer tok", "bon projet, équipe, branche et jeton");
const e1 = await echoue(attacher(s1.d, "crm-sanix.vercel.app"));
ok(e1 && e1.status === 409, "l'adresse de production du projet est refusée sans appel");
ok(s1.appels.length === 1, "aucun appel supplémentaire pour une adresse refusée");

console.log("▶ Domaine déjà existant");
const s2 = sim({ VERCEL_TOKEN: "t" }, (m, u) => m === "POST" ? rep(409, { error: { code: "domain_already_in_use", message: "déjà utilisé" } }) : m === "GET" ? rep(200, { name: "x.com", gitBranch: "demo" }) : rep(200, { verified: true }));
ok((await attacher(s2.d, "x.com")).domaine === "x.com" && s2.appels.some((a) => a.m === "PATCH"), "domaine déjà sur la branche : mis à jour (PATCH)");
const s3 = sim({ VERCEL_TOKEN: "t" }, (m) => m === "POST" ? rep(409, { error: { code: "domain_already_in_use", message: "x" } }) : rep(200, { name: "prod.com", gitBranch: null }));
const e3 = await echoue(attacher(s3.d, "prod.com"));
ok(e3 && e3.status === 409 && /PRODUCTION/.test(e3.message) && !s3.appels.some((a) => a.m === "PATCH"), "domaine de la production : jamais déplacé");
const s4 = sim({ VERCEL_TOKEN: "t" }, (m) => m === "POST" ? rep(409, { error: { code: "domain_already_in_use", message: "x" } }) : rep(404, {}));
ok((await echoue(attacher(s4.d, "autre.com")))?.status === 409, "domaine d'un autre projet : refusé");

console.log("▶ Erreurs Vercel");
const s5 = sim({ VERCEL_TOKEN: "t" }, () => rep(403, { error: { message: "Not authorized" } }));
ok((await echoue(attacher(s5.d, "a-demo.vercel.app")))?.status === 409, "jeton refusé : 409 avec le motif");
ok((await echoue(statut(s5.d)))?.status === 409, "statut : jeton refusé signalé");
const s6 = sim({ VERCEL_TOKEN: "t" }, () => rep(200, { domains: [{ name: "a.vercel.app", gitBranch: "demo", verified: true }, { name: "crm-sanix.vercel.app", verified: true }] }));
const st = await statut(s6.d) as any;
ok(st.configure && st.domaines.length === 2 && st.domaines[0].branche === "demo" && st.domaines[1].branche === null, "statut : liste des domaines avec leur branche");
console.log("\nTOUT EST OK");
