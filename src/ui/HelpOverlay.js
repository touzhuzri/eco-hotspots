/** 首次引导 / 关于数据。 */

const TOUR_KEY = "eco-tour-seen-v1";

const STEPS = [
  {
    title: "这是一棵天然产物世界树",
    body: "每一颗星都是一个来自 LOTUS 的天然产物结构。树层对应来源生物的生态位置：天空、冠层、树干、根际与土壤。拖动旋转，滚轮飞近。",
  },
  {
    title: "从左边开始探索",
    body: "左侧探索栏可以搜索、按类群/层位/化学分类筛选，也可以随机漫游、看看今日分子。底栏可以快速飞到冠层或根系。",
  },
  {
    title: "点开一颗分子",
    body: "悬停看名称，点击打开介绍卡。卡里有结构式、SMILES、分子式、分类、来源物种和生态说明；展开结构式会先在浏览器里计算渲染。",
  },
  {
    title: "数据来自 LOTUS",
    body: "本页只使用 LOTUS frozen 260413（CC0）的结构–物种关联与注释，不包含实验活性或用途数据。把一颗星领养下来，也可以留下名字或保持神秘。",
  },
];

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mountOverlay(html) {
  const overlay = document.createElement("div");
  overlay.className = "help-overlay";
  overlay.innerHTML = `<div class="help-dialog" role="dialog" aria-modal="true">${html}</div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return { overlay, close };
}

export function openTour(onDone) {
  let step = 0;
  const { overlay, close } = mountOverlay(`
    <span class="help-kicker">世界树 · 使用引导</span>
    <div id="tourBody"></div>
    <div class="help-actions">
      <button type="button" class="help-ghost" id="tourSkip">跳过</button>
      <button type="button" class="help-ghost" id="tourPrev">上一步</button>
      <button type="button" class="help-primary" id="tourNext">下一步</button>
    </div>
  `);

  function paint() {
    const s = STEPS[step];
    overlay.querySelector("#tourBody").innerHTML = `
      <h2>${esc(s.title)}</h2>
      <p>${esc(s.body)}</p>
      <div class="help-progress">${STEPS.map(
        (_, i) => `<span class="${i === step ? "on" : ""}"></span>`
      ).join("")}</div>
    `;
    overlay.querySelector("#tourPrev").disabled = step === 0;
    overlay.querySelector("#tourNext").textContent =
      step === STEPS.length - 1 ? "开始探索" : "下一步";
  }

  function finish() {
    try {
      localStorage.setItem(TOUR_KEY, "1");
    } catch (_) {}
    close();
    onDone?.();
  }

  overlay.querySelector("#tourSkip").addEventListener("click", finish);
  overlay.querySelector("#tourNext").addEventListener("click", () => {
    if (step >= STEPS.length - 1) finish();
    else {
      step++;
      paint();
    }
  });
  overlay.querySelector("#tourPrev").addEventListener("click", () => {
    if (step > 0) {
      step--;
      paint();
    }
  });
  paint();
}

export function openAbout() {
  const { overlay } = mountOverlay(`
    <span class="help-kicker">关于数据</span>
    <h2>只基于 LOTUS 的天然产物世界树</h2>
    <p>结构、来源物种、分子式、NPClassifier/ClassyFire 分类、DOI、PubChem CID 与 Wikidata 标识来自 <strong>LOTUS frozen 260413</strong>（CC0）。</p>
    <p>结构描述符（环数、芳香环、氢键供体/受体、TPSA、XLogP 等）由 RDKit 在构建阶段计算；2D 结构图在浏览器内按需用 RDKit.js 渲染。</p>
    <p>LOTUS 不包含实验活性、毒理或用途数据，因此本页的“特性与用途”是分类层面与来源语境的科普性说明，不构成用药、农药或安全建议。</p>
    <p>分子领养只保存公开显示名、分子 key、时间与 visitor token 的哈希；不保存 IP、UA 或邮箱。名字可留空显示为「神秘用户」。</p>
    <div class="help-actions">
      <button type="button" class="help-primary" id="aboutClose">知道了</button>
    </div>
  `);
  overlay.querySelector("#aboutClose").addEventListener("click", () => {
    overlay.remove();
  });
}

export function maybeShowTour() {
  let seen = false;
  try {
    seen = localStorage.getItem(TOUR_KEY) === "1";
  } catch (_) {}
  if (!seen) {
    setTimeout(() => openTour(), 1200);
  }
}
