// Rendu HTML du document (compatible clients e-mail : tableaux, styles en ligne, aucun script).
import type { Block, Doc } from "./doc.ts";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const C = { navy: "#1E3A8A", blue: "#2563EB", ink: "#0F172A", mute: "#64748B", line: "#E2E8F0", bg: "#F1F5F9", zebra: "#F8FAFC" };
const FONT = "font-family:'Segoe UI',Helvetica,Arial,sans-serif";

function block(b: Block): string {
  if (b.t === "p") return `<p style="margin:14px 0 6px;font-size:13px;font-weight:700;color:${C.navy}">${esc(b.text)}</p>`;
  if (b.t === "list") {
    return b.items.length
      ? `<ul style="margin:0 0 6px;padding-left:20px;font-size:13px;line-height:1.55;color:${C.ink}">${b.items.map((i) => `<li style="margin:2px 0">${esc(i)}</li>`).join("")}</ul>`
      : `<p style="margin:0 0 6px;font-size:13px;color:${C.mute};font-style:italic">${esc(b.vide ?? "Aucun")}</p>`;
  }
  if (b.t === "kv") {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px">${b.rows.map(([k, v], i) =>
      `<tr style="background:${i % 2 ? C.zebra : "#fff"}"><td style="padding:7px 10px;font-size:13px;color:${C.ink};border-bottom:1px solid ${C.line}">${esc(k)}</td><td align="right" style="padding:7px 10px;font-size:13px;font-weight:700;color:${C.ink};border-bottom:1px solid ${C.line};white-space:nowrap">${esc(v)}</td></tr>`).join("")}</table>`;
  }
  if (!b.rows.length) return `<p style="margin:0;font-size:13px;color:${C.mute};font-style:italic">Aucun agent actif sur la période.</p>`;
  const total = b.widths.reduce((s, w) => s + w, 0);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;margin-bottom:8px"><tr>${b.head.map((h, i) =>
    `<th align="${i < 2 ? "left" : "right"}" style="background:${C.navy};color:#fff;padding:7px 6px;font-weight:600;width:${Math.round(b.widths[i] / total * 100)}%">${esc(h)}</th>`).join("")}</tr>${b.rows.map((r, n) =>
    `<tr style="background:${n % 2 ? C.zebra : "#fff"}">${r.map((c, i) => `<td align="${i < 2 ? "left" : "right"}" style="padding:6px;border-bottom:1px solid ${C.line};color:${C.ink}">${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
}

export function docToHtml(d: Doc): string {
  const kpis = d.kpis.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin:16px -8px 4px"><tr>${d.kpis.map(([k, v]) =>
    `<td align="center" style="background:${C.bg};border-radius:10px;padding:14px 6px;width:${Math.floor(100 / d.kpis.length)}%"><div style="font-size:20px;font-weight:800;color:${C.navy}">${esc(v)}</div><div style="font-size:11px;color:${C.mute};margin-top:3px">${esc(k)}</div></td>`).join("")}</tr></table>` : "";
  const sections = d.sections.map((s) => `<h2 style="margin:26px 0 8px;font-size:14px;letter-spacing:.4px;color:#fff;background:${C.blue};padding:8px 12px;border-radius:6px">${esc(s.titre)}</h2>${s.blocks.map(block).join("")}`).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.titre)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};${FONT}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;background:#fff;border-radius:12px;overflow:hidden"><tr><td style="background:${C.navy};padding:24px 28px">
<div style="font-size:11px;letter-spacing:1.5px;color:#93C5FD">SANIX AFRICA DIVISION TECHNOLOGIES</div>
<h1 style="margin:6px 0 4px;font-size:20px;line-height:1.3;color:#fff">${esc(d.titre)}</h1><div style="font-size:14px;color:#DBEAFE">${esc(d.sousTitre)}</div></td></tr>
<tr><td style="padding:8px 28px 28px;color:${C.ink}">${kpis}${sections}<p style="margin:28px 0 0;padding-top:14px;border-top:1px solid ${C.line};font-size:11px;color:${C.mute}">${esc(d.pied)}</p></td></tr></table></td></tr></table></body></html>`;
}
