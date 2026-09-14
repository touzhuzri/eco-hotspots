/**
 * 世界树点云几何 — 纯函数，无 DOM。
 * 坐标：Y 向上；土层约 y=-0.35；冠中心随 VSCALE 压低（底缘锁定）。
 */

export const TREE_DEFAULTS = {
  n: 8000,
  trunk: 1,
  canopy: 1,
  spread: 1.2,
  aerial: 1,
  leaf: 1,
  soil: 2,
  flow: 0.85,
  fauna: 2,
  flowSpeed: 0.115,
  vscale: 0.82,
};

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rnd) {
  const u = 1 - rnd();
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function trunkPoint(t) {
  return [0.06 * Math.sin(t * 2.8), t * 1.15, 0.04 * Math.cos(t * 2.2)];
}

export function crownGeom(P) {
  // 略高，为弧顶留出纵向空间
  const R = 1.55 * P.spread;
  const CY0 = 1.38;
  const vFac = 0.66 * 1.08;
  const half0 = R * vFac;
  const yBot = CY0 - half0;
  const half1 = half0 * P.vscale;
  const CY = yBot + half1;
  return { R, CY, yBot, half: half1, vDiv: 0.68 * P.vscale };
}

/** 极松保险，不参与造型（弧顶由密度场收紧） */
export function clampToCrown(x, y, z, g) {
  const maxR = g.R * 1.02;
  let rr = Math.hypot(x, z);
  if (rr > maxR) {
    const pull = maxR / rr;
    x *= pull;
    z *= pull;
  }
  const hy = y - g.CY;
  const topSafe = g.half * 1.4;
  const botSafe = -g.half * 1.05;
  if (hy > topSafe) y = g.CY + topSafe;
  if (hy < botSafe) y = g.CY + botSafe;
  return { x, y, z };
}

/**
 * 冠层密度场：顶抛物面收紧到 0（不硬切）；
 * 冠身叠多频噪声 → 凹凸不平，避免圆柱/灯罩感。
 */
export function canopyField(x, y, z, g) {
  const R = g.R || 1;
  const half = g.half || 1;
  const rr = Math.hypot(x, z);
  const hy = y - g.CY;
  const rn = rr / R;
  if (rn >= 1.15) return 0;

  const ang = Math.atan2(z, x || 1e-6);
  const rel = hy / half;

  // 多频起伏：方位 + 半径 + 高度
  const bump =
    0.34 * Math.sin(ang * 3.0 + rel * 1.8) +
    0.26 * Math.sin(ang * 7.0 + 1.7 - rel * 2.2) +
    0.2 * Math.cos(rr * 5.2 + ang * 2.3) +
    0.14 * Math.sin(rel * 5.5 + ang * 4.0) +
    0.1 * Math.sin(rr * 9.0 - ang * 6.0 + 0.8);

  // 把起伏映到有效半径/有效顶高 → 轮廓鼓包与凹陷
  const rnEff = rn * (1 + 0.2 * bump);
  if (rnEff >= 1.0) return 0;

  const dome = (1.22 - 0.55 * rnEff * rnEff) * (1 + 0.18 * bump);
  if (rel < -1.05) return 0;

  // 水平密度 + 成团噪声
  let rho = 0.35 + 0.65 * (1 - Math.min(1, rnEff));
  if (rnEff > 0.86) rho *= Math.max(0, (1.02 - rnEff) / 0.16);
  // 密度团块：不是均匀实心圆柱
  const clump =
    0.5 +
    0.28 * Math.sin(ang * 4.5 + rr * 3.8 + rel * 2.0) +
    0.22 * Math.sin(ang * 9.0 - rel * 4.5 + 2.1);
  rho *= Math.max(0.15, Math.min(1.25, clump));

  if (rel > 0) {
    const t = rel / Math.max(0.12, Math.abs(dome));
    if (t >= 1) return 0;
    rho *= 1 - t * t;
  } else {
    const under = -rel;
    const wave =
      0.72 +
      0.22 * Math.sin(ang * 5.0) +
      0.12 * Math.sin(ang * 9.0 + 1.3) +
      0.08 * Math.cos(ang * 3.0);
    const botCut = Math.max(0, under - 0.5 * wave) * 2.0;
    rho *= 1 - botCut;
  }
  return Math.min(1, Math.max(0, rho * 1.2));
}

/** 根路径：数组[0]=根尖 → 末=树基（供运输光） */
export function buildRootPaths(P, rnd) {
  const SOIL_Y = -0.35;
  const paths = [];
  const nRootDir = 8;
  for (let rd = 0; rd < nRootDir; rd++) {
    const a0 = (rd * Math.PI) / 4 + rnd() * 0.15;
    const fwd = [];
    for (let s = 0; s <= 12; s++) {
      const u = s / 12;
      const dist = u * (0.75 + 0.45 * ((rd % 3) / 2)) * P.spread;
      let y = -u * u * (0.55 + 0.2 * (rd % 2)) + (SOIL_Y * Math.max(0, u - 0.35)) / 0.65;
      if (u > 0.4) {
        const into = (u - 0.4) / 0.6;
        y = Math.min(y, 0.02 - into * (0.55 + 0.25 * ((rd % 3) / 2)));
      }
      const bend = Math.sin(u * 3 + rd) * 0.03;
      fwd.push({
        x: Math.cos(a0) * dist + bend,
        y,
        z: Math.sin(a0) * dist + bend * 0.6,
      });
    }
    paths.push(fwd.slice().reverse());
  }
  return paths;
}

/** 挂点锚：由 layer + 序号确定 3D 位置（稳定） */
export function anchorForNode(node, index, allCount, P) {
  const g = crownGeom(P);
  const rnd = mulberry32(hashId(node.id));
  const layer = node.layer;
  if (layer === "canopy") {
    const a = ((index * 0.618) % 1) * Math.PI * 2;
    const r = g.R * (0.35 + 0.45 * ((index % 5) / 4));
    return {
      x: Math.cos(a) * r,
      y: g.CY + g.half * (0.15 + 0.35 * ((index % 3) / 2)),
      z: Math.sin(a) * r,
    };
  }
  if (layer === "trunk") {
    const t = 0.35 + 0.35 * ((index % 4) / 3);
    const p = trunkPoint(t);
    const a = rnd() * Math.PI * 2;
    return {
      x: p[0] + Math.cos(a) * 0.12,
      y: p[1],
      z: p[2] + Math.sin(a) * 0.12,
    };
  }
  if (layer === "rhizosphere") {
    const a = rnd() * Math.PI * 2;
    const r = 0.25 + 0.45 * rnd();
    return {
      x: Math.cos(a) * r,
      y: -0.12 - 0.15 * rnd(),
      z: Math.sin(a) * r,
    };
  }
  if (layer === "soil") {
    const a = rnd() * Math.PI * 2;
    const r = 0.35 + 0.85 * rnd();
    return {
      x: Math.cos(a) * r * P.spread * 0.8,
      y: -0.32 + rnd() * 0.12,
      z: Math.sin(a) * r * P.spread * 0.8,
    };
  }
  // sky
  const a = ((index * 1.7) % 1) * Math.PI * 2;
  const r = 1.1 + 0.5 * ((index % 3) / 2);
  return {
    x: Math.cos(a) * r,
    y: g.CY + g.half * 0.85 + 0.35 * ((index % 4) / 3),
    z: Math.sin(a) * r,
  };
}

function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 整树点云 + 土壤生物 + 飞行轨迹初值 */
export function buildWorldTree(P) {
  const rnd = mulberry32(20260627);
  const n = Math.floor(P.n);
  const pts = [];
  const TRUNK_H = 1.15;
  const g = crownGeom(P);
  const rootPaths = buildRootPaths(P, rnd);
  const soilBio = [];

  const nTrunk = Math.floor(n * 0.15);
  for (let i = 0; i < nTrunk; i++) {
    const t = Math.pow(rnd(), 0.75);
    const y = t * TRUNK_H;
    const rad = (0.12 + 0.16 * (1 - t) * (1 - t) + 0.04 * t) * P.trunk;
    const bendX = 0.06 * Math.sin(t * 2.8);
    const bendZ = 0.04 * Math.cos(t * 2.2);
    const ang = rnd() * Math.PI * 2;
    const rr = rad * Math.pow(rnd(), 0.4);
    pts.push({
      x: Math.cos(ang) * rr + bendX,
      y,
      z: Math.sin(ang) * rr + bendZ,
      rho: 0.45 + 0.55 * Math.min(1, (rr / rad) * 1.2),
      kind: "trunk",
    });
  }

  const layers = [
    [0.48, 6, 1.15, 0.55],
    [0.62, 7, 1.05, 0.48],
    [0.76, 7, 0.9, 0.4],
    [0.88, 6, 0.7, 0.32],
  ];
  const tips = [];
  const branches = [];
  for (let L = 0; L < layers.length; L++) {
    const cnt = layers[L][1];
    const baseLen = layers[L][2] * P.spread;
    const lift = layers[L][3] * P.vscale;
    for (let b = 0; b < cnt; b++) {
      branches.push({
        y0: layers[L][0],
        a0: (b / cnt) * Math.PI * 2 + L * 0.55 + rnd() * 0.2,
        len: baseLen * (0.85 + 0.3 * rnd()),
        lift,
        layer: L,
      });
    }
  }
  const nBr = Math.floor(n * 0.17);
  for (let j = 0; j < nBr; j++) {
    const br = branches[j % branches.length];
    const u = Math.pow(rnd(), 0.7);
    const a = br.a0 + u * (0.55 + 0.25 * br.layer);
    const dist = br.len * u * (0.9 + 0.1 * Math.sin(u * 6));
    const base = trunkPoint(br.y0);
    const y = base[1] + br.lift * u * u - 0.03 * u;
    const thick = (0.055 * (1 - u) + 0.012) * P.trunk * (1 - br.layer * 0.08);
    const bx = base[0] + Math.cos(a) * dist;
    const bz = base[2] + Math.sin(a) * dist;
    pts.push({
      x: bx + gauss(rnd) * thick,
      y: y + gauss(rnd) * thick * 0.7,
      z: bz + gauss(rnd) * thick,
      rho: 0.5 + 0.5 * (1 - u),
      kind: "branch",
    });
    if (u > 0.75) {
      tips.push({
        x: bx,
        y: Math.min(y, g.CY + g.half * 0.85),
        z: bz,
        s: 0.12,
      });
    }
    if (u > 0.4 && rnd() < 0.55) {
      const a2 = a + (rnd() < 0.5 ? 0.75 : -0.75);
      const d2 = dist + 0.2 + rnd() * 0.25;
      const y2 = y + 0.05;
      if (rnd() < 0.7) {
        tips.push({
          x: base[0] + Math.cos(a2) * d2,
          y: y2,
          z: base[2] + Math.sin(a2) * d2,
          s: 0.1,
        });
      }
    }
  }

  for (let k = 0; k < 26; k++) {
    const u1 = rnd();
    const u2 = rnd();
    const u3 = rnd();
    const r = g.R * Math.pow(u1, 0.45) * 0.92;
    const th = Math.acos(1 - 1.65 * u2);
    const ph = u3 * Math.PI * 2;
    const ax = r * Math.sin(th) * Math.cos(ph);
    const ay = g.CY + r * Math.cos(th) * g.vDiv;
    const az = r * Math.sin(th) * Math.sin(ph);
    if (canopyField(ax, ay, az, g) < 0.15) continue;
    tips.push({ x: ax, y: ay, z: az, s: 0.11 });
  }
  tips.push({ x: 0, y: g.CY + g.half * 0.72, z: 0, s: 0.18 });

  const nLeaf = Math.floor(n * 0.46 * P.leaf);
  let leafMade = 0;
  let guard = 0;
  const maxTry = nLeaf * 28;
  while (leafMade < nLeaf && guard < maxTry) {
    guard++;
    const x = (rnd() * 2 - 1) * g.R * 1.05;
    const y = g.CY + (rnd() * 2 - 1) * g.half * 1.05;
    const z = (rnd() * 2 - 1) * g.R * 1.05;
    const rho = canopyField(x, y, z, g);
    if (rho < 0.08) continue;
    if (rnd() > Math.pow(rho, 0.55) * 0.95) continue;
    pts.push({
      x,
      y,
      z,
      rho: rho * (0.7 + 0.3 * rnd()),
      kind: rnd() < 0.35 ? "leaf2" : "leaf",
    });
    leafMade++;
  }
  const nTipLeaf = Math.floor(n * 0.06 * P.leaf);
  for (let m = 0; m < nTipLeaf; m++) {
    const tip = tips[m % tips.length];
    const s = tip.s * P.canopy;
    pts.push({
      x: tip.x + gauss(rnd) * s * 1.2,
      y: tip.y + gauss(rnd) * s * 0.8,
      z: tip.z + gauss(rnd) * s * 1.2,
      rho: 0.55,
      kind: "leaf",
    });
  }

  const nRoot = Math.floor(n * 0.1);
  for (let rd = 0; rd < 8; rd++) {
    const path = rootPaths[rd];
    for (let j = 0; j < Math.floor(nRoot / 8); j++) {
      const uu = Math.pow(rnd(), 0.65);
      const idx = Math.min(11, Math.floor(uu * 12));
      const pth = path[idx];
      const thick = (0.07 * (1 - uu) + 0.018) * P.trunk;
      pts.push({
        x: pth.x + gauss(rnd) * thick,
        y: pth.y + gauss(rnd) * thick * 0.8,
        z: pth.z + gauss(rnd) * thick,
        rho: 0.4 + 0.5 * (1 - uu),
        kind: "root",
      });
    }
  }

  const SOIL_Y = -0.35;
  const nSoil = Math.floor(n * 0.08 * P.soil);
  for (let si = 0; si < nSoil; si++) {
    const sx = (rnd() * 2 - 1) * 1.6 * P.spread;
    const sz = (rnd() * 2 - 1) * 1.6 * P.spread;
    const sy = SOIL_Y + rnd() * 0.28 - 0.05;
    const rr = Math.hypot(sx, sz);
    if (rr > 1.5) continue;
    const dens = Math.exp(-rr * rr * 0.55);
    if (rnd() > dens * 0.9) continue;
    pts.push({ x: sx, y: sy, z: sz, rho: 0.25 + 0.4 * dens, kind: "soil" });
  }

  const nBio = Math.floor(180 * P.soil);
  for (let b = 0; b < nBio; b++) {
    const ang = rnd() * Math.PI * 2;
    const rad = 0.15 + Math.pow(rnd(), 0.7) * 1.1;
    const by = SOIL_Y + 0.02 + rnd() * 0.22;
    soilBio.push({
      x: Math.cos(ang) * rad,
      y: by,
      z: Math.sin(ang) * rad,
      kind: rnd() < 0.72 ? "microbe" : "worm",
      ph: rnd() * 6.28,
    });
  }

  const nAir = Math.floor(n * 0.04 * P.aerial);
  const airAnchors = [];
  for (let aa = 0; aa < 8; aa++) {
    const at = 0.42 + 0.06 * aa;
    const ap = trunkPoint(Math.min(0.92, at));
    const aaang = rnd() * Math.PI * 2;
    airAnchors.push({
      x: ap[0] + Math.cos(aaang) * 0.12,
      y: ap[1] - 0.02,
      z: ap[2] + Math.sin(aaang) * 0.12,
      drop: 0.35 + rnd() * 0.45,
      sway: 0.04,
    });
  }
  for (let q = 0; q < nAir; q++) {
    const A = airAnchors[q % airAnchors.length];
    const u = Math.pow(rnd(), 0.8);
    const sway = Math.sin(u * 4 + A.x * 10) * A.sway * u;
    pts.push({
      x: A.x + sway,
      y: A.y - u * A.drop,
      z: A.z + sway * 0.6,
      rho: 0.4,
      kind: "aerial",
    });
  }

  return { pts, rootPaths, soilBio, crown: g };
}
