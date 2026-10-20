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

export function resetSmilesRenderer() {
  rdkitPromise = null;
  scriptPromise = null;
}
