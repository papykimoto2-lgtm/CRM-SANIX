// Module commercial sous gouvernance : preuve de consentement (réglage), relances planifiées (réservation atomique, reprise,
// anti-doublon, pannes IA sans perte). Vrai PostgreSQL (verrous, triggers, fonctions SQL) ; l'IA est simulée par un exécuteur injecté.
import { assert, dropAll, eq, freshDb, one, rejects, rows, val } from "./testkit.ts";
import { sql } from "./fake_supabase.ts";
import { deliverMessage, hasChannelPermission } from "../_shared/outbox.ts";
import { MAX_RELANCES, tickFollowups } from "../_shared/followups.ts";
import { BudgetError, LlmKeyMissingError, TransientLlmError } from "../_shared/llm.ts";

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });

let seq = 0;
async function mkProspect(o: Record<string, unknown> = {}): Promise<string> {
  const n = ++seq;
  const d = { entreprise: `Société ${n}`, secteur: "Immobilier", email: `contact${n}@societe${n}.ci`, whatsapp: null, opt_out: false, relances_sans_reponse: 0, stage: "enregistre", consentement: {}, last_inbound_at: null, ...o };
  return String(await val(
    "insert into ai_prospects(entreprise, secteur, email, whatsapp, opt_out, relances_sans_reponse, stage, consentement, last_inbound_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) returning id",
    [d.entreprise, d.secteur, d.email, d.whatsapp, d.opt_out, d.relances_sans_reponse, d.stage, JSON.stringify(d.consentement), d.last_inbound_at]));
}
const prospectRow = async (id: string) => await one("select * from ai_prospects where id = $1", [id]);
const mail = (p: Record<string, unknown>, canal: "email" | "whatsapp" = "email") => ({ prospect: p, canal, contenu: "Bonjour, une question sur votre gestion.", agentLabel: "test" });
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

T("S1 · consentement : réglage de gouvernance, preuve datée, fenêtre WhatsApp de 24 h, désinscription", async () => {
  await freshDb();
  const p = await mkProspect();
  // Réglage désactivé (défaut) : la validation du président est le garde-fou
  eq(await val("select consentement_requis from ai_governance"), false, "désactivé par défaut");
  eq((await deliverMessage(mail(await prospectRow(p)))).statut, "a_valider", "défaut : le message part en validation");
  eq(Number(await val("select count(*) from ai_approvals where type = 'message'")), 1, "une demande de validation");

  await sql("update ai_governance set consentement_requis = true");
  await rejects(async () => deliverMessage(mail(await prospectRow(p))), "preuve de consentement", "activé, sans preuve : bloqué");
  eq(Number(await val("select count(*) from ai_messages")), 1, "aucun nouveau message enregistré");

  await sql("update ai_prospects set consentement = $2::jsonb where id = $1", [p, JSON.stringify({ email: { at: iso(86400e3), preuve: "formulaire de contact du 09/11" } })]);
  eq((await deliverMessage(mail(await prospectRow(p)))).statut, "a_valider", "preuve datée et justifiée : autorisé");
  await rejects(async () => deliverMessage(mail(await prospectRow(p), "whatsapp")), "preuve de consentement", "la preuve vaut pour son canal seulement");

  for (const [libelle, c] of [["preuve vide", { email: { at: iso(1000), preuve: "  " } }], ["date future", { email: { at: new Date(Date.now() + 86400e3).toISOString(), preuve: "x" } }],
    ["date absente", { email: { preuve: "x" } }], ["forme invalide", { email: ["x"] }]] as const) {
    await sql("update ai_prospects set consentement = $2::jsonb where id = $1", [p, JSON.stringify(c)]);
    await rejects(async () => deliverMessage(mail(await prospectRow(p))), "preuve de consentement", `refusé : ${libelle}`);
  }

  // WhatsApp : le prospect a écrit lui-même depuis moins de 24 h
  const w = await mkProspect({ whatsapp: "+2250700000011", last_inbound_at: iso(2 * 3600e3) });
  eq((await deliverMessage(mail(await prospectRow(w), "whatsapp"))).statut, "a_valider", "message entrant de 2 h : autorisé");
  await sql("update ai_prospects set last_inbound_at = $2 where id = $1", [w, iso(25 * 3600e3)]);
  await rejects(async () => deliverMessage(mail(await prospectRow(w), "whatsapp")), "preuve de consentement", "message entrant de 25 h : bloqué");
  assert(hasChannelPermission({ last_inbound_at: iso(3600e3), consentement: {} } as never, "whatsapp"), "fenêtre de 24 h (unité)");
  assert(!hasChannelPermission({ last_inbound_at: iso(3600e3), consentement: {} } as never, "email"), "la fenêtre WhatsApp ne vaut pas pour l'e-mail");

  // Désinscription : refusée quel que soit le réglage
  await sql("update ai_governance set consentement_requis = false");
  const o = await mkProspect({ opt_out: true });
  await rejects(async () => deliverMessage(mail(await prospectRow(o))), "désinscrit", "désinscrit : jamais");
  // Gouvernance en pause : rien ne part
  await sql("update ai_governance set actif = false");
  await rejects(async () => deliverMessage(mail(await prospectRow(p))), "interdite", "entreprise en pause : interdit");
});

const mkFollowup = async (pid: string, o: { due?: string; canal?: string; scenario?: string; attempts?: number; locked?: string | null } = {}): Promise<string> =>
  String(await val("insert into ai_followups(prospect_id, due_at, scenario, canal, attempts, locked_at) values ($1, $2, $3, $4, $5, $6) returning id",
    [pid, o.due ?? iso(60e3), o.scenario ?? "relance_j2", o.canal ?? "whatsapp", o.attempts ?? 0, o.locked ?? null]));
const fu = async (id: string) => await one("select statut, attempts, locked_at is not null as verrou, last_error, due_at > now() + interval '9 minutes' as plus_tard, due_at > now() + interval '59 minutes' as dans_une_heure, due_at <= now() as echue from ai_followups where id = $1", [id]);
const runner = (calls: string[], err: (scenario: string) => Error | null = () => null) => async (f: { id: string; scenario: string }) => { calls.push(f.scenario); const e = err(f.scenario); if (e) throw e; };

T("S2 · relances : réservation atomique, clôture, annulation, mise en veille, appel humain", async () => {
  await freshDb();
  const calls: string[] = [];
  const ok = await mkFollowup(await mkProspect(), { scenario: "ok" });
  const optout = await mkFollowup(await mkProspect({ opt_out: true }), { scenario: "optout" });
  const perdu = await mkFollowup(await mkProspect({ stage: "perdu" }), { scenario: "perdu" });
  const pv = await mkProspect({ relances_sans_reponse: MAX_RELANCES });
  const veille = await mkFollowup(pv, { scenario: "veille" });
  const tel = await mkFollowup(await mkProspect(), { scenario: "appel", canal: "telephone" });
  const futur = await mkFollowup(await mkProspect(), { scenario: "futur", due: new Date(Date.now() + 86400e3).toISOString() });

  const r = await tickFollowups(runner(calls));
  eq(r, { traites: 2, mis_en_veille: 1, ignores: 2, reprogrammes: 0 }, "bilan du passage");
  eq(calls, ["ok"], "seule la relance par message appelle l'agent");
  eq((await fu(ok)).statut, "faite", "relance faite"); eq((await fu(ok)).verrou, false, "verrou levé");
  eq((await fu(optout)).statut, "annulee", "désinscrit : annulée"); eq((await fu(perdu)).statut, "annulee", "prospect perdu : annulée");
  eq((await fu(veille)).statut, "annulee", "limite de relances : annulée");
  eq(await val("select stage from ai_prospects where id = $1", [pv]), "en_veille", "prospect mis en veille");
  eq(Number(await val("select count(*) from ai_approvals where type = 'transfert_humain'")), 1, "appel confié à un humain");
  eq((await fu(tel)).statut, "faite", "appel : faite");
  eq((await fu(futur)).statut, "planifiee", "relance future : intacte");
  eq((await tickFollowups(runner(calls))), { traites: 0, mis_en_veille: 0, ignores: 0, reprogrammes: 0 }, "second passage : rien à faire");
  eq(calls.length, 1, "aucune exécution en double");
});

T("S3 · relances : erreurs, attente croissante, annulation après 5 tentatives, pannes IA sans perte", async () => {
  await freshDb();
  // Erreur ordinaire : reprogrammée (5 · 2ⁿ minutes), tentative comptée, erreur conservée
  const f1 = await mkFollowup(await mkProspect(), { scenario: "bug" });
  const calls: string[] = [];
  eq((await tickFollowups(runner(calls, () => new Error("réponse corrompue")))).reprogrammes, 1, "une relance reprogrammée");
  let r = await fu(f1);
  eq([r.statut, r.attempts, r.verrou, r.plus_tard, r.dans_une_heure], ["planifiee", 1, false, true, false], "attente de 10 min, tentative comptée");
  assert(String(r.last_error).includes("corrompue"), "dernière erreur conservée");
  eq((await tickFollowups(runner(calls))).traites, 0, "pas rejouée avant son échéance"); eq(calls.length, 1, "un seul essai");

  // 5e tentative en erreur : annulée définitivement
  const f2 = await mkFollowup(await mkProspect(), { scenario: "bug5", attempts: 4 });
  await tickFollowups(runner(calls, (s) => s === "bug5" ? new Error("toujours en erreur") : null));
  eq((await fu(f2)).statut, "annulee", "5 erreurs : annulée");
  assert(Number(await val("select count(*) from ai_actions where action = 'tick_erreur'")) >= 2, "erreurs journalisées");

  // Pannes IA (fournisseur, budget, clé absente) : tentative rendue, une heure d'attente, rien d'autre n'est consommé
  for (const [nom, E] of [["fournisseur", TransientLlmError], ["budget", BudgetError], ["clé IA absente", LlmKeyMissingError]] as const) {
    await freshDb();
    const lot = [] as string[];
    for (let i = 0; i < 3; i++) lot.push(await mkFollowup(await mkProspect(), { scenario: `p${i}`, due: iso((10 - i) * 60e3) }));   // p0 la plus ancienne
    const seen: string[] = [];
    const res = await tickFollowups(runner(seen, () => new E("indisponible")));
    eq(res, { traites: 0, mis_en_veille: 0, ignores: 0, reprogrammes: 1 }, `${nom} : arrêt après la première panne`);
    eq(seen, ["p0"], `${nom} : une seule exécution tentée`);
    const a = await fu(lot[0]);
    eq([a.statut, a.attempts, a.verrou, a.dans_une_heure], ["planifiee", 0, false, true], `${nom} : tentative rendue, reprise dans une heure`);
    for (const id of lot.slice(1)) { const b = await fu(id); eq([b.statut, b.attempts, b.verrou, b.echue], ["planifiee", 0, false, true], `${nom} : relances non traitées rendues intactes`); }
    const next: string[] = [];
    eq((await tickFollowups(runner(next))).traites, 2, `${nom} : le passage suivant les traite`); eq(next, ["p1", "p2"], `${nom} : dans l'ordre`);
  }
});

T("S4 · relances : concurrence, verrou expiré, aucun double envoi après une reprise", async () => {
  await freshDb();
  // Deux passages simultanés : chaque relance est prise une seule fois
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) ids.push(await mkFollowup(await mkProspect(), { scenario: `c${i}` }));
  const calls: string[] = [];
  const slow = async (f: { scenario: string }) => { calls.push(f.scenario); await new Promise((r) => setTimeout(r, 30)); };
  await Promise.all([tickFollowups(slow, 3), tickFollowups(slow, 3)]);
  eq([...calls].sort(), ["c0", "c1", "c2", "c3", "c4", "c5"], "6 relances, 6 exécutions, aucune en double");
  eq(Number(await val("select count(*) from ai_followups where statut = 'faite'")), 6, "toutes faites");

  // Verrou posé depuis plus de 10 minutes (fonction interrompue) : la relance est reprise, tentative comptée
  const stuck = await mkFollowup(await mkProspect(), { scenario: "bloquee", locked: iso(11 * 60e3), attempts: 1 });
  const young = await mkFollowup(await mkProspect(), { scenario: "verrou_recent", locked: iso(2 * 60e3), attempts: 1 });
  const seen: string[] = [];
  await tickFollowups(runner(seen));
  eq(seen, ["bloquee"], "verrou expiré repris, verrou récent respecté");
  eq((await fu(young)).statut, "planifiee", "relance verrouillée récemment : laissée en l'état");
  eq((await fu(stuck)).statut, "faite", "relance reprise : faite");

  // Reprise après un envoi déjà parti (l'agent a écrit puis la fonction a été interrompue) : pas de second message
  const p = await mkProspect();
  const dup = await mkFollowup(p, { scenario: "doublon", attempts: 1 });
  await sql("insert into ai_messages(prospect_id, canal, sens, auteur, contenu, statut) values ($1, 'email', 'sortant', 'agent', 'Relance déjà envoyée', 'envoye')", [p]);
  const again: string[] = [];
  const res = await tickFollowups(runner(again));
  eq([again, res.traites], [[], 1], "aucun nouvel appel à l'agent");
  eq((await fu(dup)).statut, "faite", "relance close");
  eq(Number(await val("select count(*) from ai_actions where action = 'relance_deja_envoyee'")), 1, "protection journalisée");
  // Première tentative : pas de contrôle (un message ancien n'empêche pas la relance)
  const p2 = await mkProspect();
  await mkFollowup(p2, { scenario: "premiere" });
  await sql("insert into ai_messages(prospect_id, canal, sens, auteur, contenu, statut) values ($1, 'email', 'sortant', 'agent', 'Premier contact', 'envoye')", [p2]);
  const first: string[] = [];
  await tickFollowups(runner(first));
  eq(first, ["premiere"], "première tentative : relance exécutée");
  assert((await rows("select 1 from ai_followups where statut = 'planifiee' and locked_at is not null and id <> $1", [young])).length === 0, "aucun verrou oublié (hors le verrou récent voulu)");
});

T("cleanup", async () => { await dropAll(); });
