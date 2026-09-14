/**
 * 轻量 store（可替换为 zustand 等；接口保持最小）。
 */

const state = {
  loaded: false,
  selectedId: null,
  kingdom: "全部",
  layer: null,
};

const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(state);
}

export function getState() {
  return { ...state };
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLoaded(v) {
  state.loaded = !!v;
  emit();
}

export function setSelected(id) {
  state.selectedId = id;
  emit();
}

export function setKingdom(k) {
  state.kingdom = k;
  emit();
}

export function setLayer(layerId) {
  state.layer = layerId;
  emit();
}
