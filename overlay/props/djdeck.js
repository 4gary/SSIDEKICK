// DJ booth prop for Gary: a chunky two-deck table with a mixer in the middle,
// an emissive equaliser front panel and a row of LEDs. Also exports DJ headphones.
// Units: Gary is ~2.5 tall, table top at y 0.82, FRONT faces +z.

import { rr } from './common.js';

const TAU = Math.PI * 2;
const SPIN = (33 * TAU) / 60; // 33 rpm in rad/s

// Rounded box: an ExtrudeGeometry with bevels, centred on the origin.
function roundedBoxGeo(THREE, w, h, d, r) {
  const hw = w / 2 - r, hd = d / 2 - r, c = 0.012;
  const s = new THREE.Shape();
  s.moveTo(-hw + c, -hd);
  s.lineTo(hw - c, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + c);
  s.lineTo(hw, hd - c);
  s.quadraticCurveTo(hw, hd, hw - c, hd);
  s.lineTo(-hw + c, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - c);
  s.lineTo(-hw, -hd + c);
  s.quadraticCurveTo(-hw, -hd, -hw + c, -hd);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, h - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r,
    bevelOffset: 0, bevelSegments: 3, curveSegments: 3, steps: 1,
  });
  g.rotateX(-Math.PI / 2); // extrusion axis z -> y
  g.computeBoundingBox();
  const c2 = new THREE.Vector3();
  g.boundingBox.getCenter(c2);
  g.translate(-c2.x, -c2.y, -c2.z);
  return g;
}

const TEAL = [46, 211, 192], YEL = [255, 211, 77], PINK = [255, 95, 162];
function mix3(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
function eqColour(f) {
  const c = f < 0.5 ? mix3(TEAL, YEL, f * 2) : mix3(YEL, PINK, (f - 0.5) * 2);
  return `rgb(${c.map(Math.round).join(",")})`;
}

const PW = 768, PH = 288; // front panel canvas (aspect matches the plane)

function drawLabel(g, w, h, colour) {
  const cx = w / 2, cy = h / 2, R = w / 2;
  g.fillStyle = "#101015";
  g.fillRect(0, 0, w, h);
  g.lineWidth = 1.2;
  let i = 0;
  for (let r = 0.36 * R; r < 0.97 * R; r += 3.2, i++) {
    g.strokeStyle = i % 2 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.55)";
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
  }
  g.fillStyle = colour;
  g.beginPath(); g.arc(cx, cy, 0.42 * R, 0, TAU); g.fill();
  g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, 0.36 * R, 0, TAU); g.stroke();
  // white marker bar from the label to the rim, so the spin reads clearly
  g.strokeStyle = "#ffffff"; g.lineWidth = 0.035 * R; g.lineCap = "round";
  g.beginPath(); g.moveTo(cx + 0.46 * R, cy); g.lineTo(cx + 0.9 * R, cy); g.stroke();
  g.fillStyle = "#ffffff";
  g.beginPath(); g.arc(cx + 0.24 * R, cy, 0.035 * R, 0, TAU); g.fill();
  g.fillStyle = "#101015";
  g.beginPath(); g.arc(cx, cy, 0.05 * R, 0, TAU); g.fill();
}

export function build(THREE, ctx) {
  const { mesh, group, canvasTex } = ctx;
  const geos = [], mats = [], texs = [];
  const geo = (g) => { geos.push(g); return g; };
  const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };
  const box = (w, h, d, r) => geo(roundedBoxGeo(THREE, w, h, d, r));
  const cyl = (rt, rb, h, s = 32) => geo(new THREE.CylinderGeometry(rt, rb, h, s));
  const tex = (w, h, draw) => { const t = canvasTex(w, h, draw); texs.push(t); return t; };

  const root = new THREE.Group();
  const M = {
    body: mat({ color: 0x2f2a66, roughness: 0.6 }),
    rubber: mat({ color: 0x15132b, roughness: 0.8 }),
    plinth: mat({ color: 0x27244a, roughness: 0.5 }),
    steel: mat({ color: 0xc3c9d6, roughness: 0.28, metalness: 0.7 }),
    chrome: mat({ color: 0xe6ebf5, roughness: 0.2, metalness: 0.8 }),
    vinyl: mat({ color: 0x121218, roughness: 0.35 }),
    cream: mat({ color: 0xf0e7d6, roughness: 0.55 }),
    dark: mat({ color: 0x262238, roughness: 0.7 }),
    knob: mat({ color: 0x3a3658, roughness: 0.4 }),
    orange: mat({ color: 0xff8a3d, roughness: 0.45 }),
    pink: mat({ color: 0xff5fa2, roughness: 0.45 }),
    teal: mat({ color: 0x2ed3c0, roughness: 0.45 }),
    yellow: mat({ color: 0xffd34d, roughness: 0.45 }),
    white: mat({ color: 0xf4f4f8, roughness: 0.4 }),
  };
  const ledGeo = geo(new THREE.SphereGeometry(1, 12, 8));

  // ---- table body: top surface at y 0.82, 1.3 wide, 0.42 deep ----
  mesh(box(1.3, 0.76, 0.42, 0.035), M.body, root, [0, 0.44, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    mesh(cyl(0.05, 0.055, 0.06, 20), M.rubber, root, [sx * 0.56, 0.03, sz * 0.14]);

  // ---- front panel: emissive canvas (logo + equaliser) ----
  const bars = new Array(16).fill(0);
  function drawPanel(g, t, active, pulse) {
    g.clearRect(0, 0, PW, PH);
    rr(g, 4, 4, PW - 8, PH - 8, 40);
    const bg = g.createLinearGradient(0, 0, 0, PH);
    bg.addColorStop(0, "#3d2a80");
    bg.addColorStop(1, "#171236");
    g.fillStyle = bg;
    g.fill();
    rr(g, 4, 4, PW - 8, PH - 8, 40);
    g.lineWidth = 10; g.strokeStyle = "#ff5fa2"; g.stroke();

    // logo
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.shadowColor = "#ff5fa2"; g.shadowBlur = 18 + 24 * pulse;
    g.font = '900 150px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = "#ffe3f2";
    g.fillText("DJ", 48, 170);
    g.shadowBlur = 0;
    g.font = '800 46px "Arial Black", Arial, sans-serif';
    g.fillStyle = "#2ed3c0";
    g.fillText("GARY", 56, 226);

    // equaliser bars
    const x0 = 318, bw = 18, gap = 7, base = 246, maxH = 190;
    for (let i = 0; i < 16; i++) {
      let lv;
      if (active) lv = 0.18 + 0.82 * Math.abs(Math.sin(t * (3.1 + (i % 4) * 0.7) + i * 1.3)) * (0.7 + 0.3 * pulse);
      else lv = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.1 + i * 0.5));
      bars[i] += (lv - bars[i]) * 0.5;
      const h = Math.max(8, bars[i] * maxH);
      const x = x0 + i * (bw + gap), y = base - h, c = eqColour(i / 15);
      g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 10;
      g.beginPath();
      g.moveTo(x, base);
      g.lineTo(x, y + 6);
      g.arcTo(x, y, x + 6, y, 6);
      g.lineTo(x + bw - 6, y);
      g.arcTo(x + bw, y, x + bw, y + 6, 6);
      g.lineTo(x + bw, base);
      g.closePath();
      g.fill();
    }
    g.shadowBlur = 0;
  }
  const panelTex = tex(PW, PH, (g) => drawPanel(g, 0, false, 0));
  const panelMat = mat({ map: panelTex, emissiveMap: panelTex, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.5, alphaTest: 0.5 });
  const panel = mesh(geo(new THREE.PlaneGeometry(1.1, (1.1 * PH) / PW)), panelMat, root, [0, 0.43, 0.2115]);
  panel.castShadow = false;

  // ---- turntables ----
  // platter top at y 0.87 (plinth 0.82..0.86, steel 0.86..0.866, vinyl to 0.87)
  function deck(x, labelColour, side) {
    mesh(box(0.44, 0.04, 0.38, 0.012), M.plinth, root, [x, 0.84, 0]);

    // tonearm: pillar on the outer back corner, arm reaching toward the record
    const px = x + side * 0.19, pz = -0.14;
    mesh(cyl(0.035, 0.04, 0.06, 20), M.chrome, root, [px, 0.89, pz]);
    const arm = group(root, [px, 0.92, pz]);
    const ux = px - x, uz = pz, dl = Math.hypot(ux, uz);
    const ex = x + (ux / dl) * 0.1, ez = (uz / dl) * 0.1; // headshell over the record edge
    const vx = ex - px, vz = ez - pz, L = Math.hypot(vx, vz);
    arm.rotation.y = Math.atan2(vx, vz);
    mesh(geo(new THREE.BoxGeometry(0.016, 0.016, L)), M.chrome, arm, [0, 0, L / 2]);
    mesh(geo(new THREE.BoxGeometry(0.03, 0.022, 0.034)), M.dark, arm, [0, -0.004, L]);
    mesh(box(0.016, 0.014, 0.016, 0.004), labelColour === "#ff8a3d" ? M.orange : M.teal, arm, [0, -0.014, L]);
    mesh(cyl(0.018, 0.018, 0.04, 16), M.dark, arm, [0, 0, -0.02], [1, 1, 1], [Math.PI / 2, 0, 0]);

    // spinning platter group (origin at the plinth top, y 0.86)
    const spin = group(root, [x, 0.86, 0]);
    mesh(cyl(0.15, 0.15, 0.006, 48), M.steel, spin, [0, 0.003, 0]);
    mesh(geo(new THREE.TorusGeometry(0.15, 0.01, 10, 48)), M.chrome, spin, [0, 0.006, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    mesh(cyl(0.148, 0.148, 0.004, 48), M.vinyl, spin, [0, 0.008, 0]);
    const labelTex = tex(256, 256, (g, w, h) => drawLabel(g, w, h, labelColour));
    mesh(geo(new THREE.CircleGeometry(0.148, 48)), mat({ map: labelTex, roughness: 0.35 }), spin, [0, 0.0105, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]);
    mesh(cyl(0.012, 0.012, 0.012, 16), M.chrome, spin, [0, 0.012, 0]);
    return spin;
  }
  const spinL = deck(-0.36, "#ff8a3d", -1);
  const spinR = deck(0.36, "#2ed3c0", 1);

  // ---- mixer in the middle: body 0.82..0.88, top panel to 0.892 ----
  mesh(box(0.26, 0.06, 0.3, 0.02), M.cream, root, [0, 0.85, 0]);
  mesh(box(0.23, 0.012, 0.26, 0.004), M.dark, root, [0, 0.886, 0]);

  // row of 7 LEDs along the back edge
  const ledCols = [0xff5fa2, 0x2ed3c0, 0xffd34d];
  const leds = [];
  for (let i = 0; i < 7; i++) {
    const c = ledCols[i % 3];
    const lm = mat({ color: c, emissive: c, emissiveIntensity: 0.4, roughness: 0.3 });
    mesh(ledGeo, lm, root, [-0.105 + i * 0.035, 0.893, -0.1], [0.012, 0.012, 0.012]);
    leds.push(lm);
  }

  // four EQ knobs with coloured caps
  const knobCaps = [M.pink, M.teal, M.yellow, M.orange];
  const pointerRot = [0.4, -0.9, 0.2, 1.1];
  for (let i = 0; i < 4; i++) {
    const x = -0.1 + i * 0.0667;
    mesh(cyl(0.02, 0.022, 0.02, 20), M.knob, root, [x, 0.902, -0.05]);
    mesh(cyl(0.017, 0.017, 0.008, 20), knobCaps[i], root, [x, 0.916, -0.05]);
    mesh(geo(new THREE.BoxGeometry(0.004, 0.003, 0.011)), M.dark, root, [x, 0.9225, -0.05], [1, 1, 1], [0, pointerRot[i], 0]);
  }

  // two channel faders (slots along z)
  [-0.065, 0.065].forEach((x, i) => {
    mesh(geo(new THREE.BoxGeometry(0.012, 0.004, 0.1)), M.dark, root, [x, 0.894, 0]);
    mesh(box(0.026, 0.018, 0.012, 0.004), i ? M.teal : M.orange, root, [x, 0.904, i ? 0.02 : -0.01]);
  });

  // crossfader (slot along x, knob slides with the left scratch)
  mesh(geo(new THREE.BoxGeometry(0.18, 0.004, 0.012)), M.dark, root, [0, 0.894, 0.085]);
  const xfCap = mesh(box(0.028, 0.024, 0.034, 0.005), M.yellow, root, [0, 0.91, 0.085]);

  const anchors = {
    platterL: new THREE.Vector3(-0.36, 0.87, 0),
    platterR: new THREE.Vector3(0.36, 0.87, 0),
    mixer: new THREE.Vector3(0, 0.892, 0),
    faderX: new THREE.Vector3(0, 0.91, 0.085),
  };

  // ---- animation state ----
  let vel = 0, angL = 0, angR = 0, scr = 0, fx = 0, pAcc = 0;
  function update(dt, t, st) {
    dt = Math.min(dt, 0.1);
    const active = !!st.active;
    const beat = st.beat || 0;
    const pulse = active ? Math.pow(1 - beat, 3) : 0;

    // platters: spin up to 33 rpm, coast down slowly when inactive
    vel = active ? Math.min(SPIN, vel + dt * 4) : Math.max(0, vel - dt * 1.0);
    angL = (angL - vel * dt) % TAU;
    angR = (angR - vel * dt) % TAU;

    // scratch: back-and-forth offset on the left platter, only while active
    const sc = active ? Math.max(-1, Math.min(1, st.scratch || 0)) : 0;
    scr += (sc - scr) * Math.min(1, dt * 20);
    spinL.rotation.y = angL + scr * 0.7;
    spinR.rotation.y = angR;

    // crossfader follows the scratch
    fx += (sc * 0.06 - fx) * Math.min(1, dt * 15);
    xfCap.position.x = fx;
    anchors.faderX.x = fx;

    // LEDs chase on the beat when active, dim idle glow otherwise
    for (let i = 0; i < leds.length; i++) {
      leds[i].emissiveIntensity = active
        ? 0.4 + 1.8 * (0.5 + 0.5 * Math.sin(t * 9 + i * 1.1)) * (0.35 + 0.65 * pulse)
        : 0.3 + 0.1 * Math.sin(t * 1.3 + i * 0.7);
    }

    // front panel: pulses on the beat, redrawn at ~15 fps
    panelMat.emissiveIntensity = active ? 0.75 + 0.5 * pulse : 0.3;
    pAcc += dt;
    if (pAcc >= 1 / 15) {
      pAcc = 0;
      const pt = panelTex.userData.ctx;
      drawPanel(pt, t, active, pulse);
      panelTex.needsUpdate = true;
    }
  }

  function dispose() {
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    texs.forEach((t) => t.dispose());
  }

  return {
    root,
    spots: { use: { x: 0, y: 0, z: -0.52, yaw: 0, pose: "stand" } },
    anchors,
    update,
    dispose,
  };
}

// Chunky DJ headphones. Root origin = Gary's head centre (head radii 0.66 x 0.60 x 0.62).
// The headband is a circle of radius 0.86 centred 0.2 above the head centre, so it arcs
// over the cap (crown radius 0.8). Ear cups sit at x = ±0.68, y -0.05, facing ±x.
export function buildHeadphones(THREE, ctx) {
  const { mesh } = ctx;
  const root = new THREE.Group();
  const geos = [], mats = [];
  const g = (x) => { geos.push(x); return x; };
  const m = (o) => { const x = new THREE.MeshStandardMaterial(o); mats.push(x); return x; };
  const bandMat = m({ color: 0x23213f, roughness: 0.5 });
  const cupMat = m({ color: 0xff5fa2, roughness: 0.45 });
  const capMat = m({ color: 0x2ed3c0, roughness: 0.4 });

  // headband arc over the top, from just below the right ear to just below the left ear
  const arc = g(new THREE.TorusGeometry(0.86, 0.075, 16, 80, Math.PI + 0.44));
  arc.rotateZ(-0.22);
  mesh(arc, bandMat, root, [0, 0.2, 0]);

  for (const s of [-1, 1]) {
    const cupG = g(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 32));
    cupG.rotateZ(Math.PI / 2); // axis along x
    mesh(cupG, cupMat, root, [s * 0.68, -0.05, 0]);

    const capG = g(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 24));
    capG.rotateZ(Math.PI / 2);
    mesh(capG, capMat, root, [s * 0.775, -0.05, 0]);

    // yoke from the end of the band down to the top of the cup
    const a = new THREE.Vector3(s * 0.828, 0.012, 0), b = new THREE.Vector3(s * 0.7, 0.12, 0);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const yokeG = g(new THREE.CylinderGeometry(0.04, 0.04, len, 16));
    const yoke = mesh(yokeG, bandMat, root, [(a.x + b.x) / 2, (a.y + b.y) / 2, 0]);
    yoke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }

  return {
    root,
    dispose() { geos.forEach((x) => x.dispose()); mats.forEach((x) => x.dispose()); },
  };
}
