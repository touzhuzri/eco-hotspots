import { getMoleculeMeta } from "../engine/moleculeMeta.js";
import { getMolecule3D } from "../engine/molecule3d.js";
import {
  classInfoFor,
  ecologyText,
  familyInfoFor,
} from "../data/taxonomyInfo.js";
import { renderSmilesToSvg } from "./smilesRender.js";
import { createMoleculeViewer } from "./MoleculeViewer.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleFor(p, meta) {
  const raw = meta?.name || p.nameZh || p.nameEn || "未命名天然产物";
  const ci = classInfoFor(meta);
  if (raw.length > 46 && (ci.zh || p.organismZh)) {
    return `${ci.zh}${p.organismZh ? ` · ${p.organismZh}` : ""}`;
  }
  return raw;
}

function introFor(p, meta) {
  const ci = classInfoFor(meta);
  const famInfo = familyInfoFor(meta?.family);
  const fam = famInfo?.zh || meta?.family || "";
  const org = p.organismZh || "来源物种未标注";
  const where = fam ? `${org}（${fam}）` : org;
  const formula = meta?.formula ? `，分子式为 ${meta.formula}` : "";
  const parts = [];
  // 把来源、类别、分子式并进正文，名字区只留名字，正文区全部是连续文字
  parts.push(`LOTUS 在${where}中记录到这种${ci.zh}${formula}。`);
  if (ci.text) parts.push(ci.text);
  if (famInfo?.text) parts.push(famInfo.text);
  parts.push(ecologyText(p.kingdom, p.layer));
  return parts.join("");
}

export function mountIdleIntro(el) {
  if (!el) return;
  let token = 0;
  let renderSeq = 0;
  let viewer = null;

  function ensureViewer() {
    if (!viewer) viewer = createMoleculeViewer();
    return viewer;
  }

  function setStructureBadge(text) {
    const em = el.querySelector(".idle-structure-head em");
    if (em) em.textContent = text;
  }

  function hide() {
    token++;
    renderSeq++;
    el.classList.remove("is-on");
    el.setAttribute("aria-hidden", "true");
    viewer?.hide();
    const svg = el.querySelector(".idle-callouts");
    if (svg) svg.innerHTML = "";
    window.setTimeout(() => {
      if (!el.classList.contains("is-on")) el.hidden = true;
    }, 700);
  }

  /** 竖排正文按可用高度自动收字号，避免长介绍被横向裁掉 */
  function fitIntro() {
    const t = el.querySelector(".idle-vertical");
    if (!t || !t.clientWidth) return;
    t.style.fontSize = "";
    let font = parseFloat(getComputedStyle(t).fontSize) || 16;
    let guard = 0;
    while (
      (t.scrollWidth > t.clientWidth ||
        t.scrollHeight > t.clientHeight + 1) &&
      font > 13.5 &&
      guard++ < 24
    ) {
      font -= 0.4;
      t.style.fontSize = `${font}px`;
    }
  }

  /** 去掉 RDKit SVG 的空白边，让结构式在扁长分区里尽量清晰、尽量大 */
  function fitStructureSvg(svg) {
    if (!svg) return;
    // RDKit 默认输出一张覆盖整幅画布的底色 rect，先去掉
    for (const r of svg.querySelectorAll("rect")) {
      const w = parseFloat(r.getAttribute("width") || "0");
      const h = parseFloat(r.getAttribute("height") || "0");
      const vb = svg.viewBox?.baseVal;
      const bw = vb?.width || w;
      const bh = vb?.height || h;
      if (w >= bw * 0.9 && h >= bh * 0.9) r.remove();
    }
    let box = null;
    try {
      box = svg.getBBox();
    } catch (_) {
      return;
    }
    if (!box || box.width <= 0 || box.height <= 0) return;
    const pad = Math.max(1.5, Math.max(box.width, box.height) * 0.035);
    svg.setAttribute(
      "viewBox",
      `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${
        box.height + pad * 2
      }`
    );
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
  }

  /** 从钟表边缘引出三条折线，指向名字 / 结构式 / 简介 */
  function drawCallouts() {
    const svg = el.querySelector(".idle-callouts");
    const card = el.querySelector(".idle-intro-card");
    if (!svg || !card || el.hidden || window.innerWidth <= 900) {
      if (svg) svg.innerHTML = "";
      return;
    }
    const cr = card.getBoundingClientRect();
    if (cr.width < 20) return;
    const nameEl = el.querySelector(".idle-name");
    const structEl = el.querySelector(".idle-structure-block");
    const introEl = el.querySelector(".idle-vertical-wrap");
    if (!nameEl || !structEl || !introEl) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);

    const nr = nameEl.getBoundingClientRect();
    const sr = structEl.getBoundingClientRect();
    const ir = introEl.getBoundingClientRect();
    const startX = cr.left - Math.min(120, Math.max(56, cr.left * 0.1));
    const elbowX = cr.left - 26;
    const endX = cr.left - 3;
    const starts = [0.3, 0.5, 0.72].map((f) => cr.top + cr.height * f);
    const targets = [
      nr.top + nr.height * 0.55,
      sr.top + sr.height * 0.52,
      ir.top + ir.height * 0.56,
    ];

    let markup = "";
    for (let i = 0; i < 3; i++) {
      const sy = Math.max(cr.top + 24, Math.min(cr.bottom - 24, starts[i]));
      const ey = Math.max(cr.top + 16, Math.min(cr.bottom - 16, targets[i]));
      markup += `<path d="M ${startX} ${sy} H ${elbowX} V ${ey} H ${endX}" />`;
      markup += `<circle cx="${startX}" cy="${sy}" r="1.5" />`;
      markup += `<circle cx="${endX}" cy="${ey}" r="2.1" />`;
    }
    svg.innerHTML = markup;
  }

  window.addEventListener("resize", () => {
    if (!el.classList.contains("is-on")) return;
    fitIntro();
    drawCallouts();
  });

  function render(p, meta) {
    const raw = meta?.name || p.nameZh || p.nameEn || "";
    const title = titleFor(p, meta);
    const smiles = meta?.smiles || "";
    const intro = introFor(p, meta);
    const seq = ++renderSeq;

    el.innerHTML = `
      <svg class="idle-callouts" aria-hidden="true"></svg>
      <div class="idle-intro-card">
        <div class="idle-slips" aria-hidden="true">${Array.from(
          { length: 9 },
          (_, i) => `<span style="--i:${i}"></span>`
        ).join("")}</div>
        <div class="idle-ink" aria-hidden="true"></div>
        <div class="idle-intro-content">
          <header class="idle-head">
            <p class="idle-kicker">LOTUS · 待机分子</p>
            <div class="idle-name-row">
              <span class="idle-section-label">名称</span>
              <h2 class="idle-name" title="${esc(raw || title)}">${esc(title)}</h2>
            </div>
          </header>

          <section class="idle-structure-block">
            <div class="idle-structure-head">
              <span class="idle-section-label">结构式</span>
              <em>SMILES · 2D 结构</em>
            </div>
            <div class="idle-structure-frame" id="idleStructure">
              <span>${smiles ? "结构式生成中…" : "SMILES 暂缺"}</span>
            </div>
          </section>

          <div class="idle-vertical-wrap">
            <span class="idle-section-label">简介</span>
            <div class="idle-vertical" data-text="${esc(intro)}" lang="zh-CN">${esc(
              intro
            )}</div>
          </div>
        </div>
      </div>`;

    // 新的介绍卡已经替换掉旧的 3D 宿主；先停掉上一份的渲染循环
    viewer?.hide();

    requestAnimationFrame(() => {
      fitIntro();
      drawCallouts();
    });

    function render2D() {
      if (!smiles) return;
      renderSmilesToSvg(smiles)
        .then((svgMarkup) => {
          if (seq !== renderSeq || !el.isConnected) return;
          const slot = el.querySelector("#idleStructure");
          if (!slot) return;
          viewer?.hide();
          setStructureBadge("SMILES · 2D 结构");
          slot.innerHTML = svgMarkup;
          const svg = slot.querySelector("svg");
          if (svg) {
            svg.classList.add("idle-structure-svg");
            fitStructureSvg(svg);
            requestAnimationFrame(drawCallouts);
          }
        })
        .catch(() => {
          if (seq !== renderSeq) return;
          const slot = el.querySelector("#idleStructure");
          if (slot) slot.innerHTML = `<span>${esc(smiles)}</span>`;
        });
    }

    if (!p.inchikey) {
      render2D();
      return;
    }
    getMolecule3D(p.inchikey)
      .then((rec) => {
        if (seq !== renderSeq || !el.isConnected) return;
        if (!rec) {
          render2D();
          return;
        }
        const slot = el.querySelector("#idleStructure");
        if (!slot) return;
        const v = ensureViewer();
        slot.innerHTML = "";
        slot.appendChild(v.host);
        v.show(rec, p.inchikey);
        setStructureBadge("3D · 球棍模型");
        requestAnimationFrame(drawCallouts);
      })
      .catch(() => {
        if (seq !== renderSeq) return;
        render2D();
      });
  }

  function show(point) {
    if (!point) return;
    const my = ++token;
    el.hidden = false;
    render(point, null);
    el.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => el.classList.add("is-on"));

    if (point.inchikey) {
      getMoleculeMeta(point.inchikey).then((meta) => {
        if (my !== token || !meta) return;
        render(point, meta);
      });
    }
  }

  window.addEventListener("eco:idle-intro", (e) => {
    show(e.detail?.point);
  });
  window.addEventListener("eco:idle-intro-hide", hide);

  return { show, hide };
}
