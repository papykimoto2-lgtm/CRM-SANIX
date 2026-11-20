// WhatsApp du président : découpage des réponses longues et lecture des messages entrants (fonctions pures).
import { canonNumero, decouper } from "../_shared/company/president_wa_out.ts";
import { texteEntrant } from "../_shared/company/president_wa.ts";

const T = (name: string, fn: () => void) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

T("un message court n'est pas découpé", () => eq(decouper("Bonjour").length, 1));
T("un long message est découpé en 3 parties au plus, la dernière renvoie au bureau", () => {
  const p = decouper("a".repeat(20000));
  eq(p.length, 3);
  if (p.some((x) => x.length > 3500)) throw new Error("partie trop longue");
  if (!p[2].endsWith("bureau exécutif)")) throw new Error("renvoi au bureau absent");
});
T("texte entrant : texte, bouton, audio", () => {
  eq(texteEntrant({ id: "1", from: "1", timestamp: "1", type: "text", text: { body: " Bonjour " } }), "Bonjour");
  eq(texteEntrant({ id: "1", from: "1", timestamp: "1", type: "button", button: { text: "Oui" } }), "Oui");
  eq(texteEntrant({ id: "1", from: "1", timestamp: "1", type: "audio" }), null);
});
T("numéros ivoiriens : le wa_id de Meta (225 + 8 chiffres) correspond au numéro à 10 chiffres", () => {
  eq(canonNumero("2250102030405"), canonNumero("22502030405"));
  eq(canonNumero("+225 07 00 00 00 00"), "22500000000");
  if (canonNumero("2250102030405") === canonNumero("22502030406")) throw new Error("faux positif");
  eq(canonNumero("33612345678"), "33612345678");
});
