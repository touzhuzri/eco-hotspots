/**
 * 隔空手势模式（展览用 · 摄像头 opt-in）
 *
 * MediaPipe HandLandmarker（vendor/mediapipe，本地 WASM，画面不出设备）
 * → 手势状态机 → 合成 PointerEvent / WheelEvent 打到世界树画布，
 * 直接复用现有鼠标管线（拖拽惯性 / 拾取选中 / 滚轮缩放）。
 *
 * 手势（每个阈值都是具名常量，调手感改这里）：
 *   单手 · 张开移动      → 一个光点跟随
 *   单手 · 捏合悬停 1s   → 选中分子（点击）
 *   单手 · 捏住移动      → 鼠标左键拖动（旋转世界树，松手不再触发选中）
 *   单手 · 捏住推拉(z)   → 缩放（备选）
 *   单手 · 张开停空白    → 取消选中
 *   单手 · 张开快挥      → 切换预设视角（彩蛋）
 *   双手 · 同时出现      → 两个光点；拉开放大 / 靠拢缩小
 *
 * 缩放的核心：两手各出一个光点，直接看两点距离变化，无需捏合。
 */


// ── 手势阈值 ──────────────────────────────────────────────
const PINCH_ON = 0.32; // 拇指尖-食指尖 / 掌宽，低于此判定捏合
const PINCH_OFF = 0.5; // 迟滞：高于此才算松开
const HOLD_MS = 600; // 捏住不动多久触发点击（捏住点击）
const DRAG_PX = 20; // 位移超过它才算「想拖」
const DRAG_INTENT_MS = 150; // 防抖：位移须持续超过 DRAG_PX 这么久才进拖动（瞬时抖动不算）
const CURSOR_FC_MIN = 0.3; // One-Euro 最小截止频率(Hz)，越小静止时越稳（掐抖）
const CURSOR_BETA = 0.07; // 速度系数，越大快速移动越跟手
// 缩放＝速率模型：一旦检测到拉开/靠拢就以「固定速率」缩放，只跟动作时长有关，与手速无关。
const ZOOM_RATE_PER_SEC = 1.8; // 每秒基础缩放倍率（>1；拉开=放大=除以它，靠拢=缩小=乘它）
const ZOOM_ACCEL_SECONDS = 2; // 动作持续这么久后加速到 2×，封顶不超过 2× 基础速率
const ZOOM_VEL_MIN = 30; // 双手距离速度(px/s)超过它才认作缩放动作（低于＝手抖/静止）
const VEL_SMOOTH = 0.28; // 距离速度平滑，滤抖；越大越跟手，越小越稳
const SWIPE_PX_PER_MS = 2.2;
const SWIPE_MS = 160;
const SWIPE_COOLDOWN = 1400;
const VIEW_CYCLE = ["overview", "crown", "roots", "top"];
const FIST_MIN_FINGERS = 2; // 伸出指数少于它 → 收拳，忽略这只手

let landmarkerPromise = null;

function loadHandLandmarker() {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    const base = new URL("../../vendor/mediapipe/", import.meta.url);
    const vision = await import(new URL("vision_bundle.mjs", base).href);
    const fileset = await vision.FilesetResolver.forVisionTasks(
      new URL("wasm/", base).href
    );
    const opts = {
      baseOptions: {
        modelAssetPath: new URL("hand_landmarker.task", base).href,
        delegate: "GPU",
      },
      numHands: 2,
      runningMode: "VIDEO",
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };
    try {
      return await vision.HandLandmarker.createFromOptions(fileset, opts);
    } catch (_) {
      opts.baseOptions.delegate = "CPU";
      return await vision.HandLandmarker.createFromOptions(fileset, opts);
    }
  })().catch((err) => {
    landmarkerPromise = null;
    throw err;
  });
  return landmarkerPromise;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function mountHandGestures({ scene }) {
  const canvas = document.querySelector(".star-canvas");
  if (!canvas) return { toggle() {}, stop() {}, enabled: () => false };

  // ── UI：摄像头小窗 / 手势图例 ────────────────────────────
  const root = document.createElement("div");
  root.className = "hand-mode";
  root.hidden = true;
  root.innerHTML = `
    <div class="hand-cam">
      <video class="hand-cam-video" autoplay muted playsinline></video>
      <div class="hand-cam-status"><span class="hand-rec"></span> 隔空模式 · 画面仅本机处理</div>
    </div>
    <div class="hand-legend">
      <p class="hand-legend-title">隔空手势</p>
      <ul>
        <li><b>单手</b> 光点跟随 · 捏住拖动 · 捏 1 秒选中</li>
        <li><b>双手</b> 两个光点 · 拉开放大 · 靠拢缩小</li>
        <li><b>取消</b> 张开手停在空白处</li>
        <li><b>视角</b> 张开手快速挥动</li>
      </ul>
    </div>
  `;
  document.body.appendChild(root);

  const video = root.querySelector(".hand-cam-video");
  const legendEl = root.querySelector(".hand-legend");

  // ── One-Euro 滤波：手慢时强平滑掐抖、手快时弱平滑跟手 ──
  // 关键：先平滑「导数」再据此调截止频率，否则指尖白噪声会制造虚假高速，
  // 让滤波器误判成快速移动而放开平滑，抖动就压不下来。
  const DERIV_SMOOTH = 0.12; // 导数平滑（越大越跟手、越小越稳）
  function makeEuroFilter(fcMin, beta) {
    let prev = null;
    let dHat = 0;
    return {
      filter(x, dt) {
        if (prev == null) {
          prev = x;
          return x;
        }
        dt = Math.max(dt, 1e-3);
        const dx = (x - prev) / dt;
        dHat += DERIV_SMOOTH * (dx - dHat); // 平滑速度，滤掉噪声尖峰
        const fc = fcMin + beta * Math.abs(dHat); // 用平滑后的速度调截止频率
        const alpha = 1 / (1 + 1 / (2 * Math.PI * fc) / dt);
        prev += alpha * (x - prev);
        return prev;
      },
      reset(x) {
        prev = x;
        dHat = 0;
      },
    };
  }

  // ── 光标工厂：单手=1 个，双手=2 个（进度弧只挂在主光点） ──
  const ARC_LEN = 2 * Math.PI * 42;
  function makeCursor(withArc) {
    const el = document.createElement("div");
    el.className = "hand-cursor";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = withArc
      ? `<svg class="hand-arc" viewBox="0 0 100 100">
           <circle class="hand-arc-track" cx="50" cy="50" r="42"/>
           <circle class="hand-arc-fill" cx="50" cy="50" r="42"/>
         </svg>
         <div class="hand-ring"></div><div class="hand-dot"></div>`
      : `<div class="hand-ring"></div><div class="hand-dot"></div>`;
    root.appendChild(el);
    return {
      el,
      arc: el.querySelector(".hand-arc-fill"),
      x: innerWidth / 2,
      y: innerHeight / 2,
      tx: 0,
      ty: 0,
      visible: false,
      fx: makeEuroFilter(CURSOR_FC_MIN, CURSOR_BETA),
      fy: makeEuroFilter(CURSOR_FC_MIN, CURSOR_BETA),
    };
  }
  const cursorA = makeCursor(true); // 主：单手交互 + 进度弧
  const cursorB = makeCursor(false); // 副：只在双手时出现
  cursorA.arc.style.strokeDasharray = `${ARC_LEN}`;
  cursorA.arc.style.strokeDashoffset = `${ARC_LEN}`;

  function setCursorState(cls) {
    cursorA.el.classList.remove("is-hover", "is-pinch", "is-drag", "is-zoom");
    cursorB.el.classList.remove("is-hover", "is-pinch", "is-drag", "is-zoom");
    if (cls) {
      cursorA.el.classList.add(cls);
      cursorB.el.classList.add(cls);
    }
  }
  function setProgress(p) {
    cursorA.arc.style.strokeDashoffset = `${ARC_LEN * (1 - clamp01(p))}`;
    cursorA.el.classList.toggle("is-progress", p > 0 && p < 1);
  }
  function setCursorVisible(v) {
    cursorA.visible = v;
    cursorA.el.classList.toggle("is-visible", v);
    if (!v) {
      cursorB.visible = false;
      cursorB.el.classList.remove("is-visible");
    }
  }
  function setSecondVisible(v) {
    cursorB.visible = v;
    cursorB.el.classList.toggle("is-visible", v);
  }

  // ── 状态 ────────────────────────────────────────────────
  let enabled = false;
  let landmarker = null;
  let stream = null;
  let raf = 0;
  let lastDetectT = 0;
  let lastProcT = 0;
  let legendTimer = 0;

  let pinchOn = false;
  // 捏住点击：捏合＝左键按下（冻结光标），捏住 HOLD_MS 且不拖动→在冻结位置点击。
  // 收拢不带走光标（冻结 + 掌心稳定点判拖动），所以「捏住点击」落点稳定。
  let pressed = false; // 是否捏住（左键按下）
  let dragged = false; // 本次捏住是否已成为拖动（拖动则不点击）
  let clicked = false; // 本次捏住是否已点击（一个捏合周期只点一次）
  let holdStart = 0; // 捏住起始时刻
  let pressPos = { x: 0, y: 0 }; // 捏住瞬间冻结的光标位置（点击在此执行）
  let pressStable = { x: 0, y: 0 }; // 捏住瞬间的掌心稳定点（判拖动基准）
  let dragIntentSince = 0; // 防抖：掌心位移持续超阈值的起始时刻
  // 双手缩放速率模型：跟踪距离速度判断方向，固定速率 + 随时长缓升加速
  let prevDist = 0;
  let distVel = 0;
  let lastZoomT = 0;
  let zoomDir = 0; // 当前缩放方向 +1 放大 / -1 缩小 / 0 中性
  let zoomDirSince = 0; // 当前方向持续的起始时刻（用于加速）
  let swipeHist = [];
  let swipeCooldownUntil = 0;
  let swipeViewIdx = 0;
  let twoHandDist = null;

  // ── 合成事件：等同鼠标，打到光标下的元素 ──────────────────
  const PTR_ID = 7771;
  function eventAt(type, x, y, extra = {}) {
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: PTR_ID,
      pointerType: "mouse",
      isPrimary: true,
      clientX: x,
      clientY: y,
      ...extra,
    });
  }
  // 拖拽旋转：固定打到世界树画布（canvas 的 onDown/onMove/onUp 负责旋转）
  function firePointer(type, x, y, extra = {}) {
    canvas.dispatchEvent(eventAt(type, x, y, extra));
  }
  // 隔空点击 = 鼠标点击：打到光标下的任意元素（按钮/空白/链接…）。
  // pointerdown/up 让画布拾取选中/取消；再补一个 click 让 UI 按钮响应
  // （合成 pointer 事件不会自动生成 click）。
  function fireClick(x, y) {
    const el = document.elementFromPoint(x, y) || canvas;
    el.dispatchEvent(eventAt("pointerdown", x, y, { buttons: 1, button: 0 }));
    el.dispatchEvent(eventAt("pointerup", x, y, { buttons: 0, button: 0 }));
    el.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        view: window,
      })
    );
  }

  function overCanvas(x, y) {
    return document.elementFromPoint(x, y) === canvas;
  }
  /** 可交互元素（按钮/链接等）：悬停时也给 hover 反馈 */
  function isInteractive(el) {
    return !!(el && el.closest?.("button, a, [role='button'], summary"));
  }

  /** 速率缩放：固定基础速率，随动作时长缓升到 2× 封顶。dir=+1 放大(拉开)，-1 缩小(靠拢) */
  function zoomAtRate(dir, dt, now) {
    if (!dir) {
      zoomDir = 0; // 停止/中性，加速重置
      return;
    }
    if (dir !== zoomDir) {
      zoomDir = dir;
      zoomDirSince = now; // 方向翻转，加速从头计
    }
    const held = (now - zoomDirSince) / 1000;
    // 线性缓升 1.0 → 2.0，封顶不超过 2× 基础速率
    const accel = 1 + Math.min(1, held / ZOOM_ACCEL_SECONDS);
    scene.zoomBy?.(Math.pow(ZOOM_RATE_PER_SEC * accel, -dir * dt));
  }

  // ── 收拳检测：四指是否蜷回（指尖未越过 PIP） ──
  // 收拳时拇指-食指距离也会变近，会被误判成捏合/游标乱跳 → 直接整只手忽略。
  // 伸出的手指数 < FIST_MIN_FINGERS 即判为收拳（单指指向不算，游标用张开手）。
  function isFist(lm) {
    const w = lm[0];
    const d = (i) => Math.hypot(lm[i].x - w.x, lm[i].y - w.y);
    const fingers = [
      [8, 6], // index tip, pip
      [12, 10], // middle
      [16, 14], // ring
      [20, 18], // pinky
    ];
    let extended = 0;
    for (const [tip, pip] of fingers) {
      if (d(tip) > d(pip)) extended++;
    }
    return extended < FIST_MIN_FINGERS;
  }

  // ── 把一只手的地标映射成屏幕光点 + 捏合判定 ────────────────
  function handPoint(lm) {
    const norm = (i) => {
      const p = lm[i];
      return {
        x: clamp01(0.5 - (p.x - 0.5) * 1.22) * innerWidth,
        y: clamp01(0.5 + (p.y - 0.5) * 1.22) * innerHeight,
        z: p.z ?? 0,
      };
    };
    const a = lm[4]; // thumb tip
    const b = lm[8]; // index tip
    const w = lm[0];
    const m = lm[9];
    const palm = Math.hypot(m.x - w.x, m.y - w.y) || 1e-4;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ratio = d / palm;
    const pinching = ratio < PINCH_ON;
    const tipA = norm(4);
    const tipB = norm(8);
    // 捏合 → 拇指/食指中点；张开 → 食指尖
    return {
      x: pinching ? (tipA.x + tipB.x) / 2 : tipB.x,
      y: pinching ? (tipA.y + tipB.y) / 2 : tipB.y,
      z: (a.z + b.z) / 2,
      ratio,
      pinching,
    };
  }

  // ── 掌心稳定点：食指根(5)与中指根(9)中点，收拢手指时几乎不动 ──
  // 用来判断「整只手移动」= 拖动，避免捏合时手指收拢被误判成拖动。
  function stablePoint(lm) {
    const a = lm[5];
    const b = lm[9];
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    return {
      x: clamp01(0.5 - (x - 0.5) * 1.22) * innerWidth,
      y: clamp01(0.5 + (y - 0.5) * 1.22) * innerHeight,
    };
  }

  // One-Euro 自适应平滑：慢→强平滑掐抖，快→弱平滑跟手
  function smoothCursor(c, dt) {
    c.x = c.fx.filter(c.tx, dt);
    c.y = c.fy.filter(c.ty, dt);
  }
  // 直接吸附到目标点（重建双手 / 状态切换时消除平滑残影）
  function snapCursor(c) {
    c.fx.reset(c.tx);
    c.fy.reset(c.ty);
    c.x = c.tx;
    c.y = c.ty;
  }

  // ── 每帧处理检测到的手 ───────────────────────────────────
  function processHands(hands, now) {
    // 收拳的手不识别（避免误判捏合 / 游标乱跳），只用张开的手
    const usable = hands.filter((h) => !isFist(h.landmarks));
    if (!usable.length) {
      setCursorVisible(false);
      if (dragged) {
        firePointer("pointerup", cursorA.x, cursorA.y, { buttons: 0, button: 0 });
      }
      pressed = false;
      dragged = false;
      pinchOn = false;
      setProgress(0);
      swipeHist = [];
      twoHandDist = null;
      distVel = 0;
      zoomDir = 0;
      return;
    }
    setCursorVisible(true);
    // 有手在活动就算交互，重置 idle 计时，避免误入待机
    scene.markActive?.();
    const dt = Math.max(0.008, Math.min(0.1, (now - lastProcT) / 1000 || 0.033));
    lastProcT = now;

    // ── 双手：两个光点，拉开/靠拢缩放（不要求捏合） ──
    if (usable.length >= 2) {
      const p0 = handPoint(usable[0].landmarks);
      const p1 = handPoint(usable[1].landmarks);
      cursorA.tx = p0.x;
      cursorA.ty = p0.y;
      cursorB.tx = p1.x;
      cursorB.ty = p1.y;

      // 刚重建双手（收拳后又张开 / 单手→双手）：把平滑光标直接吸附到手位，
      // 否则旧的平滑残影会被误当成手在动 → 产生一次反向幻影缩放（回弹）。
      const rebuilt = twoHandDist == null;
      if (rebuilt) {
        snapCursor(cursorA);
        snapCursor(cursorB);
      } else {
        smoothCursor(cursorA, dt);
        smoothCursor(cursorB, dt);
      }
      setSecondVisible(true);
      setCursorState("is-zoom");
      setProgress(0);

      // 缩放距离用「真实手位」而非平滑点：平滑点有滞后，收拳后重建时会漂，
      // 造成幻影缩放。
      const dist = Math.hypot(p0.x - p1.x, p0.y - p1.y);
      twoHandDist = dist; // 标记「双手已建立」；值不再用于缩放（缩放看 prevDist）
      if (rebuilt) {
        // 重建帧只记基准，不产生缩放，且重置速度避免残留方向
        prevDist = dist;
        distVel = 0;
        zoomDir = 0;
        lastZoomT = now;
      } else {
        // 速率模型：双手距离速度判方向（拉开/靠拢），一旦识别就以固定速率缩放，
        // 只跟动作持续时长有关，与手速无关。
        const dt = Math.max(0.008, (now - lastZoomT) / 1000);
        const instVel = (dist - prevDist) / dt;
        distVel += (instVel - distVel) * VEL_SMOOTH;
        prevDist = dist;
        lastZoomT = now;
        if (distVel > ZOOM_VEL_MIN) {
          zoomAtRate(1, dt, now); // 拉开 → 放大
        } else if (distVel < -ZOOM_VEL_MIN) {
          zoomAtRate(-1, dt, now); // 靠拢 → 缩小
        } else {
          zoomAtRate(0, dt, now); // 停住，加速重置
        }
      }

      // 双手缩放期间结束单手按下/拖动，避免抢戏
      if (dragged) {
        firePointer("pointerup", cursorA.x, cursorA.y, { buttons: 0, button: 0 });
      }
      pressed = false;
      dragged = false;
      pinchOn = false;
      return;
    }

    // ── 单手 ──
    setSecondVisible(false);
    twoHandDist = null;
    distVel = 0;
    zoomDir = 0;
    const hp = handPoint(usable[0].landmarks);
    const sp = stablePoint(usable[0].landmarks); // 掌心稳定点，判「整只手移动」
    const wasPinch = pinchOn;
    pinchOn = hp.ratio < (wasPinch ? PINCH_OFF : PINCH_ON); // 迟滞

    // 光标跟随：只在张开手时跟食指；捏合时冻结（见下），避免收缩手指带走光标
    if (!pinchOn) {
      cursorA.tx = hp.x;
      cursorA.ty = hp.y;
      smoothCursor(cursorA, dt);
    }

    // ── 按下/松开模型（等同鼠标左键）──
    // 捏合＝左键按下：冻结光标、只做「已按下」标识；
    // 松开＝左键抬起：未拖动则在冻结位置执行点击。所见即所点，收拢不影响落点。
    if (pinchOn && !wasPinch) {
      pressed = true;
      dragged = false;
      clicked = false;
      dragIntentSince = 0;
      holdStart = now;
      pressPos = { x: cursorA.x, y: cursorA.y }; // 冻结当前平滑光标＝点击落点
      pressStable = { x: sp.x, y: sp.y };
      cursorA.tx = pressPos.x; // 冻结：不再跟手指收拢
      cursorA.ty = pressPos.y;
      snapCursor(cursorA);
    }

    if (pinchOn && wasPinch && pressed) {
      if (!dragged && !clicked) {
        // 用掌心稳定点判拖动：收拢手指几乎不动掌心，不会误判
        const moveDist = Math.hypot(
          sp.x - pressStable.x,
          sp.y - pressStable.y
        );
        if (moveDist > DRAG_PX) {
          if (!dragIntentSince) dragIntentSince = now;
          else if (now - dragIntentSince >= DRAG_INTENT_MS) {
            dragged = true;
            firePointer("pointerdown", pressPos.x, pressPos.y, {
              buttons: 1,
              button: 0,
            });
          }
        } else {
          dragIntentSince = 0; // 回落＝手抖，不算拖动
        }
      }

      if (dragged) {
        // 拖动：光标随掌心位移，场景旋转
        cursorA.tx = pressPos.x + (sp.x - pressStable.x);
        cursorA.ty = pressPos.y + (sp.y - pressStable.y);
        smoothCursor(cursorA, dt);
        firePointer("pointermove", cursorA.x, cursorA.y, { buttons: 1 });
      } else if (!clicked && now - holdStart >= HOLD_MS) {
        // 捏住 HOLD_MS 且没拖动 → 在冻结位置点击（捏住点击，收拢不影响落点）
        fireClick(pressPos.x, pressPos.y);
        clicked = true;
      }
      setCursorState(dragged ? "is-drag" : "is-pinch");
      setProgress(dragged ? 0 : clicked ? 1 : (now - holdStart) / HOLD_MS);
    }

    if (!pinchOn && wasPinch) {
      // 松开：拖动则结束拖动；点击已在捏住 HOLD_MS 时执行，这里只复位
      if (dragged) {
        firePointer("pointerup", cursorA.x, cursorA.y, { buttons: 0, button: 0 });
      }
      pressed = false;
      dragged = false;
      clicked = false;
      dragIntentSince = 0;
      setProgress(0);
    }

    // ── 张开手：hover 反馈 / 挥动换视角（点击才取消选中，等同鼠标） ──
    if (!pinchOn) {
      setCursorState("");
      const el = document.elementFromPoint(cursorA.x, cursorA.y);
      const onStar = (() => {
        if (el !== canvas) return false;
        const rect = canvas.getBoundingClientRect();
        const pick = scene.pickAt?.(
          cursorA.x - rect.left,
          cursorA.y - rect.top
        );
        return !!(pick && (pick.type === "star" || pick.type === "link"));
      })();
      // 分子星点 或 可交互元素（按钮/链接）都给 hover 反馈
      if (onStar || isInteractive(el)) {
        setCursorState("is-hover");
      }

      swipeHist.push({ x: cursorA.tx, y: cursorA.ty, t: now });
      while (swipeHist.length > 2 && now - swipeHist[0].t > 140) swipeHist.shift();
      if (
        swipeHist.length >= 3 &&
        now > swipeCooldownUntil &&
        now - swipeHist[0].t <= SWIPE_MS + 40
      ) {
        const a = swipeHist[0];
        const b = swipeHist[swipeHist.length - 1];
        const dt = Math.max(1, b.t - a.t);
        const vx = (b.x - a.x) / dt;
        const vy = (b.y - a.y) / dt;
        if (Math.abs(vx) > SWIPE_PX_PER_MS || vy < -SWIPE_PX_PER_MS) {
          if (Math.abs(vx) > Math.abs(vy)) {
            swipeViewIdx =
              (swipeViewIdx + (vx > 0 ? 1 : VIEW_CYCLE.length - 1)) %
              VIEW_CYCLE.length;
            scene.focusView?.(VIEW_CYCLE[swipeViewIdx]);
          } else {
            scene.focusView?.("top");
          }
          swipeCooldownUntil = now + SWIPE_COOLDOWN;
          swipeHist = [];
        }
      }
    }
  }

  // ── 光标渲染（平滑已在 processHands 做，这里只投影到屏幕） ──
  function renderCursor() {
    for (const c of [cursorA, cursorB]) {
      c.el.style.transform = `translate(${c.x}px, ${c.y}px) translate(-50%, -50%)`;
    }
  }

  // ── 检测循环 ──
  function loop(now) {
    if (!enabled) return;
    raf = requestAnimationFrame(loop);
    renderCursor();
    if (!landmarker || video.readyState < 2) return;
    if (now - lastDetectT < 33) return;
    lastDetectT = now;
    let res = null;
    try {
      res = landmarker.detectForVideo(video, now);
    } catch (_) {
      return;
    }
    const hands = (res?.landmarks || []).map((landmarks) => ({ landmarks }));
    processHands(hands, now);
  }

  async function start() {
    if (enabled) return;
    root.hidden = false;
    root.classList.add("is-loading");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play().catch(() => {});
      landmarker = await loadHandLandmarker();
      enabled = true;
      root.classList.remove("is-loading");
      root.classList.add("is-on");
      legendEl.classList.add("is-on");
      clearTimeout(legendTimer);
      legendTimer = setTimeout(() => legendEl.classList.remove("is-on"), 9000);
      window.dispatchEvent(new CustomEvent("eco:hand-mode", { detail: { enabled: true } }));
      raf = requestAnimationFrame(loop);
    } catch (err) {
      stop();
      root.classList.add("is-error");
      legendEl.innerHTML = `<p class="hand-legend-title">隔空模式不可用</p><p class="hand-error">${
        err?.name === "NotAllowedError"
          ? "摄像头权限被拒绝，请在浏览器地址栏允许后重试"
          : "摄像头或识别组件加载失败"
      }</p>`;
      legendEl.classList.add("is-on");
    }
  }

  function stop() {
    enabled = false;
    cancelAnimationFrame(raf);
    clearTimeout(legendTimer);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
    if (dragged) {
      firePointer("pointerup", cursorA.x, cursorA.y, { buttons: 0, button: 0 });
    }
    pressed = false;
    dragged = false;
    pinchOn = false;
    setProgress(0);
    setCursorVisible(false);
    root.classList.remove("is-on", "is-loading");
    root.hidden = true;
    window.dispatchEvent(new CustomEvent("eco:hand-mode", { detail: { enabled: false } }));
  }

  function toggle() {
    if (enabled) stop();
    else start();
  }

  // 调试：注入假手数据测状态机
  window.__handGestures = {
    enabled: () => enabled,
    feed: (hands, t) => processHands(hands, t ?? performance.now()),
    state: () => ({
      pinchOn,
      pressed,
      dragged,
      clicked,
      pressPos: { x: Math.round(pressPos.x), y: Math.round(pressPos.y) },
      distVel: Math.round(distVel),
      twoHandDist: twoHandDist == null ? null : Math.round(prevDist),
      cursors: {
        a: { x: cursorA.x, y: cursorA.y, visible: cursorA.visible },
        b: { x: cursorB.x, y: cursorB.y, visible: cursorB.visible },
      },
    }),
    stop,
    start,
  };

  return { toggle, stop, start, enabled: () => enabled };
}
