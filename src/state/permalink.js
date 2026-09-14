import { getState, setSelected, setKingdom } from "./store.js";
import {
  getNode,
  listKingdoms,
  getMoleculePoint,
} from "../engine/engineApi.js";

/**
 * 永久链接：
 *   #n=<nodeId>     物种节点
 *   #n=mol:...      产物星 id（兼容）
 *   #k=<kingdom>    类群筛选
 */

export function applyHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return;
  const params = new URLSearchParams(raw);
  const k = params.get("k");
  if (k && (k === "全部" || listKingdoms().includes(k))) {
    setKingdom(k);
  }
  const n = params.get("n");
  if (!n) return;
  if (n.startsWith("mol:") || n.startsWith("cat:")) {
    if (getMoleculePoint(n)) setSelected(n);
    return;
  }
  if (getNode(n)) setSelected(n);
}

export function syncHash() {
  const { selectedId, kingdom } = getState();
  const params = new URLSearchParams();
  if (kingdom && kingdom !== "全部") params.set("k", kingdom);
  if (selectedId) params.set("n", selectedId);
  const s = params.toString();
  const next = s ? `#${s}` : location.pathname + location.search;
  if (location.hash !== (s ? `#${s}` : "")) {
    history.replaceState(null, "", next);
  }
}

export function bindHashChange(onApplied) {
  window.addEventListener("hashchange", () => {
    applyHash();
    onApplied?.();
  });
}
