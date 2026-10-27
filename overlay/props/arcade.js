// Upright arcade cabinet "DUMSTREAM" (cartoon style). Front faces +z, origin on the floor at the centre.
import { star } from './common.js';

export function build(THREE, ctx) {
  const PI = Math.PI;
  const root = new THREE.Group();
  const clamp1 = (v) => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));

  // ---------- geometry helpers ----------
  // rounded-rectangle path, centred at (cx, cy)
  function rrPath(p, w, h, r, cx = 0, cy = 0) {
    r = Math.max(0.002, Math.min(r, w / 2, h / 2));
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    p.moveTo(x0 + r, y0);
    p.lineTo(x1 - r, y0); p.quadraticCurveTo(x1, y0, x1, y0 + r);
    p.lineTo(x1, y1 - r); p.quadraticCurveTo(x1, y1, x1 - r, y1);
    p.lineTo(x0 + r, y1); p.quadraticCurveTo(x0, y1, x0, y1 - r);
    p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0);
    return p;
  }
  // bevelled rounded slab: XY outline, extruded along Z, centred on the origin
  function slab(w, h, depth, r, bev = 0.015, hole = null) {
    const s = rrPath(new THREE.Shape(), w - 2 * bev, h - 2 * bev, r - bev);
    if (hole) s.holes.push(rrPath(new THREE.Path(), hole.w + 2 * bev, hole.h + 2 * bev, hole.r + bev, hole.x || 0, hole.y || 0));
    const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 6 });
    g.translate(0, 0, -(depth / 2 - bev));
    return g;
  }
  // same idea lying flat: w along X, d along Z, h up along Y
  const slabY = (w, d, h, r, bev = 0.015) => slab(w, d, h, r, bev).rotateX(-PI / 2);
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 24);

  // ---------- canvas art ----------
  function rrClip(g, w, h, r) {
    g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r);
    g.closePath(); g.clip();
  }
  // right side: red/navy/yellow diagonal stripes, navy band with stars
  function artRight(g, w, h) {
    g.save(); rrClip(g, w, h, 26);
    g.fillStyle = '#e63946'; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-0.5);
    for (let i = -16; i < 16; i++) { g.fillStyle = i & 1 ? '#ffd166' : '#1d3557'; g.fillRect(-w * 2, i * 40, w * 4, 40); }
    g.restore();
    g.fillStyle = '#e63946'; g.fillRect(0, h * 0.36, w, h * 0.28);
    g.lineWidth = 6; g.strokeStyle = '#1d3557';
    g.fillStyle = '#ffd166';
    star(g, w / 2, h * 0.2, 58, 24); g.fill(); g.stroke();
    star(g, w / 2, h * 0.8, 58, 24); g.fill(); g.stroke();
    g.fillStyle = '#fff8e7';
    for (const [x, y, s] of [[0.25, 0.46, 16], [0.72, 0.5, 14], [0.46, 0.6, 12]]) { star(g, x * w, y * h, s, s * 0.45); g.fill(); }
    g.restore();
  }
  // left side: teal sky, cream/orange bands and a big yellow lightning bolt
  function artLeft(g, w, h) {
    g.save(); rrClip(g, w, h, 26);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#2a9d8f'); bg.addColorStop(1, '#1d5f86');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#f4a261' : '#fef6e4';
      g.fillRect(0, i * 22, w, 22); g.fillRect(0, h - 88 + i * 22, w, 22);
    }
    const P = [[0.62, 0.07], [0.22, 0.56], [0.46, 0.56], [0.34, 0.93], [0.8, 0.42], [0.55, 0.42], [0.7, 0.07]];
    g.beginPath();
    P.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
    g.closePath(); g.lineJoin = 'round';
    g.strokeStyle = '#1d1b3a'; g.lineWidth = 16; g.stroke();
    g.fillStyle = '#ffd60a'; g.fill();
    g.fillStyle = '#ffffff';
    for (const [x, y, s] of [[0.2, 0.25, 10], [0.78, 0.2, 8], [0.3, 0.75, 8]]) { star(g, x * w, y * h, s, s * 0.45); g.fill(); }
    g.restore();
  }
  // marquee: red board, bulbs, big "DUMSTREAM" (emissive)
  function drawMarquee(g, w, h) {
    g.save(); rrClip(g, w, h, 24);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#e63946'); bg.addColorStop(1, '#a4161a');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffe066';
    for (let x = 14; x < w; x += 28) {
      g.beginPath(); g.arc(x, 9, 4, 0, PI * 2); g.fill();
      g.beginPath(); g.arc(x, h - 9, 4, 0, PI * 2); g.fill();
    }
    const font = (s) => `900 ${s}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
    let size = 96; g.font = font(size);
    while (g.measureText('DUMSTREAM').width > w - 56 && size > 24) { size -= 4; g.font = font(size); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = '#5a0a00';
    g.strokeText('DUMSTREAM', w / 2, h / 2 + 3);
    const tg = g.createLinearGradient(0, h * 0.2, 0, h * 0.85);
    tg.addColorStop(0, '#fffbe0'); tg.addColorStop(1, '#ffc300');
    g.fillStyle = tg; g.fillText('DUMSTREAM', w / 2, h / 2 + 3);
    g.restore();
  }
  // glass glare over the screen
  function drawGlass(g, w, h) {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.03)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }

  // ---------- the tiny game on the screen (256 x 192) ----------
  const SW = 256, SH = 192, SHIP_Y = 168;
  const COLS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff9f1c'];
  const G = { mode: 'attract', score: 0, hi: 0, time: 0, ship: 128, cool: 0, spawn: 0.5, over: 0, blink: 0, aim: 128, aimT: 0, bullets: [], blocks: [], stars: [] };
  for (let i = 0; i < 36; i++) G.stars.push({ x: Math.random() * SW, y: Math.random() * SH, v: 6 + Math.random() * 30, big: Math.random() < 0.2 });
  const pad = (n) => String(Math.floor(n)).padStart(6, '0');

  function reset(mode) {
    G.mode = mode; G.score = 0; G.time = 0; G.ship = 128; G.cool = 0; G.spawn = 0.4;
    G.blocks = []; G.bullets = [];
  }
  // steer: -1..1 (joystick x, only used when playing); fire: a button is pressed
  function simulate(dt, active, steer, fire) {
    G.blink += dt;
    if (G.mode === 'attract' && active) reset('play');
    else if (G.mode === 'play' && !active) reset('attract');
    const play = G.mode === 'play';
    const sp = play ? Math.min(1 + G.time / 45, 2) : 0.6; // game speed: faster when someone is playing
    for (const s of G.stars) { s.y += s.v * sp * dt; if (s.y > SH) { s.y -= SH; s.x = Math.random() * SW; } }
    if (G.mode === 'over') {
      G.over -= dt;
      if (G.over <= 0) reset(active ? 'play' : 'attract');
      return;
    }
    if (play) {
      G.time += dt; G.score += dt * 12 * sp;
      G.ship += steer * 150 * dt;
    } else {
      // demo play: chase the most dangerous block, with some error so it sometimes crashes
      G.aimT -= dt;
      if (G.aimT <= 0) {
        G.aimT = 0.35;
        let tgt = null;
        for (const b of G.blocks) if (!tgt || b.y > tgt.y) tgt = b;
        G.aim = tgt ? tgt.x + (Math.random() * 26 - 13) : 128;
      }
      const d = G.aim - G.ship;
      G.ship += Math.max(-110 * dt, Math.min(110 * dt, d));
    }
    G.ship = Math.max(12, Math.min(SW - 12, G.ship));
    G.cool -= dt;
    if ((play ? fire : true) && G.cool <= 0) { G.bullets.push({ x: G.ship, y: SHIP_Y - 10 }); G.cool = play ? 0.2 : 0.3; }
    for (const b of G.bullets) b.y -= 240 * dt;
    G.spawn -= dt;
    if (G.spawn <= 0) {
      G.blocks.push({ x: 14 + Math.random() * (SW - 28), y: -8, v: (30 + Math.random() * 12) * sp, c: COLS[(Math.random() * COLS.length) | 0] });
      G.spawn = ((play ? 0.8 : 0.9) / sp) * (0.6 + Math.random() * 0.8);
    }
    for (const k of G.blocks) k.y += k.v * dt;
    for (const b of G.bullets) {
      for (const k of G.blocks) {
        if (!k.dead && Math.abs(b.x - k.x) < 8 && Math.abs(b.y - k.y) < 9) {
          k.dead = true; b.y = -99; if (play) G.score += 50; break;
        }
      }
    }
    G.bullets = G.bullets.filter((b) => b.y > -4);
    for (const k of G.blocks) {
      if (!k.dead && k.y > SHIP_Y - 16 && k.y < SHIP_Y + 8 && Math.abs(k.x - G.ship) < 12) {
        G.mode = 'over'; G.over = 2.4;
        G.hi = Math.max(G.hi, Math.floor(G.score));
        break;
      }
    }
    G.blocks = G.blocks.filter((k) => !k.dead && k.y < SH + 10);
  }
  function drawGame(g) {
    g.fillStyle = '#070b1e'; g.fillRect(0, 0, SW, SH);
    g.fillStyle = '#ffffff';
    for (const s of G.stars) { g.globalAlpha = s.big ? 0.9 : 0.45; const z = s.big ? 2 : 1; g.fillRect(s.x | 0, s.y | 0, z, z); }
    g.globalAlpha = 1;
    g.fillStyle = '#16305a'; g.fillRect(0, SHIP_Y + 9, SW, 2);
    for (const k of G.blocks) {
      const x = (k.x - 6) | 0, y = (k.y - 6) | 0;
      g.fillStyle = k.c; g.fillRect(x, y, 12, 12);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x, y, 12, 2); g.fillRect(x, y, 2, 12);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + 10, 12, 2); g.fillRect(x + 10, y, 2, 12);
    }
    const sx = G.ship | 0;
    g.fillStyle = '#ff9f1c'; g.fillRect(sx - 3, SHIP_Y + 6, 6, 2);
    g.fillStyle = '#7cffb2';
    g.beginPath(); g.moveTo(sx, SHIP_Y - 10); g.lineTo(sx - 9, SHIP_Y + 6); g.lineTo(sx + 9, SHIP_Y + 6); g.closePath(); g.fill();
    g.fillStyle = '#e8fff4'; g.fillRect(sx - 1, SHIP_Y - 3, 2, 3);
    g.fillStyle = '#ffe066';
    for (const b of G.bullets) g.fillRect((b.x - 1) | 0, (b.y - 4) | 0, 2, 8);
    // HUD
    g.font = 'bold 10px "Courier New", monospace'; g.textBaseline = 'top';
    g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.fillText('SCORE ' + pad(G.score), 6, 5);
    g.textAlign = 'right'; g.fillText('HI ' + pad(Math.max(G.hi, G.score)), SW - 6, 5);
    if (G.mode === 'attract') {
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 74, SW, 50);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (Math.floor(G.blink * 1.6) % 2 === 0) { g.font = 'bold 19px "Courier New", monospace'; g.fillStyle = '#ffd60a'; g.fillText('INSERT COIN', SW / 2, 99); }
      g.font = 'bold 9px "Courier New", monospace'; g.fillStyle = '#9fb6e0'; g.fillText('DEMO PLAY', SW / 2, 114);
    }
    if (G.mode === 'over') {
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 74, SW, 50);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 22px "Courier New", monospace';
      g.lineWidth = 4; g.strokeStyle = '#3a0010'; g.strokeText('GAME OVER', SW / 2, 99);
      g.fillStyle = '#ff4d6d'; g.fillText('GAME OVER', SW / 2, 99);
    }
    g.fillStyle = 'rgba(0,0,0,0.14)'; // scanlines
    for (let y = 0; y < SH; y += 3) g.fillRect(0, y, SW, 1);
  }

  // ---------- materials ----------
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
  const mBody = std(0x2f6fc0, { roughness: 0.5 });
  const mDark = std(0x1d212b, { roughness: 0.7 });
  const mPanel = std(0x262a34, { roughness: 0.45 });
  const mTrim = std(0xffc933, { roughness: 0.4 });
  const mChrome = std(0xc9ced8, { metalness: 0.85, roughness: 0.25 });
  const mBlack = std(0x111318, { roughness: 0.55 });
  const mBall = std(0xd8111a, { roughness: 0.3 });

  // ---------- plinth, body, top with marquee ----------
  ctx.mesh(slabY(0.76, 0.74, 0.12, 0.04), mDark, root, [0, 0.06, -0.05]);
  ctx.mesh(slabY(0.80, 0.70, 1.66, 0.07, 0.03), mBody, root, [0, 0.12 + 0.83, -0.05]);
  // header box is set back (z -0.12) from the screen housing so Gary's head does not clip it when he stands at the screen;
  // cabinet top is y 2.0, below his skull top (about 2.24 at byte3d scale 1)
  ctx.mesh(slabY(0.81, 0.57, 0.04, 0.05, 0.012), mTrim, root, [0, 1.78, -0.12]);
  ctx.mesh(slabY(0.80, 0.56, 0.22, 0.07, 0.03), mBody, root, [0, 1.89, -0.12]);

  // side art (both sides), flat planes just outside the body walls
  const artR = ctx.canvasTex(210, 500, (g, w, h) => artRight(g, w, h));
  const artL = ctx.canvasTex(210, 500, (g, w, h) => artLeft(g, w, h));
  const sidePlane = new THREE.PlaneGeometry(0.62, 1.48);
  ctx.mesh(sidePlane, std(0xffffff, { map: artR, alphaTest: 0.5, roughness: 0.45 }), root, [0.403, 0.95, -0.05], [1, 1, 1], [0, PI / 2, 0]);
  ctx.mesh(sidePlane, std(0xffffff, { map: artL, alphaTest: 0.5, roughness: 0.45 }), root, [-0.403, 0.95, -0.05], [1, 1, 1], [0, -PI / 2, 0]);

  // lit marquee on the top front
  const marqTex = ctx.canvasTex(512, 128, (g, w, h) => drawMarquee(g, w, h));
  const mMarq = std(0xffffff, { map: marqTex, emissiveMap: marqTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5, alphaTest: 0.5 });
  ctx.mesh(new THREE.PlaneGeometry(0.64, 0.16), mMarq, root, [0, 1.88, 0.166]);

  // ---------- lower front: coin door, glowing coin slots, key lock ----------
  ctx.mesh(slab(0.76, 0.825, 0.04, 0.05, 0.012), mBody, root, [0, 0.5325, 0.32]);
  ctx.mesh(slab(0.34, 0.30, 0.03, 0.03, 0.01), mChrome, root, [0, 0.37, 0.355]);
  const mSlotR = std(0xff3b30, { emissive: 0xff3b30, emissiveIntensity: 1.2, roughness: 0.4 });
  const mSlotY = std(0xffd60a, { emissive: 0xffd60a, emissiveIntensity: 1.2, roughness: 0.4 });
  const slotGeo = slab(0.05, 0.075, 0.012, 0.012, 0.004);
  ctx.mesh(slotGeo, mSlotR, root, [-0.05, 0.46, 0.378]);
  ctx.mesh(slotGeo, mSlotY, root, [0.05, 0.46, 0.378]);
  ctx.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 16), mBlack, root, [0, 0.26, 0.38], [1, 1, 1], [PI / 2, 0, 0]);

  // ---------- screen housing (dark, with a window) ----------
  ctx.mesh(slab(0.78, 0.835, 0.07, 0.06, 0.02, { w: 0.62, h: 0.45, r: 0.03, x: 0, y: 0.0125 }), mDark, root, [0, 1.3625, 0.335]);

  // screen: canvas texture, emissive, tilted back, recessed in the window
  const scrTex = ctx.canvasTex(SW, SH, (g) => drawGame(g));
  scrTex.magFilter = THREE.NearestFilter;
  const gS = scrTex.userData.ctx;
  const screen = ctx.group(root, [0, 1.375, 0.34]);
  screen.rotation.x = -0.10;
  const screenGeo = new THREE.PlaneGeometry(0.60, 0.45);
  ctx.mesh(screenGeo, std(0x9a9a9a, { map: scrTex, emissiveMap: scrTex, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.3 }), screen, [0, 0, 0]);
  const glassTex = ctx.canvasTex(64, 48, (g, w, h) => drawGlass(g, w, h), false);
  ctx.mesh(screenGeo, new THREE.MeshStandardMaterial({ map: glassTex, transparent: true, depthWrite: false, roughness: 0.5, metalness: 0, opacity: 0.8 }), screen, [0, 0, 0.003]);

  // ---------- control panel, joystick, buttons ----------
  ctx.mesh(slabY(0.74, 0.25, 0.095, 0.03, 0.015), mPanel, root, [0, 0.8975, 0.425]);

  // joystick: static collar on the panel, a shaft and red ball that tilts around a pivot below the panel
  const stickBase = new THREE.Vector3(-0.15, 0.85, 0.45);
  const stickPivot = ctx.group(root, [stickBase.x, stickBase.y, stickBase.z]);
  ctx.mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 12), mChrome, stickPivot, [0, 0.07, 0]);
  ctx.mesh(ctx.sphere, mBall, stickPivot, [0, 0.14, 0], [0.06, 0.06, 0.06]);
  ctx.mesh(lathe([[0, 0], [0.046, 0], [0.05, 0.012], [0.04, 0.03], [0, 0.03]]), mBlack, root, [-0.15, 0.945, 0.45]);

  // three chunky mushroom buttons
  const btnProfile = lathe([[0, 0], [0.056, 0], [0.06, 0.008], [0.058, 0.02], [0.05, 0.032], [0.036, 0.04], [0, 0.044]]);
  const btnCols = [0xffcc33, 0x33c46b, 0x3a86ff];
  const btnXs = [0.05, 0.15, 0.25];
  const btnG = [], btnM = [];
  btnXs.forEach((x, i) => {
    const m = std(btnCols[i], { emissive: btnCols[i], emissiveIntensity: 0.15, roughness: 0.35 });
    const grp = ctx.group(root, [x, 0.945, 0.43]);
    ctx.mesh(btnProfile, m, grp, [0, 0, 0]);
    btnG.push(grp); btnM.push(m);
  });

  // ---------- state for update() ----------
  const tilt = { x: 0, y: 0 };
  const pv = [0, 0, 0];
  const tip = new THREE.Vector3();
  const anchors = {
    stick: new THREE.Vector3(stickBase.x, stickBase.y + 0.2, stickBase.z), // top of the joystick ball
    buttons: new THREE.Vector3(0.15, 0.965, 0.43),                          // centre of the three buttons
    screen: new THREE.Vector3(0, 1.375, 0.34),                              // centre of the screen
  };
  let scrAcc = 0;
  const NO_PRESS = [];   // shared empty default, so update() does not allocate each frame

  return {
    root,
    // with the slot yaw of -0.75 his total yaw is 1.66, a profile facing the screen; he stands left of the cabinet front
    spots: { use: { x: -0.55, y: 0, z: 0.95, yaw: 2.41, pose: 'stand' } },
    anchors,
    update(dt, t = 0, st = {}) {
      dt = Math.max(0, Math.min(dt, 0.05));
      const active = !!st.active;
      const press = st.press || NO_PRESS;

      // joystick tilt (smoothed); the stick anchor follows the moving ball
      const tx = active ? clamp1(st.stick?.x) : 0, ty = active ? clamp1(st.stick?.y) : 0;
      const k = Math.min(1, dt * 10);
      tilt.x += (tx - tilt.x) * k; tilt.y += (ty - tilt.y) * k;
      stickPivot.rotation.set(tilt.y * 0.35, 0, -tilt.x * 0.35);
      anchors.stick.copy(tip.set(0, 0.2, 0).applyEuler(stickPivot.rotation)).add(stickBase);

      // buttons: push down and light up while pressed
      for (let i = 0; i < 3; i++) {
        pv[i] += ((press[i] ? 1 : 0) - pv[i]) * Math.min(1, dt * 25);
        btnG[i].position.y = 0.945 - 0.018 * pv[i];
        btnM[i].emissiveIntensity = (active ? 0.3 : 0.12) + 1.2 * pv[i];
      }

      // marquee pulse, coin slots flash while attract mode waits for a coin
      mMarq.emissiveIntensity = 0.85 + 0.12 * Math.sin(t * 3);
      const slotI = !active && Math.floor(t * 1.6) % 2 === 0 ? 1.8 : 1.1;
      mSlotR.emissiveIntensity = slotI; mSlotY.emissiveIntensity = slotI;

      // game logic every frame, screen redraw at ~15 fps
      simulate(dt, active, tilt.x, press.some(Boolean));
      scrAcc += dt;
      if (scrAcc >= 1 / 15) { scrAcc = 0; drawGame(gS); scrTex.needsUpdate = true; }
    },
    dispose() {
      root.traverse((o) => {
        if (o.geometry && o.geometry !== ctx.sphere) o.geometry.dispose();   // ctx.sphere is shared (the joystick ball)
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); }
        }
      });
    },
  };
}
