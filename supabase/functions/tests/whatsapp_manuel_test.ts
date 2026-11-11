// WhatsApp en mode manuel (sans clé d'API) : le message approuvé reste « a_envoyer », un opérateur l'envoie lui-même et le confirme ; rien n'est jamais marqué envoyé sans lui.
import pg from "npm:pg@8.13.1";
import { assert, dropAll, eq, freshDb, president, rejects, rows, val } from "./testkit.ts";
import { sql } from "./fake_supabase.ts";
import { flushOutbox } from "../_shared/outbox.ts";

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const COMMERCIAL = "22222222-2222-2222-2222-222222222222", INCONNU = "33333333-3333-3333-3333-333333333333";

async function as(uid: string, text: string, params: unknown[] = []): Promise<Record<string, any>[]> {
  const db = String(await val("select current_database()"));
  const c = new pg.Client({ host: "127.0.0.1", port: Number(Deno.env.get("TEST_PG_PORT") ?? 5499), user: "postgres", database: db });
  await c.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [uid]);
    const r = await c.query(text, params); await c.query("commit"); return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { await c.end(); }
}
const rpc = async (uid: string, call: string, params: unknown[] = []) => (await as(uid, `select ${call} as v`, params))[0].v;

async function world() {
  await freshDb(); await president();
  await sql("insert into auth.users(id) values ($1), ($2) on conflict do nothing", [COMMERCIAL, INCONNU]);
  await sql("insert into ai_operators(user_id, nom, role) values ($1, 'Aïcha Commercial', 'commercial')", [COMMERCIAL]);
  await sql("grant select on all tables in schema public to authenticated");
  await sql("insert into ai_prospects(entreprise, telephone, stage) values ('Ferme Test', '07 08 24 13 36', 'enregistre')");
  await sql("insert into ai_prospects(entreprise, telephone, stage, opt_out) values ('Ferme Désinscrite', '07 00 00 00 01', 'enregistre', true)");
}
const prospect = async (nom: string) => String(await val("select id from ai_prospects where entreprise = $1", [nom]));
const queue = async (pid: string, contenu = "Bonjour, je vous présente AvicoSuite.") =>
  Number(await val("insert into ai_messages(prospect_id, canal, sens, auteur, contenu, statut, meta) values ($1, 'whatsapp', 'sortant', 'agent', $2, 'a_envoyer', '{\"objet\": null}') returning id", [pid, contenu]));

T("WM1 · sans clé d'API WhatsApp, le traitement automatique ne touche pas aux messages en attente (pas de course avec l'opérateur)", async () => {
  await world(); Deno.env.delete("WHATSAPP_TOKEN"); Deno.env.delete("WHATSAPP_PHONE_NUMBER_ID");
  const id = await queue(await prospect("Ferme Test"));
  const r = await flushOutbox();
  eq(r.envoyes, 0, "aucun envoi automatique"); eq(r.en_file, 1, "le message reste en file");
  const m = (await rows("select statut, meta from ai_messages where id = $1", [id]))[0];
  eq(m.statut, "a_envoyer", "statut inchangé"); assert(!("detail" in m.meta), "aucune écriture parasite dans le message");
  await dropAll();
});

T("WM2 · l'opérateur confirme l'envoi : message « envoyé » (mode manuel), relance comptée, journal ; une seconde confirmation est refusée", async () => {
  await world(); const pid = await prospect("Ferme Test"), id = await queue(pid);
  const r = await rpc(COMMERCIAL, "ai_wa_marquer_envoye($1, 'envoyé depuis mon mobile')", [id]);
  eq(r.ok, true, "confirmation acceptée");
  const m = (await rows("select statut, meta from ai_messages where id = $1", [id]))[0];
  eq(m.statut, "envoye", "statut envoyé"); eq(m.meta.mode, "manuel", "mode manuel"); eq(m.meta.envoye_par, COMMERCIAL, "auteur de l'envoi conservé"); eq(m.meta.note, "envoyé depuis mon mobile", "note conservée");
  const p = (await rows("select relances_sans_reponse r, last_outbound_at is not null o from ai_prospects where id = $1", [pid]))[0];
  eq(p.r, 1, "relance comptée"); eq(p.o, true, "dernier envoi daté");
  eq(await val("select count(*)::int from ai_actions where action = 'message_sortant_manuel' and prospect_id = $1", [pid]), 1, "opération journalisée");
  await rejects(() => rpc(COMMERCIAL, "ai_wa_marquer_envoye($1)", [id]), "plus en attente", "un message déjà envoyé ne se confirme pas deux fois");
  await dropAll();
});

T("WM3 · garde-fous : opérateurs seulement, prospect désinscrit refusé, message d'un autre canal ou inexistant refusé", async () => {
  await world(); const id = await queue(await prospect("Ferme Test")), idOpt = await queue(await prospect("Ferme Désinscrite"));
  await rejects(() => rpc(INCONNU, "ai_wa_marquer_envoye($1)", [id]), "opérateurs", "un compte non opérateur est refusé");
  await rejects(() => rpc(COMMERCIAL, "ai_wa_marquer_envoye($1)", [idOpt]), "désinscrit", "un prospect désinscrit ne peut pas être marqué contacté");
  await rejects(() => rpc(COMMERCIAL, "ai_wa_marquer_envoye($1)", [999999]), "introuvable", "message inexistant refusé");
  const mail = Number(await val("insert into ai_messages(prospect_id, canal, sens, auteur, contenu, statut) values ($1, 'email', 'sortant', 'agent', 'x', 'a_envoyer') returning id", [await prospect("Ferme Test")]));
  await rejects(() => rpc(COMMERCIAL, "ai_wa_marquer_envoye($1)", [mail]), "introuvable", "un message e-mail n'entre pas dans le circuit WhatsApp manuel");
  eq(await val("select statut from ai_messages where id = $1", [id]), "a_envoyer", "rien n'a bougé");
  await dropAll();
});

T("WM4 · « ne pas envoyer » : message abandonné avec son motif, jamais compté comme contact", async () => {
  await world(); const pid = await prospect("Ferme Test"), id = await queue(pid);
  await rpc(COMMERCIAL, "ai_wa_annuler($1, 'numéro erroné')", [id]);
  const m = (await rows("select statut, meta from ai_messages where id = $1", [id]))[0];
  eq(m.statut, "echec", "statut échec"); eq(m.meta.motif, "numéro erroné", "motif conservé");
  eq(await val("select relances_sans_reponse from ai_prospects where id = $1", [pid]), 0, "aucune relance comptée");
  eq(await val("select last_outbound_at is null from ai_prospects where id = $1", [pid]), true, "aucun contact daté");
  await dropAll();
});

T("WM5 · réponse saisie à la main : fil de conversation, fenêtre de 24 h ouverte, relances remises à zéro ; « STOP » désinscrit", async () => {
  await world(); const pid = await prospect("Ferme Test"), id = await queue(pid);
  await rpc(COMMERCIAL, "ai_wa_marquer_envoye($1)", [id]);
  const r = await rpc(COMMERCIAL, "ai_wa_reponse($1, 'Oui, envoyez-moi la démo')", [pid]);
  eq(r.ok, true, "réponse enregistrée"); eq(r.desinscrit, false, "pas de désinscription");
  const m = (await rows("select sens, auteur, statut from ai_messages where prospect_id = $1 and sens = 'entrant'", [pid]))[0];
  eq(`${m.sens}/${m.auteur}/${m.statut}`, "entrant/prospect/recu", "message entrant au fil de conversation");
  const p = (await rows("select relances_sans_reponse r, last_inbound_at is not null i from ai_prospects where id = $1", [pid]))[0];
  eq(p.r, 0, "relances remises à zéro"); eq(p.i, true, "fenêtre de 24 h ouverte");
  const s = await rpc(COMMERCIAL, "ai_wa_reponse($1, 'STOP')", [pid]);
  eq(s.desinscrit, true, "« STOP » : désinscription (déclencheur existant)");
  eq(await val("select opt_out from ai_prospects where id = $1", [pid]), true, "prospect désinscrit");
  await rejects(() => rpc(COMMERCIAL, "ai_wa_reponse($1, '  ')", [pid]), "vide", "réponse vide refusée");
  await dropAll();
});
