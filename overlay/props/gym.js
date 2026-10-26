// Cartoon gym corner for Gary. Origin on the floor at the centre of the yoga mat, front faces +z (the camera).
// Layout along x (about 2.4 wide, x -1.3..1.15):
//   two-tier dumbbell rack at x -1.0 (3 colour pairs; the top pair is coral, L = Gary's left = +x),
//   pink yoga mat in the middle (1.4 along x, 0.7 along z),
//   red punching bag at x 1.2 on an L-shaped stand. The post stands behind the bag (z -0.45), the arm reaches
//   forward to the hook at (1.2, 1.42, 0). The bag hangs from the hook: bottom 0.34, top 1.14, centre z 0.
// spots: use = mat centre facing the camera; rack = behind the rack facing the camera (the rack sits between Gary
//   and the viewer so the dumbbells stay visible); bag = just left of the bag (x 0.58, 0.62 off the bag axis) facing +x.
// anchors: bagHit = the bag surface Gary punches (front-left, y 0.9; moves with the swing);
//   dumbbellL / dumbbellR = centres of the top pair (L at x -0.82, R at x -1.18).
// st: active (gentle idle sway of the bag), punch (count; each increase kicks the bag away from Gary),
//   takeL / takeR (hide the top dumbbell on that side).
// Written each frame on the returned object: bagSwing (rad, + = away from Gary), bagBonk (true for the one frame
//   the bag swings back past rest into Gary fast).
// Also exports buildDumbbell (hand-held, coral, grip at origin, bar along x).

const CORAL = 0xff6b4a, MINT = 0x4fd1a5, YELLOW = 0xffd23f;
const DB_R = 0.085;   // dumbbell disc radius
const DB_T = 0.075;   // disc thickness
const DB_X = 0.16;    // disc centre offset along the bar

// Shared dumbbell geometry, bar along x, grip at origin
function dumbbellGeometry(THREE) {
  const bar = new THREE.CylinderGeometry(0.022, 0.022, 0.36, 12); bar.rotateZ(Math.PI / 2);
  const disc = new THREE.CylinderGeometry(DB_R, DB_R, DB_T, 28); disc.rotateZ(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(0.036, 0.036, 0.024, 16); cap.rotateZ(Math.PI / 2);
  return { bar, disc, cap };
}

// Adds one dumbbell (bar along the parent's x) to parent
function addDumbbell(ctx, parent, geo, mats) {
  ctx.mesh(geo.bar, mats.bar, parent);
  for (const s of [-1, 1]) {
    ctx.mesh(geo.disc, mats.disc, parent, [s * DB_X, 0, 0]);
    ctx.mesh(geo.cap, mats.bar, parent, [s * (DB_X + DB_T / 2 + 0.012), 0, 0]);
  }
}

// Hand-held dumbbell: grip at origin, bar along x, coral discs, silver bar. Front faces +z.
export function buildDumbbell(THREE, ctx) {
  const root = new THREE.Group();
  const geo = dumbbellGeometry(THREE);
  const mats = {
    bar: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.35, metalness: 0.6 }),
    disc: new THREE.MeshStandardMaterial({ color: CORAL, roughness: 0.55 }),
  };
  addDumbbell(ctx, root, geo, mats);
  return {
    root,
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of [mats.bar, mats.disc]) m.dispose();
    },
  };
}

export function build(THREE, ctx) {
  const { mesh, group, canvasTex } = ctx;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Rounded box: a BoxGeometry whose vertices are pulled onto a rounded shape (radius r).
  // Normals are set analytically so edges shade smoothly. bottomOrigin moves the origin to the bottom face.
  function rbox(w, h, d, r, seg = 12, bottomOrigin = false) {
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const rr = Math.min(r, hx, hy, hz);
    const ax = hx - rr, ay = hy - rr, az = hz - rr;
    const P = g.attributes.position, N = g.attributes.normal;
    const n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const qx = clamp(x, -ax, ax), qy = clamp(y, -ay, ay), qz = clamp(z, -az, az);
      n.set(x - qx, y - qy, z - qz).normalize(); // surface vertices always have a non-zero offset
      P.setXYZ(i, qx + n.x * rr, qy + n.y * rr, qz + n.z * rr);
      N.setXYZ(i, n.x, n.y, n.z);
    }
    P.needsUpdate = true; N.needsUpdate = true;
    if (bottomOrigin) g.translate(0, hy, 0);
    return g;
  }

  // ---------- layout ----------
  const RX = -1.0;          // rack centre x
  const BX = 1.2;           // bag axis x
  const POST_Z = -0.45;     // bag stand post, behind the bag
  const HOOK_Y = 1.42;      // hook the bag hangs from
  const BAG_L = 0.68;       // pendulum length, hook to bag centre
  const BAG_R = 0.15;       // bag radius (capsule, total length 0.8)
  const SH_LO = 0.30, SH_HI = 0.66;          // shelf top surfaces
  const DB_Y = [SH_LO + DB_R, SH_HI + DB_R]; // dumbbell centres resting on each shelf
  const SLOT = 0.18;                         // dumbbell spacing across the rack

  // ---------- materials ----------
  const mats = [];
  const M = (p) => { const m = new THREE.MeshStandardMaterial(p); mats.push(m); return m; };
  const frameMat = M({ color: 0x3b3f56, roughness: 0.6 });
  const shelfMat = M({ color: 0x7a5cc7, roughness: 0.6 });
  const silverMat = M({ color: 0xc9ced6, roughness: 0.35, metalness: 0.6 });
  const coralMat = M({ color: CORAL, roughness: 0.55 });
  const mintMat = M({ color: MINT, roughness: 0.55 });
  const yellowMat = M({ color: YELLOW, roughness: 0.55 });

  // Yoga mat: pink with two edge lines running along its length
  const matTex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#ff7fb0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffc4de';
    g.fillRect(0, h * 0.12, w, h * 0.03); g.fillRect(0, h * 0.85, w, h * 0.03);
  });
  const matMat = M({ map: matTex, roughness: 0.9 });

  // Punching bag: red with two yellow bands and a "DUM" label
  const bagTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d6402b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4c430';
    g.fillRect(0, h * 0.22, w, h * 0.06); g.fillRect(0, h * 0.72, w, h * 0.06);
    g.fillStyle = '#fff3c4'; g.font = 'bold 58px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DUM', w / 2, h * 0.5);
  });
  const bagMat = M({ map: bagTex, roughness: 0.55 });

  const root = new THREE.Group();

  // ---------- yoga mat (1.4 along x, 0.7 along z) ----------
  mesh(rbox(1.4, 0.014, 0.7, 0.006), matMat, root, [0, 0.009, 0]);

  // ---------- dumbbell rack: base, two uprights, two shelves ----------
  const rack = group(root, [RX, 0, 0]);
  mesh(rbox(0.6, 0.04, 0.5, 0.015), frameMat, rack, [0, 0.02, 0]);
  for (const s of [-1, 1]) mesh(rbox(0.035, 0.82, 0.46, 0.012), frameMat, rack, [s * 0.2825, 0.45, 0]);
  mesh(rbox(0.6, 0.03, 0.46, 0.01), shelfMat, rack, [0, SH_LO - 0.015, 0]);
  mesh(rbox(0.6, 0.03, 0.46, 0.01), shelfMat, rack, [0, SH_HI - 0.015, 0]);

  // Dumbbells stand on their discs with the bar along z, so the discs face the camera.
  // Top shelf: coral pair on the outside (L and R), mint in the middle. Bottom shelf: yellow pair outside, mint middle.
  const dbGeo = dumbbellGeometry(THREE);
  const dbMats = (disc) => ({ bar: silverMat, disc });
  function rackDumbbell(x, y, discMat) {
    const g = group(rack, [x, y, 0]);
    g.rotation.y = Math.PI / 2;
    addDumbbell(ctx, g, dbGeo, dbMats(discMat));
    return g;
  }
  const topL = rackDumbbell(SLOT, DB_Y[1], coralMat);
  rackDumbbell(0, DB_Y[1], mintMat);
  const topR = rackDumbbell(-SLOT, DB_Y[1], coralMat);
  rackDumbbell(SLOT, DB_Y[0], yellowMat);
  rackDumbbell(0, DB_Y[0], mintMat);
  rackDumbbell(-SLOT, DB_Y[0], yellowMat);

  // ---------- punching bag on an L-shaped stand ----------
  mesh(rbox(0.34, 0.04, 0.3, 0.015), frameMat, root, [BX, 0.02, POST_Z]);            // base plate
  mesh(rbox(0.06, 1.44, 0.06, 0.02), frameMat, root, [BX, 0.72, POST_Z]);           // post, 0 .. 1.44
  const armGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.45, 12); armGeo.rotateX(Math.PI / 2);
  mesh(armGeo, frameMat, root, [BX, 1.44, POST_Z / 2]);                              // arm, post to hook (along z)
  mesh(ctx.sphere, silverMat, root, [BX, HOOK_Y, 0], [0.025, 0.025, 0.025]);         // hook

  // Pendulum: origin at the hook, rotation.z = swing (+ = bottom moves to +x, away from Gary)
  const pend = group(root, [BX, HOOK_Y, 0]);
  mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), silverMat, pend, [0, -0.15, 0]); // chain
  mesh(new THREE.CapsuleGeometry(BAG_R, 0.5, 8, 24), bagMat, pend, [0, -BAG_L, 0]);       // bag, 0.8 long

  // ---------- anchors ----------
  const HIT_PHI = 0.4;   // surface point, a bit toward Gary's left (-z)
  const hitRel = new THREE.Vector3(-BAG_R * Math.cos(HIT_PHI), 0.9 - HOOK_Y, -BAG_R * Math.sin(HIT_PHI));
  const hookV = new THREE.Vector3(BX, HOOK_Y, 0);
  const eul = new THREE.Euler();
  const anchors = {
    bagHit: new THREE.Vector3(),
    dumbbellL: new THREE.Vector3(RX + SLOT, DB_Y[1], 0),
    dumbbellR: new THREE.Vector3(RX - SLOT, DB_Y[1], 0),
  };
  function placeHit(a) {
    eul.set(0, 0, a);
    anchors.bagHit.copy(hitRel).applyEuler(eul).add(hookV);
  }
  placeHit(0);

  // ---------- pendulum state ----------
  const OMEGA2 = 9.81 / BAG_L;   // (g / L) for the swing
  const KICK = 3.2;              // rad/s added per punch
  const DAMP = 1.0;              // damping
  const MAX_ANG = 0.8, MIN_ANG = -0.3, MAX_OM = 7, BONK_SPEED = 1.5; // MIN_ANG: return swing stops early (Gary is right there)
  let ang = 0, om = 0, lastPunch = 0;

  const inst = {
    root,
    spots: {
      use: { x: 0, y: 0, z: 0, yaw: 0, pose: 'stand' },
      rack: { x: RX, y: 0, z: -0.62, yaw: 0, pose: 'stand' },
      bag: { x: BX - 0.62, y: 0, z: 0, yaw: Math.PI / 2, pose: 'stand' },
    },
    anchors,
    bagSwing: 0,
    bagBonk: false,
    update(dt, t, st) {
      st = st || {};
      const h = clamp(dt || 1 / 60, 0, 0.1);
      let bonk = false;

      // Each punch (increase of st.punch) kicks the bag away from Gary. At most 3 kicks per frame.
      const punch = typeof st.punch === 'number' ? st.punch : lastPunch;
      const kicks = clamp(punch - lastPunch, 0, 3);
      lastPunch = punch;
      om = clamp(om + kicks * KICK, -MAX_OM, MAX_OM);

      // Integrate in small substeps so the swing stays stable up to dt 0.1
      const n = Math.max(1, Math.ceil(h * 120));
      const sub = h / n;
      const drive = st.active ? 0.35 : 0;   // gentle idle sway while Gary is on stream
      const tt0 = typeof t === 'number' ? t : 0;
      for (let i = 0; i < n; i++) {
        const prev = ang;
        om += (-OMEGA2 * Math.sin(ang) - DAMP * om + drive * Math.sin((tt0 + i * sub) * 2.6)) * sub;
        ang += om * sub;
        if (ang > MAX_ANG) { ang = MAX_ANG; om = Math.min(om, 0); }
        if (ang < MIN_ANG) { ang = MIN_ANG; om = Math.max(om, 0); }
        // Swing crosses rest toward Gary (negative) fast: bonk
        if (prev >= 0 && ang < 0 && om < -BONK_SPEED) bonk = true;
      }

      pend.rotation.z = ang;
      placeHit(ang);
      inst.bagSwing = ang;
      inst.bagBonk = bonk;

      topL.visible = !st.takeL;
      topR.visible = !st.takeR;
    },
    dispose() {
      root.traverse((o) => { if (o.geometry && o.geometry !== ctx.sphere) o.geometry.dispose(); });   // ctx.sphere is shared
      dbGeo.bar.dispose(); dbGeo.disc.dispose(); dbGeo.cap.dispose();
      for (const m of mats) m.dispose();
      matTex.dispose(); bagTex.dispose();
    },
  };
  return inst;
}
