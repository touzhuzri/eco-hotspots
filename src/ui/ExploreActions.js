import { listMoleculePoints } from "../engine/engineApi.js";
import { getState, setSelected } from "../state/store.js";

/** 当前筛选下可见的产物点 */
export function visiblePoints() {
  const { kingdom, layer, classIdx, familyIdx } = getState();
  return listMoleculePoints().filter((p) => {
    if (kingdom && kingdom !== "全部" && p.kingdom !== kingdom) return false;
    if (layer && p.layer !== layer) return false;
    if (classIdx != null && p._classIdx !== classIdx) return false;
    if (familyIdx != null && p._familyIdx !== familyIdx) return false;
    return true;
  });
}

export function randomPoint() {
  let pool = visiblePoints().filter((p) => p.kind !== "catalog" && p.inchikey);
  if (!pool.length) pool = listMoleculePoints();
  const p = pool[(Math.random() * pool.length) | 0] || null;
  if (p) setSelected(p.id);
  return p;
}

export function todayPoint(now = new Date()) {
  const seed =
    now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  let pool = visiblePoints().filter(
    (p) => (p.kind === "featured" || p.kind === "lotus") && p.inchikey
  );
  if (!pool.length) {
    pool = listMoleculePoints().filter((p) => p.kind === "featured");
  }
  if (!pool.length) return null;
  return pool[seed % pool.length];
}

export function selectPoint(p) {
  if (p) setSelected(p.id);
}

export function featuredPoints(limit = 6) {
  const pool = visiblePoints().filter(
    (p) => p.kind === "featured" && p.inchikey
  );
  const byOrganism = new Map();
  for (const p of pool) {
    if (!byOrganism.has(p.organismZh)) byOrganism.set(p.organismZh, p);
    if (byOrganism.size >= limit) break;
  }
  return [...byOrganism.values()];
}

export function focusSearch() {
  const input = document.getElementById("ecoSearchInput");
  if (!input) return;
  input.focus();
  if (typeof input.select === "function") input.select();
}
