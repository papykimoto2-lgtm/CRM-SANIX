// SANIX AI VIRTUAL COMPANY — mobilier du bureau virtuel (Three.js). Chaque meuble est une géométrie fusionnée en couleurs de sommet :
// un seul appel de dessin par meuble, partagée par toutes ses instances. Dimensions en unités de scène (1 u ≈ 0,85 m).
export const SEAT_Y = 0.5;          // hauteur d'assise des chaises, canapés (le bassin des avatars assis y repose)
export const DESK_Y = 0.88;         // plan de travail
export const CHAIR_DZ = 0.95;       // distance centre de bureau → centre de chaise

export function createKit(T, { lambert = false } = {}) {   // lambert : éclairage par sommet (qualités réduite / éco), beaucoup moins coûteux que PBR
  const { RoundedBoxGeometry: RB, BufferGeometryUtils: BG } = T;
  const furn = lambert ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.06 });
  const col = new T.Color();
  const paint = (g, hex) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); col.set(hex); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute("color", new T.BufferAttribute(a, 3)); return g.index ? g.toNonIndexed() : g; };
  const place = (g, x, y, z, ry = 0, rx = 0) => { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };
  // budget de triangles : boîte simple pour les petites pièces, arrondi à 1 segment (108 triangles) pour les grandes
  const box = (w, h, d, hex, x, y, z, r = 0.02, ry = 0) => paint(place(Math.min(w, h, d) < 0.09 ? new T.BoxGeometry(w, h, d) : new RB(w, h, d, 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), x, y, z, ry), hex);
  const cyl = (rt, rb, h, hex, x, y, z, seg = 12) => paint(place(new T.CylinderGeometry(rt, rb, h, seg), x, y, z), hex);
  const ball = (r, hex, x, y, z, sx = 1, sy = 1, sz = 1) => { const g = new T.SphereGeometry(r, 8, 6); g.scale(sx, sy, sz); return paint(place(g, x, y, z), hex); };
  const merge = (list) => BG.mergeGeometries(list, false);
  const mesh = (geo, shadow = true) => { const m = new T.Mesh(geo, furn); m.castShadow = shadow; m.receiveShadow = true; return m; };
  const G = {}, once = (k, f) => (G[k] ??= f());

  const WOOD = "#d9b78f", WOOD_D = "#5f4230", WHITE = "#f3f6f9", NAVY = "#12263b", BLUE = "#087db8", FABRIC = "#1f3a57", METAL = "#9aa7b4", BLACK = "#161c26", LEATHER = "#2b1f17", SOFA = "#587491";

  const geo = {
    desk: () => merge([box(1.9, 0.06, 0.95, WOOD, 0, 0.85, 0, 0.018), box(0.05, 0.82, 0.88, WHITE, -0.88, 0.41, 0, 0.012), box(0.05, 0.82, 0.88, WHITE, 0.88, 0.41, 0, 0.012),
      box(1.74, 0.46, 0.03, WHITE, 0, 0.55, -0.4, 0.01), box(0.52, 0.6, 0.8, WHITE, 0.58, 0.33, 0.02, 0.014), box(0.46, 0.035, 0.012, METAL, 0.58, 0.5, 0.43, 0.004),
      box(0.46, 0.035, 0.012, METAL, 0.58, 0.28, 0.43, 0.004), cyl(0.026, 0.03, 0.22, METAL, 0, 0.99, -0.3), box(0.3, 0.014, 0.2, METAL, 0, 0.885, -0.3, 0.006),
      box(0.74, 0.46, 0.04, BLACK, 0, 1.22, -0.33, 0.014), box(0.46, 0.016, 0.16, "#e8ecf1", 0, 0.888, 0.14, 0.006), box(0.07, 0.022, 0.11, "#e8ecf1", 0.34, 0.89, 0.15, 0.01),
      cyl(0.034, 0.03, 0.08, "#ffffff", -0.7, 0.92, 0.12), box(0.04, 0.05, 0.022, BLUE, -0.76, 0.92, 0.12, 0.004)]),
    chair: () => merge([box(0.62, 0.09, 0.6, FABRIC, 0, SEAT_Y - 0.045, 0, 0.04), box(0.58, 0.6, 0.07, FABRIC, 0, 0.88, 0.29, 0.03), box(0.05, 0.1, 0.05, METAL, 0, 0.78, 0.26),
      cyl(0.035, 0.035, 0.34, METAL, 0, 0.27, 0), ...[0, 1, 2, 3, 4].flatMap((i) => { const a = (i / 5) * Math.PI * 2; return [box(0.38, 0.035, 0.05, METAL, Math.sin(a) * 0.19, 0.075, Math.cos(a) * 0.19, 0.012, a + Math.PI / 2), box(0.07, 0.07, 0.07, BLACK, Math.sin(a) * 0.36, 0.045, Math.cos(a) * 0.36)]; }),
      box(0.05, 0.03, 0.34, BLACK, -0.33, 0.7, 0.02, 0.012), box(0.05, 0.03, 0.34, BLACK, 0.33, 0.7, 0.02, 0.012), box(0.03, 0.18, 0.03, METAL, -0.33, 0.6, 0.04), box(0.03, 0.18, 0.03, METAL, 0.33, 0.6, 0.04)]),
    execDesk: () => merge([box(3.7, 0.09, 1.5, WOOD_D, 0, 0.85, 0, 0.03), box(0.12, 0.8, 1.38, WOOD_D, -1.7, 0.4, 0, 0.02), box(0.12, 0.8, 1.38, WOOD_D, 1.7, 0.4, 0, 0.02), box(3.3, 0.6, 0.05, "#4a3324", 0, 0.5, -0.62, 0.012),
      box(0.8, 0.7, 1.2, "#4f3828", -1.3, 0.4, 0, 0.02), box(0.5, 0.012, 0.012, "#d4a64a", -1.3, 0.55, 0.62, 0.004),
      cyl(0.03, 0.035, 0.28, METAL, -0.45, 1.0, -0.45), box(0.5, 0.02, 0.3, METAL, -0.45, 0.91, -0.45, 0.008), box(0.98, 0.56, 0.045, BLACK, -0.45, 1.34, -0.5, 0.016),
      cyl(0.03, 0.035, 0.28, METAL, 0.55, 1.0, -0.45), box(0.5, 0.02, 0.3, METAL, 0.55, 0.91, -0.45, 0.008), box(0.98, 0.56, 0.045, BLACK, 0.55, 1.34, -0.5, 0.016),
      box(0.6, 0.018, 0.2, "#e8ecf1", 0.05, 0.91, 0.2, 0.006), box(0.34, 0.07, 0.1, "#caa14a", 1.0, 0.94, 0.4, 0.012), box(0.5, 0.012, 0.35, "#f3f1ea", -0.8, 0.9, 0.3, 0.004)]),
    execChair: () => merge([box(0.8, 0.12, 0.76, LEATHER, 0, SEAT_Y - 0.06, 0, 0.05), box(0.76, 1.0, 0.12, LEATHER, 0, 1.0, 0.36, 0.05), box(0.4, 0.22, 0.1, LEATHER, 0, 1.58, 0.36, 0.04), box(0.08, 0.1, 0.05, METAL, 0, 0.7, 0.3),
      cyl(0.04, 0.04, 0.34, METAL, 0, 0.27, 0), ...[0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * Math.PI * 2; return box(0.46, 0.04, 0.06, METAL, Math.sin(a) * 0.23, 0.075, Math.cos(a) * 0.23, 0.015, a + Math.PI / 2); }),
      box(0.07, 0.04, 0.42, LEATHER, -0.43, 0.78, 0.02, 0.015), box(0.07, 0.04, 0.42, LEATHER, 0.43, 0.78, 0.02, 0.015)]),
    meetChair: () => merge([box(0.6, 0.08, 0.58, "#e9edf2", 0, SEAT_Y - 0.04, 0, 0.04), box(0.56, 0.5, 0.06, "#e9edf2", 0, 0.82, 0.28, 0.03), cyl(0.03, 0.03, 0.4, METAL, 0, 0.27, 0), cyl(0.27, 0.27, 0.03, METAL, 0, 0.03, 0, 20)]),
    meetTable: () => merge([cyl(2.95, 2.95, 0.09, WOOD, 0, 0.84, 0, 36), cyl(2.97, 2.97, 0.03, WHITE, 0, 0.78, 0, 36), cyl(0.45, 0.6, 0.78, WHITE, 0, 0.39, 0, 16), cyl(1.0, 1.1, 0.04, METAL, 0, 0.02, 0, 20)]),
    sofa: () => merge([box(3.4, 0.4, 1.15, SOFA, 0, 0.24, 0, 0.1), box(3.4, 0.7, 0.3, SOFA, 0, 0.7, 0.45, 0.1), box(0.3, 0.62, 1.15, SOFA, -1.55, 0.4, 0, 0.1), box(0.3, 0.62, 1.15, SOFA, 1.55, 0.4, 0, 0.1),
      box(1.38, 0.13, 0.95, "#6784a2", -0.7, 0.5, 0.0, 0.05), box(1.38, 0.13, 0.95, "#6784a2", 0.7, 0.5, 0.0, 0.05), box(0.5, 0.4, 0.12, "#e8b04a", -1.05, 0.78, 0.3, 0.05, 0.2)]),
    coffeeTable: () => merge([cyl(0.9, 0.9, 0.06, WOOD, 0, 0.42, 0, 28), cyl(0.07, 0.09, 0.4, METAL, 0, 0.2, 0), cyl(0.5, 0.55, 0.03, METAL, 0, 0.02, 0, 20), cyl(0.12, 0.1, 0.12, "#ffffff", 0.2, 0.51, 0.1), cyl(0.1, 0.1, 0.06, "#e8b04a", -0.25, 0.48, -0.1)]),
    plant: () => merge([cyl(0.3, 0.22, 0.5, "#e7e3dc", 0, 0.25, 0), cyl(0.27, 0.27, 0.03, "#4a3a2c", 0, 0.5, 0), ...Array.from({ length: 9 }, (_, i) => ball(0.13, ["#2f7d4f", "#3a9460", "#256b43"][i % 3], Math.sin(i * 2.4) * 0.26, 0.9 + (i % 3) * 0.22, Math.cos(i * 2.4) * 0.22, 0.7, 2.1, 0.6)), cyl(0.02, 0.025, 0.5, "#4f6b3a", 0, 0.75, 0, 6)]),
    bookshelf: () => merge([box(3.2, 3.0, 0.5, WOOD_D, 0, 1.5, 0, 0.02), ...[0.75, 1.5, 2.25].map((y) => box(3.1, 0.04, 0.46, "#8a6a4c", 0, y, 0.03, 0.01)),
      ...Array.from({ length: 28 }, (_, i) => { const r = Math.floor(i / 9), c = i % 9; return box(0.26, 0.5 + (i % 3) * 0.08, 0.3, ["#1f4e79", "#a23b3b", "#2f7d4f", "#c9a24a", "#4a3f7a", "#d8d8d0"][(i * 7) % 6], -1.35 + c * 0.33, 0.35 + r * 0.75 + (0.25 + (i % 3) * 0.04), 0.05, 0.01); })]),
    rack: () => merge([box(1.4, 3.1, 1.15, "#1a2433", 0, 1.55, 0, 0.03), box(1.28, 2.9, 0.04, "#0d141e", 0, 1.55, 0.58, 0.01), ...Array.from({ length: 12 }, (_, i) => box(1.22, 0.1, 0.05, "#26354a", 0, 0.3 + i * 0.23, 0.6, 0.01))]),
    counter: () => merge([box(2.2, 1.0, 0.7, WHITE, 0, 0.5, 0, 0.03), box(2.3, 0.05, 0.78, "#3a4a5c", 0, 1.02, 0, 0.02), box(0.5, 0.45, 0.4, BLACK, -0.6, 1.27, 0, 0.04), box(0.3, 0.06, 0.12, "#f59e0b", -0.6, 1.4, 0.18, 0.01), cyl(0.05, 0.05, 0.1, "#ffffff", 0.3, 1.1, 0.1)]),
    stool: () => merge([cyl(0.28, 0.28, 0.08, FABRIC, 0, 0.78, 0, 18), cyl(0.04, 0.04, 0.75, METAL, 0, 0.38, 0), cyl(0.28, 0.28, 0.03, METAL, 0, 0.02, 0)]),
    cabinet: () => merge([box(1.6, 0.9, 0.55, WHITE, 0, 0.45, 0, 0.02), box(1.64, 0.04, 0.58, WOOD, 0, 0.92, 0, 0.01), ...[-0.4, 0.4].map((x) => box(0.7, 0.8, 0.02, "#e3e8ee", x, 0.45, 0.28, 0.006))]),
  };
  const make = (k, shadow = true) => mesh(once(k, geo[k]), shadow);

  // écran individuel : émission pilotée par l'état de l'agent
  const screenGeo = new T.PlaneGeometry(0.67, 0.39);
  const screens = (hex) => (lambert ? new T.MeshLambertMaterial({ color: 0x0b1220, emissive: new T.Color(hex), emissiveIntensity: 0.9 }) : new T.MeshStandardMaterial({ color: 0x0b1220, emissive: new T.Color(hex), emissiveIntensity: 0.9, roughness: 0.35 }));

  /** Poste de travail complet : bureau fusionné + écran(s) animables + documents. Origine = centre du plan de travail, assis côté +Z. */
  function workstation() {
    const g = new T.Group(), body = make("desk"); g.add(body);
    const mat = screens("#22c55e"), mk = (x, ry, y) => { const s = new T.Mesh(screenGeo, mat); s.position.set(x, y, -0.308); s.rotation.y = ry; return s; };
    const main = mk(0, 0, 1.22); g.add(main);
    const side = (x, ry) => { const grp = new T.Group(); grp.position.set(x, 0, 0); grp.rotation.y = ry; const p = new T.Mesh(once("sideMon", () => paint(new RB(0.74, 0.46, 0.04, 2, 0.014), BLACK)), furn); p.position.set(0, 1.22, -0.33); p.castShadow = true;
      const stand = new T.Mesh(once("sideStand", () => merge([cyl(0.026, 0.03, 0.22, METAL, 0, 0.99, -0.3), box(0.3, 0.014, 0.2, METAL, 0, 0.885, -0.3, 0.006)])), furn); const s = new T.Mesh(screenGeo, mat); s.position.set(0, 1.22, -0.308); grp.add(p, stand, s); grp.visible = false; return grp; };
    const mon2 = side(-0.78, 0.5), mon3 = side(0.78, -0.5); g.add(mon2, mon3);
    const docs = new T.Mesh(once("docs", () => merge([box(0.3, 0.025, 0.22, "#f4f6f8", 0, 0.915, 0, 0.004, 0.2), box(0.28, 0.02, 0.2, "#e5eaf0", 0.01, 0.9, 0.01, 0.004, -0.1)])), furn); docs.position.set(0.62, 0, 0.18); docs.visible = false; g.add(docs);
    return { group: g, mat, mon2, mon3, docs };
  }
  const chair = (swivel = 0) => { const c = make("chair"); c.rotation.y = swivel; return c; };
  const place2 = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; return m; };
  const matte = lambert ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  /** Boîte colorée (sommets) pour fusion : murs et cloisons du bâtiment. */
  const bx = (w, h, d, hex, x, y, z) => paint(place(new T.BoxGeometry(w, h, d), x, y, z), hex);
  return { T, furn, matte, make, workstation, chair, place: place2, screens, screenGeo, bx, mergeGeos: merge, SEAT_Y, DESK_Y };
}
