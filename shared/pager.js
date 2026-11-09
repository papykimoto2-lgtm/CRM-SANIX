/* SANIX — pagination générique des tableaux et listes longues (SANIX CRM Pro + SANIX AI VIRTUAL COMPANY).
   Aucune dépendance. Tout <tbody> est paginé automatiquement ; tout autre conteneur : attribut data-paginate.
     data-paginate="pages"   pager numéroté, choix du nombre de lignes (défaut)
     data-paginate="more"    bouton « Afficher plus » (colonnes de kanban, flux)
     data-paginate="off"     exclu (sur le conteneur, sur <table> ou sur un ancêtre)
     data-pg-size="12"       éléments par page au départ (pages) ou affichés au départ (more)
     data-pg-sizes="6,12,24" choix proposés (pages) : grilles de cartes, multiples du nombre de colonnes
     data-pg-item="sel"      sélecteur des éléments (défaut : tous les enfants directs)
   Les éléments masqués par l'application (style.display = 'none', hidden) ne comptent pas : les filtres existants
   continuent de fonctionner. Le rendu de l'application peut remplacer le contenu à tout moment : la page courante est conservée.
   Impression : tout est affiché. */
(function () {
  "use strict";
  if (window.SanixPager) return;
  const KEY = "sanix_pg_size", SIZES = [10, 25, 50, 100], MORE = 20, SEL = "tbody,[data-paginate]";
  let userSize = 25;
  try { const v = Number(localStorage.getItem(KEY)); if (SIZES.includes(v)) userSize = v; } catch (e) { /* stockage indisponible : taille par défaut */ }

  const CSS = `
[data-pg=off]{display:none!important}
.sx-pager{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;padding:10px 2px;margin:6px 0 14px;font-size:12px;line-height:1.2;color:var(--muted,var(--mute,#64748b))}
.sx-pager[hidden]{display:none}
.sx-pages{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.sx-pager button{min-width:32px;height:32px;padding:0 10px;border:1px solid var(--border,var(--line,#e2e8f0));background:var(--surface,var(--s1,#fff));color:var(--text,var(--tx,#0f172a));border-radius:8px;font:600 12px/1 inherit;cursor:pointer;transition:border-color .15s,color .15s,background .15s}
.sx-pager button:hover:not(:disabled){border-color:var(--primary,var(--pri,#2563eb));color:var(--primary,var(--pri,#2563eb))}
.sx-pager button[aria-current=page]{background:var(--primary,var(--pri,#2563eb));border-color:var(--primary,var(--pri,#2563eb));color:#fff}
.sx-pager button:disabled{opacity:.4;cursor:default}
.sx-pager button:focus-visible,.sx-pager select:focus-visible{outline:2px solid var(--primary,var(--pri,#2563eb));outline-offset:2px}
.sx-gap{padding:0 2px}
.sx-size{display:flex;align-items:center;gap:6px;white-space:nowrap}
.sx-size select{height:32px;padding:0 8px;border:1px solid var(--border,var(--line,#e2e8f0));border-radius:8px;background:var(--surface,var(--s1,#fff));color:var(--text,var(--tx,#0f172a));font:600 12px/1 inherit}
.sx-pager.sx-more{justify-content:center;margin:0;padding:8px}
.kanban-col .sx-pager{margin:0;padding:8px;justify-content:center}
@media(max-width:640px){.sx-pager{justify-content:center}.sx-pages button:not([aria-current]):not(.sx-nav){display:none}}
@media print{.sx-pager{display:none!important}}`;

  const memo = new Map();            // id → { page, shown } : l'état survit au remplacement de l'élément par le rendu
  const states = new WeakMap(), live = new Set();
  const nf = (n) => Number(n).toLocaleString("fr-FR");
  const byApp = (r) => r.hidden || r.style.display === "none";
  const sizeOf = (st) => (st.mode === "more" ? st.shown : st.sizes ? st.size : userSize);
  const items = (st) => Array.from(st.el.children).filter((c) => !c.hasAttribute("data-pg-skip") && (!st.item || c.matches(st.item)));

  function adopt(el) {
    if (states.has(el)) return states.get(el);
    if (el.closest("[data-paginate=off]") || (el.tagName === "TBODY" && !el.closest("table"))) return null;
    const mode = el.getAttribute("data-paginate") === "more" ? "more" : "pages";
    const own = (el.getAttribute("data-pg-sizes") || "").split(",").map(Number).filter((v) => v > 0);      // tailles propres au conteneur (sinon : choix global)
    const first = Number(el.getAttribute("data-pg-size")) || 0;
    const st = { el, mode, item: el.getAttribute("data-pg-item") || "", page: 1, shown: first || MORE, sizes: own.length ? own : null, size: own.length ? (first || own[0]) : 0, hidden: new WeakSet(), bar: null, raf: 0, printing: false, sig: "" };
    const old = el.id && memo.get(el.id); if (old) { st.page = old.page; st.shown = old.shown; if (old.size && st.sizes && st.sizes.includes(old.size)) st.size = old.size; }
    states.set(el, st); live.add(st);
    st.obs = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === "childList") { if (r.target === el) return schedule(st); continue; }
        const t = r.target; if (t.parentElement === el && byApp(t) !== st.hidden.has(t)) return schedule(st);
      }
    });
    st.obs.observe(el, { childList: true, attributes: true, attributeFilter: ["style", "hidden"], subtree: true });
    schedule(st);
    return st;
  }
  function release(st) { st.obs.disconnect(); live.delete(st); states.delete(st.el); if (st.bar && st.bar.__st === st) st.bar.remove(); }
  /** Micro-tâche : le rendu s'exécute avant la peinture suivante (aucun flash d'une liste complète). */
  function schedule(st) { if (!st.raf) { st.raf = 1; queueMicrotask(() => render(st)); } }

  /** La barre se place après le tableau (et après son cadre défilant, pour ne pas défiler avec lui). */
  function anchorOf(st) {
    let a = st.el;
    if (a.tagName === "TBODY") {
      a = a.closest("table") || a;
      while (a.parentElement && a.parentElement !== document.body && /(auto|scroll)/.test(getComputedStyle(a.parentElement).overflowX)) a = a.parentElement;
    }
    return a;
  }
  function barOf(st) {
    if (st.bar && st.bar.isConnected && st.bar.__st === st) return st.bar;
    const a = anchorOf(st), next = a.nextElementSibling;
    let bar = next && next.classList.contains("sx-pager") && (!next.__st || !next.__st.el.isConnected) ? next : null;   // barre orpheline d'un rendu précédent
    if (!bar) {
      bar = document.createElement("nav"); bar.className = "sx-pager"; bar.setAttribute("aria-label", "Pagination"); bar.hidden = true;
      bar.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !b.disabled && bar.__st) act(bar.__st, b); });
      bar.addEventListener("change", (e) => {
        if (!e.target.matches("select") || !bar.__st) return;
        const v = Number(e.target.value), st = bar.__st;
        if (st.sizes) { st.size = v; st.page = 1; return render(st); }
        userSize = v; try { localStorage.setItem(KEY, String(userSize)); } catch (x) { /* ignoré */ }
        live.forEach((s) => { if (!s.sizes) { s.page = 1; schedule(s); } });
      });
      a.insertAdjacentElement("afterend", bar);
    }
    bar.__st = st; st.bar = bar; st.sig = "";
    return bar;
  }

  /** Numéros affichés : 1 2 3 4 … 21 · 1 … 9 10 11 … 21 · 1 … 18 19 20 21 (un « … » ne remplace jamais une seule page). */
  function windowOf(cur, total) {
    const a = cur <= 3 ? 1 : cur >= total - 2 ? Math.max(1, total - 3) : cur - 1, b = cur <= 3 ? Math.min(total, 4) : cur >= total - 2 ? total : cur + 1;
    const keep = new Set([1, total]), out = []; let prev = 0;
    for (let p = a; p <= b; p++) keep.add(p);
    for (const p of [...keep].sort((x, y) => x - y)) { if (p - prev === 2) out.push(prev + 1); else if (p - prev > 2) out.push(0); out.push(p); prev = p; }
    return out;
  }

  function render(st, scroll) {
    st.raf = 0;
    const el = st.el;
    if (!el.isConnected) return release(st);
    st.hidden = new WeakSet();
    const vis = [];
    for (const r of items(st)) { if (byApp(r)) { st.hidden.add(r); r.removeAttribute("data-pg"); } else vis.push(r); }
    const n = vis.length, more = st.mode === "more", size = sizeOf(st), opts = st.sizes || SIZES;
    const pages = Math.max(1, Math.ceil(n / size));
    st.page = Math.min(Math.max(1, st.page), pages);
    const paged = !st.printing && n > size, from = more ? 0 : (st.page - 1) * size, to = more ? st.shown : from + size;
    vis.forEach((r, i) => { if (!paged || (i >= from && i < to)) r.removeAttribute("data-pg"); else r.setAttribute("data-pg", "off"); });
    if (el.id) memo.set(el.id, { page: st.page, shown: st.shown, size: st.size });
    if (!paged) { if (st.bar) { st.bar.hidden = true; st.sig = ""; } return; }
    // la barre n'interpole que des nombres calculés ici (aucune donnée de l'application)
    const bar = barOf(st), sig = [more, n, st.page, pages, size, opts.join("-")].join();
    if (sig !== st.sig || bar.hidden) {
      st.sig = sig; bar.hidden = false; bar.classList.toggle("sx-more", more);
      if (more) {
        const rest = n - to;
        bar.innerHTML = `<button type="button" data-a="more">Afficher ${Math.min(MORE, rest)} de plus <span style="font-weight:500;opacity:.75">· ${nf(rest)} restant${rest > 1 ? "s" : ""}</span></button><button type="button" data-a="all">Tout afficher</button>`;
      } else {
        const last = Math.min(n, to), p = st.page;
        const nums = windowOf(p, pages).map((x) => (x ? `<button type="button" data-a="p" data-p="${x}" aria-label="Page ${x}"${x === p ? ' aria-current="page"' : ""}>${x}</button>` : '<span class="sx-gap" aria-hidden="true">…</span>')).join("");
        bar.innerHTML = `<span class="sx-info" aria-live="polite">${nf(from + 1)}–${nf(last)} sur ${nf(n)}</span>
          <div class="sx-pages"><button type="button" class="sx-nav" data-a="prev" aria-label="Page précédente"${p <= 1 ? " disabled" : ""}>‹</button>${nums}<button type="button" class="sx-nav" data-a="next" aria-label="Page suivante"${p >= pages ? " disabled" : ""}>›</button></div>
          <label class="sx-size">Lignes <select aria-label="Lignes par page">${opts.map((s) => `<option value="${s}"${s === size ? " selected" : ""}>${s}</option>`).join("")}</select></label>`;
      }
    }
    if (scroll) { const t = anchorOf(st).getBoundingClientRect(); if (t.top < 0 || t.top > innerHeight * 0.7) anchorOf(st).scrollIntoView({ block: "start", behavior: "smooth" }); }
  }

  function act(st, b) {
    const a = b.dataset.a;
    if (a === "p") st.page = Number(b.dataset.p); else if (a === "prev") st.page--; else if (a === "next") st.page++;
    else if (a === "more") st.shown += MORE; else if (a === "all") st.shown = 1e9;
    render(st, a !== "more" && a !== "all");
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches(SEL)) adopt(root);
    if (root.firstElementChild) root.querySelectorAll(SEL).forEach(adopt);
  }
  function init() {
    if (!document.getElementById("sx-pager-css")) { const s = document.createElement("style"); s.id = "sx-pager-css"; s.textContent = CSS; (document.head || document.documentElement).appendChild(s); }
    scan(document.documentElement);
    new MutationObserver((recs) => { for (const r of recs) { if (states.has(r.target)) continue; r.addedNodes.forEach(scan); } }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  addEventListener("beforeprint", () => live.forEach((s) => { s.printing = true; render(s); }));
  addEventListener("afterprint", () => live.forEach((s) => { s.printing = false; render(s); }));

  window.SanixPager = {
    /** Redessine un conteneur (ou tous). */
    refresh(el) { if (el) { const st = states.get(el); if (st) render(st); } else live.forEach((s) => render(s)); },
    /** Rend visible un élément (ou un descendant d'un élément) d'une liste paginée : bascule sur sa page / déplie la liste. */
    reveal(node) {
      const el = node && node.closest && node.closest(SEL); if (!el) return false;
      const st = adopt(el); if (!st) return false;
      let it = node; while (it && it.parentElement !== el) it = it.parentElement;
      const i = it ? items(st).filter((r) => !byApp(r)).indexOf(it) : -1; if (i < 0) return false;
      if (st.mode === "more") st.shown = Math.max(st.shown, i + 1); else st.page = Math.floor(i / sizeOf(st)) + 1;
      render(st); return true;
    },
    /** État de chaque liste paginée (tests, diagnostic). */
    stats() {
      return [...live].filter((s) => s.el.isConnected).map((s) => {
        const vis = items(s).filter((r) => !byApp(r)), size = sizeOf(s);
        return { id: s.el.id || null, mode: s.mode, total: vis.length, page: s.page, pages: Math.max(1, Math.ceil(vis.length / size)), size, shown: vis.filter((r) => r.getAttribute("data-pg") !== "off").length, bar: !!(s.bar && !s.bar.hidden) };
      });
    },
    get size() { return userSize; },
  };
})();
