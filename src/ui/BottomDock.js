import { listMoleculePoints } from "../engine/engineApi.js";
import { getState, setLayer, subscribe } from "../state/store.js";
import { currentSolarTerm } from "../data/solarTerms.js";

const LAYERS = [
  { id: null, label: "全部" },
  { id: "sky", label: "天空" },
  { id: "canopy", label: "冠层" },
  { id: "trunk", label: "树干" },
  { id: "rhizosphere", label: "根际" },
  { id: "soil", label: "土壤" },
];

const VIEWS = [
  { id: "overview", label: "总览" },
  { id: "crown", label: "冠层" },
  { id: "roots", label: "根系" },
  { id: "top", label: "俯视" },
];

function layerCounts() {
  const counts = {};
  for (const p of listMoleculePoints()) {
    counts[p.layer] = (counts[p.layer] || 0) + 1;
  }
  return counts;
}

export function mountBottomDock(el, { scene, onExplore, onHelp }) {
  const counts = layerCounts();
  const term = currentSolarTerm();

  el.innerHTML = `
    <div class="dock-group">
      <button type="button" class="dock-btn dock-explore" id="dockExplore" title="展开/收起探索栏">探索</button>
      ${LAYERS.map(
        (l) => `
        <button type="button" class="dock-btn dock-layer" data-layer="${l.id ?? ""}">
          ${l.label}<em>${l.id ? (counts[l.id] || 0).toLocaleString("zh-CN") : ""}</em>
        </button>`
      ).join("")}
    </div>
    <span class="dock-sep" aria-hidden="true"></span>
    <div class="dock-group dock-views">
      ${VIEWS.map(
        (v) =>
          `<button type="button" class="dock-btn dock-view" data-view="${v.id}">${v.label}</button>`
      ).join("")}
    </div>
    <div class="dock-term" title="当前节气 ${term.name} · ${term.start}–${term.end}">
      <span class="dock-term-dot" aria-hidden="true"></span>${term.name}
      <em>${term.start}–${term.end}</em>
    </div>
    <button type="button" class="dock-help" id="dockHelp" title="使用帮助">?</button>
  `;

  function refresh() {
    const { layer } = getState();
    el.querySelectorAll(".dock-layer").forEach((b) => {
      b.classList.toggle("active", (b.dataset.layer || null) === layer);
    });
  }

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "dockExplore") {
      onExplore?.();
      return;
    }
    if (btn.id === "dockHelp") {
      onHelp?.();
      return;
    }
    if (btn.dataset.layer != null) {
      setLayer(btn.dataset.layer || null);
      return;
    }
    if (btn.dataset.view) {
      scene?.focusView?.(btn.dataset.view);
    }
  });

  subscribe(refresh);
  refresh();
  return { refresh };
}
