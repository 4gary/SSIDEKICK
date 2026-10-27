// Helpers shared by the prop modules (import from './common.js'). Each one replaces a copy that used to sit in
// several modules; the bodies are unchanged. The box helpers take THREE first, because an ES module cannot see
// the THREE that build(THREE, ctx) is handed.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };   // smoothstep
export const easeInOut = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));

// Rounded box: a BoxGeometry whose vertices are pulled onto a rounded shape (radius r).
// Normals are set analytically so edges shade smoothly. bottomOrigin moves the origin to the bottom face.
export function rbox(THREE, w, h, d, r, seg = 12, bottomOrigin = false) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const rad = Math.min(r, hx, hy, hz);
  const ax = hx - rad, ay = hy - rad, az = hz - rad;
  const P = g.attributes.position, N = g.attributes.normal;
  const n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const qx = clamp(x, -ax, ax), qy = clamp(y, -ay, ay), qz = clamp(z, -az, az);
    n.set(x - qx, y - qy, z - qz).normalize(); // surface vertices always have a non-zero offset
    P.setXYZ(i, qx + n.x * rad, qy + n.y * rad, qz + n.z * rad);
    N.setXYZ(i, n.x, n.y, n.z);
  }
  P.needsUpdate = true; N.needsUpdate = true;
  if (bottomOrigin) g.translate(0, hy, 0);
  return g;
}

// Rounded box with its vertices remapped toward the edges, so the rounding gets enough samples (bed's variant).
// Normals are analytic (direction from the inner box), so the shading is smooth across faces.
export function rboxSmooth(THREE, w, h, d, r, seg = 12) {
  const g = new THREE.BoxGeometry(2, 2, 2, seg, seg, seg);
  const P = g.attributes.position, N = g.attributes.normal;
  const H = [w / 2, h / 2, d / 2];
  const I = H.map(v => Math.max(0, v - r));
  const f = t => -Math.cos(Math.PI * (t + 1) / 2);
  for (let i = 0; i < P.count; i++) {
    const pp = [0, 1, 2].map(k => H[k] * f(P.getComponent(i, k)));
    const qq = [0, 1, 2].map(k => Math.max(-I[k], Math.min(I[k], pp[k])));
    const dv = [0, 1, 2].map(k => pp[k] - qq[k]);
    const L = Math.hypot(dv[0], dv[1], dv[2]) || 1;
    const nx = dv[0] / L, ny = dv[1] / L, nz = dv[2] / L;
    P.setXYZ(i, qq[0] + nx * r, qq[1] + ny * r, qq[2] + nz * r);
    N.setXYZ(i, nx, ny, nz);
  }
  P.needsUpdate = true; N.needsUpdate = true;
  return g;
}

// Number guard and random helpers (fx.js semantics; handheld.js keeps its own num with a default)
export const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const rnd = (a, b) => a + Math.random() * (b - a);
export const stepOf = (dt) => clamp(num(dt, 1 / 60), 0, 0.1);

// Canvas helper: rounded rectangle path
export function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Canvas helper: n-pointed star path (not filled). Points alternate between radius R and inner, starting at angle a0.
export function star(g, cx, cy, R, inner, a0 = -Math.PI / 2, n = 5) {
  g.beginPath();
  for (let i = 0; i < 2 * n; i++) {
    const rad = i % 2 ? inner : R, a = a0 + (i * Math.PI) / n;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
}

// Dispose everything under obj. `keep` is a shared geometry (ctx.sphere) that must not be freed.
export function disposeTree(obj, keep) {
  obj.traverse((o) => {
    if (o.geometry && o.geometry !== keep) o.geometry.dispose();
    if (o.material) {
      for (const m of [].concat(o.material)) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
