// Cartoon single bed, lying along x, headboard at +x. Gary lies on his back, head on the pillow.
// A patchwork quilt covers him from the feet to the chest; when inactive it sits folded at the foot.
export function build(THREE, ctx) {
  const root = new THREE.Group();

  // ---------- helpers ----------
  // Rounded box: a subdivided BoxGeometry whose vertices are pushed onto a rounded shell.
  // Vertices are remapped toward the edges so the rounding gets enough samples. Normals are
  // analytic (direction from the inner box), so the shading is smooth across faces.
  function rbox(w, h, d, r, seg = 12) {
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

  function star(g, cx, cy, R, color) {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? R * 0.45 : R, a = -Math.PI / 2 + k * Math.PI / 5;
      if (k) g.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
      else g.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    }
    g.closePath(); g.fillStyle = color; g.fill();
  }

  // Blanket: superellipse cross-section swept along x, rounded (domed) at both ends.
  // Built in absolute prop coords, then shifted so the blanket group can pivot at y = PIVOT.
  function quiltGeometry() {
    const x0 = -1.45, x1 = 0.2, a = 0.62, b = 0.34, yc = 0.64, PIVOT = 0.38;
    const NX = 40, NZ = 56, R = 0.25, EXP = 2.4;
    const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
    const dirZ = [], dirY = [];
    for (let j = 0; j <= NZ; j++) {
      const th = (j / NZ) * Math.PI * 2;
      dirZ.push(sp(Math.cos(th), 2 / EXP));
      dirY.push(sp(Math.sin(th), 2 / EXP));
    }
    const pos = [], uv = [], idx = [];
    const W = NZ + 1;
    for (let i = 0; i <= NX; i++) {
      const t = (1 - Math.cos(Math.PI * i / NX)) / 2; // denser near the ends
      const x = x0 + (x1 - x0) * t;
      const dL = x - x0, dR = x1 - x;
      const endS = d => d < R ? Math.sqrt(Math.max(0, 1 - ((R - d) / R) ** 2)) : 1;
      const s = Math.max(0.03, Math.min(endS(dL), endS(dR)));
      for (let j = 0; j <= NZ; j++) {
        pos.push(x, yc + b * dirY[j] * s - PIVOT, a * dirZ[j] * s);
        uv.push((x - x0) / (x1 - x0), j / NZ);
      }
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const p0 = i * W + j, p1 = (i + 1) * W + j, p2 = p0 + 1, p3 = p1 + 1;
      idx.push(p0, p1, p3, p0, p3, p2);
    }
    // make every triangle face outward (away from the blanket's axis)
    for (let q = 0; q < idx.length; q += 3) {
      const A = idx[q] * 3, B = idx[q + 1] * 3, C = idx[q + 2] * 3;
      const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2];
      const vx = pos[C] - pos[A], vy = pos[C + 1] - pos[A + 1], vz = pos[C + 2] - pos[A + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const ry = (pos[A + 1] + pos[B + 1] + pos[C + 1]) / 3 - (yc - PIVOT), rz = (pos[A + 2] + pos[B + 2] + pos[C + 2]) / 3;
      if (cy * ry + cz * rz < 0) { const tmp = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = tmp; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // close the seam between the first and last ring so the shading does not split
    const nrm = g.attributes.normal;
    for (let i = 0; i <= NX; i++) {
      const p = i * W, q = i * W + NZ;
      let nx = nrm.getX(p) + nrm.getX(q), ny = nrm.getY(p) + nrm.getY(q), nz = nrm.getZ(p) + nrm.getZ(q);
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      nrm.setXYZ(p, nx, ny, nz); nrm.setXYZ(q, nx, ny, nz);
    }
    return g;
  }

  // ---------- textures ----------
  const rng = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
  const quiltPal = ["#e8857a", "#f2c46d", "#7cc4a4", "#7aa6d9", "#c79bd6", "#f6a6a0", "#9ed8c4", "#fbf3e4"];
  const quiltTex = ctx.canvasTex(512, 512, (g, w, h) => {
    const cols = 5, rows = 7, cw = w / cols, ch = h / rows;
    g.fillStyle = "#fbf3e4"; g.fillRect(0, 0, w, h);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = i * cw, y = j * ch;
      g.fillStyle = quiltPal[Math.floor(rng() * quiltPal.length)];
      g.fillRect(x, y, cw, ch);
      g.strokeStyle = "rgba(255,250,240,0.95)"; g.lineWidth = 3; g.setLineDash([7, 6]);
      g.strokeRect(x + 11, y + 11, cw - 22, ch - 22);
      g.setLineDash([]);
      if (rng() < 0.45) star(g, x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.24, "#fff3b0");
    }
  });
  const rugTex = ctx.canvasTex(512, 300, (g, w, h) => {
    g.fillStyle = "#d9775f"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#f4e6cc"; g.fillRect(34, 34, w - 68, h - 68);
    g.fillStyle = "#e9d7b8"; g.fillRect(64, 64, w - 128, h - 128);
    g.fillStyle = "#6fb3a8";
    for (let y = 92; y < h - 80; y += 56) for (let x = 92 + ((y / 56) % 2) * 28; x < w - 80; x += 56) {
      g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    }
  });

  // ---------- materials ----------
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xb9784a, roughness: 0.7 });
  const mattMat = new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.9 });
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xfff1dc, roughness: 0.95 });
  const quiltMat = new THREE.MeshStandardMaterial({ map: quiltTex, roughness: 0.92 });
  const rugMat = new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 });
  const clockMat = new THREE.MeshStandardMaterial({ color: 0x4fb3a9, roughness: 0.5 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.35, metalness: 0.3 });
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xfff8ea, roughness: 0.6 });

  // ---------- bed frame ----------
  ctx.mesh(rbox(2.9, 0.16, 1.2, 0.06), woodMat, root, [0, 0.19, 0]);
  // chunky rounded legs: short at the foot end, taller posts at the headboard end
  for (const sz of [-1, 1]) {
    ctx.mesh(new THREE.CapsuleGeometry(0.075, 0.29, 6, 14), woodMat, root, [-1.38, 0.22, 0.52 * sz]);
    ctx.mesh(new THREE.CapsuleGeometry(0.085, 0.89, 6, 16), woodMat, root, [1.41, 0.53, 0.52 * sz]);
  }
  // headboard (short) between the two tall posts
  ctx.mesh(rbox(0.1, 0.86, 1.14, 0.045), woodMat, root, [1.41, 0.56, 0]);

  // mattress: puffy, top at y = 0.38
  ctx.mesh(rbox(2.72, 0.22, 1.06, 0.09, 16), mattMat, root, [0, 0.27, 0]);
  // big fluffy pillow at the headboard end: x 0.35..1.35, top at y 0.735 (same height as before, wider so the head fits)
  ctx.mesh(rbox(1.0, 0.36, 1.1, 0.2, 16), pillowMat, root, [0.85, 0.555, 0]);

  // ---------- blanket (covering) ----------
  const blanketG = new THREE.Group();
  blanketG.position.set(0, 0.38, 0);
  root.add(blanketG);
  ctx.mesh(quiltGeometry(), quiltMat, blanketG, [0, 0, 0]);

  // ---------- folded blanket (idle, at the foot of the bed) ----------
  const foldMesh = ctx.mesh(rbox(0.5, 0.1, 0.94, 0.04), quiltMat, root, [-1.0, 0.43, 0]);

  // ---------- small rug in front ----------
  ctx.mesh(rbox(1.5, 0.03, 0.85, 0.012, 6), rugMat, root, [0, 0.015, 1.02]);

  // ---------- tiny side table with an alarm clock, at the headboard end ----------
  const TX = 1.8, TZ = 0.55;
  ctx.mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 28), woodMat, root, [TX, 0.025, TZ]);
  ctx.mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 16), woodMat, root, [TX, 0.25, TZ]);
  ctx.mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 32), woodMat, root, [TX, 0.475, TZ]);
  ctx.mesh(rbox(0.16, 0.12, 0.07, 0.03, 6), clockMat, root, [TX, 0.56, TZ]);
  ctx.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 24), faceMat, root, [TX, 0.56, TZ + 0.04], [1, 1, 1], [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) ctx.mesh(ctx.sphere, brassMat, root, [TX + 0.075 * s, 0.645, TZ], [0.045, 0.03, 0.03]);

  // ---------- state ----------
  let k = 0; // 0 = folded at the foot, 1 = covering him
  // use.x puts the head centre (about 1.59 from the spot) on the pillow centre at x 0.85
  const spots = { use: { x: -0.74, y: 0.67, z: 0, yaw: 0, pose: "lie" } };
  // pillow: centre of the pillow top. capHook: top of the near (+z) bedpost, where a cap can hang
  const anchors = { pillow: new THREE.Vector3(0.85, 0.735, 0), capHook: new THREE.Vector3(1.41, 1.06, 0.52) };

  return {
    root,
    spots,
    anchors,
    blanket: blanketG,
    update(dt, t, st) {
      const target = st && st.active ? 1 : 0;
      k += (target - k) * (1 - Math.exp(-5 * Math.max(0, dt || 0)));
      const b = st && typeof st.breath === "number" ? Math.min(1, Math.max(0, st.breath)) : 0.5;
      const breathe = 1 + 0.03 * (2 * b - 1); // top rises and falls about 3 %
      blanketG.visible = k > 0.01;
      blanketG.scale.set(0.9 + 0.1 * k, (0.2 + 0.8 * k) * breathe, 0.9 + 0.1 * k);
      foldMesh.visible = k < 0.98;
      foldMesh.scale.set(1 - 0.2 * k, 1 - k, 1 - 0.2 * k);
    },
    dispose() {
      root.traverse(o => { if (o.geometry && o.geometry !== ctx.sphere) o.geometry.dispose(); });
      [woodMat, mattMat, pillowMat, quiltMat, rugMat, clockMat, brassMat, faceMat].forEach(m => m.dispose());
      [quiltTex, rugTex].forEach(tx => tx.dispose());
    },
  };
}
