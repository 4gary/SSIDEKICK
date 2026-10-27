// Cute terracotta pot with a face-less leafy plant and a "STEVE" stake sign. Origin on the floor at the pot centre,
// front faces +z (the camera). Gary's use spot is beside the pot on its -x side, facing it (yaw PI/2, side-on).
// Stem segments, leaves, a bud and a flower are all built up front and scaled/revealed by st.grow.

import { clamp, lerp, smooth } from './common.js';

export function build(THREE, ctx) {
  const { mesh, group, canvasTex, sphere } = ctx;
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };

  const SOIL_Y = 0.31;                 // soil surface (pot cavity floor), prop units
  const STEM_MIN = 0.14, STEM_MAX = 0.95; // stem length above the soil at grow 0 and grow 1
  const SEG = 3;                       // stem segments

  const own = [];                      // geometries this module creates (shared ctx.sphere is not disposed)
  const geo = (g) => { own.push(g); return g; };
  const mats = [];
  const M = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };

  // ---------- pot ----------
  const potTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#c8643b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f6e3c0';
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc((i + 0.5) * w / 8, h * 0.5, 8, 0, Math.PI * 2); g.fill(); }
  });
  const potMat = M({ map: potTex, roughness: 0.8, side: THREE.DoubleSide });
  const potRimMat = M({ color: 0xa84f2c, roughness: 0.8 });
  const soilMat = M({ color: 0x7a4d2c, roughness: 0.95 });
  const soilDry = new THREE.Color(0x7a4d2c), soilWet = new THREE.Color(0x2e1a0c);
  const stemMat = M({ color: 0x3f9a4a, roughness: 0.6 });
  const leafMat = M({ color: 0x4cc35a, roughness: 0.55, side: THREE.DoubleSide });
  const leafMat2 = M({ color: 0x35ad4c, roughness: 0.55, side: THREE.DoubleSide });
  const budMat = M({ color: 0x7cd66a, roughness: 0.5 });
  const petalMat = M({ color: 0xff7eb6, roughness: 0.5 });
  const centerMat = M({ color: 0xffd23f, roughness: 0.5 });
  const woodMat = M({ color: 0xc08a52, roughness: 0.7 });

  const potPts = [[0, 0], [0.12, 0], [0.165, 0.035], [0.195, 0.13], [0.205, 0.24], [0.2, 0.3], [0.2, 0.35],
    [0.17, 0.35], [0.17, SOIL_Y], [0, SOIL_Y]].map(([x, y]) => new THREE.Vector2(x, y));
  const root = new THREE.Group();
  mesh(geo(new THREE.LatheGeometry(potPts, 40)), potMat, root);
  mesh(geo(new THREE.TorusGeometry(0.19, 0.022, 12, 40)), potRimMat, root, [0, 0.35, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  mesh(geo(new THREE.CircleGeometry(0.168, 32)), soilMat, root, [0, SOIL_Y + 0.002, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]);

  // ---------- "STEVE" stake sign (front-right of the pot, facing +z) ----------
  const signTex = canvasTex(256, 112, (g, w, h) => {
    g.fillStyle = '#f7e2b8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a5a33'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#4a2c18'; g.font = 'bold 56px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STEVE', w / 2, h / 2 + 3);
  });
  const signMat = M({ map: signTex, roughness: 0.7 });
  const stakeGeo = geo(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8));
  mesh(stakeGeo, woodMat, root, [0.2, 0.34, 0.07]);
  mesh(geo(new THREE.BoxGeometry(0.26, 0.11, 0.02)), [woodMat, woodMat, woodMat, woodMat, signMat, woodMat],
    root, [0.2, 0.5, 0.07], [1, 1, 1], [0, 0, -0.07]);

  // ---------- plant (sways around the soil) ----------
  const plant = group(root, [0, SOIL_Y, 0]);
  const stemGeo = geo(new THREE.CylinderGeometry(0.03, 0.04, 1, 12));
  stemGeo.translate(0, 0.5, 0);
  const segs = [];
  for (let i = 0; i < SEG; i++) {
    const sg = group(plant);
    const m = mesh(stemGeo, stemMat, sg);
    segs.push({ g: sg, m });
  }

  // Broad cartoon leaf: a leaf outline in the xy plane, base at the origin, tip at y = 1, extruded a little.
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(0.32, 0.12, 0.36, 0.5, 0, 1);
  leafShape.bezierCurveTo(-0.36, 0.5, -0.32, 0.12, 0, 0);
  const leafGeo = geo(new THREE.ExtrudeGeometry(leafShape, {
    depth: 0.02, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 16,
  }));
  // f: attach point as a fraction of the stem; a: azimuth around the stem; e: elevation above horizontal;
  // len: leaf length; t0: grow value where the leaf starts to unfurl (negative = already out at sprout).
  const LEAVES = [
    { f: 0.95, a: 0.5, e: 0.85, len: 0.30, t0: -0.3 },
    { f: 0.95, a: 3.6, e: 0.80, len: 0.28, t0: -0.3 },
    { f: 0.25, a: 1.4, e: 0.40, len: 0.34, t0: 0.55 },
    { f: 0.45, a: 2.2, e: 0.55, len: 0.40, t0: 0.10 },
    { f: 0.55, a: 5.2, e: 0.50, len: 0.42, t0: 0.22 },
    { f: 0.68, a: 0.9, e: 0.45, len: 0.40, t0: 0.34 },
    { f: 0.78, a: 3.9, e: 0.35, len: 0.38, t0: 0.46 },
  ];
  const leaves = LEAVES.map((L, k) => {
    const piv = group(plant);
    const m = mesh(leafGeo, k % 2 ? leafMat2 : leafMat, piv);
    return { piv, m, L, k };
  });

  const bud = mesh(sphere, budMat, plant, [0, STEM_MAX, 0], [0.03, 0.045, 0.03]);
  const flower = group(plant, [0, STEM_MAX + 0.05, 0.02]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    mesh(sphere, petalMat, flower, [Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0], [0.045, 0.065, 0.025], [0, 0, a - Math.PI / 2]);
  }
  mesh(sphere, centerMat, flower, [0, 0, 0.01], [0.04, 0.04, 0.03]);

  // ---------- state ----------
  let gS = null, wS = null;   // smoothed grow / wet (snap to the first value, then ease)

  return {
    root,
    spots: { use: { x: -0.55, y: 0, z: 0, yaw: Math.PI / 2, pose: 'stand' } },
    anchors: { pour: new THREE.Vector3(0, SOIL_Y + 0.25, 0) },
    update(dt, t, st) {
      const h = clamp(dt || 1 / 60, 0, 0.1);
      const tt = t || 0;
      const gT = clamp(st && typeof st.grow === 'number' ? st.grow : 0, 0, 1);
      const wT = clamp(st && typeof st.wet === 'number' ? st.wet : 0, 0, 1);
      if (gS === null) { gS = gT; wS = wT; }
      gS += (gT - gS) * (1 - Math.exp(-h * 4));
      wS += (wT - wS) * (1 - Math.exp(-h * 3));
      const g = gS, w = wS;

      // stem: total length S, a gentle lean that grows with the plant
      const S = lerp(STEM_MIN, STEM_MAX, g), L = S / SEG, th = lerp(0.8, 1.15, g);
      const bendX = (y) => g * 0.06 * (y / S) * (y / S);
      for (let i = 0; i < SEG; i++) {
        segs[i].g.position.set(bendX(i * L), i * L, 0);
        segs[i].m.scale.set(th, L * 1.04, th);
      }

      // leaves: unfurl by grow, perk up with wet, flutter a little
      for (const lf of leaves) {
        const Ld = lf.L;
        const y = Ld.f * S;
        const prog = clamp((g - Ld.t0) / 0.3, 0, 1);
        const sc = Math.max(0, easeOutBack(prog)) * (Ld.t0 < 0 ? lerp(0.85, 1, g) : 1);
        lf.piv.position.set(bendX(y), y, 0);
        lf.piv.rotation.y = Ld.a;
        const e = Ld.e + 0.25 * w;                      // wet: leaves rise toward the sky
        lf.m.rotation.x = Math.PI / 2 - e + Math.sin(tt * 1.6 + lf.k * 1.9) * 0.05;
        lf.m.scale.setScalar(Math.max(sc * Ld.len, 0.0001));
        lf.m.visible = sc > 0.01;
      }

      // bud (grows, then opens into the flower)
      const bloom = easeOutBack(clamp((g - 0.7) / 0.25, 0, 1));
      const budS = smooth(0.4, 0.6, g) * (1 - smooth(0.68, 0.8, g));
      bud.position.set(bendX(S), S + 0.03, 0);
      bud.scale.set(0.03 * budS + 1e-4, 0.045 * budS + 1e-4, 0.03 * budS + 1e-4);
      bud.visible = budS > 0.01;
      flower.position.set(bendX(S), S + 0.05, 0.02);
      flower.scale.setScalar(Math.max(bloom, 0.0001));
      flower.visible = bloom > 0.01;

      // idle sway about the soil, wet soil darkens
      plant.rotation.z = Math.sin(tt * 1.1) * 0.035 + Math.sin(tt * 0.37) * 0.012;
      soilMat.color.lerpColors(soilDry, soilWet, w);
      soilMat.roughness = lerp(0.95, 0.45, w);
    },
    dispose() {
      own.forEach((x) => x.dispose());
      mats.forEach((m) => m.dispose());
      potTex.dispose(); signTex.dispose();
    },
  };
}

// Hand-held green watering can with a long spout pointing +z. Origin = the grip (top of the arched handle that
// Gary's fist closes around). Up is +y, front is +z. st.pour 0..1 emits a short blue stream from the spout tip;
// droplets are simulated in the can's local space (gravity along its -y).
export function buildWateringCan(THREE, ctx) {
  const { mesh, group, canvasTex, sphere } = ctx;
  const root = new THREE.Group();
  const own = [];
  const geo = (g) => { own.push(g); return g; };
  const mats = [];
  const M = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };

  const bodyTex = canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = '#3cb55a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4f1d8'; g.fillRect(0, h * 0.34, w, h * 0.34);
    g.fillStyle = '#23803c'; g.font = 'bold 24px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DUM', w / 2, h * 0.51);
  });
  const bodyMat = M({ map: bodyTex, roughness: 0.45, metalness: 0.1 });
  const greenMat = M({ color: 0x3cb55a, roughness: 0.45, metalness: 0.1 });
  const darkMat = M({ color: 0x23803c, roughness: 0.5 });
  const dropMat = M({ color: 0x4fb8ff, roughness: 0.25, emissive: 0x0b3d66 });

  // body: y -0.3 .. -0.1, label faces +z (cylinder u = 0.5 is at -z, so turn it around); plain caps
  mesh(geo(new THREE.CylinderGeometry(0.11, 0.095, 0.2, 28)), [bodyMat, greenMat, greenMat], root, [0, -0.2, 0], [1, 1, 1], [0, Math.PI, 0]);
  mesh(geo(new THREE.TorusGeometry(0.11, 0.014, 8, 28)), darkMat, root, [0, -0.1, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);

  // handle: arch in the y-z plane from the back of the rim over the top to the front; top of arch = origin
  const handleGeo = geo(new THREE.TorusGeometry(0.1, 0.02, 10, 32, Math.PI));
  handleGeo.rotateY(Math.PI / 2);
  mesh(handleGeo, darkMat, root, [0, -0.1, 0]);

  // spout: from the lower front of the body, rising gently toward +z; the rose sits on the tip
  const sBase = new THREE.Vector3(0, -0.24, 0.09);
  const dir = new THREE.Vector3(0, 0.4, 1).normalize();
  const sLen = 0.32;
  const up = new THREE.Vector3(0, 1, 0);
  const spout = mesh(geo(new THREE.CylinderGeometry(0.02, 0.03, sLen, 14)), greenMat, root,
    [sBase.x + dir.x * sLen / 2, sBase.y + dir.y * sLen / 2, sBase.z + dir.z * sLen / 2]);
  spout.quaternion.setFromUnitVectors(up, dir);
  const roseC = sBase.clone().addScaledVector(dir, sLen + 0.012);
  const rose = mesh(geo(new THREE.CylinderGeometry(0.036, 0.03, 0.03, 18)), darkMat, root, [roseC.x, roseC.y, roseC.z]);
  rose.quaternion.setFromUnitVectors(up, dir);

  const spoutTip = new THREE.Object3D();
  spoutTip.position.copy(sBase).addScaledVector(dir, sLen + 0.03);
  root.add(spoutTip);

  // droplet pool (shared unit sphere, scaled)
  const drops = [];
  for (let i = 0; i < 20; i++) {
    const d = mesh(sphere, dropMat, root, [0, 0, 0], [0.014, 0.014, 0.014]);
    d.visible = false;
    drops.push({ m: d, v: new THREE.Vector3(), life: 0 });
  }
  const GRAV = 3.2, LIFE = 0.8, RATE = 18;
  let cursor = 0, acc = 0;
  const tip = new THREE.Vector3();

  return {
    root,
    spoutTip,
    update(dt, t, st) {
      const h = clamp(dt || 1 / 60, 0, 0.1);
      const pour = clamp(st && typeof st.pour === 'number' ? st.pour : 0, 0, 1);
      if (pour > 0) {
        acc += h * RATE * pour;
        while (acc >= 1) {
          acc -= 1;
          let p = null;
          for (let k = 0; k < drops.length; k++) {
            const d = drops[(cursor + k) % drops.length];
            if (d.life <= 0) { p = d; cursor = (cursor + k + 1) % drops.length; break; }
          }
          if (!p) break;
          tip.copy(spoutTip.position);
          p.m.position.copy(tip);
          p.v.copy(dir).multiplyScalar(0.55);
          p.v.x += (Math.random() - 0.5) * 0.08;
          p.v.y += (Math.random() - 0.5) * 0.08;
          p.life = LIFE;
          p.m.visible = true;
        }
      } else {
        acc = 0;
      }
      for (const d of drops) {
        if (d.life <= 0) continue;
        d.life -= h;
        d.v.y -= GRAV * h;
        d.m.position.addScaledVector(d.v, h);
        const s = 0.014 * clamp(d.life / LIFE * 2, 0.4, 1);
        d.m.scale.set(s, s, s);
        if (d.life <= 0) d.m.visible = false;
      }
    },
    dispose() {
      own.forEach((x) => x.dispose());
      mats.forEach((m) => m.dispose());
      bodyTex.dispose();
    },
  };
}
