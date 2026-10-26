// Hand-held items, a disco ball and stream-event effects for Gary's overlay. No imports: THREE and ctx are passed in.
//
// Hand-held items (origin = Gary's grip, up = +y, front = +z):
//   buildFishingRod(THREE, ctx)   origin = grip. Returns { root, tip, update, dispose }.
//   buildSign(THREE, ctx, text)   origin = middle of the stick.
//   buildBanner(THREE, ctx)       origin = banner centre. Also setText(str, color).
//   buildFlag(THREE, ctx)         origin = grip on the pole.
// Scene prop:
//   buildDisco(THREE, ctx)        origin = chain attach point, ball hangs below it.
// World-space emitters (floor at y 0, camera at +z, screen about 6 units tall). Each returns
//   { root, update(dt, t), alive(), dispose(), <spawn methods> }. All particles live in fixed pools.
//   makeConfetti, makeCoins, makeFireworks, makeShockwave, makeHearts
// Preview wrappers (fire one burst on the first update, for _pshot): previewConfetti, previewCoins,
//   previewFireworks, previewShockwave, previewHearts.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const stepOf = (dt) => clamp(num(dt, 1 / 60), 0, 0.1);
const FONT = (px) => `bold ${px}px "Segoe UI", sans-serif`;
const vec3 = (p) =>
  Array.isArray(p) ? [num(p[0], 0), num(p[1], 0), num(p[2], 0)] : [num(p && p.x, 0), num(p && p.y, 0), num(p && p.z, 0)];

// Rounded box: a BoxGeometry whose vertices are pulled onto a rounded shape (radius r). Same as couch.js.
function rbox(THREE, w, h, d, r, seg = 12, bottomOrigin = false) {
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
  if (bottomOrigin) g.translate(0, hy, 0);
  return g;
}

// Dispose everything under obj. `keep` is a shared geometry (ctx.sphere) that must not be freed.
function disposeTree(obj, keep) {
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

// Limits the GPU upload of an instanced attribute to its first n instances; the rest of the pool is not in use.
function useRange(attr, n) { attr.updateRange.offset = 0; attr.updateRange.count = n * attr.itemSize; attr.needsUpdate = true; }

// Canvas rounded-rectangle path
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Soft white radial glow (used as an additive sprite map)
function glowDraw(g, w, h) {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}

// =====================================================================================
// Fishing rod
// Origin = the grip. The blank is 1.4 long and points up and forward (+y and +z at 45 degrees).
// The tip Object3D is exposed as inst.tip. The line hangs straight down (world -y) from the tip
// to a red/white bobber. A hook line runs from the bobber to the catch.
// st.depth: line length from the tip to the bobber, 0.3..2.5 (default 0.6).
// st.reel:  true spins the reel handle (eases up to speed, and back down when false).
// st.catch: "" | "boot" | "fish" hangs a soggy boot or a flapping fish on the hook.
// =====================================================================================
export function buildFishingRod(THREE, ctx) {
  const { mesh, group } = ctx;
  const root = new THREE.Group();
  const ROD = 1.4, TILT = Math.PI / 4;
  const M = (p) => new THREE.MeshStandardMaterial(p);
  const corkM = M({ color: 0x9a6a3c, roughness: 0.9 });
  const blankM = M({ color: 0xff6a2b, roughness: 0.45 });
  const silverM = M({ color: 0xc9ced6, roughness: 0.3, metalness: 0.6 });
  const reelM = M({ color: 0x2f80ed, roughness: 0.4 });
  const redM = M({ color: 0xe53935, roughness: 0.5 });
  const whiteM = M({ color: 0xffffff, roughness: 0.5 });
  const lineM = M({ color: 0xeeeeee, roughness: 0.8 });
  const fishM = M({ color: 0xff8a3d, roughness: 0.6 });
  const bellyM = M({ color: 0xffd9a8, roughness: 0.6 });
  const darkM = M({ color: 0x1d1b2e, roughness: 0.7 });
  const bootM = M({ color: 0x7b5636, roughness: 0.85 });
  const soleM = M({ color: 0x3b2a1f, roughness: 0.9 });
  const slimeM = M({ color: 0x4caf50, roughness: 0.4 });

  // Rod pivot: everything inside is built along +y, then tilted toward +z
  const pivot = group(root, [0, 0, 0]);
  pivot.rotation.x = TILT;

  // Cork grip (origin in its middle) and butt cap
  mesh(new THREE.CylinderGeometry(0.042, 0.048, 0.34, 18), corkM, pivot, [0, -0.02, 0]);
  mesh(ctx.sphere, corkM, pivot, [0, -0.19, 0], [0.046, 0.03, 0.046]);

  // Tapered blank from the top of the grip (y 0.15) to the tip (y 1.4), with three guides
  mesh(new THREE.CylinderGeometry(0.013, 0.03, 1.25, 16), blankM, pivot, [0, 0.775, 0]);
  for (const y of [0.45, 0.8, 1.15]) {
    const r = 0.03 - ((y - 0.15) / 1.25) * 0.017;
    const g = new THREE.TorusGeometry(r + 0.004, 0.005, 8, 18);
    g.rotateX(Math.PI / 2);
    mesh(g, silverM, pivot, [0, y, 0]);
  }

  // Tip: the Object3D is the exposed attach point; a small silver cap sits on it
  const tip = new THREE.Object3D();
  tip.position.set(0, ROD, 0);
  pivot.add(tip);
  mesh(ctx.sphere, silverM, pivot, [0, ROD, 0], [0.018, 0.018, 0.018]);

  // Spinning reel on the underside of the blank (local +z is down and forward after the tilt)
  mesh(new THREE.BoxGeometry(0.03, 0.05, 0.07), silverM, pivot, [0, 0.26, 0.04]);
  mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.07, 22), reelM, pivot, [0, 0.26, 0.085], [1, 1, 1], [0, 0, Math.PI / 2]);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), silverM, pivot, [0.045, 0.26, 0.085], [1, 1, 1], [0, 0, Math.PI / 2]);
  // Crank: pivots on the reel axis (x), so rotation.x spins it
  const crank = group(pivot, [0.06, 0.26, 0.085]);
  mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8), silverM, crank, [0, 0.06, 0]);
  mesh(ctx.sphere, redM, crank, [0, 0.125, 0], [0.024, 0.024, 0.024]);

  // Line: from the tip straight down (root space, not rod space). Scaled in y to the depth.
  const tipR = new THREE.Vector3(0, ROD, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), TILT);
  const lineG = group(root, [tipR.x, tipR.y, tipR.z]);
  const lineGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 6);
  lineGeo.translate(0, -0.5, 0); // spans y -1..0 so scale.y = length downward from the tip
  const line = mesh(lineGeo, lineM, lineG);

  // Bobber: red top half, white bottom half, a little antenna
  const bob = group(lineG, [0, -0.8, 0]);
  mesh(new THREE.SphereGeometry(0.065, 24, 12, 0, TAU, 0, Math.PI / 2), redM, bob);
  mesh(new THREE.SphereGeometry(0.065, 24, 12, 0, TAU, Math.PI / 2, Math.PI / 2), whiteM, bob);
  mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.07, 8), whiteM, bob, [0, 0.1, 0]);

  // Hook line from the bobber bottom down to the hook eye (catch anchor)
  const hookGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6);
  hookGeo.translate(0, -0.1, 0);
  mesh(hookGeo, lineM, bob, [0, -0.065, 0]);
  const catchG = group(bob, [0, -0.265, 0]);
  mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 16), silverM, catchG, [0, 0, 0]);

  // Soggy old boot, hanging from the eye
  const bootG = group(catchG, [0, -0.02, 0]);
  mesh(rbox(THREE, 0.1, 0.2, 0.08, 0.03), bootM, bootG, [0, -0.1, 0]);
  mesh(rbox(THREE, 0.16, 0.07, 0.2, 0.03), bootM, bootG, [0, -0.205, 0.04]);
  mesh(rbox(THREE, 0.17, 0.02, 0.21, 0.01), soleM, bootG, [0, -0.245, 0.04]);
  mesh(ctx.sphere, slimeM, bootG, [0.03, -0.25, 0.14], [0.03, 0.02, 0.03]);
  bootG.visible = false;

  // Flapping cartoon fish, head up at the eye, tail down. The whole fish wiggles and the tail flaps.
  const fishG = group(catchG, [0, -0.02, 0]);
  mesh(ctx.sphere, fishM, fishG, [0, -0.13, 0], [0.075, 0.13, 0.05]);
  mesh(ctx.sphere, bellyM, fishG, [0, -0.12, 0.03], [0.045, 0.1, 0.028]);
  for (const s of [-1, 1]) {
    mesh(ctx.sphere, whiteM, fishG, [s * 0.036, -0.06, 0.04], [0.024, 0.024, 0.02]);
    mesh(ctx.sphere, darkM, fishG, [s * 0.036, -0.06, 0.06], [0.011, 0.011, 0.01]);
    mesh(ctx.sphere, fishM, fishG, [s * 0.08, -0.13, 0], [0.035, 0.02, 0.015]); // side fins
  }
  const tailG = group(fishG, [0, -0.25, 0]);
  const tailGeo = new THREE.ConeGeometry(0.075, 0.1, 3);
  tailGeo.translate(0, -0.05, 0); // apex at the join, fan spreads downward
  mesh(tailGeo, fishM, tailG, [0, 0, 0], [1, 1, 0.3]);
  fishG.visible = false;

  let spinSpeed = 0;
  return {
    root,
    tip,
    update(dt, t, st) {
      const h = stepOf(dt);
      const s = st || {};
      const time = num(t, 0);
      const depth = clamp(num(s.depth, 0.6), 0.3, 2.5);
      line.scale.y = depth;
      bob.position.y = -depth + Math.sin(time * 2.4) * 0.01;

      const target = s.reel ? 18 : 0;
      spinSpeed += (target - spinSpeed) * (1 - Math.exp(-h * 5));
      crank.rotation.x += spinSpeed * h;

      bootG.visible = s.catch === 'boot';
      fishG.visible = s.catch === 'fish';
      bootG.rotation.z = 0.12 + Math.sin(time * 2.2) * 0.08;
      fishG.rotation.z = Math.sin(time * 9) * 0.18;
      tailG.rotation.z = Math.sin(time * 16) * 0.6;
    },
    dispose() {
      disposeTree(root, ctx.sphere);
    },
  };
}

// =====================================================================================
// Sign
// A hand-held cardboard placard (0.6 x 0.4, facing +z) on a wooden stick. Origin = stick middle.
// The card's bottom edge sits on the top of the stick. Words are auto-fitted: 1 to 3 words per line,
// and the layout that gives the biggest lettering wins.
// Note: buildSign(THREE, ctx, text); a missing text shows "BRB". No st keys. The sign sways gently.
// =====================================================================================
export function buildSign(THREE, ctx, text) {
  const { mesh, group, canvasTex } = ctx;
  const label = String(text == null || text === '' ? 'BRB' : text).toUpperCase().trim();
  const root = new THREE.Group();
  const body = group(root, [0, 0, 0]);

  const cardM = new THREE.MeshStandardMaterial({ color: 0xc38f55, roughness: 0.9 });
  const woodM = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.7 });
  const faceTex = canvasTex(768, 512, (g, w, h) => drawSign(g, w, h, label));
  const faceM = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.92 });

  // Card: BoxGeometry material order is [+x, -x, +y, -y, +z (front), -z (back)]
  mesh(rbox(THREE, 0.6, 0.4, 0.05, 0.03, 8), [cardM, cardM, cardM, cardM, faceM, cardM], body, [0, 0.5, 0]);

  // Stick: centred on the origin (the grip), top meets the card's bottom edge
  mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 14), woodM, body, [0, 0, 0]);
  mesh(ctx.sphere, woodM, body, [0, -0.3, 0], [0.024, 0.024, 0.024]);

  return {
    root,
    update(dt, t) {
      body.rotation.z = Math.sin(num(t, 0) * 1.7) * 0.045;
    },
    dispose() {
      disposeTree(root, ctx.sphere);
    },
  };
}

// Card face: cardboard, faint fibres, a tape strip and a corner signature. Then the fitted lettering.
function drawSign(g, w, h, label) {
  g.save();
  g.fillStyle = '#ecc999'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120,70,30,0.14)'; g.lineWidth = 4;
  for (let i = 0; i < 16; i++) {
    const y = ((i + 0.5) * h) / 16 + ((i * 53) % 9) - 4;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 8, w * 0.6, y - 8, w, y + 3); g.stroke();
  }
  g.strokeStyle = 'rgba(110,60,25,0.35)'; g.lineWidth = 14; g.strokeRect(22, 22, w - 44, h - 44);
  g.fillStyle = 'rgba(245,240,220,0.7)'; g.fillRect(w * 0.36, 0, w * 0.28, 36);

  const L = layoutWords(g, label.split(/\s+/).filter(Boolean), w * 0.84, h * 0.66);
  const px = L.px, lh = px * 1.04;
  g.font = FONT(px);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  let y = h / 2 - (L.lines.length * lh) / 2 + lh / 2;
  L.lines.forEach((line, i) => {
    const str = line.join(' ');
    g.save();
    g.translate(w / 2, y);
    g.rotate(i % 2 ? 0.02 : -0.015); // hand-lettered wobble
    g.lineWidth = px * 0.17; g.strokeStyle = '#1b1b2f'; g.strokeText(str, 0, 0);
    g.fillStyle = '#e8382e'; g.fillText(str, 0, 0);
    g.restore();
    y += lh;
  });

  g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.font = FONT(38); g.fillStyle = 'rgba(40,20,10,0.55)';
  g.fillText('- dum', w - 46, h - 46);
  g.restore();
}

// Picks the 1-3 words per line split that gives the biggest font size. Returns { lines, px }.
function layoutWords(g, words, maxW, maxH) {
  if (!words.length) words = ['?'];
  const n = words.length;
  const candidates = [];
  if (n <= 10) {
    for (let mask = 0; mask < 1 << (n - 1); mask++) {
      const lines = [[words[0]]];
      for (let i = 1; i < n; i++) {
        if (mask & (1 << (i - 1))) lines.push([words[i]]);
        else lines[lines.length - 1].push(words[i]);
      }
      if (lines.every((l) => l.length <= 3)) candidates.push(lines);
    }
  } else {
    const lines = [];
    for (let i = 0; i < n; i += 3) lines.push(words.slice(i, i + 3));
    candidates.push(lines);
  }
  g.font = FONT(100);
  let best = null;
  for (const lines of candidates) {
    let px = Infinity;
    for (const l of lines) {
      const wAt100 = g.measureText(l.join(' ')).width || 1;
      px = Math.min(px, (maxW * 100) / wAt100);
    }
    px = Math.min(px, maxH / (lines.length * 1.04));
    if (!best || px > best.px) best = { lines, px };
  }
  best.px = clamp(best.px, 24, 300);
  return best;
}

// =====================================================================================
// Banner
// A ribbon about 2.2 wide with swallowtail ends. Origin = its centre. It waves in update: the vertex
// wave is pinned a little at the left and flaps more at the right. setText(str, color) redraws the bold
// outlined title (color = the text fill, default gold). st.k (0..1) unfurls it: scale x grows from 0.
// =====================================================================================
export function buildBanner(THREE, ctx) {
  const { mesh, group, canvasTex } = ctx;
  const W = 2.2, H = 0.62;
  const CW = 1100, CH = 310, M = 12, NOTCH = 48;
  const DEFAULT_COLOR = '#ffd23f';

  // Ribbon silhouette with swallowtail notches, navy fill, gold pinstripes, then the outlined title
  function drawRibbon(g, w, h, str, color) {
    g.clearRect(0, 0, w, h);
    g.beginPath();
    g.moveTo(M, M); g.lineTo(w - M, M); g.lineTo(w - M - NOTCH, h / 2); g.lineTo(w - M, h - M);
    g.lineTo(M, h - M); g.lineTo(M + NOTCH, h / 2); g.closePath();
    const grd = g.createLinearGradient(0, M, 0, h - M);
    grd.addColorStop(0, '#34479c'); grd.addColorStop(1, '#1b2660');
    g.fillStyle = grd; g.fill();
    g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = '#0b0e22'; g.stroke();

    g.strokeStyle = '#f7c948'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(M + NOTCH * 0.6, M + 24); g.lineTo(w - M - NOTCH * 0.6, M + 24); g.stroke();
    g.beginPath(); g.moveTo(M + NOTCH * 0.6, h - M - 24); g.lineTo(w - M - NOTCH * 0.6, h - M - 24); g.stroke();

    const txt = str.toUpperCase();
    let px = 200;
    g.font = FONT(px);
    const maxW = w - 2 * (M + NOTCH) - 30;
    while (px > 36 && g.measureText(txt).width > maxW) { px -= 4; g.font = FONT(px); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = px * 0.24; g.strokeStyle = '#0a0a18'; g.strokeText(txt, w / 2, h / 2 + 4);
    g.fillStyle = color; g.fillText(txt, w / 2, h / 2 + 4);
  }

  const root = new THREE.Group();
  const bob = group(root, [0, 0, 0]);   // gentle float
  const unf = group(bob, [0, 0, 0]);    // unfurl (scale x)

  let tex = canvasTex(CW, CH, (g, w, h) => drawRibbon(g, w, h, 'NEW SUB: NAME!', DEFAULT_COLOR));
  const geo = new THREE.PlaneGeometry(W, H, 44, 8);
  const base = Float32Array.from(geo.attributes.position.array);
  const P = geo.attributes.position;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  mesh(geo, mat, unf);

  function wave(t) {
    for (let i = 0; i < P.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const u = (x + W / 2) / W;
      const a = 0.35 + 0.65 * u;
      P.setXYZ(i, x, y + a * 0.035 * Math.sin(u * 5.0 - t * 3.1 + 1.3), a * 0.12 * Math.sin(u * 7.0 - t * 4.2));
    }
    P.needsUpdate = true;
    geo.computeVertexNormals();
  }

  return {
    root,
    setText(str, c) {
      const old = tex;
      tex = canvasTex(CW, CH, (g, w, h) => drawRibbon(g, w, h, String(str == null ? '' : str), c || DEFAULT_COLOR));
      mat.map = tex;
      old.dispose();                     // the previous banner's canvas texture is no longer drawn
    },
    update(dt, t, st) {
      const s = st || {};
      const time = num(t, 0);
      const k = clamp(num(s.k, 1), 0, 1);
      unf.visible = k > 0.001;
      unf.scale.x = Math.max(0.001, k);
      bob.position.y = Math.sin(time * 1.6) * 0.035;
      if (k > 0.001) wave(time);
    },
    dispose() {
      disposeTree(root);
    },
  };
}

// =====================================================================================
// Flag
// A checkered racing flag on a wooden pole. Origin = the grip on the pole (pole spans y -0.5..0.8).
// The cloth (0.78 x 0.52) hangs from the top of the pole and ripples in update, pinned at the pole.
// st.wind (0..2, default 1) scales the ripple amplitude.
// =====================================================================================
export function buildFlag(THREE, ctx) {
  const { mesh, canvasTex } = ctx;
  const root = new THREE.Group();
  const CW = 0.78, CH = 0.52;
  const poleM = new THREE.MeshStandardMaterial({ color: 0xd9b07a, roughness: 0.7 });
  const goldM = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.3, metalness: 0.5 });

  mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.3, 14), poleM, root, [0, 0.15, 0]);
  mesh(ctx.sphere, goldM, root, [0, 0.84, 0], [0.04, 0.04, 0.04]);
  mesh(ctx.sphere, poleM, root, [0, -0.5, 0], [0.032, 0.032, 0.032]);

  const tex = canvasTex(256, 170, (g, w, h) => {
    const cw = w / 8, ch = h / 5;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 8; c++) {
        g.fillStyle = (r + c) % 2 ? '#15151c' : '#fbfbf6';
        g.fillRect(c * cw, r * ch, cw, ch);
      }
    }
  });
  const geo = new THREE.PlaneGeometry(CW, CH, 26, 10);
  geo.translate(CW / 2, 0, 0); // pinned at x = 0 (the pole)
  const P = geo.attributes.position;
  const base = Float32Array.from(P.array);
  const clothM = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 });
  mesh(geo, clothM, root, [0, 0.48, 0]);

  function ripple(t, wind) {
    for (let i = 0; i < P.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const u = x / CW;
      const a = wind * (0.015 + 0.1 * u * u);
      P.setXYZ(i, x, y + a * 0.35 * Math.sin(u * 6.0 - t * 5.0 + 0.8), a * Math.sin(u * 9.0 - t * 8.0));
    }
    P.needsUpdate = true;
    geo.computeVertexNormals();
  }

  return {
    root,
    update(dt, t, st) {
      const s = st || {};
      ripple(num(t, 0), clamp(num(s.wind, 1), 0, 2));
    },
    dispose() {
      disposeTree(root, ctx.sphere);
    },
  };
}

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

// =====================================================================================
// Confetti emitter
// Paper rectangles in one pooled InstancedMesh. burst() shoots up from a point, and the pieces tumble,
// flutter (drag plus a sway) and fall to the floor. They lie flat, then shrink away.
// rain(width, n) drops pieces from the top (y about 6), centred on x 0.
// =====================================================================================
export function makeConfetti(THREE, ctx) {
  const MAX = 1400, G = 9.0;
  const root = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.12, 0.07);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
  const im = new THREE.InstancedMesh(geo, mat, MAX);
  im.frustumCulled = false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.count = 0;
  root.add(im);
  const PAL = [0xff4d6d, 0xffd23f, 0x3ddc97, 0x4cc9f0, 0x9b5de5, 0xff8fab, 0xffffff, 0xff9f1c].map((c) => new THREE.Color(c));

  const parts = [];
  for (let i = 0; i < MAX; i++) {
    parts.push({ on: false, zero: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0,
      k: 3, sw: 1, ph: 0, amp: 0.5, age: 0, land: -1, stay: 1, s: 1 });
  }
  const E = new THREE.Euler(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), M4 = new THREE.Matrix4();
  const ZERO4 = new THREE.Matrix4().makeScale(0, 0, 0);
  let cursor = 0, hi = 0, live = 0, dirty = false;

  function kill(p) { if (p.on) { p.on = false; live--; } }

  function spawn(x, y, z, vx, vy, vz, k, amp) {
    const i = cursor; cursor = (cursor + 1) % MAX;
    const p = parts[i];
    if (!p.on) live++;
    p.on = true;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.rx = rnd(0, TAU); p.ry = rnd(0, TAU); p.rz = rnd(0, TAU);
    p.sx = rnd(-12, 12); p.sy = rnd(-10, 10); p.sz = rnd(-12, 12);
    p.k = k; p.sw = rnd(4, 9); p.ph = rnd(0, TAU); p.amp = amp;
    p.age = 0; p.land = -1; p.stay = rnd(0.5, 1.1); p.s = 1;
    im.setColorAt(i, pick(PAL));
    dirty = true;
    if (i + 1 > hi) hi = i + 1;
  }

  function burst(pos = [0, 0, 0], n = 300, power = 1) {
    const [x, y, z] = vec3(pos);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const spread = Math.random() * 0.5;
      const sp = rnd(9, 14) * power;
      const hs = Math.sin(spread) * sp;
      spawn(x, y, z, Math.cos(a) * hs, Math.cos(spread) * sp, Math.sin(a) * hs, rnd(2.0, 2.6), rnd(0.5, 1.1));
    }
  }

  function rain(width = 8, n = 80) {
    for (let i = 0; i < n; i++) {
      spawn(rnd(-width / 2, width / 2), rnd(5.6, 6.6), rnd(-0.3, 0.3), 0, -rnd(0.4, 1.0), 0, rnd(2.6, 3.4), rnd(0.3, 0.7));
    }
  }

  function update(dt) {
    const h = stepOf(dt);
    if (!live) { im.count = 0; return; }
    for (let i = 0; i < hi; i++) {
      const p = parts[i];
      if (p.on) {
        p.age += h;
        if (p.land < 0) {
          p.vy -= G * h;
          const d = Math.exp(-p.k * h);
          p.vx *= d; p.vy *= d; p.vz *= d;
          p.x += (p.vx + Math.sin(p.age * p.sw + p.ph) * p.amp) * h;
          p.y += p.vy * h;
          p.z += p.vz * h;
          p.rx += p.sx * h; p.ry += p.sy * h; p.rz += p.sz * h;
          if (p.y <= 0.02) { p.y = 0.02; p.land = p.age; p.vy = 0; }
        } else {
          // on the floor: slide a little, settle flat, then shrink after its stay
          const d = Math.exp(-5 * h);
          p.vx *= d; p.vz *= d;
          p.x += p.vx * h; p.z += p.vz * h;
          const e = 1 - Math.exp(-h * 8);
          const tgt = -Math.PI / 2 + Math.round(p.rx / Math.PI) * Math.PI;
          p.rx += (tgt - p.rx) * e;
          p.rz = ((p.rz + Math.PI) % TAU + TAU) % TAU - Math.PI;
          p.rz += (0 - p.rz) * e;
          if (p.age - p.land > p.stay) p.s = Math.max(0, p.s - h * 2);
        }
        if (p.age > 7 || (p.land >= 0 && p.s <= 0)) kill(p);
      }
      if (!p.on) {                       // dead: write its zero matrix once, then skip it
        if (!p.zero) { p.zero = true; im.setMatrixAt(i, ZERO4); }
        continue;
      }
      p.zero = false;
      E.set(p.rx, p.ry, p.rz, 'YXZ'); Q.setFromEuler(E);
      V.set(p.x, p.y, p.z); S.set(p.s, p.s, p.s);
      M4.compose(V, Q, S);
      im.setMatrixAt(i, M4);
    }
    while (hi > 0 && !parts[hi - 1].on) hi--;   // the high-water mark follows the highest live slot
    im.count = hi;
    useRange(im.instanceMatrix, hi);
    if (dirty && im.instanceColor) { useRange(im.instanceColor, hi); dirty = false; }
  }

  return {
    root,
    burst,
    rain,
    update,
    alive: () => live > 0,
    dispose() {
      disposeTree(root);
    },
  };
}

export function previewConfetti(THREE, ctx) {
  const e = makeConfetti(THREE, ctx);
  let fired = false;
  return {
    root: e.root,
    update(dt, t) {
      if (!fired) { fired = true; e.burst([0, 0.05, 0], 300, 1); }
      e.update(dt, t);
    },
    dispose() { e.dispose(); },
  };
}

// =====================================================================================
// Coins emitter
// Gold coins: a thin cylinder body, plus a "$" face and a "D" face (three InstancedMeshes sharing one pool).
// rain(x, width, n) drops coins from the top across [x - width/2, x + width/2]. fountain(pos, n) sprays them up.
// Each coin falls, bounces on the floor once, lies flat, then shrinks away.
// =====================================================================================
export function makeCoins(THREE, ctx) {
  const MAX = 360, G = 11, R = 0.12, HALF = 0.016, OFF = HALF + 0.0004;
  const root = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(R, R, HALF * 2, 28);
  bodyGeo.rotateX(Math.PI / 2);          // axis along z, so the faces look at the camera
  const faceGeo = new THREE.CircleGeometry(R * 0.94, 28);
  const backGeo = faceGeo.clone().rotateY(Math.PI);
  const bodyM = new THREE.MeshStandardMaterial({ color: 0xf2b230, metalness: 0.5, roughness: 0.3 });
  const faceTex = coinTex(ctx, '$');
  const backTex = coinTex(ctx, 'D');
  const faceM = new THREE.MeshStandardMaterial({ map: faceTex, metalness: 0.2, roughness: 0.4 });
  const backM = new THREE.MeshStandardMaterial({ map: backTex, metalness: 0.2, roughness: 0.4 });
  const mk = (g, m) => {
    const im = new THREE.InstancedMesh(g, m, MAX);
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    root.add(im);
    return im;
  };
  const bodyIM = mk(bodyGeo, bodyM), faceIM = mk(faceGeo, faceM), backIM = mk(backGeo, backM);
  const ims = [bodyIM, faceIM, backIM];

  const parts = [];
  for (let i = 0; i < MAX; i++) {
    parts.push({ on: false, zero: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, sy: 0, bounced: false, landed: false, land: 0, age: 0, stay: 0.8, s: 1 });
  }
  const E = new THREE.Euler(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const M4 = new THREE.Matrix4(), T4 = new THREE.Matrix4(), F4 = new THREE.Matrix4(), B4 = new THREE.Matrix4();
  const ZERO4 = new THREE.Matrix4().makeScale(0, 0, 0);
  let cursor = 0, hi = 0, live = 0;

  function kill(p) { if (p.on) { p.on = false; live--; } }

  function spawn(x, y, z, vx, vy, vz) {
    const i = cursor; cursor = (cursor + 1) % MAX;
    const p = parts[i];
    if (!p.on) live++;
    p.on = true;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.rx = 0; p.ry = rnd(0, TAU); p.sy = rnd(6, 12) * (Math.random() < 0.5 ? -1 : 1);
    p.bounced = false; p.landed = false; p.land = 0; p.age = 0; p.stay = rnd(0.6, 1.0); p.s = 1;
    if (i + 1 > hi) hi = i + 1;
  }

  function rain(x = 0, width = 6, n = 40) {
    n = Math.min(n, MAX);   // requests above the pool size would wrap and overwrite live coins
    for (let i = 0; i < n; i++) {
      spawn(x + rnd(-width / 2, width / 2), rnd(5.6, 6.6), rnd(-0.2, 0.2), rnd(-0.3, 0.3), -rnd(0.5, 1.5), rnd(-0.2, 0.2));
    }
  }

  function fountain(pos = [0, 0, 0], n = 40) {
    n = Math.min(n, MAX);
    const [x, y, z] = vec3(pos);
    for (let i = 0; i < n; i++) {
      const a = rnd(-0.6, 0.6);
      spawn(x, y + R + 0.001, z, Math.sin(a) * rnd(1.5, 3.2), rnd(5.5, 8.0), rnd(-0.8, 0.8));
    }
  }

  function update(dt) {
    const h = stepOf(dt);
    if (!live) { bodyIM.count = faceIM.count = backIM.count = 0; return; }
    for (let i = 0; i < hi; i++) {
      const p = parts[i];
      if (p.on) {
        p.age += h;
        if (!p.landed) {
          p.vy -= G * h;
          const d = Math.exp(-0.5 * h);
          p.vx *= d; p.vz *= d;
          p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
          p.ry += p.sy * h;
          if (p.vy < 0 && p.y <= R) {
            p.y = R;
            if (!p.bounced && p.vy < -1.2) {
              p.vy = -p.vy * 0.4; p.bounced = true; p.vx *= 0.6; p.vz *= 0.6; p.sy *= 0.35;
            } else {
              p.landed = true; p.land = p.age; p.vy = 0;
            }
          }
        } else {
          // lie flat on the floor, then shrink after the stay
          const e = 1 - Math.exp(-h * 10);
          p.y += (HALF + 0.002 - p.y) * e;
          const dd = Math.exp(-6 * h);
          p.vx *= dd; p.vz *= dd;
          p.x += p.vx * h; p.z += p.vz * h;
          const tgt = -Math.PI / 2 + Math.round(p.rx / Math.PI) * Math.PI;
          p.rx += (tgt - p.rx) * e;
          if (p.age - p.land > p.stay) p.s = Math.max(0, p.s - h * 2);
        }
        if (p.age > 8 || (p.landed && p.s <= 0)) kill(p);
      }
      if (!p.on) {                       // dead: zero all three matrices once, then skip it
        if (!p.zero) { p.zero = true; bodyIM.setMatrixAt(i, ZERO4); faceIM.setMatrixAt(i, ZERO4); backIM.setMatrixAt(i, ZERO4); }
        continue;
      }
      p.zero = false;
      E.set(p.rx, p.ry, 0, 'YXZ'); Q.setFromEuler(E);
      V.set(p.x, p.y, p.z); S.set(p.s, p.s, p.s);
      M4.compose(V, Q, S);
      bodyIM.setMatrixAt(i, M4);
      T4.makeTranslation(0, 0, OFF); F4.multiplyMatrices(M4, T4); faceIM.setMatrixAt(i, F4);
      T4.makeTranslation(0, 0, -OFF); B4.multiplyMatrices(M4, T4); backIM.setMatrixAt(i, B4);
    }
    while (hi > 0 && !parts[hi - 1].on) hi--;
    for (const im of ims) { im.count = hi; useRange(im.instanceMatrix, hi); }
  }

  return {
    root,
    rain,
    fountain,
    update,
    alive: () => live > 0,
    dispose() {
      disposeTree(root);
    },
  };
}

// Gold face with a symbol ("$" or "D")
function coinTex(ctx, sym) {
  return ctx.canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w * 0.4, h * 0.35, 4, w / 2, h / 2, w / 2);
    gr.addColorStop(0, '#fff3a6'); gr.addColorStop(0.55, '#ffc935'); gr.addColorStop(1, '#c98a12');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a86d0a'; g.lineWidth = 8;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 9, 0, TAU); g.stroke();
    g.fillStyle = '#b9750a'; g.font = FONT(96);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(sym, w / 2, h / 2 + 6);
  });
}

export function previewCoins(THREE, ctx) {
  const e = makeCoins(THREE, ctx);
  let fired = false;
  return {
    root: e.root,
    update(dt, t) {
      if (!fired) { fired = true; e.fountain([0, 0, 0], 50); e.rain(0, 6, 60); }
      e.update(dt, t);
    },
    dispose() { e.dispose(); },
  };
}

// =====================================================================================
// Fireworks emitter
// Rockets rise from the floor with a trail of embers, then burst into a sphere of additive sparks
// that drift, fall under gravity and fade. All in one pooled InstancedMesh. Additive blending means a
// fade is just dimming the instance colour.
// launch(x, y, color) fires one rocket to height y. show(n, width) fires n at random times over about 3 s.
// =====================================================================================
export function makeFireworks(THREE, ctx) {
  const MAX = 2600, SPARK_N = 110;
  const root = new THREE.Group();
  const glowTex = ctx.canvasTex(64, 64, glowDraw);
  const mat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX);
  im.frustumCulled = false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.count = 0;
  root.add(im);

  const HEAD = new THREE.Color(1, 0.95, 0.8);
  const WHITE = new THREE.Color(1, 1, 1);
  const PAL = [0xff4d6d, 0xffd23f, 0x3ddc97, 0x4cc9f0, 0xb07cff, 0xff8a3d, 0xff6ad5].map((c) => new THREE.Color(c));
  const colorOf = (c) => {
    if (c == null) return pick(PAL);
    const col = new THREE.Color();
    col.set(c);
    return col;
  };

  const parts = [];
  for (let i = 0; i < MAX; i++) {
    parts.push({ on: false, zero: false, kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.2,
      drag: 1, grav: 0, tgt: 0, emit: 0, col: WHITE, tcol: WHITE, boost: 1.3 });
  }
  const pending = [];
  const idQ = new THREE.Quaternion();
  const V = new THREE.Vector3(), S = new THREE.Vector3(), M4 = new THREE.Matrix4(), C = new THREE.Color();
  const ZERO4 = new THREE.Matrix4().makeScale(0, 0, 0), BLACK = new THREE.Color(0, 0, 0);
  let cursor = 0, hi = 0, live = 0;

  function kill(p) { if (p.on) { p.on = false; live--; } }

  // kind: 0 spark, 1 rocket, 2 ember (trail), 3 flash
  function spawn(kind, x, y, z, vx, vy, vz, life, size, col, drag, grav) {
    const i = cursor; cursor = (cursor + 1) % MAX;
    const p = parts[i];
    if (!p.on) live++;
    p.on = true; p.kind = kind;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.age = 0; p.life = life; p.size = size; p.col = col; p.drag = drag; p.grav = grav;
    p.emit = 0; p.tgt = 0; p.boost = kind === 1 ? 1.6 : 1.3;
    if (i + 1 > hi) hi = i + 1;
    return p;
  }

  function explode(x, y, z, col) {
    spawn(3, x, y, z, 0, 0, 0, 0.25, 1.1, WHITE, 0, 0);
    for (let i = 0; i < SPARK_N; i++) {
      const u = rnd(-1, 1), a = rnd(0, TAU), s = Math.sqrt(1 - u * u);
      const sp = rnd(1.1, 2.4);
      spawn(0, x, y, z, s * Math.cos(a) * sp, u * sp, s * Math.sin(a) * sp,
        rnd(1.1, 1.8), rnd(0.16, 0.24), Math.random() < 0.25 ? WHITE : col, 1.6, 2.0);
    }
  }

  function launch(x = 0, y = 4, color) {
    const col = colorOf(color);
    const p = spawn(1, x, 0, rnd(-0.3, 0.3), 0, 0, 0, 3, 0.16, HEAD, 0, 0);
    p.vy = y / 0.9;   // reaches the target height in about 0.9 s
    p.tgt = y;
    p.tcol = col;
  }

  function show(n = 8, width = 8) {
    for (let i = 0; i < n; i++) pending.push({ t: rnd(0, 3), x: rnd(-width / 2, width / 2), y: rnd(3.0, 5.2) });
  }

  function update(dt) {
    const h = stepOf(dt);
    for (let i = pending.length - 1; i >= 0; i--) {
      pending[i].t -= h;
      if (pending[i].t <= 0) { launch(pending[i].x, pending[i].y, null); pending.splice(i, 1); }
    }
    if (!live) { im.count = 0; return; }
    for (let i = 0; i < hi; i++) {
      const p = parts[i];
      if (p.on) {
        p.age += h;
        if (p.kind === 1) {
          p.y += p.vy * h;
          p.emit += h;
          while (p.emit > 0.022) {
            p.emit -= 0.022;
            spawn(2, p.x + rnd(-0.02, 0.02), p.y, p.z, rnd(-0.12, 0.12), rnd(-0.3, -0.05), rnd(-0.12, 0.12),
              rnd(0.35, 0.55), rnd(0.1, 0.14), p.tcol, 2.2, 1.6);
          }
          if (p.y >= p.tgt || p.age > 3) { explode(p.x, p.y, p.z, p.tcol); kill(p); }
        } else {
          if (p.age >= p.life) kill(p);
          else {
            const d = Math.exp(-p.drag * h);
            p.vx *= d; p.vy *= d; p.vz *= d;
            p.vy -= p.grav * h;
            p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
          }
        }
      }
      if (!p.on) {                       // dead: zero matrix and black colour written once, then skipped
        if (!p.zero) { p.zero = true; im.setMatrixAt(i, ZERO4); im.setColorAt(i, BLACK); }
        continue;
      }
      p.zero = false;
      const u = p.kind === 1 ? 0 : Math.min(1, p.age / p.life);
      const f = (1 - u) * (1 - u), sc = p.size * (0.5 + 0.5 * (1 - u));
      C.copy(p.col).multiplyScalar(f * p.boost);
      V.set(p.x, p.y, p.z); S.set(sc, sc, sc);
      M4.compose(V, idQ, S);
      im.setMatrixAt(i, M4);
      im.setColorAt(i, C);
    }
    while (hi > 0 && !parts[hi - 1].on) hi--;
    im.count = hi;
    useRange(im.instanceMatrix, hi);
    if (im.instanceColor) useRange(im.instanceColor, hi);
  }

  return {
    root,
    launch,
    show,
    update,
    alive: () => live > 0 || pending.length > 0,
    dispose() {
      disposeTree(root);
    },
  };
}

export function previewFireworks(THREE, ctx) {
  const e = makeFireworks(THREE, ctx);
  let fired = false;
  return {
    root: e.root,
    update(dt, t) {
      if (!fired) {
        fired = true;
        e.launch(-2.4, 4.2, 0xff4d6d);
        e.launch(2.3, 4.7, 0x4cc9f0);
        e.launch(0.2, 3.6, 0xffd23f);
        e.show(8, 8);
      }
      e.update(dt, t);
    },
    dispose() { e.dispose(); },
  };
}

// =====================================================================================
// Shockwave emitter
// An expanding glowing ring on the floor plus a vertical flash at the impact point. ring(pos, color, maxR)
// reuses a small fixed pool of slots, so nothing is allocated per hit.
// =====================================================================================
export function makeShockwave(THREE, ctx) {
  const SLOTS = 8, DUR = 0.7;
  const root = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(0.8, 1, 72);
  ringGeo.rotateX(-Math.PI / 2); // lies on the floor, normal up
  const flashGeo = new THREE.PlaneGeometry(1, 1);
  const glowTex = ctx.canvasTex(64, 64, glowDraw);
  const slots = [];
  for (let i = 0; i < SLOTS; i++) {
    const rm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const fm = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, rm);
    ring.visible = false;
    root.add(ring);
    const flash = new THREE.Mesh(flashGeo, fm);
    flash.visible = false;
    root.add(flash);
    slots.push({ ring, flash, rm, fm, t: -1, pos: new THREE.Vector3(), maxR: 2.5 });
  }
  const WHITE = new THREE.Color(0xffffff);

  function ring(pos = [0, 0, 0], color = 0xffffff, maxR = 2.5) {
    const [x, y, z] = vec3(pos);
    let s = slots.find((q) => q.t < 0);
    if (!s) s = slots.reduce((a, b) => (a.t > b.t ? a : b)); // all busy: take the oldest
    s.t = 0;
    s.pos.set(x, y, z);
    s.maxR = maxR;
    s.rm.color.set(color);
    s.fm.color.set(color).lerp(WHITE, 0.5);
    s.ring.visible = true;
    s.flash.visible = true;
  }

  function update(dt) {
    const h = stepOf(dt);
    for (const s of slots) {
      if (s.t < 0) continue;
      s.t += h;
      const u = Math.min(1, s.t / DUR);
      const r = Math.max(0.05, s.maxR * (1 - Math.pow(1 - u, 3)));
      s.ring.position.set(s.pos.x, 0.012, s.pos.z);
      s.ring.scale.set(r, 1, r);
      s.rm.opacity = 0.95 * Math.pow(1 - u, 1.5);
      const fu = Math.min(1, s.t / 0.35);
      const fs = s.maxR * 0.9 * (0.35 + 0.9 * fu);
      s.flash.position.set(s.pos.x, s.pos.y + fs * 0.5, s.pos.z);
      s.flash.scale.set(fs, fs, 1);
      s.fm.opacity = Math.pow(1 - fu, 2);
      if (s.t >= DUR) { s.t = -1; s.ring.visible = false; s.flash.visible = false; }
    }
  }

  return {
    root,
    ring,
    update,
    alive: () => slots.some((s) => s.t >= 0),
    dispose() {
      disposeTree(root);
    },
  };
}

export function previewShockwave(THREE, ctx) {
  const e = makeShockwave(THREE, ctx);
  let fired = false;
  return {
    root: e.root,
    update(dt, t) {
      if (!fired) { fired = true; e.ring([0, 0, 0], 0x4cc9f0, 3.2); }
      e.update(dt, t);
    },
    dispose() { e.dispose(); },
  };
}

// =====================================================================================
// Hearts / chat-hype emitter
// Sprites (heart, fire, POG, 100, star), one pooled InstancedMesh per kind. burst(pos, n, kinds) puts n
// sprites at pos, cycling through the kinds. Each one pops in, drifts up with a sway, and shrinks away.
// =====================================================================================
export function makeHearts(THREE, ctx) {
  const MAX = 140;
  const root = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1);
  const DRAW = { heart: drawHeart, fire: drawFire, pog: drawPog, hundred: drawHundred, star: drawStar };
  const K = {};
  let live = 0;
  for (const name of Object.keys(DRAW)) {
    const tex = ctx.canvasTex(128, 128, DRAW[name]);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(geo, mat, MAX);
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    root.add(im);
    const parts = [];
    for (let i = 0; i < MAX; i++) {
      parts.push({ on: false, zero: false, x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, age: 0, life: 1, size: 0.3, amp: 0.2, freq: 2, ph: 0 });
    }
    K[name] = { im, mat, tex, parts, cursor: 0, hi: 0 };
  }
  const E = new THREE.Euler(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), M4 = new THREE.Matrix4();
  const ZERO4 = new THREE.Matrix4().makeScale(0, 0, 0);

  function spawn(name, x, y, z) {
    const k = K[name];
    const i = k.cursor; k.cursor = (k.cursor + 1) % MAX;
    const p = k.parts[i];
    if (!p.on) live++;
    p.on = true;
    p.x0 = x; p.y0 = y; p.z0 = z;
    p.vy = rnd(0.9, 1.6); p.vx = rnd(-0.15, 0.15);
    p.age = 0; p.life = rnd(1.8, 2.6); p.size = rnd(0.26, 0.36);
    p.amp = rnd(0.12, 0.3); p.freq = rnd(1.8, 3.2); p.ph = rnd(0, TAU);
    if (i + 1 > k.hi) k.hi = i + 1;
  }

  function burst(pos = [0, 0, 0], n = 24, kinds = ['heart']) {
    const [x, y, z] = vec3(pos);
    const list = (Array.isArray(kinds) ? kinds : [kinds]).filter((s) => Object.prototype.hasOwnProperty.call(K, s));
    const use = list.length ? list : ['heart'];
    for (let i = 0; i < n; i++) spawn(use[i % use.length], x + rnd(-0.35, 0.35), y + rnd(-0.1, 0.15), z + rnd(-0.1, 0.1));
  }

  function update(dt) {
    const h = stepOf(dt);
    if (!live) { for (const name of Object.keys(K)) K[name].im.count = 0; return; }
    for (const name of Object.keys(K)) {
      const k = K[name];
      for (let i = 0; i < k.hi; i++) {
        const p = k.parts[i];
        if (p.on) {
          p.age += h;
          if (p.age >= p.life) { p.on = false; live--; }
        }
        if (!p.on) {                     // dead: zero matrix written once, then skipped
          if (!p.zero) { p.zero = true; k.im.setMatrixAt(i, ZERO4); }
          continue;
        }
        p.zero = false;
        const u = p.age / p.life;
        let env;
        if (u < 0.12) env = (u / 0.12) * 1.15;
        else if (u < 0.2) env = 1.15 - 0.15 * ((u - 0.12) / 0.08);
        else if (u < 0.7) env = 1;
        else env = Math.max(0, (1 - u) / 0.3);
        const sc = p.size * env;
        const X = p.x0 + p.vx * p.age + Math.sin(p.age * p.freq + p.ph) * p.amp;
        const Y = p.y0 + p.vy * p.age, Z = p.z0;
        const rz = Math.sin(p.age * 1.6 + p.ph) * 0.3;
        E.set(0, 0, rz); Q.setFromEuler(E);
        V.set(X, Y, Z); S.set(sc, sc, sc);
        M4.compose(V, Q, S);
        k.im.setMatrixAt(i, M4);
      }
      while (k.hi > 0 && !k.parts[k.hi - 1].on) k.hi--;
      k.im.count = k.hi;
      useRange(k.im.instanceMatrix, k.hi);
    }
  }

  return {
    root,
    burst,
    update,
    alive: () => live > 0,
    dispose() {
      disposeTree(root);
    },
  };
}

// Sprite faces (128 x 128)
function drawHeart(g) {
  g.beginPath();
  g.moveTo(64, 116);
  g.bezierCurveTo(12, 82, 4, 44, 24, 24);
  g.bezierCurveTo(40, 10, 60, 20, 64, 40);
  g.bezierCurveTo(68, 20, 88, 10, 104, 24);
  g.bezierCurveTo(124, 44, 116, 82, 64, 116);
  g.closePath();
  const gr = g.createLinearGradient(0, 20, 0, 116);
  gr.addColorStop(0, '#ff6b8b'); gr.addColorStop(1, '#d3134f');
  g.fillStyle = gr; g.fill();
  g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = '#5a0a24'; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.ellipse(44, 42, 10, 6, -0.6, 0, TAU); g.fill();
}

function drawFire(g) {
  const flame = () => {
    g.beginPath();
    g.moveTo(64, 6);
    g.bezierCurveTo(92, 38, 112, 62, 106, 92);
    g.bezierCurveTo(102, 118, 82, 124, 64, 124);
    g.bezierCurveTo(44, 124, 24, 116, 22, 90);
    g.bezierCurveTo(20, 66, 40, 54, 46, 30);
    g.bezierCurveTo(54, 44, 56, 50, 60, 56);
    g.bezierCurveTo(58, 36, 58, 20, 64, 6);
    g.closePath();
  };
  flame();
  const gr = g.createLinearGradient(0, 6, 0, 124);
  gr.addColorStop(0, '#ffb020'); gr.addColorStop(1, '#ff3d1f');
  g.fillStyle = gr; g.fill();
  g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = '#7a1d05'; g.stroke();
  g.fillStyle = '#fff27a';
  g.beginPath(); g.ellipse(64, 96, 20, 24, 0, 0, TAU); g.fill();
}

function drawPog(g) {
  rr(g, 6, 34, 116, 60, 14);
  g.fillStyle = '#1c2350'; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#0a0c1e'; g.stroke();
  g.font = FONT(50); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = '#0a0c1e'; g.strokeText('POG', 64, 66);
  g.fillStyle = '#ffd23f'; g.fillText('POG', 64, 66);
}

function drawHundred(g) {
  g.beginPath(); g.arc(64, 64, 56, 0, TAU);
  g.fillStyle = '#ff3b3b'; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#5a0a0a'; g.stroke();
  g.font = FONT(46); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 9; g.strokeStyle = '#5a0a0a'; g.strokeText('100', 64, 66);
  g.fillStyle = '#ffffff'; g.fillText('100', 64, 66);
}

function drawStar(g) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 26 : 56;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = 64 + Math.cos(a) * r, y = 66 + Math.sin(a) * r;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fillStyle = '#ffd23f'; g.fill();
  g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = '#7a4a00'; g.stroke();
}

export function previewHearts(THREE, ctx) {
  const e = makeHearts(THREE, ctx);
  let fired = false;
  return {
    root: e.root,
    update(dt, t) {
      if (!fired) { fired = true; e.burst([0, 0.3, 0], 30, ['heart', 'fire', 'pog', 'hundred', 'star']); }
      e.update(dt, t);
    },
    dispose() { e.dispose(); },
  };
}
