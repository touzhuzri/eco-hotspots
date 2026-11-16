/**
 * 显示适配：把「CSS 布局尺寸」和「实际渲染分辨率」分开处理。
 *
 * 以前各处直接写 `Math.min(1.5, devicePixelRatio)` / `Math.min(2, ...)`，
 * 在 1080p、2K、4K、浏览器缩放、跨屏拖动时会出现两个问题：
 *   1. 高 DPI 屏被固定倍率压得过软，低 DPI 大屏又被强行放大；
 *   2. 窗口从一个缩放比例拖到另一个屏幕后，倍率不会更新。
 *
 * 这里用「像素预算」自适应：canvas 的 CSS 尺寸始终由布局决定，
 * WebGL 只负责把 drawingBuffer 控制在合理像素量内。
 * 1080p@2x 约 1.7–2x，2K 约 1.3–1.5x，4K 约 1x，既清晰又不至于爆显存。
 */

const DEFAULT_MAX_DPR = 2;
const DEFAULT_MIN_DPR = 1;
const DEFAULT_PIXEL_BUDGET = 8_000_000;

// 与 home.html 一致，按 1920×1080 设计框缩放；
// 上限收到 1.5，避免 2K/4K 下整块 UI 放大到挤占场景。
const UI_DESIGN_WIDTH = 1920;
const UI_DESIGN_HEIGHT = 1080;
const UI_SCALE_MIN = 1;
const UI_SCALE_MAX = 1.5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 按视口面积和设备像素比计算渲染倍率。
 *
 * @param {number} [width] CSS 像素宽度
 * @param {number} [height] CSS 像素高度
 * @param {{max?: number, min?: number, budget?: number}} [options]
 * @returns {number} 传给 renderer.setPixelRatio 的倍率
 */
export function getAdaptiveDpr(width, height, options = {}) {
  const w = Math.max(
    1,
    Number.isFinite(width) ? width : window.innerWidth || 1
  );
  const h = Math.max(
    1,
    Number.isFinite(height) ? height : window.innerHeight || 1
  );
  const max = options.max ?? DEFAULT_MAX_DPR;
  const min = options.min ?? DEFAULT_MIN_DPR;
  const budget = options.budget ?? DEFAULT_PIXEL_BUDGET;

  const deviceDpr = Math.max(1, window.devicePixelRatio || 1);
  const budgetDpr = Math.sqrt(budget / (w * h));
  const dpr = clamp(Math.min(deviceDpr, max, budgetDpr), min, max);

  // 保留两位小数，避免 resize 时因浮点误差反复重建后处理
  return Math.round(dpr * 100) / 100;
}

/**
 * UI 浮层缩放：按 1920×1080 设计框等比缩放，
 * 但设置 1–1.5 的上下限，避免 4K 下把面板放大到占满屏幕。
 */
export function getUiScale() {
  const fit = Math.min(
    (window.innerWidth || UI_DESIGN_WIDTH) / UI_DESIGN_WIDTH,
    (window.innerHeight || UI_DESIGN_HEIGHT) / UI_DESIGN_HEIGHT
  );
  return Math.round(clamp(fit, UI_SCALE_MIN, UI_SCALE_MAX) * 1000) / 1000;
}

/**
 * 监听「视口尺寸 / 设备像素比」变化。跨屏拖动时浏览器不一定会触发
 * resize，所以额外监听 resolution 媒体查询。
 *
 * @param {() => void} callback
 * @returns {() => void} 取消监听
 */
export function watchDisplay(callback) {
  let frame = 0;
  let mq = null;
  let disposed = false;

  const schedule = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!disposed) callback();
    });
  };

  const watchResolution = () => {
    if (disposed) return;
    if (mq?.removeEventListener) {
      mq.removeEventListener("change", onResolutionChange);
    } else {
      mq?.removeListener?.(onResolutionChange);
    }
    if (typeof window.matchMedia !== "function") return;
    mq = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`
    );
    if (mq.addEventListener) mq.addEventListener("change", onResolutionChange);
    else mq.addListener?.(onResolutionChange);
  };

  function onResolutionChange() {
    watchResolution();
    schedule();
  }

  window.addEventListener("resize", schedule, { passive: true });
  window.visualViewport?.addEventListener("resize", schedule, {
    passive: true,
  });
  watchResolution();

  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    if (mq?.removeEventListener) {
      mq.removeEventListener("change", onResolutionChange);
    } else {
      mq?.removeListener?.(onResolutionChange);
    }
    mq = null;
  };
}
