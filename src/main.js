import { loadData } from "./data/load.js";
import { stats, meta } from "./engine/engineApi.js";
import { getState, setLoaded, subscribe } from "./state/store.js";
import { applyHash, bindHashChange, syncHash } from "./state/permalink.js";
import { mountTreeScene } from "./scene/TreeScene.js";
import { mountFilters } from "./ui/Filters.js";
import { mountDetailPanel } from "./ui/DetailPanel.js";

/** 竖屏手机提示横屏；尽量在首次手势后尝试锁定横屏 */
function setupOrientationGate() {
  const gate = document.getElementById("rotateGate");
  if (!gate) return;

  function isPortraitPhone() {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    const narrow = window.innerWidth <= 720;
    return coarse && portrait && narrow;
  }

  function sync() {
    gate.hidden = !isPortraitPhone();
  }

  async function tryLockLandscape() {
    try {
      const so = screen.orientation;
      if (so && typeof so.lock === "function") {
        await so.lock("landscape");
        sync();
      }
    } catch (_) {
      // 浏览器拒绝锁定时仍靠 CSS 提示横屏
    }
  }

  window.addEventListener("orientationchange", sync);
  window.addEventListener("resize", sync);
  // 用户轻点引导层时再试一次锁横屏（需手势）
  gate.addEventListener("click", tryLockLandscape);
  document.addEventListener(
    "pointerdown",
    function once() {
      document.removeEventListener("pointerdown", once);
      if (isPortraitPhone()) tryLockLandscape();
    },
    { passive: true }
  );
  sync();
}

async function boot() {
  setupOrientationGate();

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
