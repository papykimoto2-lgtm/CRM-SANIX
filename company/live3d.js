// SANIX AI · Salle de contrôle — vue 3D du réseau des agents (Three.js local, aucun CDN).
// Une galaxie : la direction générale au centre, un anneau par niveau hiérarchique, un secteur par direction. Caméra libre :
// glisser = tourner, molette ou pincement = zoom, clic droit / deux doigts = déplacer, double-clic = vue d'ensemble, clic sur un agent = vol vers lui.
// Les états affichés viennent des missions réelles (api.agentState) ; les impulsions de chaque action viennent du journal (api.fx).
import * as THREE from "./vendor/three.bundle.js";

const OMEGA = { 2: .045, 3: -.07, 4: .09, 5: -.11 };
const SECTOR_R = [0, 0, 7.5, 12, 16.5, 21], LEVEL_Y = [0, 0, 3.2, .9, -1.6, -4], NODE_S = [0, 2.3, 1.3, 1.1, .95, .85];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (h) => new THREE.Color(h);

function glowTexture(inner = "rgba(255,255,255,1)", mid = "rgba(255,255,255,.35)") {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(.25, mid); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}
function ringTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); g.strokeStyle = "#fff"; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 56, 0, 6.2832); g.stroke(); return new THREE.CanvasTexture(c);
}
function labelSprite(text, color = "#E8FBFF") {
  const c = document.createElement("canvas"), g = c.getContext("2d"); g.font = "600 30px system-ui,sans-serif"; const w = Math.ceil(g.measureText(text).width) + 28; c.width = w; c.height = 52;
  g.font = "600 30px system-ui,sans-serif"; g.fillStyle = "rgba(5,11,22,.72)"; g.beginPath(); g.roundRect?.(2, 2, w - 4, 48, 14); g.fill(); g.fillStyle = color; g.textBaseline = "middle"; g.fillText(text, 14, 27);
  const t = new THREE.CanvasTexture(c), s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false })); s.scale.set(w / 52 * .7, .7, 1); s.renderOrder = 10; return s;
}

export function create(host, api) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x050B16, 1); host.appendChild(renderer.domElement); const cvs = renderer.domElement; cvs.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:grab";
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x050B16, .012);
  const camera = new THREE.PerspectiveCamera(50, 1, .1, 400), world = new THREE.Group(); scene.add(world);
  const glow = glowTexture(), ringTex = ringTexture();
  const cam = { theta: .6, phi: 1.1, r: 58, tx: 0, ty: 0, tz: 0 }, goal = { ...cam }, HOME = { theta: .6, phi: 1.1, r: 58, tx: 0, ty: 0, tz: 0 };
  let auto = true, lastTouch = performance.now(), speaking = false, hover = null, key = "", W = 1, H = 1, running = true, t0 = performance.now();
  let edgeNodes = [], actNodes = [], dyn = true, spin = 0, nodes = [], byId = new Map(), edgeBase = null, edgeOn = null, flows = [], pulses = [], shocks = [];

  // décor : étoiles, anneaux de niveau
  const sp = new Float32Array(900 * 3); for (let i = 0; i < 900; i++) { const r = 60 + Math.random() * 120, a = Math.random() * 6.2832, b = Math.acos(2 * Math.random() - 1); sp.set([r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a)], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9FB6E6, size: .9, sizeAttenuation: true, transparent: true, opacity: .7, depthWrite: false })); scene.add(stars);
  for (const l of [2, 3, 4, 5]) { const m = new THREE.Mesh(new THREE.RingGeometry(SECTOR_R[l] - .03, SECTOR_R[l] + .03, 128), new THREE.MeshBasicMaterial({ color: 0x22D3EE, transparent: true, opacity: .09, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = Math.PI / 2; m.position.y = LEVEL_Y[l]; world.add(m); }

  function clearGroup() { for (const n of nodes) { world.remove(n.grp); n.grp.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); } for (const o of [edgeBase, edgeOn]) if (o) { world.remove(o); o.geometry.dispose(); o.material.dispose(); } nodes = []; byId = new Map(); edgeBase = edgeOn = null; }
  function build() {
    clearGroup(); const ag = api.D.agents.filter((a) => a.etat !== "archive"), dg = ag.filter((a) => a.niveau === 1), rest = ag.filter((a) => a.niveau !== 1);
    const depts = [...new Set(rest.map((a) => a.departement_id ?? ""))].sort(), per = depts.map((d) => rest.filter((a) => (a.departement_id ?? "") === d).length), tot = per.reduce((s, n) => s + n, 0) || 1; let ang = 0;
    const add = (a, x, y, z, lvl) => {
      const grp = new THREE.Group(), col = a.niveau === 1 ? "#FACC15" : api.deptColor(a.departement_id), s = NODE_S[lvl];
      const core = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: hex(col) })); core.scale.setScalar(s * .6);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: hex(col), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .8 })); halo.scale.setScalar(s * 3.4);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 1.15, .05, 8, 48), new THREE.MeshBasicMaterial({ color: 0x22D3EE, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); ring.rotation.x = Math.PI / 2;
      grp.add(core, halo, ring); grp.position.set(x, y, z); world.add(grp);
      const n = { id: a.id, a, grp, core, halo, ring, s, lvl, st: "idle", ph: Math.random() * 6.28, base: new THREE.Vector3(x, y, z), home: new THREE.Vector3(x, y, z), ang: 0, label: null, col }; nodes.push(n); byId.set(a.id, n);
    };
    dg.forEach((a, i) => add(a, (i - (dg.length - 1) / 2) * 4, 0, 0, 1));
    depts.forEach((d, di) => {
      const span = 6.2832 * per[di] / tot, list = rest.filter((a) => (a.departement_id ?? "") === d);
      for (const lvl of [2, 3, 4, 5]) { const row = list.filter((a) => a.niveau === lvl); row.forEach((a, i) => { const t = ang + span * ((i + .5) / row.length), r = SECTOR_R[lvl] + (i % 2 ? .9 : -.9) * (lvl > 3), y = LEVEL_Y[lvl] + Math.sin(t * 3) * .5; add(a, Math.cos(t) * r, y, Math.sin(t) * r, lvl); }); }
      ang += span;
    });
    // liens hiérarchiques (tous, ternes) et liens actifs (reconstruits à chaque mise à jour)
    const core = nodes.find((n) => n.lvl === 1), pos = [], colr = [];
    for (const n of nodes) { if (n.lvl === 1) continue; const m = byId.get(n.a.manager_id) ?? core; if (!m) continue; pos.push(m.base.x, m.base.y, m.base.z, n.base.x, n.base.y, n.base.z); colr.push(.2, .3, .55, .2, .3, .55); n.parent = m; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
    edgeBase = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .55 })); edgeBase.frustumCulled = false; world.add(edgeBase); edgeNodes = nodes.filter((n) => n.parent);
    edgeOn = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x67E8F9, transparent: true, opacity: .95, blending: THREE.AdditiveBlending })); edgeOn.frustumCulled = false; world.add(edgeOn);
    flows = []; actNodes = [];
  }
  function update() {
    const k = api.D.agents.map((a) => a.id + a.niveau + a.departement_id).join("|"); if (k !== key) { key = k; build(); }
    const act = [];
    for (const n of nodes) { n.st = api.agentState(n.a); if ((n.st === "run" || n.st === "wait") && n.parent) act.push(n); }
    const p = []; for (const n of act) p.push(n.parent.base.x, n.parent.base.y, n.parent.base.z, n.base.x, n.base.y, n.base.z);
    edgeOn.geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); actNodes = act;
    flows = act.map((n) => ({ n, ph: Math.random() })); setFlowPoints();
    for (const n of nodes) { const want = n.lvl === 1 || n.id === sel; if (want && !n.label) { n.label = labelSprite(api.clip(n.a.nom.replace(/^IA\s+/i, ""), 26), n.st === "run" ? "#E8FBFF" : "#BFD0F0"); n.label.position.set(0, n.s * 1.9, 0); n.grp.add(n.label); } else if (!want && n.label) { n.grp.remove(n.label); n.label.material.map.dispose(); n.label.material.dispose(); n.label = null; } }
  }
  let flowPts = null;
  function setFlowPoints() { if (flowPts) { world.remove(flowPts); flowPts.geometry.dispose(); flowPts.material.dispose(); flowPts = null; } if (!flows.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(flows.length * 3), 3)); flowPts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xA5F3FC, size: .55, map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); flowPts.frustumCulled = false; world.add(flowPts); }
  let sel = null;
  function fx(a) {
    const n = byId.get(a.agent_id), core = nodes.find((x) => x.lvl === 1); if (!n || !core) return;
    const ok = a.ok !== false, created = a.action === "abonnement_prospect_cree", col = created ? 0x22C55E : ok ? 0x22D3EE : 0xEF4444;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sp.scale.setScalar(2.4); sp.position.copy(n.base); world.add(sp); pulses.push({ sp, from: n.base.clone(), to: core.base.clone(), t0: performance.now(), d: 1500 });
    if (created) { const rs = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: 0x22C55E, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); rs.position.copy(n.base); world.add(rs); shocks.push({ rs, t0: performance.now(), d: 1800 }); }
  }
  // caméra
  const apply = (tt = 0) => { const br = dyn && !sel ? 1 + .05 * Math.sin(tt * .35) : 1, ph = dyn && !sel ? .06 * Math.sin(tt * .22) : 0; const R = cam.r * br, PH = cam.phi + ph; const sp = Math.sin(PH); camera.position.set(cam.tx + R * sp * Math.sin(cam.theta), cam.ty + R * Math.cos(PH), cam.tz + R * sp * Math.cos(cam.theta)); camera.lookAt(cam.tx, cam.ty, cam.tz); };
  const view = {
    update, fx, nodes: () => nodes, state: () => ({ ...goal, auto, dyn, kind: "3d" }), get selected() { return sel; },
    zoom(f) { goal.r = clamp(goal.r * f, 8, 95); lastTouch = performance.now(); }, reset() { Object.assign(goal, HOME); sel = null; api.onSelect?.(null); update(); },
    setAuto(v) { auto = !!v; lastTouch = performance.now(); }, toggleAuto() { auto = !auto; lastTouch = performance.now(); return auto; },
    focus(id) { const n = byId.get(id); if (!n) return false; sel = id; goal.tx = n.base.x; goal.ty = n.base.y; goal.tz = n.base.z; goal.r = 15; lastTouch = performance.now(); update(); api.onSelect?.(id); return true; },
    speaking(v) { speaking = !!v; }, setDynamic(v) { dyn = !!v; return dyn; }, toggleDynamic() { dyn = !dyn; return dyn; }, isDynamic: () => dyn, resize,
  };
  function resize() { const b = host.getBoundingClientRect(); W = Math.max(200, b.width); H = Math.max(200, b.height); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); }
  // interactions
  const ptrs = new Map(); let down = null;
  const screenOf = (n) => { const v = n.grp.getWorldPosition(new THREE.Vector3()).project(camera); return { x: (v.x * .5 + .5) * W, y: (-v.y * .5 + .5) * H, z: v.z }; };
  function pick(px, py, rad = 26) { let best = null, bd = rad; for (const n of nodes) { const s = screenOf(n); if (s.z > 1) continue; const d = Math.hypot(s.x - px, s.y - py); if (d < bd) { best = n; bd = d; } } return best; }
  cvs.addEventListener("pointerdown", (e) => { cvs.setPointerCapture?.(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, btn: e.button }; cvs.style.cursor = "grabbing"; lastTouch = performance.now(); });
  cvs.addEventListener("pointermove", (e) => {
    const r = cvs.getBoundingClientRect(), p = ptrs.get(e.pointerId);
    if (!p) { const n = pick(e.clientX - r.left, e.clientY - r.top); hover = n; cvs.style.cursor = n ? "pointer" : "grab"; api.onHover?.(n ? { n, x: e.clientX - r.left, y: e.clientY - r.top } : null); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y; lastTouch = performance.now();
    if (ptrs.size === 1) { if (down) down.moved += Math.abs(dx) + Math.abs(dy);
      if (e.buttons & 2 || e.shiftKey) { const k = goal.r * .0016, sx = Math.cos(cam.theta), sz = -Math.sin(cam.theta); goal.tx -= (dx * sx) * k; goal.tz -= (dx * sz) * k; goal.ty += dy * k; }
      else { goal.theta -= dx * .006; goal.phi = clamp(goal.phi - dy * .006, .15, Math.PI - .15); } }
    else if (ptrs.size === 2) { const o = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1], d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y); if (d0 > 5) goal.r = clamp(goal.r * (d0 / d1), 8, 95); if (down) down.moved += 99; }
    p.x = e.clientX; p.y = e.clientY;
  });
  const up = (e) => { const wasDown = down; ptrs.delete(e.pointerId); cvs.style.cursor = "grab";
    if (wasDown && ptrs.size === 0 && wasDown.moved < 6 && performance.now() - wasDown.t < 400 && wasDown.btn === 0) { const r = cvs.getBoundingClientRect(), n = pick(e.clientX - r.left, e.clientY - r.top); if (n && n.id !== sel) view.focus(n.id); else if (!n || n.id === sel) { sel = null; api.onSelect?.(null); update(); } }
    if (ptrs.size === 0) down = null; };
  cvs.addEventListener("pointerup", up); cvs.addEventListener("pointercancel", up); cvs.addEventListener("pointerleave", () => { hover = null; api.onHover?.(null); });
  cvs.addEventListener("wheel", (e) => { e.preventDefault(); goal.r = clamp(goal.r * Math.exp(e.deltaY * .0012), 8, 95); lastTouch = performance.now(); }, { passive: false });
  cvs.addEventListener("dblclick", () => view.reset()); cvs.addEventListener("contextmenu", (e) => e.preventDefault());
  // rendu
  const tmp = new THREE.Vector3(); let last = performance.now(), frame = 0;
  function loop(now) {
    if (!running) return; requestAnimationFrame(loop); if (document.hidden) return; const dt = Math.min(.1, (now - last) / 1000); last = now; frame++; const t = (now - t0) / 1000;
    if (auto && now - lastTouch > 6000 && !sel) goal.theta += dt * .09;
    if (dyn) { spin += dt; for (const n of nodes) { if (n.lvl === 1) continue; n.ang += (OMEGA[n.lvl] ?? .05) * dt; const c = Math.cos(n.ang), sn = Math.sin(n.ang); n.base.set(n.home.x * c + n.home.z * sn, n.home.y, -n.home.x * sn + n.home.z * c); n.grp.position.x = n.base.x; n.grp.position.z = n.base.z; }
      if (sel) { const m = byId.get(sel); if (m) { goal.tx = m.base.x; goal.ty = m.base.y; goal.tz = m.base.z; } }
      if (edgeBase) { const a = edgeBase.geometry.attributes.position.array; edgeNodes.forEach((n, i) => { const m = n.parent.base, b = n.base; a.set([m.x, m.y, m.z, b.x, b.y, b.z], i * 6); }); edgeBase.geometry.attributes.position.needsUpdate = true; }
      if (edgeOn && actNodes.length) { const at = edgeOn.geometry.attributes.position; if (at && at.array.length === actNodes.length * 6) { actNodes.forEach((n, i) => { const m = n.parent.base, b = n.base; at.array.set([m.x, m.y, m.z, b.x, b.y, b.z], i * 6); }); at.needsUpdate = true; } } }
    const k = 1 - Math.pow(.0016, dt); for (const f of ["theta", "phi", "r", "tx", "ty", "tz"]) cam[f] += (goal[f] - cam[f]) * k; apply(t);
    stars.rotation.y += dt * .004;
    for (const n of nodes) {
      const run = n.st === "run", wait = n.st === "wait", bad = n.st === "bad", off = n.st === "off", c = api.STATES[n.st][1];
      let sc = n.s * .6 * (run ? 1 + .14 * Math.sin(t * 5 + n.ph) : wait ? 1 + .06 * Math.sin(t * 2 + n.ph) : 1); if (n.lvl === 1 && speaking) sc *= 1 + .25 * Math.abs(Math.sin(t * 9));
      n.core.scale.setScalar(sc); n.core.material.color.set(off ? "#334155" : n.col); n.halo.material.color.set(off ? "#334155" : c); n.halo.material.opacity = off ? .25 : bad ? (Math.sin(t * 9) > 0 ? .95 : .35) : n.st === "idle" || n.st === "queue" ? .5 : .95; n.halo.scale.setScalar(n.s * (run ? 3.9 : 3.2) * (n.lvl === 1 && speaking ? 1.35 : 1));
      n.ring.material.opacity = run ? .85 : n.lvl === 1 && speaking ? .9 : 0; if (run || (n.lvl === 1 && speaking)) { n.ring.rotation.z += dt * 2.2; n.ring.rotation.x = Math.PI / 2 + Math.sin(t + n.ph) * .5; }
      n.grp.position.y = n.base.y + Math.sin(t * .8 + n.ph) * .25;
      if (n.id === sel) n.core.scale.setScalar(sc * 1.35);
    }
    if (flowPts) { const a = flowPts.geometry.attributes.position; flows.forEach((f, i) => { const p = (t * (dyn ? .8 : .5) + f.ph) % 1, s = f.n.parent.base, e = f.n.base; a.setXYZ(i, s.x + (e.x - s.x) * p, s.y + (e.y - s.y) * p + .0, s.z + (e.z - s.z) * p); }); a.needsUpdate = true; }
    const nowMs = performance.now();
    pulses = pulses.filter((p) => { const k = (nowMs - p.t0) / p.d; if (k >= 1) { world.remove(p.sp); p.sp.material.dispose(); return false; } const e = k * k * (3 - 2 * k); p.sp.position.lerpVectors(p.from, p.to, e); p.sp.scale.setScalar(2.4 * (1 - k * .5)); return true; });
    shocks = shocks.filter((s) => { const k = (nowMs - s.t0) / s.d; if (k >= 1) { world.remove(s.rs); s.rs.material.dispose(); return false; } s.rs.scale.setScalar(2 + k * 16); s.rs.material.opacity = 1 - k; return true; });
    renderer.render(scene, camera);
  }
  resize(); apply(); requestAnimationFrame(loop);
  view.dispose = () => { running = false; renderer.dispose(); cvs.remove(); };
  view.screenOf = (id) => { const n = byId.get(id); return n ? screenOf(n) : null; };
  view.debug = () => ({ cam: { ...cam }, goal: { ...goal }, nodes: nodes.length, sel, frame, auto, dyn, spin });
  return view;
}
