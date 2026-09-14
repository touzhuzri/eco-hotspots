import { getDataset } from "../data/provider.js";
import {
  buildMoleculePoints,
  findMoleculePoint,
  structureCount,
} from "./moleculePoints.js";

/**
 * Engine API — 前端唯一查询入口（稳定）。
 * UI 不得直接遍历 dataset.nodes 做业务过滤。
 */

/** @returns {import('../data/contract.js').EcoDataset} */
export function meta() {
  return getDataset();
}

export function listLayers() {
  return getDataset().layers.slice();
}

export function listKingdoms() {
  return [...new Set(getDataset().nodes.map((n) => n.kingdom))];
}

/**
 * @param {{kingdom?: string|null, layer?: string|null}} [opts]
 */
export function filterNodes(opts = {}) {
  const { kingdom = null, layer = null } = opts;
  return getDataset().nodes.filter((n) => {
    if (kingdom && kingdom !== "全部" && n.kingdom !== kingdom) return false;
    if (layer && n.layer !== layer) return false;
    return true;
  });
}

/** @param {string} id */
export function getNode(id) {
  return getDataset().nodes.find((n) => n.id === id) || null;
}

/** 扁平分子目录，便于后续搜索/统计。 */
export function moleculeCatalog() {
  const out = [];
  for (const n of getDataset().nodes) {
    for (const m of n.molecules) {
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

export function layerLabel(layerId) {
  const l = getDataset().layers.find((x) => x.id === layerId);
  return l ? l.label : layerId;
}

export function stats() {
  const nodes = getDataset().nodes;
  const byKingdom = {};
  for (const n of nodes) {
    byKingdom[n.kingdom] = (byKingdom[n.kingdom] || 0) + 1;
  }
  return {
    nodes: nodes.length,
    molecules: moleculeCatalog().length,
    byKingdom,
  };
}

/** 产物点云统计（筛选按钮用）；依赖 listMoleculePoints 已生成 */
let pointStatsCache = null;
export function pointStats() {
  if (pointStatsCache) return pointStatsCache;
  const pts = listMoleculePoints();
  const byKingdom = {};
  for (let i = 0; i < pts.length; i++) {
    const k = pts[i].kingdom;
    byKingdom[k] = (byKingdom[k] || 0) + 1;
  }
  pointStatsCache = {
    total: pts.length,
    byKingdom,
  };
  return pointStatsCache;
}

// ── 有机产物点云（诗云式可缩放星） ──

/** @type {ReturnType<typeof buildMoleculePoints> | null} */
let molPointsCache = null;
let molCacheKey = "";
/** @type {Map<string, object> | null} */
let molIdIndex = null;

export function listMoleculePoints(opts) {
  const ds = getDataset();
  const nStruct = structureCount();
  // 有结构云时忽略 catalogCount，避免设置面板误触发「退回 2.8 万目录星」
  const cc = nStruct ? 0 : (opts && opts.catalogCount) || 28000;
  const key =
    ds.nodes.length +
    ":" +
    ((ds.meta && ds.meta.snapshotNote) || "") +
    ":" +
    cc +
    ":" +
    nStruct;
  if (!molPointsCache || molCacheKey !== key) {
    molPointsCache = buildMoleculePoints(opts);
    molCacheKey = key;
    molIdIndex = new Map();
    for (const p of molPointsCache) molIdIndex.set(p.id, p);
    pointStatsCache = null;
  }
  return molPointsCache;
}

export function getMoleculePoint(id) {
  listMoleculePoints();
  if (molIdIndex) {
    const hit = molIdIndex.get(id);
    if (hit) return hit;
  }
  return findMoleculePoint(listMoleculePoints(), id);
}

export function filterMoleculePoints(kingdom) {
  const all = listMoleculePoints();
  if (!kingdom || kingdom === "全部") return all;
  return all.filter((p) => p.kingdom === kingdom);
}

export function onDatasetChangeMolecules() {
  molPointsCache = null;
  molCacheKey = "";
  molIdIndex = null;
  pointStatsCache = null;
}
