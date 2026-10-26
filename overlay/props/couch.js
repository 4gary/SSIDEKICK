// Cosy two-seat couch, cartoon style. Origin on the floor at the centre, front faces +z.
// Gary sits on the left (-x) cushion. Seat top y = 0.44, seat front z = 0.35, back rises to y ~1.0.

import { clamp, disposeTree, rbox } from './common.js';

export function build(THREE, ctx) {
  const { mesh, group, canvasTex } = ctx;

  // Materials (teal couch, mustard throw, wooden feet)
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x23706b, roughness: 0.9 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x2c8d84, roughness: 0.88 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0x3aa69b, roughness: 0.93 });
  const throwMat = new THREE.MeshStandardMaterial({ color: 0xf0a83c, roughness: 0.92 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.7 });
  const silverMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.35, metalness: 0.6 });
  const plainBagMat = new THREE.MeshStandardMaterial({ color: 0xf4c430, roughness: 0.6 });

  // Canvas art: soda can label and chip-bag top
  const canTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#d7412a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f6efe0'; g.fillRect(0, h * 0.36, w, h * 0.26);
    g.fillStyle = '#f2b632'; g.fillRect(0, h * 0.8, w, h * 0.06);
  });
  const canMat = new THREE.MeshStandardMaterial({ map: canTex, roughness: 0.4, metalness: 0.2 });
  const bagTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f4c430'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d6402b'; g.fillRect(0, 0, w, h * 0.2); g.fillRect(0, h * 0.8, w, h * 0.2);
    g.fillStyle = '#fff3c4'; g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.27, h * 0.19, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d6402b'; g.beginPath(); g.arc(w / 2, h / 2, h * 0.07, 0, Math.PI * 2); g.fill();
  });
  const bagTopMat = new THREE.MeshStandardMaterial({ map: bagTex, roughness: 0.6 });

  const root = new THREE.Group();

  // Stubby wooden feet
  const footGeo = new THREE.CylinderGeometry(0.05, 0.042, 0.13, 14);
  for (const x of [-0.8, 0.8]) for (const z of [-0.36, 0.26]) mesh(footGeo, woodMat, root, [x, 0.065, z]);

  // Base / plinth: y 0.12 .. 0.30, z -0.48 .. 0.35
  mesh(rbox(THREE, 1.9, 0.18, 0.83, 0.07), frameMat, root, [0, 0.21, -0.065]);

  // Chunky rounded arm rests at x = +-0.853, top at y 0.66 (3 mm outside the plinth and back, whose outer faces are at 0.95)
  for (const x of [-0.853, 0.853]) mesh(rbox(THREE, 0.2, 0.54, 0.83, 0.08), armMat, root, [x, 0.39, -0.065]);

  // Backrest: tilted back ~0.15 rad. Pivot at the bottom of the back, z -0.30, y 0.30.
  const back = group(root, [0, 0.30, -0.30]);
  back.rotation.x = -0.15;
  mesh(rbox(THREE, 1.9, 0.72, 0.2, 0.09), frameMat, back, [0, 0.36, -0.06]);
  for (const x of [-0.45, 0.45]) mesh(rbox(THREE, 0.8, 0.52, 0.17, 0.075), cushionMat, back, [x, 0.42, 0]);

  // Seat cushions: pivot at the cushion bottom (y 0.30) so the squash keeps them on the base
  const seatL = group(root, [-0.45, 0.30, 0.055]);
  mesh(rbox(THREE, 0.8, 0.14, 0.59, 0.06, 12, true), cushionMat, seatL, [0, 0, 0]);
  const seatR = group(root, [0.45, 0.30, 0.055]);
  mesh(rbox(THREE, 0.8, 0.14, 0.59, 0.06, 12, true), cushionMat, seatR, [0, 0, 0]);

  // Loose mustard throw pillow leaning in the right-hand corner
  mesh(rbox(THREE, 0.36, 0.34, 0.12, 0.06), throwMat, root, [0.56, 0.61, -0.15], [1, 1, 1], [-0.25, 0, 0.15]);

  // Soda can on the far (+x) arm, and a bag of chips lying on the same arm
  const canGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.12, 18);
  mesh(canGeo, [canMat, silverMat, silverMat], root, [0.85, 0.72, -0.25]);
  mesh(rbox(THREE, 0.14, 0.04, 0.2, 0.016, 6), [plainBagMat, plainBagMat, bagTopMat, plainBagMat, plainBagMat, plainBagMat],
    root, [0.85, 0.68, 0.12], [1, 1, 1], [0, 0.3, 0.03]);

  const anchors = {
    armrest: new THREE.Vector3(-0.853, 0.66, 0.0),  // arm rest on Gary's right (-x side when he faces +z)
    seatR: new THREE.Vector3(0.45, 0.44, 0.05),    // top centre of the empty right cushion
  };

  // Squash: smooth toward the target with exponential smoothing
  let squash = 0;

  return {
    root,
    spots: { use: { x: -0.42, y: 0.44, z: 0.0, yaw: 0, pose: "sit" } },
    anchors,
    update(dt, t, st) {
      const h = Math.min(Math.max(dt || 1 / 60, 0), 0.1);
      const amt = st && typeof st.squish === "number" ? clamp(st.squish, 0, 1) : 1;
      const target = st && st.active ? amt : 0;
      squash += (target - squash) * (1 - Math.exp(-h * 8));
      // Left cushion sinks ~15% in height and spreads ~4% wider while Gary sits on it
      seatL.scale.set(1 + 0.04 * squash, 1 - 0.15 * squash, 1 + 0.02 * squash);
    },
    dispose() {
      disposeTree(root, ctx.sphere);
      for (const m of [frameMat, armMat, cushionMat, throwMat, woodMat, silverMat, plainBagMat, canMat, bagTopMat]) m.dispose();
      canTex.dispose(); bagTex.dispose();
    },
  };
}
