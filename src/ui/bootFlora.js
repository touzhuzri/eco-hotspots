/**
 * 加载页「季节盲盒」飘落装饰
 *
 * 每次刷新从 樱花 / 油菜花 / 银杏叶 中纯随机抽一种，整次加载只出现这一种。
 * - 背景层：主要花瓣，落在校徽与文字之后
 * - 前景层：2–3 片更大、更淡、快速掠过，制造景深
 *
 * 调试：?flora=sakura | rapeseed | ginkgo 可强制指定种类。
 */

const TYPES = ["sakura", "rapeseed", "ginkgo"];

const PALETTE = {
  sakura: ["#ffb7cc", "#f79ab8", "#ffd0de"],
  rapeseed: ["#ffd23f", "#ffe27a", "#f5c21f"],
  ginkgo: ["#d98f26", "#e8b04a", "#c97f20"],
};

const DPR_CAP = 2;
/** 花瓣尺寸倍率：统一放大/缩小所有飘落物 */
const PETAL_SCALE = 2;

function pickType() {
  const forced = new URLSearchParams(location.search).get("flora");
  if (TYPES.includes(forced)) return forced;
  return TYPES[(Math.random() * TYPES.length) | 0];
}

/** 樱花：单瓣，尖端带缺口 */
function drawSakura(ctx, s) {
  const w = s * 0.55;
  const h = s;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);
  ctx.bezierCurveTo(-w * 0.92, h * 0.2, -w * 0.86, -h * 0.26, -w * 0.18, -h * 0.5);
  ctx.quadraticCurveTo(0, -h * 0.36, w * 0.18, -h * 0.5);
  ctx.bezierCurveTo(w * 0.86, -h * 0.26, w * 0.92, h * 0.2, 0, h * 0.5);
  ctx.closePath();
  ctx.fill();
}

/** 油菜花：四瓣小花 + 一点花心 */
function drawRapeseed(ctx, s, color) {
  ctx.fillStyle = color;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(a) * s * 0.22,
      Math.sin(a) * s * 0.22,
      s * 0.3,
      s * 0.21,
      a,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(150, 198, 105, 0.95)";
  ctx.fill();
}

/** 银杏：扇形叶，顶部有中缝，带短柄 */
function drawGinkgo(ctx, s, color) {
  const w = s;
  const h = s * 0.95;
  // 叶柄
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);
  ctx.lineTo(0, h * 0.16);
  ctx.stroke();
  // 扇面
  ctx.beginPath();
  ctx.moveTo(-w * 0.47, h * 0.06);
  ctx.quadraticCurveTo(-w * 0.54, -h * 0.42, -w * 0.14, -h * 0.5);
  ctx.quadraticCurveTo(0, -h * 0.28, w * 0.14, -h * 0.5);
  ctx.quadraticCurveTo(w * 0.54, -h * 0.42, w * 0.47, h * 0.06);
  ctx.quadraticCurveTo(0, h * 0.2, -w * 0.47, h * 0.06);
  ctx.closePath();
  ctx.fill();
}

function drawShape(ctx, type, s, color) {
  if (type === "rapeseed") drawRapeseed(ctx, s, color);
  else if (type === "ginkgo") drawGinkgo(ctx, s, color);
  else drawSakura(ctx, s);
}

function makeParticle(type, W, H, front) {
  const size =
    (front
      ? 28 + Math.random() * 18
      : type === "ginkgo"
        ? 15 + Math.random() * 10
        : type === "rapeseed"
          ? 13 + Math.random() * 7
          : 13 + Math.random() * 8) * PETAL_SCALE;

  const speedBase =
    type === "ginkgo" ? 0.8 : type === "rapeseed" ? 1.15 : 0.95;

  return {
    x: Math.random() * W,
    // 背景层初始铺满画面，避免刚进入时上半屏空掉
    y: front ? -size - Math.random() * H * 0.35 : Math.random() * H,
    size,
    vx: (front ? 45 : 6) + Math.random() * (front ? 65 : 16),
    vy: ((front ? 95 : 24) + Math.random() * (front ? 60 : 28)) * speedBase,
    swayAmp: front ? 8 : 12 + Math.random() * 22,
    swayFreq: 0.5 + Math.random() * 1.2,
    phase: Math.random() * Math.PI * 2,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * (front ? 2.4 : 1.15),
    flipFreq: 0.6 + Math.random() * 1.4,
    flipPhase: Math.random() * Math.PI * 2,
    alpha: front ? 0.07 + Math.random() * 0.05 : 0.34 + Math.random() * 0.42,
    color: PALETTE[type][(Math.random() * PALETTE[type].length) | 0],
    front,
  };
}

function paint(ctx, type, p, t) {
  const flip =
    type === "ginkgo"
      ? 0.28 + 0.72 * Math.abs(Math.cos(t * p.flipFreq + p.flipPhase))
      : type === "sakura"
        ? 0.72 + 0.28 * Math.abs(Math.cos(t * p.flipFreq + p.flipPhase))
        : 0.92 + 0.08 * Math.abs(Math.cos(t * p.flipFreq + p.flipPhase));

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.scale(flip, 1);
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = p.color;
  drawShape(ctx, type, p.size, p.color);
  ctx.restore();
}

/**
 * @param {HTMLElement} loaderEl  #bootLoader
 * @returns {{ type: string, stop: () => void }}
 */
export function mountBootFlora(loaderEl) {
  const type = pickType();
  loaderEl.dataset.flora = type;

  const back = document.createElement("canvas");
  back.className = "boot-flora boot-flora-back";
  back.setAttribute("aria-hidden", "true");
  const front = document.createElement("canvas");
  front.className = "boot-flora boot-flora-front";
  front.setAttribute("aria-hidden", "true");
  loaderEl.append(back, front);

  const bctx = back.getContext("2d");
  const fctx = front.getContext("2d");
  let W = 1;
  let H = 1;
  let dpr = 1;
  let backParticles = [];
  let frontParticles = [];
  let raf = 0;
  let running = true;
  let last = 0;

  function resize() {
    const rect = loaderEl.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);

    for (const [canvas, ctx] of [
      [back, bctx],
      [front, fctx],
    ]) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const target =
      Math.round(Math.min(30, Math.max(14, (W * H) / 38000))) || 14;
    const frontTarget = 2 + (Math.random() < 0.5 ? 1 : 0);

    backParticles = Array.from({ length: target }, () =>
      makeParticle(type, W, H, false)
    );
    // 前景从画面上方进入，数量 2–3 片
    frontParticles = Array.from({ length: frontTarget }, () =>
      makeParticle(type, W, H, true)
    );

    // reduced-motion 下没有 rAF，resize 清空 canvas 后需要补一帧静态画面
    if (reduceMotion) drawStatic();
  }

  function frame(ts) {
    if (!running) return;
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    const t = ts / 1000;

    bctx.clearRect(0, 0, W, H);
    fctx.clearRect(0, 0, W, H);
    fctx.filter = "blur(0.9px)";

    for (const p of backParticles) {
      p.x += (p.vx + Math.sin(t * p.swayFreq + p.phase) * p.swayAmp) * dt;
      p.y += p.vy * dt;
      p.rot += p.rotSpeed * dt;
      if (p.y > H + p.size * 2) {
        p.y = -p.size * 2 - Math.random() * H * 0.15;
        p.x = Math.random() * W;
      }
      paint(bctx, type, p, t);
    }

    for (const p of frontParticles) {
      p.x += (p.vx + Math.sin(t * p.swayFreq + p.phase) * p.swayAmp) * dt;
      p.y += p.vy * dt;
      p.rot += p.rotSpeed * dt;
      if (p.y > H + p.size * 2 || p.x > W + p.size * 2) {
        p.y = -p.size * 2 - Math.random() * H * 0.4;
        p.x = -p.size - Math.random() * W * 0.3;
      }
      paint(fctx, type, p, t);
    }

    fctx.filter = "none";
    raf = requestAnimationFrame(frame);
  }

  function drawStatic() {
    bctx.clearRect(0, 0, W, H);
    for (const p of backParticles) paint(bctx, type, p, 0);
  }

  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  )?.matches;

  resize();
  window.addEventListener("resize", resize);

  if (!reduceMotion) raf = requestAnimationFrame(frame);

  return {
    type,
    stop() {
      if (!running) return;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      back.remove();
      front.remove();
    },
  };
}
