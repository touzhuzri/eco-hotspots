import { loadData } from "./data/load.js";
import { stats, meta } from "./engine/engineApi.js";
import { getState, setLoaded, subscribe } from "./state/store.js";
import { applyHash, bindHashChange, syncHash } from "./state/permalink.js";
import { mountTreeScene } from "./scene/TreeScene.js";
import { mountFilters } from "./ui/Filters.js";
import { mountDetailPanel } from "./ui/DetailPanel.js";

async function boot() {
  const sceneEl = document.getElementById("scene");
  const filtersEl = document.getElementById("filters");
  const detailEl = document.getElementById("detail");
  const metaNoteEl = document.getElementById("metaNote");
  const footerEl = document.getElementById("footerNote");

  await loadData();
  setLoaded(true);

  const scene = mountTreeScene(sceneEl);
  // 场景先建点云，筛选数字才与画布一致
  const filters = mountFilters(filtersEl);
  const detail = mountDetailPanel(detailEl);

  const s = stats();
  const dsMeta = meta().meta || {};
  metaNoteEl.textContent = `${dsMeta.snapshotNote || ""} · 物种节点 ${s.nodes}`;
  footerEl.textContent = dsMeta.disclaimer || "";

  function rerenderAll() {
    scene.render();
    filters.render();
    detail.render();
    syncHash();
  }

  subscribe(() => rerenderAll());
  bindHashChange(rerenderAll);
  applyHash();
  rerenderAll();
}

boot().catch((e) => {
  console.error(e);
  const detailEl = document.getElementById("detail");
  if (detailEl) {
    detailEl.innerHTML = `<div class="detail-empty"><h2>加载失败</h2><p>${String(e.message || e)}</p></div>`;
  }
});
