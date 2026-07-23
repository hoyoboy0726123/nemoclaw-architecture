'use strict';
/* NemoClaw 電路實驗室 — 3D 麵包板工作台（純 Canvas，自寫投影＋畫家演算法） */
window.CF = window.CF || {};

CF.Board3D = (function () {

  /* ---------------- 網格幾何 ---------------- */
  const PITCH = 1.6;
  const COLS = 40;
  const colX = c => (c - (COLS - 1) / 2) * PITCH;
  const ROWS = { a: -6.4, b: -5.0, c: -3.6, d: -2.2, e: -0.8, f: 0.8, g: 2.2, h: 3.6, i: 5.0, j: 6.4 };
  const RAIL = { topV: -9.4, topG: -8.2, botG: 8.2, botV: 9.4 };
  const LINEZ = { topRed: -10.45, topBlue: -7.35, botBlue: 7.35, botRed: 10.45 };
  const BOARD_TOP = 1.5;

  const WIRE_COLORS = { V: '#e0452e', G: '#33405c', S: ['#f0c33c', '#5ac98e', '#54b8dc', '#c78bf0', '#f0913c'] };

  /* ---------------- 小工具 ---------------- */
  const LIGHT = (() => { const l = [-0.45, 0.85, 0.4]; const n = Math.hypot(...l); return l.map(v => v / n); })();

  function shadeColor(hex, s) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const f = v => Math.max(0, Math.min(255, Math.round(v * s)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  function faceShade(pts, emissive) {
    const [p0, p1, p2] = pts;
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map(x => x / len);
    const d = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    return emissive ? 0.86 + 0.14 * d : 0.55 + 0.5 * d;
  }

  /* ---------------- 場景建構 ---------------- */
  function newScene() { return { polys: [], segs: [], dots: [], tags: [], pinTags: [], screen: null, oledLines: [] }; }

  function poly(scene, pts, color, emissive) {
    scene.polys.push({ pts, fill: shadeColor(color, faceShade(pts, emissive)) });
  }

  function addBox(scene, cx, yb, cz, w, h, d, color, opt) {
    opt = opt || {};
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y0 = yb, y1 = yb + h;
    let v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]
    ];
    if (opt.ry) {
      const c = Math.cos(opt.ry), s = Math.sin(opt.ry);
      v = v.map(p => [cx + (p[0] - cx) * c - (p[2] - cz) * s, p[1], cz + (p[0] - cx) * s + (p[2] - cz) * c]);
    }
    const e = opt.emissive;
    poly(scene, [v[7], v[6], v[5], v[4]], color, e);              // top (+y)
    poly(scene, [v[3], v[2], v[6], v[7]], color, e);              // front (+z)
    poly(scene, [v[1], v[0], v[4], v[5]], color, e);              // back (-z)
    poly(scene, [v[0], v[3], v[7], v[4]], color, e);              // left (-x)
    poly(scene, [v[2], v[1], v[5], v[6]], color, e);              // right (+x)
    poly(scene, [v[0], v[1], v[2], v[3]], color, e);              // bottom
  }

  function addCylY(scene, cx, yb, cz, r, h, color, seg, emissive) {
    seg = seg || 12;
    const y1 = yb + h;
    const top = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p00 = [cx + r * Math.cos(a0), yb, cz + r * Math.sin(a0)];
      const p10 = [cx + r * Math.cos(a1), yb, cz + r * Math.sin(a1)];
      const p11 = [cx + r * Math.cos(a1), y1, cz + r * Math.sin(a1)];
      const p01 = [cx + r * Math.cos(a0), y1, cz + r * Math.sin(a0)];
      poly(scene, [p10, p00, p01, p11], color, emissive);
      top.push([cx + r * Math.cos(a0), y1, cz + r * Math.sin(a0)]);
    }
    poly(scene, top.reverse(), color, emissive);
  }

  function addCylZ(scene, cx, cy, z0, r, len, color, seg) {
    seg = seg || 10;
    const z1 = z0 + len;
    const front = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p00 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), z0];
      const p10 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1), z0];
      const p11 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1), z1];
      const p01 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), z1];
      poly(scene, [p00, p10, p11, p01], color);
      front.push([cx + r * 0.82 * Math.cos(a0), cy + r * 0.82 * Math.sin(a0), z1 + 0.02]);
    }
    poly(scene, front, '#101418');
  }

  function addDome(scene, cx, yb, cz, r, latN, lonN, color) {
    latN = latN || 3; lonN = lonN || 10;
    const pt = (la, lo) => {
      const th = (la / latN) * Math.PI / 2;           // 0=頂
      const ph = (lo / lonN) * Math.PI * 2;
      return [cx + r * Math.sin(th) * Math.cos(ph), yb + r * Math.cos(th), cz + r * Math.sin(th) * Math.sin(ph)];
    };
    const cap = [];
    for (let lo = 0; lo < lonN; lo++) cap.push(pt(0.6, lo));
    poly(scene, cap.reverse(), color);
    for (let la = 0; la < latN; la++) {
      if (la === 0) continue;
      for (let lo = 0; lo < lonN; lo++) {
        poly(scene, [pt(la, lo), pt(la, lo + 1), pt(la + 1, lo + 1), pt(la + 1, lo)], color);
      }
    }
  }

  function addWire(scene, p0, p3, kind, sigIdx, wireIdx) {
    const color = kind === 'V' ? WIRE_COLORS.V : kind === 'G' ? WIRE_COLORS.G : WIRE_COLORS.S[sigIdx % WIRE_COLORS.S.length];
    const dx = p3[0] - p0[0], dz = p3[2] - p0[2];
    const dist = Math.hypot(dx, dz);
    const h = Math.min(11, 3 + dist * 0.1);
    let bx = 0, bz = 0;
    if (dist > 1) {
      const bow = Math.min(2.4, dist * 0.05) * ((wireIdx % 2) ? 1 : -1);
      bx = (-dz / dist) * bow; bz = (dx / dist) * bow;
    }
    const P1 = [p0[0] + dx * 0.25 + bx, Math.max(p0[1], p3[1]) + h, p0[2] + dz * 0.25 + bz];
    const P2 = [p0[0] + dx * 0.75 + bx, Math.max(p0[1], p3[1]) + h, p0[2] + dz * 0.75 + bz];
    const N = Math.max(10, Math.min(26, Math.round(dist * 1.2)));
    let prev = p0;
    for (let i = 1; i <= N; i++) {
      const t = i / N, mt = 1 - t;
      const w0 = mt * mt * mt, w1 = 3 * mt * mt * t, w2 = 3 * mt * t * t, w3 = t * t * t;
      const p = [
        w0 * p0[0] + w1 * P1[0] + w2 * P2[0] + w3 * p3[0],
        w0 * p0[1] + w1 * P1[1] + w2 * P2[1] + w3 * p3[1],
        w0 * p0[2] + w1 * P1[2] + w2 * P2[2] + w3 * p3[2]
      ];
      scene.segs.push({ a: prev, b: p, color });
      prev = p;
    }
  }

  /* ---------------- 麵包板 ---------------- */
  function buildBreadboard(scene) {
    addBox(scene, 0, 0, 0, 67, BOARD_TOP, 23.6, '#efe8d8');
    addBox(scene, 0, BOARD_TOP, 0, 67, 0.16, 1.6, '#b89e7d');
    const xs = colX(0) - 1.4, xe = colX(COLS - 1) + 1.4;
    const railLine = (z, color) => {
      for (let i = 0; i < 6; i++) {
        const x0 = xs + (xe - xs) * (i / 6), x1 = xs + (xe - xs) * ((i + 1) / 6);
        scene.segs.push({ a: [x0, BOARD_TOP + 0.03, z], b: [x1, BOARD_TOP + 0.03, z], color, thin: true });
      }
    };
    railLine(LINEZ.topRed, '#d84b31'); railLine(LINEZ.topBlue, '#3f6bd6');
    railLine(LINEZ.botBlue, '#3f6bd6'); railLine(LINEZ.botRed, '#d84b31');
    for (let c = 0; c < COLS; c++) {
      const x = colX(c);
      for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
        scene.dots.push({ p: [x, BOARD_TOP + 0.02, ROWS[k]], r: 0.26, color: '#39362e' });
      }
      if (c % 6 !== 5) {
        for (const z of [RAIL.topV, RAIL.topG, RAIL.botG, RAIL.botV]) {
          scene.dots.push({ p: [x, BOARD_TOP + 0.02, z], r: 0.26, color: '#39362e' });
        }
      }
    }
  }

  /* ---------------- 開發板模型 ---------------- */
  function goldPins(scene, b0, count, zRows, yTop) {
    for (let i = 0; i < count; i++) {
      for (const z of zRows) scene.dots.push({ p: [colX(b0 + i), yTop, z], r: 0.2, color: '#c9a53f' });
    }
  }

  function buildBoardModel(scene, board) {
    const map = {};
    let b0, zT, zB, pcbTopY;
    if (board.model === 'esp32devkit') {
      b0 = 3; zT = ROWS.b; zB = ROWS.i;
      const cx = (colX(b0) + colX(b0 + 14)) / 2;
      addBox(scene, cx, 2.2, 0, 27.6, 0.9, 12.6, '#12321e');
      pcbTopY = 3.1;
      const xL = cx - 13.8;
      addBox(scene, xL + 1.8, pcbTopY, 0, 3.0, 0.5, 9.8, '#d9cfb2');
      addBox(scene, xL + 6.9, pcbTopY, 0, 6.4, 1.0, 10.0, '#99a2a8');
      addBox(scene, cx + 3.6, pcbTopY, 0, 3.2, 0.4, 3.2, '#0d0d0d');
      addBox(scene, cx + 12.2, pcbTopY, 0, 2.6, 0.85, 5.4, '#b9c0c6');
      addBox(scene, cx + 9.6, pcbTopY, -4.4, 1.5, 0.45, 1.1, '#191919');
      addBox(scene, cx + 9.6, pcbTopY, 4.4, 1.5, 0.45, 1.1, '#191919');
      goldPins(scene, b0, 15, [zT, zB], pcbTopY + 0.02);
      board.pinsTop.forEach((n, i) => { map[n.trim()] = [colX(b0 + i), pcbTopY, zT]; });
      board.pinsBottom.forEach((n, i) => { if (!(n.trim() in map)) map[n.trim()] = [colX(b0 + i), pcbTopY, zB]; });
      // GND 同名多腳：上排優先（已成立）
      return { pins: map, anchor: [cx - 2, 4.6, 0], endCol: b0 + 14, camAnchor: null };
    }
    if (board.model === 'esp32cam') {
      b0 = 6; zT = ROWS.b; zB = ROWS.i;
      const cx = (colX(b0) + colX(b0 + 7)) / 2;
      addBox(scene, cx, 2.2, 0, 15.6, 0.9, 12.6, '#173a25');
      pcbTopY = 3.1;
      addBox(scene, cx - 1.2, pcbTopY, 0.4, 5.2, 3.2, 5.2, '#151515');
      addCylY(scene, cx - 1.2, pcbTopY + 3.2, 0.4, 1.7, 1.5, '#1a1e22', 10);
      scene.dots.push({ p: [cx - 1.2, pcbTopY + 4.74, 0.4], r: 1.0, color: '#2b3d4a' });
      addBox(scene, cx - 1.2, pcbTopY, 4.35, 3.6, 0.2, 2.6, '#c8a35c');
      addBox(scene, cx + 5.2, pcbTopY, 0.8, 2.8, 0.7, 4.6, '#b9c0c6');
      addBox(scene, cx - 5.6, pcbTopY, -4.6, 1.1, 0.3, 1.1, '#f2f2f2');
      goldPins(scene, b0, 8, [zT, zB], pcbTopY + 0.02);
      board.pinsTop.forEach((n, i) => { map[n.trim()] = [colX(b0 + i), pcbTopY, zT]; });
      board.pinsBottom.forEach((n, i) => { if (!(n.trim() in map)) map[n.trim()] = [colX(b0 + i), pcbTopY, zB]; });
      return { pins: map, anchor: [cx + 2.5, 4.4, -2.5], endCol: b0 + 7, camAnchor: [cx - 1.2, pcbTopY + 4.9, 0.4] };
    }
    // Arduino Nano
    b0 = 4; zT = ROWS.c; zB = ROWS.h;
    const cx = (colX(b0) + colX(b0 + 14)) / 2;
    addBox(scene, cx, 2.2, 0, 27.6, 0.8, 9.2, '#175a40');
    pcbTopY = 3.0;
    addBox(scene, cx - 11.9, pcbTopY, 0, 3.6, 1.05, 4.6, '#b9c0c6');
    addBox(scene, cx + 1.6, pcbTopY, 0, 3.0, 0.35, 3.0, '#0d0d0d');
    addBox(scene, cx - 2.6, pcbTopY, 1.9, 2.0, 0.4, 1.0, '#c0c6ca');
    addBox(scene, cx + 6.4, pcbTopY, -1.6, 1.4, 0.3, 1.0, '#191919');
    goldPins(scene, b0, 15, [zT, zB], pcbTopY + 0.02);
    board.pinsTop.forEach((n, i) => { map[n.trim()] = [colX(b0 + i), pcbTopY, zT]; });
    board.pinsBottom.forEach((n, i) => { if (!(n.trim() in map)) map[n.trim()] = [colX(b0 + i), pcbTopY, zB]; });
    return { pins: map, anchor: [cx, 4.4, 0], endCol: b0 + 14, camAnchor: null };
  }

  /* ---------------- 元件模型 ----------------
   * 各建構器回傳 { pins:{名稱:座標}, anchor, cols:占用欄數 }
   */
  function legs(scene, cols, z, h) {
    for (const c of cols) addBox(scene, colX(c), BOARD_TOP, z, 0.28, h, 0.28, '#9aa0a6');
  }

  const PART_BUILDERS = {
    dht11(scene, c0) {
      const z = ROWS.b, cx = colX(c0 + 1);
      legs(scene, [c0, c0 + 1, c0 + 2], z, 1.9);
      addBox(scene, cx, 3.4, z, 4.6, 5.0, 2.9, '#3a6bc4');
      for (let gx = 0; gx < 3; gx++) for (let gy = 0; gy < 4; gy++) {
        addBox(scene, cx - 1.4 + gx * 1.4, 4.2 + gy * 0.95, z + 1.48, 0.85, 0.6, 0.1, '#24457e');
      }
      return {
        pins: { VCC: [colX(c0), 1.6, z], DATA: [colX(c0 + 1), 1.6, z], GND: [colX(c0 + 2), 1.6, z] },
        anchor: [cx, 8.8, z], cols: 5
      };
    },
    bme280(scene, c0) {
      const z = ROWS.b, cx = colX(c0 + 1.5);
      legs(scene, [c0, c0 + 1, c0 + 2, c0 + 3], z, 1.7);
      addBox(scene, cx, 3.2, z, 5.4, 4.0, 1.0, '#5b3e94');
      addBox(scene, cx - 0.9, 5.0, z + 0.52, 1.5, 1.5, 0.12, '#c0c6ca');
      return {
        pins: { VCC: [colX(c0), 1.6, z], GND: [colX(c0 + 1), 1.6, z], SCL: [colX(c0 + 2), 1.6, z], SDA: [colX(c0 + 3), 1.6, z] },
        anchor: [cx, 7.6, z], cols: 6
      };
    },
    bh1750(scene, c0) {
      const z = ROWS.b, cx = colX(c0 + 1.5);
      legs(scene, [c0, c0 + 1, c0 + 2, c0 + 3], z, 1.7);
      addBox(scene, cx, 3.2, z, 5.4, 3.4, 1.0, '#2b4a8e');
      addBox(scene, cx + 0.8, 4.6, z + 0.52, 1.3, 0.9, 0.12, '#0e0e0e');
      return {
        pins: { VCC: [colX(c0), 1.6, z], GND: [colX(c0 + 1), 1.6, z], SCL: [colX(c0 + 2), 1.6, z], SDA: [colX(c0 + 3), 1.6, z] },
        anchor: [cx, 7.0, z], cols: 6
      };
    },
    hcsr04(scene, c0) {
      const z = ROWS.b, cx = colX(c0 + 1.5);
      legs(scene, [c0, c0 + 1, c0 + 2, c0 + 3], z, 1.7);
      addBox(scene, cx, 3.2, z + 0.1, 8.8, 4.4, 1.0, '#2b57a8');
      addCylZ(scene, cx - 2.5, 5.3, z + 0.6, 1.85, 1.7, '#b9c0c6', 10);
      addCylZ(scene, cx + 2.5, 5.3, z + 0.6, 1.85, 1.7, '#b9c0c6', 10);
      addBox(scene, cx, 6.9, z + 0.4, 2.4, 0.7, 0.6, '#c0c6ca');
      return {
        pins: { VCC: [colX(c0), 1.6, z], TRIG: [colX(c0 + 1), 1.6, z], ECHO: [colX(c0 + 2), 1.6, z], GND: [colX(c0 + 3), 1.6, z] },
        anchor: [cx, 8.4, z], cols: 7
      };
    },
    soil(scene, c0) {
      const z = ROWS.b, cx = colX(c0 + 1);
      legs(scene, [c0, c0 + 1, c0 + 2], z, 1.7);
      addBox(scene, cx, 3.2, z, 3.4, 3.2, 0.8, '#1c3a5e');
      addBox(scene, cx - 0.8, 6.4, z, 0.9, 3.4, 0.55, '#c9a53f');
      addBox(scene, cx + 0.8, 6.4, z, 0.9, 3.4, 0.55, '#c9a53f');
      addBox(scene, cx, 6.4, z, 2.5, 0.8, 0.55, '#1c3a5e');
      return {
        pins: { VCC: [colX(c0), 1.6, z], AO: [colX(c0 + 1), 1.6, z], GND: [colX(c0 + 2), 1.6, z] },
        anchor: [cx, 10.4, z], cols: 5
      };
    },
    oled(scene, c0) {
      const zp = ROWS.i, cx = colX(c0 + 1.5), zb = zp - 0.55;
      legs(scene, [c0, c0 + 1, c0 + 2, c0 + 3], zp, 1.6);
      addBox(scene, cx, 3.0, zb, 12.8, 8.4, 1.0, '#1c2f63');
      addBox(scene, cx, 5.0, zb + 0.56, 11.4, 5.6, 0.12, '#04060b');
      scene.screen = {
        tl: [cx - 5.3, 10.2, zb + 0.66], tr: [cx + 5.3, 10.2, zb + 0.66], bl: [cx - 5.3, 5.3, zb + 0.66]
      };
      for (let i = 0; i < 4; i++) scene.dots.push({ p: [colX(c0 + i), 11.0, zb + 0.52], r: 0.18, color: '#c9a53f' });
      return {
        pins: { VCC: [colX(c0), 1.6, zp], GND: [colX(c0 + 1), 1.6, zp], SCL: [colX(c0 + 2), 1.6, zp], SDA: [colX(c0 + 3), 1.6, zp] },
        anchor: [cx + 2, 12.2, zb], cols: 9
      };
    },
    button(scene, c0) {
      const cx = colX(c0 + 1);
      legs(scene, [c0], ROWS.e, 0.6); legs(scene, [c0 + 2], ROWS.e, 0.6);
      legs(scene, [c0], ROWS.f, 0.6); legs(scene, [c0 + 2], ROWS.f, 0.6);
      addBox(scene, cx, BOARD_TOP + 0.5, 0, 6.0, 2.0, 5.0, '#222222');
      addCylY(scene, cx, BOARD_TOP + 2.5, 0, 1.9, 1.2, '#111111', 12);
      return {
        pins: { 'LEG A': [colX(c0), 1.6, ROWS.e], 'LEG B': [colX(c0 + 2), 1.6, ROWS.f] },
        anchor: [cx, 5.6, 0], cols: 5
      };
    },
    pir(scene, c0) {
      const zp = ROWS.i, cx = colX(c0 + 1), zc = zp - 1.7;
      legs(scene, [c0, c0 + 1, c0 + 2], zp, 1.1);
      addBox(scene, cx, 2.4, zc, 9.0, 0.75, 7.6, '#1e5a33');
      addDome(scene, cx, 3.15, zc, 3.5, 3, 10, '#efe9dc');
      return {
        pins: { VCC: [colX(c0), 1.6, zp], OUT: [colX(c0 + 1), 1.6, zp], GND: [colX(c0 + 2), 1.6, zp] },
        anchor: [cx, 8.3, zc], cols: 6
      };
    },
    led(scene, c0) {
      const z = ROWS.h, cx = colX(c0) + PITCH / 2;
      legs(scene, [c0, c0 + 1], z, 2.2);
      addCylY(scene, cx, 3.7, z, 1.0, 1.0, '#8f2318', 10, true);
      addDome(scene, cx, 4.7, z, 1.0, 2, 10, '#ff5348');
      return {
        pins: { ANODE: [colX(c0), 1.6, z], CATHODE: [colX(c0 + 1), 1.6, z] },
        anchor: [cx, 6.8, z], cols: 4
      };
    },
    buzzer(scene, c0) {
      const z = ROWS.h, cx = colX(c0) + PITCH / 2;
      legs(scene, [c0, c0 + 1], z, 0.6);
      addCylY(scene, cx, BOARD_TOP + 0.5, z, 2.9, 3.1, '#141414', 14);
      scene.dots.push({ p: [cx, BOARD_TOP + 3.66, z], r: 0.55, color: '#000000' });
      return {
        pins: { SIG: [colX(c0), 1.6, z], GND: [colX(c0 + 1), 1.6, z] },
        anchor: [cx, 6.0, z], cols: 5
      };
    },
    servo(scene, c0) {
      const zp = ROWS.i, cx = colX(c0 + 1), zc = zp - 1.2;
      legs(scene, [c0, c0 + 1, c0 + 2], zp, 0.9);
      addBox(scene, cx, 2.4, zc, 6.6, 5.4, 5.0, '#3f7ac2');
      addCylY(scene, cx - 1.3, 7.8, zc, 1.5, 1.0, '#356aab', 10);
      addBox(scene, cx - 1.3, 8.8, zc, 5.0, 0.35, 0.85, '#e8e4da');
      addBox(scene, cx - 1.3, 8.8, zc, 0.85, 0.35, 3.4, '#e8e4da');
      return {
        pins: { VCC: [colX(c0), 1.6, zp], SIG: [colX(c0 + 1), 1.6, zp], GND: [colX(c0 + 2), 1.6, zp] },
        anchor: [cx + 1, 9.6, zc], cols: 6
      };
    },
    relay(scene, c0) {
      const zp = ROWS.i, cx = colX(c0 + 1), zc = zp - 1.4;
      legs(scene, [c0, c0 + 1, c0 + 2], zp, 0.9);
      addBox(scene, cx, 2.4, zc, 8.8, 0.75, 6.0, '#173a63');
      addBox(scene, cx + 0.7, 3.15, zc, 5.0, 3.5, 4.0, '#2b57c8');
      addBox(scene, cx + 0.7, 4.4, zc + 2.02, 3.6, 1.6, 0.1, '#e8e4da');
      addBox(scene, cx - 3.2, 3.15, zc + 1.2, 1.4, 1.1, 1.4, '#1b6ea8');
      return {
        pins: { VCC: [colX(c0), 1.6, zp], IN: [colX(c0 + 1), 1.6, zp], GND: [colX(c0 + 2), 1.6, zp] },
        anchor: [cx, 7.6, zc], cols: 6
      };
    }
  };

  /* ---------------- 依方案組場景 ---------------- */
  function buildScene(plan, opts) {
    const scene = newScene();
    buildBreadboard(scene);
    const bm = buildBoardModel(scene, plan.board);
    scene.tags.push({ text: plan.board.name, p: bm.anchor });

    const partPins = { board: bm.pins };
    let topCur = bm.endCol + 3;
    let botCur = bm.endCol + 4;
    // 下排擺放順序：按鈕類輸入靠板、顯示器居中、其餘靠右
    const botRank = { INPUT: 0, DISPLAY: 1, SENSOR: 2, OUTPUT: 3, ACTUATOR: 4 };
    const topQueue = plan.parts.filter(p => !p.def.onboard && p.side === 'top');
    const botQueue = plan.parts.filter(p => !p.def.onboard && p.side !== 'top')
      .slice().sort((a, b) => (botRank[a.def.cls] ?? 9) - (botRank[b.def.cls] ?? 9));
    for (const part of plan.parts) {
      if (part.def.onboard && bm.camAnchor) scene.tags.push({ text: part.def.name, p: bm.camAnchor });
    }
    for (const part of topQueue) {
      const built = PART_BUILDERS[part.id](scene, Math.min(topCur, COLS - 5));
      topCur += built.cols;
      partPins[part.id] = built.pins;
      scene.tags.push({ text: part.def.name, p: built.anchor });
    }
    for (const part of botQueue) {
      // 非輸入類的下排元件與上排元件錯開，避免前後互相遮擋
      if (part.def.cls !== 'INPUT' && botCur < topCur + 3) botCur = topCur + 3;
      const built = PART_BUILDERS[part.id](scene, Math.min(botCur, COLS - 5));
      botCur += built.cols + 1;
      partPins[part.id] = built.pins;
      scene.tags.push({ text: part.def.name, p: built.anchor });
    }

    // OLED 螢幕顯示內容（示意值）
    const oledLines = [];
    if (plan.parts.some(p => p.id === 'dht11')) oledLines.push(['TEMP', '24.6 C'], ['HUMI', '58']);
    else if (plan.parts.some(p => p.id === 'bme280')) oledLines.push(['TEMP', '24.1 C'], ['PRES', '1013']);
    if (plan.parts.some(p => p.id === 'bh1750')) oledLines.push(['LUX', '412']);
    if (plan.parts.some(p => p.id === 'hcsr04')) oledLines.push(['DIST', '27.4']);
    scene.oledLines = oledLines.slice(0, 2);

    /* 接線 */
    let sigIdx = 0;
    plan.nets.forEach((net, wi) => {
      let from = null;
      if (net.partRef === 'board') from = bm.pins[net.pinName];
      else from = (partPins[net.partRef] || {})[net.pinName];
      if (!from) return;
      let to = null;
      if (net.kind === 'V' || net.kind === 'G') {
        const topSide = from[2] < 0;
        const z = net.kind === 'V' ? (topSide ? RAIL.topV : RAIL.botV) : (topSide ? RAIL.topG : RAIL.botG);
        to = [from[0], 1.6, z];
      } else if (net.boardPin) {
        to = bm.pins[net.boardPin.trim()];
      }
      if (!to) return;
      addWire(scene, from, to, net.kind, net.kind === 'S' ? sigIdx : 0, wi);
      if (net.kind === 'S') sigIdx++;
      if (net.boardPin) scene.pinTags.push({ text: net.boardPin, p: [to[0], to[1] + 0.2, to[2]], kind: 'S' });
    });
    // 板端電源腳標籤
    if (bm.pins[plan.powerPin]) scene.pinTags.push({ text: plan.powerPin, p: bm.pins[plan.powerPin], kind: 'V' });
    if (bm.pins[plan.board.gndPin]) scene.pinTags.push({ text: plan.board.gndPin, p: bm.pins[plan.board.gndPin], kind: 'G' });

    return scene;
  }

  /* ---------------- 渲染器 ---------------- */
  const state = {
    canvas: null, ctx: null, scene: null, plan: null,
    cam: { yaw: -0.22, pitch: 0.5, dist: 84, ty: 2.6, tx: 5 },
    opts: { pinLabels: true, panMode: false },
    dpr: 1, w: 0, h: 0, needsRender: false
  };
  const HOME = { yaw: -0.22, pitch: 0.5, dist: 84, ty: 2.6, tx: 5 };

  function projFactory() {
    const { yaw, pitch, dist, ty, tx } = state.cam;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fl = state.h * 1.9;
    const cx = state.w / 2, cyc = state.h * 0.54;
    return function (p) {
      const x = p[0] - (tx || 0), y = p[1] - ty, z = p[2];
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y1 = y * cp - z1 * sp;
      const z2 = z1 * cp + y * sp;
      const depth = dist - z2;
      const s = fl / Math.max(8, depth);
      return [cx + x1 * s, cyc - y1 * s, depth, s];
    };
  }

  function render() {
    const { ctx, scene } = state;
    if (!ctx || !scene) return;
    const W = state.w, H = state.h;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const proj = projFactory();

    /* 淺色底：板下柔和陰影 */
    {
      const pL = proj([-35, 0, 1]), pR = proj([35, 0, 1]);
      const pN = proj([0, 0, -12.5]), pF = proj([0, 0, 12.5]);
      const cx0 = (pL[0] + pR[0]) / 2, cy0 = (pN[1] + pF[1]) / 2 + 8;
      const rx = Math.abs(pR[0] - pL[0]) / 2 + 26;
      const ry = Math.abs(pF[1] - pN[1]) / 2 + 18;
      for (let i = 3; i >= 1; i--) {
        ctx.beginPath();
        ctx.ellipse(cx0, cy0, rx * (0.75 + i * 0.09), ry * (0.7 + i * 0.11), 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(70, 58, 34, ${0.028 * (4 - i)})`;
        ctx.fill();
      }
    }

    const items = [];
    for (const q of scene.polys) {
      const pts = q.pts.map(proj);
      let d = 0; for (const p of pts) d += p[2];
      items.push({ t: 0, d: d / pts.length, pts, fill: q.fill });
    }
    for (const s of scene.segs) {
      const a = proj(s.a), b = proj(s.b);
      items.push({ t: 1, d: (a[2] + b[2]) / 2 - (s.thin ? 0.25 : 0.9), a, b, color: s.color, thin: s.thin });
    }
    for (const dt of scene.dots) {
      const p = proj(dt.p);
      items.push({ t: 2, d: p[2] - 0.45, p, r: dt.r, color: dt.color });
    }
    items.sort((m, n) => n.d - m.d);

    for (const it of items) {
      if (it.t === 0) {
        ctx.beginPath();
        ctx.moveTo(it.pts[0][0], it.pts[0][1]);
        for (let i = 1; i < it.pts.length; i++) ctx.lineTo(it.pts[i][0], it.pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = it.fill;
        ctx.strokeStyle = it.fill;
        ctx.lineWidth = 0.6;
        ctx.fill(); ctx.stroke();
      } else if (it.t === 1) {
        const w = it.thin ? Math.max(0.8, 0.14 * it.a[3]) : Math.max(1.6, 0.34 * it.a[3]);
        ctx.beginPath();
        ctx.moveTo(it.a[0], it.a[1]);
        ctx.lineTo(it.b[0], it.b[1]);
        ctx.strokeStyle = it.color;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(it.p[0], it.p[1], Math.max(0.6, it.r * it.p[3]), 0, Math.PI * 2);
        ctx.fillStyle = it.color;
        ctx.fill();
      }
    }

    /* OLED 螢幕文字（貼合面板的仿射投影） */
    if (scene.screen && scene.oledLines.length) {
      const A = proj(scene.screen.tl), B = proj(scene.screen.tr), C = proj(scene.screen.bl);
      ctx.save();
      ctx.transform((B[0] - A[0]) / 100, (B[1] - A[1]) / 100, (C[0] - A[0]) / 50, (C[1] - A[1]) / 50, A[0], A[1]);
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      scene.oledLines.forEach((l, i) => {
        ctx.fillStyle = '#7ee0f2';
        ctx.fillText(l[0], 8, 17 + i * 16);
        ctx.fillStyle = '#ffd23f';
        ctx.fillText(l[1], 46, 17 + i * 16);
      });
      ctx.restore();
    }

    /* 腳位標籤 */
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    if (state.opts.pinLabels) {
      scene.pinTags.forEach((tag, i) => {
        const p = proj(tag.p);
        const tw = ctx.measureText(tag.text).width + 10;
        const x = p[0] - tw / 2, y = p[1] - 20 - (i % 2) * 13;
        ctx.strokeStyle = 'rgba(200,195,180,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], y + 14); ctx.stroke();
        ctx.fillStyle = 'rgba(10,9,7,0.92)';
        ctx.fillRect(x, y, tw, 14);
        ctx.strokeStyle = '#33302a';
        ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, tw ? 13 : 13);
        const uc = tag.kind === 'V' ? '#e0452e' : tag.kind === 'G' ? '#4d7dff' : '#f0c33c';
        ctx.fillStyle = uc;
        ctx.fillRect(x, y + 13, tw, 1.5);
        ctx.fillStyle = '#e8e4da';
        ctx.fillText(tag.text, x + 5, y + 10.5);
      });
    }

    /* 元件名稱標籤 */
    ctx.font = '600 11px "IBM Plex Mono", "Noto Sans TC", monospace';
    const placed = [];
    scene.tags.forEach(tag => {
      const p = proj(tag.p);
      const tw = ctx.measureText(tag.text).width + 14;
      let x = p[0] + 10, y = p[1] - 24;
      for (const r of placed) {
        if (Math.abs(x - r.x) < (tw + r.w) / 2 + 4 && Math.abs(y - r.y) < 20) y = r.y - 20;
      }
      placed.push({ x, y, w: tw });
      ctx.strokeStyle = 'rgba(200,195,180,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(x + 4, y + 16); ctx.stroke();
      ctx.fillStyle = 'rgba(8,7,6,0.94)';
      ctx.fillRect(x, y, tw, 17);
      ctx.strokeStyle = '#38342c';
      ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, 16);
      ctx.fillStyle = '#ff5a3c';
      ctx.fillRect(x, y, 2.5, 17);
      ctx.fillStyle = '#f2efe6';
      ctx.fillText(tag.text, x + 8, y + 12.5);
      ctx.beginPath(); ctx.arc(p[0], p[1], 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5a3c'; ctx.fill();
    });
  }

  function requestRender() {
    if (state.needsRender) return;
    state.needsRender = true;
    requestAnimationFrame(() => { state.needsRender = false; render(); });
  }

  function resize() {
    const c = state.canvas;
    if (!c) return;
    const rect = c.parentElement.getBoundingClientRect();
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    state.w = Math.max(300, rect.width);
    state.h = Math.max(240, rect.height);
    c.width = state.w * state.dpr;
    c.height = state.h * state.dpr;
    c.style.width = state.w + 'px';
    c.style.height = state.h + 'px';
    requestRender();
  }

  /* ---------------- 對外介面 ---------------- */
  return {
    init(canvas) {
      state.canvas = canvas;
      state.ctx = canvas.getContext('2d');
      let dragging = false, lx = 0, ly = 0;
      canvas.addEventListener('pointerdown', e => {
        dragging = true; lx = e.clientX; ly = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dx = e.clientX - lx, dy = e.clientY - ly;
        lx = e.clientX; ly = e.clientY;
        if (state.opts.panMode) {
          state.cam.ty += dy * 0.06;
          state.cam.ty = Math.max(-14, Math.min(18, state.cam.ty));
        } else {
          state.cam.yaw += dx * 0.0062;
          state.cam.pitch = Math.max(0.12, Math.min(1.38, state.cam.pitch + dy * 0.005));
        }
        requestRender();
      });
      canvas.addEventListener('pointerup', () => { dragging = false; });
      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        state.cam.dist = Math.max(52, Math.min(230, state.cam.dist * (e.deltaY > 0 ? 1.08 : 0.925)));
        requestRender();
      }, { passive: false });
      window.addEventListener('resize', resize);
      if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
      resize();
    },
    setPlan(plan) {
      state.plan = plan;
      state.scene = buildScene(plan, state.opts);
      requestRender();
    },
    setOpts(o) {
      Object.assign(state.opts, o);
      requestRender();
    },
    resetView() {
      Object.assign(state.cam, HOME);
      requestRender();
    }
  };
})();
