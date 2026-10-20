import { loadData } from "./data/load.js";
import { stats, meta } from "./engine/engineApi.js";
import { getState, setLoaded, subscribe } from "./state/store.js";
import { applyHash, bindHashChange, syncHash } from "./state/permalink.js";
import { mountTreeScene } from "./scene/TreeScene.js";
import { mountFilters } from "./ui/Filters.js";
import { mountDetailPanel } from "./ui/DetailPanel.js";
import { mountBootFlora } from "./ui/bootFlora.js";
import { mountExploreRail } from "./ui/ExploreRail.js";
import { mountBottomDock } from "./ui/BottomDock.js";
import {
  openTour,
  openAbout,
  maybeShowTour,
} from "./ui/HelpOverlay.js";

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

/** 加载页全屏提示：F11 由浏览器接管；点击也可以直接切换 Fullscreen API */
function setupFullscreenHint() {
  const btn = document.getElementById("bootFullscreen");
  if (!btn) return;
  const key = btn.querySelector(".boot-key");
  const text = btn.querySelector(".boot-hint-text");

  function sync() {
    const on = !!document.fullscreenElement;
    btn.classList.toggle("is-on", on);
    if (key) key.textContent = on ? "Esc" : "F11";
    if (text) text.textContent = on ? "退出全屏" : "进入全屏 · 视野更完整";
  }

  btn.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (_) {}
    sync();
  });
  document.addEventListener("fullscreenchange", sync);
  sync();
}

/** 加载页飘落装饰；异常分支也要能停掉 */
let activeBootFlora = null;

async function boot() {
  const bootStartedAt = performance.now();
  const MIN_BOOT_MS = 3000;
  setupOrientationGate();
  setupFullscreenHint();

  const bootLoader = document.getElementById("bootLoader");
  const bootStage = document.getElementById("bootStage");
  const bootBar = document.getElementById("bootBar");
  const bootPct = document.getElementById("bootPct");
  const bootRing = document.getElementById("bootRing");
  const BOOT_RING_LEN = 2 * Math.PI * 112;
  let bootProgress = 0;
  // 每次刷新纯随机抽一种飘落物：樱花 / 油菜花 / 银杏
  const bootFlora = bootLoader ? mountBootFlora(bootLoader) : null;
  activeBootFlora = bootFlora;

  /** 二十四节气刻度：静态的「时间」环 */
  function mountSolarTerms() {
    const g = document.getElementById("bootSolarTerms");
    if (!g) return;
    const NS = "http://www.w3.org/2000/svg";
    for (let i = 0; i < 24; i++) {
      const a = ((-90 + i * 15) * Math.PI) / 180;
      const major = i % 6 === 0; // 立春 / 立夏 / 立秋 / 立冬
      const r1 = major ? 97 : 101;
      const r2 = 107;
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", (120 + Math.cos(a) * r1).toFixed(2));
      line.setAttribute("y1", (120 + Math.sin(a) * r1).toFixed(2));
      line.setAttribute("x2", (120 + Math.cos(a) * r2).toFixed(2));
      line.setAttribute("y2", (120 + Math.sin(a) * r2).toFixed(2));
      line.setAttribute(
        "class",
        major ? "boot-term boot-term-major" : "boot-term"
      );
      g.appendChild(line);
    }
  }
  mountSolarTerms();

  function setBoot(stage, p) {
    if (bootStage && stage) bootStage.textContent = stage;
    const v = Math.max(0, Math.min(1, p == null ? 0 : p));
    bootProgress = v;
    if (bootBar) bootBar.style.width = `${Math.round(v * 100)}%`;
    if (bootPct) bootPct.textContent = `${Math.round(v * 100)}%`;
    if (bootRing) {
      bootRing.style.strokeDashoffset = String(BOOT_RING_LEN * (1 - v));
    }
  }

  function fadeOutBoot() {
    // 主线程建场景时会冻结过渡；先留出时间让进度环/进度条补到 100%，再淡出
    setTimeout(() => {
      bootLoader?.classList.add("is-done");
      setTimeout(() => {
        bootLoader?.setAttribute("hidden", "");
        bootFlora?.stop();
        activeBootFlora = null;
        // 先让用户看到一帧空场景，再从泥土/根开始生长，
        // 避免误以为树基是在加载页背后提前长好的。
        setTimeout(() => scene.startIntro(), 280);
      }, 600);
    }, 380);
  }

  function finishBoot() {
    const remaining = Math.max(
      0,
      MIN_BOOT_MS - (performance.now() - bootStartedAt)
    );
    if (remaining <= 0) {
      setBoot("世界树已就绪", 1);
      fadeOutBoot();
      return;
    }

    // 真实加载提前完成：用剩余保底时间把进度环平滑补到 100%，
    // 让花瓣至少完整飘落三秒。
    const from = bootProgress;
    setBoot("世界树正在舒展枝叶…", from);
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / remaining);
      const eased = 1 - Math.pow(1 - t, 2);
      setBoot(null, from + (1 - from) * eased);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        setBoot("世界树已就绪", 1);
        fadeOutBoot();
      }
    }
    requestAnimationFrame(step);
  }

  const sceneEl = document.getElementById("scene");
  const filtersEl = document.getElementById("filters");
  const detailEl = document.getElementById("detail");
  const metaNoteEl = document.getElementById("metaNote");
  const footerEl = document.getElementById("footerNote");

  await loadData({ onStage: setBoot });
  setBoot("正在生成点云世界树…", 0.8);
  setLoaded(true);

  // 让一帧绘制进度条，再同步建场景（22 万点）
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  const scene = mountTreeScene(sceneEl);
  setBoot("正在点亮产物星…", 0.9);
  const filters = mountFilters(filtersEl);
  const detail = mountDetailPanel(detailEl);

  const railEl = document.getElementById("exploreRail");
  const dockEl = document.getElementById("bottomDock");
  const rail = railEl
    ? mountExploreRail(railEl, {
        scene,
        onHelp: () => openTour(),
        onAbout: openAbout,
      })
    : null;
  if (dockEl) {
    mountBottomDock(dockEl, {
      scene,
      onExplore: () => rail?.toggle(),
      onHelp: () => openTour(),
    });
  }

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
  finishBoot();

  // 树完全长成后 UI 才浮现；引导也延后到 UI 归位之后再出现
  let introUiReleased = false;
  function releaseIntroUI() {
    if (introUiReleased) return;
    introUiReleased = true;
    document.body.classList.remove("ui-intro");
    document.body.classList.remove("idle");
    setTimeout(() => maybeShowTour(), 1800);
  }
  window.addEventListener("eco:intro-done", releaseIntroUI);
  // 兜底：极端情况下动画未触发，界面也不会一直消失
  setTimeout(releaseIntroUI, 17000);
}

boot().catch((e) => {
  console.error(e);
  const bootLoader = document.getElementById("bootLoader");
  const bootStage = document.getElementById("bootStage");
  if (bootStage) bootStage.textContent = "加载失败，请刷新重试";
  bootLoader?.classList.add("is-done");
  document.body.classList.remove("ui-intro");
  activeBootFlora?.stop();
  activeBootFlora = null;
  const detailEl = document.getElementById("detail");
  if (detailEl) {
    detailEl.innerHTML = `<div class="detail-empty"><h2>加载失败</h2><p>${String(e.message || e)}</p></div>`;
  }
});
