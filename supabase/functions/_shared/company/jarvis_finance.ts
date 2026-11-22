// Module Finance de Jarvis : calculs purs (sans Deno ni réseau, testables avec Node) appliqués côté serveur aux données du CRM.
// Règles reprises du CRM : CA = HT des commandes confirmées / en cours / livrées ; encaissements = journal des paiements de chaque commande
// (une écriture par paiement, plafonnée au TTC) ; commission = 5 % (salarié) ou 10 % (apporteur) du HT des commandes du client gagné.
// Ce que le CRM garde dans le navigateur (écritures manuelles, statuts de commissions, modèle Financement, configuration locale de la levée)
// n'est PAS lisible ici : l'instantané le déclare dans `limites`, Jarvis ne l'invente pas.
type R = Record<string, unknown>;
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nrm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const key = (s: unknown) => nrm(s).replace(/[^a-z0-9]/g, "");
const clip = (s: unknown, n: number) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const CA_STATUTS = ["confirmee", "en_cours", "livree"];
export const LEVEE_STATUTS = ["a_etudier", "correspond", "contacte", "en_discussion", "decline", "ecarte", "investi"] as const;
export const BROUILLON_STATUTS = ["valide", "abandonne"] as const;   // « envoye » = envoi réel : jamais fait par Jarvis
const MODE_COMPTE: Record<string, string> = { especes: "571000", mobile_money: "552000", virement: "521000", cheque: "521000", nature: "471000", inconnu: "552000" };

export const cmdHT = (c: R, tva = 18): number => { const ttc = num(c.ttc), ht = num(c.htNet); return ht > 0 ? ht : c.sansTva ? ttc : Math.round(ttc / (1 + tva / 100)); };
/** Paiements d'une commande (comme SanixPaiements.liste) : journal sans les lignes supprimées, sinon l'ancien acompte compte comme un paiement « mode non précisé ». */
export function paiementsDe(c: R): { montant: number; mode: string }[] {
  const mode = (m: unknown) => (typeof m === "string" && MODE_COMPTE[m] ? m : "inconnu");
  if (Array.isArray(c.paiements)) return (c.paiements as R[]).filter((p) => p && !p.supprime && num(p.montant) > 0).map((p) => ({ montant: num(p.montant), mode: mode(p.mode) }));
  return num(c.acompte) > 0 ? [{ montant: num(c.acompte), mode: "inconnu" }] : [];
}

export function compta(o: { commandes?: R[]; contrats?: R[]; tva?: number; annee?: number; now?: Date } = {}) {
  const tva = o.tva ?? 18, now = o.now ?? new Date(), annee = o.annee ?? now.getFullYear();
  const vent = (o.commandes ?? []).filter((c) => CA_STATUTS.includes(String(c.statut)) && num(c.ttc) > 0);
  const ctr = (o.contrats ?? []).filter((c) => ["signe", "en_cours"].includes(String(c.statut)) && !c.cmdId && num(c.montant) > 0);
  const solde: Record<string, number> = { "411000": 0, "706000": 0, "4431": 0, "521000": 0, "552000": 0, "571000": 0, "471000": 0 };
  const mois: Record<string, number> = {}, parClient: Record<string, number> = {}, parMode: Record<string, number> = {};
  let nEcr = 0, ht = 0, ttcT = 0, tvaT = 0, enc = 0, htAn = 0;
  const addMois = (d: unknown, h: number) => { const k = String(d ?? "").slice(0, 7); if (/^\d{4}-\d{2}$/.test(k)) mois[k] = (mois[k] ?? 0) + h; };
  for (const c of vent) {
    const ttc = num(c.ttc), h = cmdHT(c, tva), t = c.sansTva ? 0 : num(c.tva) || ttc - h, d = String(c.date ?? "");
    solde["411000"] += ttc; solde["706000"] += h; solde["4431"] += t; ht += h; ttcT += ttc; tvaT += t; nEcr++; addMois(d, h); if (d.startsWith(String(annee))) htAn += h;
    let payeC = 0;
    for (const p of paiementsDe(c)) { const m = Math.min(p.montant, Math.max(0, ttc - payeC)); if (m <= 0) continue; payeC += m; enc += m; nEcr++; solde[MODE_COMPTE[p.mode]] += m; solde["411000"] -= m; parMode[p.mode] = (parMode[p.mode] ?? 0) + m; }
    const reste = ttc - payeC; if (reste > 0) { const cl = String(c.client ?? "?"); parClient[cl] = (parClient[cl] ?? 0) + reste; }
  }
  for (const c of ctr) {
    const ttc = num(c.montant), h = Math.round(ttc / (1 + tva / 100)), d = String(c.date ?? "");
    solde["411000"] += ttc; solde["706000"] += h; solde["4431"] += ttc - h; ht += h; ttcT += ttc; tvaT += ttc - h; nEcr++; addMois(d, h); if (d.startsWith(String(annee))) htAn += h;
    const cl = String(c.client ?? "?"); parClient[cl] = (parClient[cl] ?? 0) + ttc;
  }
  const k12 = [...Array(12)].map((_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
  return {
    exercice: annee, nb_ecritures_auto: nEcr, ventes_ht: Math.round(ht), ventes_ht_exercice: Math.round(htAn), tva_collectee: Math.round(tvaT), facture_ttc: Math.round(ttcT),
    encaisse: Math.round(enc), creances_clients: Math.max(0, Math.round(solde["411000"])), tresorerie_encaissee: Math.round(solde["521000"] + solde["552000"] + solde["571000"]),
    attente_nature_471: Math.round(solde["471000"]), encaisse_par_mode: Object.fromEntries(Object.entries(parMode).map(([k, v]) => [k, Math.round(v)])),
    ca_ht_12_derniers_mois: k12.map((k) => ({ mois: k, ht: Math.round(mois[k] ?? 0) })),
    plus_grosses_creances: Object.entries(parClient).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([client, reste]) => ({ client, reste: Math.round(reste) })),
  };
}

export function commissions(o: { deals?: R[]; commandes?: R[]; tva?: number } = {}) {
  const real = (o.commandes ?? []).filter((c) => CA_STATUTS.includes(String(c.statut))), out: R[] = [], vus = new Set<string>();
  for (const d of (o.deals ?? []).filter((x) => x.stage === "gagne")) {
    const k = `${d.client}|${d.commercial ?? ""}`; if (vus.has(k)) continue; vus.add(k);
    const base = real.filter((c) => key(c.client) === key(d.client) && (!d.logiciel || c.logiciel === d.logiciel) && !c.renouvellement).reduce((t, c) => t + cmdHT(c, o.tva ?? 18), 0);
    if (!(base > 0)) continue;
    const type = String(d.commercial ?? "").includes("Apporteur") ? "apporteur" : "salarie", taux = type === "apporteur" ? 10 : 5;
    out.push({ commercial: d.commercial || "—", client: d.client, logiciel: d.logiciel || "", base_ht: Math.round(base), taux, montant: Math.round(base * taux / 100) });
  }
  out.sort((a, b) => num(b.montant) - num(a.montant));
  return { nb: out.length, total_calcule: out.reduce((t, x) => t + num(x.montant), 0), liste: out.slice(0, 12), statuts_de_paiement: "non lisibles (enregistrés dans le navigateur du CRM)" };
}

export function levee(d: { financeurs?: R[]; contacts?: R[]; brouillons?: R[] } = {}, msg = "") {
  const fin = d.financeurs ?? [], bro = d.brouillons ?? [];
  const toks = nrm(msg).split(" ").filter((w) => w.length >= 4 && !["jarvis", "levee", "financeur", "financeurs", "fonds", "combien", "situation", "contact", "contacts", "brouillon", "brouillons", "finance", "financement"].includes(w));
  const cnt = (arr: R[], k: string) => arr.reduce((o: Record<string, number>, x) => { const v = String(x[k] ?? "?"); o[v] = (o[v] ?? 0) + 1; return o; }, {});
  const nomF = new Map(fin.map((f) => [String(f.id), String(f.nom)])), line = (f: R) => ({ id: f.id, nom: f.nom, type: f.type, pays: f.pays ?? "", statut: f.statut, pertinence: clip(f.pertinence, 120), ticket: f.ticket_max ? `${f.ticket_min ?? 0}-${f.ticket_max} ${f.devise ?? ""}` : "", notes: clip(f.notes, 160) });
  const hit = (x: unknown, w: string) => { const y = nrm(x).replace(/_/g, " "); return y.includes(w) || (y.length >= 4 && w.startsWith(y)); };   // « banques » retrouve le type « banque »
  return {
    financeurs: { total: fin.length, par_statut: cnt(fin, "statut"), par_type: cnt(fin, "type") }, contacts: (d.contacts ?? []).length, brouillons: { total: bro.length, par_statut: cnt(bro, "statut") },
    a_valider: bro.filter((b) => b.statut === "brouillon").slice(0, 10).map((b) => ({ id: b.id, objet: clip(b.objet, 90), financeur: nomF.get(String(b.financeur_id)) ?? "", canal: b.canal })),
    en_discussion: fin.filter((f) => ["en_discussion", "contacte"].includes(String(f.statut))).slice(0, 10).map(line),
    trouves: fin.filter((f) => toks.some((w) => hit(f.nom, w) || hit(f.type, w) || hit(f.pays, w) || hit(f.statut, w))).slice(0, 12).map(line),
  };
}

export const FINANCE_LIMITES = [
  "Comptabilité calculée depuis les commandes confirmées/en cours/livrées, leurs paiements et les contrats signés ; les écritures manuelles et le grand livre complet ne sont pas lus.",
  "Statuts de paiement des commissions, modèle Financement et configuration locale de la levée : enregistrés dans le navigateur du CRM, non visibles.",
  "Aucune écriture comptable, commission ou paiement n'est modifiable par Jarvis ; la levée de fonds (statut, notes, validation de brouillons) l'est, après confirmation.",
];

/** Ids que Jarvis a le droit de modifier : uniquement ceux de l'instantané construit côté serveur. */
export function knownFinanceIds(finance: unknown): Set<string> {
  const out = new Set<string>(), lv = ((finance ?? {}) as R).levee as R | undefined; if (!lv) return out;
  for (const k of ["a_valider", "en_discussion", "trouves"]) for (const x of Array.isArray(lv[k]) ? lv[k] as R[] : []) { const id = String(x?.id ?? ""); if (id) out.add(id); }
  return out;
}
