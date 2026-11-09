// Rendu PDF du document (pdf-lib, polices standard : accents français, pas d'emoji).
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import type { Block, Doc } from "./doc.ts";

const W = 595.28, H = 841.89, M = 40, CW = W - 2 * M;
const col = {
  navy: rgb(0.118, 0.227, 0.541), blue: rgb(0.145, 0.388, 0.922), ink: rgb(0.06, 0.09, 0.16), mute: rgb(0.39, 0.45, 0.55),
  line: rgb(0.886, 0.91, 0.941), bg: rgb(0.945, 0.961, 0.976), zebra: rgb(0.973, 0.98, 0.988), white: rgb(1, 1, 1),
};

export async function docToPdf(d: Doc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(d.titre); pdf.setAuthor("SANIX AI VIRTUAL COMPANY"); pdf.setCreator("SANIX AI VIRTUAL COMPANY");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ok = new Set(reg.getCharacterSet());
  const clean = (s: string) => String(s ?? "")
    .replace(/[  ]/g, " ").replace(/→/g, "->").replace(/≥/g, ">=").replace(/≤/g, "<=")
    .replace(/[\r\n\t]+/g, " ")
    .split("").filter((c) => ok.has(c.codePointAt(0)!)).join("");

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const need = (h: number) => { if (y - h < M + 24) newPage(); };

  function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = clean(text).split(" ").filter(Boolean);
    const lines: string[] = []; let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) <= width) { cur = t; continue; }
      if (cur) lines.push(cur);
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {   // mot trop long : coupe
        let k = rest.length; while (k > 1 && font.widthOfTextAtSize(rest.slice(0, k), size) > width) k--;
        lines.push(rest.slice(0, k)); rest = rest.slice(k);
      }
      cur = rest;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }
  const para = (text: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; lead?: number } = {}) => {
    const size = o.size ?? 10, font = o.font ?? reg, x = o.x ?? M, width = o.width ?? CW, lead = o.lead ?? size * 1.4;
    for (const ln of wrap(text, font, size, width)) { need(lead); page.drawText(ln, { x, y: y - size, size, font, color: o.color ?? col.ink }); y -= lead; }
  };

  // En-tête
  page.drawRectangle({ x: 0, y: H - 92, width: W, height: 92, color: col.navy });
  page.drawText("SANIX AFRICA DIVISION TECHNOLOGIES", { x: M, y: H - 28, size: 8, font: bold, color: rgb(0.58, 0.77, 0.99) });
  y = H - 38;
  para(d.titre, { size: 15, font: bold, color: col.white, lead: 19 });
  para(d.sousTitre, { size: 11, color: rgb(0.86, 0.92, 0.99) });
  y = H - 92 - 16;

  if (d.kpis.length) {
    const gap = 8, w = (CW - gap * (d.kpis.length - 1)) / d.kpis.length;
    need(56);
    d.kpis.forEach(([k, v], i) => {
      const x = M + i * (w + gap);
      page.drawRectangle({ x, y: y - 50, width: w, height: 50, color: col.bg });
      const vv = clean(v), size = reg.widthOfTextAtSize(vv, 15) > w - 8 ? 11 : 15;
      page.drawText(vv, { x: x + (w - bold.widthOfTextAtSize(vv, size)) / 2, y: y - 24, size, font: bold, color: col.navy });
      const kk = clean(k); page.drawText(kk, { x: x + (w - reg.widthOfTextAtSize(kk, 8)) / 2, y: y - 40, size: 8, font: reg, color: col.mute });
    });
    y -= 64;
  }

  function drawBlock(b: Block) {
    if (b.t === "p") { y -= 6; para(b.text, { size: 10.5, font: bold, color: col.navy }); return; }
    if (b.t === "list") {
      if (!b.items.length) { para(b.vide ?? "Aucun", { size: 9.5, color: col.mute }); return; }
      for (const it of b.items) {
        const lines = wrap(it, reg, 9.5, CW - 16);
        need(lines.length * 13 + 2);
        page.drawText("-", { x: M + 4, y: y - 9.5, size: 9.5, font: reg, color: col.blue });
        for (const ln of lines) { page.drawText(ln, { x: M + 16, y: y - 9.5, size: 9.5, font: reg, color: col.ink }); y -= 13; }
        y -= 2;
      }
      return;
    }
    if (b.t === "kv") {
      b.rows.forEach(([k, v], i) => {
        need(20);
        if (i % 2) page.drawRectangle({ x: M, y: y - 18, width: CW, height: 18, color: col.zebra });
        page.drawText(clean(k), { x: M + 6, y: y - 13, size: 9.5, font: reg, color: col.ink });
        const vv = clean(v); page.drawText(vv, { x: M + CW - 6 - bold.widthOfTextAtSize(vv, 9.5), y: y - 13, size: 9.5, font: bold, color: col.ink });
        y -= 18;
      });
      y -= 6; return;
    }
    if (!b.rows.length) { para("Aucun agent actif sur la période.", { size: 9.5, color: col.mute }); return; }
    const tot = b.widths.reduce((s, w) => s + w, 0), ws = b.widths.map((w) => w / tot * CW), size = 7.5, pad = 3;
    const xs = ws.reduce<number[]>((a, w, i) => (a.push(i ? a[i - 1] + ws[i - 1] : M), a), []);
    const head = () => {
      need(22);
      page.drawRectangle({ x: M, y: y - 18, width: CW, height: 18, color: col.navy });
      b.head.forEach((h, i) => {
        const t = clean(h), x = i < 2 ? xs[i] + pad : xs[i] + ws[i] - pad - bold.widthOfTextAtSize(t, size);
        page.drawText(t, { x, y: y - 12, size, font: bold, color: col.white });
      });
      y -= 18;
    };
    head();
    b.rows.forEach((r, n) => {
      const cells = r.map((c, i) => wrap(c, reg, size, ws[i] - 2 * pad));
      const h = Math.max(...cells.map((l) => l.length)) * 9.5 + 6;
      if (y - h < M + 24) { newPage(); head(); }
      if (n % 2) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: col.zebra });
      cells.forEach((lines, i) => lines.forEach((ln, k) => {
        const x = i < 2 ? xs[i] + pad : xs[i] + ws[i] - pad - reg.widthOfTextAtSize(ln, size);
        page.drawText(ln, { x, y: y - 9.5 - k * 9.5, size, font: reg, color: col.ink });
      }));
      page.drawLine({ start: { x: M, y: y - h }, end: { x: M + CW, y: y - h }, thickness: 0.4, color: col.line });
      y -= h;
    });
    y -= 6;
  }

  for (const s of d.sections) {
    need(60);
    y -= 12;
    page.drawRectangle({ x: M, y: y - 20, width: CW, height: 20, color: col.blue });
    page.drawText(clean(s.titre), { x: M + 8, y: y - 14, size: 10, font: bold, color: col.white });
    y -= 28;
    for (const b of s.blocks) drawBlock(b);
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M - 6 }, end: { x: W - M, y: M - 6 }, thickness: 0.4, color: col.line });
    p.drawText(clean(d.pied).slice(0, 110), { x: M, y: M - 18, size: 6.5, font: reg, color: col.mute });
    const t = `Page ${i + 1}/${pages.length}`; p.drawText(t, { x: W - M - reg.widthOfTextAtSize(t, 7), y: M - 18, size: 7, font: reg, color: col.mute });
  });
  return await pdf.save();
}
