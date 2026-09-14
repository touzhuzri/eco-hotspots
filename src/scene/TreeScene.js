/**
 * WebGL 星点世界树（诗云式）
 *
 * ── 可调参数速查（手动改这里） ─────────────────────────────
 * 亮度 / 光晕 / 虚化：
 *   L~164-168  UnrealBloomPass(strength, radius, threshold)
 *   L~76-80    片元 shader 亮度倍率 & alpha
 *   L~63-64    顶点 shader 点径 clamp（近处糊 → 调小 max）
 *   L~125      FogExp2 密度（远景雾；近处糊多半是 Bloom+点径）
 * 空间尺度：
 *   moleculePoints.js  WORLD_SCALE（当前 2.6）
 *   这里 cam.dist / DIST_MAX / camera.far
 * 产物密度：
 *   rebuild() 里 listMoleculePoints({ catalogCount })
 * ─────────────────────────────────────────────────────────
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import {
  filterNodes,
  listMoleculePoints,
  layerLabel,
} from "../engine/engineApi.js";
import { getState, setSelected, subscribe } from "../state/store.js";
import {
  WORLD_SCALE,
  CATALOG_COUNT,
  structureCount,
  TREE_VOLUME,
} from "../engine/moleculePoints.js";
import {
  TREE_DEFAULTS,
  buildWorldTree,
  trunkPoint,
  mulberry32,
  crownGeom,
} from "./starTree.js";

/** 树体主色：按层位（叶绿 / 干褐 / 根褐黄 / 土黄褐） */
const LAYER_COLOR = {
  canopy: new THREE.Color(0.18, 0.55, 0.28), // 叶
  trunk: new THREE.Color(0.55, 0.32, 0.16), // 干/枝
  rhizosphere: new THREE.Color(0.78, 0.58, 0.22), // 根 · 褐黄
  soil: new THREE.Color(0.72, 0.55, 0.28), // 土
  sky: new THREE.Color(0.45, 0.55, 0.75), // 空中
};

/** 筛选高亮时的类群色（仅精选/选中微调） */
const KINGDOM_COLOR = {
  植物: new THREE.Color(0.28, 0.9, 0.48),
  真菌: new THREE.Color(0.95, 0.58, 0.22),
  细菌: new THREE.Color(0.35, 0.68, 1.0),
  昆虫: new THREE.Color(1.0, 0.5, 0.25),
  生态角色: new THREE.Color(0.75, 0.62, 1.0),
};

const KIND_COLOR = {
  trunk: new THREE.Color(1.0, 0.72, 0.42),
  branch: new THREE.Color(1.0, 0.8, 0.52),
  leaf: new THREE.Color(0.4, 0.9, 0.62),
  leaf2: new THREE.Color(0.32, 0.8, 0.52),
  root: new THREE.Color(1.0, 0.6, 0.35),
  aerial: new THREE.Color(0.68, 0.85, 0.58),
  soil: new THREE.Color(0.55, 0.42, 0.28),
  microbe: new THREE.Color(0.4, 0.72, 0.9),
  worm: new THREE.Color(0.88, 0.62, 0.38),
  dust: new THREE.Color(0.55, 0.65, 0.9),
  flow: new THREE.Color(1.0, 0.86, 0.4),
  butterfly: new THREE.Color(0.86, 0.55, 1.0),
  bee: new THREE.Color(1.0, 0.82, 0.22),
  bird: new THREE.Color(0.62, 0.78, 1.0),
};

/** 诗云 PoetStars 同思路：加法混合软圆盘 + 距离自适应亮度/锐度 + 闪烁 + 入场揭示 */
const STAR_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  attribute float aGlow;
  attribute float aFlex;
  attribute float aReveal;
  uniform float uTime;
  uniform float uSizeScale;
  uniform float uPixelRatio;
  uniform float uFloat;
  uniform float uReveal;
  varying vec3 vColor;
  varying float vTw;
  varying float vGlow;
  varying float vNear;
  varying float vFar;
  varying float vReveal;
  void main() {
    vColor = aColor;
    vGlow = aGlow;
    // 入场：泥土→根→干→冠，按 aReveal 顺序浮现（软边略宽，避免顶层闪出）
    float rev = smoothstep(aReveal - 0.08, aReveal + 0.04, uReveal);
    vReveal = rev;
    vec3 ip = position;
    // 冠层沉浮：按 flex 系数缓慢起伏
    float f = uFloat * aFlex;
    ip.y += sin(uTime * 0.38 + aSeed * 6.2831853) * f;
    ip.x += cos(uTime * 0.27 + aSeed * 4.1) * f * 0.35;
    ip.z += sin(uTime * 0.31 + aSeed * 5.2) * f * 0.35;
    vec4 mv = modelViewMatrix * vec4(ip, 1.0);
    float vz = max(0.08, -mv.z);
    // 近：1（锐）  远：0（压亮度，防加法叠白）
    // 中景（树占满屏）不压太狠，只在很远时再降
    vNear = smoothstep(18.0, 3.5, vz);
    vFar  = smoothstep(22.0, 58.0, vz);
    // 星星眨眼：慢呼吸 + 相位差快闪 + 偶发尖峰
    float ph = aSeed * 6.2831853;
    float slow = 0.58 + 0.42 * sin(uTime * (0.28 + fract(aSeed * 7.13) * 0.55) + ph);
    float fast = sin(uTime * (1.1 + fract(aSeed * 3.71) * 2.4) + ph * 3.7);
    float pulse = pow(max(0.0, sin(uTime * (0.55 + fract(aSeed * 11.7) * 1.1) + ph * 5.3)), 12.0);
    float tw = slow * (0.78 + 0.22 * fast) + pulse * 0.85;
    tw = clamp(tw, 0.12, 2.4);
    vTw = tw;
    float breathe = 1.0 + 0.10 * tw + 0.04 * fast;
    // 远景点径略收，降低重叠能量
    float sizeMul = mix(1.0, 0.78, vFar);
    float sz = aSize * breathe * sizeMul * rev * (uSizeScale / vz) * uPixelRatio;
    // 近：更小上限更锐利；远：略缩下限
    float minS = mix(2.2, 1.5, vNear);
    float maxS = mix(36.0, 24.0, vNear);
    gl_PointSize = rev < 0.02 ? 0.0 : clamp(sz, minS, maxS);
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vTw;
  varying float vGlow;
  varying float vNear;
  varying float vFar;
  varying float vReveal;
  void main() {
    if (vReveal < 0.02) discard;
    float d = length(gl_PointCoord - vec2(0.5));
    // 远：软盘铺开；近：收边 + 硬核，放大更清晰
    float edgeOut = mix(0.50, 0.40, vNear);
    float edgeIn  = mix(0.06, 0.14, vNear);
    float a = smoothstep(edgeOut, edgeIn, d);
    if (a < 0.02) discard;
    float core = mix(smoothstep(0.30, 0.06, d), smoothstep(0.16, 0.02, d), vNear);
    // 远景压亮度；中景保持偏亮，避免树占满屏时发暗
    float dim = mix(1.05, 0.32, vFar);
    vec3 col = vColor * (0.62 + 0.95 * vTw + core * 0.55) * vGlow * dim * vReveal;
    float alpha = a * (0.68 + 0.38 * clamp(vTw, 0.0, 1.6)) * mix(1.0, 0.58, vFar) * vReveal;
    gl_FragColor = vec4(col, alpha);
  }
`;

function detectWeak() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  return mem <= 4 || cores <= 4;
}

function encodePickColor(i) {
  const id = i + 1;
  return [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255];
}

export function mountTreeScene(rootEl) {
  const weak = detectWeak();
  const P = { ...TREE_DEFAULTS };
  if (weak) {
    P.n = Math.floor(P.n * 0.4);
    P.flow = Math.round(P.flow * 0.4 * 100) / 100;
    P.fauna = Math.max(0.4, P.fauna * 0.4);
  }

  rootEl.innerHTML = `
    <canvas class="star-canvas"></canvas>
    <div class="hotspots"></div>
    <div class="eco-tip" id="ecoTip" hidden></div>
    <div class="sel-class" id="selClass" hidden></div>
    <button type="button" class="link-plate" id="linkPlate" hidden></button>
    <div class="eco-search" id="ecoSearch">
      <input type="search" id="ecoSearchInput" placeholder="搜索名称 / 来源…" autocomplete="off" spellcheck="false"/>
      <div class="eco-search-list" id="ecoSearchList" hidden></div>
    </div>
    <div class="scene-hud">拖拽旋转 · 滚轮缩放 · WASD 移动 · Space/C 升降 · Q 取消选中 · <b>~ 第一人称</b> · 点击产物星 <span id="ecoCount"></span></div>
    <button type="button" class="scene-settings-btn" id="ecoSetBtn" aria-label="场景设置" title="场景设置">⚙</button>
    <div class="scene-settings" id="ecoSetPanel" hidden>
      <div class="ss-title">场景设置</div>
      <label class="ss-tog"><input type="checkbox" id="ssShowTrunk" checked/> 显示树干/枝</label>
      <label class="ss-tog"><input type="checkbox" id="ssBloom"/> 树干 Bloom</label>
      <label>光晕强度 <input type="range" id="ssBloomS" min="0" max="0.8" step="0.02" value="0.12"/><em id="ssBloomSv">0.12</em></label>
      <label>光晕半径 <input type="range" id="ssBloomR" min="0" max="1" step="0.02" value="0.25"/><em id="ssBloomRv">0.25</em></label>
      <label>光晕阈值 <input type="range" id="ssBloomT" min="0" max="1" step="0.02" value="0.45"/><em id="ssBloomTv">0.45</em></label>
      <label>星点缩放 <input type="range" id="ssSize" min="12" max="120" step="1" value="48"/><em id="ssSizev">48</em></label>
      <label>亮度 <input type="range" id="ssBright" min="0.3" max="6" step="0.05" value="5"/><em id="ssBrightv">5.00</em></label>
      <label>点数量 <input type="range" id="ssCount" min="4000" max="32000" step="1000" value="28000"/><em id="ssCountv">全量</em></label>
      <label>自转速度 <input type="range" id="ssSpin" min="0" max="0.6" step="0.01" value="0.08"/><em id="ssSpinv">0.08</em></label>
      <label class="ss-tog"><input type="checkbox" id="ssAuto" checked/> 自动旋转</label>
      <button type="button" class="ss-close" id="ssClose">关闭</button>
    </div>
  `;
  const canvas = rootEl.querySelector("canvas");
  const hotspotsEl = rootEl.querySelector(".hotspots");

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x03040a, 1);
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  // 远景薄雾：密度大 → 近景也发灰糊（要「大空间」可再降）
  // 点云自定义 shader 不吃 fog，远景压亮在 STAR_FRAG 的 vFar 里做
  scene.fog = new THREE.FogExp2(0x03040a, 0.004);

  /**
   * 诗云 FlyControls 关键参数（orbit / lock 模式）
   * - 拖拽灵敏度 orbit: 0.005 rad/px；自由飞 look: 0.0024
   * - pitch 夹紧: ±1.4
   * - 滚轮距离: ×1.12 / ×0.89（乘法，有穿越感）
   * - 位置/朝向阻尼: k = 1 - pow(0.0025, dt)
   * - flyTo 阻尼: k = 1 - pow(0.0015, dt)
   * - 手势残留消费: 1 - exp(-dt / 0.055)
   * - WASD 基速 BASE_SPEED=140（本树场景未用自由飞）
   */
  const ORBIT_SENS = 0.005;
  const PITCH_LIM = 1.4;
  const ZOOM_IN = 0.89;
  const ZOOM_OUT = 1.12;
  const DAMP_K = 0.0025;
  const FLY_DAMP_K = 0.0015;
  const INERTIA_TAU = 0.12; // 松手后速度衰减时间常数（秒）

  // 树竖向世界高度：土底≈-0.4 → 冠顶≈1.85
  const TREE_Y0 = -0.4 * TREE_VOLUME;
  const TREE_Y1 = 2.15 * TREE_VOLUME;
  const TREE_H = (TREE_Y1 - TREE_Y0) * WORLD_SCALE;
  // 拉到最远时整树约占屏高 1/3 → 改为约填满（距离约 1/3），画面里放大约 3 倍
  const CLOUD_FIT = structureCount() > 80000 ? 1.05 : 1;
  const DIST_MAX =
    (TREE_H / (0.35 * 2 * Math.tan((52 / 2) * (Math.PI / 180)))) *
    CLOUD_FIT *
    (2.0 / 3);

  const camera = new THREE.PerspectiveCamera(
    52,
    1,
    0.15,
    Math.max(600, DIST_MAX * 2.5)
  );

  const cam = {
    yaw: 0.55,
    pitch: 0.16,
    dist: DIST_MAX,
    distTarget: DIST_MAX,
    auto: true,
    fx: 0,
    fy: ((TREE_Y1 + TREE_Y0) / 2) * WORLD_SCALE,
    fz: 0,
  };
  const vel = { yaw: 0, pitch: 0 };
  const DIST_MIN = 1.2;
  const fly = { active: false, t: 0, dur: 0.95, from: null, to: null };

  /** `~` 第一人称：指针锁定 + 隐藏光标；再按 `~` / Esc 退出 */
  let fpMode = false;
  const fpPos = new THREE.Vector3();
  function fpForward(out) {
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    return out.set(-sy * cp, -sp, -cy * cp);
  }
  function enterFP() {
    if (fpMode) return;
    fpMode = true;
    fly.active = false;
    cam.auto = false;
    vel.yaw = 0;
    vel.pitch = 0;
    fpPos.copy(camera.position);
    canvas.style.cursor = "none";
    rootEl.classList.add("fp-mode");
    canvas.requestPointerLock?.();
  }
  function exitFP() {
    if (!fpMode) return;
    fpMode = false;
    canvas.style.cursor = "grab";
    rootEl.classList.remove("fp-mode");
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock?.();
    }
    // 收回环绕：注视点 = 观察者前方 dist
    const d = Math.max(DIST_MIN, cam.dist);
    const f = fpForward(_desired);
    cam.fx = fpPos.x + f.x * d;
    cam.fy = fpPos.y + f.y * d;
    cam.fz = fpPos.z + f.z * d;
    if (set.autoRotate) cam.auto = true;
  }
  function toggleFP() {
    if (fpMode) exitFP();
    else enterFP();
  }

  function damp(dt, base) {
    return 1 - Math.pow(base, dt);
  }

  /** 可调场景参数（右上角设置面板） — 锁定默认：缩放63/亮2.5/2.8万点/自转0.08 */
  const set = {
    bloom: false,
    bloomStrength: 0.12,
    bloomRadius: 0.25,
    bloomThreshold: 0.45,
    sizeScale: 48,
    bright: 5,
    catalogCount: 28000,
    spin: 0.08,
    autoRotate: true,
    showTrunk: true,
  };
  cam.auto = true;

  function applyCamera() {
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);

    // 第一人称：钉在观察者，鼠标（指针锁定）转视角
    if (fpMode) {
      const k = damp(lastDt, DAMP_K);
      camera.position.lerp(fpPos, Math.min(1, k * 4));
      _camTarget.set(
        fpPos.x - sy * cp * 2,
        fpPos.y - sp * 2,
        fpPos.z - cy * cp * 2
      );
      _mat.lookAt(camera.position, _camTarget, _up);
      _quat.setFromRotationMatrix(_mat);
      camera.quaternion.slerp(_quat, Math.min(1, k * 5));
      return;
    }

    const target = _camTarget.set(cam.fx, cam.fy, cam.fz);
    _desired.set(
      target.x + cam.dist * sy * cp,
      target.y + cam.dist * sp,
      target.z + cam.dist * cy * cp
    );
    // 位置与注视点同速率阻尼，平移时视线不甩（A/D/Space/C 不再像转视角）
    const k = damp(lastDt, DAMP_K);
    if (!_lookInit) {
      _look.copy(target);
      _lookInit = true;
    }
    _look.lerp(target, k);
    camera.position.lerp(_desired, k);
    _mat.lookAt(camera.position, _look, _up);
    _quat.setFromRotationMatrix(_mat);
    camera.quaternion.slerp(_quat, k);
  }
  const _camTarget = new THREE.Vector3();
  const _desired = new THREE.Vector3();
  const _look = new THREE.Vector3();
  let _lookInit = false;

  // ── WASD：平移注视点（环绕相机，非第一人称） ──
  const wasdKeys = new Set();
  function wasdActive() {
    return wasdKeys.size > 0;
  }
  function applyWasd(dt) {
    if (!wasdKeys.size) return;
    // 第一人称：移动观察者（不改 yaw/pitch）
    if (fpMode) {
      const speed = Math.min(Math.max(4, cam.dist * 0.35), 48) * dt;
      const cy = Math.cos(cam.yaw);
      const sy = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      const fx = -sy * cp;
      const fy = -sp;
      const fz = -cy * cp;
      const rx = cy;
      const rz = -sy;
      let mx = 0;
      let my = 0;
      let mz = 0;
      if (wasdKeys.has("w")) {
        mx += fx;
        my += fy;
        mz += fz;
      }
      if (wasdKeys.has("s")) {
        mx -= fx;
        my -= fy;
        mz -= fz;
      }
      if (wasdKeys.has("a")) {
        mx -= rx;
        mz -= rz;
      }
      if (wasdKeys.has("d")) {
        mx += rx;
        mz += rz;
      }
      if (wasdKeys.has("c")) my -= 1;
      if (wasdKeys.has(" ")) my += 1;
      const len = Math.hypot(mx, my, mz);
      if (len > 1e-6) {
        fpPos.x += (mx / len) * speed;
        fpPos.y += (my / len) * speed;
        fpPos.z += (mz / len) * speed;
      }
      return;
    }
    // 远景限速，避免 dist 很大时一步飞出画面
    const speed = Math.min(Math.max(3, cam.dist * 0.22), 36) * dt;
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    const fx = -sy * cp;
    const fy = -sp;
    const fz = -cy * cp;
    const rx = cy;
    const rz = -sy;
    let mx = 0;
    let my = 0;
    let mz = 0;
    if (wasdKeys.has("w")) {
      mx += fx;
      my += fy;
      mz += fz;
    }
    if (wasdKeys.has("s")) {
      mx -= fx;
      my -= fy;
      mz -= fz;
    }
    if (wasdKeys.has("a")) {
      mx -= rx;
      mz -= rz;
    }
    if (wasdKeys.has("d")) {
      mx += rx;
      mz += rz;
    }
    if (wasdKeys.has("c")) my -= 1;
    if (wasdKeys.has(" ")) my += 1;
    const len = Math.hypot(mx, my, mz);
    if (len < 1e-6) return;
    const dx = (mx / len) * speed;
    const dy = (my / len) * speed;
    const dz = (mz / len) * speed;
    // 只平移注视点；不碰 yaw/pitch，也不停自转
    cam.fx += dx;
    cam.fy += dy;
    cam.fz += dz;
    fly.active = false;
  }
  function wasdTyping(e) {
    const t = e.target;
    if (!t) return false;
    const tag = (t.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || t.isContentEditable;
  }
  window.addEventListener("keydown", (e) => {
    if (wasdTyping(e)) return;
    // `~`（Backquote）：开关第一人称
    if (e.code === "Backquote") {
      e.preventDefault();
      toggleFP();
      return;
    }
    if (e.key === "Escape" && fpMode) {
      e.preventDefault();
      exitFP();
      return;
    }
    const k = e.key.toLowerCase();
    // Q：取消选中
    if (k === "q") {
      e.preventDefault();
      setSelected(null);
      return;
    }
    if (
      k === "w" ||
      k === "a" ||
      k === "s" ||
      k === "d" ||
      k === "c" ||
      k === " "
    ) {
      wasdKeys.add(k);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    wasdKeys.delete(k);
    if (!wasdKeys.size && set.autoRotate && !fpMode) cam.auto = true;
  });
  window.addEventListener("blur", () => {
    wasdKeys.clear();
    if (fpMode) exitFP();
    if (set.autoRotate) cam.auto = true;
  });

  // 指针锁定：丢失时退出第一人称
  document.addEventListener("pointerlockchange", () => {
    if (fpMode && document.pointerLockElement !== canvas) {
      exitFP();
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (!fpMode || document.pointerLockElement !== canvas) return;
    // 灵敏度 0.0011（原 0.0022 的一半）；Y 轴按常规 FPS：上移抬头
    cam.yaw -= (e.movementX || 0) * 0.0011;
    cam.pitch = Math.max(
      -PITCH_LIM,
      Math.min(PITCH_LIM, cam.pitch + (e.movementY || 0) * 0.0011)
    );
  });
  const _mat = new THREE.Matrix4();
  const _quat = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  let lastDt = 1 / 60;

  // 选择性 Bloom：只给树干层做辉光，再叠回主画面
  const BLOOM_LAYER = 1;
  let bloomComposer = null;
  let bloomPass = null;
  let finalComposer = null;
  let mixPass = null;
  const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const materialCache = {};

  const mixShader = {
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: null },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;
      void main() {
        vec4 base = texture2D(baseTexture, vUv);
        vec4 bloom = texture2D(bloomTexture, vUv);
        gl_FragColor = base + vec4(bloom.rgb * 1.15, 0.0);
      }
    `,
  };

  function darkenNonBloom(obj) {
    if (obj.isMesh || obj.isPoints || obj.isLine) {
      if (!obj.layers.test({ mask: 1 << BLOOM_LAYER })) {
        materialCache[obj.uuid] = obj.material;
        obj.material = darkMaterial;
      }
    }
  }
  function restoreMaterial(obj) {
    if (materialCache[obj.uuid]) {
      obj.material = materialCache[obj.uuid];
      delete materialCache[obj.uuid];
    }
  }

  function setupComposer(w, h) {
    if (bloomComposer) bloomComposer.dispose?.();
    if (finalComposer) finalComposer.dispose?.();
    bloomComposer = new EffectComposer(renderer);
    bloomComposer.renderToScreen = false;
    bloomComposer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      set.bloomStrength,
      set.bloomRadius,
      set.bloomThreshold
    );
    bloomComposer.addPass(bloomPass);
    bloomComposer.setSize(w, h);

    finalComposer = new EffectComposer(renderer);
    finalComposer.addPass(new RenderPass(scene, camera));
    mixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(mixShader.uniforms),
        vertexShader: mixShader.vertexShader,
        fragmentShader: mixShader.fragmentShader,
      }),
      "baseTexture"
    );
    mixPass.needsSwap = true;
    finalComposer.addPass(mixPass);
    finalComposer.setSize(w, h);
  }

  function makePoints(
    positions,
    colors,
    sizes,
    seeds,
    glows,
    sizeScale,
    flex,
    reveal
  ) {
    const g = new THREE.BufferGeometry();
    const n = positions.length / 3;
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    g.setAttribute("aGlow", new THREE.BufferAttribute(glows, 1));
    if (flex) g.setAttribute("aFlex", new THREE.BufferAttribute(flex, 1));
    else {
      const z = new Float32Array(n);
      g.setAttribute("aFlex", new THREE.BufferAttribute(z, 1));
    }
    if (reveal) g.setAttribute("aReveal", new THREE.BufferAttribute(reveal, 1));
    else {
      const r0 = new Float32Array(n); // 0 = 随 uReveal>0 立刻出现
      g.setAttribute("aReveal", new THREE.BufferAttribute(r0, 1));
    }
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSizeScale: { value: sizeScale },
        uPixelRatio: { value: dpr },
        uFloat: { value: 0.035 * WORLD_SCALE * TREE_VOLUME },
        uReveal: { value: 1 },
      },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
    return { points: pts, geometry: g, material: m };
  }

  /** 入场顺序 0→1：泥土(中心向外)→根→干(与冠重叠)→冠 自下而上铺开 */
  function revealOrder(s) {
    const layer = s.layer;
    const y = s.pos.y;
    const rad = Math.hypot(s.pos.x, s.pos.z);
    const scale = WORLD_SCALE * TREE_VOLUME;
    if (layer === "soil" || layer === "rhizosphere") {
      if (layer === "soil") {
        // 泥土：从中心缓慢渗开，占前段更久
        const maxR = 1.8 * scale;
        return 0.02 + 0.18 * Math.min(1, rad / maxR);
      }
      // 根：在土之后、干之前，慢速铺开
      const maxR = 1.4 * scale;
      return 0.18 + 0.14 * Math.min(1, rad / maxR);
    }
    if (layer === "trunk") {
      const part = s.part || "core";
      const y0 = -0.15 * scale;
      const y1 = 1.2 * scale;
      const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
      // 干整体放慢约 1/3：拉长 core 在 0–1 上的跨度
      if (part === "core") return 0.28 + 0.37 * t;
      if (part === "limb") return 0.56 + 0.18 * t;
      return 0.7 + 0.12 * t;
    }
    if (layer === "canopy") {
      // 冠：从下缘长到圆顶；范围对齐实际冠高，避免顶点挤在同一时刻闪出
      const y0 = 0.55 * scale;
      const y1 = 2.45 * scale;
      let t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
      t = Math.pow(t, 0.85);
      const ang = Math.atan2(s.pos.z, s.pos.x || 1e-6);
      const wob =
        0.04 * Math.sin(ang * 3.1 + rad * 0.08) +
        0.03 * Math.sin(y * 0.35 + ang * 5.0);
      return Math.max(0.42, Math.min(0.96, 0.46 + 0.48 * t + wob));
    }
    return 0.9 + 0.08 * (rad / (2.5 * scale));
  }

  let introArmed = true;
  let introT0 = -1;
  let introDone = true;
  // 参天古树：整体约 9s
  const INTRO_MS = 9000;
  function setRevealAll(v) {
    for (const o of [structPts, trunkPts, otherPts, flowPts, evPts]) {
      if (o && o.material && o.material.uniforms.uReveal) {
        o.material.uniforms.uReveal.value = v;
      }
    }
  }
  function tickIntro(nowSec) {
    if (introDone) return;
    if (introT0 < 0) introT0 = nowSec * 1000;
    const raw = Math.min(1, (nowSec * 1000 - introT0) / INTRO_MS);
    // 略偏缓入：泥土/根先慢慢渗出，再托起干与冠
    const u = Math.pow(raw, 1.25);
    setRevealAll(u);
    if (raw >= 1) {
      introDone = true;
      setRevealAll(1);
    }
  }

  let built = null;
  let structPts = null;
  let flowPts = null;
  let productPts = null;
  /** 仅树干层点云 — 单独吃 Bloom */
  let trunkPts = null;
  let otherPts = null;
  let productStars = [];
  let featuredAnchors = [];
  let flowParts = [];
  let fauna = [];
  let t0 = performance.now();
  let raf = 0;
  let labelBoxes = [];
  let lastSel = null;
  let W = 1;
  let H = 1;

  function resize() {
    const rect = rootEl.getBoundingClientRect();
    W = Math.max(320, Math.floor(rect.width || window.innerWidth));
    H = Math.max(320, Math.floor(rect.height || window.innerHeight));
    camera.aspect = W / H;
    // 右侧详情栏常驻：把取景往左让，树心对准「画布减详情栏」中点
    const panelW = Math.min(390, W * 0.4) + 16;
    camera.setViewOffset(W, H, panelW * 0.5, 0, W, H);
    if (linkLines && linkLines.material && linkLines.material.resolution) {
      linkLines.material.resolution.set(W, H);
    }
    if (linkFlow && linkFlow.material && linkFlow.material.resolution) {
      // flow 仍是普通 Line，无需 resolution
    }
    renderer.setSize(W, H, false);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    setupComposer(W, H);
    if (structPts) structPts.material.uniforms.uPixelRatio.value = dpr;
    if (trunkPts) trunkPts.material.uniforms.uPixelRatio.value = dpr;
    if (otherPts) otherPts.material.uniforms.uPixelRatio.value = dpr;
    if (flowPts) flowPts.material.uniforms.uPixelRatio.value = dpr;
  }

  function spawnFlow(rnd) {
    const path = built.rootPaths[(rnd() * built.rootPaths.length) | 0];
    return { path, u: rnd() * 0.3, sp: P.flowSpeed * (0.7 + 0.6 * rnd()) };
  }

  function flowPos(fl) {
    const p = fl.path;
    const u = fl.u;
    if (u <= 0.85) {
      const t = (u / 0.85) * (p.length - 1);
      const i = Math.floor(t);
      const f = t - i;
      const a = p[Math.min(i, p.length - 1)];
      const b = p[Math.min(i + 1, p.length - 1)];
      return new THREE.Vector3(
        a.x + (b.x - a.x) * f,
        a.y + (b.y - a.y) * f,
        a.z + (b.z - a.z) * f
      );
    }
    const v = (u - 0.85) / 0.15;
    const tp = trunkPoint(0.05 + v * 0.72);
    return new THREE.Vector3(tp[0], tp[1], tp[2]);
  }

  function faunaPos(an, now) {
    const g = built.crown;
    const a = an.a + now * an.speed;
    let x = Math.cos(a) * an.r;
    let z = Math.sin(a) * an.r;
    let y = an.y0 + Math.sin(now * 2.2 + an.bobPh) * an.bob;
    if (an.type === "bee") {
      y += Math.sin(a * 3) * 0.08;
      x *= 0.92;
      z *= 0.92;
    }
    if (an.type === "butterfly") {
      y += Math.sin(now * 3.5 + an.bobPh) * 0.05;
      x *= 1.08;
      z *= 1.08;
    }
    return new THREE.Vector3(x, y, z);
  }

  function rebuild() {
    for (const o of [structPts, productPts, trunkPts, otherPts, flowPts]) {
      if (!o) continue;
      scene.remove(o.points);
      o.geometry.dispose();
      o.material.dispose();
    }
    structPts = productPts = trunkPts = otherPts = flowPts = null;

    built = buildWorldTree(P);

    // 树体 = 产物点云本身；结构层只留极淡土壤微生物点缀
    const bioN = built.soilBio.length;
    if (bioN > 0) {
      const sp2 = new Float32Array(bioN * 3);
      const sc2 = new Float32Array(bioN * 3);
      const ss2 = new Float32Array(bioN);
      const sd2 = new Float32Array(bioN);
      const sg2 = new Float32Array(bioN);
      const sr2 = new Float32Array(bioN);
      for (let i = 0; i < bioN; i++) {
        const b = built.soilBio[i];
        const wx = b.x * WORLD_SCALE * TREE_VOLUME;
        const wy = b.y * WORLD_SCALE * TREE_VOLUME;
        const wz = b.z * WORLD_SCALE * TREE_VOLUME;
        sp2[i * 3] = wx;
        sp2[i * 3 + 1] = wy;
        sp2[i * 3 + 2] = wz;
        const c = KIND_COLOR[b.kind] || KIND_COLOR.microbe;
        sc2[i * 3] = c.r * 0.55;
        sc2[i * 3 + 1] = c.g * 0.55;
        sc2[i * 3 + 2] = c.b * 0.55;
        ss2[i] = 0.7;
        sd2[i] = (i * 0.37) % 1;
        sg2[i] = 0.5;
        // 泥土微生物：与泥土同步、中心先出
        const maxR = 1.8 * WORLD_SCALE * TREE_VOLUME;
        sr2[i] = 0.02 + 0.16 * Math.min(1, Math.hypot(wx, wz) / maxR);
      }
      structPts = makePoints(sp2, sc2, ss2, sd2, sg2, 26, null, sr2);
    }

    // 运输光：树干出现后再亮
    flowParts = [];
    const nf0 = Math.floor(90 * P.flow);
    for (let i = 0; i < nf0; i++) {
      flowParts.push(spawnFlow(mulberry32(1 + i)));
    }
    const fp = new Float32Array(nf0 * 3);
    const fc = new Float32Array(nf0 * 3);
    const fs = new Float32Array(nf0);
    const fd = new Float32Array(nf0);
    const fg = new Float32Array(nf0);
    const fr = new Float32Array(nf0);
    const gold = KIND_COLOR.flow;
    for (let i = 0; i < nf0; i++) {
      const p = flowPos(flowParts[i]);
      fp[i * 3] = p.x * WORLD_SCALE * TREE_VOLUME;
      fp[i * 3 + 1] = p.y * WORLD_SCALE * TREE_VOLUME;
      fp[i * 3 + 2] = p.z * WORLD_SCALE * TREE_VOLUME;
      fc[i * 3] = gold.r;
      fc[i * 3 + 1] = gold.g;
      fc[i * 3 + 2] = gold.b;
      fs[i] = 1.6;
      fd[i] = (i * 0.41) % 1;
      fg[i] = 0.9;
      fr[i] = 0.55 + (i / Math.max(1, nf0)) * 0.12;
    }
    flowPts = makePoints(fp, fc, fs, fd, fg, 36, null, fr);

    // 产物星：万级密度，构成树体
    const nStruct = structureCount();
    // 有结构云时点数量=全量 InChIKey；滑条仅在无云时生效
    const mols = listMoleculePoints({
      catalogCount: nStruct
        ? 0
        : weak
          ? Math.floor(set.catalogCount * 0.4)
          : set.catalogCount,
      spread: P.spread,
    });
    // 超大数据：默认关树干 Bloom，避免卡顿
    if (nStruct > 80000 && set.bloom) {
      set.bloom = false;
      const cb = rootEl.querySelector("#ssBloom");
      if (cb) cb.checked = false;
    }
    productStars = mols;
    const ecoCountEl = rootEl.querySelector("#ecoCount");
    if (ecoCountEl) {
      ecoCountEl.textContent = ` · 产物 ${mols.length.toLocaleString("zh-CN")}${
        nStruct ? ` · 结构云 ${nStruct.toLocaleString("zh-CN")}` : ""
      }`;
    }
    const nP = mols.length;
    const pp = new Float32Array(nP * 3);
    const pc = new Float32Array(nP * 3);
    const ps = new Float32Array(nP);
    const pd = new Float32Array(nP);
    const pg = new Float32Array(nP);
    const pf = new Float32Array(nP);
    const pr = new Float32Array(nP);
    for (let i = 0; i < nP; i++) {
      const s = mols[i];
      pp[i * 3] = s.pos.x;
      pp[i * 3 + 1] = s.pos.y;
      pp[i * 3 + 2] = s.pos.z;
      pr[i] = revealOrder(s);
      // 层色为主（树形可读）+ 类群微混（不呆板）
      const layerC = LAYER_COLOR[s.layer] || LAYER_COLOR.canopy;
      const kindC = KINGDOM_COLOR[s.kingdom] || layerC;
      // 根/土几乎不跟类群绿混，避免发绿
      const mix =
        s.layer === "rhizosphere" || s.layer === "soil"
          ? 0.06
          : s.kind === "featured"
            ? 0.32
            : 0.22;
      const c = layerC.clone().lerp(kindC, mix);
      let bright =
        (s.kind === "featured" ? 1.1 : s.kind === "lotus" ? 0.72 : 0.85) *
        set.bright;
      if (s.layer === "trunk") {
        if (!set.showTrunk) {
          ps[i] = 0;
          pg[i] = 0;
          continue;
        }
        // 主干/主枝降约 40%，次级分枝提亮
        if (s.part === "core" || s.part === "limb") {
          bright *= 0.6;
          pg[i] *= 0.55;
        } else if (s.part === "twig") {
          bright *= 1.25;
          pg[i] *= 1.15;
        } else {
          bright *= 0.75;
          pg[i] *= 0.7;
        }
      }
      if (s.layer === "rhizosphere") {
        bright *= 1.4;
        pg[i] *= 1.3;
      }
      if (s.layer === "soil") bright *= 0.55;
      pc[i * 3] = c.r * bright;
      pc[i * 3 + 1] = c.g * bright;
      pc[i * 3 + 2] = c.b * bright;
      ps[i] = s.kind === "featured" ? 1.2 : s.kind === "lotus" ? 0.55 : 0.48;
      pd[i] = (i * 0.6180339887) % 1;
      pg[i] = s.kind === "featured" ? 0.9 : s.kind === "lotus" ? 0.42 : 0.4;
      if (s.layer === "soil") pg[i] *= 0.55;
      // 产物星必须贴静态坐标：shader 沉浮会让树冠绿点「看得见点不着」，
      // 连线也从虚空发出。运动只留给运输光/事件/土壤生物。
      pf[i] = 0;
    }
    // 拆成树干 / 非树干 两套点，树干单独 Bloom
    const trunkIdx = [];
    const otherIdx = [];
    for (let i = 0; i < nP; i++) {
      if (mols[i].layer === "trunk") trunkIdx.push(i);
      else otherIdx.push(i);
    }
    function pack(idxList) {
      const n = idxList.length;
      const a = new Float32Array(n * 3);
      const b = new Float32Array(n * 3);
      const c = new Float32Array(n);
      const d = new Float32Array(n);
      const e = new Float32Array(n);
      const f = new Float32Array(n);
      const r = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const i = idxList[k];
        a[k * 3] = pp[i * 3];
        a[k * 3 + 1] = pp[i * 3 + 1];
        a[k * 3 + 2] = pp[i * 3 + 2];
        b[k * 3] = pc[i * 3];
        b[k * 3 + 1] = pc[i * 3 + 1];
        b[k * 3 + 2] = pc[i * 3 + 2];
        c[k] = ps[i];
        d[k] = pd[i];
        e[k] = pg[i];
        f[k] = pf[i];
        r[k] = pr[i];
      }
      return { a, b, c, d, e, f, r };
    }
    splitTrunkIdx = trunkIdx;
    splitOtherIdx = otherIdx;
    const tp = pack(trunkIdx);
    const op = pack(otherIdx);
    trunkPts = makePoints(
      tp.a,
      tp.b,
      tp.c,
      tp.d,
      tp.e,
      set.sizeScale,
      tp.f,
      tp.r
    );
    otherPts = makePoints(
      op.a,
      op.b,
      op.c,
      op.d,
      op.e,
      set.sizeScale,
      op.f,
      op.r
    );
    trunkPts.points.layers.enable(BLOOM_LAYER);
    productPts = null;

    // 首次进入：泥土→根→干→枝→冠 分批浮现；之后 rebuild 直接全显
    if (introArmed) {
      introArmed = false;
      introDone = false;
      introT0 = -1;
      setRevealAll(0);
    } else {
      introDone = true;
      setRevealAll(1);
    }

    // 精选 DOM 标签（少量）
    hotspotsEl.innerHTML = "";
    featuredAnchors = productStars
      .filter((s) => s.kind === "featured")
      .slice(0, 18)
      .map((s) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hotspot3d";
        btn.dataset.id = s.id;
        btn.dataset.kingdom = s.kingdom;
        btn.setAttribute("aria-label", s.nameZh);
        btn.innerHTML = `<span class="label">${s.nameZh}</span>`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          // 只改状态；flyTo / 连线 / 高亮交给 subscribe 一次完成
          setSelected(s.id);
        });
        hotspotsEl.appendChild(btn);
        return { ...s, el: btn };
      });
  }

  function shortAngle(from, to) {
    // 模运算替代 while 收角，避免 d 为 Infinity/NaN 时死循环
    let d = to - from;
    if (!Number.isFinite(d)) return 0;
    d = d % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function flyTo(pos) {
    exitFP();
    // 聚焦到该点本身：look-at 目标 = 产物星，相机停在近处
    const focus = new THREE.Vector3(pos.x, pos.y, pos.z);
    const fromFocus = new THREE.Vector3(cam.fx, cam.fy, cam.fz);
    // 在当前视线方向附近飞近，避免绕到背后
    const offset = new THREE.Vector3(
      Math.sin(cam.yaw) * Math.cos(cam.pitch),
      Math.sin(cam.pitch),
      Math.cos(cam.yaw) * Math.cos(cam.pitch)
    ).multiplyScalar(0.55);

    fly.active = true;
    fly.t = 0;
    fly.from = {
      yaw: cam.yaw,
      pitch: cam.pitch,
      dist: cam.dist,
      fx: fromFocus.x,
      fy: fromFocus.y,
      fz: fromFocus.z,
    };
    fly.to = {
      yaw: cam.yaw,
      pitch: Math.max(-0.85, Math.min(0.85, cam.pitch * 0.85)),
      dist: 3.3,
      fx: focus.x,
      fy: focus.y,
      fz: focus.z,
    };
    cam.auto = false;
    void offset;
  }

  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  function projectVec(pos) {
    _v.set(pos.x, pos.y, pos.z);
    const dist = camera.position.distanceTo(_v);
    _w.copy(_v).project(camera);
    return {
      sx: (_w.x * 0.5 + 0.5) * W,
      sy: (-_w.y * 0.5 + 0.5) * H,
      z: dist,
      ndcZ: _w.z,
    };
  }

  function pickStar(mx, my) {
    let best = null;
    let bd = Infinity;
    const { kingdom, selectedId } = getState();
    const visKingdom = kingdom === "全部" ? null : kingdom;
    const hasSel = !!selectedId;
    // 远景只拾取精选星：22 万点全量 project 会卡死主线程
    const near = cam.dist < 14;
    for (let i = 0; i < productStars.length; i++) {
      const s = productStars[i];
      if (!near && s.kind !== "featured") continue;
      if (visKingdom && s.kingdom !== visKingdom) continue;
      const q = projectVec(s.pos);
      if (q.z < 0.05 || q.z > 40) continue;
      if (q.ndcZ > 0.999) continue;
      const sizePx =
        (s.kind === "featured" ? 1.7 : 0.9) * (48 / Math.max(0.15, q.z * 55));
      let hitR = Math.max(18, Math.min(80, sizePx * 1.25 + 12));
      // 已选中时压小其他星命中，让连线更好点
      if (hasSel && s.id !== selectedId) hitR *= 0.4;
      const d = Math.hypot(q.sx - mx, q.sy - my);
      if (d < hitR && d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  function placeLabels(items) {
    items.sort((a, b) => b.priority - a.priority);
    labelBoxes = [];
    for (const it of items) {
      const label = it.el.querySelector(".label");
      const w = (label?.offsetWidth || 72) + 28;
      const h = 22;
      let placed = false;
      const offsets = [
        [0, 0],
        [w * 0.7, 0],
        [-w * 0.7, 0],
        [0, -h * 1.2],
        [0, h * 1.2],
      ];
      for (const [dx, dy] of offsets) {
        const box = { x: it.x + dx - 8, y: it.y + dy - 10, w, h };
        const hit = labelBoxes.some(
          (b) =>
            !(
              box.x + box.w < b.x ||
              box.x > b.x + b.w ||
              box.y + box.h < b.y ||
              box.y > b.y + b.h
            )
        );
        if (!hit) {
          labelBoxes.push(box);
          it.el.style.left = `${((it.x + dx) / W) * 100}%`;
          it.el.style.top = `${((it.y + dy) / H) * 100}%`;
          it.el.classList.remove("label-crowded");
          placed = true;
          break;
        }
      }
      if (!placed) {
        it.el.style.left = `${(it.x / W) * 100}%`;
        it.el.style.top = `${(it.y / H) * 100}%`;
        it.el.classList.add("label-crowded");
      }
    }
  }

  const tipEl = rootEl.querySelector("#ecoTip");
  const selClassEl = rootEl.querySelector("#selClass");
  const linkPlateEl = rootEl.querySelector("#linkPlate");
  let hoverId = null;
  let lastHoverPick = 0;
  let hoverScreen = { x: 0, y: 0 };
  let linkParent = "";
  let lastPtr = { x: 0, y: 0, has: false };

  function shortText(s, n) {
    const t = String(s || "").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }

  function tipHtml(p, isLink) {
    const layer = layerLabel(p.layer) || p.layer || "";
    const klass = p.chemClass && p.chemClass !== "InChIKey" ? p.chemClass : "";
    const head = p.nameZh || "未命名";
    const org = shortText(p.organismZh || "", 20);
    const sub = [p.kingdom, klass, layer].filter(Boolean).join(" · ");
    const linkNote = isLink
      ? `<div class="tip-meta">点击跳转到该物质</div>`
      : "";
    return `<div class="tip-name">${head}</div>${
      org ? `<div class="tip-sub">${org}</div>` : ""
    }${sub ? `<div class="tip-meta">${sub}</div>` : ""}${linkNote}`;
  }

  function linkParentText(p) {
    if (!p) return "";
    // 与 buildSourceLinks 同一父级：同源生物优先，其次同节点
    if (p.organismZh) return `同源 · ${shortText(p.organismZh, 16)}`;
    if (p.nodeId) return `同节点 · ${p.nodeId}`;
    if (p.inchikey) return `同结构 · ${shortText(p.inchikey, 14)}`;
    return classText(p);
  }

  function classText(p) {
    if (!p) return "";
    const layer = layerLabel(p.layer) || p.layer || "";
    if (p.chemClass && p.chemClass !== "InChIKey") {
      return `${p.kingdom || ""} · ${p.chemClass}`;
    }
    return [p.kingdom, layer].filter(Boolean).join(" · ");
  }

  function showTip(p, sx, sy, isLink) {
    if (!p) {
      tipEl.hidden = true;
      hoverId = null;
      return;
    }
    hoverId = p.id;
    hoverScreen.x = sx;
    hoverScreen.y = sy;
    tipEl.innerHTML = tipHtml(p, isLink);
    tipEl.hidden = false;
    tipEl.classList.toggle("is-link", !!isLink);
    const pad = 12;
    const w = tipEl.offsetWidth || 140;
    const h = tipEl.offsetHeight || 48;
    let left = sx + pad;
    let top = sy + pad;
    if (left + w > W - 8) left = sx - w - pad;
    if (top + h > H - 8) top = sy - h - pad;
    tipEl.style.left = `${Math.max(8, left)}px`;
    tipEl.style.top = `${Math.max(8, top)}px`;
  }

  function hideTip() {
    tipEl.hidden = true;
    tipEl.classList.remove("is-link");
    hoverId = null;
    setHoverLink(-1, 0, 0);
  }

  function updateHoverTip(mx, my, nowMs) {
    if (dragging || fly.active) {
      hideTip();
      return;
    }
    // 节流：全量拾取较贵
    if (nowMs - lastHoverPick < 90) {
      if (hoverId && !tipEl.hidden) {
        tipEl.style.left = `${Math.max(8, Math.min(W - 160, mx + 14))}px`;
        tipEl.style.top = `${Math.max(8, Math.min(H - 60, my + 14))}px`;
      }
      return;
    }
    lastHoverPick = nowMs;
    const pick = pickForPointer(mx, my, false);
    if (!pick) {
      setHoverLink(-1, mx, my);
      hideTipOnly();
      canvas.style.cursor = "grab";
      return;
    }
    if (pick.type === "star") {
      setHoverLink(-1, mx, my);
      showTip(pick.star, mx, my, false);
      canvas.style.cursor = "pointer";
      return;
    }
    setHoverLink(pick.idx, mx, my);
  }

  function hideTipOnly() {
    tipEl.hidden = true;
    tipEl.classList.remove("is-link");
    hoverId = null;
  }

  function updateSelLabel() {
    const { selectedId } = getState();
    if (!selectedId || !selClassEl) {
      if (selClassEl) selClassEl.hidden = true;
      return;
    }
    const p = productStars.find((x) => x.id === selectedId);
    if (!p) {
      selClassEl.hidden = true;
      return;
    }
    const q = projectVec(p.pos);
    const on =
      Number.isFinite(q.sx) &&
      Number.isFinite(q.sy) &&
      q.z > 0.08 &&
      q.sx > -80 &&
      q.sx < W + 80 &&
      q.sy > -80 &&
      q.sy < H + 80;
    if (!on) {
      selClassEl.hidden = true;
      return;
    }
    const text = linkParent || linkParentText(p);
    if (!text) {
      selClassEl.hidden = true;
      return;
    }
    if (selClassEl.textContent !== text) selClassEl.textContent = text;
    selClassEl.hidden = false;
    // 距离越近，屏幕偏移越大，避免贴在光晕上
    const off = q.z < 2.5 ? 36 : q.z < 6 ? 28 : 22;
    selClassEl.style.left = `${Math.round(q.sx)}px`;
    selClassEl.style.top = `${Math.round(q.sy)}px`;
    selClassEl.style.transform = `translate(-50%, ${off}px)`;
  }

  function updateDom(now) {
    const { selectedId, kingdom } = getState();
    const visKingdom = kingdom === "全部" ? null : kingdom;
    // 远景不画 HTML 实心圆（会像像素点）；只在选中或很近时给标签
    const showDom = cam.dist < 8;
    const place = [];
    for (const a of featuredAnchors) {
      const sel = selectedId === a.id;
      if (!showDom && !sel) {
        a.el.style.display = "none";
        continue;
      }
      const q = projectVec(a.pos);
      const on =
        q.z > 0.08 && q.sx > -20 && q.sx < W + 20 && q.sy > -20 && q.sy < H + 20;
      if (!on) {
        a.el.style.display = "none";
        continue;
      }
      a.el.style.display = "block";
      const c = KINGDOM_COLOR[a.kingdom] || KINGDOM_COLOR.植物;
      const hex = "#" + c.getHexString();
      a.el.style.borderColor = hex;
      // 不填充实心色，避免像 HTML 画的圆
      a.el.style.background = sel ? hex : "transparent";
      const visA = !visKingdom || a.kingdom === visKingdom;
      a.el.classList.toggle("dimmed", !visA);
      a.el.classList.toggle("active", sel);
      a.el.classList.toggle("label-only", !sel);
      const priority = (sel ? 100 : 0) + (visA ? 10 : 0);
      place.push({ el: a.el, x: q.sx, y: q.sy, priority });
    }
    placeLabels(place);
    updateSelLabel();
  }

  function updateFlow(dt) {
    if (!flowPts) return;
    const pos = flowPts.geometry.attributes.position;
    for (let i = 0; i < flowParts.length; i++) {
      const fl = flowParts[i];
      fl.u += fl.sp * dt;
      if (fl.u > 1) flowParts[i] = spawnFlow(mulberry32((i * 99 + (fl.u * 1000) | 0) | 0));
      const p = flowPos(flowParts[i]);
      pos.setXYZ(
        i,
        p.x * WORLD_SCALE * TREE_VOLUME,
        p.y * WORLD_SCALE * TREE_VOLUME,
        p.z * WORLD_SCALE * TREE_VOLUME
      );
    }
    pos.needsUpdate = true;
  }

  let splitTrunkIdx = [];
  let splitOtherIdx = [];

  function setKingdomGlow() {
    if (!trunkPts || !otherPts) return;
    const { kingdom, selectedId } = getState();
    const visKingdom = kingdom === "全部" ? null : kingdom;

    function apply(handle, idxList) {
      const sizes = handle.geometry.attributes.aSize;
      const glows = handle.geometry.attributes.aGlow;
      const cols = handle.geometry.attributes.aColor;
      for (let k = 0; k < idxList.length; k++) {
        const s = productStars[idxList[k]];
        if (!s) continue;
        const vis = !visKingdom || s.kingdom === visKingdom;
        const sel = selectedId === s.id;
        const base =
          s.kind === "featured" ? 1.2 : s.kind === "lotus" ? 0.55 : 0.48;
        sizes.setX(k, sel ? base * 1.45 : base);
        glows.setX(
          k,
          sel
            ? 1.4
            : vis
              ? s.kind === "featured"
                ? 1.25
                : s.kind === "lotus"
                  ? 0.7
                  : 0.55
              : 0.04
        );
        if (s.layer === "trunk" && vis) {
          if (s.part === "core" || s.part === "limb") {
            glows.setX(k, glows.getX(k) * 0.55);
          } else if (s.part === "twig") {
            glows.setX(k, glows.getX(k) * 1.15);
          }
        }
        const layerC = LAYER_COLOR[s.layer] || LAYER_COLOR.canopy;
        const kindC = KINGDOM_COLOR[s.kingdom] || layerC;
        const mix =
          s.layer === "rhizosphere" || s.layer === "soil"
            ? 0.06
            : s.kind === "featured"
              ? 0.32
              : 0.22;
        const c = layerC.clone().lerp(kindC, mix);
        let bright =
          (s.kind === "featured" ? 1.1 : s.kind === "lotus" ? 0.72 : 0.85) *
          set.bright *
          (vis ? 1 : 0.08) *
          (sel ? 1.15 : 1);
        if (s.layer === "trunk") {
          if (!set.showTrunk) {
            sizes.setX(k, 0);
            glows.setX(k, 0);
            cols.setXYZ(k, 0, 0, 0);
            continue;
          }
          if (s.part === "core" || s.part === "limb") bright *= 0.6;
          else if (s.part === "twig") bright *= 1.25;
          else bright *= 0.75;
        }
        if (s.layer === "rhizosphere") {
          bright *= 1.4;
        }
        if (s.layer === "soil") bright *= 0.55;
        cols.setXYZ(k, c.r * bright, c.g * bright, c.b * bright);
      }
      sizes.needsUpdate = true;
      glows.needsUpdate = true;
      cols.needsUpdate = true;
    }
    apply(trunkPts, splitTrunkIdx);
    apply(otherPts, splitOtherIdx);
  }

  /** 随机枝条事件：生长 / 掉落 光点 */
  const events = [];
  let evPts = null;
  let evNext = 2.5;
  const EV_N = 48;

  function spawnEvent() {
    const g = crownGeom(P);
    const rnd = mulberry32((Math.random() * 1e9) | 0);
    const kind = rnd() < 0.55 ? "grow" : "fall";
    // 生长：冠下缘/枝梢；掉落：从冠中落下
    const a = rnd() * Math.PI * 2;
    const rr = g.R * (0.3 + rnd() * 0.55);
    const y0 =
      kind === "grow"
        ? g.CY - g.half * (0.3 + rnd() * 0.5)
        : g.CY + (rnd() * 0.4 - 0.1) * g.half;
    events.push({
      x: Math.cos(a) * rr,
      y: y0 * WORLD_SCALE,
      z: Math.sin(a) * rr,
      y0,
      t: 0,
      life: kind === "grow" ? 2.8 + rnd() * 1.5 : 2.2 + rnd() * 1.2,
      kind,
      seed: rnd(),
    });
    if (events.length > EV_N) events.shift();
  }

  function ensureEventPoints() {
    if (evPts) return;
    const n = EV_N;
    const p = new Float32Array(n * 3);
    const c = new Float32Array(n * 3);
    const s = new Float32Array(n);
    const d = new Float32Array(n);
    const gl = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3 + 1] = -999;
      c[i * 3] = 0.55;
      c[i * 3 + 1] = 0.85;
      c[i * 3 + 2] = 0.45;
      s[i] = 1.8;
      d[i] = i / n;
      gl[i] = 1.2;
      r[i] = 0.92;
    }
    evPts = makePoints(p, c, s, d, gl, set.sizeScale * 1.1, null, r);
  }

  function updateEvents(dt) {
    ensureEventPoints();
    evNext -= dt;
    if (evNext <= 0) {
      spawnEvent();
      evNext = 2.5 + Math.random() * 4.5;
    }
    const pos = evPts.geometry.attributes.position;
    const sz = evPts.geometry.attributes.aSize;
    const gl = evPts.geometry.attributes.aGlow;
    for (let i = 0; i < EV_N; i++) {
      const e = events[i];
      if (!e) {
        pos.setXYZ(i, 0, -999, 0);
        continue;
      }
      e.t += dt;
      const u = e.t / e.life;
      if (u >= 1) {
        pos.setXYZ(i, 0, -999, 0);
        continue;
      }
      if (e.kind === "grow") {
        const k = Math.min(1, e.t / 0.9);
        const fade = 1 - Math.max(0, (u - 0.75) / 0.25);
        pos.setXYZ(
          i,
          e.x * WORLD_SCALE * TREE_VOLUME,
          e.y0 * WORLD_SCALE * TREE_VOLUME,
          e.z * WORLD_SCALE * TREE_VOLUME
        );
        sz.setX(i, (0.3 + 1.6 * k) * fade);
        gl.setX(i, 1.4 * fade);
      } else {
        const fall = u * u * 1.8;
        const fade = 1 - u;
        pos.setXYZ(
          i,
          e.x * WORLD_SCALE * TREE_VOLUME + Math.sin(e.t * 2 + e.seed) * 0.15,
          (e.y0 - fall) * WORLD_SCALE * TREE_VOLUME,
          e.z * WORLD_SCALE * TREE_VOLUME + Math.cos(e.t * 1.7 + e.seed) * 0.12
        );
        sz.setX(i, 1.5 * (0.4 + 0.6 * fade));
        gl.setX(i, 1.1 * fade);
      }
    }
    pos.needsUpdate = true;
    sz.needsUpdate = true;
    gl.needsUpdate = true;
  }

  // ── 同来源连线 ──
  let linkLines = null;
  let linkFlow = null;
  /** @type {{star:object, ax:number, ay:number, az:number}[]} */
  let linkPairs = [];
  let hoverLinkIdx = -1;

  function disposeLinkLines() {
    linkParent = "";
    hoverLinkIdx = -1;
    linkPairs = [];
    linkRelease = null;
    linkBaseCols = null;
    hiddenSegIdx = -1;
    hideLinkPlate();
    if (linkFlow) {
      scene.remove(linkFlow);
      linkFlow.geometry.dispose();
      linkFlow.material.dispose();
      linkFlow = null;
    }
    if (linkLines) {
      scene.remove(linkLines);
      linkLines.geometry.dispose();
      linkLines.material.dispose();
      linkLines = null;
    }
  }

  function ensureLinkFlow() {
    if (linkFlow) return linkFlow;
    const geo = new THREE.BufferGeometry();
    const SEG = 40; // 更细才弯得顺
    const pos = new Float32Array((SEG + 1) * 3);
    const col = new Float32Array((SEG + 1) * 3);
    const tArr = new Float32Array(SEG + 1);
    for (let i = 0; i <= SEG; i++) tArr[i] = i / SEG;
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aT", new THREE.BufferAttribute(tArr, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute vec3 aCol;
        uniform float uTime;
        varying vec3 vCol;
        varying float vPulse;
        void main() {
          vCol = aCol;
          float p = fract(aT - uTime * 0.85);
          float pulse = smoothstep(0.0, 0.08, p) * smoothstep(0.28, 0.10, p);
          float pulse2 = smoothstep(0.0, 0.06, fract(p + 0.45)) * smoothstep(0.22, 0.08, fract(p + 0.45));
          vPulse = 0.55 + pulse * 1.1 + pulse2 * 0.65;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        varying float vPulse;
        void main() {
          gl_FragColor = vec4(vCol * vPulse, clamp(0.45 + vPulse * 0.35, 0.0, 1.0));
        }
      `,
    });
    linkFlow = new THREE.Line(geo, mat);
    linkFlow.frustumCulled = false;
    linkFlow.visible = false;
    scene.add(linkFlow);
    return linkFlow;
  }

  /** 把鼠标反投影到过线中点、面向相机的平面，得到磁吸目标点 */
  const _magMid = new THREE.Vector3();
  const _magNdc = new THREE.Vector3();
  const _magTarget = new THREE.Vector3();
  function pointerWorldOnLinePlane(ax, ay, az, bx, by, bz, mx, my) {
    _magMid.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    const depth = camera.position.distanceTo(_magMid);
    _magNdc.set((mx / W) * 2 - 1, -(my / H) * 2 + 1, 0.5);
    _magNdc.unproject(camera);
    _magNdc.sub(camera.position).normalize();
    _magTarget.copy(camera.position).addScaledVector(_magNdc, depth);
    return { mid: _magMid, target: _magTarget, depth };
  }

  /** 把磁吸偏移压到相机平面（减少「朝屏幕外/里」拉，屏幕拾取才跟得上） */
  const _camR = new THREE.Vector3();
  const _camU = new THREE.Vector3();
  const _camF = new THREE.Vector3();
  function flattenPullToScreenPlane(dx, dy, dz) {
    camera.matrixWorld.extractBasis(_camR, _camU, _camF);
    const rx = dx * _camR.x + dy * _camR.y + dz * _camR.z;
    const uy = dx * _camU.x + dy * _camU.y + dz * _camU.z;
    // 几乎全在屏幕平面内，只留一点深度避免完全纸片化
    const depth = 0.12 * (dx * _camF.x + dy * _camF.y + dz * _camF.z);
    return {
      x: _camR.x * rx + _camU.x * uy + _camF.x * depth,
      y: _camR.y * rx + _camU.y * uy + _camF.y * depth,
      z: _camR.z * rx + _camU.z * uy + _camF.z * depth,
    };
  }

  /**
   * 悬停连线：吸附后更强磁吸 + 粘滞阻尼 + 名牌。
   * 磁吸限制在屏幕平面，避免三维拉出屏导致「看着贴着却已断开」。
   */
  let magSmooth = { x: 0, y: 0, z: 0, has: false };
  function updateLinkMagnet(dt) {
    if (hoverLinkIdx < 0 || !linkPairs[hoverLinkIdx] || !lastPtr.has) {
      magSmooth.has = false;
      if (linkPlateEl) linkPlateEl.hidden = true;
      return;
    }
    const pair = linkPairs[hoverLinkIdx];
    const flow = ensureLinkFlow();
    flow.visible = true;
    const posAttr = flow.geometry.attributes.position;
    const colAttr = flow.geometry.attributes.aCol;
    const n = posAttr.count;
    const A = pair.from;
    const B = pair.star.pos;
    const mag = pointerWorldOnLinePlane(A.x, A.y, A.z, B.x, B.y, B.z, lastPtr.x, lastPtr.y);
    const c = KINGDOM_COLOR[pair.star.kingdom] || KINGDOM_COLOR.植物;
    const r = 1.15 + c.r * 0.5;
    const g = 0.95 + c.g * 0.55;
    const b = 0.4 + c.b * 0.5;

    const raw = flattenPullToScreenPlane(
      mag.target.x - mag.mid.x,
      mag.target.y - mag.mid.y,
      mag.target.z - mag.mid.z
    );
    const pull = 0.78;
    const step = dt > 0 ? 1 - Math.pow(0.0008, Math.min(dt, 0.05)) : 1;
    if (!magSmooth.has) {
      magSmooth.x = raw.x;
      magSmooth.y = raw.y;
      magSmooth.z = raw.z;
      magSmooth.has = true;
    } else {
      magSmooth.x += (raw.x - magSmooth.x) * step;
      magSmooth.y += (raw.y - magSmooth.y) * step;
      magSmooth.z += (raw.z - magSmooth.z) * step;
    }

    let peak = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const bulge = Math.pow(Math.sin(Math.PI * u), 0.72);
      const k = bulge * pull;
      const x = A.x + (B.x - A.x) * u + magSmooth.x * k;
      const y = A.y + (B.y - A.y) * u + magSmooth.y * k;
      const z = A.z + (B.z - A.z) * u + magSmooth.z * k;
      posAttr.setXYZ(i, x, y, z);
      const hot = 0.75 + 0.55 * bulge;
      colAttr.setXYZ(i, r * hot, g * hot, b * hot);
      if (Math.abs(u - 0.55) < 1 / (n - 1)) peak = { x, y, z };
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    if (!linkPlateEl) return;
    const label = pair.star.nameZh || "未命名物质";
    if (linkPlateEl.dataset.id !== pair.star.id) {
      linkPlateEl.textContent = label;
      linkPlateEl.dataset.id = pair.star.id;
      linkPlateEl.title = `${label}${pair.star.organismZh ? " · " + pair.star.organismZh : ""}`;
    }
    const q = projectVec(peak);
    if (q.z < 0.05 || q.ndcZ > 0.999) {
      linkPlateEl.hidden = true;
      return;
    }
    linkPlateEl.hidden = false;
    linkPlateEl.classList.add("stuck");
    linkPlateEl.style.left = `${q.sx}px`;
    linkPlateEl.style.top = `${q.sy - 22}px`;
  }

  function hideLinkPlate() {
    if (linkPlateEl) {
      linkPlateEl.hidden = true;
      linkPlateEl.dataset.id = "";
    }
  }

  function easeOutElastic(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }

  /** 断开吸附：弹性回弹到直线并淡出，而不是瞬间消失 */
  let linkRelease = null;
  function startLinkRelease() {
    if (hoverLinkIdx < 0 || !linkPairs[hoverLinkIdx] || !linkFlow) return;
    const segIdx = hoverLinkIdx;
    linkRelease = {
      pair: linkPairs[hoverLinkIdx],
      segIdx,
      ox: magSmooth.has ? magSmooth.x : 0,
      oy: magSmooth.has ? magSmooth.y : 0,
      oz: magSmooth.has ? magSmooth.z : 0,
      t: 0,
      dur: 0.62,
    };
    // 回弹期间原直线仍隐藏，结束再恢复
    hoverLinkIdx = -1;
    hideLinkPlate();
    magSmooth.has = false;
  }

  function updateLinkRelease(dt) {
    if (!linkRelease || !linkFlow) return;
    linkRelease.t += dt / linkRelease.dur;
    const u = Math.min(1, linkRelease.t);
    // 弹性：1 → 过冲 → 0，线「弹回」直线
    const m = 1 - easeOutElastic(u);
    const fade = 1 - u * u;
    const pair = linkRelease.pair;
    const A = pair.from;
    const B = pair.star.pos;
    const posAttr = linkFlow.geometry.attributes.position;
    const colAttr = linkFlow.geometry.attributes.aCol;
    const n = posAttr.count;
    const c = KINGDOM_COLOR[pair.star.kingdom] || KINGDOM_COLOR.植物;
    const r = (1.15 + c.r * 0.5) * fade;
    const g = (0.95 + c.g * 0.55) * fade;
    const b = (0.4 + c.b * 0.5) * fade;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const bulge = Math.pow(Math.sin(Math.PI * t), 0.72) * 0.78 * m;
      posAttr.setXYZ(
        i,
        A.x + (B.x - A.x) * t + linkRelease.ox * bulge,
        A.y + (B.y - A.y) * t + linkRelease.oy * bulge,
        A.z + (B.z - A.z) * t + linkRelease.oz * bulge
      );
      colAttr.setXYZ(i, r, g, b);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    linkFlow.visible = true;
    if (u >= 1) {
      // 弹回直线结束 → 恢复基础线
      if (linkRelease.segIdx >= 0) {
        if (hiddenSegIdx === linkRelease.segIdx) restoreBaseSeg();
      }
      linkRelease = null;
      if (hoverLinkIdx < 0) linkFlow.visible = false;
    }
  }

  function setHoverLink(idx, mouseX, mouseY) {
    if (mouseX != null) {
      lastPtr.x = mouseX;
      lastPtr.y = mouseY;
      lastPtr.has = true;
    }
    if (idx === hoverLinkIdx) {
      if (idx >= 0) {
        updateLinkMagnet(lastDt);
      }
      return;
    }
    if (idx < 0 || !linkPairs[idx]) {
      startLinkRelease();
      if (!hoverId) canvas.style.cursor = "grab";
      return;
    }
    // 切到新线：打断回弹，并隐藏对应原直线
    if (linkRelease && linkRelease.segIdx >= 0) {
      // 切换时直接恢复旧段
      if (hiddenSegIdx === linkRelease.segIdx) restoreBaseSeg();
      linkRelease = null;
    }
    hideBaseSeg(idx);
    hoverLinkIdx = idx;
    canvas.style.cursor = "pointer";
    magSmooth.has = false;
    updateLinkMagnet(0.016);
  }

  /** 选中后星点只认「贴核」，把命中让给连线 */
  const STAR_CORE_R = 13;

  /** 指针到「当前磁吸弯曲线」的屏幕距离（保持判定用） */
  function screenDistToBentLink(mx, my, pair) {
    const A = pair.from;
    const B = pair.star.pos;
    const ox = magSmooth.has ? magSmooth.x : 0;
    const oy = magSmooth.has ? magSmooth.y : 0;
    const oz = magSmooth.has ? magSmooth.z : 0;
    const pull = 0.78;
    let best = Infinity;
    let prev = projectVec(A);
    if (prev.z < 0.05 || prev.ndcZ > 0.999) return 1e9;
    const N = 14;
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const bulge = Math.pow(Math.sin(Math.PI * u), 0.72) * pull;
      const q = projectVec({
        x: A.x + (B.x - A.x) * u + ox * bulge,
        y: A.y + (B.y - A.y) * u + oy * bulge,
        z: A.z + (B.z - A.z) * u + oz * bulge,
      });
      if (q.z < 0.05 || q.ndcZ > 0.999) {
        prev = q;
        continue;
      }
      const abx = q.sx - prev.sx;
      const aby = q.sy - prev.sy;
      const apx = mx - prev.sx;
      const apy = my - prev.sy;
      const ab2 = abx * abx + aby * aby;
      let t = ab2 > 1e-6 ? (apx * abx + apy * aby) / ab2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(mx - (prev.sx + abx * t), my - (prev.sy + aby * t));
      if (d < best) best = d;
      prev = q;
    }
    return best;
  }

  /**
   * 屏幕空间点到线段 + 迟滞吸附。
   * - 掠过：须贴近线身才吸上
   * - 吸上后：锁定该线，路过其他线不切换；拉到「半线长」外才断开
   * - 点击：仍可点其它线/名牌跳转
   */
  function pickLinkDetailed(mx, my, mode) {
    if (!linkPairs.length) return null;
    const sel = productStars.find(
      (x) => x.id === (getState().selectedId || "")
    );
    if (!sel) return null;
    const a = projectVec(sel.pos);
    if (a.z < 0.05 || a.ndcZ > 0.999) return null;
    const isClick = mode === "click";

    // 已吸附 + 悬停：按「当前弯曲线」的屏幕距离保持，不是直线
    const locked = hoverLinkIdx >= 0 && !!linkPairs[hoverLinkIdx];
    if (locked && !isClick) {
      const i = hoverLinkIdx;
      const pair = linkPairs[i];
      const aQ = projectVec(sel.pos);
      const bQ = projectVec(pair.star.pos);
      const half = Math.hypot(bQ.sx - aQ.sx, bQ.sy - aQ.sy) * 0.5;
      // 约为上一版（1.35×半线长）的 1/3
      const holdR = Math.max(12, Math.min(72, half * 0.45));
      const d = screenDistToBentLink(mx, my, pair);
      if (d >= holdR) return null;
      return { idx: i, d, reach: holdR };
    }

    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < linkPairs.length; i++) {
      const b = projectVec(linkPairs[i].star.pos);
      if (b.z < 0.05 || b.ndcZ > 0.999) continue;
      const abx = b.sx - a.sx;
      const aby = b.sy - a.sy;
      const segLen = Math.hypot(abx, aby);
      const half = segLen * 0.5;
      const apx = mx - a.sx;
      const apy = my - a.sy;
      const ab2 = abx * abx + aby * aby;
      let t = ab2 > 1e-6 ? (apx * abx + apy * aby) / ab2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = a.sx + abx * t;
      const cy = a.sy + aby * t;
      let d = Math.hypot(mx - cx, my - cy);
      const dEnd = Math.hypot(mx - b.sx, my - b.sy);
      const endR = Math.max(18, half * 0.28);
      if (dEnd < endR) d = Math.min(d, dEnd * 0.6);

      const attachR = isClick
        ? Math.max(20, Math.min(48, half * 0.35))
        : Math.max(14, Math.min(28, half * 0.22));
      const holdR = Math.max(20, Math.min(160, half));
      const held = i === hoverLinkIdx;
      const reach = held ? holdR : attachR;
      if (d >= reach) continue;
      const score = d * (held ? 0.7 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = { idx: i, d, reach };
      }
    }
    return best;
  }

  function pickLink(mx, my, maxDist) {
    const r = pickLinkDetailed(mx, my, maxDist);
    return r ? r.idx : -1;
  }

  /**
   * 有连线时：线优先，星只在贴核时生效。
   * 解决「星点大光晕永远抢过细线」的经典拾取冲突。
   */
  function pickForPointer(mx, my, isClick) {
    const { kingdom, selectedId } = getState();
    const hasLinks = linkPairs.length > 0;
    // 点击时略放宽，仍以「半线长」为基准
    const linkHit = hasLinks
      ? pickLinkDetailed(mx, my, isClick ? "click" : "hover")
      : null;

    const visKingdom = kingdom === "全部" ? null : kingdom;
    const near = cam.dist < 14;
    let star = null;
    let starD = Infinity;
    for (let i = 0; i < productStars.length; i++) {
      const s = productStars[i];
      if (!near && s.kind !== "featured") continue;
      if (visKingdom && s.kingdom !== visKingdom) continue;
      const q = projectVec(s.pos);
      if (q.z < 0.05 || q.z > 40 || q.ndcZ > 0.999) continue;
      const d = Math.hypot(q.sx - mx, q.sy - my);
      let hitR;
      if (hasLinks) {
        // 选中态：几乎只认星核；选中星本身保持正常命中
        hitR =
          s.id === selectedId
            ? Math.max(20, Math.min(64, 48 / Math.max(0.2, q.z * 8)))
            : STAR_CORE_R;
      } else {
        const sizePx =
          (s.kind === "featured" ? 1.7 : 0.9) * (48 / Math.max(0.15, q.z * 55));
        hitR = Math.max(18, Math.min(80, sizePx * 1.25 + 12));
      }
      if (d < hitR && d < starD) {
        starD = d;
        star = s;
      }
    }

    if (linkHit && star) {
      // 贴在星核上 → 点星；否则点线
      if (starD < STAR_CORE_R * 0.65 && star.id !== selectedId) {
        return { type: "star", star };
      }
      return { type: "link", idx: linkHit.idx, star: linkPairs[linkHit.idx].star };
    }
    if (star) return { type: "star", star };
    if (linkHit) {
      return { type: "link", idx: linkHit.idx, star: linkPairs[linkHit.idx].star };
    }
    return null;
  }

  function buildSourceLinks(selected) {
    disposeLinkLines();
    linkParent = "";
    if (!selected || !productStars.length) return;
    const key = selected.organismZh || selected.nodeId || selected.inchikey;
    if (!key) return;
    // 连线父级 = 与 buildSourceLinks 相同的归并键
    linkParent = selected.organismZh
      ? `同源 · ${shortText(selected.organismZh, 16)}`
      : selected.nodeId
        ? `同节点 · ${selected.nodeId}`
        : selected.inchikey
          ? `同结构 · ${shortText(selected.inchikey, 14)}`
          : "";
    const related = [];
    for (const s of productStars) {
      if (s === selected) continue;
      const sameOrg = selected.organismZh && s.organismZh === selected.organismZh;
      const sameNode = selected.nodeId && s.nodeId === selected.nodeId;
      if (sameOrg || sameNode) related.push(s);
    }
    // 最多连 200 条，避免太密
    const max = Math.min(200, related.length);
    if (max === 0) return;

    linkPairs = related.slice(0, max).map((s) => ({
      star: s,
      from: selected.pos,
    }));

    // 基础连线用 fat line（普通 LineSegments 线宽在 WebGL 上无效）
    const geo = new LineSegmentsGeometry();
    const posArr = new Float32Array(max * 6);
    const colArr = new Float32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const s = related[i];
      posArr[i * 6] = selected.pos.x;
      posArr[i * 6 + 1] = selected.pos.y;
      posArr[i * 6 + 2] = selected.pos.z;
      posArr[i * 6 + 3] = s.pos.x;
      posArr[i * 6 + 4] = s.pos.y;
      posArr[i * 6 + 5] = s.pos.z;
      // 暗金底 + 类群微差
      const kc = KINGDOM_COLOR[s.kingdom] || KINGDOM_COLOR.植物;
      const r = 0.72 + kc.r * 0.28;
      const g = 0.55 + kc.g * 0.32;
      const b = 0.22 + kc.b * 0.32;
      colArr[i * 6] = r;
      colArr[i * 6 + 1] = g;
      colArr[i * 6 + 2] = b;
      colArr[i * 6 + 3] = r * 1.15;
      colArr[i * 6 + 4] = g * 1.15;
      colArr[i * 6 + 5] = b * 1.15;
    }
    geo.setPositions(posArr);
    geo.setColors(colArr);
    linkBaseCols = colArr.slice();
    hiddenSegIdx = -1;
    const mat = new LineMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      linewidth: 1.5,
      worldUnits: false,
    });
    mat.resolution.set(W, H);
    linkLines = new LineSegments2(geo, mat);
    linkLines.frustumCulled = false;
    scene.add(linkLines);
  }

  /** 吸附时把原直线该段藏掉，只留磁吸高亮线 */
  let linkBaseCols = null;
  let hiddenSegIdx = -1;
  function applySegColor(i, hide) {
    if (!linkLines || !linkBaseCols || i < 0) return;
    const geo = linkLines.geometry;
    const cs = geo.attributes.instanceColorStart;
    const ce = geo.attributes.instanceColorEnd;
    if (!cs || !ce) return;
    const o = i * 6;
    if (hide) {
      cs.setXYZ(i, 0, 0, 0);
      ce.setXYZ(i, 0, 0, 0);
    } else {
      cs.setXYZ(i, linkBaseCols[o], linkBaseCols[o + 1], linkBaseCols[o + 2]);
      ce.setXYZ(
        i,
        linkBaseCols[o + 3],
        linkBaseCols[o + 4],
        linkBaseCols[o + 5]
      );
    }
    cs.needsUpdate = true;
    ce.needsUpdate = true;
  }
  function hideBaseSeg(i) {
    if (hiddenSegIdx === i) return;
    if (hiddenSegIdx >= 0) applySegColor(hiddenSegIdx, false);
    hiddenSegIdx = i;
    if (i >= 0) applySegColor(i, true);
  }
  function restoreBaseSeg() {
    if (hiddenSegIdx >= 0) applySegColor(hiddenSegIdx, false);
    hiddenSegIdx = -1;
  }

  let last = 0;
  let frameN = 0;
  function tick(ts) {
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    lastDt = dt;
    const now = (ts - t0) / 1000;

    if (fly.active) {
      fly.t += dt / fly.dur;
      const k = ease(Math.min(1, fly.t));
      cam.yaw = fly.from.yaw + (fly.to.yaw - fly.from.yaw) * k;
      cam.pitch = fly.from.pitch + (fly.to.pitch - fly.from.pitch) * k;
      cam.dist = fly.from.dist + (fly.to.dist - fly.from.dist) * k;
      cam.distTarget = cam.dist;
      cam.fx = fly.from.fx + (fly.to.fx - fly.from.fx) * k;
      cam.fy = fly.from.fy + (fly.to.fy - fly.from.fy) * k;
      cam.fz = fly.from.fz + (fly.to.fz - fly.from.fz) * k;
      if (fly.t >= 1) {
        fly.active = false;
        vel.yaw = 0;
        vel.pitch = 0;
        // 点选/飞近后恢复自转（可用 ⚙ 关掉）
        if (set.autoRotate) cam.auto = true;
      }
    } else {
      // 惯性：松手后速度按 exp(-dt/τ) 衰减，继续「甩」一段
      if (!dragging) {
        cam.yaw += vel.yaw;
        cam.pitch = Math.max(
          -PITCH_LIM,
          Math.min(PITCH_LIM, cam.pitch + vel.pitch)
        );
        const decay = Math.exp(-dt / INERTIA_TAU);
        vel.yaw *= decay;
        vel.pitch *= decay;
        if (Math.abs(vel.yaw) < 1e-5) vel.yaw = 0;
        if (Math.abs(vel.pitch) < 1e-5) vel.pitch = 0;
      }
      // 移动时保持自转
      if (cam.auto && !dragging) {
        // 选中后自转降为 1/10，方便看连线
        const spin = getState().selectedId ? set.spin * 0.1 : set.spin;
        cam.yaw += dt * spin;
      }
    }

    applyWasd(dt);

    // 缩放：目标距离 → 指数阻尼跟随（穿越感）
    {
      const zk = damp(dt, DAMP_K);
      cam.dist += (cam.distTarget - cam.dist) * zk;
    }

    // 拉到最远：未拖拽/WASD 时缓缓回到树心
    if (
      !fly.active &&
      !fpMode &&
      !wasdActive() &&
      !dragging &&
      cam.distTarget >= DIST_MAX * 0.92
    ) {
      const fx0 = 0;
      const fy0 = ((TREE_Y1 + TREE_Y0) / 2) * WORLD_SCALE;
      const fz0 = 0;
      cam.fx += (fx0 - cam.fx) * 0.08;
      cam.fy += (fy0 - cam.fy) * 0.08;
      cam.fz += (fz0 - cam.fz) * 0.08;
    }

    applyCamera();
    updateFlow(dt);

    const t = now;
    if (structPts) structPts.material.uniforms.uTime.value = t;
    if (trunkPts) trunkPts.material.uniforms.uTime.value = t;
    if (otherPts) otherPts.material.uniforms.uTime.value = t;
    if (flowPts) flowPts.material.uniforms.uTime.value = t;
    if (evPts) evPts.material.uniforms.uTime.value = t;
    if (linkFlow && linkFlow.visible && !linkRelease) {
      linkFlow.material.uniforms.uTime.value = t;
    }
    if (hoverLinkIdx >= 0) updateLinkMagnet(dt);
    else if (linkRelease) updateLinkRelease(dt);
    tickIntro(now);
    updateEvents(dt);

    // 结构随距离变淡
    if (structPts) {
      const g =
        cam.dist < 3 ? 0.22 : cam.dist < 8 ? 0.45 : cam.dist < 16 ? 0.7 : 0.9;
      structPts.material.uniforms.uSizeScale.value = 28 * g;
    }

    updateDom(t);

    // 缩放联动：中景保持接近原尺寸，远景略收
    const dist = cam.dist;
    const lodScale =
      dist < 4
        ? 1.1
        : dist < 12
          ? 1.05
          : dist < 24
            ? 1.0
            : dist < 42
              ? 0.9
              : 0.78;
    if (trunkPts) trunkPts.material.uniforms.uSizeScale.value = set.sizeScale * lodScale;
    if (otherPts) otherPts.material.uniforms.uSizeScale.value = set.sizeScale * lodScale;

    // 树干选择性 Bloom：非树干压黑 → bloom → 与主画面混合
    if (set.bloom && bloomComposer && finalComposer && mixPass && trunkPts) {
      bloomPass.strength = set.bloomStrength;
      bloomPass.radius = set.bloomRadius;
      bloomPass.threshold = set.bloomThreshold;
      scene.traverse(darkenNonBloom);
      bloomComposer.render();
      scene.traverse(restoreMaterial);
      mixPass.uniforms["bloomTexture"].value =
        bloomComposer.renderTarget2.texture;
      renderer.setRenderTarget(null);
      finalComposer.render();
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }

    raf = requestAnimationFrame(tick);
  }

  // 输入
  let dragging = false;
  let dragDist = 0;
  let lx = 0;
  let ly = 0;

  function onDown(e) {
    if (fpMode) return;
    dragging = true;
    dragDist = 0;
    fly.active = false;
    vel.yaw = 0;
    vel.pitch = 0;
    lx = e.clientX;
    ly = e.clientY;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
  }
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    lastPtr.x = mx;
    lastPtr.y = my;
    lastPtr.has = true;
    if (!dragging) {
      updateHoverTip(mx, my, performance.now());
      return;
    }
    const dx = e.clientX - lx;
    const dy = e.clientY - ly;
    dragDist += Math.abs(dx) + Math.abs(dy);
    hideTip();
    // 诗云 orbit：yaw -= dx*0.005；pitch += dy*0.005
    vel.yaw = -dx * ORBIT_SENS;
    vel.pitch = dy * ORBIT_SENS;
    cam.yaw += vel.yaw;
    cam.pitch = Math.max(-PITCH_LIM, Math.min(PITCH_LIM, cam.pitch + vel.pitch));
    lx = e.clientX;
    ly = e.clientY;
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (dragDist < 10) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const pick = pickForPointer(mx, my, true);
      if (pick && pick.type === "star") {
        vel.yaw = 0;
        vel.pitch = 0;
        setSelected(pick.star.id);
        return;
      }
      if (pick && pick.type === "link" && pick.star) {
        vel.yaw = 0;
        vel.pitch = 0;
        setSelected(pick.star.id);
        return;
      }
      setSelected(null);
      if (set.autoRotate) cam.auto = true;
    } else if (set.autoRotate) {
      cam.auto = true;
    }
  }
  function cancelFlyRestoreAuto() {
    if (!fly.active) return;
    fly.active = false;
    vel.yaw = 0;
    vel.pitch = 0;
    // 中断飞行后立刻恢复自转，否则滚轮一碰就永久停转
    if (set.autoRotate) cam.auto = true;
  }

  function onWheel(e) {
    e.preventDefault();
    hideTip();
    cancelFlyRestoreAuto();
    const step = e.deltaY > 0 ? ZOOM_OUT : ZOOM_IN;
    cam.distTarget = Math.max(
      DIST_MIN,
      Math.min(DIST_MAX, cam.distTarget * step)
    );
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", () => {
    hideTip();
    lastPtr.has = false;
    canvas.style.cursor = "grab";
  });
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // 名牌点击：与点线同一跳转
  linkPlateEl.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const id = linkPlateEl.dataset.id;
    if (!id) return;
    vel.yaw = 0;
    vel.pitch = 0;
    setSelected(id);
  });
  linkPlateEl.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });

  let pinch0 = 0;
  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        pinch0 = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 2 && pinch0 > 0) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        cam.distTarget = Math.max(
          DIST_MIN,
          Math.min(DIST_MAX, cam.distTarget * (pinch0 / Math.max(1, d)))
        );
        pinch0 = d;
        cancelFlyRestoreAuto();
      }
    },
    { passive: true }
  );

  let lastGlowKey = "";
  function glowKey() {
    const { kingdom, selectedId } = getState();
    return `${kingdom}|${selectedId || ""}|${set.bright}|${set.showTrunk}`;
  }

  subscribe(() => {
    const { selectedId } = getState();
    if (selectedId !== lastSel) {
      if (!selectedId) {
        disposeLinkLines();
      } else {
        const a = productStars.find((x) => x.id === selectedId);
        if (a) {
          flyTo(a.pos);
          buildSourceLinks(a);
        }
      }
      lastSel = selectedId;
    }
    const key = glowKey();
    if (key !== lastGlowKey) {
      lastGlowKey = key;
      setKingdomGlow();
    }
  });

  // ── 右上角设置面板 ──
  const setBtn = rootEl.querySelector("#ecoSetBtn");
  const setPanel = rootEl.querySelector("#ecoSetPanel");
  setBtn.addEventListener("click", () => {
    setPanel.hidden = !setPanel.hidden;
  });
  rootEl.querySelector("#ssClose").addEventListener("click", () => {
    setPanel.hidden = true;
  });
  function bindRange(id, key, fmt) {
    const inp = rootEl.querySelector("#" + id);
    const em = rootEl.querySelector("#" + id + "v");
    inp.addEventListener("input", () => {
      set[key] = parseFloat(inp.value);
      if (em) em.textContent = fmt ? fmt(set[key]) : String(set[key]);
      // 有结构云时目录数量无效，避免拖滑条整树 rebuild 卡死
      if (key === "catalogCount" && structureCount() === 0) {
        rebuild();
        lastGlowKey = glowKey();
        setKingdomGlow();
      }
      if (key === "bright") {
        lastGlowKey = glowKey();
        setKingdomGlow();
      }
    });
  }
  bindRange("ssBloomS", "bloomStrength", (v) => v.toFixed(2));
  bindRange("ssBloomR", "bloomRadius", (v) => v.toFixed(2));
  bindRange("ssBloomT", "bloomThreshold", (v) => v.toFixed(2));
  bindRange("ssSize", "sizeScale");
  bindRange("ssBright", "bright", (v) => v.toFixed(2));
  bindRange("ssCount", "catalogCount", (v) => {
    if (structureCount() > 0) return "全量";
    return Math.round(v / 1000) + "k";
  });
  bindRange("ssSpin", "spin", (v) => v.toFixed(2));
  rootEl.querySelector("#ssShowTrunk").addEventListener("change", (e) => {
    set.showTrunk = e.target.checked;
    lastGlowKey = glowKey();
    setKingdomGlow();
  });
  rootEl.querySelector("#ssBloom").addEventListener("change", (e) => {
    set.bloom = e.target.checked;
  });
  rootEl.querySelector("#ssAuto").addEventListener("change", (e) => {
    set.autoRotate = e.target.checked;
    cam.auto = e.target.checked;
  });

  // ── 左上角搜索：名称 / 来源 ──
  const searchInput = rootEl.querySelector("#ecoSearchInput");
  const searchList = rootEl.querySelector("#ecoSearchList");
  let searchTimer = 0;
  let searchHits = [];
  let searchActive = -1;

  function hideSearchList() {
    searchList.hidden = true;
    searchList.innerHTML = "";
    searchHits = [];
    searchActive = -1;
  }

  function runSearch(q) {
    const key = q.trim().toLowerCase();
    if (key.length < 1) {
      hideSearchList();
      return;
    }
    const featured = [];
    const rest = [];
    // 全量扫一次；22 万在防抖后可接受。精选优先展示
    for (let i = 0; i < productStars.length; i++) {
      const s = productStars[i];
      const name = (s.nameZh || "").toLowerCase();
      const en = (s.nameEn || "").toLowerCase();
      const org = (s.organismZh || "").toLowerCase();
      const ik = (s.inchikey || "").toLowerCase();
      const hit =
        name.includes(key) || en.includes(key) || org.includes(key) || ik.includes(key);
      if (!hit) continue;
      const score =
        (name.startsWith(key) ? 0 : org.startsWith(key) ? 1 : 2) +
        (s.kind === "featured" ? 0 : 10);
      const item = { s, score };
      if (s.kind === "featured") featured.push(item);
      else rest.push(item);
      if (featured.length + rest.length > 400) break; // 安全阀
    }
    featured.sort((a, b) => a.score - b.score);
    rest.sort((a, b) => a.score - b.score);
    searchHits = [...featured, ...rest].slice(0, 12).map((x) => x.s);
    if (!searchHits.length) {
      searchList.innerHTML =
        '<div class="eco-search-item" style="cursor:default;color:#8a9bb0">无匹配结果</div>';
      searchList.hidden = false;
      return;
    }
    searchActive = 0;
    searchList.innerHTML = searchHits
      .map((s, i) => {
        const sub = [s.organismZh, s.kingdom, s.chemClass].filter(Boolean).join(" · ");
        const tag = s.kind === "featured" ? "精选" : "LOTUS";
        return `<button type="button" class="eco-search-item${i === 0 ? " active" : ""}" data-i="${i}">
          <span class="s-name">${s.nameZh || s.nameEn || "未命名"}</span>
          <span class="s-sub">${sub || ""} <span class="s-tag">${tag}</span></span>
        </button>`;
      })
      .join("");
    searchList.hidden = false;
  }

  function pickSearchHit(i) {
    const s = searchHits[i];
    if (!s) return;
    hideSearchList();
    searchInput.blur();
    vel.yaw = 0;
    vel.pitch = 0;
    setSelected(s.id);
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const v = searchInput.value;
    searchTimer = setTimeout(() => runSearch(v), 180);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      hideSearchList();
      searchInput.blur();
      return;
    }
    if (searchList.hidden || !searchHits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      searchActive = Math.min(searchHits.length - 1, searchActive + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      searchActive = Math.max(0, searchActive - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickSearchHit(searchActive);
      return;
    } else {
      return;
    }
    [...searchList.querySelectorAll(".eco-search-item")].forEach((el, idx) => {
      el.classList.toggle("active", idx === searchActive);
    });
  });
  searchList.addEventListener("click", (e) => {
    const btn = e.target.closest(".eco-search-item");
    if (!btn || btn.dataset.i == null) return;
    pickSearchHit(Number(btn.dataset.i));
  });
  searchInput.addEventListener("pointerdown", (e) => e.stopPropagation());
  searchList.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.addEventListener("pointerdown", (e) => {
    if (!rootEl.querySelector(".eco-search")?.contains(e.target)) {
      hideSearchList();
    }
  });

  window.addEventListener("resize", resize);
  resize();
  rebuild();
  setKingdomGlow();
  lastGlowKey = glowKey();
  raf = requestAnimationFrame(tick);

  // 调试：控制台可测拾取
  window.__ecoScene = {
    get cam() {
      return { ...cam };
    },
    get counts() {
      return {
        product: productStars.length,
        struct: structPts ? structPts.geometry.attributes.position.count : 0,
        flow: flowParts.length,
      };
    },
    projectAll() {
      return productStars.slice(0, 30).map((s) => {
        const q = projectVec(s.pos);
        return { id: s.id, ...q, kind: s.kind };
      });
    },
    pickAt(x, y) {
      const hit = pickStar(x, y);
      return hit ? { id: hit.id, nameZh: hit.nameZh } : null;
    },
  };

  return {
    render() {
      // 状态未变时跳过 O(n) 高亮，避免 main 订阅与场景订阅双重扫描
      const key = glowKey();
      if (key !== lastGlowKey) {
        lastGlowKey = key;
        setKingdomGlow();
      }
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
  };
}
