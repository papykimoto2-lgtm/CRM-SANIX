"""SANIX AI VIRTUAL COMPANY — générateur de personnages (Blender 4.2+ / 5.x en mode headless : `pip install bpy`).

Un personnage = un maillage lisse unique (modificateur Skin + Subdivision), habillé par zones de matériaux teintables à
l'exécution (peau, haut, bas, chaussures, cheveux, yeux…), un squelette humanoïde (noms de os identiques à Mixamo, sans
préfixe) et des clips d'animation (animations.py).

Convention Blender : le personnage regarde vers -Y, sa gauche est à +X, Z vers le haut. Après export glTF il regarde vers +Z.
"""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

# ───────────────────────── matériaux ─────────────────────────
SLOTS = ["skin", "top", "bottom", "shoes", "hair", "eye", "dark", "shirt", "accent"]   # emplacements teintables à l'exécution
SLOT = {n: i for i, n in enumerate(SLOTS)}
DEFAULT = dict(skin="#9a6b4b", top="#163b61", bottom="#1b2638", shoes="#161b24", hair="#1c1713", eye="#f4f6f8", dark="#161616", shirt="#f1f5f9", accent="#087db8")

def srgb(h):
    """#RRGGBB → linéaire (Blender attend du linéaire pour Base Color)."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

def material(name, hexcolor, rough=0.62):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hexcolor), 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    # Réponse de matière plus crédible : peau légèrement diffusante, textile mat.
    sub = b.inputs.get("Subsurface Weight")
    if sub: sub.default_value = 0.075 if name.endswith("_skin") else 0.0
    sheen = b.inputs.get("Sheen Weight")
    if sheen and any(k in name for k in ("_top", "_bottom", "_shirt")): sheen.default_value = 0.16
    coat = b.inputs.get("Coat Weight")
    if coat and name.endswith("_skin"): coat.default_value = 0.08
    return m

# ───────────────────────── morphologie (taille 1,76 m normalisée puis mise à l'échelle) ─────────────────────────
BUILDS = {
    "homme_a": dict(h=1.76, sh=0.225, chest=(0.178, 0.108), waist=(0.118, 0.090), hip=(0.098, 0.092, 0.100), neck=0.046, head=(0.088, 0.104, 0.118), arm=(0.050, 0.041, 0.031), leg=(0.100, 0.072, 0.046)),
    "homme_b": dict(h=1.76, sh=0.228, chest=(0.186, 0.118), waist=(0.150, 0.108), hip=(0.100, 0.096, 0.104), neck=0.050, head=(0.090, 0.106, 0.119), arm=(0.054, 0.044, 0.033), leg=(0.104, 0.074, 0.048)),
    "femme_a": dict(h=1.76, sh=0.198, chest=(0.152, 0.100), waist=(0.098, 0.082), hip=(0.096, 0.092, 0.104), neck=0.039, head=(0.082, 0.097, 0.110), arm=(0.042, 0.034, 0.026), leg=(0.092, 0.062, 0.040)),
    "femme_b": dict(h=1.76, sh=0.206, chest=(0.158, 0.104), waist=(0.104, 0.086), hip=(0.098, 0.094, 0.106), neck=0.041, head=(0.084, 0.099, 0.112), arm=(0.044, 0.036, 0.027), leg=(0.094, 0.064, 0.042)),
}
A_POSE = math.radians(32)                                   # abduction des bras au repos (A-pose : moins de déformation aux épaules)
ARM_DIR = Vector((math.sin(A_POSE), 0.0, -math.cos(A_POSE)))
TORSO = {"pelvis", "waist", "chest", "uchest", "nbase", "neck"}
DECIMATE = 0.92                                              # conserve les volumes anatomiques et les transitions de vêtements
TR, LR = 1.30, 1.20                                         # compensation du rétrécissement du Skin + Subdivision (tronc / membres)

def graph(b):
    """Graphe du modificateur Skin : sommets (nom, position, rayons) et leurs parents."""
    s = b["h"] / 1.76
    P = lambda x, y, z: Vector((x * s, y * s, z * s))
    cw, cd = b["chest"]; ww, wd = b["waist"]; hx, hz, hr = b["hip"]; a0, a1, a2 = b["arm"]; l1, l2 = b["leg"][1], b["leg"][2]
    V = []
    def add(n, p, r, par=None, k=None):
        k = k or (TR if n in TORSO else LR)
        V.append(dict(n=n, p=p, r=(r[0] * s * k, r[1] * s * k), par=par))
    add("pelvis", P(0, 0, 0.95), (hr + 0.062, 0.100)); add("waist", P(0, 0, 1.08), (ww, wd), "pelvis")
    add("chest", P(0, 0, 1.25), (cw, cd), "waist"); add("uchest", P(0, 0.003, 1.38), (cw + 0.006, cd - 0.006), "chest")
    add("nbase", P(0, 0.012, 1.485), (b["neck"] + 0.026, b["neck"] + 0.022), "uchest"); add("neck", P(0, 0.016, 1.56), (b["neck"], b["neck"] + 0.002), "nbase")
    for side, sx in (("L", 1), ("R", -1)):
        d = Vector((ARM_DIR.x * sx, ARM_DIR.y, ARM_DIR.z))
        sh = P(sx * b["sh"], 0.0, 1.425); e = sh + d * (0.30 * s); w = e + d * (0.265 * s); h = w + d * (0.085 * s)
        add("sh" + side, sh, (a0, a0), "uchest", LR); add("el" + side, e, (a1, a1), "sh" + side, LR)
        add("wr" + side, w, (a2, a2), "el" + side, LR); add("ha" + side, h, (a2 * 1.2, a2 * 0.95), "wr" + side, LR)
        add("hip" + side, P(sx * hx, 0.004, 0.935), (hr, hr + 0.004), "pelvis"); add("kn" + side, P(sx * (hx + 0.002), -0.012, 0.50), (l1, l1), "hip" + side)
        add("an" + side, P(sx * (hx + 0.004), 0.004, 0.105), (l2, l2 + 0.003), "kn" + side); add("to" + side, P(sx * (hx + 0.004), -0.165, 0.052), (l2 + 0.004, l2 - 0.004), "an" + side)
    return V

def build_skin(b):
    G = graph(b)
    me = bpy.data.meshes.new("Skin"); ob = bpy.data.objects.new("Skin", me); bpy.context.collection.objects.link(ob)
    idx = {g["n"]: i for i, g in enumerate(G)}
    me.from_pydata([tuple(g["p"]) for g in G], [(idx[g["par"]], i) for i, g in enumerate(G) if g["par"]], [])
    bpy.context.view_layer.objects.active = ob
    sk = ob.modifiers.new("Skin", "SKIN"); sk.use_smooth_shade = True; sk.branch_smoothing = 0.85
    for i, g in enumerate(G): me.skin_vertices[0].data[i].radius = g["r"]
    me.skin_vertices[0].data[0].use_root = True
    ss = ob.modifiers.new("Sub", "SUBSURF"); ss.levels = 2; ss.render_levels = 2
    dc = ob.modifiers.new("Dec", "DECIMATE"); dc.decimate_type = "COLLAPSE"; dc.ratio = DECIMATE; dc.use_symmetry = True; dc.symmetry_axis = "X"; dc.use_collapse_triangulate = True
    final = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return final, G

def bisect_planes(bm, planes):
    """Coupe le maillage selon des plans (point, normale) : les frontières de zones deviennent des lignes nettes."""
    for co, no in planes:
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=1e-5, plane_co=co, plane_no=no)

# ───────────────────────── primitives (bmesh) ─────────────────────────
def _tag(bm, verts, rigid):
    lay = bm.verts.layers.int["rigid"]
    for v in verts:
        if v.is_valid: v[lay] = rigid

def ellipsoid(bm, center, radii, slot, seg=(18, 12), rigid=0, post=None):
    verts = bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)["verts"]
    for v in verts: v.co = Vector((v.co.x * radii[0] + center[0], v.co.y * radii[1] + center[1], v.co.z * radii[2] + center[2]))
    if post: post(verts)
    for f in {f for v in verts for f in v.link_faces}: f.material_index = SLOT[slot]; f.smooth = True
    _tag(bm, verts, rigid); return verts

def box(bm, center, size, slot, rigid=0):
    verts = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    for v in verts: v.co = Vector((v.co.x * size[0] + center[0], v.co.y * size[1] + center[1], v.co.z * size[2] + center[2]))
    for f in {f for v in verts for f in v.link_faces}: f.material_index = SLOT[slot]
    _tag(bm, verts, rigid); return verts

def ring(bm, center, r_in, r_out, depth, slot, rigid=0, n=22):
    """Anneau plat (monture de lunettes) dans le plan XZ, épaisseur selon Y."""
    cx, cy, cz = center; V = []
    for k in range(n):
        a = 2 * math.pi * k / n; ca, sa = math.cos(a), math.sin(a)
        V.append([bm.verts.new((cx + ca * r, cy + dy, cz + sa * r)) for r in (r_in, r_out) for dy in (-depth / 2, depth / 2)])
    for k in range(n):
        a, b = V[k], V[(k + 1) % n]
        for (i, j) in ((0, 1), (1, 3), (3, 2), (2, 0)):
            f = bm.faces.new((a[i], a[j], b[j], b[i])); f.material_index = SLOT[slot]
    verts = [v for q in V for v in q]; _tag(bm, verts, rigid); return verts

def strip_on_body(bm, bvh, x0, z_top, z_bot, w_top, w_bot, rows, off, slot, rigid, cols=3):
    """Bande à largeur variable plaquée sur la surface du torse (rayons vers -Y) : cravate, plastron, badge."""
    grid = []
    for r in range(rows + 1):
        t = r / rows; z = z_top + (z_bot - z_top) * t; w = w_top + (w_bot - w_top) * t; row = []
        for c in range(cols + 1):
            x = x0 + (c / cols - 0.5) * w
            hit = bvh.ray_cast(Vector((x, -0.60, z)), Vector((0, 1, 0)), 1.2)
            y = (hit[0].y - off) if hit and hit[0] is not None else -0.12
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    verts = [v for r in grid for v in r]
    for r in range(rows):
        for c in range(cols):
            f = bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c])); f.material_index = SLOT[slot]; f.smooth = True
    _tag(bm, verts, rigid); return verts

# ───────────────────────── tête, visage, cheveux ─────────────────────────
def front_y(c, r, x, z):
    q = 1 - (x / r[0]) ** 2 - ((z - c.z) / r[2]) ** 2
    return c.y - r[1] * math.sqrt(max(q, 0.0))

def add_head(bm, b, spec):
    s = b["h"] / 1.76; r = tuple(v * s for v in b["head"]); c = Vector((0.0, 0.012 * s, (1.56 + 0.088) * s))
    HEAD = 1
    def egg(verts):                                           # mâchoire plus étroite, menton avancé
        for v in verts:
            t = (v.co.z - c.z) / r[2]
            if t < 0:
                k = -t; v.co.x = c.x + (v.co.x - c.x) * (1 - 0.20 * k ** 1.3); v.co.y = c.y + (v.co.y - c.y) * (1 - 0.06 * k) - 0.010 * k * s
            else: v.co.y += 0.006 * t * s
    ellipsoid(bm, c, r, "skin", seg=(22, 14), rigid=HEAD, post=egg)
    ex = 0.037 * s
    for sx in (1, -1):
        x, z = sx * ex, c.z + 0.024 * s; yf = front_y(c, r, x, z)
        ellipsoid(bm, (x, yf + 0.003 * s, z), (0.0158 * s, 0.0095 * s, 0.0142 * s), "eye", (10, 6), HEAD)                               # globe
        ellipsoid(bm, (x + sx * 0.001 * s, yf - 0.0035 * s, z), (0.0088 * s, 0.0052 * s, 0.0088 * s), "dark", (16, 10), HEAD)             # iris
        ellipsoid(bm, (x + sx * 0.001 * s, yf - 0.0075 * s, z), (0.0038 * s, 0.0026 * s, 0.0045 * s), "dark", (12, 8), HEAD)          # pupille
        ellipsoid(bm, (x, yf - 0.009 * s, z + 0.003 * s), (0.0020 * s, 0.0015 * s, 0.0020 * s), "eye", (8, 6), HEAD)                 # reflet
        ellipsoid(bm, (sx * (r[0] + 0.002 * s), c.y + 0.012 * s, c.z - 0.004 * s), (0.010 * s, 0.021 * s, 0.032 * s), "skin", (8, 6), HEAD)  # oreille
        box(bm, (x, front_y(c, r, x, c.z + 0.056 * s) - 0.001 * s, c.z + 0.056 * s), (0.032 * s, 0.008 * s, 0.0065 * s), "hair", HEAD)  # sourcil
    ellipsoid(bm, (0, front_y(c, r, 0, c.z - 0.012 * s) - 0.006 * s, c.z - 0.012 * s), (0.0125 * s, 0.015 * s, 0.021 * s), "skin", (18, 12), HEAD)   # nez
    for sx in (-1, 1):
        ellipsoid(bm, (sx * 0.006 * s, front_y(c, r, sx * 0.006 * s, c.z - 0.030 * s) - 0.010 * s, c.z - 0.030 * s), (0.0028 * s, 0.0020 * s, 0.0018 * s), "dark", (8, 6), HEAD) # narines
    ellipsoid(bm, (0, front_y(c, r, 0, c.z - 0.066 * s) + 0.001 * s, c.z - 0.066 * s), (0.024 * s, 0.0055 * s, 0.0065 * s), "dark", (10, 6), HEAD)  # bouche
    hair = spec.get("hair", "short")
    if hair != "bald":
        hs = (r[0] * 1.075, r[1] * 1.085, r[2] * 1.05)
        hv = ellipsoid(bm, c + Vector((0, 0.010 * s, 0.014 * s)), hs, "hair", (22, 12), HEAD)
        def line(v):          # ligne des cheveux : haute devant (front dégagé), basse derrière (nuque) et sur les tempes
            front = (c.y - v.co.y) / hs[1]                       # +1 devant, -1 derrière
            return c.z + (0.080 * front + 0.000) * s - 0.040 * s * (1 if abs(v.co.x) > r[0] * 0.82 else 0) + 0.012 * s
        kill = list({f for v in hv if v.co.z < line(v) for f in v.link_faces if f.is_valid})
        bmesh.ops.delete(bm, geom=kill, context="FACES_ONLY")
        bmesh.ops.delete(bm, geom=[v for v in hv if v.is_valid and not v.link_faces], context="VERTS")
        if hair in ("long", "bob"):
            drop = 0.20 * s if hair == "long" else 0.085 * s
            ellipsoid(bm, (0, c.y + r[1] * 0.78, c.z - drop * 0.55), (r[0] * 1.02, 0.050 * s, drop + 0.07 * s), "hair", (14, 9), HEAD)
            for sx in (1, -1): ellipsoid(bm, (sx * r[0] * 0.96, c.y + 0.012 * s, c.z - drop * 0.42), (0.024 * s, 0.075 * s, drop * 0.95 + 0.030 * s), "hair", (8, 6), HEAD)
        if hair == "bun": ellipsoid(bm, (0, c.y + r[1] * 0.70, c.z + r[2] * 0.82), (0.056 * s, 0.056 * s, 0.050 * s), "hair", (12, 8), HEAD)
        if hair == "afro": ellipsoid(bm, c + Vector((0, 0.020 * s, 0.040 * s)), (r[0] * 1.38, r[1] * 1.32, r[2] * 1.22), "hair", (18, 12), HEAD)
    if spec.get("beard"): ellipsoid(bm, (0, c.y - r[1] * 0.60, c.z - r[2] * 0.62), (r[0] * 0.80, 0.050 * s, 0.050 * s), "hair", (12, 7), HEAD)
    if spec.get("glasses"):
        for sx in (1, -1):
            gx, gz = sx * ex, c.z + 0.024 * s; ring(bm, (gx, front_y(c, r, gx, gz) - 0.004 * s, gz), 0.0245 * s, 0.0285 * s, 0.004 * s, "dark", HEAD)
        box(bm, (0, front_y(c, r, 0, c.z + 0.028 * s) - 0.006 * s, c.z + 0.030 * s), (0.026 * s, 0.004 * s, 0.004 * s), "dark", HEAD)
    return c, r

# ───────────────────────── squelette ─────────────────────────
def bone_defs(b, G):
    s = b["h"] / 1.76; g = {v["n"]: v["p"] for v in G}
    P = lambda x, y, z: Vector((x * s, y * s, z * s))
    B = [("Hips", None, P(0, 0, 0.95), P(0, 0, 1.03)), ("Spine", "Hips", P(0, 0, 1.03), P(0, 0, 1.15)), ("Spine1", "Spine", P(0, 0, 1.15), P(0, 0, 1.28)),
         ("Spine2", "Spine1", P(0, 0, 1.28), P(0, 0, 1.41)), ("Neck", "Spine2", P(0, 0.012, 1.47), P(0, 0.016, 1.56)), ("Head", "Neck", P(0, 0.016, 1.56), P(0, 0.016, 1.78))]
    for side, sx in (("Left", 1), ("Right", -1)):
        k = "L" if sx > 0 else "R"
        B += [(side + "Shoulder", "Spine2", P(sx * 0.03, 0.0, 1.415), g["sh" + k]), (side + "Arm", side + "Shoulder", g["sh" + k], g["el" + k]),
              (side + "ForeArm", side + "Arm", g["el" + k], g["wr" + k]), (side + "Hand", side + "ForeArm", g["wr" + k], g["ha" + k]),
              (side + "UpLeg", "Hips", g["hip" + k], g["kn" + k]), (side + "Leg", side + "UpLeg", g["kn" + k], g["an" + k]),
              (side + "Foot", side + "Leg", g["an" + k], P(sx * (b["hip"][0] + 0.004), -0.10, 0.050)), (side + "ToeBase", side + "Foot", P(sx * (b["hip"][0] + 0.004), -0.10, 0.050), P(sx * (b["hip"][0] + 0.004), -0.19, 0.045))]
    return B

def build_armature(b, G):
    arm = bpy.data.armatures.new("Armature"); ob = bpy.data.objects.new("Armature", arm); bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True); bpy.ops.object.mode_set(mode="EDIT")
    for name, par, head, tail in bone_defs(b, G):
        e = arm.edit_bones.new(name); e.head = head; e.tail = tail
        if par: e.parent = arm.edit_bones[par]
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob

# ───────────────────────── poids de peau ─────────────────────────
def seg_dist(p, a, c):
    ab = c - a; t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-9))); return (p - (a + ab * t)).length, t

def compute_weights(me, G, defs, rigid_attr, b):
    """Poids par distance aux os, limités au groupe du membre (tronc / bras / jambe) : aucune contamination gauche-droite."""
    s = b["h"] / 1.76; bone = {n: (h, t) for n, _, h, t in defs}
    edges = [(g["n"], G[[x["n"] for x in G].index(g["par"])]["p"], g["p"], g["r"]) for g in G if g["par"]]
    group_of = lambda n: ("armL" if n in ("shL", "elL", "wrL", "haL") else "armR" if n in ("shR", "elR", "wrR", "haR") else
                          "legL" if n in ("hipL", "knL", "anL", "toL") else "legR" if n in ("hipR", "knR", "anR", "toR") else "trunk")
    BONES = {"trunk": ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"],
             "armL": ["Spine2", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"], "armR": ["Spine2", "RightShoulder", "RightArm", "RightForeArm", "RightHand"],
             "legL": ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase"], "legR": ["Hips", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]}
    out = []
    for i, v in enumerate(me.vertices):
        p = v.co.copy()
        if rigid_attr[i] == 1: out.append({"Head": 1.0}); continue
        best, grp = 1e9, "trunk"
        for n, a, c, r in edges:
            d, _ = seg_dist(p, a, c); sc = d / (max(r) + 0.02 * s)
            if sc < best: best, grp = sc, group_of(n)
        names = BONES[grp]; w = {}
        for nm in names:
            d, _ = seg_dist(p, *bone[nm]); w[nm] = 1.0 / (d + 0.016 * s) ** 3
        tot = sum(w.values()); w = {k: x / tot for k, x in w.items() if x / tot > 0.02}
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]; tot = sum(x for _, x in top); out.append({k: x / tot for k, x in top})
    return out

# ───────────────────────── personnage complet ─────────────────────────
def build_character(spec):
    """spec : build, outfit (suit | shirt | blouse), sleeve (0-1), hem, hair, beard, glasses, belt, tie, badge, colors (dict teintes d'aperçu)."""
    colors = {**DEFAULT, **spec.get("colors", {})}
    for n in SLOTS: material(f"{spec['name']}_{n}", colors[n], 0.72 if n in ("skin", "hair") else 0.58)
    b = BUILDS[spec["build"]]; s = b["h"] / 1.76
    skin_me, G = build_skin(b)
    bm = bmesh.new(); bm.from_mesh(skin_me); bpy.data.meshes.remove(skin_me)
    bm.verts.layers.int.new("rigid")
    # découpes nettes : cou, taille, chevilles, manche
    hem = spec.get("hem", 0.955) * s; cut = spec.get("sleeve", 1.0) * 0.565 * s
    planes = [(Vector((0, 0, 1.50 * s)), Vector((0, 0, 1))), (Vector((0, 0, hem)), Vector((0, 0, 1))), (Vector((0, 0, hem - 0.012 * s)), Vector((0, 0, 1))), (Vector((0, 0, hem + 0.020 * s)), Vector((0, 0, 1))),
              (Vector((0, 0, 0.108 * s)), Vector((0, 0, 1)))]
    for sx in (1, -1):
        d = Vector((ARM_DIR.x * sx, ARM_DIR.y, ARM_DIR.z)); sh = Vector((sx * b["sh"] * s, 0, 1.425 * s)); planes.append((sh + d * cut, d))
    bisect_planes(bm, planes)
    d_l = Vector((ARM_DIR.x, ARM_DIR.y, ARM_DIR.z)); d_r = Vector((-ARM_DIR.x, ARM_DIR.y, ARM_DIR.z))
    sh_l = Vector((b["sh"] * s, 0, 1.425 * s)); sh_r = Vector((-b["sh"] * s, 0, 1.425 * s)); belt = spec.get("belt", True)
    for f in bm.faces:
        c = f.calc_center_median(); z = c.z
        if z < 0.108 * s: m = "shoes"
        elif z > 1.50 * s: m = "skin"
        else:
            arm = abs(c.x) > (b["sh"] - 0.035) * s and z < 1.46 * s and (abs(c.x) > (b["chest"][0] * TR + 0.02) * s or z > 1.30 * s)
            if arm:
                dd, sh = (d_l, sh_l) if c.x > 0 else (d_r, sh_r); m = "top" if (c - sh).dot(dd) < cut else "skin"
            elif z > hem: m = "top"
            elif belt and z > hem - 0.012 * s: m = "shoes"
            else: m = "bottom"
        f.material_index = SLOT[m]; f.smooth = True
    bvh = BVHTree.FromBMesh(bm)
    # collier, plastron de chemise, cravate, badge
    outfit = spec.get("outfit", "suit"); TORS = 2
    if outfit in ("suit", "shirt", "blouse"):
        ellipsoid(bm, (0, 0.012 * s, 1.497 * s), (0.056 * s * (b["neck"] / 0.045), 0.060 * s, 0.020 * s), "shirt", (16, 6), TORS)
    if outfit == "suit":
        strip_on_body(bm, bvh, 0.0, 1.49 * s, 1.17 * s, 0.150 * s, 0.020 * s, 12, 0.004 * s, "shirt", TORS, cols=5)
        # Revers de veste et poche poitrine : détails de confection visibles en plan rapproché.
        for side in (-1, 1):
            strip_on_body(bm, bvh, side * 0.043 * s, 1.475 * s, 1.335 * s, 0.046 * s, 0.014 * s, 7, 0.008 * s, "dark", TORS, cols=2)
            strip_on_body(bm, bvh, side * 0.122 * s, 1.315 * s, 1.285 * s, 0.038 * s, 0.038 * s, 2, 0.006 * s, "shirt", TORS, cols=2)
        for zbtn in (1.13, 1.19, 1.25):
            ellipsoid(bm, (0.018 * s, -0.125 * s, zbtn * s), (0.004 * s, 0.0025 * s, 0.004 * s), "dark", (8, 6), TORS)
    if spec.get("tie", outfit == "suit"):
        strip_on_body(bm, bvh, 0.0, 1.485 * s, 1.20 * s, 0.040 * s, 0.062 * s, 8, 0.0085 * s, "accent", TORS, cols=2)
        ellipsoid(bm, (0, bvh.ray_cast(Vector((0, -0.60, 1.480 * s)), Vector((0, 1, 0)), 1.2)[0].y - 0.010 * s, 1.480 * s), (0.026 * s, 0.014 * s, 0.022 * s), "accent", (10, 6), TORS)
    if spec.get("badge", True):
        strip_on_body(bm, bvh, 0.085 * s, 1.30 * s, 1.215 * s, 0.056 * s, 0.056 * s, 2, 0.008 * s, "accent", TORS, cols=2)
        strip_on_body(bm, bvh, 0.085 * s, 1.285 * s, 1.240 * s, 0.040 * s, 0.040 * s, 1, 0.0105 * s, "shirt", TORS, cols=1)
    add_head(bm, b, spec)
    me = bpy.data.meshes.new(spec["name"] + "_mesh"); bm.to_mesh(me); rigid = [a.value for a in me.attributes["rigid"].data] if "rigid" in me.attributes else [0] * len(me.vertices); bm.free()
    # un seul matériau (1 appel de dessin par personnage) : l'emplacement de chaque face est inscrit dans la couleur de sommet (rouge = indice / 8),
    # le moteur d'exécution y lit la teinte propre à chaque collaborateur (peau, haut, bas, cheveux, accent…)
    ca = me.color_attributes.new("Slot", "FLOAT_COLOR", "CORNER")
    for p in me.polygons:
        for li in p.loop_indices: ca.data[li].color = (p.material_index / 8.0, 0.0, 0.0, 1.0)
        p.material_index = 0
    me.color_attributes.active_color = ca
    body_mat = material(f"{spec['name']}_body", "#ffffff", 0.62); me.materials.append(body_mat)
    ob = bpy.data.objects.new(spec["name"], me); bpy.context.collection.objects.link(ob)
    arm = build_armature(b, G)
    defs = bone_defs(b, G); W = compute_weights(me, G, defs, rigid, b)
    for _, _, _, _ in defs: pass
    for name, _, _, _ in defs: ob.vertex_groups.new(name=name)
    for i, w in enumerate(W):
        for k, x in w.items(): ob.vertex_groups[k].add([i], x, "REPLACE")
    me.update(); ob.parent = arm; m = ob.modifiers.new("Armature", "ARMATURE"); m.object = arm
    return ob, arm, b, G


# ───────────────────────── accessoires tenus en main / portés (masqués par défaut à l'exécution) ─────────────────────────
def _prop(name, bm, mats, arm, bone):
    """Objet enfant d'un os : sa position de repos est conservée, il suit ensuite l'os (main, tête)."""
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(bpy.data.materials[m])
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    ob.parent = arm; ob.parent_type = "BONE"; ob.parent_bone = bone
    bone_ = arm.data.bones[bone]       # Blender place l'origine d'un enfant d'os à la QUEUE de l'os : on compense pour garder la position de repos
    ob.matrix_parent_inverse = (arm.matrix_world @ bone_.matrix_local @ Matrix.Translation((0, bone_.length, 0))).inverted()
    return ob

def _oriented_box(bm, center, long_axis, thin_axis, size, slot=0):
    """Boîte dont l'axe long suit `long_axis` et l'axe fin `thin_axis` ; size = (épaisseur, largeur, longueur)."""
    z = long_axis.normalized(); x = thin_axis.normalized(); y = z.cross(x).normalized(); x = y.cross(z).normalized()
    M = Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))
    for v in bmesh.ops.create_cube(bm, size=1.0)["verts"]: v.co = M @ Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + center
    for f in bm.faces: f.material_index = slot

def add_props(arm, b, G, name):
    """Casque (Head), téléphone / tasse / chemise cartonnée (RightHand), document (LeftHand) : mêmes matériaux que le personnage."""
    s = b["h"] / 1.76; g = {v["n"]: v["p"] for v in G}
    mat = lambda n: f"{name}_{n}"
    scr = bpy.data.materials.get("prop_screen") or bpy.data.materials.new("prop_screen")
    scr.use_nodes = True; bsdf = scr.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.02, 0.06, 0.08, 1); bsdf.inputs["Emission Color"].default_value = (0.15, 0.85, 0.45, 1); bsdf.inputs["Emission Strength"].default_value = 1.4
    def hand(side):
        sx = 1 if side == "L" else -1; d = Vector((ARM_DIR.x * sx, ARM_DIR.y, ARM_DIR.z))
        return (g["wr" + side] + g["ha" + side]) / 2 + d * 0.02 * s, d, Vector((-sx, 0, 0))      # centre, direction des doigts, normale de paume (vers le corps)
    c, d, n = hand("R")
    bm = bmesh.new(); _oriented_box(bm, c + d * 0.01 * s, d, n, (0.012 * s, 0.068 * s, 0.140 * s), 0)
    _oriented_box(bm, c + d * 0.01 * s + n * 0.0066 * s, d, n, (0.0016 * s, 0.058 * s, 0.124 * s), 1)
    _prop("Prop_Phone", bm, [mat("dark"), "prop_screen"], arm, "RightHand")
    bm = bmesh.new()
    for v in bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.034 * s, radius2=0.030 * s, depth=0.085 * s)["verts"]: v.co += c
    for f in bm.faces: f.material_index = 0
    _prop("Prop_Cup", bm, [mat("shirt")], arm, "RightHand")
    bm = bmesh.new(); _oriented_box(bm, c + d * 0.09 * s, d, n, (0.012 * s, 0.230 * s, 0.320 * s), 0)
    _prop("Prop_Folder", bm, [mat("accent")], arm, "RightHand")
    c, d, n = hand("L")
    bm = bmesh.new(); _oriented_box(bm, c + d * 0.07 * s, d, n, (0.003 * s, 0.210 * s, 0.297 * s), 0)
    _prop("Prop_Doc", bm, [mat("shirt")], arm, "LeftHand")
    # casque audio : arceau, deux oreillettes, micro
    bm = bmesh.new(); hc = Vector((0.0, 0.012 * s, (1.56 + 0.088) * s)); hr = tuple(v * s for v in b["head"]); segs = 20; prev = None
    for k in range(segs + 1):
        a = math.pi * k / segs; x = math.cos(a) * (hr[0] + 0.010 * s); z = math.sin(a) * (hr[2] + 0.012 * s)
        ring = [bm.verts.new((x, hc.y + dy, hc.z + z + dz)) for (dy, dz) in ((-0.006 * s, 0), (0.006 * s, 0), (0.006 * s, 0.012 * s), (-0.006 * s, 0.012 * s))]
        if prev:
            for i in range(4): bm.faces.new((prev[i], prev[(i + 1) % 4], ring[(i + 1) % 4], ring[i]))
        prev = ring
    for sx in (1, -1):
        for v in bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)["verts"]:
            v.co = Vector((v.co.x * 0.016 * s + sx * (hr[0] + 0.016 * s), v.co.y * 0.034 * s + hc.y + 0.012 * s, v.co.z * 0.036 * s + hc.z - 0.004 * s))
    for v in bmesh.ops.create_cube(bm, size=1.0)["verts"]: v.co = Vector((v.co.x * 0.004 * s + 0.060 * s, v.co.y * 0.090 * s + hc.y - 0.050 * s, v.co.z * 0.004 * s + hc.z - 0.040 * s))
    for f in bm.faces: f.material_index = 0
    _prop("Prop_Headset", bm, [mat("dark")], arm, "Head")
