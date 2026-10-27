// Disco ball prop for Gary's overlay (item "disco" in byte3d.html). Re-exported from fx.js, so byte3d.html needs no change.
import { clamp, disposeTree, num, rnd, stepOf } from './common.js';

// =====================================================================================
// Disco ball
// A faceted mirror ball (radius 0.35) on a short chain. Origin = the chain attach point, so the ball
// hangs 0.65 below it. Five coloured spotlight beams (additive cones) sweep around below the ball.
// st.on (0..1, default 1) fades the ball, chain, beams and the small glow light.
// =====================================================================================
export function buildDisco(THREE, ctx) {
  const { mesh, group } = ctx;
  const root = new THREE.Group();
  const R = 0.35, CHAIN = 0.3;

  const chainM = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.7, roughness: 0.3, transparent: true });
  const links = [];
  for (let i = 0; i < 5; i++) {
    const link = mesh(new THREE.TorusGeometry(0.035, 0.01, 8, 14), chainM, root, [0, -0.03 - i * 0.06, 0]);
    link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    links.push(link);
  }

  // Faceted ball: flat-shaded icosphere with a random mirror tint per facet
  const ballGeo = new THREE.IcosahedronGeometry(R, 2); // PolyhedronGeometry is already non-indexed
  const tris = ballGeo.attributes.position.count / 3;
  const col = new Float32Array(tris * 9);
  for (let f = 0; f < tris; f++) {
    const roll = Math.random();
    let r, gg, b;
    if (roll < 0.12) { r = 1.0; gg = 0.55; b = 0.85; }
    else if (roll < 0.2) { r = 0.6; gg = 0.95; b = 1.0; }
    else { const v = rnd(0.7, 1.0); r = v; gg = v; b = v; }
    for (let k = 0; k < 3; k++) {
      const o = f * 9 + k * 3;
      col[o] = r; col[o + 1] = gg; col[o + 2] = b;
    }
  }
  ballGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const ballM = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, metalness: 0.45, roughness: 0.2,
    emissive: 0x222233, emissiveIntensity: 0.5, transparent: true,
  });
  const ball = mesh(ballGeo, ballM, root, [0, -CHAIN - R, 0]);

  // One small point light for the glow on the room (the only light in this module)
  const glow = new THREE.PointLight(0xffffff, 1, 3, 2);
  glow.position.set(0, -CHAIN - R, 0.3);
  root.add(glow);

  // Beams: each beam is a cone apex-at-the-ball, tilted outward; the yaw group sweeps it around
  const beamsG = group(root, [0, -CHAIN - R, 0]);
  const beamGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
  beamGeo.translate(0, -0.5, 0); // apex at the origin, base 1 unit below
  const COLS = [0xff4fd8, 0x35e0ff, 0xffe14d, 0x7dff6a, 0xff8a3d];
  const beams = [];
  for (let i = 0; i < 5; i++) {
    const yaw = group(beamsG, [0, 0, 0]);
    const tilt = group(yaw, [0, 0, 0]);
    tilt.rotation.z = 0.4 + (i % 3) * 0.14;
    const m = new THREE.MeshBasicMaterial({
      color: COLS[i], transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    mesh(beamGeo, m, tilt, [0, 0, 0], [0.42, 1.8, 0.42]);
    beams.push({ yaw, m, ph: i * 1.26, sp: (i % 2 ? -1 : 1) * (0.5 + i * 0.07) });
  }

  let spin = 0;
  return {
    root,
    update(dt, t, st) {
      const h = stepOf(dt);
      const s = st || {};
      const on = clamp(num(s.on, 1), 0, 1);
      const time = num(t, 0);
      spin += h * 0.9;
      ball.rotation.set(0.15, spin, 0);
      ballM.opacity = on;
      chainM.opacity = on;
      ball.visible = on > 0.005;
      for (const l of links) l.visible = on > 0.005;
      beamsG.visible = on > 0.005;
      for (const b of beams) {
        b.yaw.rotation.y = time * b.sp + b.ph;
        b.m.opacity = 0.15 * on;
      }
      glow.intensity = 1.2 * on;
    },
    dispose() {
      disposeTree(root);
    },
  };
}
