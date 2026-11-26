// JARVIS — assistant conversationnel de la Salle de contrôle (JWT opérateur « direction »).
// Corps : { message, history?, context } → { reply, actions }. Modèle Sonnet, budget IA appliqué par callClaude.
import { audit, cors, db, errMsg, HttpError, json, requireOperator } from "../_shared/core.ts";
import { BudgetError, callClaude, LlmKeyMissingError, ProviderBillingError, ProviderConfigurationError, TransientLlmError } from "../_shared/llm.ts";
import { buildContext, cleanHistory, JARVIS_FORMAT, type JarvisAction, knownCrmIds, knownIds, parseReply, SYSTEM } from "../_shared/company/jarvis.ts";
import { commissions, compta, FINANCE_LIMITES, knownFinanceIds, levee } from "../_shared/company/jarvis_finance.ts";


// Financial snapshot is built server-side after requireOperator: never trust browser-supplied financial figures.
function asksFinance(message: string): boolean {
  const q = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return /(^| )(ca|chiffre d affaires|chiffre affaires|chiffre affaire|chiffres affaires|vente|ventes|commande|commandes|encaissement|encaissements|acompte|acomptes|solde|soldes|facture|factures|finance|financier|financiere|tresorerie|depense|depenses|charge|charges|marge|rentabilite|paiement|paiements|budget|comptabilite|ecriture|ecritures|benefice|profit|resultat|commission|commissions|levee|financeur|financeurs|financement|tva|creance|creances|syscohada|journal|balance|grand livre|sig|fec|investisseur|investisseurs|subvention|banque|banques)( |$)/.test(q);
}
async function loadFinanceSnapshot(message = ""): Promise<Record<string, unknown>> {
  const ENT = ["commandes", "ecritures", "documents", "pil_depenses", "pil_config"], CAP = 1500;
  const res = await Promise.all(ENT.map((e) => db().from("crm_records").select("entity,rid,data,updated_at").eq("entity", e).is("deleted_at", null).limit(CAP + 1)));
  const tronque: string[] = [];
  const rows: { entity: string; data: Record<string, unknown> | null }[] = [];
  res.forEach((r, i) => { if (r.error) throw r.error; const l = (r.data ?? []) as typeof rows; if (l.length > CAP) tronque.push(ENT[i]); rows.push(...l.slice(0, CAP)); });
  const by = (entity: string) => rows.filter(r => r.entity === entity).map(r => r.data ?? {});
  const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, n) : 0; };
  const date = (v: unknown): string => /^\d{4}-\d{2}-\d{2}/.test(String(v ?? "")) ? String(v).slice(0, 10) : "";
  const sum = <T>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);
  const period = <T extends { date?: unknown }>(a: T[], f: (x: T) => number, from: string, to: string) =>
    sum(a.filter(x => date(x.date) && date(x.date) >= from && date(x.date) <= to), f);
  const orders = by("commandes").filter(d => ["confirmee", "en_cours", "livree"].includes(String(d.statut ?? "").toLowerCase()));
  const expenses = by("pil_depenses"), entries = by("ecritures"), docs = by("documents"), config = by("pil_config")[0] ?? {};
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Abidjan", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (k: string) => parts.find(p => p.type === k)?.value ?? "";
  const today = part("year") + "-" + part("month") + "-" + part("day"), month = today.slice(0, 7), year = today.slice(0, 4);
  const daysAgo = (n: number) => {
    const d = new Date(now.getTime() - n * 864e5);
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Abidjan", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const v = (k: string) => p.find(x => x.type === k)?.value ?? "";
    return v("year") + "-" + v("month") + "-" + v("day");
  };
  const ht = (d: Record<string, unknown>) => num(d.htNet) || (num(d.ttc) ? Math.round(num(d.ttc) / 1.18) : 0);
  const monthOrders = orders.filter(d => date(d.date).startsWith(month)), ytdOrders = orders.filter(d => date(d.date).startsWith(year));
  const productMap = new Map<string, number>(), statusMap: Record<string, number> = {};
  for (const d of orders) {
    const product = String(d.logiciel ?? "Non renseigné").slice(0, 60);
    productMap.set(product, (productMap.get(product) ?? 0) + ht(d));
    const status = String(d.statut ?? "inconnu"); statusMap[status] = (statusMap[status] ?? 0) + 1;
  }
  const payments = orders.flatMap(d => (Array.isArray(d.paiements) ? d.paiements as Record<string, unknown>[] : [])
    .filter(p => p && p.estimee !== true && p.estimee !== "true")
    .map(p => ({ date: date(p.date), montant: num(p.montant) }))).filter(p => p.date);
  const advances = sum(orders, d => num(d.acompte)), balances = sum(orders, d => num(d.solde));
  const monthExpenses = expenses.filter(d => String(d.mois ?? "") === month);
  const objectiveRaw = config["obj_" + month], objective = objectiveRaw == null || objectiveRaw === "" ? null : num(objectiveRaw);
  const [costRowsResult, budgetResult] = await Promise.all([
    db().from("ai_actions").select("cout_usd").eq("action", "llm_turn").gte("at", month + "-01T00:00:00Z").limit(5000),
    db().from("ai_governance").select("budget_mois_usd").eq("id", 1).maybeSingle(),
  ]);
  // Onglets Comptabilité, Commissions et Levée de fonds : calculés côté serveur (jamais à partir de chiffres fournis par le navigateur)
  const lite = await db().from("crm_records").select("entity,client:data->>client,commercial:data->>commercial,logiciel:data->>logiciel,stage:data->>stage,tva:data->>tva,date:data->>date,statut:data->>statut,montant:data->>montant,cmdId:data->>cmdId")
    .in("entity", ["deals", "contrats", "config"]).is("deleted_at", null).limit(4000);
  const lr = (lite.data ?? []) as unknown as Record<string, unknown>[], of = (e: string) => lr.filter((r) => r.entity === e);
  const tva = Number(of("config")[0]?.tva) || 18;
  const [fin, con, bro] = await Promise.all([
    db().from("levee_financeurs").select("id,nom,type,pays,region,statut,pertinence,ticket_min,ticket_max,devise,notes").limit(1000),
    db().from("levee_contacts").select("id,financeur_id").limit(3000), db().from("levee_brouillons").select("id,financeur_id,canal,objet,statut,created_at").limit(1000)]);
  const ordersFull = by("commandes"), contrats = of("contrats").map((r) => ({ ...r, cmdId: r.cmdId || undefined }));
  const extra = {
    compta_syscohada: compta({ commandes: ordersFull, contrats, tva }),
    commissions: commissions({ deals: of("deals"), commandes: ordersFull, tva }),
    levee: fin.error ? { disponible: false } : levee({ financeurs: fin.data ?? [], contacts: con.data ?? [], brouillons: bro.data ?? [] }, message),
  };
  const costRows = costRowsResult.error ? null : (costRowsResult.data ?? []);
  const aiBudget = budgetResult.error ? null : budgetResult.data?.budget_mois_usd ?? null;
  return {
    // Mises en garde en PREMIER : la sérialisation bornée coupe la fin, jamais les limites.
    limites: [
      ...(tronque.length ? ["ATTENTION : données tronquées à " + CAP + " lignes pour : " + tronque.join(", ") + ". Les totaux sont INCOMPLETS : dis-le."] : []),
      "CA calculé sur htNet, ou TTC/1,18 si HT absent, pour les commandes confirmées, en cours ou livrées.",
      "Encaissements calculés uniquement sur les paiements datés non estimés ; acomptes déclarés présentés séparément.",
      "Solde à recouvrer issu du champ solde des commandes, sans rapprochement bancaire.",
      "Dépenses limitées aux lignes saisies dans Budget & actions ; les écritures comptables ne sont pas agrégées.",
      "Aucun bénéfice net, trésorerie bancaire ou marge par logiciel ne peut être déduit de ces seuls champs.",
      "Coûts IA en USD, séparés des montants FCFA.",
      ...FINANCE_LIMITES,
    ],
    ...extra, disponible: true, devise: "FCFA", date_analyse: today, mois: month,
    commandes: {
      nombre: orders.length, ca_ht_total: sum(orders, ht), ca_ht_mois: sum(monthOrders, ht),
      ca_ht_30_jours: period(orders, ht, daysAgo(30), today), ca_ht_90_jours: period(orders, ht, daysAgo(90), today),
      ca_ht_annee: sum(ytdOrders, ht),
      par_logiciel: [...productMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([logiciel, ca_ht]) => ({ logiciel, ca_ht })),
      par_statut: statusMap,
    },
    encaissements: {
      lignes_paiement_datees: payments.length, total_confirme: sum(payments, p => p.montant),
      mois: period(payments, p => p.montant, month + "-01", today), "90_jours": period(payments, p => p.montant, daysAgo(90), today),
      acomptes_declares_commandes: advances, solde_a_recouvrer_declare: balances,
    },
    depenses_gestion: {
      lignes_mois: monthExpenses.length, reel_mois: sum(monthExpenses, d => num(d.reel)),
      prevision_mois: sum(monthExpenses, d => num(d.prevu)),
    },
    objectif_ca_ht_mois: objective,
    comptabilite: { ecritures_enregistrees: entries.length, factures_documents: docs.filter(d => String(d.type ?? "").toLowerCase() === "facture").length },
    couts_ia: { mois_usd: costRows === null ? null : sum(costRows, r => num(r.cout_usd)), budget_mois_usd: aiBudget === null ? null : num(aiBudget), lignes: costRows?.length ?? null },
  };
}

const LIMITE_PAR_MIN = 15, MAX_CORPS = 200_000;
/** #6 : limite de débit par opérateur (journal ai_actions : partagé entre instances). */
async function limiter(userId: string): Promise<void> {
  const depuis = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db().from("ai_actions").select("id", { count: "exact", head: true })
    .eq("action", "jarvis_appel").eq("payload->>par", userId).gte("at", depuis);
  if ((count ?? 0) >= LIMITE_PAR_MIN) throw new HttpError(429, "Trop de demandes : patientez une minute");
  await audit({ agent: "jarvis", action: "jarvis_appel", ok: true, payload: { par: userId } });
}
/** #4 : les identifiants proposés par le modèle sont revalidés en base (le contexte vient du navigateur). */
async function revalider(actions: JarvisAction[]): Promise<JarvisAction[]> {
  const agentIds = new Set<string>(), rids = new Set<string>();
  for (const a of actions) {
    if ("agent_id" in a && a.agent_id) agentIds.add(a.agent_id);
    if ("rids" in a && a.type.startsWith("crm_")) a.rids.forEach((r) => rids.add(r));
  }
  const [ag, cl] = await Promise.all([
    agentIds.size ? db().from("ai_agents").select("id").in("id", [...agentIds]).neq("etat", "archive") : Promise.resolve({ data: [] }),
    rids.size ? db().from("crm_records").select("rid").eq("entity", "clients").is("deleted_at", null).in("rid", [...rids]) : Promise.resolve({ data: [] }),
  ]);
  const okA = new Set(((ag.data ?? []) as { id: string }[]).map((x) => x.id)), okC = new Set(((cl.data ?? []) as { rid: string }[]).map((x) => x.rid));
  const out: JarvisAction[] = [];
  for (const a of actions) {
    if ("agent_id" in a && a.agent_id && !okA.has(a.agent_id)) continue;
    if ("rids" in a && a.type.startsWith("crm_")) { const r = a.rids.filter((x) => okC.has(x)); if (!r.length) continue; out.push({ ...a, rids: r } as JarvisAction); continue; }
    out.push(a);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);
  try {
    const op = await requireOperator(req);
    if (op.role === "commercial") throw new HttpError(403, "Réservé à la direction");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_CORPS) throw new HttpError(413, "Requête trop volumineuse");
    const raw = await req.text();
    if (raw.length > MAX_CORPS) throw new HttpError(413, "Requête trop volumineuse");
    const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })() as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length < 1) throw new HttpError(400, "Message vide");
    if (message.length > 1500) throw new HttpError(400, "Message trop long");
    await limiter(op.user_id);
    const history = cleanHistory(body.history);
    const context = body.context && typeof body.context === "object" ? { ...(body.context as Record<string, unknown>) } : {};
    delete context.finance; // les chiffres financiers fournis par le navigateur ne sont jamais fiables
    if (asksFinance(message)) {
      try { context.finance = await loadFinanceSnapshot(message); await audit({ agent: "jarvis", action: "jarvis_lecture_finance", ok: true, payload: { par: op.user_id } }).catch(() => {}); }
      catch (e) { context.finance = { disponible: false }; await audit({ agent: "jarvis", action: "jarvis_finance_erreur", ok: false, payload: { par: op.user_id, e: errMsg(e) } }).catch(() => {}); }
    }
    const user = `CONTEXTE EN DIRECT\n${buildContext(context)}\n\nDEMANDE DU PRÉSIDENT : ${message}`;
    const messages = [...history, { role: "user" as const, content: user }];
    const { message: out } = await callClaude({
      label: "jarvis", system: SYSTEM, messages, model: "claude-sonnet-5-5", effort: "low", maxTokens: 2500,
      format: JARVIS_FORMAT as unknown as Record<string, unknown>,
    });
    const text = out.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const r = parseReply(text, knownIds(context), knownCrmIds(context), knownFinanceIds(context.finance));
    r.actions = await revalider(r.actions);
    await audit({ agent: "jarvis", action: "jarvis_reponse", ok: true, payload: { par: op.user_id, nb_actions: r.actions.length, types: r.actions.map((a) => a.type), finance: !!context.finance } });
    return json(req, r, 200);
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
    if (e instanceof BudgetError) return json(req, { error: "Budget IA atteint : " + e.message, code: "budget" }, 429);
    if (e instanceof LlmKeyMissingError || e instanceof ProviderBillingError || e instanceof ProviderConfigurationError) return json(req, { error: e.message, code: "config" }, 503);
    if (e instanceof TransientLlmError) return json(req, { error: "Service IA momentanément indisponible", code: "transient" }, 503);
    await audit({ agent: "jarvis", action: "jarvis_erreur", ok: false, payload: { e: errMsg(e) } }).catch(() => {});
    return json(req, { error: "Erreur Jarvis" }, 500);
  }
});
