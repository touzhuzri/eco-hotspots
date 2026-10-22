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
import { loadFacets } from "../engine/moleculeFacets.js";
import { SOLAR_TERMS, currentSolarTermIndex } from "../data/solarTerms.js";
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

/** 选中光环的暖白金色 */
const AURA_WARM = new THREE.Color(1.0, 0.92, 0.72);

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
  attribute vec3 aClockTarget;
  attribute vec3 aClockArc;
  attribute float aClockDelay;
  uniform float uTime;
  uniform float uClock;
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
    // 闲置钟表：树点沿弧形成群飞向表盘
    float ct = clamp(
      (uClock - aClockDelay) / max(0.0001, 1.0 - aClockDelay),
      0.0,
      1.0
    );
    float ce = ct * ct * ct * (ct * (ct * 6.0 - 15.0) + 10.0);
    vec3 ctrl =
      mix(ip, aClockTarget, 0.5) + aClockArc * sin(3.14159265 * ce);
    vec3 pA = mix(ip, ctrl, ce);
    vec3 pB = mix(ctrl, aClockTarget, ce);
    ip = mix(pA, pB, ce);
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
    float clockK = mix(1.0, 0.78, uClock);
    float sz =
      aSize * breathe * sizeMul * rev * (uSizeScale / vz) * uPixelRatio * clockK;
    // 近：更小上限更锐利；远：略缩下限；钟表态适度放大以接近分针亮度
    float minS = mix(mix(2.2, 1.6, vNear), 1.15, uClock);
    float maxS = mix(mix(36.0, 14.0, vNear), 6.0, uClock);
    gl_PointSize = rev < 0.02 ? 0.0 : clamp(sz, minS, maxS);
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAG = /* glsl */ `
  uniform float uPulse;
  uniform float uDim;
  uniform float uClock;
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
    // 近处收成更锐利的小星核，避免大量星团叠成一片朦胧光斑
    float edgeOut = mix(0.50, 0.34, vNear);
    float edgeIn  = mix(0.06, 0.22, vNear);
    float a = smoothstep(edgeOut, edgeIn, d);
    if (a < 0.02) discard;
    float core = mix(smoothstep(0.30, 0.06, d), smoothstep(0.18, 0.05, d), vNear);
    // 远景压亮度；中景保持偏亮，避免树占满屏时发暗
    float dim = mix(1.05, 0.32, vFar);
    float clockGain = 1.0 + uClock * 0.75;
    vec3 col =
      vColor *
      (0.62 + 0.95 * vTw + core * 0.55) *
      vGlow *
      dim *
      vReveal *
      uPulse *
      uDim *
      clockGain;
    float alpha =
      a *
      (0.68 + 0.38 * clamp(vTw, 0.0, 1.6)) *
      mix(1.0, 0.58, vFar) *
      vReveal *
      uDim;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** 深空星野：固定屏幕尺寸的极暗星点，缓慢眨眼 */
const STARFIELD_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vColor = aColor;
    float tw = 0.68 + 0.32 * sin(uTime * (0.22 + fract(aSeed * 7.1) * 0.35) + aSeed * 6.2831853);
    vTw = tw;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (0.9 + 0.25 * tw);
  }
`;

const STARFIELD_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float a = smoothstep(0.5, 0.06, d);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor * (0.5 + 0.5 * vTw), a * (0.2 + 0.3 * vTw));
  }
`;

/** 叶形光点：比星野更亮的小星点，几十颗拼成一片叶子 */
const LEAF_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vColor = aColor;
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + aSeed * 1.2) + aSeed * 6.2831853);
    vTw = tw;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (0.9 + 0.25 * tw);
  }
`;

const LEAF_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float a = smoothstep(0.5, 0.08, d);
    if (a < 0.02) discard;
    float core = smoothstep(0.22, 0.02, d);
    gl_FragColor = vec4(
      vColor * (0.8 + 0.55 * vTw + core * 0.6),
      a * (0.45 + 0.3 * vTw)
    );
  }
`;

// 土壤长链烷烃：数量与每条链的光点数
const WORM_COUNT = 10;
const WORM_POINTS = 64;

/** 环境光尘：在树周围缓慢漂浮的金/绿微光 */
const MOTE_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vColor = aColor;
    vec3 p = position;
    p.x += sin(uTime * 0.16 + aSeed * 6.2831853) * 3.2;
    p.y += sin(uTime * 0.21 + aSeed * 4.7) * 3.6;
    p.z += cos(uTime * 0.18 + aSeed * 5.3) * 3.2;
    float tw = 0.45 + 0.55 * sin(uTime * (0.5 + fract(aSeed * 3.7) * 0.9) + aSeed * 6.2831853);
    vTw = tw;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (0.85 + 0.25 * tw);
  }
`;

const MOTE_FRAG = /* glsl */ `
  uniform float uPulse;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float a = smoothstep(0.5, 0.05, d);
    if (a < 0.02) discard;
    float tw = clamp(vTw, 0.0, 1.4);
    gl_FragColor = vec4(vColor * (0.55 + 0.6 * tw) * uPulse, a * (0.18 + 0.22 * tw));
  }
`;


function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.25, "rgba(255,255,255,0.30)");
  g.addColorStop(0.55, "rgba(255,255,255,0.09)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 选中光环：中空环，避免把星点本身糊成一团 */
function makeRingTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.42, "rgba(255,255,255,0)");
  g.addColorStop(0.58, "rgba(255,255,255,0.6)");
  g.addColorStop(0.72, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 节气名：淡金描边字 + 柔光，作为地面环端点的小 billboard */
function makeTermLabelTexture(text, active) {
  const w = 160;
  const h = 100;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font =
    '600 50px "Songti SC","STSong","Noto Serif SC","Microsoft YaHei",serif';
  // 外发光
  ctx.shadowColor = active
    ? "rgba(255,214,120,0.95)"
    : "rgba(232,206,148,0.72)";
  ctx.shadowBlur = active ? 18 : 12;
  ctx.fillStyle = active ? "#ffe8ad" : "#e6d5a6";
  ctx.fillText(text, w / 2, h / 2 + 2);
  // 字芯再压一层，近看更清
  ctx.shadowBlur = 0;
  ctx.fillStyle = active ? "#fff7dc" : "#f2e8c9";
  ctx.fillText(text, w / 2, h / 2 + 2);
  if (active) {
    ctx.beginPath();
    ctx.arc(w / 2, h - 10, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,225,150,0.9)";
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

/** 节气指针：从环心指向端点的一束淡金光 */
function makePointerTexture() {
  const w = 256;
  const h = 32;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(255,214,130,0)");
  g.addColorStop(0.55, "rgba(255,214,130,0.12)");
  g.addColorStop(0.85, "rgba(255,226,160,0.65)");
  g.addColorStop(1, "rgba(255,246,214,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 上下柔化，避免出现硬边矩形
  ctx.globalCompositeOperation = "destination-in";
  const v = ctx.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(0.32, "rgba(0,0,0,0.9)");
  v.addColorStop(0.68, "rgba(0,0,0,0.9)");
  v.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 天光柱纹理：顶部收口、底部渐隐、两侧柔化。
 * 用单个 billboard，避免两片交叉平面在顶端出现十字。
 */
function makeBeamTexture() {
  const w = 256;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ny = y / (h - 1);
    const vert =
      Math.min(1, ny / 0.08) * Math.pow(Math.max(0, 1 - ny), 0.55);
    for (let x = 0; x < w; x++) {
      const nx = (x - (w - 1) / 2) / ((w - 1) / 2);
      const side = Math.pow(Math.max(0, 1 - Math.abs(nx)), 1.25);
      const a = Math.min(1, vert * side);
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBackgroundTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(256, 320, 20, 256, 256, 390);
  g.addColorStop(0, "#0a1512");
  g.addColorStop(0.42, "#050a10");
  g.addColorStop(1, "#020308");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 氛围柔光（冠层光环 / 天光柱 / 顶部光源）的朦胧强度。
 * 1 = 原强度；0.25 = 现在的四分之一；0 = 完全关闭。
 */
const AMBIENT_HAZE = 0.25;

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
    <div class="scene-vignette" aria-hidden="true"></div>
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
      <label>星点缩放 <input type="range" id="ssSize" min="12" max="120" step="1" value="60"/><em id="ssSizev">60</em></label>
      <label>亮度 <input type="range" id="ssBright" min="0.3" max="6" step="0.05" value="6"/><em id="ssBrightv">6.00</em></label>
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
  // 深空底色：中心极暗墨绿，边缘近黑；星野在它前面
  scene.background = makeBackgroundTexture();
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
  // 整体（树 + 节气表盘）观感缩到 4/5：相机后退 1/4
  const VIEW_SCALE = 1.25;
  const DIST_MAX =
    (TREE_H / (0.35 * 2 * Math.tan((52 / 2) * (Math.PI / 180)))) *
    CLOUD_FIT *
    (2.0 / 3) *
    VIEW_SCALE;

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
  const fly = {
    active: false,
    t: 0,
    dur: 1.8,
    from: null,
    to: null,
    camStart: null,
    lookStart: null,
  };

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

  /** 可调场景参数（右上角设置面板） — 锁定默认：缩放60/亮6/2.8万点/自转0.08 */
  const set = {
    bloom: false,
    bloomStrength: 0.12,
    bloomRadius: 0.25,
    bloomThreshold: 0.45,
    sizeScale: 60,
    bright: 6,
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
    if (!_lookInit) {
      _look.copy(target);
      _lookInit = true;
    }
    if (fly.active && fly.camStart && fly.lookStart) {
      // 起飞瞬间从“实际相机位置”接管，再交给已经缓动的飞行路径，
      // 避免预设切换第一帧被阻尼状态拽一下。
      const enter = smootherStep(Math.min(1, fly.t * 7));
      camera.position.lerpVectors(fly.camStart, _desired, enter);
      _look.lerpVectors(fly.lookStart, target, enter);
    } else {
      const k = damp(lastDt, DAMP_K);
      _look.lerp(target, k);
      camera.position.lerp(_desired, k);
    }
    _mat.lookAt(camera.position, _look, _up);
    _quat.setFromRotationMatrix(_mat);
    // 自转/拖拽/惯性期间如果仍对朝向做阻尼，视角会持续落后，
    // 快速拖动时表现为来回追、抽搐；树心也会被甩向一侧。
    // 这些纯旋转场景直接对齐 lookAt，平移（WASD）仍保留阻尼。
    const orbiting = !fpMode && !wasdActive();
    const snapLook =
      orbiting &&
      (fly.active ||
        cam.auto ||
        dragging ||
        Math.abs(vel.yaw) > 1e-4 ||
        Math.abs(vel.pitch) > 1e-4);
    if (snapLook) camera.quaternion.copy(_quat);
    else camera.quaternion.slerp(_quat, k);
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

  // ── 闲置留白：10 秒无操作后由 tick 添加 body.idle ──
  function markInteraction() {
    lastInteraction = performance.now();
    document.body.classList.remove("idle");
  }
  window.addEventListener("pointermove", markInteraction, { passive: true });
  window.addEventListener("pointerdown", markInteraction, { passive: true });
  window.addEventListener("wheel", markInteraction, { passive: true });
  window.addEventListener("keydown", markInteraction);
  window.addEventListener("touchstart", markInteraction, { passive: true });

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
        uPulse: { value: 1 },
        uDim: { value: 1 },
        uClock: { value: 0 },
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
  // 场景装饰（节气环/文字/土壤分子）跟随树一起逐渐出现
  let introReveal = 0;
  // 加载页还盖着场景时先暂停生长，等 `is-done` 后再从泥土/根开始
  let introPaused = true;
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
    introReveal = u;
    setRevealAll(u);
    if (raw >= 1) {
      introDone = true;
      introReveal = 1;
      setRevealAll(1);
      // 树完全长成后再让界面浮现归位
      if (document.body.classList.contains("ui-intro")) {
        document.body.classList.remove("ui-intro");
        document.body.classList.remove("idle");
        lastInteraction = performance.now();
        window.dispatchEvent(new CustomEvent("eco:intro-done"));
      }
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
  let viewOffsetX = 0;
  let viewOffsetTarget = 0;
  let sideOffset = 0;
  let railObserver = null;

  // ── 神性氛围层（一次构建，逐帧只更新 uniform/透明度） ──
  let glowTex = null;
  let starfield = null;
  let starfieldMat = null;
  let motes = null;
  let motesMat = null;
  let canopyHalo = null;
  let beamSprite = null;
  let beamSource = null;
  let solarGlow = null;
  let selAura = null;
  let selAuraBase = 0.08;
  let selRipple = null;
  let selRippleStart = null;
  let lastInteraction = performance.now();
  let leaves = [];
  let leafNext = 999;
  let leafGeo = null;
  let leafMat = null;
  let leafPos = null;
  let leafSizes = null;
  let leafBaseSizes = null;
  let leafTemplate = [];
  let leafSpawnPts = [];
  let worms = [];
  let wormGeo = null;
  let wormObj = null;
  let leafObj = null;
  let wormMat = null;
  let wormPos = null;
  let wormSizes = null;
  let wormBaseSizes = null;
  /** LOTUS 长链烷烃池（data/curated/soil-alkanes.json） */
  let alkanePool = [];
  let solarLabels = [];
  let solarGlints = [];
  let solarTermIdx = 0;
  let solarRing = null;
  let solarTicks = null;
  let solarLoopMats = [];
  let solarTickAttr = null;
  let solarTickSegs = [];
  let solarPointerPivot = null;
  let solarPointerMat = null;
  let solarPointerTip = null;
  let solarPointerLen = 0;

  // ── 闲置钟表：树点全体化形 ──
  let clockWanted = 0;
  let clockAmount = 0;
  let clockPrepared = false;
  let clockSavedAuto = false;
  let clockFinalPos = new THREE.Vector3();
  let clockFinalQuat = new THREE.Quaternion();
  let clockBasePos = new THREE.Vector3();
  let clockBaseQuat = new THREE.Quaternion();
  let clockPattern = null;
  let clockRingRadius = 0;
  let clockHandsGroup = null;
  let clockHandMats = [];
  let clockHub = null;
  // 校徽只作为点阵采样的遮罩，不渲染原图
  let clockEmblemMask = null;

  /**
   * 取景偏移：让树心落在「左探索栏右边缘 → 右详情栏左边缘」的正中。
   * 右侧详情栏常驻；左侧探索栏在桌面参与构图，移动端抽屉不参与。
   */
  function computeSideOffset() {
    const detail = document.querySelector(".detail");
    const right =
      (detail ? detail.getBoundingClientRect().width : Math.min(440, W * 0.42)) +
      16;
    let left = 0;
    const mobile = window.matchMedia(
      "(max-width: 900px), (max-height: 520px)"
    ).matches;
    if (!mobile) {
      const rail = document.querySelector(".explore-rail");
      const rw = rail ? rail.getBoundingClientRect().width : 0;
      left = (rw || 0) + 16;
    }
    return (right - left) * 0.5;
  }

  function resize() {
    const rect = rootEl.getBoundingClientRect();
    W = Math.max(320, Math.floor(rect.width || window.innerWidth));
    H = Math.max(320, Math.floor(rect.height || window.innerHeight));
    camera.aspect = W / H;
    // 左右两侧面板常驻：把树心放到可显示区域正中；闲置留白时回到画面中心
    sideOffset = computeSideOffset();
    const idle = document.body.classList.contains("idle");
    viewOffsetTarget = idle ? 0 : sideOffset;
    if (!viewOffsetX) viewOffsetX = viewOffsetTarget;
    camera.setViewOffset(W, H, viewOffsetX, 0, W, H);
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
    if (starfieldMat) starfieldMat.uniforms.uPixelRatio.value = dpr;
    if (motesMat) motesMat.uniforms.uPixelRatio.value = dpr;
    if (leafMat) leafMat.uniforms.uPixelRatio.value = dpr;
    if (wormMat) wormMat.uniforms.uPixelRatio.value = dpr;
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

    // 闲置钟表：为所有产物点准备飞向表盘的属性
    for (const layer of [trunkPts, otherPts]) {
      if (!layer) continue;
      const cnt = layer.geometry.attributes.position.count;
      layer.geometry.setAttribute(
        "aClockTarget",
        new THREE.BufferAttribute(new Float32Array(cnt * 3), 3)
      );
      layer.geometry.setAttribute(
        "aClockArc",
        new THREE.BufferAttribute(new Float32Array(cnt * 3), 3)
      );
      layer.geometry.setAttribute(
        "aClockDelay",
        new THREE.BufferAttribute(new Float32Array(cnt), 1)
      );
    }

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

  /** 神性氛围：星野、光尘、冠层光环、天光柱、二十四节气地环、选中光环 */
  function buildAmbient() {
    if (!built) return;
    glowTex = makeGlowTexture();
    const ringTex = makeRingTexture();
    const scale = WORLD_SCALE * TREE_VOLUME;
    const g = built.crown;
    const crownR = g.R * scale;
    const crownY = g.CY * scale;
    const groundY = -0.52 * scale;
    const rnd = mulberry32(20261019);

    // ── 深空星野 ──
    const starN = weak ? 900 : 2400;
    const sp = new Float32Array(starN * 3);
    const sc = new Float32Array(starN * 3);
    const ss = new Float32Array(starN);
    const sd = new Float32Array(starN);
    for (let i = 0; i < starN; i++) {
      const r = 220 + rnd() * 160;
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      sp[i * 3] = r * Math.sin(ph) * Math.cos(th);
      sp[i * 3 + 1] = r * Math.cos(ph);
      sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      const t = rnd();
      const c =
        t < 0.6
          ? [0.72, 0.82, 1.0]
          : t < 0.85
            ? [0.82, 0.94, 0.8]
            : [1.0, 0.88, 0.68];
      sc[i * 3] = c[0];
      sc[i * 3 + 1] = c[1];
      sc[i * 3 + 2] = c[2];
      ss[i] = 0.9 + rnd() * 1.8;
      sd[i] = rnd();
    }
    const sfGeo = new THREE.BufferGeometry();
    sfGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    sfGeo.setAttribute("aColor", new THREE.BufferAttribute(sc, 3));
    sfGeo.setAttribute("aSize", new THREE.BufferAttribute(ss, 1));
    sfGeo.setAttribute("aSeed", new THREE.BufferAttribute(sd, 1));
    starfieldMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: dpr },
      },
      vertexShader: STARFIELD_VERT,
      fragmentShader: STARFIELD_FRAG,
    });
    starfield = new THREE.Points(sfGeo, starfieldMat);
    starfield.frustumCulled = false;
    starfield.renderOrder = -4;
    scene.add(starfield);

    // ── 环境光尘 ──
    const moteN = weak ? 260 : 760;
    const mp = new Float32Array(moteN * 3);
    const mc = new Float32Array(moteN * 3);
    const ms = new Float32Array(moteN);
    const md = new Float32Array(moteN);
    for (let i = 0; i < moteN; i++) {
      const region = rnd();
      let x;
      let y;
      let z;
      if (region < 0.58) {
        const a = rnd() * Math.PI * 2;
        const r = crownR * (0.15 + 0.95 * Math.sqrt(rnd()));
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        y = crownY + (rnd() * 2 - 1) * g.half * scale * 1.25;
      } else if (region < 0.82) {
        const a = rnd() * Math.PI * 2;
        const r = crownR * (0.4 + 0.9 * rnd());
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        y = groundY + rnd() * 22;
      } else {
        const a = rnd() * Math.PI * 2;
        const r = crownR * (0.1 + 0.35 * rnd());
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        y = groundY + rnd() * (crownY - groundY + 35);
      }
      mp[i * 3] = x;
      mp[i * 3 + 1] = y;
      mp[i * 3 + 2] = z;
      const t = rnd();
      const c =
        t < 0.52
          ? [0.96, 0.82, 0.48]
          : t < 0.82
            ? [0.55, 0.9, 0.66]
            : [0.9, 0.95, 1.0];
      mc[i * 3] = c[0];
      mc[i * 3 + 1] = c[1];
      mc[i * 3 + 2] = c[2];
      ms[i] = 1.2 + rnd() * 2.4;
      md[i] = rnd();
    }
    const moGeo = new THREE.BufferGeometry();
    moGeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
    moGeo.setAttribute("aColor", new THREE.BufferAttribute(mc, 3));
    moGeo.setAttribute("aSize", new THREE.BufferAttribute(ms, 1));
    moGeo.setAttribute("aSeed", new THREE.BufferAttribute(md, 1));
    motesMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: dpr },
        uPulse: { value: 1 },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
    });
    motes = new THREE.Points(moGeo, motesMat);
    motes.frustumCulled = false;
    motes.renderOrder = 1;
    scene.add(motes);

    // ── 冠层光环 ──
    canopyHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xa9e8b8,
        transparent: true,
        opacity: 0.14 * AMBIENT_HAZE,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
      })
    );
    canopyHalo.position.set(0, crownY, 0);
    canopyHalo.scale.set(crownR * 3.4, crownR * 3.4, 1);
    canopyHalo.renderOrder = -2;
    scene.add(canopyHalo);

    // ── 天光柱：单个 billboard，避免交叉平面在顶端出现十字 ──
    beamSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeBeamTexture(),
        color: 0xcfe9d0,
        transparent: true,
        opacity: 0.2 * AMBIENT_HAZE,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
      })
    );
    beamSprite.position.set(0, 46, 0);
    beamSprite.scale.set(crownR * 1.9, 118, 1);
    beamSprite.renderOrder = -1;
    scene.add(beamSprite);

    beamSource = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xdff5e2,
        transparent: true,
        opacity: 0.3 * AMBIENT_HAZE,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
      })
    );
    beamSource.position.set(0, 102, 0);
    beamSource.scale.set(34, 34, 1);
    beamSource.renderOrder = -1;
    scene.add(beamSource);

    // ── 地面二十四节气环 ──
    const ringR = crownR * 1.2;
    clockRingRadius = ringR;
    const ring = new THREE.Group();
    ring.position.set(0, groundY, 0);
    solarRing = ring;
    solarLoopMats = [];
    // 节气文字尺寸：当前版本的 1/3
    const labelW = ringR * 0.08;
    const labelH = labelW * (100 / 160);
    const labelR = ringR + labelW * 0.55 + 0.8;
    const tickOuterR = labelR - labelW * 0.25;
    const tickPos = [];
    const tickCol = [];
    const curTerm = currentSolarTermIndex();
    solarTickSegs = [];
    for (let i = 0; i < 24; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 24;
      const major = i % 6 === 0;
      const inner = ringR - (major ? 8 : 4);
      const ix = Math.cos(a) * inner;
      const iz = Math.sin(a) * inner;
      const ox = Math.cos(a) * tickOuterR;
      const oz = Math.sin(a) * tickOuterR;
      // 初始两端重合在环内，随指针经过再向外伸长
      tickPos.push(ix, 0, iz, ix, 0, iz);
      solarTickSegs.push({ ix, iz, ox, oz });
      const active = i === curTerm;
      const c = active
        ? [1.0, 0.86, 0.42]
        : major
          ? [0.72, 0.56, 0.16]
          : [0.18, 0.5, 0.3];
      tickCol.push(c[0], c[1], c[2], c[0], c[1], c[2]);
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(tickPos, 3)
    );
    tickGeo.setAttribute("color", new THREE.Float32BufferAttribute(tickCol, 3));
    const tickMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ticks = new THREE.LineSegments(tickGeo, tickMat);
    ticks.renderOrder = -1;
    ring.add(ticks);
    solarTicks = ticks;
    solarTickAttr = tickGeo.attributes.position;

    for (const [rr, alpha] of [
      [ringR, 0.16],
      [ringR * 0.86, 0.09],
    ]) {
      const pts = [];
      const SEG = 128;
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr));
      }
      const lg = new THREE.BufferGeometry().setFromPoints(pts);
      const lm = new THREE.LineBasicMaterial({
        color: 0x2f7a52,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const loop = new THREE.Line(lg, lm);
      loop.renderOrder = -1;
      ring.add(loop);
      solarLoopMats.push({ mat: lm, alpha });
    }

    const ca = -Math.PI / 2 + (curTerm * Math.PI * 2) / 24;
    solarGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffd77a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
      })
    );
    solarGlow.position.set(Math.cos(ca) * ringR, 1.5, Math.sin(ca) * ringR);
    solarGlow.scale.set(20, 20, 1);
    solarGlow.renderOrder = 2;
    ring.add(solarGlow);

    // ── 节气指针：从环心扫向端点，扫过之处刻线与文字生长 ──
    solarPointerLen = labelR + 2.2;
    solarPointerMat = new THREE.MeshBasicMaterial({
      map: makePointerTexture(),
      color: 0xffdf9e,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const pointerGeo = new THREE.PlaneGeometry(1, 1);
    pointerGeo.translate(0.5, 0, 0);
    const pointerMesh = new THREE.Mesh(pointerGeo, solarPointerMat);
    pointerMesh.rotation.x = -Math.PI / 2;
    pointerMesh.scale.set(solarPointerLen, 0.9, 1);
    pointerMesh.renderOrder = 2;
    solarPointerPivot = new THREE.Group();
    solarPointerPivot.position.y = 0.4;
    solarPointerPivot.add(pointerMesh);
    ring.add(solarPointerPivot);

    solarPointerTip = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffe6b0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
      })
    );
    solarPointerTip.scale.set(7, 7, 1);
    solarPointerTip.renderOrder = 3;
    ring.add(solarPointerTip);

    // ── 二十四节气端点：淡金文字 + 微光，整圈缓慢闪烁 ──
    solarTermIdx = curTerm;
    solarLabels = [];
    solarGlints = [];
    for (let i = 0; i < 24; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 24;
      const active = i === curTerm;
      const tex = makeTermLabelTexture(SOLAR_TERMS[i].name, active);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(Math.cos(a) * labelR, 1.8, Math.sin(a) * labelR);
      sp.scale.set(labelW, labelH, 1);
      sp.renderOrder = 2;
      sp.userData.baseW = labelW;
      sp.userData.baseH = labelH;
      sp.userData.baseOpacity = active ? 0.82 : 0.4;
      sp.userData.phase = i * 0.61;
      sp.userData.active = active;
      ring.add(sp);
      solarLabels.push(sp);

      const glint = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xffdf9e,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          fog: false,
        })
      );
      glint.position.set(Math.cos(a) * ringR, 0.6, Math.sin(a) * ringR);
      glint.scale.set(active ? 4.2 : 2.8, active ? 4.2 : 2.8, 1);
      glint.renderOrder = 2;
      glint.userData.phase = i * 0.83;
      glint.userData.active = active;
      ring.add(glint);
      solarGlints.push(glint);
    }

    // ── 闲置钟表指针（平时隐藏） ──
    clockHandsGroup = new THREE.Group();
    clockHandsGroup.visible = false;
    clockHandMats = [];
    function makeClockHand(width, length, color, baseOpacity) {
      const hg = new THREE.PlaneGeometry(width, 1);
      hg.translate(0, 0.5, 0);
      hg.rotateX(-Math.PI / 2);
      const hm = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const pivot = new THREE.Group();
      const mesh = new THREE.Mesh(hg, hm);
      mesh.scale.z = length;
      pivot.add(mesh);
      clockHandsGroup.add(pivot);
      clockHandMats.push({ mat: hm, base: baseOpacity });
      return pivot;
    }
    clockHandsGroup.userData.hour = makeClockHand(
      0.8,
      ringR * 0.5,
      0xffd88a,
      0.9
    );
    clockHandsGroup.userData.minute = makeClockHand(
      0.42,
      ringR * 0.76,
      0xa9e8b8,
      0.8
    );
    clockHandsGroup.userData.second = makeClockHand(
      0.14,
      ringR * 0.86,
      0xfff2c8,
      0.6
    );
    ring.add(clockHandsGroup);

    clockHub = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffe3a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
      })
    );
    clockHub.position.set(0, 0.5, 0);
    clockHub.scale.set(6, 6, 1);
    clockHub.renderOrder = 3;
    ring.add(clockHub);

    // 校徽仅作为像素遮罩：星点按 alpha/亮度对比采样，原图不进入画面
    clockEmblemMask = null;
    const emblemImg = new Image();
    emblemImg.onload = () => {
      try {
        const S = 192;
        const cv = document.createElement("canvas");
        cv.width = cv.height = S;
        const cx = cv.getContext("2d");
        cx.drawImage(emblemImg, 0, 0, S, S);
        const d = cx.getImageData(0, 0, S, S).data;
        const idx = [];
        const cum = [];
        let total = 0;
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const o = (y * S + x) * 4;
            const a = d[o + 3] / 255;
            if (a < 0.06) continue;
            const lum =
              (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
            // 对比度曲线：透明边缘弱化，亮部/主线加权
            const w = Math.pow(a, 1.65) * (0.22 + 0.78 * lum);
            if (w <= 0) continue;
            total += w;
            idx.push(y * S + x);
            cum.push(total);
          }
        }
        if (total > 0) {
          clockEmblemMask = {
            S,
            idx: Int32Array.from(idx),
            cum: Float32Array.from(cum),
            total,
          };
          // 之前若以兜底纹样生成过，作废重算
          clockPattern = null;
        }
      } catch (_) {}
    };
    emblemImg.src = "assets/hzau-emblem.png";
    scene.add(ring);

    // ── 选中光环 ──
    selAura = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: ringTex,
        color: 0xffe3a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
      })
    );
    selAura.visible = false;
    selAura.renderOrder = 3;
    scene.add(selAura);

    // 选中时向外扩散的涟漪，让“揭示”更有仪式感
    selRipple = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: ringTex,
        color: 0xfff0c8,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
      })
    );
    selRipple.visible = false;
    selRipple.renderOrder = 4;
    scene.add(selRipple);

    // ── 苯环光点：几十颗绿色星点组成等大小的苯环 ──
    const LEAF_COUNT = 24;
    const LEAF_POINTS = 48;
    const total = LEAF_COUNT * LEAF_POINTS;
    const lpos = new Float32Array(total * 3);
    const lsize = new Float32Array(total);
    const lcol = new Float32Array(total * 3);
    const lseed = new Float32Array(total);
    leafBaseSizes = new Float32Array(total);
    leafTemplate = [];
    const greens = [
      [0.5, 1.0, 0.62],
      [0.62, 1.0, 0.72],
      [0.4, 0.9, 0.52],
    ];
    for (let i = 0; i < total; i++) {
      lpos[i * 3 + 1] = -999;
      lsize[i] = 0;
      lseed[i] = rnd();
      const c = greens[i % greens.length];
      lcol[i * 3] = c[0];
      lcol[i * 3 + 1] = c[1];
      lcol[i * 3 + 2] = c[2];
      const outline = i % LEAF_POINTS < 36;
      // 苯环整体尺寸提升到 1.5×（点径同步放大，保持轮廓疏密）
      leafBaseSizes[i] = (outline ? 1.3 + rnd() * 0.8 : 0.9 + rnd() * 0.5) * 1.5;
    }
    // 苯环模板：六边形轮廓 36 点 + 内部芳香圆 12 点
    const RING_R = 0.5;
    for (let i = 0; i < LEAF_POINTS; i++) {
      if (i < 36) {
        const edge = Math.floor(i / 6);
        const k = i % 6;
        const a0 = (edge * Math.PI) / 3;
        const a1 = ((edge + 1) * Math.PI) / 3;
        const u = k / 6;
        leafTemplate.push({
          x: RING_R * (Math.cos(a0) * (1 - u) + Math.cos(a1) * u),
          y: RING_R * (Math.sin(a0) * (1 - u) + Math.sin(a1) * u),
        });
      } else {
        const a = ((i - 36) / 12) * Math.PI * 2;
        leafTemplate.push({
          x: Math.cos(a) * RING_R * 0.46,
          y: Math.sin(a) * RING_R * 0.46,
        });
      }
    }
    for (let i = 0; i < LEAF_COUNT; i++) {
      leaves.push({
        base: i * LEAF_POINTS,
        visible: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        phase: 0,
        rot: 0,
        rotSpeed: 0,
        flipPhase: rnd() * Math.PI * 2,
        size: 1,
        emerge: 0,
      });
    }
    leafGeo = new THREE.BufferGeometry();
    leafPos = new THREE.BufferAttribute(lpos, 3);
    leafSizes = new THREE.BufferAttribute(lsize, 1);
    leafGeo.setAttribute("position", leafPos);
    leafGeo.setAttribute("aSize", leafSizes);
    leafGeo.setAttribute("aColor", new THREE.BufferAttribute(lcol, 3));
    leafGeo.setAttribute("aSeed", new THREE.BufferAttribute(lseed, 1));
    leafMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: dpr },
      },
      vertexShader: LEAF_VERT,
      fragmentShader: LEAF_FRAG,
    });
    const leafPoints = new THREE.Points(leafGeo, leafMat);
    leafPoints.frustumCulled = false;
    leafPoints.renderOrder = 2;
    scene.add(leafPoints);
    leafObj = leafPoints;

    // 从树冠已有的星点中选出生位置，避免出现在空处
    leafSpawnPts = [];
    for (let i = 0; i < productStars.length; i++) {
      const s = productStars[i];
      if (s.layer === "canopy") leafSpawnPts.push(s.pos);
    }
    if (!leafSpawnPts.length) {
      for (let i = 0; i < 64; i++) {
        const a = rnd() * Math.PI * 2;
        const r = g.R * scale * (0.2 + 0.8 * Math.sqrt(rnd()));
        leafSpawnPts.push({
          x: Math.cos(a) * r,
          y: (g.CY + (rnd() * 2 - 1) * g.half * 0.8) * scale,
          z: Math.sin(a) * r,
        });
      }
    }

    // ── 土壤长链烷烃：像蚯蚓一样随机钻出、翻动、消失 ──
    const wormN = weak ? 6 : WORM_COUNT;
    const wtotal = wormN * WORM_POINTS;
    const wpos = new Float32Array(wtotal * 3);
    const wsz = new Float32Array(wtotal);
    const wcol = new Float32Array(wtotal * 3);
    const wseed = new Float32Array(wtotal);
    wormBaseSizes = new Float32Array(wtotal);
    // 亮度压到 1/3，尽可能不抢树体星点的注意力
    const wormCols = [
      [0.33, 0.25, 0.13],
      [0.32, 0.21, 0.1],
      [0.29, 0.19, 0.08],
    ];
    for (let i = 0; i < wtotal; i++) {
      wpos[i * 3 + 1] = -999;
      wsz[i] = 0;
      wseed[i] = rnd();
      const c = wormCols[i % wormCols.length];
      wcol[i * 3] = c[0];
      wcol[i * 3 + 1] = c[1];
      wcol[i * 3 + 2] = c[2];
      wormBaseSizes[i] = 1.3 + rnd() * 0.6;
    }
    wormGeo = new THREE.BufferGeometry();
    wormPos = new THREE.BufferAttribute(wpos, 3);
    wormSizes = new THREE.BufferAttribute(wsz, 1);
    wormGeo.setAttribute("position", wormPos);
    wormGeo.setAttribute("aSize", wormSizes);
    wormGeo.setAttribute("aColor", new THREE.BufferAttribute(wcol, 3));
    wormGeo.setAttribute("aSeed", new THREE.BufferAttribute(wseed, 1));
    wormMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: dpr },
      },
      vertexShader: LEAF_VERT,
      fragmentShader: LEAF_FRAG,
    });
    const wormPoints = new THREE.Points(wormGeo, wormMat);
    wormPoints.frustumCulled = false;
    wormPoints.renderOrder = 1;
    scene.add(wormPoints);
    wormObj = wormPoints;
    worms = [];
    for (let i = 0; i < wormN; i++) {
      worms.push({
        base: i * WORM_POINTS,
        active: false,
        wait: 0.6 + rnd() * 9,
        template: null,
        poolIdx: -1,
        molName: "",
        x: 0,
        y: -999,
        z: 0,
        yaw: 0,
        pitch: 0,
        roll: 0,
        rollSpeed: 0,
        heading: 0,
        speed: 0,
        wob: 0,
        wobPhase: 0,
        life: 0,
        maxLife: 1,
      });
    }

    // 分子库异步加载；加载完成后才允许土壤链出现
    alkanePool = [];
    fetch("data/curated/soil-alkanes.json", { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.items)) alkanePool = d.items;
      })
      .catch(() => {});
  }

  function spawnLeaf(leaf) {
    if (!built || !leafSpawnPts.length) return;
    // 从树冠已有的星点位置浮现
    const p = leafSpawnPts[(Math.random() * leafSpawnPts.length) | 0];
    leaf.x = p.x + (Math.random() - 0.5) * 0.4;
    leaf.y = p.y + (Math.random() - 0.5) * 0.4;
    leaf.z = p.z + (Math.random() - 0.5) * 0.4;
    leaf.vx = (Math.random() - 0.5) * 0.7;
    leaf.vz = (Math.random() - 0.5) * 0.7;
    leaf.vy = -(1.4 + Math.random() * 1.0);
    leaf.life = 0;
    leaf.maxLife = 10 + Math.random() * 7;
    leaf.phase = Math.random() * Math.PI * 2;
    leaf.rot = Math.random() * Math.PI * 2;
    leaf.rotSpeed = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.4);
    leaf.flipPhase = Math.random() * Math.PI * 2;
    leaf.size = 1.875; // 所有苯环等大小（1.25 的 1.5×）
    leaf.emerge = 0;
    leaf.visible = true;
  }

  function updateLeaves(dt, t) {
    if (!leaves.length || !leafPos || !leafSizes) return;
    // 钟表态不保留树，也不保留飘落的苯环
    if (clockAmount > 0.01) {
      for (const l of leaves) {
        for (let j = 0; j < leafTemplate.length; j++) {
          leafSizes.setX(l.base + j, 0);
        }
      }
      leafSizes.needsUpdate = true;
      return;
    }
    leafNext -= dt;
    if (leafNext <= 0) {
      leafNext = 0.7 + Math.random() * 1.4;
      const free = leaves.find((l) => !l.visible);
      if (free) spawnLeaf(free);
    }
    const groundY = -0.52 * WORLD_SCALE * TREE_VOLUME;
    const n = leafTemplate.length;
    camera.updateMatrixWorld();
    camera.matrixWorld.extractBasis(_leafR, _leafU, _leafF);
    for (const l of leaves) {
      const base = l.base;
      if (!l.visible) {
        for (let j = 0; j < n; j++) leafSizes.setX(base + j, 0);
        continue;
      }
      l.life += dt;
      const u = l.life / l.maxLife;
      if (u >= 1 || l.y < groundY) {
        l.visible = false;
        for (let j = 0; j < n; j++) leafSizes.setX(base + j, 0);
        continue;
      }
      l.emerge = Math.min(1, l.life / 0.9);
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      l.z += l.vz * dt;
      l.rot += l.rotSpeed * dt;
      const cosZ = Math.cos(l.rot);
      const sinZ = Math.sin(l.rot);
      const flip = 0.35 + 0.65 * Math.abs(Math.cos(t * 1.7 + l.flipPhase));
      const fadeIn = Math.min(1, u * 8);
      const fadeOut = Math.min(1, (1 - u) * 3);
      const fade = Math.min(fadeIn, fadeOut);
      const scale = l.size * l.emerge * fade;
      for (let j = 0; j < n; j++) {
        const tp = leafTemplate[j];
        const rx = tp.x * cosZ - tp.y * sinZ;
        const ry = tp.x * sinZ + tp.y * cosZ;
        const fx = rx * flip * scale;
        const fy = ry * scale;
        const depth = tp.x * scale * 0.04;
        const idx = base + j;
        leafPos.setXYZ(
          idx,
          l.x + _leafR.x * fx + _leafU.x * fy + _leafF.x * depth,
          l.y + _leafR.y * fx + _leafU.y * fy + _leafF.y * depth,
          l.z + _leafR.z * fx + _leafU.z * fy + _leafF.z * depth
        );
        leafSizes.setX(idx, leafBaseSizes[idx] * l.emerge * fade);
      }
    }
    leafPos.needsUpdate = true;
    leafSizes.needsUpdate = true;
  }

  /**
   * 把库中分子的 RDKit 2D 碳骨架转成光点模板。
   * 沿所有键按长度均匀取点，因此支链也会保留。
   */
  function makeWormTemplate(mol) {
    const atoms = mol && mol.a;
    const bonds = mol && mol.b;
    if (!Array.isArray(atoms) || !atoms.length || !bonds || !bonds.length) {
      return [];
    }
    let cx = 0;
    let cy = 0;
    for (const a of atoms) {
      cx += a[0];
      cy += a[1];
    }
    cx /= atoms.length;
    cy /= atoms.length;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const a of atoms) {
      minX = Math.min(minX, a[0]);
      maxX = Math.max(maxX, a[0]);
      minY = Math.min(minY, a[1]);
      maxY = Math.max(maxY, a[1]);
    }
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    // 尺寸保持很克制：整条链约 1.6–3.6 个世界单位
    const target = 1.6 + Math.random() * 2.0;
    const k = target / span;
    const flipX = Math.random() < 0.5 ? -1 : 1;
    const flipY = Math.random() < 0.5 ? -1 : 1;
    const thick = target * 0.012 + 0.004;

    const segs = [];
    let total = 0;
    for (const b of bonds) {
      const a0 = atoms[b[0]];
      const a1 = atoms[b[1]];
      if (!a0 || !a1) continue;
      const ax = a0[0] - cx;
      const ay = a0[1] - cy;
      const dx = a1[0] - a0[0];
      const dy = a1[1] - a0[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      segs.push({ ax, ay, dx, dy, len, start: total });
      total += len;
    }
    if (!total) return [];

    const tmpl = [];
    for (let j = 0; j < WORM_POINTS; j++) {
      const targetLen = (j / (WORM_POINTS - 1)) * total;
      let seg = segs[segs.length - 1];
      for (const s of segs) {
        if (targetLen <= s.start + s.len) {
          seg = s;
          break;
        }
      }
      const t = seg.len ? Math.max(0, Math.min(1, (targetLen - seg.start) / seg.len)) : 0;
      const rawX = seg.ax + seg.dx * t;
      const rawY = seg.ay + seg.dy * t;
      const u = (rawX - (minX - cx)) / (maxX - minX || 1);
      const ang = Math.random() * Math.PI * 2;
      const rad = thick * Math.sqrt(Math.random());
      tmpl.push({
        x: rawX * k * flipX,
        y: rawY * k * flipY,
        z: Math.cos(ang) * rad,
        oy: Math.sin(ang) * rad,
        u: Math.max(0, Math.min(1, u)),
      });
    }
    return tmpl;
  }

  function spawnWorm(w) {
    if (!built || !alkanePool.length) return false;
    // 同一时刻不重复抽到同一条分子
    const used = new Set();
    for (const o of worms) {
      if (o !== w && o.active && o.poolIdx >= 0) used.add(o.poolIdx);
    }
    const free = [];
    for (let i = 0; i < alkanePool.length; i++) {
      if (!used.has(i)) free.push(i);
    }
    if (!free.length) return false;
    const idx = free[(Math.random() * free.length) | 0];
    const mol = alkanePool[idx];
    const tmpl = makeWormTemplate(mol);
    if (!tmpl.length) return false;

    w.template = tmpl;
    w.poolIdx = idx;
    w.molName = mol.n || "";
    const scale = WORLD_SCALE * TREE_VOLUME;
    const g = built.crown;
    const crownR = g.R * scale;
    const groundY = -0.52 * scale;
    const ang = Math.random() * Math.PI * 2;
    const rad = crownR * (0.14 + 0.74 * Math.sqrt(Math.random()));
    w.x = Math.cos(ang) * rad;
    w.z = Math.sin(ang) * rad;
    w.y = groundY - 0.5 - Math.random() * 2.8;
    w.yaw = Math.random() * Math.PI * 2;
    w.pitch = (Math.random() - 0.5) * 0.5;
    w.roll = Math.random() * Math.PI * 2;
    w.rollSpeed = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5);
    w.heading = Math.random() * Math.PI * 2;
    w.speed = (0.22 + Math.random() * 0.5) * 0.2;
    w.wob = (0.25 + Math.random() * 0.4) * 0.2;
    w.wobPhase = Math.random() * Math.PI * 2;
    w.life = 0;
    w.maxLife = 9 + Math.random() * 10;
    w.active = true;
    return true;
  }

  function updateWorms(dt, t) {
    if (!worms.length || !wormPos || !wormSizes) return;
    // 等树长到中段，土壤里的分子才慢慢出现；钟表态全部收起
    if (clockAmount > 0.01 || (!introDone && introReveal < 0.55)) {
      for (const w of worms) {
        for (let j = 0; j < WORM_POINTS; j++) wormSizes.setX(w.base + j, 0);
      }
      return;
    }
    for (const w of worms) {
      const base = w.base;
      if (!w.active) {
        w.wait -= dt;
        if (w.wait > 0 || !spawnWorm(w)) {
          if (w.wait <= 0) w.wait = 0.8; // 分子库还没加载好，稍后再抽
          for (let j = 0; j < WORM_POINTS; j++) wormSizes.setX(base + j, 0);
          continue;
        }
      }
      w.life += dt;
      if (w.life >= w.maxLife) {
        w.active = false;
        w.wait = 4 + Math.random() * 9;
        w.poolIdx = -1;
        w.molName = "";
        for (let j = 0; j < WORM_POINTS; j++) wormSizes.setX(base + j, 0);
        continue;
      }
      // 缓慢蠕动 + 沿地面爬行 + 绕长轴翻动
      w.roll += w.rollSpeed * dt;
      w.heading += Math.sin(t * 0.25 + w.wobPhase) * 0.1 * dt;
      w.x += Math.cos(w.heading) * w.speed * dt;
      w.z += Math.sin(w.heading) * w.speed * dt;
      const yaw = w.yaw;
      const pitch = w.pitch + Math.sin(t * 0.33 + w.wobPhase) * 0.22;
      const roll = w.roll;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const m00 = cy * cr + sy * sp * sr;
      const m01 = -cy * sr + sy * sp * cr;
      const m02 = sy * cp;
      const m10 = cp * sr;
      const m11 = cp * cr;
      const m12 = -sp;
      const m20 = -sy * cr + cy * sp * sr;
      const m21 = sy * sr + cy * sp * cr;
      const m22 = cy * cp;
      const fadeIn = Math.min(1, w.life / 0.9);
      const fadeOut = Math.min(1, (w.maxLife - w.life) / 1.8);
      const fade = Math.max(0, Math.min(fadeIn, fadeOut));
      const tmpl = w.template || [];
      for (let j = 0; j < WORM_POINTS; j++) {
        const tp = tmpl[j];
        if (!tp) {
          wormSizes.setX(base + j, 0);
          continue;
        }
        const env = Math.sin(Math.PI * tp.u);
        const wave =
          Math.sin(tp.u * Math.PI * 6 - t * 3.4 + w.wobPhase) *
          w.wob *
          env;
        const lx = tp.x;
        const ly = tp.y + tp.oy + wave * 0.55;
        const lz =
          tp.z +
          Math.cos(tp.u * Math.PI * 5 + t * 2.7 + w.wobPhase) *
            w.wob *
            0.42 *
            env;
        const idx = base + j;
        wormPos.setXYZ(
          idx,
          w.x + m00 * lx + m01 * ly + m02 * lz,
          w.y + m10 * lx + m11 * ly + m12 * lz,
          w.z + m20 * lx + m21 * ly + m22 * lz
        );
        wormSizes.setX(idx, wormBaseSizes[idx] * fade);
      }
    }
    wormPos.needsUpdate = true;
    wormSizes.needsUpdate = true;
  }

  /** 生成钟表表盘的目标点（局部 XZ 平面，与节气环同平面） */
  function ensureClockPattern(n) {
    if (clockPattern && clockPattern.n === n) return clockPattern;
    const rnd = mulberry32(20261020);
    const R = clockRingRadius || 52;
    const target = new Float32Array(n * 3);
    const arc = new Float32Array(n * 3);
    const delay = new Float32Array(n);
    const TAU = Math.PI * 2;
    let idx = 0;
    const put = (th, r) => {
      if (idx >= n) return;
      target[idx * 3] = Math.sin(th) * r;
      target[idx * 3 + 1] = 0;
      target[idx * 3 + 2] = -Math.cos(th) * r;
      idx++;
    };
    if (clockEmblemMask) {
      // 用校徽 alpha/亮度做对比采样：星点按明暗密度组成校徽
      const m = clockEmblemMask;
      const size = R * 1.68;
      const inv = size / m.S;
      const sample = () => {
        const r = rnd() * m.total;
        let lo = 0;
        let hi = m.cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (m.cum[mid] < r) lo = mid + 1;
          else hi = mid;
        }
        return m.idx[lo];
      };
      const emblemCount = Math.floor(n * 0.82);
      for (let i = 0; i < emblemCount && idx < n; i++) {
        const p = sample();
        const px = p % m.S;
        const py = (p / m.S) | 0;
        target[idx * 3] =
          (px + 0.5 - m.S / 2) * inv + (rnd() - 0.5) * inv * 0.9;
        target[idx * 3 + 1] = 0;
        target[idx * 3 + 2] =
          (py + 0.5 - m.S / 2) * inv + (rnd() - 0.5) * inv * 0.9;
        idx++;
      }
      // 外圈分钟刻线
      const tickBudget = Math.min(n - idx, 9000);
      const tickEnd = idx + tickBudget;
      for (let mi = 0; mi < 60 && idx < tickEnd; mi++) {
        for (let k = 0; k < 150 && idx < tickEnd; k++) {
          const th = (mi / 60) * TAU + (rnd() - 0.5) * 0.003;
          const rr =
            R * (0.79 + 0.13 * (k / 149)) + (rnd() - 0.5) * R * 0.006;
          put(th, rr);
        }
      }
      // 外侧星晕
      while (idx < n) {
        put(rnd() * TAU, R * (0.99 + 0.32 * Math.sqrt(rnd())));
      }
    } else {
      // 校徽遮罩未就绪时退回原来的表盘纹样
      const tickN = Math.min(n, 60 * 180);
      for (let m = 0; m < 60 && idx < tickN; m++) {
        for (let k = 0; k < 180 && idx < tickN; k++) {
          const th = (m / 60) * TAU + (rnd() - 0.5) * 0.003;
          const rr =
            R * (0.765 + 0.125 * (k / 179)) + (rnd() - 0.5) * R * 0.006;
          put(th, rr);
        }
      }
      const ringRadii = [0.22, 0.34, 0.46, 0.58, 0.7, 0.8];
      const ringBudget = Math.min(n - idx, 36000);
      for (let rr = 0; rr < ringRadii.length; rr++) {
        const ringR0 = R * ringRadii[rr];
        const per = Math.floor(ringBudget / ringRadii.length);
        for (let k = 0; k < per && idx < n; k++) {
          const th = rnd() * TAU;
          put(th, ringR0 + (rnd() - 0.5) * R * 0.012);
        }
      }
      while (idx < n) {
        put(rnd() * TAU, R * (1.02 + 0.3 * Math.sqrt(rnd())));
      }
    }
    // 成群的弧线：同组共享方向，看起来像鸟群分批掠过
    for (let i = 0; i < n; i++) {
      const group = Math.floor(i / 3000);
      delay[i] = (group % 18) / 18 * 0.18 + rnd() * 0.015;
      const ga = (group % 7) * (TAU / 7);
      const amp = R * (0.12 + 0.07 * (group % 4));
      arc[i * 3] = Math.sin(ga) * amp;
      arc[i * 3 + 2] = -Math.cos(ga) * amp;
    }
    clockPattern = { n, target, arc, delay };
    return clockPattern;
  }

  function prepareClock() {
    if (!solarRing || !productStars.length) return;
    const center = new THREE.Vector3(cam.fx, cam.fy, cam.fz);
    const n = new THREE.Vector3().subVectors(camera.position, center).normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(n.dot(up)) > 0.985) up.set(0, 0, -1);
    const zAxis = up
      .clone()
      .sub(n.clone().multiplyScalar(up.dot(n)))
      .normalize()
      .multiplyScalar(-1);
    const xAxis = new THREE.Vector3().crossVectors(n, zAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, n, zAxis);
    clockFinalQuat.setFromRotationMatrix(basis);
    clockFinalPos.copy(center);
    clockBasePos.copy(solarRing.position);
    clockBaseQuat.copy(solarRing.quaternion);

    const pattern = ensureClockPattern(productStars.length);
    const mat4 = new THREE.Matrix4().compose(
      clockFinalPos,
      clockFinalQuat,
      new THREE.Vector3(1, 1, 1)
    );
    const v = new THREE.Vector3();
    const fill = (layer, idxList) => {
      if (!layer) return;
      const g = layer.geometry;
      const at = g.attributes.aClockTarget;
      const aa = g.attributes.aClockArc;
      const ad = g.attributes.aClockDelay;
      if (!at || !aa || !ad) return;
      const ta = at.array;
      const aaArr = aa.array;
      const da = ad.array;
      const cnt = idxList.length;
      for (let k = 0; k < cnt; k++) {
        const gi = idxList[k];
        v.set(
          pattern.target[gi * 3],
          pattern.target[gi * 3 + 1],
          pattern.target[gi * 3 + 2]
        ).applyMatrix4(mat4);
        ta[k * 3] = v.x;
        ta[k * 3 + 1] = v.y;
        ta[k * 3 + 2] = v.z;
        v.set(
          pattern.arc[gi * 3],
          pattern.arc[gi * 3 + 1],
          pattern.arc[gi * 3 + 2]
        ).applyQuaternion(clockFinalQuat);
        aaArr[k * 3] = v.x;
        aaArr[k * 3 + 1] = v.y;
        aaArr[k * 3 + 2] = v.z;
        da[k] = pattern.delay[gi];
      }
      at.needsUpdate = true;
      aa.needsUpdate = true;
      ad.needsUpdate = true;
    };
    fill(trunkPts, splitTrunkIdx);
    fill(otherPts, splitOtherIdx);

    clockSavedAuto = cam.auto;
    cam.auto = false;
    vel.yaw = 0;
    vel.pitch = 0;
    clockWanted = 1;
    clockPrepared = true;
    if (clockHandsGroup) clockHandsGroup.visible = true;
    if (clockHub) clockHub.visible = true;
  }

  function updateClock(dt, t) {
    // 平滑进入/退出；shader 内再按点做分批延迟
    const k = 1 - Math.exp(-dt * 0.6);
    clockAmount += (clockWanted - clockAmount) * k;
    if (clockWanted > 0 && clockAmount > 0.998) clockAmount = 1;
    if (clockWanted === 0 && clockAmount < 0.002) clockAmount = 0;

    if (clockWanted) cam.auto = false;
    const e = clockAmount;
    const ee = e * e * (3 - 2 * e);

    if (solarRing && clockPrepared) {
      solarRing.position.lerpVectors(clockBasePos, clockFinalPos, ee);
      solarRing.quaternion.slerpQuaternions(
        clockBaseQuat,
        clockFinalQuat,
        ee
      );
    }

    // 树点：uClock 驱动飞行；其余树体层淡出
    for (const layer of [trunkPts, otherPts]) {
      if (!layer) continue;
      const u = layer.material.uniforms;
      if (u.uClock) u.uClock.value = e;
      if (u.uDim) u.uDim.value = 1 - 0.05 * e;
    }
    for (const layer of [structPts, flowPts, evPts]) {
      if (!layer) continue;
      const u = layer.material.uniforms;
      if (u.uDim) u.uDim.value = 1 - e;
    }

    // 指针 / 手势
    if (clockHandsGroup) {
      const now = new Date();
      const sec = now.getSeconds() + now.getMilliseconds() / 1000;
      const min = now.getMinutes() + sec / 60;
      const hour = (now.getHours() % 24) + min / 60;
      clockHandsGroup.userData.hour.rotation.y = -(hour / 24) * Math.PI * 2;
      clockHandsGroup.userData.minute.rotation.y =
        -(min / 60) * Math.PI * 2;
      clockHandsGroup.userData.second.rotation.y =
        -(sec / 60) * Math.PI * 2;
      clockHandsGroup.visible = e > 0.002;
      for (const h of clockHandMats) h.mat.opacity = h.base * e;
    }
    if (clockHub) {
      clockHub.visible = e > 0.002;
      clockHub.material.opacity = 0.85 * e;
      const hs = 5 + 1.2 * Math.sin(t * 2.1);
      clockHub.scale.set(hs, hs, 1);
    }
    // 钟表态不保留苯环落叶与土壤长链分子，也不保留悬停分子提示
    if (leafObj) leafObj.visible = e < 0.02;
    if (wormObj) wormObj.visible = e < 0.02;
    if (e > 0.02) hideTip();

    // 退出完成：彻底回到地面环
    if (clockWanted === 0 && clockAmount === 0 && clockPrepared) {
      clockPrepared = false;
      cam.auto = clockSavedAuto;
      if (clockHandsGroup) clockHandsGroup.visible = false;
      if (clockHub) clockHub.visible = false;
      for (const h of clockHandMats) h.mat.opacity = 0;
      if (solarRing) {
        solarRing.position.copy(clockBasePos);
        solarRing.quaternion.copy(clockBaseQuat);
      }
      for (const layer of [trunkPts, otherPts]) {
        if (!layer) continue;
        const u = layer.material.uniforms;
        if (u.uClock) u.uClock.value = 0;
        if (u.uDim) u.uDim.value = 1;
      }
    }
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

  /** 起止加速度为 0 的五次缓动，长距离相机飞行更稳 */
  function smootherStep(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** 飞到指定注视点/距离/俯仰（视角预设） */
  function flyToView(tx, ty, tz, dist, pitch) {
    exitFP();
    fly.active = true;
    fly.t = 0;
    fly.camStart = camera.position.clone();
    fly.lookStart = _look.clone();
    fly.from = {
      yaw: cam.yaw,
      pitch: cam.pitch,
      dist: cam.dist,
      fx: cam.fx,
      fy: cam.fy,
      fz: cam.fz,
    };
    fly.to = {
      yaw: cam.yaw,
      pitch,
      dist,
      fx: tx,
      fy: ty,
      fz: tz,
    };
    cam.auto = false;
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
    fly.camStart = camera.position.clone();
    fly.lookStart = _look.clone();
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
  // 叶片始终面向相机，保证“几十个点组成的叶形”可读
  const _leafR = new THREE.Vector3();
  const _leafU = new THREE.Vector3();
  const _leafF = new THREE.Vector3();

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

  /** 当前筛选：类群 / 层位 / 化学分类 / 科 */
  function matchFilters(s, f) {
    if (f.kingdom && f.kingdom !== "全部" && s.kingdom !== f.kingdom)
      return false;
    if (f.layer && s.layer !== f.layer) return false;
    if (f.classIdx != null && s._classIdx !== f.classIdx) return false;
    if (f.familyIdx != null && s._familyIdx !== f.familyIdx) return false;
    return true;
  }

  function starMatchesFilters(s) {
    return matchFilters(s, getState());
  }

  function pickStar(mx, my) {
    let best = null;
    let bd = Infinity;
    const filters = getState();
    const { selectedId } = filters;
    const hasSel = !!selectedId;
    // 远景只拾取精选星：22 万点全量 project 会卡死主线程
    const near = cam.dist < 14;
    for (let i = 0; i < productStars.length; i++) {
      const s = productStars[i];
      if (!near && s.kind !== "featured") continue;
      if (!matchFilters(s, filters)) continue;
      const q = projectVec(s.pos);
      if (q.z < 0.05 || q.z > 400) continue;
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
  let lastMoveT = 0;

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
    const filters = getState();
    const { selectedId } = filters;

    function apply(handle, idxList) {
      const sizes = handle.geometry.attributes.aSize;
      const glows = handle.geometry.attributes.aGlow;
      const cols = handle.geometry.attributes.aColor;
      for (let k = 0; k < idxList.length; k++) {
        const s = productStars[idxList[k]];
        if (!s) continue;
        const vis = matchFilters(s, filters);
        const sel = selectedId === s.id;
        const base =
          s.kind === "featured" ? 1.2 : s.kind === "lotus" ? 0.55 : 0.48;
        sizes.setX(k, sel ? base * 1.45 : base);
        glows.setX(
          k,
          sel
            ? 1.55
            : vis
              ? s.kind === "featured"
                ? 1.25
                : s.kind === "lotus"
                  ? 0.7
                  : 0.55
              : 0.04
        );
        if (s.layer === "trunk" && vis && !sel) {
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
          (sel ? 1.2 : 1);
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
    const filters = getState();
    const { selectedId } = filters;
    const hasLinks = linkPairs.length > 0;
    // 点击时略放宽，仍以「半线长」为基准
    const linkHit = hasLinks
      ? pickLinkDetailed(mx, my, isClick ? "click" : "hover")
      : null;

    const near = cam.dist < 14;
    let star = null;
    let starD = Infinity;
    for (let i = 0; i < productStars.length; i++) {
      const s = productStars[i];
      if (!near && s.kind !== "featured") continue;
      if (!matchFilters(s, filters)) continue;
      const q = projectVec(s.pos);
      if (q.z < 0.05 || q.z > 400 || q.ndcZ > 0.999) continue;
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
      const k = smootherStep(Math.min(1, fly.t));
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
        cam.yaw += vel.yaw * dt;
        cam.pitch = Math.max(
          -PITCH_LIM,
          Math.min(PITCH_LIM, cam.pitch + vel.pitch * dt)
        );
        const decay = Math.exp(-dt / INERTIA_TAU);
        vel.yaw *= decay;
        vel.pitch *= decay;
        if (Math.abs(vel.yaw) < 1e-3) vel.yaw = 0;
        if (Math.abs(vel.pitch) < 1e-3) vel.pitch = 0;
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
    // 世界树整体呼吸：约 8 秒一轮，只改 shader uniform / 透明度
    const breath = 0.5 + 0.5 * Math.sin(t * ((Math.PI * 2) / 8));
    const pulse = 0.94 + 0.08 * breath;

    for (const o of [structPts, trunkPts, otherPts, flowPts, evPts]) {
      if (!o) continue;
      o.material.uniforms.uTime.value = t;
      o.material.uniforms.uPulse.value = pulse;
    }
    updateLeaves(dt, t);
    updateWorms(dt, t);
    if (leafMat) leafMat.uniforms.uTime.value = t;
    if (wormMat) wormMat.uniforms.uTime.value = t;
    if (starfieldMat) starfieldMat.uniforms.uTime.value = t;
    if (motesMat) {
      motesMat.uniforms.uTime.value = t;
      motesMat.uniforms.uPulse.value = pulse;
    }
    // 飞进星团内部时收掉冠层光环/天光柱，避免整屏蒙上一层绿雾
    const ambFade = Math.min(1, Math.max(0, (cam.dist - 6) / 18));
    if (canopyHalo) {
      canopyHalo.material.opacity =
        (0.1 + 0.07 * breath) *
        ambFade *
        AMBIENT_HAZE *
        (1 - clockAmount);
    }
    if (beamSprite) {
      beamSprite.material.opacity =
        (0.16 + 0.08 * breath) *
        ambFade *
        AMBIENT_HAZE *
        (1 - clockAmount);
    }
    if (beamSource) {
      beamSource.material.opacity =
        (0.22 + 0.12 * breath) *
        ambFade *
        AMBIENT_HAZE *
        (1 - clockAmount);
    }
    // 节气环：指针绕场一周；扫到哪里，刻线就从环内伸向文字
    const ringU = introDone ? 1 : introReveal;
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const sweep = clamp01((ringU - 0.04) / 0.68);
    const pointerA = Math.min(
      clamp01((ringU - 0.02) / 0.05),
      1 - clamp01((ringU - 0.72) / 0.16)
    );
    const pointerAngle = -Math.PI / 2 + sweep * Math.PI * 2;
    if (solarPointerPivot) {
      solarPointerPivot.rotation.y = -pointerAngle;
    }
    if (solarPointerMat) {
      solarPointerMat.opacity = 0.62 * pointerA;
    }
    if (solarPointerTip) {
      solarPointerTip.visible = pointerA > 0.002;
      solarPointerTip.position.set(
        Math.cos(pointerAngle) * solarPointerLen,
        1.7,
        Math.sin(pointerAngle) * solarPointerLen
      );
      const ps = 7 + 1.4 * Math.sin(t * 2.4);
      solarPointerTip.scale.set(ps, ps, 1);
      solarPointerTip.material.opacity = 0.8 * pointerA;
    }
    if (solarTickAttr) {
      for (let i = 0; i < 24; i++) {
        const lineT = clamp01((sweep - i / 24) * 24);
        const seg = solarTickSegs[i];
        const oy = 1.3 * lineT;
        solarTickAttr.setXYZ(i * 2, seg.ix, 0, seg.iz);
        solarTickAttr.setXYZ(
          i * 2 + 1,
          seg.ix + (seg.ox - seg.ix) * lineT,
          oy,
          seg.iz + (seg.oz - seg.iz) * lineT
        );
      }
      solarTickAttr.needsUpdate = true;
    }
    for (const lm of solarLoopMats) {
      lm.mat.opacity =
        lm.alpha *
        clamp01((ringU - 0.72) / 0.14) *
        (1 + clockAmount * 1.4);
    }
    if (solarGlow) {
      const gIn = clamp01((ringU - 0.76) / 0.12);
      solarGlow.material.opacity = (0.4 + 0.2 * breath) * gIn;
      const s = 20 + 6 * breath;
      solarGlow.scale.set(s, s, 1);
    }
    for (let i = 0; i < solarLabels.length; i++) {
      const sp = solarLabels[i];
      const ph = sp.userData.phase;
      const lineT = clamp01((sweep - i / 24) * 24);
      const appear = clamp01((lineT - 0.55) / 0.45);
      const tw = 0.72 + 0.28 * Math.sin(t * 1.15 + ph);
      sp.material.opacity =
        sp.userData.baseOpacity *
        tw *
        appear *
        (1 + clockAmount * 0.65);
      sp.visible = appear > 0.002;
      const clockBoost = 1 + clockAmount * 1.6;
      const k =
        (sp.userData.active ? 1.12 : 1) *
        (1 + 0.03 * Math.sin(t * 1.15 + ph)) *
        (0.72 + 0.28 * appear) *
        clockBoost;
      sp.scale.set(sp.userData.baseW * k, sp.userData.baseH * k, 1);
    }
    for (let i = 0; i < solarGlints.length; i++) {
      const gl = solarGlints[i];
      const lineT = clamp01((sweep - i / 24) * 24);
      const appear = clamp01((lineT - 0.2) / 0.5);
      const tw = 0.5 + 0.5 * Math.sin(t * 1.7 + gl.userData.phase);
      gl.material.opacity =
        (gl.userData.active ? 0.55 : 0.18) * (0.45 + 0.55 * tw) * appear;
      gl.visible = appear > 0.002;
      if (gl.userData.active) {
        const s = 3.8 + 1.2 * tw;
        gl.scale.set(s, s, 1);
      }
    }
    if (selAura && selAura.visible) {
      // 按相机距离缩放，让光环在屏幕上保持恒定大小
      const d = camera.position.distanceTo(selAura.position);
      const k = 1 + 0.08 * Math.sin(t * 2.4);
      const s = selAuraBase * d * k;
      selAura.scale.set(s, s, 1);
      selAura.material.opacity = 0.48 + 0.14 * Math.sin(t * 2.4 + 1.0);
    }
    if (selRipple && selRipple.visible) {
      if (selRippleStart == null) selRippleStart = t;
      const cycle = (((t - selRippleStart) * 0.5) % 1 + 1) % 1;
      const d = camera.position.distanceTo(selRipple.position);
      const s = (0.1 + 0.275 * cycle) * d;
      selRipple.scale.set(s, s, 1);
      selRipple.material.opacity = (1 - cycle) * 0.5;
    }
    if (linkFlow && linkFlow.visible && !linkRelease) {
      linkFlow.material.uniforms.uTime.value = t;
    }
    if (hoverLinkIdx >= 0) updateLinkMagnet(dt);
    else if (linkRelease) updateLinkRelease(dt);
    if (!introPaused) tickIntro(now);
    updateEvents(dt);

    // 闲置 10 秒且未选中：淡出 UI，只留世界树
    const introUI = document.body.classList.contains("ui-intro");
    if (introUI) {
      document.body.classList.remove("idle");
    } else if (lastSel) {
      document.body.classList.remove("idle");
    } else if (performance.now() - lastInteraction > 10000) {
      document.body.classList.add("idle");
    }

    // UI 隐去/生长入场时，把取景平滑移回画面中心
    const idleNow =
      document.body.classList.contains("idle") || introUI;
    viewOffsetTarget = idleNow ? 0 : sideOffset;
    if (Math.abs(viewOffsetTarget - viewOffsetX) > 0.05) {
      viewOffsetX += (viewOffsetTarget - viewOffsetX) * Math.min(1, dt * 3);
      camera.setViewOffset(W, H, viewOffsetX, 0, W, H);
    }

    // 闲置：树点全体飞成二十四节气钟表；任何交互则返回树
    if (
      idleNow &&
      introDone &&
      !introUI &&
      clockWanted === 0 &&
      !clockPrepared
    ) {
      prepareClock();
    }
    if ((!idleNow || introUI) && clockWanted) clockWanted = 0;
    updateClock(dt, t);

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
        ? 0.9
        : dist < 12
          ? 0.95
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
    lastMoveT = performance.now();
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
    const dyaw = -dx * ORBIT_SENS;
    const dpitch = dy * ORBIT_SENS;
    cam.yaw += dyaw;
    cam.pitch = Math.max(
      -PITCH_LIM,
      Math.min(PITCH_LIM, cam.pitch + dpitch)
    );
    // 松手惯性用 rad/s，而不是“最后一次事件增量”。
    // 否则快速拖动会在松手后按帧叠加一个巨大的角度，画面像被甩回原点。
    const nowMs = performance.now();
    const dtMove = Math.max(
      0.008,
      Math.min(0.08, (nowMs - lastMoveT) / 1000 || 0.016)
    );
    lastMoveT = nowMs;
    const MAX_AV = 4.0;
    vel.yaw = Math.max(-MAX_AV, Math.min(MAX_AV, dyaw / dtMove));
    vel.pitch = Math.max(-MAX_AV, Math.min(MAX_AV, dpitch / dtMove));
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
    const { kingdom, layer, classIdx, familyIdx, selectedId } = getState();
    return `${kingdom}|${layer || ""}|${classIdx ?? ""}|${familyIdx ?? ""}|${
      selectedId || ""
    }|${set.bright}|${set.showTrunk}`;
  }

  subscribe(() => {
    const { selectedId } = getState();
    if (selectedId !== lastSel) {
      if (!selectedId) {
        disposeLinkLines();
        if (selAura) selAura.visible = false;
        if (selRipple) selRipple.visible = false;
        selRippleStart = null;
      } else {
        const a = productStars.find((x) => x.id === selectedId);
        if (a) {
          flyTo(a.pos);
          buildSourceLinks(a);
          if (selAura) {
            selAura.visible = true;
            selAura.position.copy(a.pos);
            selAuraBase = a.kind === "featured" ? 0.11 : 0.08;
            const kc = KINGDOM_COLOR[a.kingdom] || KINGDOM_COLOR.植物;
            selAura.material.color.copy(kc).lerp(AURA_WARM, 0.6);
          }
          if (selRipple) {
            selRipple.visible = true;
            selRipple.position.copy(a.pos);
          }
          selRippleStart = null;
        }
      }
      markInteraction();
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
  buildAmbient();
  setKingdomGlow();
  lastGlowKey = glowKey();

  // 左探索栏折叠/展开会改变可显示宽度 → 重新计算取景中心
  const railEl = document.querySelector(".explore-rail");
  if (railEl && typeof ResizeObserver !== "undefined") {
    railObserver = new ResizeObserver(() => {
      sideOffset = computeSideOffset();
      if (!document.body.classList.contains("idle")) {
        viewOffsetTarget = sideOffset;
      }
    });
    railObserver.observe(railEl);
  }

  // 分类/科属 facet：挂到共享产物点上，供筛选与“同源/同类”使用
  loadFacets().then((facets) => {
    const map = facets?.map || {};
    for (const s of productStars) {
      const idx = s.inchikey ? map[s.inchikey] : null;
      if (idx) {
        s._classIdx = idx[0];
        s._familyIdx = idx[1];
      }
    }
    lastGlowKey = "";
    setKingdomGlow();
  });
  raf = requestAnimationFrame(tick);

  // 调试：控制台可测拾取
  window.__ecoScene = {
    get cam() {
      return { ...cam };
    },
    get cameraActual() {
      return {
        pos: camera.position.toArray(),
        quat: camera.quaternion.toArray(),
        viewX: viewOffsetX,
        fly: fly.active,
        auto: cam.auto,
      };
    },
    get counts() {
      return {
        product: productStars.length,
        struct: structPts ? structPts.geometry.attributes.position.count : 0,
        flow: flowParts.length,
      };
    },
    get intro() {
      return {
        paused: introPaused,
        done: introDone,
        reveal: otherPts ? otherPts.material.uniforms.uReveal.value : null,
      };
    },
    get solar() {
      return solarGlow
        ? {
            x: solarGlow.position.x,
            y: solarGlow.position.y,
            z: solarGlow.position.z,
          }
        : null;
    },
    get ambient() {
      return {
        halo: canopyHalo,
        beam: beamSprite,
        source: beamSource,
        starfield,
        motes,
      };
    },
    get leafCount() {
      return leaves.filter((l) => l.visible).length;
    },
    get wormCount() {
      return worms.filter((w) => w.active).length;
    },
    get wormInfo() {
      return worms
        .filter((w) => w.active)
        .map((w) => ({
          x: w.x,
          y: w.y,
          z: w.z,
          life: w.life,
          maxLife: w.maxLife,
          name: w.molName,
          poolIdx: w.poolIdx,
        }));
    },
    get alkanePoolSize() {
      return alkanePool.length;
    },
    get clock() {
      return {
        wanted: clockWanted,
        amount: clockAmount,
        prepared: clockPrepared,
      };
    },
    get viewOffset() {
      const rail = document.querySelector(".explore-rail");
      const detail = document.querySelector(".detail");
      return {
        x: viewOffsetX,
        target: viewOffsetTarget,
        side: sideOffset,
        idle: document.body.classList.contains("idle"),
        rail: rail ? rail.getBoundingClientRect().width : 0,
        detail: detail ? detail.getBoundingClientRect().width : 0,
      };
    },
    get effects() {
      return {
        leavesVisible: leafObj ? leafObj.visible : null,
        wormsVisible: wormObj ? wormObj.visible : null,
        hoverTip: !tipEl.hidden,
      };
    },
    get wormSample() {
      const w = worms.find((o) => o.active);
      if (!w || !wormPos) return null;
      const pts = [];
      for (let j = 0; j < WORM_POINTS; j += 12) {
        const i = w.base + j;
        pts.push({
          p: [wormPos.getX(i), wormPos.getY(i), wormPos.getZ(i)],
          s: wormSizes.getX(i),
          u: j / (WORM_POINTS - 1),
        });
      }
      return { base: w.base, pts };
    },
    get leafInfo() {
      return leaves
        .filter((l) => l.visible)
        .map((l) => ({
          x: l.x,
          y: l.y,
          z: l.z,
          size: l.size,
          emerge: l.emerge,
        }));
    },
    projectPoint(x, y, z) {
      return projectVec({ x, y, z });
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
    countNear(x, y, z, r = 1) {
      let n = 0;
      const r2 = r * r;
      for (const s of productStars) {
        const dx = s.pos.x - x, dy = s.pos.y - y, dz = s.pos.z - z;
        if (dx * dx + dy * dy + dz * dz <= r2) n++;
      }
      return n;
    },
  };

  return {
    /** 加载页完全退场后再启动「泥土→根→干→冠」的生长入场 */
    startIntro() {
      if (introDone) return;
      introPaused = false;
      introT0 = -1;
      leafNext = 5.5;
    },
    focusView(preset) {
      const scale = WORLD_SCALE * TREE_VOLUME;
      const g = built?.crown || crownGeom(P);
      const centerY = ((TREE_Y1 + TREE_Y0) / 2) * WORLD_SCALE;
      if (preset === "crown") {
        flyToView(
          0,
          g.CY * scale,
          0,
          Math.max(22, g.R * scale * 2.3),
          0.1
        );
      } else if (preset === "roots") {
        flyToView(
          0,
          -0.35 * scale,
          0,
          Math.max(24, g.R * scale * 1.9),
          -0.18
        );
      } else if (preset === "top") {
        flyToView(0, centerY, 0, DIST_MAX * 0.95, 1.05);
      } else {
        flyToView(0, centerY, 0, DIST_MAX, 0.16);
      }
    },
    getCamera() {
      return {
        dist: cam.dist,
        yaw: cam.yaw,
        pitch: cam.pitch,
        fx: cam.fx,
        fy: cam.fy,
        fz: cam.fz,
      };
    },
    getNearby(limit = 6) {
      const filters = getState();
      const radius = Math.max(6, cam.dist * 0.55);
      const r2 = radius * radius;
      const found = [];
      for (const s of productStars) {
        if (!s?.pos || !matchFilters(s, filters)) continue;
        const dx = s.pos.x - cam.fx;
        const dy = s.pos.y - cam.fy;
        const dz = s.pos.z - cam.fz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= r2) found.push({ s, d2 });
      }
      found.sort((a, b) => a.d2 - b.d2);
      return found.slice(0, limit).map(({ s }) => ({
        id: s.id,
        nameZh: s.nameZh,
        organismZh: s.organismZh,
        kingdom: s.kingdom,
        layer: s.layer,
        kind: s.kind,
        inchikey: s.inchikey,
      }));
    },
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
      railObserver?.disconnect();
      railObserver = null;
      renderer.dispose();
    },
  };
}
