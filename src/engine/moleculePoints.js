/**
 * 有机产物点云 — 重构：可读的树体 + 根状分枝
 * - 主干粗、伸入冠内
 * - 主枝/二级枝沿曲线密采（可见分叉）
 * - 根：主根+侧根
 * - LOTUS 结构云贴几何 + 微抖
 */

import { getDataset } from "../data/provider.js";
import {
  mulberry32,
  gauss,
  crownGeom,
  canopyField,
  clampToCrown,
  TREE_DEFAULTS,
} from "../scene/starTree.js";

export const WORLD_SCALE = 7.8;
export const CATALOG_COUNT = 28000;
export const TREE_VOLUME = 3.0;

let STRUCTURE_ITEMS = null;

export function setStructureCloud(items) {
  STRUCTURE_ITEMS = Array.isArray(items) ? items : null;
}
export function hasStructureCloud() {
  return !!(STRUCTURE_ITEMS && STRUCTURE_ITEMS.length);
}
export function structureCount() {
  return STRUCTURE_ITEMS ? STRUCTURE_ITEMS.length : 0;
}

function scalePos(p) {
  return { x: p.x * WORLD_SCALE, y: p.y * WORLD_SCALE, z: p.z * WORLD_SCALE };
}

function moleculeCatalog() {
  const out = [];
  for (const n of getDataset().nodes) {
    for (const m of n.molecules || []) {
      out.push({
        nodeId: n.id,
        organismZh: n.organismZh,
        kingdom: n.kingdom,
        layer: n.layer,
        ...m,
      });
    }
  }
  return out;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const CLASS_POOL = {
  植物: ["单萜", "倍半萜", "生物碱", "黄酮", "酚苷", "木脂素"],
  真菌: ["聚酮", "环缩酯肽", "非核糖体肽", "萜类"],
  细菌: ["脂肽", "聚酮", "氨基糖苷类示意"],
  昆虫: ["生物碱", "萜内酯", "聚酮酰胺"],
  生态角色: ["叙事位"],
};

/**
 * 沿参数曲线取一点 + 管径
 * path(t) → {x,y,z}; thick(t) → r
 */
function tubePoint(rnd, path, thick) {
  const t = rnd();
  const p = path(t);
  const r = thick(t);
  const a = rnd() * Math.PI * 2;
  const rr = r * Math.sqrt(rnd());
  return {
    x: p.x + Math.cos(a) * rr,
    y: p.y + gauss(rnd) * r * 0.55,
    z: p.z + Math.sin(a) * rr,
    t,
    r,
  };
}

/** 树干主轴：伸入冠内，避免细杆撑灯罩 */
function trunkAxis(t, P, g) {
  const top = Math.max(0.9, g.CY + g.half * 0.25);
  const y = -0.1 + t * (top + 0.1);
  const bendX = 0.06 * Math.sin(t * 2.6);
  const bendZ = 0.04 * Math.cos(t * 2.1);
  return { x: bendX, y, z: bendZ };
}

function trunkThick(t, P) {
  // 更粗，基部到中段都有体量
  return (0.3 * Math.pow(1 - t, 0.45) + 0.02) * P.trunk;
}

/**
 * 主枝：从干上某高度出发，向外上扬，可再分叉
 * 返回 {x,y,z, forkT}
 */
function limbPathPoint(rnd, P, g, y0, a0, len, lift, twist) {
  const u = Math.pow(rnd(), 0.55); // 更多点在中后段，分叉更明显
  const a = a0 + u * twist;
  const dist = len * u;
  const y = y0 + lift * u * u * 1.15 - 0.04 * u;
  const bx = 0.07 * Math.sin((y0 / 1.2) * 2.6);
  const bz = 0.05 * Math.cos((y0 / 1.2) * 2.1);
  const thick = (0.1 * (1 - u) + 0.022) * P.trunk;
  return {
    x: bx + Math.cos(a) * dist,
    y,
    z: bz + Math.sin(a) * dist,
    a,
    u,
    thick,
  };
}

/** 根状侧枝（二级） */
function twigPoint(rnd, P, parent, parentA, parentU) {
  const u = Math.pow(rnd(), 0.6);
  const a = parentA + (rnd() < 0.5 ? 0.85 : -0.85) * (0.5 + rnd() * 0.6);
  const len = (0.2 + 0.35 * rnd()) * P.spread;
  const thick = (0.045 * (1 - u) + 0.012) * P.trunk;
  return {
    x: parent.x + Math.cos(a) * len * u,
    y: parent.y + (0.08 + 0.2 * rnd()) * u * u,
    z: parent.z + Math.sin(a) * len * u,
    thick,
  };
}

/** 地下主根+侧根 */
function rootPoint(rnd, P) {
  const nArms = 12;
  const arm = Math.floor(rnd() * nArms);
  const a0 = (arm / nArms) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
  const u = Math.pow(rnd(), 0.6);
  const len = (0.45 + 0.9 * rnd()) * P.spread;
  const drop = 0.25 + 0.55 * rnd();
  const thick = (0.14 * (1 - u) + 0.035) * P.trunk;
  const d = len * u;
  let x = Math.cos(a0) * d;
  let y = -0.05 - drop * u * u;
  let z = Math.sin(a0) * d;
  // 侧根
  if (u > 0.3 && rnd() < 0.55) {
    const a1 = a0 + (rnd() < 0.5 ? 0.75 : -0.75);
    const d1 = d * (0.5 + rnd() * 0.55);
    x = Math.cos(a1) * d1;
    y = -0.05 - drop * 0.7 * u * u - rnd() * 0.1;
    z = Math.sin(a1) * d1;
    if (rnd() < 0.45) {
      const a2 = a1 + (rnd() - 0.5) * 1.3;
      const d2 = d1 * (0.45 + rnd() * 0.5);
      x = Math.cos(a2) * d2;
      y = y - 0.08 - rnd() * 0.12;
      z = Math.sin(a2) * d2;
    }
  }
  return {
    x: x + gauss(rnd) * thick,
    y: y + gauss(rnd) * thick * 0.5,
    z: z + gauss(rnd) * thick,
    layer: "rhizosphere",
    kingdom: rnd() < 0.5 ? "真菌" : "植物",
  };
}

function skyRibbonPoint(rnd, P) {
  const band = Math.floor(rnd() * 5);
  const t = rnd();
  const phase = band * 1.2;
  const a = t * Math.PI * 2 * (1.15 + band * 0.2) + phase;
  const r =
    (0.3 + (band % 3) * 0.12 + 0.18 * P.spread) *
    (0.8 + 0.4 * Math.sin(t * 6.28 + phase));
  const y = 0.3 + band * 0.1 + 0.32 * Math.sin(t * 6.28 * 1.3 + phase);
  const w = 0.035 + rnd() * 0.05;
  return {
    x: Math.cos(a) * r + gauss(rnd) * w,
    y: y + gauss(rnd) * w * 0.5,
    z: Math.sin(a) * r + gauss(rnd) * w,
    layer: "sky",
    kingdom: rnd() < 0.7 ? "昆虫" : "生态角色",
  };
}

/** 树体采样（根状分枝可见） */
function sampleTreePoint(rnd, P, g) {
  const r = rnd();
  // 冠 36% · 干/枝 26% · 根 18% · 土 16% · 空 4%
  if (r < 0.36) {
    for (let k = 0; k < 22; k++) {
      const x = (rnd() * 2 - 1) * g.R * 1.0;
      const y = g.CY + (rnd() * 2 - 1) * g.half * 1.25;
      const z = (rnd() * 2 - 1) * g.R * 1.0;
      const rho = canopyField(x, y, z, g);
      if (rho > 0.08 && rnd() < rho * 0.9) {
        const j = 0.01 * g.R;
        const kingdom = rnd() < 0.78 ? "植物" : rnd() < 0.92 ? "昆虫" : "生态角色";
        return {
          x: x + gauss(rnd) * j,
          y: y + gauss(rnd) * j,
          z: z + gauss(rnd) * j,
          layer: "canopy",
          kingdom,
        };
      }
    }
    return { x: 0, y: g.CY, z: 0, layer: "canopy", kingdom: "植物" };
  }

  if (r < 0.62) {
    // 主干本体
    if (rnd() < 0.42) {
      const p = tubePoint(
        rnd,
        (t) => trunkAxis(t, P, g),
        (t) => trunkThick(t, P)
      );
      return { x: p.x, y: p.y, z: p.z, layer: "trunk", kingdom: "植物", part: "core" };
    }

    // 主枝
    const nLimb = 16;
    const limb = Math.floor(rnd() * nLimb);
    const a0 = (limb / nLimb) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
    const y0 = (0.35 + (limb % 5) * 0.09 + rnd() * 0.08) * Math.max(0.8, g.CY - g.half * 0.1);
    const len = (0.5 + 0.45 * rnd()) * P.spread;
    const lift = 0.22 + 0.35 * rnd();
    const twist = 0.55 + 0.4 * rnd();
    const main = limbPathPoint(rnd, P, g, y0, a0, len, lift, twist);

    if (rnd() < 0.5) {
      const tw = twigPoint(rnd, P, main, main.a, main.u);
      return {
        x: tw.x + gauss(rnd) * tw.thick * 0.4,
        y: tw.y + gauss(rnd) * tw.thick * 0.3,
        z: tw.z + gauss(rnd) * tw.thick * 0.4,
        layer: "trunk",
        kingdom: "植物",
        part: "twig",
      };
    }

    const j = main.thick * 0.35;
    let x = main.x + gauss(rnd) * j;
    let y = main.y + gauss(rnd) * j * 0.6;
    let z = main.z + gauss(rnd) * j;
    if (y > g.CY + g.half) {
      const c = clampToCrown(x, y, z, g);
      x = c.x;
      y = c.y;
      z = c.z;
    }
    return { x, y, z, layer: "trunk", kingdom: "植物", part: "limb" };
  }

  if (r < 0.8) {
    return rootPoint(rnd, P);
  }

  if (r < 0.96) {
    const a = rnd() * Math.PI * 2;
    const rad = 0.45 + Math.pow(rnd(), 0.55) * 1.1 * P.spread;
    // 更强凹凸：多频高度场
    const bump =
      0.12 * Math.sin(rad * 7.5 + a * 5) +
      0.08 * Math.cos(rad * 14 - a * 3.5) +
      0.06 * Math.sin(rad * 22 + a * 2) +
      0.04 * Math.cos(a * 9 + rad * 4);
    const rim = rad / (1.6 * P.spread);
    const y = -0.5 + rnd() * 0.14 + bump * (0.55 + rim * 0.9);
    return {
      x: Math.cos(a) * rad + gauss(rnd) * 0.04,
      y,
      z: Math.sin(a) * rad + gauss(rnd) * 0.04,
      layer: "soil",
      kingdom: rnd() < 0.45 ? "细菌" : rnd() < 0.8 ? "真菌" : "植物",
    };
  }

  return skyRibbonPoint(rnd, P);
}

function sampleInteriorPoint(rnd, P, g) {
  const canopyBot = Math.max(0.5, g.CY - g.half * 0.95);
  const trunkTop = Math.min(1.1, canopyBot - 0.08);
  for (let k = 0; k < 18; k++) {
    const r = rnd();
    if (r < 0.42) {
      const x = (rnd() * 2 - 1) * g.R * 0.85;
      const y = g.CY + (rnd() * 2 - 1) * g.half * 0.85;
      const z = (rnd() * 2 - 1) * g.R * 0.85;
      if (Math.hypot(x, z) < g.R * 0.15) continue;
      if (canopyField(x, y, z, g) > 0.22) {
        return {
          x,
          y,
          z,
          layer: "canopy",
          kingdom: rnd() < 0.8 ? "植物" : "昆虫",
        };
      }
    } else if (r < 0.68) {
      const p = tubePoint(
        rnd,
        (t) => trunkAxis(t, P, g),
        (t) => trunkThick(t, P) * 0.55
      );
      return { x: p.x, y: p.y, z: p.z, layer: "trunk", kingdom: "植物" };
    } else {
      const a = rnd() * Math.PI * 2;
      const rad = 0.4 + Math.pow(rnd(), 0.55) * 0.9 * P.spread;
      return {
        x: Math.cos(a) * rad,
        y: -0.48 + rnd() * 0.14,
        z: Math.sin(a) * rad,
        layer: "soil",
        kingdom: rnd() < 0.45 ? "细菌" : rnd() < 0.8 ? "真菌" : "植物",
      };
    }
  }
  return sampleTreePoint(rnd, P, g);
}

function posNearLayer(layer, kingdom, seedStr, P) {
  const rnd = mulberry32(hashStr(seedStr));
  const g = crownGeom(P);
  for (let i = 0; i < 40; i++) {
    const s = sampleTreePoint(rnd, P, g);
    if (s.layer === layer) {
      return {
        ...s,
        x: s.x + gauss(rnd) * 0.04,
        y: s.y + gauss(rnd) * 0.03,
        z: s.z + gauss(rnd) * 0.04,
      };
    }
  }
  return sampleTreePoint(rnd, P, g);
}

export function buildMoleculePoints(opts = {}) {
  const P = { ...TREE_DEFAULTS, spread: opts.spread ?? TREE_DEFAULTS.spread };
  const g = crownGeom(P);
  const scaleTree = (p) => ({
    x: p.x * TREE_VOLUME,
    y: p.y * TREE_VOLUME,
    z: p.z * TREE_VOLUME,
  });
  const real = moleculeCatalog();
  const points = [];

  for (let i = 0; i < real.length; i++) {
    const m = real[i];
    const id = `mol:${m.nodeId}:${i}`;
    const pos = posNearLayer(m.layer, m.kingdom, id, P);
    points.push({
      id,
      kind: "featured",
      nodeId: m.nodeId,
      organismZh: m.organismZh,
      kingdom: m.kingdom,
      layer: m.layer,
      nameZh: m.nameZh,
      nameEn: m.nameEn,
      chemClass: m.chemClass,
      inchikey: m.inchikey,
      note: m.note,
      ecoRole: "",
      pos: scalePos(scaleTree(pos)),
      rho: 1,
    });
  }

  if (hasStructureCloud()) {
    const rnd = mulberry32(20260413);
    for (let i = 0; i < STRUCTURE_ITEMS.length; i++) {
      const it = STRUCTURE_ITEMS[i];
      const u1 = ((i * 2654435761) >>> 0 & 0xffff) / 65535;
      const p =
        u1 < 0.78
          ? sampleTreePoint(rnd, P, g)
          : sampleInteriorPoint(rnd, P, g);
      const j = 0.002 + 0.004 * u1;
      points.push({
        id: `ls:${it.k}`,
        kind: "lotus",
        nodeId: null,
        organismZh: it.o || "未命名来源",
        kingdom: it.q || p.kingdom,
        layer: p.layer,
        nameZh: it.n || "LOTUS 结构",
        nameEn: "",
        chemClass: "InChIKey",
        inchikey: it.k,
        note: "LOTUS frozen 260413 结构–生物对",
        ecoRole: "开放天然产物结构",
        pos: scalePos(
          scaleTree({
            x: p.x + gauss(rnd) * j,
            y: p.y + gauss(rnd) * j * 0.8,
            z: p.z + gauss(rnd) * j,
          })
        ),
        rho: 0.7,
      });
    }
    return points;
  }

  const catalogCount = opts.catalogCount ?? CATALOG_COUNT;
  const rnd = mulberry32(20260628);
  for (let i = 0; i < catalogCount; i++) {
    const s = sampleTreePoint(rnd, P, g);
    const pool = CLASS_POOL[s.kingdom] || CLASS_POOL.植物;
    points.push({
      id: `cat:${s.kingdom}:${s.layer}:${i}`,
      kind: "catalog",
      nodeId: null,
      organismZh: `${s.kingdom}源 · ${s.layer}`,
      kingdom: s.kingdom,
      layer: s.layer,
      nameZh: `目录产物 ${i + 1}`,
      nameEn: `Catalog NP ${i + 1}`,
      chemClass: pool[i % pool.length],
      inchikey: null,
      note: "目录星占位：可继续接入 LOTUS 结构–生物对。",
      ecoRole: "待灌库占位",
      pos: scalePos(scaleTree(s)),
      rho: 0.55,
    });
  }

  return points;
}

export function findMoleculePoint(points, id) {
  return points.find((p) => p.id === id) || null;
}
