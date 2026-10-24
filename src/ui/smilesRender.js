/**
 * 懒加载 RDKit.js，把 SMILES 渲染成 SVG。
 * 只有在用户展开结构式时才会加载脚本与 7MB WASM。
 */

let scriptPromise = null;
let rdkitPromise = null;

function loadRdkitScript() {
  if (window.initRDKitModule) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("vendor/rdkit/RDKit_minimal.js", location.href).href;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("RDKit 脚本加载失败"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function getRdkit() {
  if (!rdkitPromise) {
    rdkitPromise = (async () => {
      await loadRdkitScript();
      if (typeof window.initRDKitModule !== "function") {
        throw new Error("RDKit 初始化入口不可用");
      }
      return window.initRDKitModule({
        locateFile: (file) =>
          new URL(`vendor/rdkit/${file}`, location.href).href,
      });
    })().catch((err) => {
      // 失败后允许再次尝试
      rdkitPromise = null;
      scriptPromise = null;
      throw err;
    });
  }
  return rdkitPromise;
}

/**
 * @param {string} smiles
 * @returns {Promise<string>} SVG markup
 */
export async function renderSmilesToSvg(smiles) {
  if (!smiles) throw new Error("没有可用的 SMILES");
  const rdkit = await getRdkit();
  const mol = rdkit.get_mol(smiles);
  if (!mol) throw new Error("SMILES 解析失败");
  try {
    let svg = mol.get_svg();
    if (!svg) throw new Error("结构渲染为空");
    // 去掉 XML 声明，避免 innerHTML 里出现多根节点
    svg = svg.replace(/^<\?xml[^>]*\?>\s*/, "");
    // 把 RDKit 默认的白底黑线改成暗底亮线，融入介绍卡
    svg = svg
      .replace(/#FFFFFF/gi, "#0b1410")
      .replace(/#000000/gi, "#d6e8da")
      .replace(/#FF0000/gi, "#ff8a7a")
      .replace(/#0000FF/gi, "#8ab4ff")
      .replace(/#CCCC00/gi, "#e8e06a")
      .replace(/#FF8000/gi, "#ffb066")
      .replace(/#00CC00/gi, "#7fe08a")
      .replace(/#CC00CC/gi, "#e08ae0")
      .replace(/#00CCCC/gi, "#7fe0e0");
    return svg;
  } finally {
    try {
      mol.delete();
    } catch (_) {}
  }
}

/**
 * 把 RDKit 的 2D 结构描边栅格化，再按亮度采样成“光星点”画布。
 * 用于待机竹简里的 2D 分子星图。
 */
export async function renderSmilesToStarCanvas(
  smiles,
  { width = 380, height = 460, maxPoints = 5200 } = {}
) {
  const svg = await renderSmilesToSvg(smiles);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("结构 SVG 栅格化失败"));
    im.src = url;
  }).finally(() => {
    // 图片解码后即可释放 URL（Image 已持有像素）
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  const ctx = src.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#0b1410";
  ctx.fillRect(0, 0, width, height);

  const iw = img.naturalWidth || 300;
  const ih = img.naturalHeight || 300;
  const pad = 0.03;
  const scale = Math.min(
    (width * (1 - pad * 2)) / iw,
    (height * (1 - pad * 2)) / ih
  );
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);

  const data = ctx.getImageData(0, 0, width, height).data;
  const points = [];
  const stride = 2;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const o = (y * width + x) * 4;
      const a = data[o + 3] / 255;
      if (a < 0.1) continue;
      let r = data[o];
      let g = data[o + 1];
      let b = data[o + 2];
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (lum < 0.24) continue;
      // 中性白键线染一点竹青/淡金，保留杂原子颜色
      if (Math.max(r, g, b) - Math.min(r, g, b) < 26) {
        r = Math.min(255, r * 0.7 + 20);
        g = Math.min(255, g * 0.88 + 14);
        b = Math.min(255, b * 0.66 + 12);
      }
      points.push({ x, y, r, g, b, lum });
    }
  }

  let picked = points;
  if (points.length > maxPoints) {
    picked = [];
    const step = points.length / maxPoints;
    for (let i = 0; i < maxPoints; i++) {
      picked.push(points[Math.floor(i * step)]);
    }
  }

  // 透明画布 + 加法辉光
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const octx = out.getContext("2d");
  octx.clearRect(0, 0, width, height);
  octx.globalCompositeOperation = "lighter";
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const p of picked) {
    const jx = p.x + (rnd() - 0.5) * 1.8;
    const jy = p.y + (rnd() - 0.5) * 1.8;
    const core = 0.45 + p.lum * 0.65 + rnd() * 0.25;
    // 外圈柔光
    octx.fillStyle = `rgba(${p.r},${p.g},${p.b},${0.06 + p.lum * 0.08})`;
    octx.beginPath();
    octx.arc(jx, jy, core * 3.2, 0, Math.PI * 2);
    octx.fill();
    // 星核
    octx.fillStyle = `rgba(${p.r},${p.g},${p.b},${0.58 + p.lum * 0.32})`;
    octx.beginPath();
    octx.arc(jx, jy, core, 0, Math.PI * 2);
    octx.fill();
  }
  return out;
}

export function resetSmilesRenderer() {
  rdkitPromise = null;
  scriptPromise = null;
}
