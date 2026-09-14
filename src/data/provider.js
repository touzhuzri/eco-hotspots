import { SAMPLE_DATASET } from "./dataset.js";
import { isValidNode } from "./contract.js";

/** @type {import('./contract.js').EcoDataset | null} */
let active = null;

/** @param {import('./contract.js').EcoDataset | null} ds */
export function setDataset(ds) {
  if (!ds || !Array.isArray(ds.nodes) || !ds.nodes.every(isValidNode)) {
    throw new Error("dataset 不符合 contract");
  }
  active = ds;
}

/** @returns {import('./contract.js').EcoDataset} */
export function getDataset() {
  if (!active) throw new Error("dataset 未加载");
  return active;
}

export function hasDataset() {
  return !!active;
}

/** 启动时的默认示例集；真实 LOTUS 快照可在 load 后 setDataset 覆盖。 */
export function mountSample() {
  setDataset(SAMPLE_DATASET);
}
