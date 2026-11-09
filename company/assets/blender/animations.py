"""Clips d'animation (30 i/s) écrits en rotations « monde » relatives au parent, dans la pose de repos (A-pose).

Axes (personnage tourné vers -Y, sa gauche à +X) :
  rotation +X sur un os dirigé vers le bas  → pointe vers l'ARRIÈRE (négatif = vers l'avant : cuisse levée, bras en avant)
  rotation +X sur un os dirigé vers le haut → pointe vers l'AVANT   (inclinaison du buste / hochement de tête vers l'avant)
  rotation +Y sur le bras gauche            → rapproche le bras du corps (abduction : négatif) ; l'inverse à droite
  rotation Z                                → rotation horizontale (tête, buste)
Les clips sont composés d'un socle de jambes (debout / assis) et d'un mouvement du haut du corps.
"""
import math
import bpy
from mathutils import Euler, Quaternion, Vector

FPS = 30
def R(x=0.0, y=0.0, z=0.0):
    return Euler((math.radians(x), math.radians(y), math.radians(z)), "XYZ").to_quaternion()
ID = R()
sin, cos, pi = math.sin, math.cos, math.pi

def both(pose, base, x=0.0, y=0.0, z=0.0, left=None, right=None):
    """Applique une rotation symétrique (miroir : y et z changent de signe) à Left<base> et Right<base>."""
    pose["Left" + base] = left if left is not None else R(x, y, z)
    pose["Right" + base] = right if right is not None else R(x, -y, -z)

# ───────────────────────── socles de jambes ─────────────────────────
def stand(pose, s):
    pass

def sit(pose, s, back=0.0, drop=0.435):
    """Assis : bassin abaissé, cuisses à l'horizontale, tibias verticaux, pieds à plat."""
    pose["Hips.loc"] = Vector((0, 0.06 * s - back * s, -drop * s))
    both(pose, "UpLeg", -88, 5)           # cuisses en avant, genoux légèrement écartés
    both(pose, "Leg", 88, -4)             # tibias à la verticale
    both(pose, "Foot", 0, 0)
    pose["Spine"] = R(3); pose["Spine1"] = R(2)

# ───────────────────────── mouvements du haut du corps ─────────────────────────
def breath(pose, t, T=3.2, a=1.0):
    ph = 2 * pi * t / T
    pose["Spine2"] = pose.get("Spine2", ID) @ R(a * 1.2 * sin(ph))
    pose["Head"] = pose.get("Head", ID) @ R(0.6 * sin(ph + 1.0), 0, 0)

def arms_rest(pose, t, sitting):
    both(pose, "Arm", 0, 9 if not sitting else 14)
    both(pose, "ForeArm", -12 if not sitting else -48)
    both(pose, "Hand", -4)
    if sitting:
        both(pose, "Arm", -24, 12)

def u_idle(pose, t, sitting, s):
    ph = 2 * pi * t / 4.0
    arms_rest(pose, t, sitting); breath(pose, t, 4.0)
    pose["Head"] = R(1.5 * sin(ph * 0.5), 0, 9 * sin(ph * 0.5 + 0.4)); pose["Neck"] = R(0, 0, 3 * sin(ph * 0.5 + 0.4))
    if not sitting:
        pose["Hips"] = R(0, 0, 1.6 * sin(ph * 0.5)); pose["Hips.loc"] = Vector((0.012 * s * sin(ph * 0.5), 0, 0))
        both(pose, "UpLeg", 0, 1.5 + 1.2 * sin(ph * 0.5)); both(pose, "Leg", 1.0)

def _kb(pose, t, s, rate, amp, sitting=True):
    """Bras vers le clavier."""
    both(pose, "Arm", -36, 22); both(pose, "ForeArm", -72, 0)
    pose["LeftHand"] = R(-8 + amp * sin(2 * pi * rate * t)); pose["RightHand"] = R(-8 + amp * sin(2 * pi * rate * t + 2.1))
    pose["LeftForeArm"] = R(-72 + 2.5 * sin(2 * pi * rate * t * 0.5)); pose["RightForeArm"] = R(-72 + 2.5 * sin(2 * pi * rate * t * 0.5 + 1.3))

def u_typing(pose, t, sitting, s):
    _kb(pose, t, s, 4.0, 5.0); breath(pose, t, 3.4, 0.5)
    pose["Spine1"] = pose.get("Spine1", ID) @ R(6); pose["Neck"] = R(8); pose["Head"] = R(6, 0, 4 * sin(2 * pi * t / 5.0))

def u_screen(pose, t, sitting, s):
    both(pose, "Arm", -34, 22, left=None); both(pose, "ForeArm", -70)
    pose["RightHand"] = R(-8 + 2.5 * sin(2 * pi * 0.9 * t)); pose["LeftHand"] = R(-8 + 3.0 * sin(2 * pi * 3.0 * t))
    pose["RightForeArm"] = R(-60 + 4 * sin(2 * pi * 0.45 * t)); breath(pose, t, 3.4, 0.5)
    pose["Spine1"] = pose.get("Spine1", ID) @ R(5); pose["Neck"] = R(6, 0, 3 * sin(2 * pi * t / 4.0)); pose["Head"] = R(5, 0, 8 * sin(2 * pi * t / 3.0))

def u_multiscreen(pose, t, sitting, s):
    _kb(pose, t, s, 2.6, 3.0)
    ph = 2 * pi * t / 3.2
    pose["Head"] = R(3, 0, 38 * sin(ph)); pose["Neck"] = R(4, 0, 14 * sin(ph)); pose["Spine2"] = R(0, 0, 6 * sin(ph)); pose["Spine1"] = R(4)

def u_documents(pose, t, sitting, s):
    both(pose, "Arm", 0, 0, left=R(-38, 14), right=R(-30, -22)); pose["LeftForeArm"] = R(-105); pose["RightForeArm"] = R(-70 + 3 * sin(2 * pi * 2.2 * t))
    pose["LeftHand"] = R(-30); pose["RightHand"] = R(-12 + 8 * sin(2 * pi * 2.2 * t)); breath(pose, t, 3.6, 0.5)
    pose["Spine1"] = R(8); pose["Neck"] = R(10); pose["Head"] = R(12, 0, 6 * sin(2 * pi * t / 4.5))

def u_headset(pose, t, sitting, s):
    ph = 2 * pi * t / 3.0
    pose["RightArm"] = R(-62, -18 + 3 * sin(ph)); pose["RightForeArm"] = R(-128 + 4 * sin(ph)); pose["RightHand"] = R(-10)
    pose["LeftArm"] = R(-26, 10); pose["LeftForeArm"] = R(-55); pose["LeftHand"] = R(-4)
    pose["Head"] = R(2 + 3 * sin(ph * 2), 0, -4 * sin(ph * 0.5)); pose["Neck"] = R(0, 0, 0, ) @ R(0, 5); breath(pose, t, 3.4, 0.6)

def u_terminal(pose, t, sitting, s):
    ph = 2 * pi * t
    both(pose, "Arm", -42, 28); both(pose, "ForeArm", -98); both(pose, "Hand", -28)
    pose["LeftHand"] = R(-28 + 3 * sin(ph * 2.3)); pose["RightHand"] = R(-28 + 3 * sin(ph * 2.3 + 1.5)); breath(pose, t, 3.4, 0.5)
    pose["Spine1"] = pose.get("Spine1", ID) @ R(4); pose["Neck"] = R(10); pose["Head"] = R(14, 0, 4 * sin(ph * 0.3))

def u_talk(pose, t, sitting, s):
    ph = 2 * pi * t
    both(pose, "Arm", 0, 0, left=R(-40 + 14 * sin(ph * 0.55), 18 + 6 * sin(ph * 0.4)), right=R(-48 + 16 * sin(ph * 0.45 + 1.2), -22 + 6 * sin(ph * 0.5)))
    pose["LeftForeArm"] = R(-62 + 22 * sin(ph * 0.55 + 0.7)); pose["RightForeArm"] = R(-70 + 24 * sin(ph * 0.45 + 2.0))
    pose["LeftHand"] = R(-8 + 10 * sin(ph * 0.8)); pose["RightHand"] = R(-8 + 10 * sin(ph * 0.7 + 1.0))
    pose["Head"] = R(2 * sin(ph * 0.8), 0, 12 * sin(ph * 0.3)); pose["Spine2"] = R(0, 0, 5 * sin(ph * 0.3 + 0.5)); breath(pose, t, 3.0, 0.6)

def u_present(pose, t, sitting, s):
    ph = 2 * pi * t / 3.5
    pose["RightArm"] = R(-72 + 8 * sin(ph), -34 + 4 * sin(ph * 0.5)); pose["RightForeArm"] = R(-20 + 10 * sin(ph * 1.3)); pose["RightHand"] = R(-6)
    pose["LeftArm"] = R(-30, 12); pose["LeftForeArm"] = R(-60 + 6 * sin(ph * 0.7)); pose["Head"] = R(0, 0, -14 * sin(ph * 0.5) + 6); pose["Spine2"] = R(0, 0, -6); breath(pose, t, 3.0, 0.5)

def u_meeting(pose, t, sitting, s):          # écoute : avant-bras sur la table, regard et hochements
    ph = 2 * pi * t / 4.0
    both(pose, "Arm", -30, 24); both(pose, "ForeArm", -78); both(pose, "Hand", -6)
    pose["Head"] = R(2 + 4 * max(0, sin(ph * 2.2)), 0, 5 * sin(ph * 0.5)); pose["Spine1"] = R(4); breath(pose, t, 3.6, 0.7)

def u_speak(pose, t, sitting, s):
    u_talk(pose, t, sitting, s)
    pose["LeftArm"] = pose["LeftArm"] @ R(8, 0); pose["RightArm"] = pose["RightArm"] @ R(8, 0); pose["Spine1"] = R(5)
    pose["Head"] = R(2 * sin(2 * pi * t * 1.1), 0, 8 * sin(2 * pi * t * 0.3))

def u_celebrate(pose, t, sitting, s):
    ph = 2 * pi * t / 1.2
    both(pose, "Arm", 0, 0, left=R(-30, -128 + 6 * sin(ph)), right=R(-30, 128 - 6 * sin(ph))); both(pose, "ForeArm", 0, 0, left=R(0, 0, 0) @ R(-14), right=R(-14)); both(pose, "Hand", -4)
    pose["Head"] = R(-8, 0, 7 * sin(ph * 0.5)); pose["Spine2"] = R(-4)
    if not sitting: pose["Hips.loc"] = Vector((0, 0, 0.025 * s * abs(sin(ph)))); both(pose, "UpLeg", 0, 3)

def u_alert(pose, t, sitting, s):
    ph = 2 * pi * t / 0.9
    pose["RightArm"] = R(-20, -150); pose["RightForeArm"] = R(-14 + 28 * sin(ph)); pose["RightHand"] = R(0, 0, 10 * sin(ph))
    pose["LeftArm"] = R(-18, 14); pose["LeftForeArm"] = R(-38)
    pose["Head"] = R(0, 0, 14 * sin(ph * 0.5)); pose["Neck"] = R(2); breath(pose, t, 2.0, 1.0)

def u_pause(pose, t, sitting, s):
    ph = 2 * pi * t / 5.0
    both(pose, "Arm", -8, 6); both(pose, "ForeArm", -18); both(pose, "Hand", 6)
    pose["Spine"] = R(10); pose["Spine1"] = R(12); pose["Spine2"] = R(8); pose["Neck"] = R(10); pose["Head"] = R(14, 0, 4 * sin(ph)); breath(pose, t, 5.0, 1.3)
    if sitting: both(pose, "Arm", -18, 10); both(pose, "ForeArm", -40)

def u_relax(pose, t, sitting, s):
    ph = 2 * pi * t / 6.0; k = max(0.0, min(1.0, (sin(ph - 0.6) + 0.35) / 1.1))      # gorgée périodique
    both(pose, "Arm", 0, 0, left=R(-14, 10), right=R(-30 - 30 * k, -14))
    pose["LeftForeArm"] = R(-40); pose["RightForeArm"] = R(-92 - 52 * k); pose["RightHand"] = R(-12 - 14 * k)
    pose["Head"] = R(-3 + 8 * k, 0, 10 * sin(ph * 0.5)); pose["Spine1"] = R(-3 if sitting else 0); breath(pose, t, 4.0, 0.8)

def u_watch(pose, t, sitting, s):            # debout, mains dans le dos, balaie les écrans du regard
    ph = 2 * pi * t / 4.2
    both(pose, "Arm", -16, 20); both(pose, "ForeArm", -66); both(pose, "Hand", -6)          # mains jointes devant
    pose["Head"] = R(0, 0, 42 * sin(ph)); pose["Neck"] = R(0, 0, 14 * sin(ph)); breath(pose, t, 4.0, 0.7)
    pose["Spine1"] = R(-2)

def u_handover(pose, t, sitting, s):
    ph = 2 * pi * t / 2.6
    pose["RightArm"] = R(-62, -14); pose["RightForeArm"] = R(-26 + 4 * sin(ph)); pose["RightHand"] = R(-4)
    pose["LeftArm"] = R(-26 + 8 * sin(ph * 1.4), 18); pose["LeftForeArm"] = R(-60 + 12 * sin(ph * 1.4 + 1.0))
    pose["Head"] = R(3 + 6 * max(0, sin(ph * 2)), 0, 12 * sin(ph * 0.5)); breath(pose, t, 3.0, 0.6)

MOTIONS = dict(idle=u_idle, screen=u_screen, multiscreen=u_multiscreen, documents=u_documents, typing=u_typing, terminal=u_terminal, headset=u_headset, talk=u_talk,
               present=u_present, meeting=u_meeting, speak=u_speak, celebrate=u_celebrate, alert=u_alert, pause=u_pause, relax=u_relax, watch=u_watch, handover=u_handover)
SEATED = ["idle", "screen", "multiscreen", "documents", "typing", "terminal", "headset", "talk", "present", "meeting", "speak", "celebrate", "alert", "pause", "relax"]
STANDING = ["idle", "talk", "watch", "handover", "celebrate", "alert", "pause", "relax", "present", "terminal", "headset"]
PERIOD = dict(idle=4.0, screen=6.0, multiscreen=3.2, documents=4.5, typing=5.0, terminal=3.0, headset=3.0, talk=6.0, present=3.5, meeting=4.0, speak=6.0, celebrate=1.2, alert=1.8, pause=5.0, relax=6.0, watch=4.2, handover=5.2)

def walk_pose(pose, t, s):
    ph = 2 * pi * t / 1.0
    A, K = 32, 56                                       # amplitude de cuisse, flexion maximale du genou (degrés) : ~2,0 u/s à 1 cycle/s
    for side, sg in (("Left", 1), ("Right", -1)):
        p = ph + (0 if sg > 0 else pi)
        thigh = -A * sin(p) + 3                         # négatif = jambe en avant
        knee = K * max(0.0, sin(p - 0.55)) + 5 + 7 * max(0.0, cos(p))
        pose[side + "UpLeg"] = R(thigh, 2 * sg)
        pose[side + "Leg"] = R(knee)
        pose[side + "Foot"] = R(-(thigh + knee) + 12 * sin(p + 1.2))          # semelle à plat, petit déroulé
        pose[side + "Arm"] = R(26 * sin(p), 9 * sg)    # le bras balance à l'opposé de la jambe du même côté
        pose[side + "ForeArm"] = R(-16 - 14 * max(0.0, -sin(p)))
        pose[side + "Hand"] = R(-4)
    pose["Hips.loc"] = Vector((-0.018 * s * cos(ph), 0, -0.010 * s * (1 - cos(2 * ph))))
    pose["Hips"] = R(0, 0, -5 * sin(ph)); pose["Spine"] = R(2, 0, 3 * sin(ph)); pose["Spine1"] = R(1, 0, 3 * sin(ph)); pose["Spine2"] = R(0, 0, 2 * sin(ph))
    pose["Head"] = R(0, 0, -2 * sin(ph)); pose["Neck"] = R(1)

def clip_pose(name, t, s):
    pose = {}
    if name == "Walk": walk_pose(pose, t, s); return pose
    kind, motion = name.split("_"); sitting = kind == "Sit"
    (sit if sitting else stand)(pose, s)
    MOTIONS[motion](pose, t, sitting, s)
    return pose

def clip_names():
    return ["Walk"] + [f"Sit_{m}" for m in SEATED] + [f"Stand_{m}" for m in STANDING]

def clip_period(name):
    return 1.0 if name == "Walk" else PERIOD[name.split("_")[1]]

# ───────────────────────── baking ─────────────────────────
def bake_all(arm, s, names=None):
    """Crée une Action par clip (1 cycle, boucle) en convertissant les rotations « monde » en rotations locales d'os."""
    arm.animation_data_create()
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode="POSE")
    rest = {pb.name: pb.bone.matrix_local.to_quaternion() for pb in arm.pose.bones}
    for pb in arm.pose.bones: pb.rotation_mode = "QUATERNION"
    for name in (names or clip_names()):
        act = bpy.data.actions.new(name); arm.animation_data.action = act
        T = clip_period(name); n = max(2, int(round(T * FPS)))
        for f in range(n + 1):
            t = (f % n) / FPS if f < n else 0.0           # la dernière image reprend la première : boucle parfaite
            pose = clip_pose(name, t, s)
            for pb in arm.pose.bones:
                q = pose.get(pb.name, ID); Q = rest[pb.name]
                pb.rotation_quaternion = Q.inverted() @ q @ Q
                loc = pose.get(pb.name + ".loc")
                pb.location = (Q.inverted() @ loc) if loc is not None else Vector((0, 0, 0))
                pb.keyframe_insert("rotation_quaternion", frame=f + 1)
                if pb.name == "Hips": pb.keyframe_insert("location", frame=f + 1)
        act.use_fake_user = True
        track = arm.animation_data.nla_tracks.new(); track.name = name; strip = track.strips.new(name, 1, act); strip.name = name
    arm.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")
