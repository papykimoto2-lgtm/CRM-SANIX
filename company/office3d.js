// SANIX AI VIRTUAL COMPANY — bureau virtuel 3D (Three.js).
// Pure représentation : tous les traitements IA tournent sur les serveurs, indépendamment de cette animation.
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";

export const STATUS = {
  disponible: { label: "Disponible", color: "#22C55E" },
  en_mission: { label: "En mission", color: "#3B82F6" },
  en_reunion: { label: "En réunion", color: "#A855F7" },
  en_analyse: { label: "En analyse", color: "#06B6D4" },
  attente_validation: { label: "En attente de validation", color: "#F59E0B" },
  en_difficulte: { label: "En difficulté", color: "#EF4444" },
  mission_terminee: { label: "Mission terminée", color: "#EAB308" },
  suspendu: { label: "Suspendu", color: "#64748B" },
};
export const DEPT_COLORS = { direction: "#1E3A8A", commercial: "#2563EB", marketing: "#DB2777", intelligence: "#7C3AED", relation_client: "#059669", administratif: "#D97706" };

const GRID = [["reunion", "direction", "supervision"], ["commercial", "marketing", "intelligence"], ["relation_client", "administratif", "datacenter"]];
const SPECIAL = { reunion: "Salle de réunion", supervision: "Salle de supervision", datacenter: "Centre de données" };
const ROOM_W = 19, GAP = 2.4, COLS = 4, SLOT_X = 4.4, SLOT_Z = 4.7;

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const hexToNum = (h) => parseInt(h.replace("#", ""), 16);

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export async function createOffice(container, hooks = {}) {
  const THREE = await import(THREE_URL);
  const canvasTest = document.createElement("canvas");
  if (!(canvasTest.getContext("webgl2") || canvasTest.getContext("webgl"))) throw new Error("WebGL indisponible");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0b1220);
  renderer.domElement.setAttribute("aria-label", "Bureau virtuel 3D de SANIX AI VIRTUAL COMPANY");
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
  container.appendChild(renderer.domElement);
  const labels = document.createElement("div");
  labels.className = "np-layer";
  container.appendChild(labels);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b1220, 90, 220);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
  scene.add(new THREE.HemisphereLight(0xcfdcff, 0x1a2238, 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.position.set(24, 48, 30); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x0e1628, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; scene.add(ground);
  const grid = new THREE.GridHelper(300, 100, 0x1c2a4a, 0x131d36); grid.position.y = -0.1; scene.add(grid);

  // ── caches de matériaux / géométries ──
  const mats = new Map(), geos = new Map();
  const M = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
  const G = (key, make) => { if (!geos.has(key)) geos.set(key, make()); return geos.get(key); };
  const std = (c, o = {}) => M(`s${c}${JSON.stringify(o)}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.65, ...o }));
  const glass = (c) => M(`g${c}`, () => new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.1, roughness: 0.2, depthWrite: false }));

  // ── texte / icônes en canvas (sans dépendre d'une police emoji) ──
  function textTexture(lines, { w = 512, h = 128, bg = null, color = "#E6ECF8", size = 44, align = "left" } = {}) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
    x.fillStyle = color; x.textBaseline = "middle"; x.textAlign = align;
    const L = Array.isArray(lines) ? lines : [lines];
    const lh = h / (L.length + 0.4);
    L.forEach((t, i) => {
      x.font = `${i === 0 ? "700" : "500"} ${i === 0 ? size : size * 0.72}px system-ui,Segoe UI,Arial,sans-serif`;
      x.fillText(String(t), align === "left" ? 16 : align === "center" ? w / 2 : w - 16, lh * (i + 0.9));
    });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function iconTexture(kind, color) {
    const s = 128, c = document.createElement("canvas"); c.width = c.height = s;
    const x = c.getContext("2d");
    x.fillStyle = "rgba(11,18,32,.88)"; x.beginPath(); x.arc(64, 64, 58, 0, 7); x.fill();
    x.strokeStyle = color; x.fillStyle = color; x.lineWidth = 8; x.lineCap = x.lineJoin = "round";
    if (kind === "mission") { for (const dx of [-26, 0, 26]) { x.beginPath(); x.arc(64 + dx, 64, 9, 0, 7); x.fill(); } }
    else if (kind === "reunion") { x.beginPath(); x.arc(46, 62, 16, 0, 7); x.arc(82, 62, 16, 0, 7); x.fill(); x.fillRect(38, 84, 52, 12); }
    else if (kind === "analyse") { x.beginPath(); x.arc(58, 58, 24, 0, 7); x.stroke(); x.beginPath(); x.moveTo(76, 76); x.lineTo(96, 96); x.stroke(); }
    else if (kind === "validation") { x.beginPath(); x.moveTo(40, 32); x.lineTo(88, 32); x.lineTo(64, 64); x.lineTo(88, 96); x.lineTo(40, 96); x.lineTo(64, 64); x.closePath(); x.stroke(); }
    else if (kind === "difficulte") { x.fillRect(58, 30, 12, 44); x.beginPath(); x.arc(64, 92, 8, 0, 7); x.fill(); }
    else if (kind === "terminee") { x.beginPath(); x.moveTo(36, 66); x.lineTo(56, 86); x.lineTo(94, 42); x.stroke(); }
    else if (kind === "suspendu") { x.fillRect(42, 36, 14, 56); x.fillRect(72, 36, 14, 56); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const ICON_OF = { en_mission: "mission", en_reunion: "reunion", en_analyse: "analyse", attente_validation: "validation", en_difficulte: "difficulte", mission_terminee: "terminee", suspendu: "suspendu" };
  const iconMats = new Map();
  const iconMat = (status) => {
    if (!ICON_OF[status]) return null;
    if (!iconMats.has(status)) iconMats.set(status, new THREE.SpriteMaterial({ map: iconTexture(ICON_OF[status], STATUS[status].color), transparent: true, depthTest: false }));
    return iconMats.get(status);
  };

  // ── mise en page ──
  const state = { layoutKey: "", rooms: new Map(), staticGroup: new THREE.Group(), seats: [], slotOf: new Map(), screens: [], racks: [] };
  scene.add(state.staticGroup);
  const avatars = new Map();          // id → { group, parts, agent, target, status, since }
  let data = { agents: [], departments: [], stats: {}, meetingAgents: [] };

  function computeLayout() {
    const byDept = new Map();
    for (const a of data.agents) { if (!byDept.has(a.departement_id)) byDept.set(a.departement_id, []); byDept.get(a.departement_id).push(a); }
    for (const l of byDept.values()) l.sort((a, b) => a.niveau - b.niveau || a.nom.localeCompare(b.nom));
    const known = new Set(GRID.flat());
    const extra = [...byDept.keys(), ...data.departments.map((d) => d.id)].filter((id, i, arr) => !known.has(id) && arr.indexOf(id) === i);
    const rowsDef = GRID.map((r) => [...r]);
    for (let i = 0; i < extra.length; i += 3) rowsDef.push([extra[i], extra[i + 1], extra[i + 2]].filter(Boolean));
    const rooms = [], rowDepth = [];
    rowsDef.forEach((row, ri) => {
      let depth = 12;
      row.forEach((id) => { const n = (byDept.get(id) ?? []).length; if (!SPECIAL[id]) depth = Math.max(depth, Math.ceil(Math.max(n, 1) / COLS) * SLOT_Z + 6); });
      rowDepth[ri] = depth;
    });
    const total = rowDepth.reduce((s, d) => s + d, 0) + GAP * (rowDepth.length - 1);
    let z = -total / 2;
    rowsDef.forEach((row, ri) => {
      const cw = ROOM_W * row.length + GAP * (row.length - 1);
      row.forEach((id, ci) => {
        const dept = data.departments.find((d) => d.id === id);
        const title = id === "direction" ? "Bureau du directeur IA" : SPECIAL[id] ?? (dept ? `${dept.nom}` : id);
        rooms.push({ id, title, x: -cw / 2 + ROOM_W / 2 + ci * (ROOM_W + GAP), z: z + rowDepth[ri] / 2, w: ROOM_W, d: rowDepth[ri], agents: byDept.get(id) ?? [],
          color: DEPT_COLORS[id] ?? "#475569", special: SPECIAL[id] ? id : null });
      });
      z += rowDepth[ri] + GAP;
    });
    return rooms;
  }

  function disposeStatic() {
    state.staticGroup.traverse((o) => { if (o.material?.map && o.userData.own) o.material.map.dispose(); if (o.userData.own) { o.geometry?.dispose(); o.material?.dispose(); } });
    scene.remove(state.staticGroup);
    state.staticGroup = new THREE.Group(); scene.add(state.staticGroup);
    state.seats = []; state.slotOf.clear(); state.screens = []; state.racks = [];
  }

  function buildRoom(r) {
    const g = new THREE.Group(); g.position.set(r.x, 0, r.z);
    const c = hexToNum(r.color), tint = new THREE.Color(c).lerp(new THREE.Color(0x0e1628), 0.82).getHex();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.2, r.d), std(tint)); floor.position.y = -0.0; floor.userData.own = true; g.add(floor);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(r.w, 0.2, r.d)), new THREE.LineBasicMaterial({ color: c }));
    edge.userData.own = true; g.add(edge);
    // parois de verre basses (fond, côtés)
    for (const [w, d, x, z] of [[r.w, 0.12, 0, -r.d / 2], [0.12, r.d, -r.w / 2, 0], [0.12, r.d, r.w / 2, 0]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), glass(c)); wall.position.set(x, 1.3, z); g.add(wall);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), std(c, { emissive: c, emissiveIntensity: 0.35 })); top.position.set(x, 2.5, z); g.add(top);
    }
    // étiquette au sol
    const n = r.agents.length;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 2.1), new THREE.MeshBasicMaterial({
      map: textTexture([r.title, r.special ? "" : `${n} collaborateur${n > 1 ? "s" : ""}`].filter((x, i) => i === 0 || x), { w: 640, h: 128, size: 52 }), transparent: true }));
    label.rotation.x = -Math.PI / 2; label.position.set(-r.w / 2 + 5.8, 0.13, r.d / 2 - 1.5); label.userData.own = true; g.add(label);

    if (!r.special) {
      // postes de travail
      r.agents.forEach((a, i) => {
        const col = i % COLS, row = Math.floor(i / COLS);
        const lx = (col - (COLS - 1) / 2) * SLOT_X, lz = -r.d / 2 + 2.6 + row * SLOT_Z;
        state.slotOf.set(a.id, { x: r.x + lx, z: r.z + lz + 1.35 });
        const desk = new THREE.Group(); desk.position.set(lx, 0, lz);
        const top = new THREE.Mesh(G("deskTop", () => new THREE.BoxGeometry(2.7, 0.1, 1.3)), std(0x2b3a5c)); top.position.y = 0.82; desk.add(top);
        for (const sx of [-1.25, 1.25]) { const leg = new THREE.Mesh(G("deskLeg", () => new THREE.BoxGeometry(0.1, 0.8, 1.15)), std(0x1b2745)); leg.position.set(sx, 0.4, 0); desk.add(leg); }
        const sc = a.etat === "suspendu" ? STATUS.suspendu.color : (STATUS[a.activite]?.color ?? STATUS.disponible.color);
        const mon = new THREE.Mesh(G("mon", () => new THREE.BoxGeometry(1.15, 0.7, 0.06)), M(`mon${sc}`, () => new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: hexToNum(sc), emissiveIntensity: 0.95, roughness: 0.4 })));
        mon.position.set(0, 1.35, -0.15); desk.add(mon); mon.userData.monitorOf = a.id;
        const stand = new THREE.Mesh(G("stand", () => new THREE.BoxGeometry(0.12, 0.3, 0.1)), std(0x1b2745)); stand.position.set(0, 0.98, -0.12); desk.add(stand);
        const chair = new THREE.Mesh(G("chair", () => new THREE.BoxGeometry(0.8, 0.12, 0.8)), std(0x16213a)); chair.position.set(0, 0.55, 1.35); desk.add(chair);
        const back = new THREE.Mesh(G("chairBack", () => new THREE.BoxGeometry(0.8, 0.9, 0.1)), std(0x16213a)); back.position.set(0, 1.0, 1.75); desk.add(back);
        g.add(desk);
      });
    }
    if (r.special === "reunion") {
      const table = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.18, 40), std(0x3b2a5f)); table.position.y = 0.85; g.add(table);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 0.85, 16), std(0x241a3d)); leg.position.y = 0.42; g.add(leg);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, sx = Math.sin(a) * 4.1, sz = Math.cos(a) * 4.1;
        const seat = new THREE.Mesh(G("seat", () => new THREE.CylinderGeometry(0.4, 0.4, 0.1, 14)), std(0x241a3d)); seat.position.set(sx, 0.5, sz); g.add(seat);
        state.seats.push({ x: r.x + sx * 0.9, z: r.z + sz * 0.9, a });
      }
      const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.6), new THREE.MeshBasicMaterial({ map: textTexture(["Réunions de travail", "Ordre du jour · procès-verbal · plan d'action"], { w: 768, h: 256, bg: "#1a1230", size: 56 }) }));
      board.position.set(0, 2.0, -r.d / 2 + 0.2); g.add(board); board.userData.own = true;
    }
    if (r.special === "supervision") {
      for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({ map: textTexture("…", { w: 512, h: 288, bg: "#0b1a33" }) });
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.9), mat); scr.position.set(-5.6 + i * 5.6, 2.1, -r.d / 2 + 0.25); g.add(scr);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(5.35, 3.05, 0.1), std(0x1b2745)); frame.position.set(scr.position.x, scr.position.y, scr.position.z - 0.07); g.add(frame);
        state.screens.push(scr);
      }
      const console_ = new THREE.Mesh(new THREE.BoxGeometry(11, 0.9, 1.6), std(0x1b2745)); console_.position.set(0, 0.5, 1.5); g.add(console_);
    }
    if (r.special === "datacenter") {
      for (let i = 0; i < 6; i++) {
        const rack = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.2, 1.2), std(0x151f38)); rack.position.set(-6.2 + i * 2.5, 1.7, -r.d / 2 + 1.5); g.add(rack);
        for (let k = 0; k < 5; k++) {
          const led = new THREE.Mesh(G("led", () => new THREE.BoxGeometry(0.22, 0.08, 0.04)), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
          led.position.set(rack.position.x + 0.45, 0.8 + k * 0.55 + 0.5, rack.position.z + 0.62); g.add(led); led.userData.own = true; state.racks.push({ m: led, phase: Math.random() * 6 });
        }
      }
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: textTexture("…", { w: 512, h: 256, bg: "#0b1a33" }) })); scr.position.set(0, 2.2, r.d / 2 - 0.4); scr.rotation.y = Math.PI; g.add(scr); state.screens.push(scr);
    }
    if (r.id === "direction") {
      const big = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.14, 1.9), std(0x3a2a14, { metalness: 0.2 })); big.position.set(0, 0.88, -r.d / 2 + 2.2); g.add(big);
      const mon = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.07), M("dgmon", () => new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: 0xfacc15, emissiveIntensity: 0.9 }))); mon.position.set(0, 1.55, -r.d / 2 + 2.0); g.add(mon);
      state.slotOf.set("__dg", { x: r.x, z: r.z - r.d / 2 + 4.2 });
    }
    state.staticGroup.add(g);
  }

  function rebuild() {
    const rooms = computeLayout();
    const key = rooms.map((r) => `${r.id}:${r.agents.map((a) => `${a.id}${a.etat === "suspendu" ? "s" : a.activite}`).join(",")}:${r.d}`).join("|") + data.departments.map((d) => d.nom).join(",");
    if (key === state.layoutKey) return;
    state.layoutKey = key;
    disposeStatic();
    rooms.forEach(buildRoom);
    state.rooms = new Map(rooms.map((r) => [r.id, r]));
  }

  // ── avatars ──
  function makeAvatar(a) {
    const g = new THREE.Group(); const s = a.niveau === 1 ? 1.28 : a.niveau === 2 ? 1.14 : 1;
    const dept = hexToNum(DEPT_COLORS[a.departement_id] ?? "#475569");
    const skinTones = [0x6b4423, 0x8d5a32, 0xa9714a, 0x4a2c17, 0xc08a5e, 0x7a4b2a];
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4 * s, 0.75 * s, 4, 12), new THREE.MeshStandardMaterial({ color: dept, roughness: 0.55 })); body.position.y = 1.0 * s;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.31 * s, 18, 14), new THREE.MeshStandardMaterial({ color: skinTones[hash(a.id) % skinTones.length], roughness: 0.7 })); head.position.y = 1.86 * s;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.335 * s, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 0.9 })); hair.position.y = 1.88 * s; hair.rotation.x = 0.35;
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.72 * s, 0.95 * s, 40), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.04;
    const spin = new THREE.Mesh(new THREE.TorusGeometry(0.5 * s, 0.035, 8, 28), new THREE.MeshBasicMaterial({ color: 0x06b6d4 })); spin.rotation.x = Math.PI / 2; spin.position.y = 2.35 * s; spin.visible = false;
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false })); icon.scale.set(0.95, 0.95, 1); icon.position.y = 2.75 * s; icon.visible = false; icon.renderOrder = 10;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.95 * s, 0.95 * s, 2.5 * s, 10), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.position.y = 1.25 * s;
    g.add(body, head, hair, halo, spin, icon, hit);
    if (a.niveau === 1) { const crown = new THREE.Mesh(new THREE.TorusGeometry(0.28 * s, 0.05, 8, 20), std(0xfacc15, { emissive: 0xfacc15, emissiveIntensity: 0.6 })); crown.rotation.x = Math.PI / 2; crown.position.y = 2.28 * s; g.add(crown); }
    if (a.niveau === 2) { const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0 * s, 0.1, 0.5 * s), std(0xcbd5e1, { metalness: 0.4 })); bar.position.y = 1.55 * s; g.add(bar); }
    g.userData.agentId = a.id;
    hit.userData.agentId = a.id; body.userData.agentId = a.id; head.userData.agentId = a.id;
    const el = document.createElement("div"); el.className = "np"; labels.appendChild(el);
    return { group: g, body, head, halo, spin, icon, hit, el, s, agent: a, status: null, since: 0, target: new THREE.Vector3(), seed: Math.random() * 10 };
  }

  function statusKey(a) { return a.etat === "suspendu" ? "suspendu" : (a.activite in STATUS ? a.activite : "disponible"); }

  function applyStatus(av, a) {
    const k = statusKey(a);
    if (av.status !== k) { av.since = performance.now(); av.status = k; }
    const col = hexToNum(STATUS[k].color);
    av.halo.material.color.setHex(col);
    av.body.material.color.setHex(k === "suspendu" ? 0x475569 : hexToNum(DEPT_COLORS[a.departement_id] ?? "#475569"));
    const im = iconMat(k);
    av.icon.visible = !!im; if (im) av.icon.material = im;
    av.spin.visible = k === "en_analyse";
    av.el.textContent = a.nom;
    av.el.dataset.status = k;
  }

  function placeAgents() {
    const inMeeting = [...avatars.values()].filter((v) => v.agent.activite === "en_reunion" && v.agent.etat === "actif");
    const seats = state.seats;
    inMeeting.forEach((v, i) => { const s = seats[i % Math.max(seats.length, 1)]; if (s) v.meetingSeat = s; });
    for (const [id, av] of avatars) {
      const a = av.agent;
      let p = state.slotOf.get(id);
      if (a.niveau === 1 && state.slotOf.get("__dg")) p = state.slotOf.get("__dg");
      if (a.activite === "en_reunion" && a.etat === "actif" && av.meetingSeat) { av.target.set(av.meetingSeat.x, 0, av.meetingSeat.z); av.facing = Math.PI + av.meetingSeat.a; }
      else if (p) { av.target.set(p.x, 0, p.z); av.facing = 0; }
      if (!av.placed && (p || av.meetingSeat)) { av.group.position.copy(av.target); av.placed = true; }
    }
  }

  // ── écrans de supervision / centre de données ──
  function drawScreens() {
    const s = data.stats ?? {};
    const lines = [
      ["Collaborateurs actifs", `${s.agentsActifs ?? 0} / ${s.agentsMax ?? "–"}`, s.agentsActifs / Math.max(1, s.agentsMax ?? 1)],
      ["Missions en cours", String(s.missionsEnCours ?? 0), null],
      ["Coût IA du jour", `${(s.coutJour ?? 0).toFixed(2)} $ / ${(s.budgetJour ?? 0).toFixed(0)} $`, (s.coutJour ?? 0) / Math.max(1, s.budgetJour ?? 1)],
    ];
    state.screens.forEach((scr, i) => {
      const c = document.createElement("canvas"); c.width = 512; c.height = 288;
      const x = c.getContext("2d"); x.fillStyle = "#0b1a33"; x.fillRect(0, 0, 512, 288);
      x.fillStyle = "#93c5fd"; x.font = "600 26px system-ui,Arial"; x.textAlign = "left";
      const isDC = i === 3;
      const [t, v, ratio] = isDC ? ["Données du CRM", `${s.prospects ?? 0} prospects`, null] : (lines[i] ?? lines[0]);
      x.fillText(t, 28, 54); x.fillStyle = "#fff"; x.font = "800 52px system-ui,Arial"; x.fillText(v, 28, 140);
      if (ratio !== null && ratio !== undefined) { x.fillStyle = "#1e3a8a"; x.fillRect(28, 190, 456, 22); x.fillStyle = ratio > 0.85 ? "#ef4444" : "#3b82f6"; x.fillRect(28, 190, 456 * clampN(ratio, 0, 1), 22); }
      if (isDC) { x.fillStyle = "#86efac"; x.font = "600 28px system-ui,Arial"; x.fillText(`${s.offres ?? 0} offres · ${s.validations ?? 0} validations en attente`, 28, 220); }
      if (i === 1) { x.fillStyle = "#86efac"; x.font = "600 28px system-ui,Arial"; x.fillText(`${s.missionsTerminees ?? 0} terminées aujourd'hui`, 28, 200); }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      scr.material.map?.dispose(); scr.material.map = tex; scr.material.needsUpdate = true;
    });
  }

  // ── caméra ──
  const orbit = { tx: 0, ty: 0, tz: 0, theta: 0, phi: 0.86, r: 78 };
  const goal = { ...orbit };
  const resetGoal = () => Object.assign(goal, { tx: 0, ty: 0, tz: 0, theta: 0, phi: 0.86, r: Math.max(40, fitRadius()) });
  function fitRadius() {
    const rooms = [...state.rooms.values()]; if (!rooms.length) return 78;
    const minX = Math.min(...rooms.map((r) => r.x - r.w / 2)), maxX = Math.max(...rooms.map((r) => r.x + r.w / 2));
    const minZ = Math.min(...rooms.map((r) => r.z - r.d / 2)), maxZ = Math.max(...rooms.map((r) => r.z + r.d / 2));
    const pts = []; for (const x of [minX, maxX]) for (const z of [minZ, maxZ]) for (const y of [0, 3]) pts.push(new THREE.Vector3(x, y, z));
    const cam = camera.clone(); cam.aspect = camera.aspect || 1.5; cam.updateProjectionMatrix();
    const { phi, theta } = { phi: 0.86, theta: 0 }, v = new THREE.Vector3();
    for (let r = 30; r < 240; r *= 1.03) {
      cam.position.set(r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.cos(theta));
      cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
      const mx = cam.aspect < 0.9 ? 1.12 : 0.97;   // portrait : on accepte de rogner un peu les côtés (déplacement possible)
      if (pts.every((p) => { v.copy(p).project(cam); return Math.abs(v.x) < mx && Math.abs(v.y) < 0.93 && v.z < 1; })) return r;
    }
    return 170;
  }
  function applyCamera() {
    for (const k of ["tx", "ty", "tz", "theta", "phi", "r"]) orbit[k] += (goal[k] - orbit[k]) * (reduced ? 1 : 0.16);
    const { phi, theta, r } = orbit;
    camera.position.set(orbit.tx + r * Math.sin(phi) * Math.sin(theta), orbit.ty + r * Math.cos(phi), orbit.tz + r * Math.sin(phi) * Math.cos(theta));
    camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
  }
  const pointers = new Map(); let downAt = null, lastPinch = 0;
  const dom = renderer.domElement;
  dom.addEventListener("contextmenu", (e) => e.preventDefault());
  dom.addEventListener("pointerdown", (e) => {
    dom.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    if (pointers.size === 1) downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  dom.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) { hoverAt(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      if (p.button === 2 || p.shift) pan(dx, dy);
      else { goal.theta -= dx * 0.006; goal.phi = clampN(goal.phi - dy * 0.005, 0.2, 1.45); }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      goal.r = clampN(goal.r * (lastPinch / Math.max(d, 1)), 12, 130); lastPinch = d;
    }
  });
  const end = (e) => {
    const was = pointers.size; pointers.delete(e.pointerId);
    if (was === 1 && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && performance.now() - downAt.t < 500) pick(e, e.detail > 1);
    if (!pointers.size) downAt = null;
  };
  dom.addEventListener("pointerup", end); dom.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); });
  dom.addEventListener("wheel", (e) => { e.preventDefault(); goal.r = clampN(goal.r * (1 + Math.sign(e.deltaY) * 0.1), 12, 130); }, { passive: false });
  dom.addEventListener("dblclick", (e) => pick(e, true));
  function pan(dx, dy) {
    const k = orbit.r * 0.0016, c = Math.cos(orbit.theta), s = Math.sin(orbit.theta);
    goal.tx -= (dx * c + dy * s * 0.9) * k; goal.tz -= (-dx * s + dy * c * 0.9) * k;
    goal.tx = clampN(goal.tx, -60, 60); goal.tz = clampN(goal.tz, -60, 60);
  }
  dom.tabIndex = 0;
  dom.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft") goal.theta += 0.12; else if (k === "ArrowRight") goal.theta -= 0.12;
    else if (k === "ArrowUp") goal.phi = clampN(goal.phi - 0.08, 0.2, 1.45); else if (k === "ArrowDown") goal.phi = clampN(goal.phi + 0.08, 0.2, 1.45);
    else if (k === "+" || k === "=") goal.r = clampN(goal.r * 0.9, 12, 130); else if (k === "-") goal.r = clampN(goal.r * 1.1, 12, 130);
    else if (k === "Escape") { select(null); hooks.onSelect?.(null); } else return;
    e.preventDefault();
  });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function agentAt(e) {
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...avatars.values()].map((v) => v.hit), false);
    return hits[0]?.object.userData.agentId ?? null;
  }
  let hovered = null;
  function hoverAt(e) { const id = agentAt(e); if (id !== hovered) { hovered = id; dom.style.cursor = id ? "pointer" : "grab"; } }
  let selectedId = null;
  function pick(e, focus) {
    const id = agentAt(e);
    select(id, focus && !!id);
    hooks.onSelect?.(id);
  }
  function select(id, focus = false) {
    selectedId = id;
    if (id && focus) { const av = avatars.get(id); if (av) { goal.tx = av.group.position.x; goal.tz = av.group.position.z; goal.r = Math.min(goal.r, 26); } }
  }

  // ── liens hiérarchiques de l'agent sélectionné ──
  let links = null;
  function drawLinks(now) {
    if (links) { scene.remove(links); links.geometry.dispose(); links.material.dispose(); links = null; }
    const av = selectedId && avatars.get(selectedId); if (!av) return;
    const pts = [], a = av.group.position;
    const ends = [av.agent.manager_id, ...data.agents.filter((x) => x.manager_id === selectedId).map((x) => x.id)];
    for (const id of ends) { const o = avatars.get(id); if (o) pts.push(new THREE.Vector3(a.x, 2.6, a.z), new THREE.Vector3(o.group.position.x, 2.6, o.group.position.z)); }
    if (!pts.length) return;
    links = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.55 + 0.25 * Math.sin(now / 250) }));
    scene.add(links);
  }

  // ── boucle de rendu ──
  const clock = { last: performance.now() }; const V = new THREE.Vector3();
  let active = true, running = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - clock.last) / 1000); clock.last = now;
    applyCamera();
    const near = orbit.r < 40;
    for (const [id, av] of avatars) {
      const a = av.agent, k = av.status, t = now / 1000 + av.seed;
      av.group.position.x += (av.target.x - av.group.position.x) * (reduced ? 1 : Math.min(1, dt * 3.2));
      av.group.position.z += (av.target.z - av.group.position.z) * (reduced ? 1 : Math.min(1, dt * 3.2));
      av.group.rotation.y += (((av.facing ?? 0) - av.group.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 4);
      const sel = id === selectedId, hov = id === hovered;
      if (!reduced) {
        const bob = k === "disponible" ? Math.sin(t * 1.6) * 0.025 : 0;
        av.body.position.y = 1.0 * av.s + bob; av.head.position.y = 1.86 * av.s + bob;
        av.body.rotation.x = k === "en_mission" ? Math.sin(t * 7) * 0.06 : 0;
        av.group.position.y = k === "mission_terminee" && now - av.since < 1400 ? Math.abs(Math.sin((now - av.since) / 220)) * 0.5 : 0;
        av.spin.rotation.z = t * 3;
        av.halo.material.opacity = k === "en_difficulte" ? 0.4 + 0.5 * Math.abs(Math.sin(t * 5)) : k === "attente_validation" ? 0.45 + 0.4 * Math.sin(t * 2.4) ** 2 : k === "suspendu" ? 0.35 : 0.85;
        av.icon.position.y = (2.75 * av.s) + (k === "en_difficulte" ? Math.sin(t * 14) * 0.05 : Math.sin(t * 2) * 0.06);
      }
      av.halo.scale.setScalar(sel ? 1.35 : hov ? 1.15 : 1);
      V.set(av.group.position.x, 2.9 * av.s + 0.5, av.group.position.z).project(camera);
      av.sx = (V.x * 0.5 + 0.5) * w; av.sy = (-V.y * 0.5 + 0.5) * h; av.vis = V.z < 1 && Math.abs(V.x) < 1.05 && Math.abs(V.y) < 1.05;
      av.want = av.vis && (sel || hov || a.niveau <= 2 || near);
      av.prio = sel ? 0 : hov ? 1 : a.niveau;
    }
    // priorité : sélection, survol, hiérarchie ; une plaque qui en recouvre une autre est masquée
    const placed = [];
    for (const av of [...avatars.values()].filter((x) => x.want).sort((a, b) => a.prio - b.prio)) {
      const bw = Math.min(190, av.agent.nom.length * 6.4 + 16), box = [av.sx - bw / 2, av.sy - 22, av.sx + bw / 2, av.sy];
      const free = av.prio <= 1 || !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      av.show = free; if (free) placed.push(box);
    }
    for (const [id, av] of avatars) {
      const show = av.want && av.show;
      av.el.style.display = show ? "" : "none";
      if (show) { av.el.style.transform = `translate(-50%,-100%) translate(${av.sx}px,${av.sy}px)`; av.el.classList.toggle("sel", id === selectedId); }
    }
    for (const r of state.racks) r.m.visible = Math.sin(now / 300 + r.phase) > -0.5;
    drawLinks(now);
    renderer.render(scene, camera);
  }
  function loop(now) { if (!running) return; frame(now); requestAnimationFrame(loop); }
  function start() { if (running || !active || document.hidden) return; running = true; clock.last = performance.now(); requestAnimationFrame(loop); }
  function stop() { running = false; }
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  let w = 1, h = 1;
  const ro = new ResizeObserver(() => {
    w = Math.max(1, container.clientWidth); h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!userMoved) { resetGoal(); }
    if (!running) frame(performance.now());
  });
  ro.observe(container);
  let userMoved = false;
  dom.addEventListener("pointerdown", () => { userMoved = true; });
  dom.addEventListener("wheel", () => { userMoved = true; }, { passive: true });

  function update(next) {
    data = { agents: [], departments: [], stats: {}, ...next };
    const live = data.agents.filter((a) => a.etat !== "archive");
    data.agents = live;
    rebuild();
    const ids = new Set(live.map((a) => a.id));
    for (const [id, av] of avatars) if (!ids.has(id)) { scene.remove(av.group); av.el.remove(); avatars.delete(id); }
    for (const a of live) {
      let av = avatars.get(a.id);
      if (!av) { av = makeAvatar(a); avatars.set(a.id, av); scene.add(av.group); }
      av.agent = a; applyStatus(av, a);
    }
    placeAgents(); drawScreens();
    if (!userMoved) { resetGoal(); Object.assign(orbit, goal); }
    if (!running) frame(performance.now());
  }

  function resetView() { userMoved = false; resetGoal(); }
  function setActive(v) { active = v; v ? start() : stop(); if (v) { w = Math.max(1, container.clientWidth); h = Math.max(1, container.clientHeight); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); frame(performance.now()); } }
  function dispose() {
    stop(); ro.disconnect(); disposeStatic(); renderer.dispose(); dom.remove(); labels.remove();
  }
  start();
  const screenPositionOf = (id) => { const av = avatars.get(id); if (!av) return null; V.set(av.group.position.x, 1.4 * av.s, av.group.position.z).project(camera); return { x: (V.x * 0.5 + 0.5) * w, y: (-V.y * 0.5 + 0.5) * h, visible: V.z < 1 }; };
  return { update, screenPositionOf, select: (id, focus) => select(id, focus), resetView, setActive, dispose, element: dom, stats: () => ({ avatars: avatars.size, rooms: state.rooms.size, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }) };
}
