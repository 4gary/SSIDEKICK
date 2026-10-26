// Cartoon retro mini fridge (mint), with the hand-held beer can and the burp cloud.
// Origin on the floor at the footprint centre, front faces +z (the camera).
// The door is hinged on its +x edge (x +0.375, z +0.255) and swings toward the camera and +x: st.open 0..1 maps to 0..110 deg, smoothed.
// The open interior (two wire shelves of DUM LITE cans and bottles) glows cold white-blue through one PointLight and an
// emissive back panel, both scaled by the open amount. Gary's use spot is front-left of the fridge, facing the open
// interior. The grab anchor is the front can of the lower shelf, which st.taken hides.

// Shared label art for the DUM LITE cans
import { clamp, disposeTree, rbox, rr, smooth } from './common.js';

function drawCan(g, w, h) {
  g.fillStyle = '#2f6fd1'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f2c94c'; g.fillRect(0, 0, w, h * 0.12); g.fillRect(0, h * 0.88, w, h * 0.12);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff6e0'; g.font = "bold 46px 'Segoe UI', Arial, sans-serif";
  g.fillText('DUM', w / 2, h * 0.46);
  g.fillStyle = '#f2c94c'; g.font = "bold 22px 'Segoe UI', Arial, sans-serif";
  g.fillText('LITE', w / 2, h * 0.73);
}

export function build(THREE, ctx) {
  const { mesh, group, canvasTex } = ctx;
  const OPEN_ANG = (110 * Math.PI) / 180;

  const mats = [], texs = [];
  const M = (p) => { const m = new THREE.MeshStandardMaterial(p); mats.push(m); return m; };
  const T = (w, h, draw) => { const t = canvasTex(w, h, draw); texs.push(t); return t; };

  // ---------- canvas art ----------
  const canTex = T(256, 140, drawCan);
  const bottleTex = T(128, 128, (g, w, h) => {
    g.fillStyle = '#4b8a3f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f6efe0'; g.fillRect(0, h * 0.38, w, h * 0.3);
    g.fillStyle = '#2f6fd1'; g.font = "bold 22px 'Segoe UI', Arial, sans-serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('DUM', w / 2, h * 0.53);
  });
  // "DUMSTREAM" sticker: white die-cut border, coral pill. Transparent corners, so alphaTest.
  const stickerTex = T(256, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    rr(g, 3, 3, w - 6, h - 6, 24); g.fillStyle = '#ffffff'; g.fill();
    rr(g, 13, 13, w - 26, h - 26, 16); g.fillStyle = '#ff6f59'; g.fill();
    g.fillStyle = '#ffffff'; g.font = "bold 30px 'Segoe UI', Arial, sans-serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('DUMSTREAM', w / 2, h / 2 + 2);
  });
  // Smiley magnet
  const smileTex = T(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fillStyle = '#ffd23f'; g.fill();
    g.fillStyle = '#2b2f3a';
    g.fillRect(20, 22, 6, 7); g.fillRect(38, 22, 6, 7);
    g.strokeStyle = '#2b2f3a'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.arc(32, 30, 13, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
  });

  // ---------- materials ----------
  const mintMat = M({ color: 0xa6e6cc, roughness: 0.7 });       // pastel mint body
  const doorMat = M({ color: 0xb6ecd7, roughness: 0.6 });       // door, a touch lighter
  const feetMat = M({ color: 0x2b2f3a, roughness: 0.6 });
  const chromeMat = M({ color: 0xe6ebf2, roughness: 0.28, metalness: 0.65 });
  const linerMat = M({ color: 0xeaf6f1, roughness: 0.8, side: THREE.DoubleSide });
  const glowMat = M({ color: 0xe4f5ff, emissive: 0xbfe6ff, emissiveIntensity: 0, roughness: 0.6, side: THREE.DoubleSide });
  const wireMat = M({ color: 0xc9d1dc, roughness: 0.35, metalness: 0.6 });
  const binMat = M({ color: 0xf4fff9, roughness: 0.6 });
  const magRedMat = M({ color: 0xe8603c, roughness: 0.5 });
  const magYelMat = M({ color: 0xf2c14e, roughness: 0.5 });
  const canMat = M({ map: canTex, roughness: 0.4, metalness: 0.2 });
  const bottleMat = M({ map: bottleTex, roughness: 0.35 });
  const stickerMat = M({ map: stickerTex, alphaTest: 0.5, roughness: 0.7 });
  const smileMat = M({ map: smileTex, alphaTest: 0.5, roughness: 0.5 });

  const root = new THREE.Group();

  // ---------- body: shell with an open front ----------
  const BZ0 = -0.325, BZ1 = 0.255;            // body back and front (the door adds 0.07 in front)
  const BD = BZ1 - BZ0, BZC = (BZ0 + BZ1) / 2;
  const Y0 = 0.1, Y1 = 0.93, YH = Y1 - Y0, YC = (Y0 + Y1) / 2;

  const feetG = new THREE.CylinderGeometry(0.035, 0.03, 0.06, 12);
  for (const x of [-0.31, 0.31]) for (const z of [BZ0 + 0.07, BZ1 - 0.07]) mesh(feetG, feetMat, root, [x, 0.03, z]);

  mesh(rbox(THREE, 0.75, 0.04, BD, 0.02), mintMat, root, [0, 0.08, BZC]);         // bottom panel
  mesh(rbox(THREE, 0.75, 0.07, BD, 0.035), mintMat, root, [0, 0.965, BZC]);       // top panel
  for (const x of [-0.35, 0.35]) mesh(rbox(THREE, 0.05, YH, BD, 0.02), mintMat, root, [x, YC, BZC]); // side walls
  mesh(rbox(THREE, 0.65, YH, 0.04, 0.02), mintMat, root, [0, YC, BZ0 + 0.02]);   // back wall

  // ---------- interior liners (visible through the open front) ----------
  const back = BZ0 + 0.04;                    // inner face of the back wall
  mesh(new THREE.PlaneGeometry(0.65, YH), glowMat, root, [0, YC, back + 0.002]);   // emissive back panel
  for (const s of [-1, 1]) {
    // 4 mm inside the side walls' inner faces (x +-0.325), so the planes are not coplanar with them
    mesh(new THREE.PlaneGeometry(BZ1 - back, YH), linerMat, root, [s * 0.321, YC, (back + BZ1) / 2],
      [1, 1, 1], [0, (-s * Math.PI) / 2, 0]);
  }
  mesh(new THREE.PlaneGeometry(0.65, BZ1 - back), linerMat, root, [0, Y0 + 0.002, (back + BZ1) / 2],
    [1, 1, 1], [-Math.PI / 2, 0, 0]);

  // Cold glow: one small PointLight inside, intensity follows the open amount
  const lamp = new THREE.PointLight(0xc8ecff, 0, 1.4, 2);
  lamp.position.set(0, 0.5, 0.1);
  root.add(lamp);

  // ---------- two wire shelves ----------
  const wireG = new THREE.CylinderGeometry(0.007, 0.007, 1, 6); // unit-length wire, stretched per segment
  const UP = new THREE.Vector3(0, 1, 0);
  function wireAt(parent, a, b) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const d = new THREE.Vector3().subVectors(B, A), len = d.length();
    const m = mesh(wireG, wireMat, parent, [(A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2], [1, len, 1]);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    return m;
  }
  function wireShelf(y) {
    const x0 = -0.31, x1 = 0.31, z0 = -0.25, z1 = 0.22;
    wireAt(root, [x0, y, z0], [x1, y, z0]);
    wireAt(root, [x0, y, z1], [x1, y, z1]);
    wireAt(root, [x0, y, z0], [x0, y, z1]);
    wireAt(root, [x1, y, z0], [x1, y, z1]);
    for (let i = 0; i < 7; i++) { const x = -0.27 + i * 0.09; wireAt(root, [x, y, z0], [x, y, z1]); }
  }
  const SH1 = 0.4, SH2 = 0.66, WIRE = 0.007, CAN_HALF = 0.06;
  wireShelf(SH1);
  wireShelf(SH2);

  // ---------- drinks ----------
  const canG = new THREE.CylinderGeometry(0.034, 0.034, 0.12, 14);
  canG.rotateY(Math.PI);                      // label centre faces +z
  const canMats = [canMat, chromeMat, chromeMat];
  const bottleProfile = [[0, 0], [0.03, 0], [0.034, 0.012], [0.034, 0.11], [0.02, 0.14], [0.014, 0.165], [0.014, 0.19], [0, 0.19]];
  const bottleG = new THREE.LatheGeometry(bottleProfile.map(([r, y]) => new THREE.Vector2(r, y)), 20);
  bottleG.rotateY(Math.PI);
  const capG = new THREE.CylinderGeometry(0.016, 0.016, 0.02, 10);

  // Lower shelf: front row of 7 (index 1 is the grab can), back row of 6
  let grabCan = null;
  for (let i = 0; i < 7; i++) {
    const m = mesh(canG, canMats, root, [-0.27 + i * 0.09, SH1 + WIRE + CAN_HALF, 0.15]);
    if (i === 1) grabCan = m;
  }
  for (let i = 0; i < 6; i++) mesh(canG, canMats, root, [-0.225 + i * 0.09, SH1 + WIRE + CAN_HALF, -0.1]);

  // Upper shelf: four bottles in front, cans behind
  for (const x of [-0.2, -0.067, 0.067, 0.2]) {
    mesh(bottleG, bottleMat, root, [x, SH2 + WIRE, 0.13]);
    mesh(capG, chromeMat, root, [x, SH2 + WIRE + 0.2, 0.13]);
  }
  for (let i = 0; i < 6; i++) mesh(canG, canMats, root, [-0.225 + i * 0.09, SH2 + WIRE + CAN_HALF, -0.1]);

  // ---------- door (pivot on the +x hinge edge) ----------
  const door = group(root, [0.375, 0, BZ1]);
  mesh(rbox(THREE, 0.75, 0.94, 0.07, 0.02), doorMat, door, [-0.375, 0.53, 0.035]);
  // Door bins on the inside face (they show when the door is open)
  for (const y of [0.3, 0.56]) mesh(rbox(THREE, 0.5, 0.08, 0.04, 0.012), binMat, door, [-0.4, y, -0.02]);

  // Chrome handle near the free edge, on two standoffs
  const hx = -0.64;
  mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.28, 12), chromeMat, door, [hx, 0.66, 0.125]);
  const standG = new THREE.CylinderGeometry(0.011, 0.011, 0.055, 10);
  standG.rotateX(Math.PI / 2);                // axis along z
  for (const y of [0.52, 0.8]) mesh(standG, chromeMat, door, [hx, y, 0.0975]);

  // Dial knob near the top
  const dialG = new THREE.CylinderGeometry(0.022, 0.022, 0.024, 16);
  dialG.rotateX(Math.PI / 2);
  mesh(dialG, chromeMat, door, [-0.2, 0.9, 0.082]);

  // Stickers and magnets on the front
  mesh(new THREE.PlaneGeometry(0.24, 0.09), stickerMat, door, [-0.37, 0.8, 0.0715], [1, 1, 1], [0, 0, 0.06]);
  const magRedG = new THREE.CylinderGeometry(0.036, 0.036, 0.014, 20);
  magRedG.rotateX(Math.PI / 2);
  mesh(magRedG, magRedMat, door, [-0.4, 0.5, 0.077]);
  const magYelG = new THREE.CylinderGeometry(0.03, 0.03, 0.014, 5);
  magYelG.rotateX(Math.PI / 2);
  mesh(magYelG, magYelMat, door, [-0.25, 0.5, 0.077], [1, 1, 1], [0, 0, 0.3]);
  mesh(new THREE.PlaneGeometry(0.07, 0.07), smileMat, door, [-0.42, 0.64, 0.0725]);

  // ---------- anchors and spots ----------
  const anchors = {
    grab: new THREE.Vector3(-0.18, SH1 + WIRE + CAN_HALF, 0.15), // centre of the front can on the lower shelf
    handle: new THREE.Vector3(0.375 + hx, 0.66, BZ1 + 0.125),    // chrome door bar, closed-door position (door-local hx, 0.66, 0.125)
  };
  const spots = { use: { x: -0.8, y: 0, z: 0.45, yaw: 2.07, pose: "stand" } };

  let openS = 0;

  return {
    root,
    spots,
    anchors,
    update(dt, t, st) {
      const h = clamp(dt || 1 / 60, 0, 0.1);
      // st.open 0..1 when given. Without it, the door opens while st.active is true.
      const goal = st && typeof st.open === "number" ? clamp(st.open, 0, 1) : st && st.active ? 1 : 0;
      openS += (goal - openS) * (1 - Math.exp(-h * 5));
      door.rotation.y = openS * OPEN_ANG;
      glowMat.emissiveIntensity = openS * 0.9;
      lamp.intensity = openS * 0.7;
      grabCan.visible = !(st && st.taken);
    },
    dispose() {
      disposeTree(root, ctx.sphere);
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}

// Hand-held "DUM LITE" beer can. Origin = middle of the can (the grip). Up is +y, the label faces +z.
// update(dt, t, st):
//   st.open (bool): the pull tab flips up and a little foam blob rises from the top.
//   st.crush (0..1): crushes the can. Height goes to ~35%, the waist bulges, dents and a twist are added
//     by moving the vertices of a 22 x 16 cylinder from a saved copy of its positions.
export function buildBeer(THREE, ctx) {
  const { mesh, canvasTex, sphere } = ctx;
  const H = 0.17, RT = 0.045, RB = 0.05;     // height, top radius (narrower lid), bottom radius

  const root = new THREE.Group();
  const mats = [], texs = [];
  const M = (p) => { const m = new THREE.MeshStandardMaterial(p); mats.push(m); return m; };

  const canTex = canvasTex(256, 140, drawCan);
  texs.push(canTex);
  const canMat = M({ map: canTex, roughness: 0.4, metalness: 0.2 });
  const silverMat = M({ color: 0xd3d9e2, roughness: 0.3, metalness: 0.7 });
  const foamMat = M({ color: 0xfff6e2, roughness: 0.9 });

  // The can body. The side is group 0, the caps are groups 1 and 2.
  const canGeo = new THREE.CylinderGeometry(RT, RB, H, 22, 16);
  canGeo.rotateY(Math.PI);                    // label centre faces +z
  const P = canGeo.attributes.position;
  const base = Float32Array.from(P.array);    // saved rest positions for the crush deformation
  mesh(canGeo, [canMat, silverMat, silverMat], root);

  // Pull tab, hinged on a rivet near the back of the lid
  const tabPivot = new THREE.Group();
  root.add(tabPivot);
  mesh(new THREE.BoxGeometry(0.022, 0.003, 0.05), silverMat, tabPivot, [0, 0.002, 0.018]);

  // Foam blob (three spheres) above the opening
  const foam = new THREE.Group();
  root.add(foam);
  mesh(sphere, foamMat, foam, [0, 0.01, 0], [0.03, 0.022, 0.03]);
  mesh(sphere, foamMat, foam, [0.018, 0.004, 0.012], [0.02, 0.016, 0.02]);
  mesh(sphere, foamMat, foam, [-0.016, 0.002, -0.008], [0.017, 0.014, 0.017]);
  foam.visible = false;

  // Vertex deformation: squash, waist bulge, crumpled dents and a twist. Starts from the saved positions.
  function deform(c) {
    const ys = 1 - 0.65 * c;                  // height goes to 35% at full crush
    for (let i = 0; i < P.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      const yn = y / H + 0.5;                 // 0 at the bottom rim, 1 at the top rim
      const a = Math.atan2(x, z), r0 = Math.hypot(x, z);
      const waist = 1 - Math.pow(2 * yn - 1, 2); // 0 at the rims, 1 at mid height
      const dent = c * 0.12 * Math.sin(a * 4 + yn * 9) * Math.cos(yn * 13 - a * 2);
      const r = r0 * (1 + c * 0.3 * waist + dent);
      const a2 = a + c * 0.9 * (yn - 0.5);
      P.setXYZ(i, r * Math.sin(a2), y * ys, r * Math.cos(a2));
    }
    P.needsUpdate = true;
    canGeo.computeVertexNormals();
  }

  let openS = 0, foamS = 0, lastCrush = -1;

  return {
    root,
    update(dt, t, st) {
      const h = clamp(dt || 1 / 60, 0, 0.1);
      const open = st && st.open ? 1 : 0;
      const crush = st && typeof st.crush === "number" ? clamp(st.crush, 0, 1) : 0;

      openS += (open - openS) * (1 - Math.exp(-h * 10));
      foamS += (open - foamS) * (1 - Math.exp(-h * 6));

      if (Math.abs(crush - lastCrush) > 1e-4) { deform(crush); lastCrush = crush; }

      const topY = (H / 2) * (1 - 0.65 * crush);
      tabPivot.position.set(0, topY, -0.012);
      tabPivot.rotation.x = -1.5 * openS;     // front end of the tab lifts up
      foam.position.set(0, topY, 0.02);
      const s = foamS * (1 - 0.4 * crush) * (1 + 0.04 * Math.sin(t * 7) * foamS);
      foam.scale.setScalar(Math.max(0.001, s));
      foam.visible = s > 0.02;
    },
    dispose() {
      disposeTree(root, ctx.sphere);
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}

// Cartoon burp cloud with a "BUURP" label on the front. Origin = the cloud centre, front faces +z, about 0.5 wide.
// update(dt, t, st): st.k 0..1 grows the cloud (scale 0.6 to 1.2), floats it up and fades it out
// (k 0 = fresh and opaque, k 1 = gone). Missing st.k means k 0.
export function buildBurp(THREE, ctx) {
  const { mesh, group, canvasTex, sphere } = ctx;

  const root = new THREE.Group();
  const mats = [], texs = [];
  const M = (p) => { const m = new THREE.MeshStandardMaterial(p); mats.push(m); return m; };

  const cloudMat = M({ color: 0x9ad65c, roughness: 0.85, transparent: true, depthWrite: false });
  const rimMat = M({ color: 0x5f9e35, roughness: 0.85, transparent: true, depthWrite: false });
  const textTex = canvasTex(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = "bold 62px 'Segoe UI', Arial, sans-serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = '#2f6b1c';
    g.strokeText('BUURP', w / 2, h / 2 + 4);
    g.fillStyle = '#f7ffd9'; g.fillText('BUURP', w / 2, h / 2 + 4);
  });
  texs.push(textTex);
  const textMat = new THREE.MeshBasicMaterial({ map: textTex, transparent: true, depthWrite: false });
  mats.push(textMat);
  const fadeMats = [cloudMat, rimMat, textMat];

  // Puffs: [x, y, rx, ry, rz]. Each one gets a slightly bigger dark rim sphere behind it.
  const puffs = [
    [0, 0, 0.17, 0.12, 0.1],
    [-0.13, -0.03, 0.11, 0.1, 0.09],
    [0.13, -0.03, 0.11, 0.1, 0.09],
    [-0.06, 0.1, 0.1, 0.09, 0.085],
    [0.07, 0.09, 0.1, 0.09, 0.085],
    [-0.2, 0.02, 0.07, 0.06, 0.06],
    [0.2, 0.02, 0.07, 0.06, 0.06],
  ];
  const cloud = group(root, [0, 0, 0]);
  for (const [x, y, rx, ry, rz] of puffs) {
    mesh(sphere, rimMat, cloud, [x, y, -0.02], [rx * 1.12, ry * 1.12, rz]);
    mesh(sphere, cloudMat, cloud, [x, y, 0], [rx, ry, rz]);
  }
  const label = mesh(new THREE.PlaneGeometry(0.3, 0.15), textMat, cloud, [0, 0, 0.115], [1, 1, 1], [0, 0, -0.08]);
  label.castShadow = false;
  root.traverse((o) => { if (o.isMesh) o.castShadow = false; });

  return {
    root,
    update(dt, t, st) {
      const k = clamp(st && typeof st.k === "number" ? st.k : 0, 0, 1);
      const a = 1 - smooth(0.35, 1, k);
      root.scale.setScalar((0.6 + 0.6 * k) * (1 + 0.03 * Math.sin((t || 0) * 9)));
      root.position.y = 0.1 * k;
      for (const m of fadeMats) m.opacity = a;
      root.visible = a > 0.005;
    },
    dispose() {
      disposeTree(root, ctx.sphere);
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}
