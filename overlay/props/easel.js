// Wooden A-frame easel with a tilted canvas, plus a paint tub on the floor. Origin on the floor at the easel centre,
// front faces +z (the camera). The canvas (0.7 x 0.55, centred at y 0.72) is a redrawn canvasTex: st.paint 0..1
// reveals a bad crayon drawing of "dum" one stroke at a time, in a fixed order. st.flourish adds sparkles and a
// frame shine. Gary's use spot is on the -x side of the easel, a little in front, turned toward the canvas (yaw 0.9).

export function build(THREE, ctx) {
  const { mesh, group, canvasTex, sphere } = ctx;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const CW = 512, CH = 400;

  const own = [];
  const geo = (g) => { own.push(g); return g; };
  const mats = [];
  const M = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };

  // ---------- drawing: strokes in a fixed order (deterministic jitter so it never changes between loads) ----------
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const jit = (a) => (rnd() - 0.5) * 2 * a;
  const STROKES = [];
  const line = (c, w, pts) => STROKES.push({ k: 'line', c, w, pts });
  const fill = (c, pts) => STROKES.push({ k: 'fill', c, pts });
  const text = (c, x, y, font, rot, txt) => STROKES.push({ k: 'text', c, x, y, font, rot, txt });
  const ell = (cx, cy, rx, ry, n = 28, j = 3, a0 = 0, a1 = Math.PI * 2) => {
    const p = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      p.push([cx + Math.cos(a) * rx + jit(j), cy + Math.sin(a) * ry + jit(j)]);
    }
    return p;
  };

  // 1. faint pencil sketch circle for the head
  line('#c9c1ae', 2, ell(250, 170, 128, 118, 30, 2));
  // 2. head: crayon fill, then a wobbly double outline
  fill('#ffd7a1', ell(250, 170, 120, 112, 36, 3));
  line('#23190f', 7, ell(250, 170, 120, 112, 40, 4));
  line('#23190f', 3, ell(252, 168, 124, 116, 40, 6));
  // 3. blush, and eyes (one eye much bigger than the other)
  fill('#ff7aa0', ell(186, 212, 20, 14, 16, 1));
  fill('#ff7aa0', ell(318, 210, 20, 14, 16, 1));
  fill('#ffffff', ell(300, 156, 24, 20, 20, 1));
  line('#1b1b1b', 5, ell(300, 156, 25, 21, 22, 2));
  fill('#1b1b1b', ell(310, 160, 9, 9, 12, 0.5));
  line('#1b1b1b', 5, ell(205, 158, 14, 14, 16, 1));
  fill('#1b1b1b', ell(209, 160, 5, 5, 10, 0.3));
  // 4. lopsided smile (right corner pulled up)
  const smile = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    smile.push([200 + t * 125 + jit(1.5), 232 - 10 * t + 22 * Math.sin(Math.PI * t) * (1 - 0.2 * t) + jit(1.5)]);
  }
  line('#c3151d', 8, smile);
  // 5. scribbly hair: two zigzag passes over the top of the head
  const hair = (c, w, off) => {
    const p = [];
    for (let i = 0; i <= 28; i++) {
      const a = Math.PI * (1.04 - (i / 28) * 1.08);
      const z = (i % 2 ? 16 : 0) + off;
      p.push([250 + Math.cos(a) * (126 + z) + jit(3), 170 - Math.sin(a) * (120 + z) + jit(3)]);
    }
    line(c, w, p);
  };
  hair('#6b3510', 6, 0);
  hair('#e8862e', 5, 8);
  // 6. gaming headset: band, pink cups, boom mic
  line('#2a2740', 14, ell(250, 170, 136, 130, 36, 1.5, Math.PI * 1.02, -Math.PI * 0.02));
  fill('#ff3d7f', ell(118, 190, 26, 32, 18, 1));
  line('#2a2740', 4, ell(118, 190, 26, 32, 18, 1));
  fill('#ff3d7f', ell(382, 190, 26, 32, 18, 1));
  line('#2a2740', 4, ell(382, 190, 26, 32, 18, 1));
  line('#2a2740', 8, [[382, 218], [372, 262], [336, 284], [300, 292]]);
  fill('#2a2740', ell(296, 294, 11, 11, 12, 0.5));
  // 7. crown (zigzag points) with one red gem
  const crown = [[178, 62], [188, 20], [214, 44], [250, 6], [286, 44], [312, 20], [322, 62]];
  fill('#ffd21f', crown);
  line('#b57700', 4, crown.concat([[178, 62]]));
  fill('#e8143c', ell(250, 34, 5, 5, 8, 0.3));
  // 8. stick body: neck, torso, arms (one raised), legs, feet
  line('#23190f', 7, [[250, 282], [252, 306]]);
  line('#23190f', 7, [[252, 306], [246, 352]]);
  line('#23190f', 7, [[250, 320], [160, 356], [146, 364]]);
  line('#23190f', 7, [[249, 318], [342, 300], [378, 254]]);
  fill('#ffd7a1', ell(146, 364, 10, 10, 12, 0.5));
  fill('#ffd7a1', ell(378, 254, 10, 10, 12, 0.5));
  line('#23190f', 7, [[246, 352], [210, 398]]);
  line('#23190f', 7, [[246, 352], [286, 398]]);
  line('#23190f', 6, [[196, 398], [222, 398]]);
  line('#23190f', 6, [[274, 398], [300, 398]]);
  // 9. heart at the top right
  const heart = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    heart.push([432 + x * 2.3 + jit(1), 92 + y * 2.3 + jit(1)]);
  }
  fill('#e8143c', heart);
  line('#8c0a1f', 3, heart);
  // 10. DUM, scrawled
  text('#d9141c', 300, 380, 'bold 66px "Segoe UI", sans-serif', -0.08, 'DUM');
  // 11. random paint blobs with a few drips
  const COLS = ['#ff5f5f', '#4ecdc4', '#ffe66d', '#6c5ce7', '#00b894', '#fd79a8'];
  for (let i = 0; i < 10; i++) {
    const x = 30 + rnd() * 440, y = 24 + rnd() * 340, r = 6 + rnd() * 9;
    const c = COLS[i % COLS.length];
    fill(c, ell(x, y, r, r * 0.8, 10, r * 0.2));
    if (i % 3 === 0) line(c, 4, [[x, y + r * 0.8], [x + jit(3), y + r * 0.8 + 16], [x + jit(3), y + r * 0.8 + 34]]);
  }
  // 12. blue zigzag scribble in the bottom-left corner
  const zig = [];
  for (let i = 0; i <= 12; i++) zig.push([40 + i * 9, 370 + (i % 2 ? -18 : 0) + jit(2)]);
  line('#2b59ff', 5, zig);

  function drawStroke(g, s, f) {
    if (s.k === 'fill') {
      g.fillStyle = s.c; g.beginPath();
      s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath(); g.fill();
      return;
    }
    if (s.k === 'text') {
      g.save(); g.translate(s.x, s.y); g.rotate(s.rot);
      g.fillStyle = s.c; g.font = s.font; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText(s.txt, 0, 0); g.restore();
      return;
    }
    if (f < 0.02) return;
    const n = s.pts.length;
    const cnt = Math.min(n, Math.max(2, Math.round(1 + (n - 1) * f)));
    g.strokeStyle = s.c; g.lineWidth = s.w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i < cnt; i++) { const [x, y] = s.pts[i]; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }

  function star(g, x, y, r, a) {
    g.fillStyle = '#fff6b0'; g.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * 0.28 : r, aa = a + (i * Math.PI) / 4;
      const px = x + Math.cos(aa) * rr, py = y + Math.sin(aa) * rr;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath(); g.fill();
  }
  const SPARKS = [[70, 70, 1], [452, 58, 0.8], [468, 300, 1.1], [44, 306, 0.7], [262, 22, 0.6]];

  // p: 0..1 share of strokes drawn (the last one partly); flourish: sparkles + a shine sweep
  function drawPaint(g, p, t, flourish) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#fbf5e6'; g.fillRect(0, 0, CW, CH);
    const k = clamp(p, 0, 1) * STROKES.length;
    const full = Math.floor(k), f = k - full;
    for (let i = 0; i < full && i < STROKES.length; i++) drawStroke(g, STROKES[i], 1);
    if (full < STROKES.length) drawStroke(g, STROKES[full], f);
    if (flourish) {
      const x0 = ((t * 0.6) % 1.8 - 0.4) * CW;
      const grad = g.createLinearGradient(x0 - 90, 0, x0 + 90, CH);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(0, 0, CW, CH);
      SPARKS.forEach(([x, y, s], i) => star(g, x, y, 26 * s * (0.6 + 0.4 * Math.sin(t * 4 + i * 1.7)), t * 0.8 + i));
    }
  }

  const paintTex = canvasTex(CW, CH, (g) => drawPaint(g, 0, 0, false));
  const paperMat = M({ map: paintTex, roughness: 0.92 });

  // ---------- easel ----------
  const woodMat = M({ color: 0xa8703a, roughness: 0.7 });
  const woodDarkMat = M({ color: 0x6e4524, roughness: 0.75 });
  const tubMat = M({ color: 0x3d7bd9, roughness: 0.5 });
  const redPaintMat = M({ color: 0xe8323c, roughness: 0.6 });
  const yellowMat = M({ color: 0xffd23f, roughness: 0.6 });

  const root = new THREE.Group();
  // a stick between two points (beam along a -> b)
  const beam = (a, b, r, mat) => {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const m = mesh(geo(new THREE.CylinderGeometry(r, r, len, 12)), mat, root,
      [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2]);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  };

  // A-frames: one at each side (x = +-0.44), hinged at the top, a front and a back leg each
  const HX = 0.44, HY = 1.22, HZ = -0.11;
  for (const x of [-HX, HX]) {
    const H = new THREE.Vector3(x, HY, HZ);
    const front = new THREE.Vector3(x, 0, 0.4), back = new THREE.Vector3(x, 0, -0.36);
    beam(H, front, 0.03, woodMat);
    beam(H, back, 0.03, woodMat);
    mesh(sphere, woodDarkMat, root, [x, 0, 0.4], [0.035, 0.03, 0.035]);
    mesh(sphere, woodDarkMat, root, [x, 0, -0.36], [0.035, 0.03, 0.035]);
    mesh(sphere, woodDarkMat, root, [x, HY, HZ], [0.045, 0.045, 0.045]);
  }
  // top rail across the hinges
  mesh(geo(new THREE.CylinderGeometry(0.03, 0.03, HX * 2 + 0.02, 12)), woodMat, root, [0, HY, HZ], [1, 1, 1], [0, 0, Math.PI / 2]);
  // mast behind the canvas
  mesh(geo(new THREE.BoxGeometry(0.1, 1.0, 0.035)), woodDarkMat, root, [0, 0.7, HZ]);

  // canvas: a tilted group (top leans back), dark wood frame, painted face at +z
  const cv = group(root, [0, 0.72, -0.02]);
  cv.rotation.x = -0.12;
  mesh(geo(new THREE.BoxGeometry(0.76, 0.6, 0.035)), woodMat, cv);
  mesh(geo(new THREE.PlaneGeometry(0.7, 0.55)), paperMat, cv, [0, 0, 0.0195]);

  // paint tray under the canvas, with three tubes lying on it
  mesh(geo(new THREE.BoxGeometry(0.8, 0.035, 0.12)), woodMat, root, [0, 0.4, 0.12]);
  const tubeGeo = geo(new THREE.CylinderGeometry(0.013, 0.013, 0.09, 10));
  const tubeMats = [redPaintMat, yellowMat, tubMat];
  [-0.2, -0.1, 0.0].forEach((x, i) => mesh(tubeGeo, tubeMats[i], root, [x, 0.44, 0.14], [1, 1, 1], [0, 0, Math.PI / 2]));

  // paint tub on the floor to the +x side: blue bucket, paint in the top, two brushes sticking out
  const TX = 0.64, TZ = 0.2;
  mesh(geo(new THREE.CylinderGeometry(0.11, 0.095, 0.2, 24)), tubMat, root, [TX, 0.1, TZ]);
  mesh(geo(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 24)), redPaintMat, root, [TX, 0.2, TZ]);
  mesh(geo(new THREE.TorusGeometry(0.1, 0.012, 8, 24, Math.PI)), woodDarkMat, root, [TX, 0.2, TZ]);
  beam(new THREE.Vector3(TX - 0.02, 0.16, TZ), new THREE.Vector3(TX - 0.07, 0.36, TZ + 0.03), 0.008, woodMat);
  beam(new THREE.Vector3(TX + 0.05, 0.16, TZ - 0.02), new THREE.Vector3(TX + 0.1, 0.34, TZ - 0.05), 0.008, woodMat);
  mesh(sphere, redPaintMat, root, [TX - 0.07, 0.37, TZ + 0.03], [0.014, 0.02, 0.014]);
  mesh(sphere, yellowMat, root, [TX + 0.1, 0.35, TZ - 0.05], [0.014, 0.02, 0.014]);

  // ---------- state ----------
  let lastP = -1, lastF = false;

  return {
    root,
    spots: { use: { x: -0.78, y: 0, z: 0.38, yaw: 0.9, pose: 'stand' } },
    anchors: { brushTarget: new THREE.Vector3(0, 0.72, 0.01) },
    update(dt, t, st) {
      const p = clamp(st && typeof st.paint === 'number' ? st.paint : 0, 0, 1);
      const f = !!(st && st.flourish);
      if (p !== lastP || f || lastF) {
        drawPaint(paintTex.userData.ctx, p, t || 0, f);
        paintTex.needsUpdate = true;
        lastP = p; lastF = f;
      }
    },
    dispose() {
      own.forEach((x) => x.dispose());
      mats.forEach((m) => m.dispose());
      paintTex.dispose();
    },
  };
}

// Hand-held paint brush (about 0.35 long, red tip). Origin = the grip, in the middle of the wooden handle.
// Bristles point toward +y.
export function buildBrush(THREE, ctx) {
  const { mesh } = ctx;
  const root = new THREE.Group();
  const own = [];
  const geo = (g) => { own.push(g); return g; };
  const mats = [];
  const M = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };
  const handleMat = M({ color: 0x3d7bd9, roughness: 0.5 });
  const metalMat = M({ color: 0xc9ced6, roughness: 0.35, metalness: 0.6 });
  const creamMat = M({ color: 0xf3dfb0, roughness: 0.8 });
  const redMat = M({ color: 0xe8323c, roughness: 0.5 });

  mesh(geo(new THREE.CylinderGeometry(0.03, 0.024, 0.19, 14)), handleMat, root, [0, -0.045, 0]); // handle -0.14 .. 0.05
  mesh(geo(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 14)), metalMat, root, [0, 0.07, 0]);   // ferrule 0.05 .. 0.09
  mesh(geo(new THREE.CylinderGeometry(0.02, 0.044, 0.08, 16)), creamMat, root, [0, 0.13, 0]);    // bristles 0.09 .. 0.17
  mesh(geo(new THREE.CylinderGeometry(0.006, 0.02, 0.05, 16)), redMat, root, [0, 0.195, 0]);     // red paint tip 0.17 .. 0.22
  mesh(ctx.sphere, redMat, root, [0, 0.22, 0], [0.008, 0.012, 0.008]);                           // loaded tip 0.22 .. 0.23

  return {
    root,
    dispose() {
      own.forEach((x) => x.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}

// Artist's palette: a wooden kidney with a thumb hole. Origin = the thumb hole; the palette lies in the xy plane
// with its face toward +z, and extends to +x.
export function buildPalette(THREE, ctx) {
  const { mesh, sphere } = ctx;
  const root = new THREE.Group();
  const own = [];
  const geo = (g) => { own.push(g); return g; };
  const mats = [];
  const M = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };
  const woodMat = M({ color: 0xd49a5c, roughness: 0.6 });

  const shape = new THREE.Shape();
  shape.absellipse(0.19, 0, 0.22, 0.14, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.02, 0, Math.PI * 2, false);
  shape.holes.push(hole);
  const plate = geo(new THREE.ExtrudeGeometry(shape, {
    depth: 0.018, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 40,
  }));
  mesh(plate, woodMat, root, [0, 0, -0.009]);

  // paint dabs on the face (flattened spheres); the centre is a mixed brown blob
  const dabs = [
    [0.12, 0.07, 0.03, '#e8323c'],
    [0.19, 0.075, 0.026, '#ffd23f'],
    [0.26, 0.05, 0.028, '#3c8cff'],
    [0.31, -0.02, 0.026, '#49c96a'],
    [0.24, -0.07, 0.03, '#ff6fb1'],
    [0.14, -0.06, 0.025, '#7a4fd6'],
    [0.19, 0.0, 0.034, '#8a5a33'],
  ];
  for (const [x, y, r, c] of dabs) {
    mesh(sphere, M({ color: c, roughness: 0.5 }), root, [x, y, 0.024], [r, r, r * 0.35]);
  }

  return {
    root,
    dispose() {
      own.forEach((x) => x.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
