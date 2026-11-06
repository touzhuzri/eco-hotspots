/**
 * 苯环小助手
 *
 * 造型：正六边形苯环 + 六个碳点 + 交替双键，左右各一条两节手臂
 * （肩→肘→空心圆手），无腿、无其它装饰。环内是一张会变的脸。
 *
 * 立体感：
 *   - 键线与碳点用自写 fresnel/diffuse shader，管状体有明暗过渡
 *   - 背后一层错位轮廓 + 环内柔光片 + 碳点高光，形成前后层次
 *   - 身体略微朝屏幕外倾斜，并跟随鼠标产生 3D 视差
 *   - 手臂分肩、肘两节，手腕可转，能抬起、招手、托腮、指向前方
 *
 * 行为：左下常驻 → 选中分子后穿越（弧线躲避）→ 绕星一圈 → 悬浮观察
 *       → 取消选中返回 → 长时间待机做困倦表情。
 */

import * as THREE from "three";

const RING_R = 0.34;
const BOND_R = 0.0125;
const CARBON_R = 0.045;
const ARM_SEG = 0.085;
const HAND_R = 0.048;

const INK = 0x5ecf7e;
const INK_RIM = 0xe6fff0;
const INK_DIM = 0x3a9a5c;
const INK_DIM_RIM = 0xa8e8b8;
const CARBON = 0x08160e;
const CARBON_RIM = 0x8ef0a8;
const HAZE = 0x7fe8a0;
const FACE = "#ffd9a0";
const BLUSH = "rgba(255, 142, 128, 0.34)";

const FACE_W = 512;
const FACE_H = 384;
const EYE_L = 198;
const EYE_R = 314;
const EYE_Y = 158;
const MOUTH_Y = 242;

const SEL_SCALE = 0.72; // 选定后缩小，避免贴脸
const CLOSED_EYES = new Set(["happy", "laugh", "wink", "doze", "bored"]);

/** 到达后可以随机做的俏皮动作 */
const PLAY_POOL = [
  "peek",
  "wave",
  "poke",
  "bounce",
  "tilt",
  "pat",
  "hide",
  "heart",
];
const ACTION_DUR = {
  peek: 0.8,
  wave: 0.9,
  poke: 0.8,
  bounce: 0.85,
  tilt: 0.9,
  pat: 0.95,
  hide: 1.5,
  heart: 1.25,
  pull: 1.2,
};
const EXPRESSIONS = [
  "idle",
  "happy",
  "laugh",
  "excited",
  "curious",
  "observe",
  "think",
  "surprised",
  "confused",
  "sad",
  "angry",
  "shy",
  "wink",
  "bored",
  "doze",
  "brake",
  "love",
];

/** 每个表情对应的手臂姿态（lift 抬臂，bend 屈肘，wave 摆动幅度） */
const ARM_POSE = {
  idle: { lift: 0.06, bend: 0.1, wave: 0.1 },
  happy: { lift: 0.62, bend: 0.42, wave: 0.22 },
  laugh: { lift: 0.78, bend: 0.52, wave: 0.28 },
  excited: { lift: 1.08, bend: 0.3, wave: 0.32 },
  curious: { leftLift: 0.02, leftBend: 0.1, rightLift: 1.0, rightBend: 1.15, wave: 0.05 },
  observe: { leftLift: -0.05, leftBend: 0.08, rightLift: 0.52, rightBend: 0.95, wave: 0.04 },
  think: { leftLift: 1.25, leftBend: 1.25, rightLift: -0.05, rightBend: 0.08, wave: 0.03 },
  surprised: { lift: 1.25, bend: 0.25, wave: 0.16, spread: 0.18 },
  confused: { leftLift: 1.05, leftBend: 0.9, rightLift: -0.05, rightBend: 0.05, wave: 0.04 },
  sad: { lift: -0.28, bend: -0.05, wave: 0.03 },
  angry: { lift: 0.35, bend: 0.55, wave: 0.12, spread: 0.15 },
  shy: { lift: 1.15, bend: 1.35, wave: 0.03, inward: true },
  wink: { leftLift: 0.05, leftBend: 0.1, rightLift: 0.95, rightBend: 0.7, wave: 0.05 },
  bored: { lift: -0.22, bend: 0.02, wave: 0.02 },
  doze: { lift: -0.42, bend: -0.12, wave: 0.01 },
};

function makeGlowTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.28, "rgba(255,255,255,0.55)");
  g.addColorStop(0.65, "rgba(255,255,255,0.14)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 身后压暗片：在密集星点/连线里把小助手衬出来 */
function makeShadeTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  g.addColorStop(0, "rgba(1,5,3,0.72)");
  g.addColorStop(0.55, "rgba(1,5,3,0.4)");
  g.addColorStop(1, "rgba(1,5,3,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 比心时头顶的小爱心 */
function makeHeartTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.translate(size / 2, size / 2);
  ctx.beginPath();
  ctx.moveTo(0, 38);
  ctx.bezierCurveTo(-62, -2, -42, -56, 0, -24);
  ctx.bezierCurveTo(42, -56, 62, -2, 0, 38);
  ctx.closePath();
  ctx.fillStyle = "#ff9fb2";
  ctx.shadowColor = "#ff7f9c";
  ctx.shadowBlur = 18;
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 环内柔光片：边缘亮、中心透，给脸一个“内凹”的层次 */
function makeDiscTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  g.addColorStop(0, "rgba(2,12,7,0.8)");
  g.addColorStop(0.55, "rgba(3,22,13,0.56)");
  g.addColorStop(0.82, "rgba(90,200,120,0.2)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function stroke(ctx, color, width, blur, path) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.beginPath();
  path(ctx);
  ctx.stroke();
  ctx.restore();
}

function fill(ctx, color, path, blur = 0) {
  ctx.save();
  ctx.fillStyle = color;
  if (blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }
  ctx.beginPath();
  path(ctx);
  ctx.fill();
  ctx.restore();
}

/** 表情画布：每帧不重绘，只在表情/视线/眨眼变化时重绘 */
function paintFace(ctx, expression, look) {
  ctx.clearRect(0, 0, FACE_W, FACE_H);
  const ex = look?.x ? look.x * 7 : 0;
  const ey = look?.y ? look.y * 5 : 0;
  const L = { x: EYE_L + ex, y: EYE_Y + ey };
  const R = { x: EYE_R + ex, y: EYE_Y + ey };

  const eye = (p, rx, ry, highlight = 0) => {
    fill(ctx, FACE, (c) => c.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2), 16);
    if (highlight) {
      fill(
        ctx,
        "rgba(255, 250, 230, 0.9)",
        (c) => c.arc(p.x + rx * 0.34, p.y - ry * 0.34, highlight, 0, Math.PI * 2)
      );
    }
  };
  const closedEye = (p, r = 17, w = 7) =>
    stroke(ctx, FACE, w, 11, (c) =>
      c.arc(p.x, p.y + 4, r, Math.PI * 1.06, Math.PI * 1.94)
    );
  /** 细而宽的微笑，嘴角上挑，避免“香肠嘴” */
  const smile = (y = MOUTH_Y - 15, w = 60, depth = 11, width = 5) =>
    stroke(ctx, FACE, width, 9, (c) => {
      const cx = 256;
      const half = w / 2;
      c.moveTo(cx - half, y);
      c.quadraticCurveTo(cx, y + depth, cx + half, y);
      c.moveTo(cx - half, y);
      c.quadraticCurveTo(cx - half - 5, y - 3, cx - half - 2, y - 8);
      c.moveTo(cx + half, y);
      c.quadraticCurveTo(cx + half + 5, y - 3, cx + half + 2, y - 8);
    });
  const frown = (y = MOUTH_Y + 2, w = 44, depth = 9, width = 5) =>
    stroke(ctx, FACE, width, 9, (c) => {
      const cx = 256;
      const half = w / 2;
      c.moveTo(cx - half, y);
      c.quadraticCurveTo(cx, y - depth, cx + half, y);
      c.moveTo(cx - half, y);
      c.quadraticCurveTo(cx - half - 4, y + 4, cx - half - 1, y + 9);
      c.moveTo(cx + half, y);
      c.quadraticCurveTo(cx + half + 4, y + 4, cx + half + 1, y + 9);
    });
  const oMouth = (y, r, w = 5) =>
    stroke(ctx, FACE, w, 10, (c) => c.arc(256, y, r, 0, Math.PI * 2));
  /** D 形张口笑，带一点舌头 */
  const openSmile = (y = MOUTH_Y, w = 58, h = 18) => {
    fill(
      ctx,
      FACE,
      (c) => {
        const cx = 256;
        const half = w / 2;
        c.moveTo(cx - half, y);
        c.quadraticCurveTo(cx, y + h, cx + half, y);
        c.quadraticCurveTo(cx, y + h * 0.2, cx - half, y);
        c.closePath();
      },
      10
    );
    fill(
      ctx,
      "rgba(255, 142, 128, 0.5)",
      (c) => c.ellipse(256, y + h * 0.68, w * 0.17, h * 0.2, 0, 0, Math.PI * 2),
      6
    );
  };
  const heartEye = (p, s = 16) =>
    fill(
      ctx,
      "#ffb3c0",
      (c) => {
        c.moveTo(p.x, p.y + s * 0.72);
        c.bezierCurveTo(
          p.x - s * 1.3,
          p.y - s * 0.1,
          p.x - s * 0.68,
          p.y - s * 1.05,
          p.x,
          p.y - s * 0.36
        );
        c.bezierCurveTo(
          p.x + s * 0.68,
          p.y - s * 1.05,
          p.x + s * 1.3,
          p.y - s * 0.1,
          p.x,
          p.y + s * 0.72
        );
      },
      12
    );
  const blush = (x) =>
    fill(
      ctx,
      BLUSH,
      (c) => c.ellipse(x, 198, 27, 14, 0, 0, Math.PI * 2),
      10
    );
  const brow = (p, innerDy, outerDy = 0, width = 6) => {
    const inner = p.x < 256 ? 1 : -1;
    stroke(ctx, FACE, width, 8, (c) => {
      c.moveTo(p.x - inner * 30, p.y - 46 + outerDy);
      c.lineTo(p.x + inner * 20, p.y - 46 + innerDy);
    });
  };
  const lid = (p, dy = 9) =>
    stroke(ctx, FACE, 5, 8, (c) => {
      c.moveTo(p.x - 19, p.y - dy);
      c.quadraticCurveTo(p.x, p.y - dy - 4, p.x + 19, p.y - dy);
    });
  const squint = (p) =>
    stroke(ctx, FACE, 7, 10, (c) => {
      c.moveTo(p.x - 20, p.y);
      c.quadraticCurveTo(p.x, p.y - 5, p.x + 20, p.y);
    });

  switch (expression) {
    case "laugh":
      closedEye(L, 18);
      closedEye(R, 18);
      openSmile(MOUTH_Y + 4, 58, 22);
      blush(142);
      blush(370);
      break;
    case "happy":
      closedEye(L, 17);
      closedEye(R, 17);
      smile(MOUTH_Y - 14, 64, 12, 5.5);
      blush(142);
      blush(370);
      break;
    case "excited":
      eye(L, 24, 25, 5);
      eye(R, 24, 25, 5);
      openSmile(MOUTH_Y + 2, 48, 17);
      blush(140);
      blush(372);
      break;
    case "curious":
      eye(L, 21, 22, 3);
      eye(R, 16, 16);
      brow(L, -9, 4);
      oMouth(MOUTH_Y + 2, 13);
      break;
    case "observe":
      // 眯眼观察，但带着一点笑意，不要变成惊讶脸
      eye(L, 20, 11, 2);
      eye(R, 20, 11, 2);
      brow(L, -7, 2);
      smile(MOUTH_Y + 2, 42, 8, 4.5);
      break;
    case "brake":
      // 急刹：瞪眼、抬眉、抿嘴 + 一滴汗
      eye(L, 25, 27, 6);
      eye(R, 25, 27, 6);
      brow(L, -15, -7);
      brow(R, -15, -7);
      stroke(ctx, FACE, 5, 9, (c) => {
        c.moveTo(240, MOUTH_Y + 2);
        c.quadraticCurveTo(256, MOUTH_Y - 3, 272, MOUTH_Y + 2);
      });
      stroke(ctx, "rgba(255, 217, 160, 0.45)", 3, 6, (c) => {
        c.moveTo(112, MOUTH_Y + 16);
        c.lineTo(146, MOUTH_Y + 16);
        c.moveTo(366, MOUTH_Y + 16);
        c.lineTo(400, MOUTH_Y + 16);
      });
      fill(
        ctx,
        "rgba(150, 220, 255, 0.62)",
        (c) => c.ellipse(392, 108, 8, 13, 0.2, 0, Math.PI * 2),
        8
      );
      break;
    case "think":
      eye({ x: L.x - 5, y: L.y - 6 }, 15, 18, 2);
      eye({ x: R.x - 5, y: R.y - 6 }, 15, 18, 2);
      brow(L, 7, -3);
      brow(R, 2);
      stroke(ctx, FACE, 5, 10, (c) => {
        c.moveTo(230, MOUTH_Y);
        c.quadraticCurveTo(258, MOUTH_Y + 12, 284, MOUTH_Y);
      });
      break;
    case "surprised":
      eye(L, 26, 27, 6);
      eye(R, 26, 27, 6);
      brow(L, -13, -5);
      brow(R, -13, -5);
      oMouth(MOUTH_Y + 6, 19, 8);
      break;
    case "confused":
      eye(L, 19, 21, 3);
      eye(R, 16, 14);
      brow(L, -10, 2);
      brow(R, 8, -4);
      stroke(ctx, FACE, 5, 10, (c) => {
        c.moveTo(228, MOUTH_Y + 2);
        c.quadraticCurveTo(244, MOUTH_Y - 6, 258, MOUTH_Y + 2);
        c.quadraticCurveTo(272, MOUTH_Y + 9, 286, MOUTH_Y + 2);
      });
      break;
    case "sad":
      eye(L, 18, 19);
      eye(R, 18, 19);
      lid(L, 7);
      lid(R, 7);
      brow(L, -11, -3);
      brow(R, -11, -3);
      frown(MOUTH_Y + 2, 44, 9, 5);
      break;
    case "angry":
      squint(L);
      squint(R);
      brow(L, 12, -4, 7);
      brow(R, 12, -4, 7);
      frown(MOUTH_Y + 4, 38, 8, 5);
      break;
    case "shy":
      eye({ x: L.x + 3, y: L.y + 7 }, 17, 18);
      eye({ x: R.x + 3, y: R.y + 7 }, 17, 18);
      blush(138);
      blush(374);
      smile(MOUTH_Y + 2, 40, 8, 4.5);
      break;
    case "wink":
      closedEye(L, 17, 7);
      eye(R, 20, 21, 3);
      smile(MOUTH_Y, 46, 9, 5);
      break;
    case "bored":
      eye(L, 20, 9);
      eye(R, 20, 9);
      lid(L, 6);
      lid(R, 6);
      stroke(ctx, FACE, 5, 9, (c) => {
        c.moveTo(238, MOUTH_Y);
        c.lineTo(274, MOUTH_Y);
      });
      break;
    case "doze":
      closedEye(L, 18, 7);
      closedEye(R, 18, 7);
      smile(MOUTH_Y + 4, 30, 6, 4);
      stroke(ctx, FACE, 5, 10, (c) => {
        c.moveTo(376, 96);
        c.lineTo(396, 96);
        c.lineTo(376, 116);
        c.lineTo(396, 116);
      });
      break;
    case "love":
      heartEye(L, 17);
      heartEye(R, 17);
      smile(MOUTH_Y - 10, 48, 10, 5);
      blush(142);
      blush(370);
      break;
    case "blink":
      closedEye(L, 17, 7);
      closedEye(R, 17, 7);
      smile(MOUTH_Y + 2, 34, 7, 4.5);
      break;
    case "idle":
    default:
      eye(L, 19, 21, 2.6);
      eye(R, 19, 21, 2.6);
      smile(MOUTH_Y - 15, 62, 11, 5.5);
      fill(
        ctx,
        "rgba(255, 142, 128, 0.16)",
        (c) => c.ellipse(144, 198, 24, 12, 0, 0, Math.PI * 2),
        8
      );
      fill(
        ctx,
        "rgba(255, 142, 128, 0.16)",
        (c) => c.ellipse(368, 198, 24, 12, 0, 0, Math.PI * 2),
        8
      );
      break;
  }
}

function makeFaceMesh() {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.4125), mat);
  mesh.position.z = -0.008;
  mesh.renderOrder = 9997;
  mesh.frustumCulled = false;
  return { canvas, ctx, tex, mesh };
}

/** 带明暗和边缘光的材质：让圆管/圆球看起来是立体的 */
function makeInkMaterial(base, rim, opacity, light) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uBase: { value: new THREE.Color(base) },
      uRim: { value: new THREE.Color(rim) },
      uOpacity: { value: opacity },
      uLight: { value: light.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase;
      uniform vec3 uRim;
      uniform float uOpacity;
      uniform vec3 uLight;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        float diff = max(dot(n, normalize(uLight)), 0.0);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 2.2);
        vec3 col = mix(uBase, uRim, fres);
        float lum = 0.52 + 0.55 * diff + 0.35 * fres;
        gl_FragColor = vec4(col * lum, uOpacity);
      }
    `,
  });
}

function bondBetween(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 10, 1, true);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize()
  );
  mesh.renderOrder = 10000;
  mesh.frustumCulled = false;
  return mesh;
}

function greetingText() {
  const h = new Date().getHours();
  if (h < 5) return "夜深了，还想看哪颗分子？";
  if (h < 11) return "早上好，今天想了解什么？";
  if (h < 14) return "中午好，想找哪一类天然产物？";
  if (h < 18) return "下午好，想从哪颗分子开始？";
  if (h < 23) return "晚上好，要不要看看随机一颗？";
  return "夜深了，慢慢看。想了解什么？";
}

export function createCompanion() {
  const root = new THREE.Group();
  root.visible = false;
  root.frustumCulled = false;

  const glowTex = makeGlowTexture();
  const shadeTex = makeShadeTexture();
  const discTex = makeDiscTexture();
  const lightDir = new THREE.Vector3(0.45, 0.75, 0.55);
  const inkMat = makeInkMaterial(INK, INK_RIM, 0.62, lightDir);
  const inkDimMat = makeInkMaterial(INK_DIM, INK_DIM_RIM, 0.42, lightDir);
  const carbonMat = makeInkMaterial(CARBON, CARBON_RIM, 0.88, lightDir);

  // 身后压暗片：让密集星野里也能看清本体
  const shade = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: shadeTex,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: false,
    })
  );
  shade.scale.set(1.9, 1.9, 1);
  shade.position.z = -0.12;
  shade.renderOrder = 9987;
  root.add(shade);

  // 背后柔光
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: HAZE,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(1.65, 1.65, 1);
  halo.position.z = -0.1;
  halo.renderOrder = 9988;
  root.add(halo);

  const ring = new THREE.Group();
  root.add(ring);

  const verts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    verts.push(new THREE.Vector3(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0));
  }

  // 背后一层错位轮廓：身体倾斜时露出，制造厚度
  const backPts = verts.map(
    (v) => new THREE.Vector3(v.x * 1.06, v.y * 1.06, -0.08)
  );
  const backRing = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(backPts),
    new THREE.LineBasicMaterial({
      color: 0x5ecf7e,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  );
  backRing.renderOrder = 9989;
  ring.add(backRing);

  // 环内柔光片
  const innerDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.275, 48),
    new THREE.MeshBasicMaterial({
      map: discTex,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      depthTest: false,
    })
  );
  innerDisc.position.z = -0.035;
  innerDisc.renderOrder = 9995;
  ring.add(innerDisc);

  // 六个碳点：立体材质 + 背后微光 + 正面高光
  const carbonGeo = new THREE.SphereGeometry(CARBON_R, 18, 14);
  const highlightGeo = new THREE.SphereGeometry(0.009, 8, 6);
  const highlightMat = new THREE.MeshBasicMaterial({
    color: 0xfff6dd,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  for (const v of verts) {
    const dot = new THREE.Mesh(carbonGeo, carbonMat);
    dot.position.copy(v);
    dot.renderOrder = 10000;
    dot.frustumCulled = false;
    ring.add(dot);

    const g = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: HAZE,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
    g.position.copy(v);
    g.scale.setScalar(0.2);
    g.renderOrder = 9999;
    ring.add(g);

    const hi = new THREE.Mesh(highlightGeo, highlightMat);
    hi.position.copy(v).add(new THREE.Vector3(-0.012, 0.014, 0.04));
    hi.renderOrder = 10001;
    hi.frustumCulled = false;
    ring.add(hi);
  }

  // 六条边 + 交替双键
  for (let i = 0; i < 6; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % 6];
    ring.add(bondBetween(a, b, BOND_R, inkMat));

    if (i % 2 === 0) {
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const inward = mid.clone().multiplyScalar(-0.16);
      const pa = a.clone().lerp(b, 0.14).add(inward);
      const pb = a.clone().lerp(b, 0.86).add(inward);
      ring.add(bondBetween(pa, pb, BOND_R * 0.9, inkDimMat));
    }
  }

  // 两条两节手臂：肩 → 肘 → 空心圆手
  const arms = [];
  const jointGeo = new THREE.SphereGeometry(0.019, 10, 8);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(
      side * RING_R * Math.cos(Math.PI / 6),
      0,
      0.015
    );
    ring.add(shoulder);

    const shoulderJoint = new THREE.Mesh(jointGeo, inkMat);
    shoulderJoint.renderOrder = 10000;
    shoulderJoint.frustumCulled = false;
    shoulder.add(shoulderJoint);

    const upperEnd = new THREE.Vector3(side * ARM_SEG, 0, 0.018);
    shoulder.add(
      bondBetween(new THREE.Vector3(0, 0, 0), upperEnd, BOND_R, inkMat)
    );

    const elbow = new THREE.Group();
    elbow.position.copy(upperEnd);
    shoulder.add(elbow);

    const elbowJoint = new THREE.Mesh(jointGeo, inkMat);
    elbowJoint.renderOrder = 10000;
    elbowJoint.frustumCulled = false;
    elbow.add(elbowJoint);

    const foreEnd = new THREE.Vector3(side * ARM_SEG, 0, 0.02);
    elbow.add(bondBetween(new THREE.Vector3(0, 0, 0), foreEnd, BOND_R, inkMat));

    const hand = new THREE.Mesh(
      new THREE.TorusGeometry(HAND_R, BOND_R * 1.05, 10, 26),
      inkMat
    );
    hand.position.copy(foreEnd);
    hand.renderOrder = 10000;
    hand.frustumCulled = false;
    elbow.add(hand);

    const hg = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: HAZE,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
    hg.position.copy(foreEnd);
    hg.scale.setScalar(0.16);
    hg.renderOrder = 9999;
    elbow.add(hg);

    arms.push({ side, shoulder, elbow, hand });
  }

  const face = makeFaceMesh();
  root.add(face.mesh);

  // 比心时头顶飘起的小爱心
  const heartSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeHeartTexture(),
      color: 0xffc2ce,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  );
  heartSprite.position.set(0, 0.53, 0.04);
  heartSprite.scale.setScalar(0.001);
  heartSprite.renderOrder = 10002;
  heartSprite.visible = false;
  root.add(heartSprite);

  // ── 状态 ──────────────────────────────────────────────
  let expression = "idle";
  let blinking = false;
  let nextBlink = 0;
  let look = { x: 0, y: 0 };
  let lastLook = { x: 0, y: 0 };
  let selected = null;
  let visible = false;
  let lastCamera = null;
  let lastSize = null;
  let bubbleEl = null;
  let menuEl = null;
  let menuOpen = false;
  let bubbleTimer = 0;
  let greetTimer = 0;
  let greetMoodTimer = 0;
  let moodExpr = "";
  let moodUntil = 0;
  let nextMood = 10;
  let mode = "home";
  let modeT0 = -1;
  let guideActive = false;
  let guideSteps = [];
  let guideIndex = 0;
  let guideStepT0 = -1;
  let guideOnStep = null;
  let guideOnTap = null;
  let guideTapped = false;
  let guideTapT = -1;
  let guideSubEl = null;
  let guideSubTextEl = null;
  let guideLastText = "";
  let guidePrevPx = null;
  let guidePrevPy = null;
  let playActions = [];
  let playAction = "";
  let homeAction = "";
  let homeActionUntil = 0;
  let homeU = 0;
  let nextHomeAction = 0;
  let hideScale = 1;
  let nextHoverPlay = 0;
  let idleToyViewer = null;
  let mainParent = null;
  let toyAction = "";
  let toyT0 = 0;
  let toyNext = 0;
  let toyHide = 1;
  let travelDepth0 = 4.2;
  let returnDepth0 = 4.2;
  let modeFrom = new THREE.Vector3();
  let target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const bezier = new THREE.Vector3();
  const orbitCenter = new THREE.Vector3();
  const hidePos = new THREE.Vector3();
  const peekPos = new THREE.Vector3();
  const toyBase = new THREE.Vector3();
  const toyPos = new THREE.Vector3();
  const travelFromNdc = new THREE.Vector3();
  const returnFromNdc = new THREE.Vector3();
  const homeNdc = new THREE.Vector3();
  const starNdc = new THREE.Vector3();
  const qTilt = new THREE.Quaternion();
  const eTilt = new THREE.Euler();
  const ndc = new THREE.Vector3();
  const pointerTarget = { x: 0, y: 0 };
  const pointerTilt = { x: 0, y: 0 };

  function repaint() {
    paintFace(face.ctx, blinking ? "blink" : expression, look);
    face.tex.needsUpdate = true;
  }

  function setExpression(name) {
    const next = name || "idle";
    if (next === expression) return;
    expression = next;
    blinking = false;
    repaint();
  }

  function setLook(x, y) {
    const nx = Math.max(-1, Math.min(1, x));
    const ny = Math.max(-1, Math.min(1, y));
    if (Math.abs(nx - lastLook.x) < 0.12 && Math.abs(ny - lastLook.y) < 0.12) {
      return;
    }
    lastLook = { x: nx, y: ny };
    look = { x: nx, y: ny };
    repaint();
  }

  /** 从动作池里随机抽 n 个，不重复 */
  function pickRandomActions(n) {
    const pool = PLAY_POOL.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  }

  function actionExpression(name) {
    if (name === "wave") return "happy";
    if (name === "bounce") return "laugh";
    if (name === "tilt") return "think";
    if (name === "heart") return "love";
    if (name === "pat") return "happy";
    if (name === "poke") return "excited";
    return "curious";
  }

  /** 按各自时长找到当前动作与进度 */
  function actionAt(elapsed) {
    let acc = 0;
    for (let i = 0; i < playActions.length; i++) {
      const d = ACTION_DUR[playActions[i]] || 0.8;
      if (elapsed < acc + d) {
        return { action: playActions[i], u: (elapsed - acc) / d };
      }
      acc += d;
    }
    return null;
  }

  function onSelect(point, opts = {}) {
    selected = point ? new THREE.Vector3(point.x, point.y, point.z) : null;
    moodExpr = "";
    if (selected) {
      target.copy(selected);
      // 不再绕圈：距离越远，到达后随机做的俏皮动作越多；近距离直接急刹
      const dist = Number.isFinite(opts.distance) ? opts.distance : 30;
      const count = dist < 20 ? 0 : dist < 70 ? 2 : 4;
      // 6 秒待机会切走，到达后的动作总时长压在约 2.8 秒内
      const picked = pickRandomActions(count);
      let total = 0;
      playActions = [];
      for (const a of picked) {
        const d = ACTION_DUR[a] || 0.8;
        if (playActions.length && total + d > 2.8) continue;
        playActions.push(a);
        total += d;
      }
      hideScale = 1;
      nextHoverPlay = 0;
      setExpression("curious");
      nextBlink = 0;
      hideBubble();
      homeAction = "";
      nextHomeAction = 0;
      if (visible) {
        mode = "travel";
        modeT0 = -1;
      }
    } else {
      setExpression("idle");
      setLook(0, 0);
      homeAction = "";
      nextHomeAction = 0;
      if (visible && mode !== "home") {
        mode = "return";
        modeT0 = -1;
        modeFrom.copy(root.position);
      }
    }
  }

  function ensureBubble() {
    if (bubbleEl) return bubbleEl;
    bubbleEl = document.createElement("div");
    bubbleEl.className = "companion-bubble";
    bubbleEl.setAttribute("role", "status");
    document.body.appendChild(bubbleEl);
    return bubbleEl;
  }

  function placeBubble() {
    if (!bubbleEl || !lastCamera) return;
    const v = root.position.clone().project(lastCamera);
    const sx = ((v.x + 1) / 2) * window.innerWidth;
    const sy = ((1 - v.y) / 2) * window.innerHeight;
    bubbleEl.style.left = `${Math.round(
      Math.min(sx + 92, window.innerWidth - 240)
    )}px`;
    bubbleEl.style.top = `${Math.round(sy - 74)}px`;
  }

  /** 屏幕点是否落在本体上（画布侧做命中，避免透明按钮挡住滚轮/拖拽） */
  function hitTest(clientX, clientY) {
    if (
      !visible ||
      guideActive ||
      idleToyViewer ||
      !lastCamera ||
      // 飞行穿越中不接点击；到达星星后（hover/play/brake）可以点
      mode === "travel" ||
      document.body.classList.contains("idle")
    ) {
      return false;
    }
    const v = root.position.clone().project(lastCamera);
    const sx = ((v.x + 1) / 2) * window.innerWidth;
    const sy = ((1 - v.y) / 2) * window.innerHeight;
    const edge = root.position
      .clone()
      .addScaledVector(right, RING_R * 1.55 * root.scale.x)
      .project(lastCamera);
    const ex = ((edge.x + 1) / 2) * window.innerWidth;
    const r = Math.max(34, Math.abs(ex - sx));
    return Math.hypot(clientX - sx, clientY - sy) <= r;
  }

  /** 点击本体后的快捷菜单：快速分析 / 讲讲这颗 / 带我逛逛 / 问问 AI */
  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement("div");
    menuEl.className = "companion-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.hidden = true;
    menuEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-companion-action]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("eco:companion-action", {
          detail: { action: btn.dataset.companionAction },
        })
      );
      hideMenu();
    });
    document.body.appendChild(menuEl);
    return menuEl;
  }

  function onMenuOutside(e) {
    if (!menuOpen) return;
    if (menuEl?.contains(e.target)) return;
    hideMenu();
  }

  function onMenuKey(e) {
    if (e.key === "Escape") hideMenu();
  }

  function placeMenu() {
    if (!menuOpen || !menuEl || !lastCamera) return;
    const v = root.position.clone().project(lastCamera);
    const sx = ((v.x + 1) / 2) * window.innerWidth;
    const sy = ((1 - v.y) / 2) * window.innerHeight;
    const w = menuEl.offsetWidth || 220;
    const left = Math.max(12 + w / 2, Math.min(window.innerWidth - 12 - w / 2, sx));
    const top = Math.max(12 + menuEl.offsetHeight, sy - 72);
    menuEl.style.left = `${Math.round(left)}px`;
    menuEl.style.top = `${Math.round(top)}px`;
  }

  function showMenu(items) {
    if (!Array.isArray(items) || !items.length) return;
    ensureMenu();
    menuEl.innerHTML = items
      .map(
        (it) =>
          `<button type="button" role="menuitem" data-companion-action="${it.id}"${
            it.primary ? ' class="is-primary"' : ""
          }><b>${it.label}</b><span>${it.hint || ""}</span></button>`
      )
      .join("");
    menuEl.hidden = false;
    menuOpen = true;
    placeMenu();
    requestAnimationFrame(() => menuEl.classList.add("is-on"));
    document.addEventListener("pointerdown", onMenuOutside, true);
    document.addEventListener("keydown", onMenuKey);
  }

  function hideMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    menuEl?.classList.remove("is-on");
    document.removeEventListener("pointerdown", onMenuOutside, true);
    document.removeEventListener("keydown", onMenuKey);
    const el = menuEl;
    setTimeout(() => {
      if (!menuOpen && el) el.hidden = true;
    }, 180);
  }

  function showGreeting() {
    ensureBubble();
    bubbleEl.textContent = greetingText();
    placeBubble();
    requestAnimationFrame(() => bubbleEl.classList.add("is-on"));
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubbleEl?.classList.remove("is-on");
    }, 9000);
    setExpression("happy");
    clearTimeout(greetMoodTimer);
    greetMoodTimer = setTimeout(() => {
      if (expression === "happy" && mode === "home") setExpression("idle");
    }, 2600);
  }

  function hideBubble() {
    clearTimeout(bubbleTimer);
    clearTimeout(greetTimer);
    clearTimeout(greetMoodTimer);
    bubbleEl?.classList.remove("is-on");
  }

  function show() {
    if (visible) return;
    visible = true;
    root.visible = true;
    root.scale.setScalar(0.001);
    homeAction = "";
    nextHomeAction = 0;
    setExpression("idle");
    repaint();
    clearTimeout(greetTimer);
    greetTimer = setTimeout(showGreeting, 3200);
  }

  function hide() {
    visible = false;
    root.visible = false;
    hideBubble();
    hideMenu();
  }

  /** 进入待机介绍里的 3D 球棍视口，变成那个场景里的小助手 */
  function enterIdleToy(viewer) {
    if (!viewer?.scene || !viewer.camera) return;
    if (idleToyViewer === viewer && root.parent === viewer.scene) return;
    if (idleToyViewer) exitIdleToy();
    mainParent = root.parent;
    if (root.parent) root.parent.remove(root);
    viewer.scene.add(root);
    idleToyViewer = viewer;
    hideBubble();
    hideMenu();
    shade.visible = false;
    innerDisc.material.opacity = 0.45;
    root.visible = true;
    root.scale.setScalar(0.6);
    selected = null;
    hideScale = 1;
    mode = "idleToy";
    modeT0 = -1;
    toyAction = "";
    toyT0 = 0;
    toyNext = 0;
    toyHide = 1;
    homeAction = "";
    nextHomeAction = 0;
    setExpression("happy");
    setLook(-0.35, 0.1);
  }

  function exitIdleToy() {
    if (!idleToyViewer) return;
    const v = idleToyViewer;
    if (root.parent === v.scene) v.scene.remove(root);
    if (mainParent) mainParent.add(root);
    idleToyViewer = null;
    shade.visible = true;
    innerDisc.material.opacity = 0.78;
    heartSprite.visible = false;
    toyAction = "";
    toyHide = 1;
    homeAction = "";
    nextHomeAction = 0;
    mode = "home";
    modeT0 = -1;
    hideScale = 1;
    root.scale.setScalar(0.9);
    setExpression("idle");
    setLook(0, 0);
  }

  function isIdleToy() {
    return !!idleToyViewer;
  }

  function startToyAction(name, t) {
    toyAction = name;
    toyT0 = t;
    if (name === "poke") {
      setExpression("excited");
      idleToyViewer?.nudge?.(1.2);
    } else if (name === "pat") {
      setExpression("happy");
      idleToyViewer?.pulse?.();
    } else if (name === "bounce") {
      setExpression("laugh");
      idleToyViewer?.pulse?.();
    } else if (name === "pull") {
      setExpression("excited");
      idleToyViewer?.tug?.({ x: 1, y: 0.15, z: 0.35 }, 1.2);
    } else if (name === "peek") {
      setExpression("curious");
    } else if (name === "tilt") {
      setExpression("think");
    } else if (name === "hide") {
      setExpression("curious");
    } else if (name === "heart") {
      setExpression("love");
    }
  }

  /** 在待机 3D 分子旁边戳、拍、躲、比心、拉扯 */
  function updateIdleToy(dt, t) {
    const viewer = idleToyViewer;
    if (!viewer?.camera) return;
    const cam = viewer.camera;
    const b = viewer.bounds || { maxXZ: 2, maxY: 2 };
    const r = Math.max(1.2, b.maxXZ || 2);
    const h = Math.max(1, b.maxY || 2);
    // 按视口可见高度取景，保证小助手在卡片里足够大
    const visH =
      2 * cam.position.length() * Math.tan((cam.fov * Math.PI) / 360);
    const toyScale = Math.min(3.2, Math.max(0.9, (visH * 0.35) / 0.7));
    const smooth = (x) => {
      const c = Math.min(1, Math.max(0, x));
      return c * c * (3 - 2 * c);
    };

    if (toyAction && toyT0 < 0) startToyAction(toyAction, t);
    const dur = toyAction ? ACTION_DUR[toyAction] || 0.9 : 0;
    if (toyAction && t - toyT0 > dur) {
      toyAction = "";
      toyNext = t + 4 + Math.random() * 4;
      setExpression("observe");
    }
    if (!toyAction && t > toyNext) {
      const pool = [
        "poke",
        "pat",
        "peek",
        "bounce",
        "tilt",
        "hide",
        "heart",
        "pull",
        "pull",
      ];
      startToyAction(pool[Math.floor(Math.random() * pool.length)], t);
    }

    const u = toyAction ? Math.min(1, (t - toyT0) / (ACTION_DUR[toyAction] || 0.9)) : 0;
    toyBase.set(r * 0.22, h * 0.42, Math.max(1.2, r * 0.55));
    toyPos.copy(toyBase);
    toyHide = 1;
    let roll = 0;
    if (toyAction === "poke" || toyAction === "pat") {
      toyPos.x -= Math.sin(Math.PI * u) * 0.2 * toyScale;
      roll = Math.sin(Math.PI * u) * 0.05;
    } else if (toyAction === "peek") {
      toyPos.x -= Math.sin(Math.PI * u) * 0.16 * toyScale;
    } else if (toyAction === "pull") {
      // 先伸手抓住分子，再往后拽
      const reach = Math.sin(Math.PI * Math.min(1, u / 0.35));
      toyPos.x -= 0.2 * toyScale * reach;
      if (u > 0.35) {
        toyPos.x +=
          0.13 *
          toyScale *
          Math.sin(Math.PI * ((u - 0.35) / 0.65));
      }
      roll = -0.08 * Math.sin(Math.PI * u);
    } else if (toyAction === "bounce") {
      toyPos.y += Math.abs(Math.sin(Math.PI * u)) * 0.12 * toyScale;
    } else if (toyAction === "tilt") {
      roll = Math.sin(u * Math.PI * 2) * 0.18;
    } else if (toyAction === "heart") {
      toyPos.y += Math.sin(Math.PI * u) * 0.03 * toyScale;
    } else if (toyAction === "hide") {
      if (u < 0.4) {
        const p = smooth(u / 0.4);
        toyPos.z -= 0.9 * toyScale * p;
        toyPos.x -= 0.08 * toyScale * p;
        toyHide = 1 - 0.6 * p;
        setExpression("curious");
      } else if (u < 0.65) {
        toyPos.z -= 0.9 * toyScale;
        toyPos.x -= 0.08 * toyScale;
        toyHide = 0.4;
        setExpression("curious");
      } else if (u < 0.85) {
        const p = smooth((u - 0.65) / 0.2);
        toyPos.z -= 0.9 * toyScale * (1 - p);
        toyPos.x -= (0.08 + 0.12 * p) * toyScale;
        toyHide = 0.4 + 0.6 * p;
        setExpression("surprised");
      } else {
        const p = smooth((u - 0.85) / 0.15);
        toyPos.z -= 0.9 * toyScale * (1 - p);
        toyHide = 1;
        setExpression("happy");
      }
    }

    root.position.copy(toyPos);
    root.quaternion.copy(cam.quaternion);
    eTilt.set(
      Math.sin(t * 0.7) * 0.03,
      Math.sin(t * 0.5) * 0.05 + (toyAction ? 0.07 : 0.035),
      roll + Math.sin(t * 0.6) * 0.02
    );
    qTilt.setFromEuler(eTilt);
    root.quaternion.multiply(qTilt);

    const targetScale = toyScale * toyHide;
    const s = root.scale.x + (targetScale - root.scale.x) * Math.min(1, dt * 6);
    root.scale.setScalar(s);

    applyArmPose(dt, t, (side) =>
      toyAction ? playPose(toyAction, side, t) : observePose(side, t)
    );
    ring.rotation.z = Math.sin(t * 0.37) * 0.02;

    const heartsOn = toyAction === "heart";
    heartSprite.visible = heartsOn;
    if (heartsOn) {
      const hs = 0.12 + 0.024 * Math.sin(t * 7.5);
      heartSprite.scale.setScalar(hs);
      heartSprite.material.opacity = 0.55 + 0.25 * Math.sin(t * 6);
    }
    if (!toyAction) setLook(-0.35, 0.1);
  }

  window.addEventListener("resize", placeBubble);
  window.addEventListener(
    "pointermove",
    (e) => {
      pointerTarget.x = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      pointerTarget.y = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    },
    { passive: true }
  );

  /** 游泳划水：左右交替，一前一后 */
  function swimPose(side, t) {
    const ph = side > 0 ? 0 : Math.PI;
    const s = Math.sin(t * 5.2 + ph);
    const c = Math.cos(t * 5.2 + ph);
    return {
      sz: side * (0.38 + 0.42 * s),
      sx: 0.42 * c,
      sy: -side * (0.48 + 0.34 * s),
      ez: side * (0.55 + 0.42 * c),
      ey: -side * (0.36 + 0.24 * s),
      hz: 0.42 * Math.sin(t * 6.4 + ph),
    };
  }

  /** 急刹：双臂往前撑，身体后仰 */
  function brakePose(side, t) {
    const ph = side > 0 ? 0 : Math.PI;
    return {
      sz: side * 0.1,
      sx: -0.18,
      sy: -side * (0.85 + 0.05 * Math.sin(t * 9 + ph)),
      ez: side * (0.2 + 0.05 * Math.sin(t * 9 + ph)),
      ey: -side * 0.35,
      hz: 0.15 * Math.sin(t * 10 + ph),
    };
  }

  /** 悬浮观察：一只手抬到脸侧，另一只手自然垂着 */
  function observePose(side, t) {
    const ph = side > 0 ? 0 : Math.PI;
    const s = Math.sin(t * 1.6 + ph);
    if (side > 0) {
      return {
        sz: 0.98 + 0.05 * s,
        sx: 0.08,
        sy: -0.42,
        ez: 1.08 + 0.07 * s,
        ey: -0.5,
        hz: 0.2 * s,
      };
    }
    return {
      sz: 0.14 + 0.03 * Math.sin(t * 1.3),
      sx: 0.03,
      sy: -0.06,
      ez: 0.16,
      ey: 0.04,
      hz: 0.08 * Math.sin(t * 1.1),
    };
  }

  /** 到达后的小动作：探头 / 招手 / 戳一下 / 蹦一下 */
  function playPose(action, side, t) {
    if (action === "bounce") {
      return {
        sz: side * (0.95 + 0.12 * Math.sin(t * 8)),
        sx: 0.18 * Math.sin(t * 8),
        sy: -side * 0.24,
        ez: side * 0.35,
        ey: -side * 0.2,
        hz: 0.3 * Math.sin(t * 9),
      };
    }
    if (action === "heart") {
      // 双手举到头顶、向内合拢比心
      return {
        sz: side * 1.35,
        sx: 0.05,
        sy: -side * 0.55,
        ez: side * 1.25,
        ey: -side * 0.9,
        hz: side * 0.2,
      };
    }
    if (action === "pull") {
      // 双手伸向分子，往后拉
      return {
        sz: side * 0.06,
        sx: -0.1,
        sy: -side * 0.95,
        ez: side * 0.1,
        ey: -side * 0.3,
        hz: 0.2 * Math.sin(t * 9),
      };
    }
    if (side < 0) {
      return {
        sz: 0.12,
        sx: 0.02,
        sy: -0.05,
        ez: 0.15,
        ey: 0.04,
        hz: 0.08 * Math.sin(t * 1.1),
      };
    }
    if (action === "peek" || action === "hide") return observePose(side, t);
    if (action === "pat") {
      return {
        sz: 0.05,
        sx: -0.02,
        sy: -0.05,
        ez: 0.05 + 0.32 * Math.abs(Math.sin(t * 12)),
        ey: 0,
        hz: 0.25 * Math.sin(t * 12),
      };
    }
    if (action === "wave") {
      return {
        sz: 1.35 + 0.12 * Math.sin(t * 10),
        sx: 0.1,
        sy: -0.3,
        ez: 0.35,
        ey: -0.2,
        hz: 0.5 * Math.sin(t * 10),
      };
    }
    if (action === "poke") {
      return {
        sz: 0.08,
        sx: -0.05,
        sy: -0.1,
        ez: 0.05,
        ey: 0,
        hz: 0.1 * Math.sin(t * 9),
      };
    }
    return {
      sz: 0.12,
      sx: 0.02,
      sy: -0.05,
      ez: 0.15,
      ey: 0.04,
      hz: 0.08 * Math.sin(t * 1.1),
    };
  }

  function applyArmPose(dt, t, poseFor) {
    const ak = 1 - Math.exp(-dt * 8);
    for (const arm of arms) {
      const p = poseFor(arm.side);
      arm.shoulder.rotation.z += (p.sz - arm.shoulder.rotation.z) * ak;
      arm.shoulder.rotation.x += (p.sx - arm.shoulder.rotation.x) * ak;
      arm.shoulder.rotation.y += (p.sy - arm.shoulder.rotation.y) * ak;
      arm.elbow.rotation.z += (p.ez - arm.elbow.rotation.z) * ak;
      arm.elbow.rotation.y += (p.ey - arm.elbow.rotation.y) * ak;
      arm.hand.rotation.z += (p.hz - arm.hand.rotation.z) * ak;
    }
  }

  function armPose(name, side, t) {
    const p = ARM_POSE[name] || ARM_POSE.idle;
    const lift =
      side > 0 ? p.rightLift ?? p.lift ?? 0 : p.leftLift ?? p.lift ?? 0;
    const bend =
      side > 0 ? p.rightBend ?? p.bend ?? 0 : p.leftBend ?? p.bend ?? 0;
    const wave = p.wave ?? 0.06;
    const ph = side > 0 ? 0 : Math.PI;
    return {
      sz: side * lift + side * Math.sin(t * 1.15 + ph) * wave,
      sx: Math.sin(t * 0.6 + ph) * 0.05 + (p.spread ? side * p.spread : 0),
      sy: (p.inward ? -side * 0.45 : 0) + Math.sin(t * 0.5 + ph) * 0.05,
      ez: side * bend + side * Math.sin(t * 1.7 + ph) * wave * 0.6,
      ey: (p.inward ? -side * 0.7 : 0) + Math.sin(t * 0.9 + ph) * 0.06,
      hz: Math.sin(t * 1.9 + ph) * 0.26,
    };
  }

  function ensureGuideSubtitle() {
    if (guideSubEl) return;
    const el = document.createElement("div");
    el.className = "companion-subtitle";
    el.hidden = true;
    el.innerHTML = `
      <p class="companion-subtitle-text"></p>
      <button type="button" class="companion-subtitle-skip">跳过</button>`;
    document.body.appendChild(el);
    guideSubEl = el;
    guideSubTextEl = el.querySelector(".companion-subtitle-text");
    el.querySelector(".companion-subtitle-skip").addEventListener(
      "click",
      stopGuide
    );
  }

  /**
   * 字幕跟随本体：像弹幕/对话气泡一样贴在小助手旁边。
   * 锚在靠近本体的一侧边缘，文字变长时朝外侧生长，不会盖住它。
   */
  function placeGuideSubtitle(sx, sy) {
    const el = guideSubEl;
    if (!el || el.hidden) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 46;
    const pad = 12;
    // 小助手在右半边时，气泡放到它左侧；否则放右侧
    const onLeft = sx > vw * 0.52;
    const cy = Math.max(72, Math.min(vh - 72, sy));
    el.style.top = `${Math.round(cy)}px`;
    el.style.bottom = "auto";
    el.style.transform = "translateY(-50%)";
    el.style.maxWidth = `${Math.min(420, Math.round(vw * 0.46))}px`;
    if (onLeft) {
      el.style.left = "auto";
      el.style.right = `${Math.round(Math.max(pad, vw - sx + gap))}px`;
    } else {
      el.style.right = "auto";
      el.style.left = `${Math.round(Math.min(vw - pad - 40, sx + gap))}px`;
    }
    el.classList.toggle("sub-left", onLeft);
    el.classList.toggle("sub-right", !onLeft);
  }

  function startGuide(steps, opts = {}) {
    if (!Array.isArray(steps) || !steps.length) return;
    if (!visible) show();
    hideBubble();
    selected = null;
    guideActive = true;
    guideSteps = steps;
    guideIndex = 0;
    guideStepT0 = -1;
    guideOnStep = opts.onStep || null;
    guideOnTap = opts.onTap || null;
    guideTapped = false;
    guideTapT = -1;
    guideLastText = "";
    guidePrevPx = null;
    guidePrevPy = null;
    mode = "home";
    modeT0 = -1;
    ensureGuideSubtitle();
    guideSubEl.hidden = false;
    guideSubEl.classList.toggle("is-right", opts.place === "right");
    guideSubTextEl.textContent = "";
    heartSprite.visible = false;
    hideMenu();
    setExpression("curious");
  }

  function stopGuide() {
    if (!guideActive) return;
    guideActive = false;
    guideSteps = [];
    guideIndex = 0;
    guideStepT0 = -1;
    guideOnStep = null;
    guideOnTap = null;
    guideTapped = false;
    guideTapT = -1;
    guideLastText = "";
    guidePrevPx = null;
    guidePrevPy = null;
    if (guideSubEl) {
      guideSubEl.hidden = true;
      if (guideSubTextEl) guideSubTextEl.textContent = "";
    }
    // 讲完后从当前位置平滑飞回家，而不是瞬移
    modeT0 = -1;
    modeFrom.copy(root.position);
    mode = visible ? "return" : "home";
    setExpression(selected ? "curious" : "idle");
  }

  function isGuiding() {
    return guideActive;
  }

  // 字幕停留时间按文字长度算：先按打字机速度打完，再留出把整句读完的时间。
  // 步骤自带的 duration 作为下限（结构式展开等需要等待的步骤仍保留原时长）。
  const TYPE_CPS = 26;
  const READ_CPS = 12;
  function guideDuration(step) {
    const base = Number.isFinite(step.duration) ? step.duration : 3.2;
    const len = String(step.text || "").length;
    if (!len) return base;
    const need = len / TYPE_CPS + len / READ_CPS + 0.7;
    return Math.max(base, Math.min(20, need));
  }

  /** 界面导览：按屏幕坐标滑动 + 字幕 + 手势；相机拖动由 TreeScene 的 onStep 负责 */
  function updateGuide(dt, t, ctx) {
    const { camera, width, height } = ctx;
    lastCamera = camera;
    lastSize = [width, height];
    const step = guideSteps[guideIndex];
    if (!step) {
      stopGuide();
      return;
    }
    if (guideStepT0 < 0) {
      // 从「当前屏幕位置」开始滑向新锚点，而不是直接跳过去
      if (guidePrevPx === null) {
        const p = root.position.clone().project(camera);
        guidePrevPx = ((p.x + 1) / 2) * width;
        guidePrevPy = ((1 - p.y) / 2) * height;
      }
      guideStepT0 = t;
      guideLastText = "";
      guideTapped = false;
      guideTapT = -1;
      setExpression(step.expression || "curious");
      guideOnStep?.(guideIndex, step);
    }
    const dur = guideDuration(step);
    const elapsed = t - guideStepT0;

    // 主动“点击”界面：到了这一步的 tapAfter 秒就触发一次，
    // 具体点什么由 TreeScene 的 onTap 决定（展开结构式、发光强调等）。
    if (!guideTapped && step.tapAfter != null && elapsed >= step.tapAfter) {
      guideTapped = true;
      guideTapT = elapsed;
      guideOnTap?.(guideIndex, step);
    }
    const tapAge = guideTapT >= 0 ? elapsed - guideTapT : 99;
    const tapK = tapAge >= 0 && tapAge < 0.5
      ? Math.sin((tapAge / 0.5) * Math.PI)
      : 0;
    const u = Math.min(1, elapsed / dur);
    const full = step.text || "";
    const n = Math.min(full.length, Math.floor(elapsed * 26) + 1);
    const shown = full.slice(0, n);
    if (shown !== guideLastText) {
      guideLastText = shown;
      if (guideSubTextEl) guideSubTextEl.textContent = shown;
    }

    // 屏幕空间缓动：相机会自转/被拖动，若在世界空间追赶会严重滞后，
    // 所以先平滑锚点，再把本体直接钉在当前相机的锚点射线上。
    // 支持 step.anchor()：每帧取目标 DOM 元素的实时位置（页面滚动时跟着走）。
    let aimX = step.px;
    let aimY = step.py;
    if (typeof step.anchor === "function") {
      const a = step.anchor();
      if (a) {
        aimX = a.px;
        aimY = a.py;
      }
    }
    const slide = 1 - Math.exp(-dt * (typeof step.anchor === "function" ? 7.5 : 5.5));
    guidePrevPx += (aimX - guidePrevPx) * slide;
    guidePrevPy += (aimY - guidePrevPy) * slide;
    placeGuideSubtitle(guidePrevPx, guidePrevPy);
    camera.updateMatrixWorld();
    forward.setFromMatrixColumn(camera.matrixWorld, 2).negate();
    ndc.set(
      ((guidePrevPx + 12 * tapK) / width) * 2 - 1,
      1 - (guidePrevPy / height) * 2,
      0.5
    );
    ndc.unproject(camera).sub(camera.position).normalize();
    const D = 4.2;
    const reach = D / Math.max(0.15, ndc.dot(forward));
    desired.copy(camera.position).addScaledVector(ndc, reach);
    desired.y += Math.sin(t * 1.2) * 0.018;
    root.position.copy(desired);

    root.quaternion.copy(camera.quaternion);
    eTilt.set(
      Math.sin(t * 0.7) * 0.03,
      Math.sin(t * 0.5) * 0.05,
      Math.sin(t * 0.6) * 0.02 - 0.11 * tapK
    );
    qTilt.setFromEuler(eTilt);
    root.quaternion.multiply(qTilt);

    const aspect = width / Math.max(1, height);
    const compact = height < 560 ? 0.72 : aspect < 1.05 ? 0.82 : 1;
    const baseScale = Number.isFinite(step.scale) ? step.scale : 0.7;
    // “按一下”时整体轻微一缩，像真的戳到界面
    const targetScale = baseScale * compact * (1 - 0.06 * tapK);
    const s = root.scale.x + (targetScale - root.scale.x) * Math.min(1, dt * 6);
    root.scale.setScalar(s);

    const gesture = step.gesture || "idle";
    applyArmPose(dt, t, (side) => {
      if (gesture === "wave") return playPose("wave", side, t);
      if (gesture === "point") return playPose("pat", side, t);
      if (gesture === "pull") return playPose("pull", side, t);
      if (gesture === "tap") return playPose("pat", side, t);
      return observePose(side, t);
    });
    ring.rotation.z = Math.sin(t * 0.37) * 0.02;

    if (u >= 1) {
      guideIndex++;
      guideStepT0 = -1;
      if (guideIndex >= guideSteps.length) stopGuide();
    }
  }

  function update(dt, t, ctx) {
    if (!visible || idleToyViewer) return;
    if (guideActive) {
      updateGuide(dt, t, ctx);
      return;
    }
    const { camera, width, height, camDist, idle, reduceMotion } = ctx;
    lastCamera = camera;
    lastSize = [width, height];
    if (idle) bubbleEl?.classList.remove("is-on");

    const aspect = width / Math.max(1, height);
    const narrow = aspect < 1.05;
    // 未选中时锚定在固定景深，树的缩放不改变小助手的屏幕大小；
    // 选中后仍用固定世界尺寸，让透视负责由远及近。
    const homeDepth = 4.2;
    const compact = height < 560 ? 0.72 : narrow ? 0.82 : 1;
    const baseScale = 1.05 * compact;
    const homeScale = 0.7 * compact;

    camera.updateMatrixWorld();
    forward.setFromMatrixColumn(camera.matrixWorld, 2).negate();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);

    // 屏幕锚点：避开左侧探索栏和底部 dock
    const rail = document.querySelector(".explore-rail");
    const railRect = rail ? rail.getBoundingClientRect() : null;
    const safeLeft =
      railRect && railRect.width > 0 ? railRect.right + 18 : 12;
    const px = narrow
      ? Math.min(width * 0.26, safeLeft + 90)
      : Math.min(width * 0.3, safeLeft + 100);
    // 底部 AI 坞会占位；把小助手的家抬到它上方
    const aiDock = document.querySelector(".ai-dock");
    const aiRect = aiDock ? aiDock.getBoundingClientRect() : null;
    const aiLift = aiRect && aiRect.height > 0 ? aiRect.height + 18 : 0;
    const py = Math.max(
      90,
      height - (narrow ? 96 : 128) - aiLift
    );

    ndc.set((px / width) * 2 - 1, 1 - (py / height) * 2, 0.5);
    ndc.unproject(camera).sub(camera.position).normalize();
    const reach = homeDepth / Math.max(0.15, ndc.dot(forward));

    desired.copy(camera.position).addScaledVector(ndc, reach);
    const calm = idle ? 0.35 : 1;
    desired.y += Math.sin(t * 0.85) * 0.035 * calm;
    desired.x += Math.sin(t * 0.51 + 1.2) * 0.02 * calm;

    if (idle && mode !== "home") {
      mode = "return";
      modeT0 = -1;
      modeFrom.copy(root.position);
    }
    if (mode === "home") {
      hideScale = 1;
      // 常态待机动作：没人点它时，每 8–14 秒自己做个小动作
      if (!nextHomeAction) nextHomeAction = t + 8 + Math.random() * 5;
      if (homeAction && t > homeActionUntil) {
        homeAction = "";
        setExpression("idle");
        nextHomeAction = t + 8 + Math.random() * 6;
      }
      if (!homeAction && !selected && t > nextHomeAction) {
        const pool = ["wave", "bounce", "tilt", "heart", "peek"];
        homeAction = pool[Math.floor(Math.random() * pool.length)];
        homeActionUntil = t + (ACTION_DUR[homeAction] || 0.9);
        setExpression(actionExpression(homeAction));
        nextHomeAction = t + 8 + Math.random() * 6;
      }
      root.position.copy(desired);
      if (homeAction) {
        homeU =
          1 -
          Math.max(
            0,
            (homeActionUntil - t) / (ACTION_DUR[homeAction] || 0.9)
          );
        if (homeAction === "bounce") {
          root.position.addScaledVector(
            up,
            Math.abs(Math.sin(Math.PI * homeU)) * 0.08
          );
        }
      } else {
        homeU = 0;
      }
      if (selected && !idle) {
        mode = "travel";
        modeT0 = -1;
        homeAction = "";
        setExpression("curious");
      }
    }

    let bank = 0;
    let swimMode = "none";
    let swimRoll = 0;
    let swimPitch = 0;
    let swimYaw = 0;
    if (homeAction) {
      swimMode = "play";
      playAction = homeAction;
    }
    if (mode === "travel") {
      if (modeT0 < 0) {
        modeT0 = t;
        travelFromNdc.copy(root.position).project(camera);
        travelDepth0 = homeDepth;
      }
      const u = Math.min(1, (t - modeT0) / 1.8);
      const e = u * u * (3 - 2 * u);
      // 终点直接落在星星旁边的观察位，避免绕到另一侧后再瞬移回来
      bezier
        .copy(target)
        .addScaledVector(forward, 1.45)
        .addScaledVector(right, -0.62)
        .addScaledVector(up, -0.28);
      starNdc.copy(bezier).project(camera);
      const arc = Math.sin(Math.PI * u);
      // 先扎进星野深处（变小），再冲向目标星旁边（变大）
      const depth =
        travelDepth0 +
        (14 - travelDepth0) * arc +
        (4.7 - travelDepth0) * e;
      ndc.set(
        travelFromNdc.x + (starNdc.x - travelFromNdc.x) * e + arc * 0.14,
        travelFromNdc.y + (starNdc.y - travelFromNdc.y) * e +
          Math.sin(Math.PI * 2 * u) * 0.07,
        0.5
      );
      ndc.unproject(camera).sub(camera.position).normalize();
      const travelReach = depth / Math.max(0.15, ndc.dot(forward));
      root.position.copy(camera.position).addScaledVector(ndc, travelReach);
      swimMode = "swim";
      bank = Math.sin(u * Math.PI * 2) * 0.16;
      swimRoll = Math.sin(t * 5.2) * 0.1;
      swimPitch = Math.sin(t * 5.2) * 0.05;
      swimYaw = Math.sin(t * 2.6) * 0.1;
      if (u >= 1) {
        mode = playActions.length ? "play" : "brake";
        modeT0 = t;
        modeFrom.copy(root.position);
        setExpression(playActions.length ? "curious" : "brake");
      }
    } else if (mode === "play") {
      // 在星星旁边做随机俏皮动作，不绕圈、不换侧
      if (modeT0 < 0) modeT0 = t;
      const smooth = (x) => {
        const c = Math.min(1, Math.max(0, x));
        return c * c * (3 - 2 * c);
      };
      const elapsed = t - modeT0;
      const cur = actionAt(elapsed);
      if (!cur) {
        mode = "hover";
        modeT0 = t;
        modeFrom.copy(root.position);
        playAction = "";
        hideScale = 1;
        setExpression("observe");
        nextHoverPlay = 0;
      } else {
        playAction = cur.action;
        const u = cur.u;
        orbitCenter.copy(target).addScaledVector(forward, 1.45);
        bezier
          .copy(orbitCenter)
          .addScaledVector(right, -0.62)
          .addScaledVector(up, -0.28);
        root.position.copy(bezier);
        swimMode = "play";
        swimPitch = 0;
        swimRoll = 0;
        swimYaw = 0;
        hideScale = 1;
        if (playAction === "peek") {
          root.position.addScaledVector(right, Math.sin(Math.PI * u) * 0.12);
          swimYaw = Math.sin(Math.PI * u) * 0.08;
          setExpression("curious");
        } else if (playAction === "wave") {
          setExpression("happy");
        } else if (playAction === "poke") {
          root.position.addScaledVector(right, Math.sin(Math.PI * u) * 0.12);
          swimYaw = Math.sin(Math.PI * u) * 0.1;
          setExpression("excited");
        } else if (playAction === "bounce") {
          root.position.addScaledVector(
            up,
            Math.abs(Math.sin(Math.PI * u)) * 0.09
          );
          setExpression("laugh");
        } else if (playAction === "tilt") {
          swimRoll = Math.sin(u * Math.PI * 2) * 0.16;
          setExpression("think");
        } else if (playAction === "pat") {
          root.position.addScaledVector(right, Math.sin(Math.PI * u) * 0.08);
          swimYaw = Math.sin(Math.PI * u) * 0.08;
          setExpression("happy");
        } else if (playAction === "hide") {
          // 躲到星星后面（左侧），再从左后方探出来
          hidePos
            .copy(target)
            .addScaledVector(forward, 0.85)
            .addScaledVector(right, -0.12);
          peekPos
            .copy(target)
            .addScaledVector(forward, 0.35)
            .addScaledVector(right, -0.58);
          if (u < 0.35) {
            const p = smooth(u / 0.35);
            root.position.lerpVectors(bezier, hidePos, p);
            hideScale = 1 - 0.6 * p;
            setExpression("curious");
          } else if (u < 0.62) {
            root.position.copy(hidePos);
            hideScale = 0.4;
            setExpression("curious");
          } else if (u < 0.82) {
            const p = smooth((u - 0.62) / 0.2);
            root.position.lerpVectors(hidePos, peekPos, p);
            hideScale = 0.4 + 0.6 * p;
            setExpression("surprised");
          } else {
            const p = smooth((u - 0.82) / 0.18);
            root.position.lerpVectors(peekPos, bezier, p);
            hideScale = 1;
            setExpression("happy");
          }
        } else if (playAction === "heart") {
          root.position.addScaledVector(up, Math.sin(Math.PI * u) * 0.03);
          setExpression("love");
        }
      }
    } else if (mode === "brake") {
      // 近距离不绕圈：在星星旁急停，身体后仰、手臂前撑
      if (modeT0 < 0) modeT0 = t;
      const u = Math.min(1, (t - modeT0) / 0.7);
      orbitCenter.copy(target).addScaledVector(forward, 1.45);
      bezier
        .copy(orbitCenter)
        .addScaledVector(right, -0.62)
        .addScaledVector(up, -0.28);
      root.position.copy(bezier);
      root.position.addScaledVector(right, Math.sin(Math.PI * u) * 0.18);
      root.position.addScaledVector(up, -Math.sin(Math.PI * u) * 0.04);
      swimMode = "brake";
      hideScale = 1;
      swimPitch = -0.24 * Math.sin(Math.PI * u);
      swimRoll = 0.06 * Math.sin(Math.PI * 2 * u);
      if (u >= 1) {
        mode = "hover";
        modeT0 = t;
        modeFrom.copy(root.position);
        setExpression("observe");
      }
    } else if (mode === "hover") {
      if (modeT0 < 0) modeT0 = t;
      orbitCenter.copy(target).addScaledVector(forward, 1.45);
      bezier
        .copy(orbitCenter)
        .addScaledVector(right, -0.62)
        .addScaledVector(
          up,
          -0.28 + Math.sin(t * 1.3) * 0.035 + Math.sin(t * 3) * 0.012
        )
        .addScaledVector(forward, Math.sin(t * 2.2) * 0.07);
      const hu = Math.min(1, (t - modeT0) / 0.5);
      const he = hu * hu * (3 - 2 * hu);
      root.position.lerpVectors(modeFrom, bezier, he);
      swimMode = "observe";
      swimRoll = Math.sin(t * 1.6) * 0.02;
      swimPitch = 0;
      swimYaw = 0;
      hideScale = 1;
      // 观察时每隔几秒随机做一个俏皮动作
      if (!nextHoverPlay) nextHoverPlay = t + 6 + Math.random() * 5;
      if (!idle && t > nextHoverPlay) {
        const action = PLAY_POOL[Math.floor(Math.random() * PLAY_POOL.length)];
        playActions = [action];
        playAction = action;
        mode = "play";
        modeT0 = t;
        modeFrom.copy(root.position);
        nextHoverPlay = 0;
      }
    } else if (mode === "return") {
      hideScale = 1;
      if (modeT0 < 0) {
        modeT0 = t;
        modeFrom.copy(root.position);
        // 回家也在屏幕空间插值：相机自转时世界空间 lerp 会跑到画面外
        returnFromNdc.copy(root.position).project(camera);
        // 记录起始景深：缩到最远时本体在分子附近非常小，
        // 若直接钉到 4.2 会瞬间变大；这里让景深从当前值慢慢收到 4.2，
        // 看起来就是从分子那个点一路长大飞回家。
        returnDepth0 = Math.max(
          0.5,
          root.position.clone().sub(camera.position).dot(forward)
        );
      }
      const u = Math.min(1, (t - modeT0) / 0.9);
      const e = u * u * (3 - 2 * u);
      homeNdc.set((px / width) * 2 - 1, 1 - (py / height) * 2, 0.5);
      ndc.set(
        returnFromNdc.x + (homeNdc.x - returnFromNdc.x) * e,
        returnFromNdc.y + (homeNdc.y - returnFromNdc.y) * e,
        0.5
      );
      ndc.unproject(camera).sub(camera.position).normalize();
      // 按“1/景深”（视觉大小）插值，而不是按景深线性插值：
      // 否则从分子旁极小的状态回家时，前 70% 时间几乎看不见，
      // 最后一瞬才突然放大。1/depth 线性会让它一开始就从分子点长出来。
      const inv0 = 1 / Math.max(0.5, returnDepth0);
      const inv1 = 1 / homeDepth;
      const depth = 1 / (inv0 + (inv1 - inv0) * e);
      const homeReach = depth / Math.max(0.15, ndc.dot(forward));
      root.position.copy(camera.position).addScaledVector(ndc, homeReach);
      if (u >= 1) {
        mode = "home";
        setExpression(selected ? "curious" : "idle");
      }
    }

    // 3D 倾斜：基础微侧 + 跟随鼠标的视差
    const kTilt = 1 - Math.exp(-dt * 3.2);
    pointerTilt.x += (pointerTarget.x - pointerTilt.x) * kTilt;
    pointerTilt.y += (pointerTarget.y - pointerTilt.y) * kTilt;
    const pointK = mode === "hover" ? 0.14 : 0.28;
    root.quaternion.copy(camera.quaternion);
    eTilt.set(
      Math.sin(t * 0.72) * 0.045 * calm +
        pointerTilt.y * (mode === "hover" ? 0.1 : 0.16) +
        Math.sin(t * 0.5) * 0.015 +
        swimPitch,
      Math.sin(t * 0.44 + 0.6) * 0.08 * calm +
        pointerTilt.x * pointK +
        0.04 +
        swimYaw,
      Math.sin(t * 0.6) * 0.025 * calm +
        bank +
        swimRoll +
        (homeAction === "tilt" ? Math.sin(homeU * Math.PI * 2) * 0.16 : 0)
    );
    qTilt.setFromEuler(eTilt);
    root.quaternion.multiply(qTilt);

    // 未选中：固定屏幕尺寸；选中：固定世界尺寸，由透视负责远近缩放
    const isHome = mode === "home" || mode === "return";
    // 非首页时原来 ±3% / 5.2Hz 的“呼吸”在透视缩放下容易被看成颤动，收敛一半
    const pulse =
      1 +
      (isHome ? 0.006 : 0.016) * Math.sin(t * (isHome ? 1.6 : 3.2));
    const targetScale =
      (isHome ? homeScale : baseScale * SEL_SCALE) * pulse * hideScale;
    const s = root.scale.x + (targetScale - root.scale.x) * Math.min(1, dt * 6);
    root.scale.setScalar(s);

    // 比心时头顶的小爱心
    const heartsOn =
      (mode === "play" && playAction === "heart") ||
      (mode === "home" && homeAction === "heart");
    heartSprite.visible = heartsOn;
    if (heartsOn) {
      const hs = 0.12 + 0.024 * Math.sin(t * 7.5);
      heartSprite.scale.setScalar(hs);
      heartSprite.material.opacity = 0.55 + 0.25 * Math.sin(t * 6);
    }

    // 手臂：两节关节 + 手腕；飞行/绕星时切换成游泳划水
    applyArmPose(dt, t, (side) =>
      swimMode === "swim"
        ? swimPose(side, t)
        : swimMode === "play"
          ? playPose(playAction, side, t)
          : swimMode === "brake"
            ? brakePose(side, t)
            : swimMode === "observe"
              ? observePose(side, t)
              : armPose(expression, side, t)
    );
    ring.rotation.z = Math.sin(t * 0.37) * (reduceMotion ? 0.01 : 0.028);
    const squash =
      swimMode === "none" ? 1 : 1 + 0.025 * Math.sin(t * 5.2);
    ring.scale.set(1 / Math.sqrt(squash), squash, 1);

    // 眼睛跟随选中的星
    if (selected) {
      ndc.copy(selected).project(camera);
      const cx = -0.6;
      const cy = -0.55;
      const dx = ndc.x - cx;
      const dy = -(ndc.y - cy);
      const len = Math.hypot(dx, dy) || 1;
      setLook(dx / len, dy / len);
    }

    // 眨眼（闭眼表情不重复眨）
    if (!reduceMotion && !CLOSED_EYES.has(expression)) {
      if (!nextBlink) nextBlink = t + 1.5 + Math.random() * 3.2;
      if (t > nextBlink && !blinking) {
        blinking = true;
        repaint();
        setTimeout(() => {
          if (!blinking) return;
          blinking = false;
          repaint();
          nextBlink = t + 2.4 + Math.random() * 3.6;
        }, 110);
      }
    }

    // 待机时偶尔换个表情，展示一下
    if (!reduceMotion && mode === "home" && !idle && expression === "idle") {
      if (t > nextMood) {
        const pool = ["happy", "curious", "wink", "laugh", "excited", "shy"];
        moodExpr = pool[Math.floor(Math.random() * pool.length)];
        setExpression(moodExpr);
        moodUntil = t + 1.7;
        nextMood = t + 8 + Math.random() * 5;
      }
    }
    if (moodExpr && t > moodUntil) {
      if (expression === moodExpr) setExpression("idle");
      moodExpr = "";
    }

    if (idle && mode === "home" && !homeAction && expression !== "doze") {
      setExpression("doze");
    } else if ((!idle || homeAction) && expression === "doze") {
      setExpression(
        homeAction ? actionExpression(homeAction) : selected ? "curious" : "idle"
      );
    }

    if (mode === "travel" || document.body.classList.contains("idle")) {
      hideMenu();
    }
    placeMenu();
  }

  // 调试入口：截图/验收脚本可直接切表情
  if (typeof window !== "undefined") {
    window.__companion = {
      show,
      hide,
      setExpression,
      onSelect,
      faceCanvas: face.canvas,
      expressions: EXPRESSIONS,
      get visible() {
        return visible;
      },
      get expression() {
        return expression;
      },
      get mode() {
        return mode;
      },
      get guide() {
        return {
          active: guideActive,
          index: guideIndex,
          step: guideSteps[guideIndex] || null,
        };
      },
      get playActions() {
        return playActions.slice();
      },
      play(name) {
        if (!visible || !name) return;
        playActions = [name];
        playAction = name;
        mode = "play";
        modeT0 = -1;
        modeFrom.copy(root.position);
      },
      toyPlay(name) {
        if (!idleToyViewer || !name) return;
        toyAction = name;
        toyT0 = -1;
        toyNext = 0;
      },
      screen() {
        if (!lastCamera) return null;
        const v = root.position.clone().project(lastCamera);
        const dist = lastCamera.position.distanceTo(root.position);
        return {
          x: Math.round(((v.x + 1) / 2) * window.innerWidth),
          y: Math.round(((1 - v.y) / 2) * window.innerHeight),
          z: v.z,
          scale: root.scale.x,
          dist: +dist.toFixed(2),
          apparent: +(root.scale.x / dist).toFixed(3),
          ndc: [v.x.toFixed(2), v.y.toFixed(2)],
          pos: root.position.toArray().map((n) => n.toFixed(2)),
          cam: lastCamera.position.toArray().map((n) => n.toFixed(2)),
          fov: lastCamera.fov,
          aspect: lastCamera.aspect,
          size: lastSize,
        };
      },
    };
  }

  return {
    group: root,
    show,
    hide,
    setExpression,
    setLook,
    onSelect,
    update,
    startGuide,
    stopGuide,
    isGuiding,
    hitTest,
    showMenu,
    hideMenu,
    isMenuOpen: () => menuOpen,
    enterIdleToy,
    exitIdleToy,
    isIdleToy,
    updateIdleToy,
    get visible() {
      return visible;
    },
  };
}
