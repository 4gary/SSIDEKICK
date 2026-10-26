// Hand-held props for Gary. Each export returns {root, update?, dispose} with a fresh root.
// Origin = the point Gary's fist grips. Natural up is +y, front faces +z (the camera).
// Exports: buildBook, buildNewspaper, buildPizza, buildChips, buildChip, buildBall, buildWatch,
// buildPencil, buildNotepad, buildLightbulb, buildMic.
// Module-level helpers are shared. Every build call makes its own geometry, materials and canvases
// (through kit), so dispose() on one item never touches another.

const FONT = '"Segoe UI", sans-serif';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeInOut = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));
const stepDt = (dt) => clamp(dt || 1 / 60, 0, 0.1);
const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);

// Rounded box: a BoxGeometry whose vertices are pulled onto a rounded shape (radius r).
// Keeps the per-face groups, so a material array maps per face: +x, -x, +y, -y, +z, -z.
function rbox(THREE, w, h, d, r, seg = 6) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const rr = Math.min(r, hx, hy, hz);
  const ax = hx - rr, ay = hy - rr, az = hz - rr;
  const P = g.attributes.position, N = g.attributes.normal;
  const n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const qx = clamp(x, -ax, ax), qy = clamp(y, -ay, ay), qz = clamp(z, -az, az);
    n.set(x - qx, y - qy, z - qz).normalize();
    P.setXYZ(i, qx + n.x * rr, qy + n.y * rr, qz + n.z * rr);
    N.setXYZ(i, n.x, n.y, n.z);
  }
  P.needsUpdate = true; N.needsUpdate = true;
  return g;
}

// Per-item resource kit: everything built through it is freed by dispose().
function kit(THREE, ctx) {
  const geos = [], mats = [], texs = [];
  return {
    geo(g) { geos.push(g); return g; },
    mat(o) { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; },
    basic(o) { const m = new THREE.MeshBasicMaterial(o); mats.push(m); return m; },
    tex(w, h, draw) { const t = ctx.canvasTex(w, h, draw); texs.push(t); return t; },
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}

// Seeded random so scribbles look the same on every render.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Sets ctx2d.font to the largest bold size (down from `size`) whose text fits in maxW.
function fontFit(g, text, maxW, size, weight = "bold") {
  let s = size;
  g.font = `${weight} ${s}px ${FONT}`;
  while (s > 8 && g.measureText(text).width > maxW) {
    s -= 2;
    g.font = `${weight} ${s}px ${FONT}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Book: open hardcover held facing Gary. Origin = bottom of the spine. Pages face -z (toward
// Gary), the back cover faces +z (the viewer). st.page: each increment flips one page from the
// right side over to the left, arcing toward Gary.
export function buildBook(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh, group } = ctx;
  const root = new THREE.Group();

  const coverTex = K.tex(640, 400, (g, w, h) => {
    g.fillStyle = "#ff5a3c"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffd23f"; g.fillRect(0, 16, w, 10); g.fillRect(0, h - 26, w, 10);
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
    const line = (text, y, size, fill, lw) => {
      g.font = `bold ${size}px ${FONT}`;
      g.lineWidth = lw; g.strokeStyle = "#2a0d05"; g.strokeText(text, w / 2, y);
      g.fillStyle = fill; g.fillText(text, w / 2, y);
    };
    line("HOW TO BE", h * 0.28, 84, "#ffffff", 14);
    line("FUNNY", h * 0.56, 150, "#ffe14d", 22);
    line("- for dummies -", h * 0.82, 46, "#ffffff", 10);
    g.font = `bold 22px ${FONT}`; g.fillStyle = "#2a0d05"; g.fillText("DUMSTREAM PRESS", w / 2, h * 0.12);
  });
  const pageTex = K.tex(256, 328, (g, w, h) => {
    const R = rng(11);
    g.fillStyle = "#fff6e2"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#8fb6e6"; g.lineWidth = 2;
    for (let y = 22; y < h; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = "#2b2b2b"; g.lineWidth = 3; g.lineCap = "round";
    for (let y = 30; y < h - 10; y += 22) {
      let x = 18 + R() * 20;
      g.beginPath(); g.moveTo(x, y);
      while (x < w - 20) { x += 10 + R() * 24; g.lineTo(x, y + (R() - 0.5) * 9); }
      g.stroke();
    }
  });

  const boardMat = K.mat({ color: 0xc23b22, roughness: 0.7 });
  const coverMat = K.mat({ map: coverTex, roughness: 0.6 });
  const edgeMat = K.mat({ color: 0xfff1d0, roughness: 0.9 });
  const pageMat = K.mat({ map: pageTex, roughness: 0.9 });

  // Board slab (the cover art is on its +z face), spine, and the two page blocks (-z face = pages)
  mesh(K.geo(rbox(THREE, 0.56, 0.36, 0.012, 0.008)), [boardMat, boardMat, boardMat, boardMat, coverMat, boardMat], root, [0, 0.18, 0.006]);
  // spine: front face at z 0.01, 2 mm behind the cover (the board's front is at 0.012), so they do not z-fight
  mesh(K.geo(rbox(THREE, 0.03, 0.36, 0.045, 0.012)), boardMat, root, [0, 0.18, -0.0125]);
  const blockGeo = K.geo(rbox(THREE, 0.25, 0.32, 0.045, 0.006));
  for (const s of [-1, 1]) mesh(blockGeo, [edgeMat, edgeMat, edgeMat, edgeMat, edgeMat, pageMat], root, [s * 0.155, 0.18, -0.0225]);

  // Flipping page: pivots on the spine, sits on the right block at rest
  const sheetGeo = K.geo(new THREE.PlaneGeometry(0.25, 0.32).translate(0.155, 0.18, 0));
  const sheetMat = K.mat({ map: pageTex, roughness: 0.9, side: THREE.DoubleSide });
  const flip = group(root, [0, 0, -0.046]);
  flip.visible = false;
  mesh(sheetGeo, sheetMat, flip);
  const parked = [];
  const park = () => {
    const p = group(root, [0, 0, -0.046 - 0.0012 * parked.length]);
    p.rotation.y = Math.PI;
    mesh(sheetGeo, sheetMat, p);
    parked.push(p);
  };

  let shown = null, flipping = false, progress = 0;
  return {
    root,
    update(dt, t, st) {
      const h = stepDt(dt);
      const target = Math.floor(num(st && st.page, 0));
      if (shown === null) shown = target;
      if (target < shown) shown = target;
      if (target - shown > 3) shown = target - 3; // do not queue a long backlog of flips
      if (!flipping && target > shown) { flipping = true; progress = 0; }
      if (flipping) {
        progress += h / 0.7;
        flip.visible = true;
        flip.rotation.y = Math.PI * easeInOut(progress); // +y rotation lifts the page toward -z
        if (progress >= 1) {
          flip.visible = false; flip.rotation.y = 0;
          if (parked.length < 24) park();
          shown++;
          flipping = target > shown;
          progress = 0;
        }
      }
    },
    dispose() { K.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
// Newspaper: folded open broadsheet, slightly curved, front page faces +z. Origin = bottom centre
// edge (the grip).
export function buildNewspaper(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh } = ctx;
  const root = new THREE.Group();
  const W = 0.5, H = 0.36, BEND = 0.035;
  const geo = K.geo(new THREE.PlaneGeometry(W, H, 30, 12));
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i);
    P.setXYZ(i, x, P.getY(i) + H / 2, -BEND * Math.pow(x / (W / 2), 2)); // bottom edge at y 0, sides curl away
  }
  P.needsUpdate = true;
  geo.computeVertexNormals();

  const frontTex = K.tex(700, 504, (g, w, h) => {
    const R = rng(42);
    g.fillStyle = "#f4ecd6"; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(0,0,0,0.08)"; g.fillRect(w / 2 - 5, 0, 10, h); // fold
    g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(w / 2 + 5, 0, 5, h);

    g.textBaseline = "middle"; g.textAlign = "center"; g.fillStyle = "#151515";
    fontFit(g, "THE DUMSTREAM TIMES", w - 60, 62); g.fillText("THE DUMSTREAM TIMES", w / 2, 56);
    g.fillRect(20, 92, w - 40, 6); g.fillRect(20, 106, w - 40, 2);
    g.font = `600 18px ${FONT}`; g.textAlign = "left"; g.fillText("Vol. 1  ·  Issue 404  ·  Price: one chip", 24, 130);
    g.textAlign = "right"; g.fillText("PAGE 1", w - 24, 130);

    g.textAlign = "center";
    fontFit(g, "LOCAL STREAMER", w - 60, 58); g.fillText("LOCAL STREAMER", w / 2, 186);
    g.fillStyle = "#d6402b"; fontFit(g, "STILL DUM!", w - 60, 104); g.fillText("STILL DUM!", w / 2, 280);
    g.fillStyle = "#151515"; g.fillRect(20, 316, w - 40, 3);

    // photo box with a cartoon face
    const px = 30, py = 330, pw = 270, ph = 150;
    g.fillStyle = "#6f8497"; g.fillRect(px, py, pw, ph);
    g.fillStyle = "#cfdbe3"; g.fillRect(px + 8, py + 8, pw - 16, ph - 16);
    const cx = px + pw / 2, cy = py + ph * 0.52;
    g.fillStyle = "#2b2420"; g.beginPath(); g.ellipse(cx, cy - 28, 58, 34, 0, Math.PI, 2 * Math.PI); g.fill();
    g.fillStyle = "#ffd2a1"; g.beginPath(); g.arc(cx, cy, 50, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#222";
    for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * 18, cy - 6, 6, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = "#222"; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy + 8, 22, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.font = `italic 15px ${FONT}`; g.fillStyle = "#151515"; g.fillText("Dum, mid-sentence.", cx, py + ph + 16);

    // scribbly columns
    g.strokeStyle = "#1d1d1d"; g.lineWidth = 3; g.lineCap = "round";
    for (let y = 340; y < 492; y += 14) {
      if (R() < 0.15) continue;
      for (const [x0, x1] of [[320, 486], [504, 676]]) {
        let x = x0;
        g.beginPath(); g.moveTo(x, y);
        while (x < x1) { x = Math.min(x1, x + 14 + R() * 30); g.lineTo(x, y + (R() - 0.5) * 6); }
        g.stroke();
      }
    }

    // sticker
    g.save(); g.translate(644, 398); g.rotate(-0.22);
    g.fillStyle = "#ffe14d"; g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#151515"; fontFit(g, "SCOOP", 76, 24); g.fillText("SCOOP", 0, 0);
    g.restore();
  });

  const frontMat = K.mat({ map: frontTex, roughness: 0.85 });
  const backMat = K.mat({ color: 0xe6dcbc, roughness: 0.9, side: THREE.BackSide });
  mesh(geo, frontMat, root);
  mesh(geo, backMat, root);
  return { root, dispose() { K.dispose(); } };
}

// ---------------------------------------------------------------------------------------------
// Pizza slice: tip (apex) up at y 0.22, crust arc along the bottom. Origin = middle of the crust.
// Gary grips the crust. st.bites 0..3: the tip is bitten back in four precomputed versions.
export function buildPizza(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh, group } = ctx;
  const root = new THREE.Group();
  const R = 0.22, A = 0.36, RIN = R - 0.03, Y0 = R; // apex at (0, Y0); crust at distance R
  const TAN = Math.tan(A);
  const pt = (r, phi) => [r * Math.sin(phi), Y0 - r * Math.cos(phi)];

  const cheeseMat = K.mat({ color: 0xffc93c, roughness: 0.55 });
  const pepMat = K.mat({ color: 0xc7332a, roughness: 0.5 });
  const crustMat = K.mat({ color: 0xd9954a, roughness: 0.8 });
  const extrude = (shape, depth, bevel) => {
    const g = K.geo(new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 20,
    }));
    return g.translate(0, 0, -depth / 2);
  };

  // Crust: annular sector along the bottom
  const crust = new THREE.Shape();
  let p = pt(R, -A); crust.moveTo(p[0], p[1]);
  crust.absarc(0, Y0, R, -A - Math.PI / 2, A - Math.PI / 2, false);
  p = pt(RIN, A); crust.lineTo(p[0], p[1]);
  crust.absarc(0, Y0, RIN, A - Math.PI / 2, -A - Math.PI / 2, true);
  crust.closePath();
  mesh(extrude(crust, 0.05, 0.01), crustMat, root);

  // Four bite levels of the cheese: the tip is cut back by CUTS[b] and the cut edge gets bites.
  // Each bite: [centre, half-width, depth], centre and half-width in units of the cut half-width.
  const CUTS = [0, 0.045, 0.09, 0.135];
  const BITES = [
    [],
    [[0, 0.5, 0.02]],
    [[-0.45, 0.3, 0.02], [0.5, 0.35, 0.022]],
    [[-0.55, 0.25, 0.02], [-0.05, 0.22, 0.026], [0.6, 0.3, 0.018]],
  ];
  const SPOTS = [[0.085, -0.1], [0.085, 0.2], [0.125, -0.22], [0.125, 0.05], [0.16, 0.2], [0.16, -0.08], [0.14, 0.0]];
  const pepGeo = K.geo(new THREE.CylinderGeometry(0.017, 0.017, 0.008, 14));
  const levels = CUTS.map((dCut, b) => {
    const yc = Y0 - dCut, hw = dCut * TAN;
    const s = new THREE.Shape();
    let q = pt(RIN, -A); s.moveTo(q[0], q[1]);
    s.lineTo(-hw, yc);
    for (const [c, cw, depth] of BITES[b]) {
      s.lineTo((c - cw) * hw, yc);
      s.quadraticCurveTo(c * hw, yc - 2 * depth, (c + cw) * hw, yc);
    }
    s.lineTo(hw, yc);
    q = pt(RIN, A); s.lineTo(q[0], q[1]);
    s.absarc(0, Y0, RIN, A - Math.PI / 2, -A - Math.PI / 2, true);
    s.closePath();

    const lv = group(root, [0, 0, 0]);
    mesh(extrude(s, 0.03, 0.006), cheeseMat, lv);
    for (const [r, phi] of SPOTS) {
      if (r - dCut < 0.03) continue; // keep pepperoni clear of the bites
      const [x, y] = pt(r, phi);
      mesh(pepGeo, pepMat, lv, [x, y, 0.024], [1, 1, 1], [Math.PI / 2, 0, 0]);
    }
    return lv;
  });
  const showLevel = (b) => levels.forEach((lv, i) => { lv.visible = i === b; });
  showLevel(0);

  return {
    root,
    update(dt, t, st) {
      showLevel(clamp(Math.floor(num(st && st.bites, 0)), 0, 3));
    },
    dispose() { K.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
// Chip shape: the dome cap squashed flat and widened into a crisp oval chip.
const CHIP_SCALE = [1.25, 0.5, 1];

// Chips bag: open pillow bag with a DUM CHIPS label, chips poking out of the mouth.
// Origin = bottom centre of the bag (the grip).
export function buildChips(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh, group } = ctx;
  const root = new THREE.Group();

  const chipGeo = K.geo(new THREE.SphereGeometry(0.042, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.3)); // curved chip cap
  const chipMat = K.mat({ color: 0xf2c057, roughness: 0.6, side: THREE.DoubleSide });
  const labelTex = K.tex(256, 288, (g, w, h) => {
    g.fillStyle = "#f4c430"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#d6402b"; g.fillRect(0, 0, w, h * 0.2); g.fillRect(0, h * 0.82, w, h * 0.18);
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
    g.fillStyle = "#fff3c4"; fontFit(g, "100% DUM", w - 30, 24); g.fillText("100% DUM", w / 2, h * 0.1);
    fontFit(g, "DUM", w - 26, 110);
    g.lineWidth = 14; g.strokeStyle = "#fff3c4"; g.strokeText("DUM", w / 2, h * 0.46);
    g.fillStyle = "#d6402b"; g.fillText("DUM", w / 2, h * 0.46);
    fontFit(g, "CHIPS", w - 40, 56);
    g.lineWidth = 10; g.strokeStyle = "#3b1d0e"; g.strokeText("CHIPS", w / 2, h * 0.66);
    g.fillStyle = "#ffffff"; g.fillText("CHIPS", w / 2, h * 0.66);
    fontFit(g, "NET WT 1 DUM", w - 40, 20); g.fillStyle = "#fff3c4"; g.fillText("NET WT 1 DUM", w / 2, h * 0.91);
  });
  const labelMat = K.mat({ map: labelTex, roughness: 0.55 });
  const bagMat = K.mat({ color: 0xf0b429, roughness: 0.6 });
  const sealMat = K.mat({ color: 0xd6402b, roughness: 0.5 });

  mesh(K.geo(rbox(THREE, 0.18, 0.2, 0.05, 0.035, 8)), [bagMat, bagMat, bagMat, bagMat, labelMat, bagMat], root, [0, 0.1, 0]);
  mesh(K.geo(rbox(THREE, 0.19, 0.035, 0.065, 0.014)), sealMat, root, [0, 0.2, 0]); // crimped top

  // Chips poking out of the mouth: [x, y, z, rx, ry, rz]
  const CHIPS = [
    [-0.05, 0.245, 0.0, 0.5, 0.2, 0.3],
    [0.02, 0.27, 0.01, -0.3, 0.6, -0.2],
    [0.06, 0.235, -0.01, 0.1, -0.5, 0.6],
    [-0.02, 0.29, -0.02, 0.6, -0.1, 0.1],
    [0.04, 0.3, 0.02, -0.5, 0.1, -0.4],
    [-0.07, 0.22, 0.02, 0.2, 0.9, 0.7],
    [0.08, 0.265, 0.02, 0.4, -0.7, -0.5],
  ];
  for (const [x, y, z, rx, ry, rz] of CHIPS) {
    const c = group(root, [x, y, z]);
    c.rotation.set(rx, ry, rz);
    mesh(chipGeo, chipMat, c, [0, 0, 0], CHIP_SCALE);
  }

  return { root, dispose() { K.dispose(); } };
}

// Single curved chip for flying crumbs. Origin = chip centre. It tumbles with t.
export function buildChip(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh } = ctx;
  const root = new THREE.Group();
  const geo = K.geo(new THREE.SphereGeometry(0.042, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.3));
  const mat = K.mat({ color: 0xf2c057, roughness: 0.6, side: THREE.DoubleSide });
  // cap spans y 0.019..0.042 before the squash; after scaling y by 0.5 its centre is at y 0.0153
  mesh(geo, mat, root, [0, -0.0153, 0], CHIP_SCALE);
  return {
    root,
    update(dt, t) {
      const tt = num(t, 0);
      root.rotation.set(tt * 2.1, 0, tt * 1.4);
    },
    dispose() { K.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
// Soccer ball, radius 0.16. Origin = centre (he kicks it, not held). The black patches are the
// 12 pentagon centres (icosahedron vertices) painted straight into an equirect canvas.
export function buildBall(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh } = ctx;
  const root = new THREE.Group();
  const phi = (1 + Math.sqrt(5)) / 2, cen = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) cen.push([0, a, b], [a, b, 0], [b, 0, a]);
  for (const c of cen) { const l = Math.hypot(c[0], c[1], c[2]); c[0] /= l; c[1] /= l; c[2] /= l; }
  const COS = Math.cos(0.37); // angular radius of a black patch

  const tex = K.tex(1024, 512, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let py = 0; py < h; py++) {
      const V = 1 - (py + 0.5) / h, th = Math.PI * (1 - V); // matches SphereGeometry's uv mapping
      const sy = Math.cos(th), sn = Math.sin(th);
      for (let px = 0; px < w; px++) {
        const ph = 2 * Math.PI * ((px + 0.5) / w);
        const x = -Math.cos(ph) * sn, z = Math.sin(ph) * sn;
        let black = false;
        for (let i = 0; i < cen.length; i++) {
          const c = cen[i];
          if (x * c[0] + sy * c[1] + z * c[2] > COS) { black = true; break; }
        }
        const k = (py * w + px) * 4;
        d[k] = black ? 28 : 250; d[k + 1] = black ? 28 : 250; d[k + 2] = black ? 34 : 246; d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  const ballMat = K.mat({ map: tex, roughness: 0.45 });
  mesh(K.geo(new THREE.SphereGeometry(0.16, 40, 28)), ballMat, root);
  return { root, dispose() { K.dispose(); } };
}

// ---------------------------------------------------------------------------------------------
// Chunky gold wristwatch. Origin = centre of the band, which sits on his wrist. The band is a
// torus with its axis along y, so the forearm passes through it. The face faces +z.
// The hands turn with t (no st keys).
export function buildWatch(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh, group } = ctx;
  const root = new THREE.Group();
  const gold = K.mat({ color: 0xf5b82e, roughness: 0.3, metalness: 0.5 });
  const dark = K.mat({ color: 0x2b2b2b, roughness: 0.5 });
  const red = K.mat({ color: 0xe23b3b, roughness: 0.5 });

  const dialTex = K.tex(256, 256, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    g.fillStyle = "#fff7df"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#2b2b2b"; g.lineCap = "round";
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6, big = i % 3 === 0;
      const r1 = w * (big ? 0.36 : 0.41), r2 = w * 0.47;
      g.lineWidth = big ? 10 : 5;
      g.beginPath();
      g.moveTo(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a));
      g.lineTo(cx + r2 * Math.sin(a), cy - r2 * Math.cos(a));
      g.stroke();
    }
    g.fillStyle = "#d6402b"; g.textAlign = "center"; g.textBaseline = "middle";
    fontFit(g, "DUM", 90, 34); g.fillText("DUM", cx, cy + 64);
  });

  // band: torus with its axis along y
  mesh(K.geo(new THREE.TorusGeometry(0.075, 0.02, 14, 40)), gold, root, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  // case, bezel, dial, crown
  mesh(K.geo(new THREE.CylinderGeometry(0.058, 0.06, 0.03, 32)), gold, root, [0, 0, 0.085], [1, 1, 1], [Math.PI / 2, 0, 0]);
  mesh(K.geo(new THREE.TorusGeometry(0.06, 0.012, 12, 36)), gold, root, [0, 0, 0.1]);
  mesh(K.geo(new THREE.CircleGeometry(0.05, 32)), K.mat({ map: dialTex, roughness: 0.4 }), root, [0, 0, 0.1015]);
  mesh(K.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.024, 12)), gold, root, [0.07, 0, 0.085], [1, 1, 1], [0, 0, Math.PI / 2]);

  // hands: each pivots at the dial centre
  const hands = [];
  // hands are stacked 2 mm apart in z so their front faces never coincide where they cross
  const addHand = (len, w, mat, speed, offset, dz) => {
    const hg = group(root, [0, 0, 0.104 + dz]);
    mesh(K.geo(new THREE.BoxGeometry(w, len, 0.003).translate(0, len / 2, 0)), mat, hg);
    hands.push({ hg, speed, offset });
  };
  addHand(0.032, 0.012, dark, -0.25, 1.0, 0);       // hour
  addHand(0.046, 0.008, dark, -1.5, 0.0, 0.002);    // minute
  addHand(0.05, 0.003, red, -6.28, 0.0, 0.004);     // second

  return {
    root,
    update(dt, t) {
      const tt = num(t, 0);
      for (const h of hands) h.hg.rotation.z = h.offset + h.speed * tt;
    },
    dispose() { K.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
// Yellow pencil ~0.26 long, pink eraser at -y, sharpened tip at +y. Origin = middle of the body.
export function buildPencil(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh } = ctx;
  const root = new THREE.Group();
  const yellow = K.mat({ color: 0xffd21f, roughness: 0.6 });
  const pink = K.mat({ color: 0xff7aa8, roughness: 0.7 });
  const silver = K.mat({ color: 0xc9ced6, roughness: 0.3, metalness: 0.7 });
  const wood = K.mat({ color: 0xf0cfa0, roughness: 0.8 });
  const lead = K.mat({ color: 0x2f3440, roughness: 0.5 });
  mesh(K.geo(new THREE.CylinderGeometry(0.0155, 0.0155, 0.03, 12)), pink, root, [0, -0.115, 0]);
  mesh(K.geo(new THREE.CylinderGeometry(0.0145, 0.0145, 0.018, 12)), silver, root, [0, -0.091, 0]);
  mesh(K.geo(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 6)), yellow, root, [0, -0.002, 0]);
  mesh(K.geo(new THREE.CylinderGeometry(0.0045, 0.014, 0.03, 6)), wood, root, [0, 0.093, 0]);
  mesh(K.geo(new THREE.CylinderGeometry(0.0013, 0.0045, 0.02, 6)), lead, root, [0, 0.118, 0]);
  root.scale.set(1.45, 1, 1.45); // chunkier cartoon pencil: wider, same length
  return { root, dispose() { K.dispose(); } };
}

// ---------------------------------------------------------------------------------------------
// Spiral notepad ~0.16 x 0.22, facing +z. Origin = pad centre (grip). The spiral is at the top
// edge (y +0.11). st.page: each increment flips the top sheet up over the spiral.
export function buildNotepad(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh, group } = ctx;
  const root = new THREE.Group();

  const noteTex = K.tex(240, 336, (g, w, h) => {
    const R = rng(5);
    g.fillStyle = "#fffdf6"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#9cc3ef"; g.lineWidth = 2;
    for (let y = 52; y < h; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = "#ef6f6f"; g.beginPath(); g.moveTo(40, 0); g.lineTo(40, h); g.stroke();
    g.fillStyle = "#333"; g.textBaseline = "middle"; g.textAlign = "left";
    g.font = `bold 24px ${FONT}`; g.fillText("DUM LIST", 52, 28);
    g.strokeStyle = "#222"; g.lineWidth = 3; g.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const y = 80 + i * 24;
      let x = 54;
      g.beginPath(); g.moveTo(x, y);
      while (x < w - 16) { x += 14 + R() * 22; g.lineTo(x, y + (R() - 0.5) * 8); }
      g.stroke();
    }
    // doodle: smiley
    g.beginPath(); g.arc(186, 262, 24, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(186, 262, 14, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.fillStyle = "#222";
    g.beginPath(); g.arc(178, 256, 2.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(194, 256, 2.5, 0, Math.PI * 2); g.fill();
    // crossed-out line and a tick
    g.strokeStyle = "#d6402b"; g.beginPath(); g.moveTo(54, 218); g.lineTo(150, 218); g.stroke();
    g.strokeStyle = "#2a9d5b"; g.beginPath(); g.moveTo(60, 300); g.lineTo(72, 312); g.lineTo(96, 288); g.stroke();
  });

  const coverMat = K.mat({ color: 0x2ec4b6, roughness: 0.6 });
  const paperMat = K.mat({ color: 0xfffdf6, roughness: 0.9 });
  const frontMat = K.mat({ map: noteTex, roughness: 0.9 });
  mesh(K.geo(rbox(THREE, 0.15, 0.21, 0.02, 0.01)), [paperMat, paperMat, paperMat, paperMat, frontMat, paperMat], root, [0, 0, 0.01]);
  mesh(K.geo(rbox(THREE, 0.16, 0.22, 0.012, 0.014)), coverMat, root, [0, 0, -0.006]);

  // spiral coil: rings around the x axis along the top edge
  const coilMat = K.mat({ color: 0xc9ced6, roughness: 0.3, metalness: 0.6 });
  const coilGeo = K.geo(new THREE.TorusGeometry(0.0115, 0.0028, 8, 16));
  for (let i = 0; i < 9; i++) mesh(coilGeo, coilMat, root, [-0.064 + i * 0.016, 0.11, 0.01], [1, 1, 1], [0, Math.PI / 2, 0]);

  // flipping sheet: pivot on the spiral, hangs in front at rest
  const sheetGeo = K.geo(new THREE.PlaneGeometry(0.15, 0.21).translate(0, -0.105, 0.0225));   // 2.5 mm proud of the pad face (z 0.02)
  const sheetMat = K.mat({ map: noteTex, roughness: 0.9, side: THREE.DoubleSide });
  const flip = group(root, [0, 0.11, 0]);
  flip.visible = false;
  mesh(sheetGeo, sheetMat, flip);
  const parked = [];
  const park = () => {
    const p = group(root, [0, 0.11, -0.0015 * parked.length]);
    p.rotation.x = -Math.PI; // flipped over, lying up and behind the pad
    mesh(sheetGeo, sheetMat, p);
    parked.push(p);
  };

  let shown = null, flipping = false, progress = 0;
  return {
    root,
    update(dt, t, st) {
      const h = stepDt(dt);
      const target = Math.floor(num(st && st.page, 0));
      if (shown === null) shown = target;
      if (target < shown) shown = target;
      if (target - shown > 3) shown = target - 3;
      if (!flipping && target > shown) { flipping = true; progress = 0; }
      if (flipping) {
        progress += h / 0.6;
        flip.visible = true;
        flip.rotation.x = -Math.PI * easeInOut(progress); // negative x rotation lifts the sheet toward +z, then up
        if (progress >= 1) {
          flip.visible = false; flip.rotation.x = 0;
          if (parked.length < 24) park();
          shown++;
          flipping = target > shown;
          progress = 0;
        }
      }
    },
    dispose() { K.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
// Cartoon idea lightbulb, ~0.33 tall. Origin = bulb centre (it floats above his head).
// st.on 0..1 (eased): glass and filament go emissive yellow, a ring of rays pulses, and the
// one PointLight scales up.
export function buildLightbulb(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh, group } = ctx;
  const root = new THREE.Group();
  const glassMat = K.mat({
    color: 0xfff8dc, emissive: 0xffd23a, emissiveIntensity: 0, roughness: 0.15,
    transparent: true, opacity: 0.82, depthWrite: false,
  });
  const metalMat = K.mat({ color: 0xc9ced6, roughness: 0.35, metalness: 0.7 });
  const filMat = K.mat({ color: 0x6b4a2b, emissive: 0xffb020, emissiveIntensity: 0, roughness: 0.5 });
  const rayMat = K.basic({ color: 0xffe066, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const glowMat = K.basic({ color: 0xffe27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const shineMat = K.basic({ color: 0xffffff });

  mesh(K.geo(new THREE.SphereGeometry(0.095, 32, 24)), glassMat, root);
  mesh(K.geo(new THREE.SphereGeometry(0.13, 24, 16)), glowMat, root);
  mesh(K.geo(new THREE.SphereGeometry(0.018, 10, 8)), shineMat, root, [-0.035, 0.045, 0.08], [1, 1.4, 0.5]);

  const pts = [[-0.02, -0.075, 0], [-0.034, -0.045, 0], [-0.028, 0.0, 0], [-0.01, -0.012, 0], [0, 0.018, 0],
    [0.01, -0.012, 0], [0.028, 0.0, 0], [0.034, -0.045, 0], [0.02, -0.075, 0]].map((p) => new THREE.Vector3(...p));
  mesh(K.geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0045, 6)), filMat, root);

  // neck, screw base with grooves, tip
  mesh(K.geo(new THREE.CylinderGeometry(0.042, 0.052, 0.05, 20)), metalMat, root, [0, -0.112, 0]);
  mesh(K.geo(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 20)), metalMat, root, [0, -0.18, 0]);
  const ringGeo = K.geo(new THREE.TorusGeometry(0.05, 0.007, 8, 20));
  for (const y of [-0.15, -0.18, -0.21]) mesh(ringGeo, metalMat, root, [0, y, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  mesh(K.geo(new THREE.CylinderGeometry(0.018, 0.018, 0.016, 14)), metalMat, root, [0, -0.233, 0]);

  // rays: a fan over the top of the bulb, each a thin flat triangle
  const raysG = group(root, [0, 0, 0]);
  raysG.visible = false;
  const rayGeo = K.geo(new THREE.BufferGeometry());
  rayGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.013, 0.14, 0, 0.013, 0.14, 0, 0, 0.22, 0], 3));
  const rays = [];
  for (let i = 0; i < 11; i++) {
    const a = (-0.12 + (1.24 * i) / 10) * Math.PI;
    rays.push(mesh(rayGeo, rayMat, raysG, [0, 0, 0], [1, 1, 1], [0, 0, a - Math.PI / 2]));
  }

  const lamp = new THREE.PointLight(0xffd45a, 0, 1.4, 2);
  root.add(lamp);

  let on = 0;
  return {
    root,
    update(dt, t, st) {
      const h = stepDt(dt);
      const target = clamp(num(st && st.on, 0), 0, 1);
      on += (target - on) * (1 - Math.exp(-h * 10));
      const tt = num(t, 0);
      glassMat.emissiveIntensity = 1.1 * on;
      filMat.emissiveIntensity = 1.6 * on;
      glowMat.opacity = 0.32 * on;
      rayMat.opacity = 0.95 * on;
      raysG.visible = on > 0.01;
      lamp.intensity = 1.1 * on;
      for (let i = 0; i < rays.length; i++) {
        rays[i].scale.y = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(tt * 7 - i * 0.7));
      }
    },
    dispose() { K.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
// Hand-held cartoon microphone ~0.28 long. Origin = middle of the handle (the grip), head at +y.
export function buildMic(THREE, ctx) {
  const K = kit(THREE, ctx), { mesh } = ctx;
  const root = new THREE.Group();
  const grilleTex = K.tex(128, 128, (g, w, h) => {
    g.fillStyle = "#c9ced8"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#2d3240";
    for (let y = 8; y < h; y += 16) {
      for (let x = 8; x < w; x += 16) {
        g.beginPath(); g.arc(x + ((y / 16) % 2) * 8, y, 3.4, 0, Math.PI * 2); g.fill();
      }
    }
  });
  const bodyMat = K.mat({ color: 0x33384a, roughness: 0.45 });
  const redMat = K.mat({ color: 0xe84545, roughness: 0.5 });
  const silver = K.mat({ color: 0xc9ced8, roughness: 0.3, metalness: 0.7 });
  const headMat = K.mat({ map: grilleTex, roughness: 0.4, metalness: 0.3 });

  mesh(K.geo(new THREE.CylinderGeometry(0.02, 0.024, 0.16, 16)), bodyMat, root);
  mesh(K.geo(new THREE.CylinderGeometry(0.0245, 0.0245, 0.022, 16)), redMat, root, [0, -0.035, 0]);
  mesh(K.geo(new THREE.TorusGeometry(0.021, 0.005, 8, 20)), silver, root, [0, 0.05, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  mesh(K.geo(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 16)), silver, root, [0, 0.095, 0]);
  mesh(K.geo(new THREE.SphereGeometry(0.056, 28, 20)), headMat, root, [0, 0.14, 0]);
  return { root, dispose() { K.dispose(); } };
}
