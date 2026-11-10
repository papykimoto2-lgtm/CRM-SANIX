// Test des avatars humains réalistes (module 13, personnages) : les quatre personnages RÉELS du bureau, chargés par les mêmes modules que l'application
// (assets.js, retarget.js, avatar_glb.js, avatar_props.js) dans le laboratoire company/tests/lab, sous la CSP réelle du site (vercel.json).
// Contrôle : chargement et textures, absence d'erreur console, clips recalés, poses crédibles, pieds au sol, regard, niveaux de détail, accessoires,
// état suspendu, budgets de rendu. Écrit aussi les captures de validation (company/tests/out/avatars_*.png).
const path = require("path");
const { launch, ok, OUT } = require("./harness.js");

(async () => {
  const { server, browser } = await launch(4180);
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 700 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`${m.type()}: ${m.text().slice(0, 240)}`); });
    page.on("requestfailed", (r) => errors.push("requête échouée : " + r.url()));
    const failed404 = [];
    page.on("response", (r) => { if (r.status() >= 400) failed404.push(`${r.status()} ${r.url()}`); });

    console.log("▶ Chargement des quatre personnages");
    await page.goto(`http://127.0.0.1:${server.address().port}/company/tests/lab/avatar_lab.html`);
    await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 120000 });
    const info0 = await page.evaluate(() => ({ variants: window.__lab.row.map((a) => a.variant).sort(), textures: window.__lab.stats().textures, models: [...window.__lab.assets.models.keys()] }));
    ok(JSON.stringify(info0.variants) === JSON.stringify(["femme_a", "femme_b", "homme_a", "homme_b"]), "les quatre morphologies sont affichées (femme_a, femme_b, homme_a, homme_b)");
    ok(info0.textures >= 40, `textures PBR chargées sur le GPU (${info0.textures})`);
    ok(errors.length === 0, `aucune erreur console ni violation de politique de sécurité au chargement (${errors.length}) ${errors.slice(0, 2).join(" | ")}`);
    ok(failed404.length === 0, `toutes les ressources sont servies (${failed404.length} réponse(s) en erreur) ${failed404.slice(0, 2).join(" | ")}`);

    console.log("▶ Squelettes et animations");
    const rig = await page.evaluate(() => {
      const L = window.__lab, out = {};
      for (const [v, clips] of L.assets.clipsOf) {
        const names = [...clips.keys()], src = [...L.assets.clips.keys()];
        let bad = 0;
        for (const c of clips.values()) for (const t of c.tracks) for (const x of t.values) if (!Number.isFinite(x)) bad++;
        out[v] = { clips: names.length, missing: src.filter((n) => !clips.has(n)), bad, ratio: L.assets.report.get(v).hipsRatio, bones: L.assets.report.get(v).bones };
      }
      return out;
    });
    for (const [v, r] of Object.entries(rig)) ok(r.clips === 27 && r.missing.length === 0 && r.bad === 0 && r.bones === 22 && r.ratio > 0.9 && r.ratio < 1.4, `${v} : 27 clips recalés sur 22 os, valeurs finies, bassin ×${r.ratio.toFixed(2)}`);

    console.log("▶ Poses (mesurées sur le squelette animé)");
    const measure = (anim, posture) => page.evaluate(([a, p]) => {
      const L = window.__lab; L.setPose(a, p); L.settle(1.6);
      return L.row.map((av) => {
        av.model.updateWorldMatrix(true, true);
        const s = av.body.scale.x, T = av.model.getObjectByName("Head").constructor, v = new (Object.getPrototypeOf(av.root.position).constructor)();
        const y = (n) => av.model.getObjectByName(n).getWorldPosition(v).y / s;
        const pos = (n) => av.model.getObjectByName(n).getWorldPosition(v.clone()).multiplyScalar(1 / s);
        const hips = pos("Hips"), head = pos("Head"), lh = pos("LeftHand"), rh = pos("RightHand"), lf = pos("LeftToe_End"), rf = pos("RightToe_End");
        const fw = av.model.getObjectByName("Head").getWorldDirection(v.clone());
        return { variant: av.variant, hipsY: hips.y, headY: head.y, lhY: lh.y, rhY: rh.y, toeY: Math.min(lf.y, rf.y), handsForward: Math.min(-(lh.z - hips.z), -(rh.z - hips.z)), lhx: lh.x, rhx: rh.x, bad: ![hips, head, lh, rh].every((p) => [p.x, p.y, p.z].every(Number.isFinite)) };
      });
    }, [anim, posture]);
    const idle = await measure("idle", "stand");
    for (const r of idle) ok(!r.bad && r.headY > 1.45 && r.headY < 1.7 && r.toeY > -0.03 && r.toeY < 0.09, `${r.variant} debout : tête à ${r.headY.toFixed(2)} m, pointe des pieds à ${r.toeY.toFixed(3)} m du sol`);
    const sit = await measure("typing", "seat");
    for (const r of sit) ok(!r.bad && r.hipsY < idle.find((i) => i.variant === r.variant).hipsY - 0.25 && r.lhY < r.headY - 0.35 && r.rhY < r.headY - 0.35 && r.handsForward > 0.12, `${r.variant} assis, frappe : bassin abaissé à ${r.hipsY.toFixed(2)} m, mains devant le buste sous la tête`);
    const cele = await measure("celebrate", "stand");
    for (const r of cele) ok(!r.bad && r.lhY > r.headY && r.rhY > r.headY, `${r.variant} célèbre : les deux mains au-dessus de la tête`);
    ok(true, "regard : les personnages font face à -Z (convention du bureau)");
    const facing = await page.evaluate(() => { const L = window.__lab; L.setPose("idle", "stand"); L.settle(0.6); return L.row.map((av) => { const h = av.model.getObjectByName("LeftEye").getWorldPosition(av.root.position.clone()), c = av.model.getObjectByName("Head").getWorldPosition(av.root.position.clone()); return { v: av.variant, dz: (h.z - c.z) }; }); });
    for (const f of facing) ok(f.dz < 0, `${f.v} : yeux en avant de la tête vers -Z (${f.dz.toFixed(3)})`);

    console.log("▶ Niveaux de détail, accessoires, état suspendu");
    const lod = await page.evaluate(() => {
      const L = window.__lab, T = L.row[0].root.constructor; const res = {};
      for (const detail of ["full", "lite"]) { L.setPose("idle", "stand", detail); L.settle(0.3); L.camera("full"); res[detail] = L.stats(); }
      L.setPose("idle", "stand", "full"); L.settle(0.3); L.render();
      return res;
    });
    ok(lod.lite.triangles < lod.full.triangles * 0.55, `niveau 1 nettement plus léger : ${lod.lite.triangles} contre ${lod.full.triangles} triangles (4 personnages, ombres comprises)`);
    ok(lod.full.calls / 4 <= 40, `appels de dessin par personnage (niveau 0, ombres comprises) : ${(lod.full.calls / 4).toFixed(0)} ≤ 40`);
    const props = await page.evaluate(() => {
      const L = window.__lab, res = [];
      for (const [anim, posture, prop, bone] of [["headset", "seat", "Prop_Phone", "RightHand"], ["documents", "seat", "Prop_Doc", "LeftHand"], ["relax", "seat", "Prop_Cup", "RightHand"], ["handover", "stand", "Prop_Folder", "RightHand"]]) {
        L.setPose(anim, posture); L.settle(1.2);
        for (const av of L.row) { const o = av.carried.props[prop], b = av.model.getObjectByName(bone); const d = o.getWorldPosition(av.root.position.clone()).distanceTo(b.getWorldPosition(av.root.position.clone())) / av.body.scale.x; res.push({ v: av.variant, prop, visible: o.visible, d }); }
      }
      return res;
    });
    ok(props.every((p) => p.visible && p.d < 0.2), `accessoires visibles et tenus à moins de 20 cm de la main (${props.length} contrôles)`);
    const muted = await page.evaluate(() => {
      const L = window.__lab; L.setPose("idle", "stand"); const a = L.row[0], b = L.row[1];
      const color = (av) => { let c = null; av.model.traverse((o) => { if (!c && o.isMesh && o.name !== "" && o.material?.map) c = [].concat(o.material)[0].color.getHex(); }); return c; };
      const before = color(b); a.setMuted(true); const after = color(b), mutedColor = color(a); a.setMuted(false);
      return { before, after, mutedDark: mutedColor !== 0xffffff, restored: color(a) === 0xffffff };
    });
    ok(muted.before === muted.after && muted.mutedDark && muted.restored, "suspendu : seul ce collaborateur s'assombrit (matières partagées intactes), puis retrouve ses couleurs");

    console.log("▶ Captures de validation");
    const shot = async (name, anim, posture, cam, detail = "full") => {
      await page.evaluate(([a, p, c, d]) => { const L = window.__lab; L.setPose(a, p, d); L.settle(1.7); const m = /^f(\d)(\w+)$/.exec(c); if (m) L.focus(+m[1], m[2]); else L.camera(c); }, [anim, posture, cam, detail]);
      await page.screenshot({ path: path.join(OUT, `avatars_${name}.png`) });
    };
    await shot("quatre_de_face", "idle", "stand", "full");
    for (let i = 0; i < 4; i++) await shot(`visage_${i}`, "idle", "stand", `f${i}face`);
    await shot("travail_poste", "typing", "seat", "f2sit");
    await shot("travail_documents", "documents", "seat", "f2sit34");
    await shot("reunion", "meeting", "seat", "f1sit34L");
    await shot("orateur", "speak", "seat", "f2sit34");
    await shot("marche", "walk", "stand", "full");
    ok(true, "captures écrites dans company/tests/out/avatars_*.png");
    ok(errors.length === 0, `aucune erreur console pendant tout le test (${errors.length}) ${errors.slice(0, 2).join(" | ")}`);
    console.log("\nAVATARS : TOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error("\n" + e.message); process.exit(1); });
