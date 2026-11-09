// SANIX AI VIRTUAL COMPANY — bureau virtuel 3D temps réel (Three.js).
// L'état affiché est celui que le moteur IA publie (activité, lieu, réunions) : à la réouverture, tout est reconstruit
// depuis la base ; en cours de session, Realtime ne fait que le mettre à jour. Les animations représentent le statut
// déclaré par le moteur, jamais chaque opération technique.
import { ACTIVITIES, animOf, DEPT_COLORS, STATUS } from "./activity.js";
import { DESK_FOR, makeAvatar } from "./avatar.js";
import { makeGlbAvatar } from "./avatar_glb.js";
import { loadAssets } from "./assets.js";
import { CHAIR_DZ, createKit } from "./office_props.js";

const SKY = 0x9ab6ce;            // ciel clair (fond et brouillard)
const EXEC_DZ = 1.3;             // bureau du directeur : distance bureau → fauteuil
const AISLE_DZ = 2.4;            // allée de circulation : distance bureau → axe de l'allée (entre la chaise et le bureau suivant)
const SEAT_R = 3.55, EXIT_R = 4.7;   // sièges autour de la table de réunion ; anneau de circulation extérieur

export { STATUS, DEPT_COLORS };

const GRID = [["reunion", "direction", "supervision"], ["commercial", "marketing", "intelligence"], ["relation_client", "administratif", "collab"], ["detente", "datacenter", null]];
const SPECIAL = { reunion: "Salle de réunion", supervision: "Salle de supervision", datacenter: "Centre de données", collab: "Espace de collaboration", detente: "Espace détente" };
const ROOM_W = 17, GAP = 2.4, COLS = 4, SLOT_X = 3.7, SLOT_Z = 4.1, COLX = [-(ROOM_W + GAP), 0, ROOM_W + GAP];
const IDLE_MS = 180000;          // disponible sans mission depuis 3 min → espace détente
const WALK = 2.2;                // vitesse de marche (unités / s) : calée sur le clip « Walk » (assets.js : BASE_WALK)
const QUALITY = {
  high: { dpr: 2, seg: 14, props: true, maxFull: 90, fps: 60, perFrame: 6, labelEvery: 1, blink: true, shadows: true, env: true },
  low: { dpr: 1.25, seg: 8, props: true, maxFull: 30, fps: 45, perFrame: 3, labelEvery: 2, blink: true, shadows: false, env: true },
  eco: { dpr: 1, seg: 6, props: false, maxFull: 18, fps: 30, perFrame: 2, labelEvery: 3, blink: false, shadows: false, env: false },
};
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const hexToNum = (h) => parseInt(h.replace("#", ""), 16);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/** Qualité : « auto » réduit les détails sur mobile / appareils modestes ; « eco » = mode économie de ressources. */
export function detectQuality(pref = "auto") {
  if (pref && pref !== "auto" && QUALITY[pref]) return pref;
  try { if (localStorage.getItem("sanix_company_quality") && QUALITY[localStorage.getItem("sanix_company_quality")]) return localStorage.getItem("sanix_company_quality"); } catch { /* stockage indisponible */ }
  const small = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 700;
  const modest = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  return small || modest ? "low" : "high";
}

export async function createOffice(container, hooks = {}) {
  const THREE = await import("./vendor/three.bundle.js");   // Three.js local (aucun CDN) : voir tools/build-vendor.sh
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("WebGL indisponible");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let qName = detectQuality(hooks.quality), Q = QUALITY[qName];
  const renderer = new THREE.WebGLRenderer({ antialias: qName !== "eco", powerPreference: "high-performance" });
  const dprOverride = Number(new URLSearchParams(location.search).get("dpr")) || null;   // ?dpr=0.5 : résolution de rendu réduite (machines lentes, tests)
  const pixelRatio = () => Math.min(devicePixelRatio || 1, dprOverride ?? Q.dpr);
  renderer.setPixelRatio(pixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = Q.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(SKY);
  const dom = renderer.domElement;
  dom.setAttribute("aria-label", "Bureau virtuel 3D de SANIX AI VIRTUAL COMPANY");
  dom.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
  container.appendChild(dom);
  const labels = document.createElement("div"); labels.className = "np-layer"; container.appendChild(labels);

  const scene = new THREE.Scene(); scene.background = new THREE.Color(SKY); scene.fog = new THREE.Fog(SKY, 150, 340);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 520);
  scene.add(new THREE.HemisphereLight(0xd9efff, 0x526176, 1.7));
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.7); sun.castShadow = Q.shadows; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  Object.assign(sun.shadow.camera, { near: 10, far: 260 }); scene.add(sun, sun.target);
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture; scene.environmentIntensity = Q.env ? 0.32 : 0;
  let K = createKit(THREE, { lambert: qName !== "high" });
  let assets = null;   // personnages GLB + clips ; sans eux (hors ligne, ressource absente) on bascule sur les avatars procéduraux
  try { assets = await loadAssets(THREE); } catch (e) { console.warn("Avatars GLB indisponibles, repli procédural :", e.message); }

  // ── caches ──
  const mats = new Map(), geos = new Map();
  const M = (k, f) => (mats.has(k) ? mats.get(k) : (mats.set(k, f()), mats.get(k)));
  const G = (k, f) => (geos.has(k) ? geos.get(k) : (geos.set(k, f()), geos.get(k)));
  const pbr = () => qName === "high";   // qualités réduite / éco : éclairage par sommet (Lambert)
  const std = (c, o = {}) => M(`s${c}${JSON.stringify(o)}${pbr()}`, () => { const { roughness, metalness, ...rest } = { roughness: 0.65, ...o }; return pbr() ? new THREE.MeshStandardMaterial({ color: c, roughness, metalness, ...rest }) : new THREE.MeshLambertMaterial({ color: c, ...rest }); });
  const glass = (c) => M(`g${c}`, () => new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.1, roughness: 0.2, depthWrite: false }));

  // ── textures canvas (sans police emoji) ──
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  function textCanvas(lines, { w = 512, h = 128, bg = null, color = "#E6ECF8", size = 44, align = "left" } = {}) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
    x.fillStyle = color; x.textBaseline = "middle"; x.textAlign = align;
    const L = Array.isArray(lines) ? lines : [lines], lh = h / (L.length + 0.4);
    L.forEach((t, i) => { x.font = `${i === 0 ? "700" : "500"} ${i === 0 ? size : size * 0.72}px system-ui,Segoe UI,Arial,sans-serif`; x.fillText(String(t), align === "left" ? 16 : align === "center" ? w / 2 : w - 16, lh * (i + 0.9)); });
    return c;
  }
  const iconCache = new Map();
  function iconMat(kind) {
    if (!kind) return null;
    if (!iconCache.has(kind)) {
      const s = 128, c = document.createElement("canvas"); c.width = c.height = s; const x = c.getContext("2d");
      const col = { reunion: "#A855F7", analyse: "#06B6D4", mission: "#3B82F6", validation: "#F59E0B", difficulte: "#EF4444", terminee: "#EAB308", suspendu: "#94A3B8", doc: "#E2E8F0", chat: "#25D366", phone: "#38BDF8" }[kind] ?? "#fff";
      x.fillStyle = "rgba(11,18,32,.9)"; x.beginPath(); x.arc(64, 64, 58, 0, 7); x.fill();
      x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 8; x.lineCap = x.lineJoin = "round";
      if (kind === "mission") for (const dx of [-26, 0, 26]) { x.beginPath(); x.arc(64 + dx, 64, 9, 0, 7); x.fill(); }
      else if (kind === "reunion") { x.beginPath(); x.arc(46, 62, 16, 0, 7); x.arc(82, 62, 16, 0, 7); x.fill(); x.fillRect(38, 84, 52, 12); }
      else if (kind === "analyse") { x.beginPath(); x.arc(58, 58, 24, 0, 7); x.stroke(); x.beginPath(); x.moveTo(76, 76); x.lineTo(96, 96); x.stroke(); }
      else if (kind === "validation") { x.beginPath(); x.moveTo(40, 32); x.lineTo(88, 32); x.lineTo(64, 64); x.lineTo(88, 96); x.lineTo(40, 96); x.lineTo(64, 64); x.closePath(); x.stroke(); }
      else if (kind === "difficulte") { x.fillRect(58, 30, 12, 44); x.beginPath(); x.arc(64, 92, 8, 0, 7); x.fill(); }
      else if (kind === "terminee") { x.beginPath(); x.moveTo(36, 66); x.lineTo(56, 86); x.lineTo(94, 42); x.stroke(); }
      else if (kind === "suspendu") { x.fillRect(42, 36, 14, 56); x.fillRect(72, 36, 14, 56); }
      else if (kind === "doc") { x.strokeRect(40, 28, 48, 72); x.beginPath(); for (const y of [50, 66, 82]) { x.moveTo(50, y); x.lineTo(78, y); } x.stroke(); }
      else if (kind === "chat") { x.beginPath(); x.moveTo(34, 40); x.lineTo(94, 40); x.lineTo(94, 80); x.lineTo(64, 80); x.lineTo(48, 96); x.lineTo(48, 80); x.lineTo(34, 80); x.closePath(); x.stroke(); }
      else if (kind === "phone") { x.beginPath(); x.arc(40, 70, 10, 0, 7); x.arc(88, 70, 10, 0, 7); x.fill(); x.beginPath(); x.arc(64, 70, 30, Math.PI, 0); x.stroke(); }
      iconCache.set(kind, new THREE.SpriteMaterial({ map: tex(c), transparent: true, depthTest: false, sizeAttenuation: false }));   // taille constante à l'écran
    }
    return iconCache.get(kind);
  }
  const ICON_OF_ANIM = { screen: "analyse", multiscreen: "analyse", documents: "doc", typing: "mission", present: "mission", terminal: "chat", talk: "chat", headset: "phone", meeting: "reunion", speak: "reunion" };
  function iconKind(agent, anim) {
    if (agent.etat === "suspendu") return "suspendu";
    if (agent.activite === "en_difficulte") return "difficulte";
    if (agent.activite === "attente_validation" || agent.activite_detail === "attente") return "validation";
    if (agent.activite === "mission_terminee") return "terminee";
    return ICON_OF_ANIM[anim] ?? null;
  }

  // ── état ──
  const S = { rooms: [], byRoom: new Map(), slotOf: new Map(), layoutKey: "", group: new THREE.Group(), desks: new Map(), seats: [], supSlots: [], collabSlots: [], detenteSlots: [],
    rowSouth: [], board: null, screens: [], racks: [], dgSeat: null, ownMats: [], deskIdx: new Map(), walls: [] };
  scene.add(S.group);
  const avatars = new Map(), queue = [], feed = [];
  let data = { agents: [], departments: [], stats: {}, meetings: [], openByAgent: {} };
  let autoViewDone = false, simMs = 0, wallOffset = 0, hovered = null, selectedId = null, followId = null, viewMode = "general", viewArg = null, viewOpts = {}, activityView = false, lastStructure = "";
  const wallNow = () => Date.now() + wallOffset;

  // ─────────────────────────── mise en page ───────────────────────────
  function computeLayout() {
    const live = data.agents.filter((a) => a.etat !== "archive");
    const byDept = new Map();
    for (const a of live) { if (!byDept.has(a.departement_id)) byDept.set(a.departement_id, []); byDept.get(a.departement_id).push(a); }
    for (const l of byDept.values()) l.sort((a, b) => a.niveau - b.niveau || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id));
    // bureaux stables : un collaborateur garde sa place quand l'effectif change ; un nouveau prend la première place libre
    const seatOf = new Map(), liveIds = new Set(live.map((a) => a.id));
    for (const id of [...S.deskIdx.keys()]) if (!liveIds.has(id)) S.deskIdx.delete(id);
    for (const [dept, list] of byDept) {
      const members = list.filter((a) => !(dept === "direction" && a.niveau === 1)), used = new Set();
      for (const a of members) { const p = S.deskIdx.get(a.id); if (p && p.dept === dept && !used.has(p.idx)) { used.add(p.idx); seatOf.set(a.id, p.idx); } }
      let next = 0;
      for (const a of members) if (!seatOf.has(a.id)) { while (used.has(next)) next++; used.add(next); seatOf.set(a.id, next); S.deskIdx.set(a.id, { dept, idx: next }); }
      list.sort((a, b) => (seatOf.get(a.id) ?? -1) - (seatOf.get(b.id) ?? -1));
    }
    const known = new Set(GRID.flat().filter(Boolean));
    const extra = [...byDept.keys(), ...data.departments.map((d) => d.id)].filter((id, i, arr) => !known.has(id) && arr.indexOf(id) === i);
    const rowsDef = GRID.map((r) => [...r]);
    for (const row of rowsDef) for (let c = 0; c < 3; c++) if (!row[c] && extra.length) row[c] = extra.shift();
    while (extra.length) rowsDef.push([extra.shift() ?? null, extra.shift() ?? null, extra.shift() ?? null]);
    const rowDepth = rowsDef.map((row) => Math.max(12, ...row.filter((id) => id && !SPECIAL[id]).map((id) => {
      const n = Math.max(0, ...(byDept.get(id) ?? []).map((a) => (seatOf.has(a.id) ? seatOf.get(a.id) + 1 : 0))) + (id === "direction" ? 3 : 0);
      return Math.ceil(Math.max(n, 1) / COLS) * SLOT_Z + 6;
    })));
    const total = rowDepth.reduce((s, d) => s + d, 0) + GAP * (rowDepth.length - 1);
    let z = -total / 2; const rooms = [];
    rowsDef.forEach((row, ri) => {
      row.forEach((id, ci) => {
        if (!id) return;
        const dept = data.departments.find((d) => d.id === id);
        const members = (byDept.get(id) ?? []).filter((a) => !(id === "direction" && a.niveau === 1));
        rooms.push({ id, title: id === "direction" ? "Bureau du directeur IA" : SPECIAL[id] ?? dept?.nom ?? id, row: ri, col: ci, x: COLX[ci], z: z + rowDepth[ri] / 2, w: ROOM_W, d: rowDepth[ri],
          agents: members, count: (byDept.get(id) ?? []).length, color: DEPT_COLORS[id] ?? "#475569", special: SPECIAL[id] ? id : null, rowOffset: id === "direction" ? 1 : 0 });
      });
      S.rowSouth[ri] = z + rowDepth[ri];
      z += rowDepth[ri] + GAP;
    });
    S.rooms = rooms; S.byRoom = new Map(rooms.map((r) => [r.id, r])); S.slotOf.clear();
    for (const r of rooms) {
      if (r.special) continue;
      r.agents.forEach((a) => {
        const i = seatOf.get(a.id), col = i % COLS, row = Math.floor(i / COLS) + r.rowOffset;
        const lx = (col - (COLS - 1) / 2) * SLOT_X, lz = -r.d / 2 + 2.6 + row * SLOT_Z;
        S.slotOf.set(a.id, { x: r.x + lx, z: r.z + lz + CHAIR_DZ, deskX: r.x + lx, deskZ: r.z + lz, room: r, row });
      });
    }
    const dir = S.byRoom.get("direction");
    S.dgSeat = dir ? { x: dir.x, z: dir.z - dir.d / 2 + 2.2 + EXEC_DZ, room: dir } : null;
    const dg = live.find((a) => a.niveau === 1);
    if (dg && S.dgSeat) S.slotOf.set(dg.id, { ...S.dgSeat, deskX: dir.x, deskZ: dir.z - dir.d / 2 + 2.2, row: -1 });
    return rooms;
  }

  // ─────────────────────────── bâtiment : sols, murs, vitrages, mobilier ───────────────────────────
  const WALL_H = 3.3;
  const wallMat = std(0xeaf0f6, { roughness: 0.92 }), trimMat = std(0x087db8, { roughness: 0.45 }), plinthMat = std(0xc9d3de, { roughness: 0.8 });
  const glassMat = M("glass" + (qName === "high"), () => (qName === "high" ? new THREE.MeshStandardMaterial({ color: 0xb9e0f4, transparent: true, opacity: 0.24, roughness: 0.06, depthWrite: false, side: THREE.DoubleSide }) : new THREE.MeshBasicMaterial({ color: 0xb9e0f4, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })));
  const floorTex = new Map();
  function floorTexture(kind) {
    if (floorTex.has(kind)) return floorTex.get(kind);
    const c = document.createElement("canvas"); c.width = c.height = 512; const x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, 512, 512);
    if (kind === "carpet") {
      for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${i % 2 ? "0,0,0" : "255,255,255"},${0.03 + Math.random() * 0.05})`; x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
      x.strokeStyle = "rgba(0,0,0,.07)"; x.lineWidth = 2; x.beginPath(); for (const p of [1, 257]) { x.moveTo(p, 0); x.lineTo(p, 512); x.moveTo(0, p); x.lineTo(512, p); } x.stroke();
    } else if (kind === "wood") {
      for (let col = 0; col < 8; col++) for (let seg = 0; seg < 2; seg++) {
        const y0 = (seg * 256 + (col % 2) * 128 + (col * 37) % 90) % 512; x.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`; x.fillRect(col * 64, y0, 64, 256);
        x.fillStyle = "rgba(0,0,0,.2)"; x.fillRect(col * 64, 0, 2, 512); x.fillRect(col * 64, y0, 64, 2);
      }
    } else { x.strokeStyle = "rgba(0,0,0,.16)"; x.lineWidth = 3; x.beginPath(); for (let p = 0; p <= 512; p += 128) { x.moveTo(p + 1, 0); x.lineTo(p + 1, 512); x.moveTo(0, p + 1); x.lineTo(512, p + 1); } x.stroke(); }
    const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; floorTex.set(kind, t); return t;
  }
  const own = (m, geo = true, mat = false) => { if (geo) m.userData.ownGeo = true; if (mat) m.userData.own = true; return m; };
  const mesh = (geo, mat, x = 0, y = 0, z = 0, shadow = false, receive = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow && Q.shadows; m.receiveShadow = receive; m.userData.ownGeo = true; return m; };
  const boxM = (w, h, d, mat, x, y, z, shadow = false, receive = false) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, shadow, receive);

  function disposeStatic() {
    S.group.traverse((o) => { if (o.userData.ownGeo) o.geometry?.dispose(); if (o.userData.own) { if (o.material?.map) o.material.map.dispose(); o.material?.dispose?.(); } });
    for (const m of S.ownMats) m.dispose();
    scene.remove(S.group); S.group = new THREE.Group(); scene.add(S.group);
    S.desks.clear(); S.seats = []; S.supSlots = []; S.collabSlots = []; S.detenteSlots = []; S.screens = []; S.racks = []; S.board = null; S.ownMats = []; S.walls = [];
  }

  function buildRoom(r) {
    const g = new THREE.Group(); g.position.set(r.x, 0, r.z); S.group.add(g);
    const accent = hexToNum(r.color), dark = r.special === "supervision" || r.special === "datacenter", top = r.row === 0;
    const kind = r.special === "datacenter" ? "tile" : r.special === "detente" || r.id === "direction" ? "wood" : "carpet";
    const base = ({ datacenter: 0x4a586b, detente: 0xdcc4a2, supervision: 0x33445a, reunion: 0xe2e9f0, collab: 0xe8eff5 })[r.special] ?? (r.id === "direction" ? 0xa98462 : new THREE.Color(accent).lerp(new THREE.Color(0xf4f7fb), 0.72).getHex());
    const ft = floorTexture(kind).clone(); ft.repeat.set(r.w / 4.6, r.d / 4.6); ft.needsUpdate = true;
    const floor = mesh(new THREE.BoxGeometry(r.w, 0.1, r.d), pbr() ? new THREE.MeshStandardMaterial({ color: base, map: ft, roughness: kind === "wood" ? 0.5 : 0.88 }) : new THREE.MeshLambertMaterial({ color: base, map: ft }), 0, 0.05, 0, false, true); own(floor, true, true); g.add(floor);
    g.add(boxM(r.w, 0.13, 0.34, std(accent, { roughness: 0.5 }), 0, 0.065, r.d / 2 - 0.2));                                   // seuil aux couleurs du département

    // murs : nord, ouest, est (pleins ou vitrés côté façade) ; sud : cloison vitrée avec porte. Ils s'abaissent quand la caméra est derrière eux.
    const wall = (w, d, x, z, nx, nz, opts = {}) => {
      const wg = new THREE.Group(); wg.position.set(x, 0, z); const hz = w > d, len = hz ? w : d, th = hz ? d : w;
      const solid = [], pane = [], WALL = "#eaf0f6", TRIM = "#087db8";           // pièces opaques fusionnées (1 appel de dessin) + vitrage (1 appel)
      const add = (bw, bh, bd, hex, bxx, by, bz) => solid.push(K.bx(bw, bh, bd, hex, bxx, by, bz));
      if (opts.glass) {
        add(w, 0.55, d, WALL, 0, 0.275, 0); pane.push(new THREE.BoxGeometry(hz ? w - 0.1 : 0.05, WALL_H - 0.7, hz ? 0.05 : d - 0.1).translate(0, 0.55 + (WALL_H - 0.7) / 2, 0));
        const n = Math.max(1, Math.round(len / 3.2)); for (let i = 0; i <= n; i++) { const o = -len / 2 + (len * i) / n; add(hz ? 0.09 : th + 0.04, WALL_H - 0.6, hz ? th + 0.04 : 0.09, TRIM, hz ? o : 0, 0.55 + (WALL_H - 0.6) / 2, hz ? 0 : o); }
      } else if (opts.window) {
        add(w, 1.0, d, WALL, 0, 0.5, 0); add(w, 0.5, d, WALL, 0, WALL_H - 0.25, 0); pane.push(new THREE.BoxGeometry(hz ? w - 0.1 : 0.05, 1.8, hz ? 0.05 : d - 0.1).translate(0, 1.9, 0));
        const n = Math.max(1, Math.round(len / 3.6)); for (let i = 0; i <= n; i++) { const o = -len / 2 + (len * i) / n; add(hz ? 0.1 : th + 0.05, 1.85, hz ? th + 0.05 : 0.1, TRIM, hz ? o : 0, 1.9, hz ? 0 : o); }
        add(hz ? w : th + 0.12, 0.05, hz ? th + 0.12 : d, "#ffffff", 0, 1.0, 0);
      } else add(w, WALL_H, d, WALL, 0, WALL_H / 2, 0);
      if (!opts.glass) add(hz ? w : th + 0.02, 0.22, hz ? th + 0.02 : d, "#c9d3de", 0, 0.11, 0);
      add(w + (hz ? 0.04 : 0.02), 0.07, d + (hz ? 0.02 : 0.04), TRIM, 0, WALL_H + 0.035, 0);
      const sm = new THREE.Mesh(K.mergeGeos(solid), K.matte); sm.castShadow = Q.shadows; sm.receiveShadow = true; sm.userData.ownGeo = true; wg.add(sm);
      if (pane.length) { const gm = new THREE.Mesh(K.mergeGeos(pane.map((p) => (p.index ? p.toNonIndexed() : p))), glassMat); gm.userData.ownGeo = true; wg.add(gm); }
      g.add(wg); S.walls.push({ g: wg, nx, nz, x: r.x + x, z: r.z + z, s: 1 });
    };
    const windowN = top && r.id !== "direction";
    wall(r.w, 0.25, 0, -r.d / 2, 0, -1, { window: windowN });
    wall(0.25, r.d, -r.w / 2, 0, -1, 0, { window: r.col === 0 }); wall(0.25, r.d, r.w / 2, 0, 1, 0, { window: r.col === 2 });
    for (const sx of [-1, 1]) { const L = r.w / 2 - 1.4; wall(L, 0.14, sx * (1.4 + L / 2), r.d / 2, 0, 1, { glass: true }); }
    for (const sx of [-1, 1]) g.add(boxM(0.14, 2.9, 0.18, trimMat, sx * 1.4, 1.45, r.d / 2));
    g.add(boxM(2.94, 0.14, 0.18, trimMat, 0, 2.9, r.d / 2));

    // étiquette au sol (lisible depuis la caméra d'ensemble)
    const lines = [r.title, r.special ? "" : `${r.count} collaborateur${r.count > 1 ? "s" : ""}`].filter((x, i) => i === 0 || x);
    const label = mesh(new THREE.PlaneGeometry(10.5, 2.1), new THREE.MeshBasicMaterial({ map: tex(textCanvas(lines, { w: 640, h: 128, size: 52, color: dark ? "#d7e4f4" : "#16324d" })), transparent: true, opacity: 0.85, depthWrite: false }));
    own(label, true, true); label.rotation.x = -Math.PI / 2; label.position.set(-r.w / 2 + 5.9, 0.12, r.d / 2 - 1.5); g.add(label);

    const plantAt = (x, z, s = 1) => { const p = K.make("plant", true); p.position.set(x, 0, z); p.scale.setScalar(s); g.add(p); };
    plantAt(-r.w / 2 + 1.0, -r.d / 2 + 1.0, 1.2); plantAt(r.w / 2 - 1.0, -r.d / 2 + 1.0, 1.0);

    if (!r.special) {
      r.agents.forEach((a) => {
        const sl = S.slotOf.get(a.id), lx = sl.deskX - r.x, lz = sl.deskZ - r.z, ws = K.workstation();
        ws.group.position.set(lx, 0, lz); g.add(ws.group);
        const ch = K.chair(((hash(a.id) % 9) - 4) * 0.05); ch.position.set(lx, 0, lz + CHAIR_DZ); g.add(ch);
        S.desks.set(a.id, { monMat: ws.mat, mon2: ws.mon2, mon3: ws.mon3, docs: ws.docs }); S.ownMats.push(ws.mat);
      });
      if (r.id !== "direction") { const cab = K.make("cabinet"); cab.position.set(0, 0, -r.d / 2 + 0.5); g.add(cab); }
    }
    if (r.id === "direction") {                                                                                                // bureau du directeur : mobilier de direction, bibliothèques, enseigne
      const dz = -r.d / 2 + 2.2;
      const desk = K.make("execDesk"); desk.position.set(0, 0, dz); g.add(desk);
      const ch = K.make("execChair"); ch.position.set(0, 0, dz + EXEC_DZ); g.add(ch);
      for (const sx of [-1, 1]) { const b = K.make("bookshelf"); b.position.set(sx * 6.0, 0, -r.d / 2 + 0.45); g.add(b); }
      const sc = document.createElement("canvas"); sc.width = 1024; sc.height = 160; const cx = sc.getContext("2d"); cx.fillStyle = "#12263b"; cx.fillRect(0, 0, 1024, 160); cx.fillStyle = "#087db8"; cx.fillRect(0, 148, 1024, 12);
      cx.fillStyle = "#8bdcff"; cx.font = "800 62px system-ui,Arial"; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillText("SANIX AI VIRTUAL COMPANY", 512, 70);
      const sign = mesh(new THREE.PlaneGeometry(7.4, 1.16), new THREE.MeshBasicMaterial({ map: tex(sc) })); own(sign, true, true); sign.position.set(0, 2.6, -r.d / 2 + 0.2); g.add(sign);
      const sf = K.make("sofa"); sf.position.set(r.w / 2 - 3.2, 0, r.d / 2 - 2.4); sf.rotation.y = -Math.PI / 2 + Math.PI; g.add(sf);
      const ct = K.make("coffeeTable"); ct.position.set(r.w / 2 - 5.2, 0, r.d / 2 - 2.4); g.add(ct);
    }
    if (r.special === "reunion") {
      const table = K.make("meetTable"); g.add(table);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, sx = Math.sin(a) * SEAT_R, sz = Math.cos(a) * SEAT_R;
        const c = K.make("meetChair"); c.position.set(sx, 0, sz); c.rotation.y = a; g.add(c);
        S.seats.push({ x: r.x + sx, z: r.z + sz, a, cx: r.x, cz: r.z });
      }
      const bc = textCanvas("", { w: 768, h: 256, bg: "#1a1230" }), bt = tex(bc);
      const board = mesh(new THREE.PlaneGeometry(8, 2.6), new THREE.MeshBasicMaterial({ map: bt }), 0, 2.0, -r.d / 2 + 0.2); own(board, true, false); g.add(board);
      g.add(boxM(8.3, 2.9, 0.1, std(0x0b1220), 0, 2.0, -r.d / 2 + 0.12));
      S.board = { canvas: bc, tex: bt, mesh: board };
    }
    if (r.special === "supervision") {
      for (let i = 0; i < 3; i++) {
        const scr = mesh(new THREE.PlaneGeometry(5.2, 2.9), new THREE.MeshBasicMaterial({ map: tex(textCanvas("…", { w: 512, h: 288, bg: "#0b1a33" })) }), -5.6 + i * 5.6, 2.1, -r.d / 2 + 0.25); own(scr, true, true); g.add(scr);
        g.add(boxM(5.4, 3.1, 0.12, std(0x0e1726), scr.position.x, scr.position.y, scr.position.z - 0.08)); S.screens.push(scr);
      }
      g.add(boxM(11, 0.12, 1.5, std(0x2a3a4e), 0, 0.9, 1.8, true), boxM(10.6, 0.8, 1.3, std(0x1b2745), 0, 0.45, 1.8, true));
      for (let i = 0; i < 6; i++) S.supSlots.push({ x: r.x + (i - 2.5) * 2.1, z: r.z - r.d / 2 + 3.9 });
    }
    if (r.special === "datacenter") {
      for (let i = 0; i < 6; i++) {
        const rack = K.make("rack"); rack.position.set(-6.2 + i * 2.5, 0, -r.d / 2 + 1.5); g.add(rack);
        for (let k = 0; k < 5; k++) { const led = mesh(G("led", () => new THREE.BoxGeometry(0.22, 0.08, 0.04)), new THREE.MeshBasicMaterial({ color: 0x22c55e }), rack.position.x + 0.45, 0.8 + k * 0.55 + 0.5, rack.position.z + 0.63); led.userData.ownGeo = false; g.add(led); S.racks.push({ m: led, phase: Math.random() * 6 }); S.ownMats.push(led.material); }
      }
      const scr = mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: tex(textCanvas("…", { w: 512, h: 256, bg: "#0b1a33" })) }), 0, 2.2, r.d / 2 - 0.4); own(scr, true, true); scr.rotation.y = Math.PI; g.add(scr); S.screens.push(scr);
    }
    if (r.special === "collab") {
      const t = K.make("meetTable"); t.scale.set(0.72, 1, 0.72); t.position.set(0, 0, 1.2); g.add(t);
      const wb = mesh(new THREE.PlaneGeometry(9, 3), new THREE.MeshBasicMaterial({ map: tex(textCanvas(["Cadrage des missions", "Objectifs · répartition · échéances"], { w: 768, h: 256, bg: "#f8fafc", color: "#0f172a", size: 52 })) }), 0, 2.1, -r.d / 2 + 0.2); own(wb, true, true); g.add(wb);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; S.collabSlots.push({ x: r.x + Math.sin(a) * 3.7, z: r.z + 1.2 + Math.cos(a) * 2.2, a, cx: r.x, cz: r.z + 1.2 }); }
    }
    if (r.special === "detente") {
      const z0 = -1.9;
      for (const sx of [-4.2, 4.2]) { const s = K.make("sofa"); s.position.set(sx, 0, z0); s.rotation.y = Math.PI; g.add(s); for (const dx of [-0.9, 0.9]) S.detenteSlots.push({ x: r.x + sx + dx, z: r.z + z0 + 0.05, sit: true, yaw: Math.PI }); }
      const ct = K.make("coffeeTable"); ct.position.set(0, 0, z0 + 2.4); g.add(ct);
      const cn = K.make("counter"); cn.position.set(r.w / 2 - 1.5, 0, -r.d / 2 + 1.0); cn.rotation.y = -Math.PI / 2 + Math.PI; g.add(cn);
      plantAt(-r.w / 2 + 1.0, r.d / 2 - 2.0, 1.4);
      S.detenteSlots.push({ x: r.x + r.w / 2 - 3.0, z: r.z - r.d / 2 + 3.0, sit: false, yaw: Math.PI * 0.9 }, { x: r.x + r.w / 2 - 4.4, z: r.z - r.d / 2 + 3.2, sit: false, yaw: Math.PI * 0.9 });
    }
  }

  function rebuild() {
    const rooms = computeLayout();
    const key = rooms.map((r) => `${r.id}:${r.d}:${r.title}:${r.agents.map((a) => `${a.id}@${S.deskIdx.get(a.id)?.idx}`).join(",")}`).join("|") + `|${qName}`;
    if (key === S.layoutKey) return false;
    S.layoutKey = key; disposeStatic();
    const minX = Math.min(...rooms.map((r) => r.x - r.w / 2)) - 4, maxX = Math.max(...rooms.map((r) => r.x + r.w / 2)) + 4, minZ = Math.min(...rooms.map((r) => r.z - r.d / 2)) - 4, maxZ = Math.max(...rooms.map((r) => r.z + r.d / 2)) + 4;
    const st = floorTexture("tile").clone(); st.repeat.set((maxX - minX) / 5, (maxZ - minZ) / 5); st.needsUpdate = true;
    const slab = mesh(new THREE.BoxGeometry(maxX - minX, 0.6, maxZ - minZ), (pbr() ? new THREE.MeshStandardMaterial({ color: 0xe4ebf2, map: st, roughness: 0.7 }) : new THREE.MeshLambertMaterial({ color: 0xe4ebf2, map: st })), (minX + maxX) / 2, -0.3, (minZ + maxZ) / 2, false, true); own(slab, true, true); S.group.add(slab);
    S.group.add(mesh(new THREE.BoxGeometry(maxX - minX + 0.6, 0.18, maxZ - minZ + 0.6), trimMat, (minX + maxX) / 2, -0.58, (minZ + maxZ) / 2));
    rooms.forEach(buildRoom); return true;
  }

  // ─────────────────────────── itinéraires (couloirs et allées) ───────────────────────────
  const south = (r) => r.z + r.d / 2;
  const laneZ = (row) => S.rowSouth[row] + GAP / 2;
  const roomAt = (x, z) => S.rooms.find((r) => Math.abs(x - r.x) <= r.w / 2 + 0.15 && z >= r.z - r.d / 2 - 0.15 && z <= south(r) + 0.15) ?? null;
  const nearestRow = (z) => { let best = 0, bd = 1e9; S.rowSouth.forEach((s, i) => { const d = Math.abs(z - (s + GAP / 2)); if (d < bd) { bd = d; best = i; } }); return best; };
  const nearestCol = (x) => COLX.reduce((b, cx, i) => (Math.abs(x - cx) < Math.abs(x - COLX[b]) ? i : b), 0);
  function aisleZ(room, z) {
    const k = clampN(Math.round((z - room.z + room.d / 2 - 2.6 - CHAIR_DZ) / SLOT_Z), 0, 40);
    return Math.min(room.z - room.d / 2 + 2.6 + k * SLOT_Z + AISLE_DZ, south(room) - 0.9);
  }
  /** Points menant d'un point intérieur P à la porte (côté sud) de la salle. */
  function exitPts(room, P) {
    const door = { x: room.x, z: south(room) + 0.35 }, pts = [];
    if (room.special === "reunion" || room.special === "collab") {
      const cx = room.x, cz = room.special === "collab" ? room.z + 1.2 : room.z, R = room.special === "collab" ? 4.6 : EXIT_R;
      const a0 = Math.atan2(P.x - cx, P.z - cz), da = angDiff(a0, 0), n = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 4)));
      for (let i = 0; i <= n; i++) { const a = a0 + da * (i / n); pts.push({ x: cx + Math.sin(a) * R, z: Math.min(cz + Math.cos(a) * R, south(room) - 0.7) }); }
    } else if (room.special === "supervision") {
      const sx = (P.x >= room.x ? 1 : -1) * 6.9; pts.push({ x: room.x + sx, z: P.z }, { x: room.x + sx, z: south(room) - 0.8 });
    } else if (room.special) {
      pts.push({ x: P.x, z: south(room) - 0.8 });
    } else {
      const az = aisleZ(room, P.z); pts.push({ x: P.x, z: az }, { x: room.x, z: az }, { x: room.x, z: south(room) - 0.5 });
    }
    pts.push(door); return pts;
  }
  function insideLegs(room, from, to) {
    if (room.special) return [{ x: to.x, z: to.z }];
    const af = aisleZ(room, from.z), at = aisleZ(room, to.z);
    return Math.abs(af - at) < 0.3 ? [{ x: from.x, z: af }, { x: to.x, z: at }] : [{ x: from.x, z: af }, { x: room.x, z: af }, { x: room.x, z: at }, { x: to.x, z: at }];
  }
  function route(from, to) {
    const A = roomAt(from.x, from.z), B = roomAt(to.x, to.z), pts = [];
    const push = (x, z) => { const l = pts[pts.length - 1]; if (!l || Math.hypot(l.x - x, l.z - z) > 0.06) pts.push({ x, z }); };
    if (A && A === B) { for (const p of insideLegs(A, from, to)) push(p.x, p.z); push(to.x, to.z); return pts; }
    const rowA = A ? A.row : nearestRow(from.z), rowB = B ? B.row : nearestRow(to.z), colA = A ? A.col : nearestCol(from.x), colB = B ? B.col : nearestCol(to.x);
    if (A) { for (const p of exitPts(A, from)) push(p.x, p.z); push(A.x, laneZ(rowA)); } else push(from.x, laneZ(rowA));
    const xB = B ? B.x : to.x;
    if (rowA === rowB) push(xB, laneZ(rowB));
    else {
      const k = colB > colA ? colA : colB < colA ? colA - 1 : colA < 2 ? colA : 1, xv = (COLX[k] + COLX[k + 1]) / 2;
      push(xv, laneZ(rowA)); push(xv, laneZ(rowB)); push(xB, laneZ(rowB));
    }
    if (B) for (const p of exitPts(B, to).reverse()) push(p.x, p.z);
    push(to.x, to.z); return pts;
  }

  // ─────────────────────────── réunions ───────────────────────────
  const activeMeetings = () => data.meetings.filter((m) => ["planifiee", "en_cours"].includes(m.statut));
  function meetingOf(agentId) { return activeMeetings().find((m) => m.convoque_par === agentId || (m.participants ?? []).includes(agentId)); }
  function seatFor(agentId, m) {
    if (!S.seats.length) return null;
    const order = [m.convoque_par, ...(m.participants ?? [])].filter((x, i, a) => x && a.indexOf(x) === i), n = Math.max(order.length, 1), idx = Math.max(0, order.indexOf(agentId));
    const want = Math.PI + (idx * 2 * Math.PI) / n, taken = new Set();
    for (let i = 0; i < idx; i++) { const a = Math.PI + (i * 2 * Math.PI) / n; taken.add(S.seats.reduce((b, s, j) => (Math.abs(angDiff(s.a, a)) < Math.abs(angDiff(S.seats[b].a, a)) ? j : b), 0)); }
    let best = -1, bd = 1e9;
    S.seats.forEach((s, j) => { if (taken.has(j)) return; const d = Math.abs(angDiff(s.a, want)); if (d < bd) { bd = d; best = j; } });
    const s = S.seats[best < 0 ? 0 : best];
    return { x: s.x, z: s.z, yaw: Math.atan2(-(s.cx - s.x), -(s.cz - s.z)) };
  }
  function drawBoard() {
    if (!S.board) return;
    const m = activeMeetings().find((x) => x.statut === "en_cours") ?? activeMeetings()[0];
    const x = S.board.canvas.getContext("2d"), w = S.board.canvas.width, h = S.board.canvas.height;
    const line = (txt, y, size, weight, color) => {   // texte ajusté à la largeur du tableau
      x.fillStyle = color; let s = size; x.font = `${weight} ${s}px system-ui,Arial`;
      while (x.measureText(txt).width > w - 56 && s > 16) { s -= 2; x.font = `${weight} ${s}px system-ui,Arial`; }
      x.fillText(txt, 28, y);
    };
    x.fillStyle = "#1a1230"; x.fillRect(0, 0, w, h); x.textBaseline = "middle";
    if (!m) { line("Salle de réunion libre", 90, 46, 700, "#c4b5fd"); line("PV enregistré dans SANIX CRM à l'issue", 150, 30, 500, "#8b7fb8"); }
    else {
      const PH = { convocation: "Convocation", installation: "Installation", echanges: "Échanges", synthese: "Synthèse du directeur IA", cloture: "Clôture" };
      line(String(m.titre), 62, 42, 700, "#fff");
      line(`${PH[m.phase] ?? "En préparation"} · ${(m.participants?.length ?? 0) + 1} participants`, 124, 30, 600, "#c4b5fd");
      const o = data.agents.find((a) => a.id === m.orateur_id);
      line(o ? `Parole : ${o.nom}` : "Ordre du jour", 178, 30, 600, "#fbbf24");
      line(String(m.ordre_du_jour ?? "").replace(/\s+/g, " "), 224, 24, 500, "#a78bfa");
    }
    S.board.tex.needsUpdate = true;
  }

  // ─────────────────────────── où doit être un agent ? ───────────────────────────
  // « absent de son poste » : déplacement déclaré et non échu (l'heure d'échéance fait rentrer l'agent même sans nouvel événement)
  const awayNow = (a) => !!a.lieu && a.lieu !== "poste" && (!a.lieu_jusqua || Date.parse(a.lieu_jusqua) > wallNow());
  const isIdle = (a) => a.etat === "actif" && a.niveau > 1 && !awayNow(a) && a.activite === "disponible" && !data.openByAgent[a.id] && wallNow() - Date.parse(a.activite_depuis ?? 0) > IDLE_MS;
  // les groupes (places de détente, de supervision, visiteurs…) se déduisent des données, pas de l'ordre de création des avatars
  const groupIds = (pred) => data.agents.filter((v) => awayNow(v) && pred(v)).map((v) => v.id).sort();
  let idleOrder = [];
  const markIdleCandidates = () => { idleOrder = data.agents.filter(isIdle).map((a) => a.id).sort(); };

  function desired(av) {
    const a = av.agent, now = wallNow(), slot = S.slotOf.get(a.id);
    const desk = slot ? { x: slot.x, z: slot.z } : { x: 0, z: 0 };
    const base = (anim, key = "poste") => ({ key, x: desk.x, z: desk.z, yaw: 0, posture: "seat", anim, desk: true });
    if (a.etat === "suspendu") return base("pause");
    if (awayNow(a)) {
      if (a.lieu === "reunion") {
        const m = meetingOf(a.id), sp = m && seatFor(a.id, m);
        if (sp) return { key: `reunion:${m.id}`, x: sp.x, z: sp.z, yaw: sp.yaw, posture: "seat", anim: m.orateur_id === a.id ? "speak" : "meeting", meeting: m };
        const s = S.seats[hash(a.id) % Math.max(S.seats.length, 1)];
        if (s) return { key: "reunion:?", x: s.x, z: s.z, yaw: Math.atan2(-(s.cx - s.x), -(s.cz - s.z)), posture: "seat", anim: "meeting" };
      } else if (a.lieu === "poste_agent") {
        const tg = slot && S.slotOf.get(a.lieu_cible_agent);
        if (tg && a.lieu_cible_agent !== a.id) {
          const i = Math.max(0, groupIds((v) => v.lieu === "poste_agent" && v.lieu_cible_agent === a.lieu_cible_agent).indexOf(a.id));
          return { key: `visit:${a.lieu_cible_agent}:${a.lieu_jusqua}`, x: tg.deskX + 1.9, z: tg.deskZ + 0.35 + i * 0.95, yaw: Math.PI / 2, posture: "stand", anim: "handover" };
        }
      } else if (a.lieu === "supervision" && S.supSlots.length) {
        const p = S.supSlots[Math.max(0, groupIds((v) => v.lieu === "supervision").indexOf(a.id)) % S.supSlots.length];
        return { key: "supervision", x: p.x, z: p.z, yaw: 0, posture: "stand", anim: "watch" };
      } else if (a.lieu === "collaboration" && S.collabSlots.length) {
        const p = S.collabSlots[Math.max(0, groupIds((v) => v.lieu === "collaboration").indexOf(a.id)) % S.collabSlots.length];
        return { key: `collab:${a.lieu_jusqua}`, x: p.x, z: p.z, yaw: Math.atan2(-(p.cx - p.x), -(p.cz - p.z)), posture: "stand", anim: "talk" };
      } else if (a.lieu === "departement" && a.lieu_cible_dept && S.byRoom.get(a.lieu_cible_dept)) {
        const r = S.byRoom.get(a.lieu_cible_dept);
        return { key: `dept:${a.lieu_cible_dept}`, x: r.x + ((hash(a.id) % 5) - 2) * 1.6, z: south(r) - 2.4, yaw: 0, posture: "stand", anim: "talk" };
      }
    }
    // disponible depuis un moment, sans mission : pause à l'espace détente (déduit de l'état réel, pas aléatoire)
    const i = idleOrder.indexOf(a.id);
    if (i >= 0 && i < S.detenteSlots.length) { const p = S.detenteSlots[i]; return { key: "detente", x: p.x, z: p.z, yaw: p.yaw, posture: p.sit ? "seat" : "stand", anim: "relax" }; }
    let anim = animOf(a);
    if (a.activite === "mission_terminee" && now - Date.parse(a.activite_depuis ?? 0) > 3000) anim = "idle";   // confirmation jouée une fois, la coche reste
    return base(anim);
  }

  // ─────────────────────────── avatars ───────────────────────────
  const blobMat = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, "rgba(10,20,40,.55)"); gr.addColorStop(1, "rgba(10,20,40,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.MeshBasicMaterial({ map: tex(c), transparent: true, depthWrite: false }); })();
  const aenv = () => ({ THREE, mats: M, geos: G, seg: Q.seg, props: Q.props, assets, walk: WALK, blobMat, shadows: Q.shadows });
  function spawn(a) {
    const col = hexToNum(DEPT_COLORS[a.departement_id] ?? "#475569");
    const av = assets ? makeGlbAvatar(aenv(), a, col) : makeAvatar(aenv(), a, col);
    av.root.traverse((o) => { if (o.isMesh && o !== av.hit && o !== av.halo && o !== av.spin && o !== av.marker) o.castShadow = Q.shadows; });
    av.el = document.createElement("div"); av.el.className = "np"; av.el.innerHTML = "<b></b><i></i>"; av.el.firstChild.textContent = a.nom; av.el.lastChild.textContent = `AGENT IA · ${(a.fonction ?? "").toUpperCase()}`; labels.appendChild(av.el);
    av.bub = null; av.nav = null; av.place = null; av.placed = false;
    scene.add(av.root); avatars.set(a.id, av);
    return av;
  }
  /** Crée les avatars en attente (au plus `max`) et les place d'emblée à leur position réelle (aucune marche artificielle). */
  function spawnQueued(max) {
    const made = [];
    while (queue.length && made.length < max) { const a = queue.shift(), cur = data.agents.find((x) => x.id === a.id); if (cur && !avatars.has(cur.id)) made.push(spawn(cur)); }
    if (made.length) { markIdleCandidates(); for (const av of made) reconcile(av, true); assignDetail(); hooks.onProgress?.({ done: avatars.size, total: data.agents.length }); }
    return made.length;
  }
  function removeAvatar(id) { const av = avatars.get(id); if (!av) return; scene.remove(av.root); av.el.remove(); av.bub?.remove(); av.dispose(); avatars.delete(id); }

  function reconcile(av, snap = false) {
    const a = av.agent, w = desired(av);
    const moving = !!av.nav;
    if (!av.place || av.place.key !== w.key) {
      const from = { x: av.root.position.x, z: av.root.position.z };
      if (!av.placed || snap || reduced) {
        av.root.position.set(w.x, 0, w.z); av.root.rotation.y = w.yaw; av.nav = null; av.walking = false; av.placed = true;
        av.setPosture(w.posture);
      } else {
        const pts = route(from, w);
        av.nav = pts.length ? { pts, i: 0 } : null; av.walking = !!av.nav; av.setPosture("stand");
        if (!av.nav) { av.root.rotation.y = w.yaw; av.setPosture(w.posture); }
      }
    } else if (!moving) { av.setPosture(w.posture); }
    av.place = w;
    if (!av.walking) av.setAnim(w.anim, simMs);
    // repères d'état
    const st = a.etat === "suspendu" ? "suspendu" : (a.activite in STATUS ? a.activite : "disponible");
    av.halo.material.color.setHex(hexToNum(STATUS[st].color));
    av.setMuted(a.etat === "suspendu");
    const ik = iconKind(a, av.walking ? "walk" : w.anim), im = iconMat(ik);
    av.icon.visible = !!im; if (im) av.icon.material = im;
    av.spin.visible = (a.activite === "en_analyse" || w.anim === "multiscreen") && a.etat !== "suspendu";
    av.el.dataset.status = st;
    if (w.meeting && w.meeting.orateur_id) av.speakerYaw = headTurn(av, w);
    // bureau : écrans, documents
    const d = S.desks.get(a.id);
    if (d) {
      const atDesk = w.desk && !av.walking, color = hexToNum(STATUS[st].color);
      d.monMat.emissive.setHex(color); d.monMat.emissiveIntensity = !atDesk || a.etat === "suspendu" ? 0.22 : (w.anim === "idle" || w.anim === "pause" ? 0.45 : 0.95);
      d.mon2.visible = d.mon3.visible = atDesk && DESK_FOR[w.anim] === "multi"; d.docs.visible = atDesk && DESK_FOR[w.anim] === "docs";
    }
  }
  function headTurn(av, w) {
    const sp = avatars.get(w.meeting.orateur_id); if (!sp || sp === av) return 0;
    const dx = sp.root.position.x - av.root.position.x, dz = sp.root.position.z - av.root.position.z;
    return clampN(angDiff(av.root.rotation.y, Math.atan2(-dx, -dz)), -1, 1);
  }
  const reconcileAll = () => { markIdleCandidates(); for (const av of avatars.values()) reconcile(av); };

  function assignDetail() {
    const list = [...avatars.values()];
    const rank = (v) => (v.id === selectedId || v.id === hovered || v.id === followId ? -1 : v.agent.niveau);
    list.sort((x, y) => rank(x) - rank(y));
    list.forEach((v, i) => {
      const active = !["disponible", "mission_terminee"].includes(v.agent.activite) || v.agent.lieu !== "poste";
      v.setDetail(i < Q.maxFull && (!activityView || active || v.id === selectedId) ? "full" : "marker");
    });
  }

  // ─────────────────────────── mouvement et animation ───────────────────────────
  function stepAvatar(av, dt) {
    if (av.nav) {
      const p = av.root.position;
      let left = WALK * dt;
      while (av.nav && left > 0) {
        const t = av.nav.pts[av.nav.i], dx = t.x - p.x, dz = t.z - p.z, dist = Math.hypot(dx, dz);
        if (dist < 0.02) { av.nav.i++; if (av.nav.i >= av.nav.pts.length) { av.nav = null; break; } continue; }
        const m = Math.min(dist, left); p.x += (dx / dist) * m; p.z += (dz / dist) * m; left -= m;
        const yaw = Math.atan2(-dx, -dz); av.root.rotation.y += angDiff(av.root.rotation.y, yaw) * Math.min(1, dt * 10);
        if (m >= dist - 1e-6) { av.nav.i++; if (av.nav.i >= av.nav.pts.length) av.nav = null; }
      }
      if (!av.nav) {   // arrivée : prise de poste (assis / debout) et orientation finale
        av.walking = false; const w = av.place ?? desired(av); av.setPosture(w.posture); av.setAnim(w.anim, simMs); av.arrive = { yaw: w.yaw };
      }
    } else if (av.arrive) {
      const d = angDiff(av.root.rotation.y, av.arrive.yaw); av.root.rotation.y += d * Math.min(1, dt * 8);
      if (Math.abs(d) < 0.01) { av.root.rotation.y = av.arrive.yaw; av.arrive = null; }
    }
  }

  function step(dt) {
    simMs += dt * 1000;
    // création progressive des avatars
    spawnQueued(Q.perFrame);
    if (simMs - (step.last ?? -1e9) > 1000) { step.last = simMs; reconcileAll(); assignDetail(); }   // échéances de déplacement, pauses détente
    for (const av of avatars.values()) {
      stepAvatar(av, dt);
      av.frame++;
      const dc = Math.hypot(camera.position.x - av.root.position.x, camera.position.z - av.root.position.z);
      const every = dc > 95 ? 3 : dc > 60 ? 2 : 1;
      if (reduced) { if (av.frame % 30 === 1) av.update(1, simMs); }
      else if (av.frame % every === 0) av.update(dt * every, simMs);
      const sel = av.id === selectedId, hov = av.id === hovered;
      av.halo.scale.setScalar(sel ? 1.35 : hov ? 1.15 : 1);
      if (!reduced) {
        const k = av.agent.activite;
        av.halo.material.opacity = k === "en_difficulte" ? 0.4 + 0.5 * Math.abs(Math.sin(simMs / 200)) : k === "attente_validation" ? 0.45 + 0.4 * Math.sin(simMs / 420) ** 2 : av.agent.etat === "suspendu" ? 0.35 : 0.85;
        av.spin.rotation.z = simMs / 330; av.icon.position.y = av.top + 0.4 + Math.sin(simMs / 500 + av.seed) * 0.06;
      } else av.icon.position.y = av.top + 0.4;
      if (av.spin.visible) av.spin.position.y = av.top - 0.2;
    }
    if (!reduced && Q.blink) for (const r of S.racks) r.m.visible = Math.sin(simMs / 300 + r.phase) > -0.5;
    // caméra : suivi d'un collaborateur
    if (followId) { const av = avatars.get(followId); if (av) { goal.tx = av.root.position.x; goal.tz = av.root.position.z; goal.ty = 0.9; } }
    if (feedDirty && simMs - lastScreens > 1000) { drawScreens(); lastScreens = simMs; feedDirty = false; }
  }

  // ─────────────────────────── écrans (supervision, données) ───────────────────────────
  let feedDirty = true, lastScreens = -1e9;
  function drawScreens() {
    const s = data.stats ?? {}, rows = [
      ["Collaborateurs actifs", `${s.agentsActifs ?? 0} / ${s.agentsMax ?? "–"}`, (s.agentsActifs ?? 0) / Math.max(1, s.agentsMax ?? 1)],
      ["Missions en cours", String(s.missionsEnCours ?? 0), null],
    ];
    S.screens.forEach((scr, i) => {
      const c = document.createElement("canvas"); c.width = 512; c.height = 288; const x = c.getContext("2d");
      x.fillStyle = "#0b1a33"; x.fillRect(0, 0, 512, 288); x.textAlign = "left";
      if (i === 2 && S.screens.length === 4) {   // activité en direct
        x.fillStyle = "#93c5fd"; x.font = "600 26px system-ui,Arial"; x.fillText("Activité en direct", 24, 44);
        x.fillStyle = "#e2e8f0"; x.font = "500 21px system-ui,Arial";
        feed.slice(-7).reverse().forEach((l, k) => x.fillText(l.slice(0, 40), 24, 84 + k * 28));
      } else if (i === 3 || S.screens.length === 3 && i === 2) {
        x.fillStyle = "#93c5fd"; x.font = "600 26px system-ui,Arial"; x.fillText("Données du CRM", 28, 54);
        x.fillStyle = "#fff"; x.font = "800 52px system-ui,Arial"; x.fillText(`${s.prospects ?? 0} prospects`, 28, 140);
        x.fillStyle = "#86efac"; x.font = "600 28px system-ui,Arial"; x.fillText(`${s.offres ?? 0} offres · ${s.validations ?? 0} validations`, 28, 220);
      } else {
        const [t, v, ratio] = rows[i] ?? rows[0];
        x.fillStyle = "#93c5fd"; x.font = "600 26px system-ui,Arial"; x.fillText(t, 28, 54); x.fillStyle = "#fff"; x.font = "800 52px system-ui,Arial"; x.fillText(v, 28, 140);
        if (ratio !== null && ratio !== undefined) { x.fillStyle = "#1e3a8a"; x.fillRect(28, 190, 456, 22); x.fillStyle = ratio > 0.85 ? "#ef4444" : "#3b82f6"; x.fillRect(28, 190, 456 * clampN(ratio, 0, 1), 22); }
        if (i === 1) { x.fillStyle = "#86efac"; x.font = "600 28px system-ui,Arial"; x.fillText(`${s.missionsTerminees ?? 0} terminées aujourd'hui`, 28, 200); }
      }
      scr.material.map?.dispose(); scr.material.map = tex(c); scr.material.needsUpdate = true;
    });
  }

  // ─────────────────────────── caméra ───────────────────────────
  const orbit = { tx: 0, ty: 0, tz: 0, theta: 0, phi: 0.86, r: 80 }, goal = { ...orbit };
  function fitPoints(pts, phi = 0.86, theta = 0) {
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2, cz = (Math.min(...pts.map((p) => p.z)) + Math.max(...pts.map((p) => p.z))) / 2;
    const cam = camera.clone(); cam.aspect = camera.aspect || 1.5; cam.updateProjectionMatrix();
    const v = new THREE.Vector3(), mx = cam.aspect < 0.9 ? 1.12 : 0.97;
    const P3 = pts.flatMap((p) => [new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(p.x, 3.4, p.z)]);
    for (let r = 12; r < 260; r *= 1.03) {
      cam.position.set(cx + r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi), cz + r * Math.sin(phi) * Math.cos(theta)); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld(true);
      if (P3.every((p) => { v.copy(p).project(cam); return Math.abs(v.x) < mx && Math.abs(v.y) < 0.9 && v.z < 1; })) return { tx: cx, tz: cz, r, phi, theta };
    }
    return { tx: cx, tz: cz, r: 170, phi, theta };
  }
  const roomPts = (r) => [{ x: r.x - r.w / 2, z: r.z - r.d / 2 }, { x: r.x + r.w / 2, z: r.z - r.d / 2 }, { x: r.x - r.w / 2, z: r.z + r.d / 2 }, { x: r.x + r.w / 2, z: r.z + r.d / 2 }];   // 4 coins : la caméra est en 3/4
  function applyView() {
    const rooms = S.rooms; if (!rooms.length) return;
    let t = null;
    if (viewMode === "general") t = fitPoints(rooms.flatMap(roomPts), 0.92, 0.42);
    else if (viewMode === "executive") { const row = rooms.filter((r) => r.row === 0); t = row.length ? fitPoints(row.flatMap(roomPts), 0.95, 0.3) : null; }   // étage de direction : réunion, bureau du directeur, supervision
    else if (viewMode === "dept" || viewMode === "direction" || viewMode === "meeting" || viewMode === "supervision") {
      const id = viewMode === "dept" ? viewArg : viewMode === "meeting" ? "reunion" : viewMode, r = S.byRoom.get(id);
      t = r ? fitPoints(roomPts(r), 0.95, 0.3) : null;
    } else if (viewMode === "activity") {
      const act = [...avatars.values()].filter((v) => !["disponible", "mission_terminee"].includes(v.agent.activite) || v.agent.lieu !== "poste");
      const pts = (act.length ? act : [...avatars.values()]).map((v) => ({ x: v.root.position.x, z: v.root.position.z })).concat(act.length ? [] : []);
      if (pts.length) t = fitPoints([{ x: Math.min(...pts.map((p) => p.x)) - 6, z: Math.min(...pts.map((p) => p.z)) - 6 }, { x: Math.max(...pts.map((p) => p.x)) + 6, z: Math.max(...pts.map((p) => p.z)) + 6 }], 0.9);
    } else if (viewMode === "follow") {   // caméra individuelle : cadrée à hauteur de poitrine, suit l'agent dans ses déplacements
      const av = avatars.get(viewArg);
      if (av) { followId = viewArg; Object.assign(goal, { tx: av.root.position.x, ty: 0.9, tz: av.root.position.z, r: viewOpts.r ?? 13, phi: viewOpts.phi ?? 1.0, theta: viewOpts.theta ?? goal.theta }); }
      if (reduced) Object.assign(orbit, goal);
      return;
    }
    if (t) Object.assign(goal, { tx: t.tx, ty: 0, tz: t.tz, r: Math.max(14, t.r), phi: t.phi, theta: t.theta });
    if (reduced) Object.assign(orbit, goal);
  }
  function applyCamera() {
    for (const k of ["tx", "ty", "tz", "theta", "phi", "r"]) orbit[k] += (goal[k] - orbit[k]) * (reduced ? 1 : 0.14);
    const { phi, theta, r } = orbit;
    camera.position.set(orbit.tx + r * Math.sin(phi) * Math.sin(theta), orbit.ty + r * Math.cos(phi), orbit.tz + r * Math.sin(phi) * Math.cos(theta)); camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
  }

  // ─────────────────────────── interactions ───────────────────────────
  const pointers = new Map(); let downAt = null, lastPinch = 0, userMoved = false;
  dom.addEventListener("contextmenu", (e) => e.preventDefault());
  dom.addEventListener("pointerdown", (e) => {
    userMoved = true; dom.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    if (pointers.size === 1) downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  dom.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) { const id = agentAt(e); if (id !== hovered) { hovered = id; dom.style.cursor = id ? "pointer" : "grab"; } return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) { if (p.button === 2 || p.shift) pan(dx, dy); else { goal.theta -= dx * 0.006; goal.phi = clampN(goal.phi - dy * 0.005, 0.2, 1.45); } }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      goal.r = clampN(goal.r * (lastPinch / Math.max(d, 1)), 6, 140); lastPinch = d;
    }
  });
  const up = (e) => {
    const was = pointers.size; pointers.delete(e.pointerId);
    if (was === 1 && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && performance.now() - downAt.t < 500) pick(e, e.detail > 1);
    if (!pointers.size) downAt = null;
  };
  dom.addEventListener("pointerup", up); dom.addEventListener("pointercancel", (e) => pointers.delete(e.pointerId));
  dom.addEventListener("wheel", (e) => { e.preventDefault(); userMoved = true; goal.r = clampN(goal.r * (1 + Math.sign(e.deltaY) * 0.1), 6, 140); }, { passive: false });
  dom.addEventListener("dblclick", (e) => pick(e, true));
  function pan(dx, dy) {
    followId = null; viewMode = "free"; goal.ty = 0; hooks.onView?.({ mode: "free" });
    const k = orbit.r * 0.0016, c = Math.cos(orbit.theta), s = Math.sin(orbit.theta);
    goal.tx = clampN(goal.tx - (dx * c + dy * s * 0.9) * k, -70, 70); goal.tz = clampN(goal.tz - (-dx * s + dy * c * 0.9) * k, -70, 70);
  }
  dom.tabIndex = 0;
  dom.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft") goal.theta += 0.12; else if (k === "ArrowRight") goal.theta -= 0.12; else if (k === "ArrowUp") goal.phi = clampN(goal.phi - 0.08, 0.2, 1.45); else if (k === "ArrowDown") goal.phi = clampN(goal.phi + 0.08, 0.2, 1.45);
    else if (k === "+" || k === "=") goal.r = clampN(goal.r * 0.9, 6, 140); else if (k === "-") goal.r = clampN(goal.r * 1.1, 6, 140);
    else if (k === "Escape") { select(null); hooks.onSelect?.(null); } else return;
    e.preventDefault();
  });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function agentAt(e) {
    const r = dom.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...avatars.values()].map((v) => v.hit), false);
    return hits[0]?.object.userData.agentId ?? null;
  }
  function pick(e, focus) { const id = agentAt(e); select(id, focus && !!id); hooks.onSelect?.(id); }
  function select(id, focus = false) {
    selectedId = id;
    if (id && focus) { const av = avatars.get(id); if (av) { viewMode = "free"; followId = null; hooks.onView?.({ mode: "free" }); goal.tx = av.root.position.x; goal.tz = av.root.position.z; goal.r = Math.min(goal.r, 24); } }
  }

  // ─────────────────────────── liens hiérarchiques, plaques, bulles ───────────────────────────
  let links = null; const V = new THREE.Vector3();
  function drawLinks() {
    if (links) { scene.remove(links); links.geometry.dispose(); links.material.dispose(); links = null; }
    const av = selectedId && avatars.get(selectedId); if (!av) return;
    const pts = [], a = av.root.position, ends = [av.agent.manager_id, ...data.agents.filter((x) => x.manager_id === selectedId).map((x) => x.id)];
    for (const id of ends) { const o = avatars.get(id); if (o) pts.push(new THREE.Vector3(a.x, 2.7, a.z), new THREE.Vector3(o.root.position.x, 2.7, o.root.position.z)); }
    if (!pts.length) return;
    links = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.55 + 0.25 * Math.sin(simMs / 250) })); scene.add(links);
  }
  let w = 1, h = 1, labelFrame = 0;
  function updateLabels() {
    const near = orbit.r < 40, now = wallNow(), placed = [];
    for (const av of avatars.values()) {
      const a = av.agent, sel = av.id === selectedId, hov = av.id === hovered;
      V.set(av.root.position.x, av.top + 0.75, av.root.position.z).project(camera);
      av.sx = (V.x * 0.5 + 0.5) * w; av.sy = (-V.y * 0.5 + 0.5) * h; av.vis = V.z < 1 && Math.abs(V.x) < 1.05 && Math.abs(V.y) < 1.05;
      av.want = av.vis && (sel || hov || a.niveau <= 2 || near || av.id === followId); av.prio = sel ? 0 : hov ? 1 : a.niveau;
      // bulle de parole
      const b = av.bubble;
      if (b && now > b.until) av.bubble = null;
      const speaking = av.place?.anim === "speak" && !av.bubble, txt = av.bubble?.text ?? (speaking ? "…" : null);
      if (txt && av.vis) {
        if (!av.bub) { av.bub = document.createElement("div"); av.bub.className = "bubble"; labels.appendChild(av.bub); }
        if (av.bub.textContent !== txt) av.bub.textContent = txt;
        av.bub.style.display = ""; av.bub.style.transform = `translate(-50%,-100%) translate(${av.sx}px,${av.sy - 24}px)`; av.bub.classList.toggle("dots", txt === "…");
      } else if (av.bub) av.bub.style.display = "none";
    }
    for (const av of [...avatars.values()].filter((x) => x.want).sort((x, y) => x.prio - y.prio)) {
      const bw = Math.min(190, av.agent.nom.length * 6.4 + 16), box = [av.sx - bw / 2, av.sy - 22, av.sx + bw / 2, av.sy];
      const free = av.prio <= 1 || !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      av.show = free; if (free) placed.push(box);
    }
    for (const [id, av] of avatars) {
      const show = av.want && av.show; av.el.style.display = show ? "" : "none";
      if (show) { av.el.style.transform = `translate(-50%,-100%) translate(${av.sx}px,${av.sy}px)`; av.el.classList.toggle("sel", id === selectedId); av.el.classList.toggle("hov", id === hovered); }
    }
  }

  // ─────────────────────────── boucle de rendu ───────────────────────────
  let running = false, active = true, onScreen = true, lastTs = 0, lastRender = 0, fpsAvg = 60;
  const wallCut = (dt) => {
    const low = orbit.phi > 1.18;
    for (const w of S.walls) {
      const outside = (camera.position.x - w.x) * w.nx + (camera.position.z - w.z) * w.nz > 0;
      const target = outside || low ? 0.16 : 1; w.s += (target - w.s) * Math.min(1, dt * 7); w.g.scale.y = Math.max(0.1, w.s);
    }
  };
  let lastFrameT = 0;
  function renderOnce() {
    applyCamera();
    const nowT = performance.now(), fdt = Math.min(0.1, (nowT - (lastFrameT || nowT)) / 1000); lastFrameT = nowT;
    wallCut(reduced ? 1 : fdt);
    if (Q.shadows) {   // la zone ombrée suit la cible de la caméra : ombres nettes partout où l'on regarde
      const r = clampN(orbit.r * 0.95, 24, 90), c = sun.shadow.camera;
      sun.target.position.set(orbit.tx, 0, orbit.tz); sun.position.set(orbit.tx - 34, 78, orbit.tz + 46);
      c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.updateProjectionMatrix(); sun.target.updateMatrixWorld();
    }
    if (!(labelFrame++ % Q.labelEvery)) { updateLabels(); }
    drawLinks();
    renderer.render(scene, camera);
  }
  function loop(ts) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (ts - lastRender < 1000 / Q.fps - 3) return;
    const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000); lastTs = ts; lastRender = ts;
    if (dt > 0) fpsAvg += (1 / dt - fpsAvg) * 0.05;
    step(dt); renderOnce();
  }
  const canRun = () => active && onScreen && !document.hidden;
  function start() { if (running || !canRun()) return; running = true; lastTs = 0; requestAnimationFrame(loop); }
  function stop() { running = false; }
  document.addEventListener("visibilitychange", () => (canRun() ? start() : stop()));
  const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((es) => { onScreen = es[0]?.isIntersecting !== false; canRun() ? start() : stop(); }) : null; io?.observe(container);

  const ro = new ResizeObserver(() => {
    w = Math.max(1, container.clientWidth); h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!userMoved) applyView();
    if (!running) renderOnce();
  });
  ro.observe(container);

  // ─────────────────────────── API ───────────────────────────
  function update(next) {
    data = { agents: [], departments: [], stats: {}, meetings: [], openByAgent: {}, ...next };
    data.agents = data.agents.filter((a) => a.etat !== "archive");
    const rebuilt = rebuild();
    const ids = new Set(data.agents.map((a) => a.id));
    for (const id of [...avatars.keys()]) if (!ids.has(id)) removeAvatar(id);
    for (const a of data.agents) {
      const av = avatars.get(a.id);
      if (av) av.agent = a;
      else if (!queue.some((q) => q.id === a.id)) queue.push(a);
    }
    if (rebuilt && !avatars.size && !queue.length) queue.push(...data.agents);
    for (const av of avatars.values()) { av.agent = data.agents.find((x) => x.id === av.id) ?? av.agent; }
    // meilleure restitution à l'ouverture : tout le monde apparaît à sa place réelle (pas de marche artificielle)
    reconcileAll(); drawBoard(); feedDirty = true;
    // entreprise naissante (prototype : direction + quelques collaborateurs) : la vue s'ouvre sur l'étage de direction
    if (!autoViewDone && data.agents.length) { autoViewDone = true; if (!userMoved && viewMode === "general" && data.agents.length <= 8) { viewMode = "executive"; hooks.onView?.({ mode: "executive" }); } }
    if (!userMoved && (viewMode === "general" || viewMode === "executive")) applyView();
    if (!running) { step(0); renderOnce(); }
  }
  function patchAgent(row) {
    const av = avatars.get(row.id), cur = data.agents.find((a) => a.id === row.id);
    if (cur) Object.assign(cur, row); else return;
    if (row.etat === "archive") { update({ ...data }); return; }
    if (av) { av.agent = cur; reconcile(av); }
    if (!running) renderOnce();
  }
  const lineOf = (ev) => {
    const a = data.agents.find((x) => x.id === ev.agent_id); if (!a) return null;
    if (ev.kind === "activite") return `${a.nom} · ${ACTIVITIES[ev.activity]?.label ?? ev.activity}`;
    if (ev.kind === "parole") return `${a.nom} prend la parole`;
    if (ev.kind === "reunion") return `${a.nom} → salle de réunion`;
    if (ev.kind === "briefing") return `${a.nom} · cadrage des missions`;
    const t = data.agents.find((x) => x.id === ev.target_agent_id);
    return `${a.nom} → ${ev.location === "supervision" ? "supervision" : t ? `poste de ${t.nom}` : ev.location}`;
  };
  function pushEvent(ev) {
    const line = lineOf(ev); if (line) { feed.push(line); if (feed.length > 30) feed.shift(); feedDirty = true; }
    const av = avatars.get(ev.agent_id);
    if (ev.kind === "parole" && av) { const text = ev.payload?.extrait ?? ""; if (text) av.bubble = { text, until: wallNow() + clampN(6000 + text.length * 45, 6000, 14000) }; }
    // application immédiate (avant l'arrivée de la ligne d'état) : même résultat que l'état persistant
    const cur = data.agents.find((a) => a.id === ev.agent_id); if (!cur) return;
    const until = ev.duration_ms ? new Date(Date.parse(ev.created_at ?? new Date()) + ev.duration_ms).toISOString() : null;
    if (ev.kind === "activite") { cur.activite_detail = ev.activity; if (ev.status) cur.activite = ev.status; }
    else if (["deplacement", "briefing", "reunion"].includes(ev.kind)) {
      const ids = ev.kind === "deplacement" ? [ev.agent_id] : ev.participants?.length ? ev.participants : [ev.agent_id];
      for (const id of (ev.kind === "reunion" ? [ev.agent_id] : ids)) {
        const t = data.agents.find((a) => a.id === id); if (!t) continue;
        Object.assign(t, ev.location === "poste" ? { lieu: "poste", lieu_cible_agent: null, lieu_jusqua: null } : { lieu: ev.location, lieu_cible_agent: ev.target_agent_id ?? null, lieu_cible_dept: ev.target_dept ?? null, lieu_jusqua: until });
      }
    }
    for (const a of data.agents) if (a.id === ev.agent_id || ev.participants?.includes(a.id)) { const v = avatars.get(a.id); if (v) reconcile(v); }
    if (!running) renderOnce();
  }
  function setMeetings(ms) { data.meetings = ms; drawBoard(); reconcileAll(); }
  function setView(mode, arg, opts = {}) {
    followId = null; viewMode = mode; viewArg = arg ?? null; viewOpts = opts; userMoved = false; activityView = mode === "activity";
    if (mode === "follow") { select(arg, false); }
    applyView(); assignDetail(); hooks.onView?.({ mode, arg });
  }
  function setQuality(name, persist = true) {
    if (!QUALITY[name] || name === qName) return;
    qName = name; Q = QUALITY[name];
    if (persist) try { localStorage.setItem("sanix_company_quality", name); } catch { /* sans stockage */ }
    renderer.setPixelRatio(pixelRatio()); renderer.setSize(w, h, false);
    renderer.shadowMap.enabled = Q.shadows; sun.castShadow = Q.shadows; scene.environmentIntensity = Q.env ? 0.32 : 0; S.layoutKey = ""; mats.clear(); K = createKit(THREE, { lambert: qName !== "high" });   // mobilier et matières reconstruits (ombres, éclairage)
    scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    rebuild();
    const agents = [...avatars.values()].map((v) => v.agent); for (const id of [...avatars.keys()]) removeAvatar(id);
    queue.push(...agents); hooks.onQuality?.(name);
  }
  const resetView = () => setView("general");
  const zoom = (dir) => { userMoved = true; goal.r = clampN(goal.r * (dir > 0 ? 1.25 : 0.8), 6, 140); };
  function setActive(v) { active = v; if (v) { w = Math.max(1, container.clientWidth); h = Math.max(1, container.clientHeight); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); start(); renderOnce(); } else stop(); }
  function dispose() { stop(); ro.disconnect(); io?.disconnect(); disposeStatic(); for (const id of [...avatars.keys()]) removeAvatar(id); renderer.dispose(); dom.remove(); labels.remove(); }
  const screenPositionOf = (id) => { const av = avatars.get(id); if (!av) return null; V.set(av.root.position.x, 1.3 * av.S, av.root.position.z).project(camera); return { x: (V.x * 0.5 + 0.5) * w, y: (-V.y * 0.5 + 0.5) * h, visible: V.z < 1 }; };
  /** Simulation accélérée sans rendu (tests, rattrapage). */
  function advance(seconds) { for (let t = 0; t < seconds; t += 0.05) { wallOffset += 50; step(0.05); } renderOnce(); }
  const inspect = (id) => { const av = avatars.get(id); if (!av) return null; const i = av.inspect(); return { ...i, place: av.place?.key ?? null, anim: av.walking ? "walk" : av.place?.anim ?? i.anim, bubble: av.bubble?.text ?? null, speaking: av.place?.anim === "speak", icon: av.icon.visible ? "oui" : null, marker: av.detail !== "full" }; };
  /** Vrai si le point (x, z) est dans l'emprise d'un bureau ou de la table de réunion (contrôle des trajets). */
  const collides = (x, z) => {
    for (const sl of S.slotOf.values()) if (Math.abs(x - sl.deskX) < 1.4 && Math.abs(z - sl.deskZ) < 0.72) return true;
    return S.rooms.some((r) => r.special === "reunion" && Math.hypot(x - r.x, z - r.z) < 3.05);
  };
  const desk = (id) => { const d = S.desks.get(id); return d ? { multi: d.mon2.visible, docs: d.docs.visible, intensity: d.monMat.emissiveIntensity } : null; };
  const stats = () => ({ avatars: avatars.size, queued: queue.length, rooms: S.rooms.length, quality: qName, dpr: renderer.getPixelRatio(), markers: [...avatars.values()].filter((v) => v.detail !== "full").length, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps: Math.round(fpsAvg), reduced, running, avatarMode: assets ? "glb" : "procedural", shadows: Q.shadows, cam: Object.fromEntries(Object.entries(orbit).map(([k, v]) => [k, Math.round(v * 100) / 100])), aspect: Math.round(camera.aspect * 100) / 100 });
  const board = () => (S.board ? { meeting: activeMeetings().length } : null);
  const feedLines = () => [...feed];
  const has = (id) => data.agents.some((a) => a.id === id);
  /** Heure de référence du bureau (horloge réelle + accélération des simulations de test). */
  const now = () => new Date(wallNow()).toISOString();

  start();
  return { update, patchAgent, pushEvent, setMeetings, select: (id, f) => select(id, f), setView, resetView, zoom, setQuality, setActive, dispose, element: dom, screenPositionOf, advance, inspect, desk, collides, stats, board, feedLines, now, has,
    get quality() { return qName; }, get _scene() { return scene; }, get view() { return { mode: viewMode, arg: viewArg, follow: followId }; } };
}
