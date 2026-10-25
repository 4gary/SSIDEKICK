// Cosy streamer corner desk, cartoon style. Origin on the floor at the desk centre, front faces +z.
// Gary sits BEHIND the desk (spot z -0.5) facing the camera. The monitor sits off to his right and is
// angled toward him, so the viewer sees it at a glancing angle and his face stays clear of it.
// The screen is an emissive canvas; the desk lamp is the one PointLight.

export function build(THREE, ctx) {
  const { mesh, group, canvasTex } = ctx;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const bounce = (v, max) => { const p = ((v % (2 * max)) + 2 * max) % (2 * max); return p < max ? p : 2 * max - p; };

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

  // Canvas helper: rounded rectangle path
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  const TOP = 0.72;                                        // desk top surface
  const CX = -0.1, CZ = -0.55;                             // chair / Gary's seat centre
  const lowSphere = new THREE.SphereGeometry(1, 14, 10);   // cheap blob for leaves and the bulb (ctx.sphere is high-res)

  // ---------- materials ----------
  const mats = [];
  const M = (p) => { const m = new THREE.MeshStandardMaterial(p); mats.push(m); return m; };
  const deskMat = M({ color: 0x3e3d7a, roughness: 0.75 });         // plum-navy body
  const chairMat = M({ color: 0x33384a, roughness: 0.6 });         // charcoal gaming chair
  const chairAccMat = M({ color: 0x2c8d84, roughness: 0.6 });      // teal accent (matches the couch)
  const chairDarkMat = M({ color: 0x1d2028, roughness: 0.5 });     // base, casters
  const kbTrayMat = M({ color: 0x23252f, roughness: 0.6 });
  const keyMat = M({ color: 0xf1ead8, roughness: 0.5 });
  const keyAccMat = M({ color: 0x2c8d84, roughness: 0.5 });
  const padMat = M({ color: 0xf07b5a, roughness: 0.8 });
  const mouseMat = M({ color: 0x2a2d38, roughness: 0.4 });
  const bezelMat = M({ color: 0x23262f, roughness: 0.5 });
  const backPlateMat = M({ color: 0x17191f, roughness: 0.6 });
  const standMat = M({ color: 0x2e323c, roughness: 0.5 });
  const lampMat = M({ color: 0xf0a83c, roughness: 0.45 });
  const shadeMat = M({ color: 0xe8603c, roughness: 0.6, side: THREE.DoubleSide });
  const bulbMat = M({ color: 0xffe2b0, emissive: 0xffb869, emissiveIntensity: 0.6, roughness: 0.4 });
  const potMat = M({ color: 0xd9734a, roughness: 0.7 });
  const leafMat = M({ color: 0x4f9d5a, roughness: 0.8 });
  const leafMat2 = M({ color: 0x6bb36f, roughness: 0.8 });
  const canMat = M({ color: 0x3a9bd9, roughness: 0.35, metalness: 0.2 });
  const silverMat = M({ color: 0xc9ced6, roughness: 0.35, metalness: 0.6 });
  const coffeeMat = M({ color: 0x4a2c1d, roughness: 0.4 });

  // ---------- canvas art ----------
  const woodTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b97f4c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const y0 = (i * h) / 4;
      g.fillStyle = '#a46d3d'; g.fillRect(0, y0, w, 3);
      g.strokeStyle = 'rgba(110,62,30,0.22)'; g.lineWidth = 1.5;
      for (let k = 0; k < 5; k++) {
        const y = y0 + 12 + k * 9;
        g.beginPath();
        for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i * 2 + k) * 2);
        g.stroke();
      }
    }
  });
  const woodMat = M({ map: woodTex, roughness: 0.55 });

  // Modesty panel sticker: "DUM" plus a little gamepad, drawn on the panel's +z face
  const stickerTex = canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#3e3d7a'; g.fillRect(0, 0, w, h);
    rr(g, 18, 14, 220, 68, 22); g.fillStyle = '#f6efe0'; g.fill();
    g.fillStyle = '#2a2960'; g.font = 'bold 46px Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DUM', 110, 50);
    rr(g, 180, 36, 42, 26, 11); g.fillStyle = '#e8603c'; g.fill();
    g.fillStyle = '#f6efe0'; g.fillRect(186, 46, 12, 4); g.fillRect(190, 42, 4, 12);
    g.beginPath(); g.arc(212, 44, 3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(216, 50, 3, 0, Math.PI * 2); g.fill();
    g.textBaseline = 'alphabetic';
  });
  const stickerMat = M({ map: stickerTex, roughness: 0.7 });

  // Mug side: cream with a teal and red stripe
  const mugTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#f6f1e6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2c8d84'; g.fillRect(0, h * 0.38, w, h * 0.14);
    g.fillStyle = '#d8402e'; g.fillRect(0, h * 0.54, w, h * 0.07);
  });
  const mugMat = M({ map: mugTex, roughness: 0.5 });

  // ---------- screen: live chat, dim screensaver, or sleepy zzz ----------
  const CHAT = [
    ['pixelpam', '#f08a5d', 'that jump was clean'],
    ['mochi_ranger', '#7bc4a4', 'gg gg gg'],
    ['tinyboss', '#f2c14e', 'DUM DUM DUM'],
    ['sleepy_otter', '#9aa8e0', 'chat is he ok?'],
    ['kira.exe', '#e98fb5', 'LMAO the cap'],
    ['noodle', '#5fb0d8', 'drink water gary'],
    ['buttons', '#f08a5d', 'POG'],
    ['zen_dave', '#7bc4a4', 'hi from osaka'],
  ];

  function drawScreen(g, mode, t) {
    const W = 256, H = 160;
    if (mode === 'live') {
      // Game view (left): sky, hills, scrolling ground and a hopping mini Gary
      const sky = g.createLinearGradient(0, 0, 0, 118);
      sky.addColorStop(0, '#5fb8e6'); sky.addColorStop(1, '#c4e9f8');
      g.fillStyle = sky; g.fillRect(0, 0, 152, 118);
      g.fillStyle = '#ffd968'; g.beginPath(); g.arc(124, 30, 12, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4f9d76';
      g.beginPath(); g.moveTo(0, 92); g.lineTo(36, 64); g.lineTo(78, 94); g.lineTo(116, 70);
      g.lineTo(152, 90); g.lineTo(152, 118); g.lineTo(0, 118); g.closePath(); g.fill();
      g.fillStyle = '#58b368'; g.fillRect(0, 104, 152, 14);
      g.fillStyle = '#3f8f52';
      const sc = (t * 40) % 20;
      for (let x = -sc; x < 152; x += 20) g.fillRect(x, 110, 10, 3);
      const hop = Math.abs(Math.sin(t * 7)) * 10;
      g.fillStyle = '#3aa69b'; g.fillRect(46, 90 - hop, 12, 12);
      g.fillStyle = '#e9b48f'; g.beginPath(); g.arc(52, 84 - hop, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d8111a'; g.beginPath(); g.arc(52, 83 - hop, 7.5, Math.PI, 0); g.fill();
      // HUD
      g.fillStyle = '#e5484d'; g.fillRect(6, 6, 34, 13);
      g.fillStyle = '#ffffff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('LIVE', 23, 13);
      g.textAlign = 'right'; g.font = 'bold 8px sans-serif'; g.fillText('1.2K watching', 146, 13);
      g.textBaseline = 'alphabetic';
      // Event bar under the game
      g.fillStyle = '#2b2542'; g.fillRect(0, 118, 152, 42);
      g.textAlign = 'left'; g.font = 'bold 8px sans-serif';
      g.fillStyle = '#f2b632'; g.fillText('NEW SUB  kira.exe', 8, 131);
      g.fillStyle = '#3d3558'; g.fillRect(8, 139, 136, 6);
      g.fillStyle = '#7bc4a4'; g.fillRect(8, 139, 136 * ((t * 0.08) % 1), 6);
      g.fillStyle = '#cfc6ff'; g.fillText('SCORE 1337', 8, 154);
      // Chat column (right), scrolling
      g.fillStyle = '#221e36'; g.fillRect(152, 0, 104, H);
      g.save(); g.beginPath(); g.rect(152, 18, 104, 142); g.clip();
      const LH = 20, scroll = t * 12, base = Math.floor(scroll / LH), off = scroll % LH;
      for (let i = 0; i < 8; i++) {
        const m = CHAT[(base + i) % CHAT.length];
        const y = 30 + i * LH - off;
        g.font = 'bold 8px sans-serif'; g.fillStyle = m[1]; g.fillText(m[0], 156, y);
        g.font = '8px sans-serif'; g.fillStyle = '#e8e4f5'; g.fillText(m[2], 156, y + 9);
      }
      g.restore();
      g.fillStyle = '#2e2848'; g.fillRect(152, 0, 104, 18);
      g.fillStyle = '#cfc6ff'; g.font = 'bold 8px sans-serif'; g.textAlign = 'left'; g.fillText('CHAT', 158, 12);
    } else if (mode === 'sleep') {
      // Dim bouncing "zzz"
      g.fillStyle = '#07060c'; g.fillRect(0, 0, W, H);
      g.textAlign = 'left';
      for (let k = 0; k < 3; k++) {
        const size = 14 + k * 8;
        const x = 10 + bounce(t * 22 + k * 50, W - 50);
        const y = size + bounce(t * 16 + k * 30, H - size - 6);
        g.font = `bold ${size}px sans-serif`; g.fillStyle = `rgba(120,140,210,${0.4 + k * 0.2})`;
        g.fillText('z', x, y);
      }
    } else {
      // Idle: dim bouncing DUM logo
      g.fillStyle = '#0c1424'; g.fillRect(0, 0, W, H);
      g.textAlign = 'left';
      const x = 4 + bounce(t * 26, W - 70), y = 30 + bounce(t * 18, H - 44);
      g.font = 'bold 30px sans-serif'; g.fillStyle = '#7d6a3a'; g.fillText('DUM', x, y);
      g.font = '8px sans-serif'; g.fillStyle = '#4a5a7a'; g.fillText('be right back', 8, H - 8);
    }
  }

  const screenTex = canvasTex(256, 160, (g) => drawScreen(g, 'idle', 0));
  const screenCtx = screenTex.userData.ctx;
  const screenMat = M({ map: screenTex, emissiveMap: screenTex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.35 });

  const root = new THREE.Group();

  // ---------- desk ----------
  // Top slab: top surface at TOP. Face index 2 (+y) carries the wood canvas.
  mesh(rbox(1.5, 0.06, 0.6, 0.025, 6), [deskMat, deskMat, woodMat, deskMat, deskMat, deskMat], root, [0, TOP - 0.03, 0]);
  // Chunky side panels down to the floor
  for (const x of [-0.7, 0.7]) mesh(rbox(0.07, 0.66, 0.56, 0.03, 4), deskMat, root, [x, 0.33, 0]);
  // Front modesty panel with the DUM sticker on its +z face
  mesh(rbox(1.36, 0.46, 0.04, 0.02, 4), [deskMat, deskMat, deskMat, deskMat, stickerMat, deskMat], root, [0, 0.4, 0.27]);

  // ---------- keyboard and mouse ----------
  const KB_X = CX, KB_Z = 0.05;
  mesh(rbox(0.48, 0.026, 0.18, 0.012, 4), kbTrayMat, root, [KB_X, TOP + 0.013, KB_Z]);
  const keyGeo = rbox(0.036, 0.016, 0.032, 0.007, 2);
  const keys = [];
  const KEY_Y = TOP + 0.034;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 10; col++) {
      const idx = row * 10 + col;
      const accent = idx === 12 || idx === 21 || idx === 22 || idx === 23; // W A S D
      const m = mesh(keyGeo, accent ? keyAccMat : keyMat, root,
        [KB_X + (col - 4.5) * 0.043, KEY_Y, KB_Z + (row - 1.5) * 0.04]);
      keys.push(m);
    }
  }
  mesh(rbox(0.18, 0.006, 0.16, 0.02, 2), padMat, root, [0.26, TOP + 0.003, 0.1]);          // mouse pad
  mesh(rbox(0.065, 0.028, 0.1, 0.03, 4), mouseMat, root, [0.26, TOP + 0.02, 0.1]);          // mouse

  // ---------- monitor: off to the right, angled toward Gary ----------
  const MON_X = 0.5, MON_Z = -0.02, MON_YAW = -1.0;
  const mon = group(root, [MON_X, TOP, MON_Z]);
  mon.rotation.y = MON_YAW;
  mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.025, 18), standMat, mon, [0, 0.0125, 0]);   // foot
  mesh(rbox(0.04, 0.22, 0.03, 0.012, 3), standMat, mon, [0, 0.135, -0.03]);                // neck
  mesh(rbox(0.6, 0.38, 0.05, 0.03, 6), [bezelMat, bezelMat, bezelMat, bezelMat, bezelMat, backPlateMat], mon, [0, 0.33, 0]);
  mesh(new THREE.PlaneGeometry(0.54, 0.34), screenMat, mon, [0, 0.33, 0.0265]);

  // ---------- desk lamp at the back-left, warm glow (the one PointLight) ----------
  const lamp = group(root, [-0.62, TOP, -0.22]);
  mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.025, 18), lampMat, lamp, [0, 0.0125, 0]);
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8), lampMat, lamp, [0, 0.235, 0]);
  const lampHead = group(lamp, [0, 0.46, 0]);
  lampHead.rotation.x = -0.4;                                    // shade tips forward over the desk
  mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.13, 18, 1, true), shadeMat, lampHead, [0, -0.04, 0]);
  mesh(lowSphere, bulbMat, lampHead, [0, -0.07, 0], [0.035, 0.035, 0.035]);
  const lampLight = new THREE.PointLight(0xffb868, 0.4, 1.6, 2);
  lampLight.position.set(0, -0.09, 0);
  lampHead.add(lampLight);

  // ---------- coffee mug (own group, moved by the app through anchors / mug) ----------
  const mug = group(root, [-0.55, TOP, 0.1]);
  mesh(new THREE.CylinderGeometry(0.05, 0.044, 0.11, 18), [mugMat, coffeeMat, mugMat], mug, [0, 0.055, 0]);
  mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 14, Math.PI), mugMat, mug, [0.045, 0.06, 0], [1, 1, 1], [0, 0, -Math.PI / 2]);

  // ---------- energy drink can and potted plant ----------
  mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.1, 14), [canMat, silverMat, silverMat], root, [-0.4, TOP + 0.05, 0.23]);
  const plant = group(root, [0.67, TOP, -0.2]);
  mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.1, 16), potMat, plant, [0, 0.05, 0]);
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 16), coffeeMat, plant, [0, 0.1, 0]);
  const leafSpecs = [
    [0, 0.2, 0, 0.075, 0.12, 0.06, 0, 0, leafMat],
    [-0.06, 0.16, 0.02, 0.06, 0.1, 0.05, 0, 0.45, leafMat2],
    [0.06, 0.16, -0.02, 0.065, 0.11, 0.05, 0, -0.45, leafMat2],
    [0.0, 0.18, 0.06, 0.06, 0.1, 0.05, 0.4, 0, leafMat],
  ];
  for (const [x, y, z, sx, sy, sz, rx, rz, m] of leafSpecs) mesh(lowSphere, m, plant, [x, y, z], [sx, sy, sz], [rx, 0, rz]);

  // ---------- gaming chair behind the desk ----------
  // Seat pan: top at y 0.48 under Gary's hips
  mesh(rbox(0.56, 0.1, 0.5, 0.04, 6), [chairMat, chairMat, chairAccMat, chairMat, chairMat, chairMat], root, [CX, 0.43, CZ]);
  // Backrest: leans back ~0.12 rad, front face just behind Gary's back; top at ~1.24
  const chairBack = group(root, [CX, 0.48, -0.82]);
  chairBack.rotation.x = -0.12;
  mesh(rbox(0.54, 0.76, 0.1, 0.05, 6), [chairMat, chairMat, chairAccMat, chairMat, chairMat, chairMat], chairBack, [0, 0.38, -0.05]);
  // Armrests on short posts
  for (const x of [CX - 0.42, CX + 0.42]) {
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), chairDarkMat, root, [x, 0.53, CZ]);
    mesh(rbox(0.05, 0.03, 0.3, 0.012, 3), chairMat, root, [x, 0.615, CZ - 0.02]);
  }
  // Gas lift, hub and five-star base on casters
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.31, 10), chairDarkMat, root, [CX, 0.205, CZ]);
  mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 18), chairDarkMat, root, [CX, 0.035, CZ]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    mesh(rbox(0.26, 0.03, 0.05, 0.012, 2), chairDarkMat, root, [CX + dx * 0.12, 0.03, CZ + dz * 0.12], [1, 1, 1], [0, -a, 0]);
    mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.026, 10), chairDarkMat, root,
      [CX + dx * 0.25, 0.026, CZ + dz * 0.25], [1, 1, 1], [0, 0, Math.PI / 2]);
  }

  // ---------- anchors ----------
  const anchors = {
    keyboard: new THREE.Vector3(KB_X, KEY_Y + 0.008, KB_Z),   // top centre of the keyboard
    mouse: new THREE.Vector3(0.26, TOP + 0.034, 0.1),         // top of the mouse
    mugRest: new THREE.Vector3(-0.55, TOP, 0.1),              // where the mug sits
  };

  // ---------- animation state ----------
  let mode = '', scrAcc = 0, emis = 0.35, lampLvl = 0.4;
  const typeAmt = keys.map(() => 0);

  return {
    root,
    spots: { use: { x: -0.1, y: 0.48, z: -0.5, yaw: 0, pose: 'sit' } },
    anchors,
    mug,
    update(dt, t, st) {
      const h = clamp(dt || 1 / 60, 0, 0.1);
      const asleep = !!(st && st.asleep), active = !!(st && st.active), typing = !!(st && st.typing);
      const next = asleep ? 'sleep' : active ? 'live' : 'idle';
      const goalEmis = next === 'live' ? 1.0 : next === 'idle' ? 0.35 : 0.12;
      const goalLamp = next === 'live' ? 0.6 : next === 'idle' ? 0.35 : 0.1;
      const k = 1 - Math.exp(-h * 6);
      emis += (goalEmis - emis) * k;
      lampLvl += (goalLamp - lampLvl) * k;
      screenMat.emissiveIntensity = emis;
      lampLight.intensity = lampLvl;
      bulbMat.emissiveIntensity = 0.3 + lampLvl * 1.2;

      // Redraw the screen at most ~10 fps (immediately when the mode changes)
      scrAcc += h;
      if (next !== mode || scrAcc >= 0.1) {
        scrAcc = 0; mode = next;
        drawScreen(screenCtx, mode, t);
        screenTex.needsUpdate = true;
      }

      // A few keys press down while typing
      for (let i = 0; i < keys.length; i++) {
        const press = typing && Math.sin(t * 11 + i * 2.3) * Math.sin(t * 5.1 + i) > 0.55 ? 1 : 0;
        typeAmt[i] += (press - typeAmt[i]) * (1 - Math.exp(-h * 30));
        keys[i].position.y = KEY_Y - 0.005 * typeAmt[i];
      }
    },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      lowSphere.dispose();
      for (const m of mats) m.dispose();
      for (const tx of [woodTex, stickerTex, mugTex, screenTex]) tx.dispose();
    },
  };
}
