// WhatsApp du président : découpage des réponses longues et lecture des messages entrants (fonctions pures).
import { decouper } from "../_shared/company/president_wa_out.ts";
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
