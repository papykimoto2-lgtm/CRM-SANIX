// Utilitaires d'interface partagés : gabarit html`` qui échappe tout texte dynamique, formats fr-FR (Africa/Abidjan),
// notifications et fenêtres modales. Aucun état applicatif ici.
export const $ = (s, r = document) => r.querySelector(s);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : esc(v));
/** Gabarit HTML : chaque valeur interpolée est échappée, sauf un autre html`` ou raw(). */
export const html = (s, ...v) => new Raw(s.reduce((a, t, i) => a + t + (i < v.length ? part(v[i]) : ""), ""));
export const raw = (s) => new Raw(s);

export const TZ = "Africa/Abidjan";
export const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }) : "—");
export const fmtD = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { timeZone: TZ, day: "2-digit", month: "long", year: "numeric" }) : "—");
export const num = (n, d = 0) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("fr-FR", { maximumFractionDigits: d }));
export const usd = (n) => `${Number(n ?? 0).toFixed(2)} $`;
export const ago = (iso) => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : `il y a ${Math.floor(s / 86400)} j`;
};
export const clipT = (t, n) => { const s = String(t ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
export const pill = (label, color) => html`<span class="pill" style="--c:${color}"><i></i>${label}</span>`;

/** Notification brève ; `onClick` la rend cliquable (ex. ouvrir le résultat). */
export const toast = (msg, kind = "", onClick = null) => {
  const d = document.createElement("div"); d.textContent = msg; if (kind) d.className = kind;
  if (onClick) { d.style.pointerEvents = "auto"; d.style.cursor = "pointer"; d.onclick = () => { d.remove(); onClick(); }; }
  $("#toast").appendChild(d); setTimeout(() => d.remove(), onClick ? 9000 : 4200);
};

let lastFocus = null, onModalClose = null;
export function openModal(content, { onClose = null } = {}) {
  lastFocus = document.activeElement; onModalClose = onClose;
  $("#modal-box").innerHTML = html`<button class="btn sm close" type="button" data-act="close-modal" aria-label="Fermer">✕</button>${content}`.s;
  $("#modal").hidden = false; $("#modal-box").querySelector("button:not(.close),input,select,textarea")?.focus();
}
export function closeModal() {
  const cb = onModalClose; onModalClose = null;
  $("#modal").hidden = true; $("#modal-box").innerHTML = ""; lastFocus?.focus?.(); cb?.();
}
export function askText(titre, label, { placeholder = "", requis = true } = {}) {
  return new Promise((resolve) => {
    openModal(html`<h3>${titre}</h3><form id="ask"><label class="f">${label}<textarea id="ask-t" rows="3" maxlength="500" placeholder="${placeholder}" ${requis ? "required" : ""}></textarea></label>
      <div class="actions"><button class="btn pri" type="submit">Confirmer</button><button class="btn" type="button" id="ask-no">Annuler</button></div></form>`);
    const done = (v) => { $("#modal").removeEventListener("close-ask", no); closeModal(); resolve(v); };
    const no = () => done(null);
    $("#ask").onsubmit = (e) => { e.preventDefault(); done($("#ask-t").value.trim()); };
    $("#ask-no").onclick = no;
    $("#modal").addEventListener("close-ask", no, { once: true });
  });
}
