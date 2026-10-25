/**
 * 待机介绍里的轻量 3D 球棍分子。
 *
 * - 独立 WebGL renderer，嵌在结构式分区里
 * - 拖动旋转 / 滚轮缩放，但整个视口标记为 data-idle-interactive，
 *   不会触发世界树的待机退出；点击视口外才退出
 * - 数据缺失时由 IdleIntro 回退到 2D SVG
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const ELEMENT_STYLE = {
  C: { color: 0xd8e8d4, radius: 0.28 },
  N: { color: 0x8ab4ff, radius: 0.30 },
  O: { color: 0xff8a7a, radius: 0.29 },
  S: { color: 0xffd166, radius: 0.35 },
  P: { color: 0xffb066, radius: 0.33 },
  F: { color: 0x9fe0b2, radius: 0.27 },
  Cl: { color: 0x7fe08a, radius: 0.32 },
  Br: { color: 0xe0a07a, radius: 0.35 },
  I: { color: 0xc79ae0, radius: 0.38 },
  B: { color: 0xf0b8a0, radius: 0.30 },
  Si: { color: 0xc8c8a8, radius: 0.34 },
};

const DEFAULT_STYLE = { color: 0xbdd8c4, radius: 0.28 };
const UP = new THREE.Vector3(0, 1, 0);
const REF = new THREE.Vector3(0, 1, 0);

function styleFor(el) {
  return ELEMENT_STYLE[el] || DEFAULT_STYLE;
}

function disposeGroup(group) {
  const geos = new Set();
  const mats = new Set();
  group.traverse((obj) => {
    if (obj.geometry) geos.add(obj.geometry);
    const m = obj.material;
    if (Array.isArray(m)) m.forEach((x) => mats.add(x));
    else if (m) mats.add(m);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}

export function createMoleculeViewer() {
  const host = document.createElement("div");
  host.className = "molecule-3d";
  host.dataset.idleInteractive = "";
  host.setAttribute("aria-label", "三维分子结构，可拖动旋转、滚轮缩放");

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "molecule-3d-canvas";
  host.appendChild(renderer.domElement);

  const hint = document.createElement("span");
  hint.className = "molecule-3d-hint";
  hint.textContent = "拖动旋转 · 滚轮缩放";
  host.appendChild(hint);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.8;
  controls.autoRotateSpeed = 0.9;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = Math.PI - 0.18;

  scene.add(new THREE.AmbientLight(0xe8f5e8, 1.6));
  const keyLight = new THREE.DirectionalLight(0xfff0cf, 2.6);
  keyLight.position.set(3.5, 5, 6);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x8fe0b0, 1.25);
  fillLight.position.set(-5, -2, 3);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0x8ab4ff, 1.1);
  rimLight.position.set(0, -4, -5);
  scene.add(rimLight);

  const root = new THREE.Group();
  scene.add(root);

  let visible = false;
  let raf = 0;
  let currentKey = "";
  let moleculeGroup = null;
  let resumeTimer = 0;
  let lastFit = { maxXZ: 4, maxY: 4 };

  function clearMolecule() {
    if (!moleculeGroup) return;
    root.remove(moleculeGroup);
    disposeGroup(moleculeGroup);
    moleculeGroup = null;
  }

  function fitCamera(fit, aspect) {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const tanV = Math.tan(vFov / 2);
    const tanH = tanV * Math.max(aspect, 0.2);
    const maxXZ = fit.maxXZ || 4;
    const maxY = fit.maxY || 4;
    // 横向分子按屏幕宽度取景，避免用包围球把长链缩得很小
    const dist = Math.max(maxXZ / tanH, maxY / tanV) * 1.24 + 0.5;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.minDistance = dist * 0.45;
    controls.maxDistance = dist * 2.1;
    controls.update();
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w < 2 || h < 2) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function build(data) {
    clearMolecule();
    const atoms = data.a || [];
    const coords = data.c || [];
    const bonds = data.b || [];
    const n = atoms.length;
    if (!n) return;

    // 中心化 + 半径
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += coords[i * 3];
      cy += coords[i * 3 + 1];
      cz += coords[i * 3 + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    const pos = new Float32Array(n * 3);
    let maxXZ = 0;
    let maxY = 0;
    for (let i = 0; i < n; i++) {
      const x = coords[i * 3] - cx;
      const y = coords[i * 3 + 1] - cy;
      const z = coords[i * 3 + 2] - cz;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      maxXZ = Math.max(maxXZ, Math.hypot(x, z));
      maxY = Math.max(maxY, Math.abs(y));
    }
    lastFit = { maxXZ: maxXZ + 0.55, maxY: maxY + 0.55 };

    moleculeGroup = new THREE.Group();
    root.add(moleculeGroup);

    const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
    const atomMats = new Map();
    const bondMat = new THREE.MeshStandardMaterial({
      color: 0xaecdb5,
      roughness: 0.5,
      metalness: 0.1,
    });
    moleculeGroup.userData = { sphereGeo, cylGeo, bondMat, atomMats };

    // bonds first, atoms on top
    for (const b of bonds) {
      const i = b[0] | 0;
      const j = b[1] | 0;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const order = Number(b[2]) || 1;
      const p1 = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const p2 = new THREE.Vector3(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      if (len < 1e-4) continue;
      const quat = new THREE.Quaternion().setFromUnitVectors(
        UP,
        dir.clone().normalize()
      );
      const ref = Math.abs(dir.clone().normalize().dot(REF)) > 0.92
        ? new THREE.Vector3(1, 0, 0)
        : REF;
      const perp = new THREE.Vector3()
        .crossVectors(dir, ref)
        .normalize()
        .multiplyScalar(1);

      const offsets =
        order >= 3
          ? [-0.105, 0, 0.105]
          : order >= 1.45
            ? [-0.075, 0.075]
            : [0];
      const r = order >= 3 ? 0.032 : order >= 1.45 ? 0.036 : 0.055;
      for (const off of offsets) {
        const mesh = new THREE.Mesh(cylGeo, bondMat);
        mesh.position
          .copy(p1)
          .add(p2)
          .multiplyScalar(0.5)
          .addScaledVector(perp, off);
        mesh.quaternion.copy(quat);
        mesh.scale.set(r, len, r);
        moleculeGroup.add(mesh);
      }
    }

    for (let i = 0; i < n; i++) {
      const el = atoms[i] || "C";
      const st = styleFor(el);
      let mat = atomMats.get(el);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: st.color,
          roughness: 0.34,
          metalness: 0.16,
          emissive: st.color,
          emissiveIntensity: 0.08,
        });
        atomMats.set(el, mat);
      }
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      mesh.scale.setScalar(st.radius);
      moleculeGroup.add(mesh);
    }

    fitCamera(lastFit, camera.aspect);
  }

  function loop() {
    if (!visible) return;
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }

  function play() {
    if (visible) return;
    visible = true;
    controls.autoRotate = true;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function show(data, key = "") {
    host.hidden = false;
    if (moleculeGroup && key && key === currentKey) {
      play();
    } else {
      currentKey = key;
      resize();
      build(data);
      play();
    }
    // 刚插入 DOM 时尺寸可能还是 0，下一帧再按真实宽高取景
    requestAnimationFrame(() => {
      if (!visible) return;
      resize();
      fitCamera(lastFit, camera.aspect);
    });
  }

  function hide() {
    visible = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = 0;
    }
    controls.autoRotate = false;
    host.hidden = true;
  }

  function destroy() {
    hide();
    clearMolecule();
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    if (host.parentNode) host.parentNode.removeChild(host);
  }

  // 这个区域内的指针/滚轮/触摸不冒泡到世界树的 idle 退出逻辑
  for (const type of ["pointerdown", "touchstart", "wheel"]) {
    host.addEventListener(type, (e) => e.stopPropagation(), {
      passive: true,
    });
  }
  // 拖出视口后仍归 3D 控制器
  renderer.domElement.addEventListener("pointerdown", (e) => {
    try {
      renderer.domElement.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  controls.addEventListener("start", () => {
    controls.autoRotate = false;
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = 0;
    }
  });
  controls.addEventListener("end", () => {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => {
      if (visible) controls.autoRotate = true;
    }, 2600);
  });

  const ro = new ResizeObserver(() => {
    if (host.hidden) return;
    resize();
  });
  ro.observe(host);

  return { host, show, hide, resize, destroy };
}
