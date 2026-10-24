import { getMoleculeMeta } from "../engine/moleculeMeta.js";
import { classInfoFor, familyInfoFor } from "../data/taxonomyInfo.js";
import { renderSmilesToStarCanvas } from "./smilesRender.js";

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
  const fam = meta?.family
    ? familyInfoFor(meta.family)?.zh || meta.family
    : "";
  const org = p.organismZh || "来源物种未标注";
  const origin = fam
    ? p.kingdom === "植物"
      ? `${fam}植物`
      : fam
    : org;
  const parts = [];
  parts.push(`由${origin}产生的${ci.zh}。`);
  if (ci.text) parts.push(ci.text);
  return parts.join("");
}

export function mountIdleIntro(el) {
  if (!el) return;
  let token = 0;
  let renderSeq = 0;

  function hide() {
    token++;
    el.classList.remove("is-on");
    el.setAttribute("aria-hidden", "true");
    const svg = el.querySelector(".idle-callouts");
    if (svg) svg.innerHTML = "";
    window.setTimeout(() => {
      if (!el.classList.contains("is-on")) el.hidden = true;
    }, 700);
  }

  /** 从钟表边缘引出几条折线，指向名字 / 结构式 / 竖排简介 */
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
    const structureEl = el.querySelector(".idle-structure-label");
    const introEl = el.querySelector(".idle-vertical-wrap");
    if (!nameEl || !structureEl || !introEl) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);

    const nr = nameEl.getBoundingClientRect();
    const sr = structureEl.getBoundingClientRect();
    const ir = introEl.getBoundingClientRect();
    const startX = cr.left - Math.min(120, Math.max(56, cr.left * 0.1));
    const elbowX = cr.left - 26;
    const endX = cr.left - 3;
    const starts = [0.34, 0.52, 0.7].map((f) => cr.top + cr.height * f);
    const targets = [
      nr.top + nr.height * 0.55,
      sr.top + sr.height * 0.5,
      ir.top + ir.height * 0.55,
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
    if (el.classList.contains("is-on")) drawCallouts();
  });

  function render(p, meta) {
    const ci = classInfoFor(meta);
    const raw = meta?.name || p.nameZh || p.nameEn || "";
    const title = titleFor(p, meta);
    const formula = meta?.formula || "";
    const smiles = meta?.smiles || "";
    const metaLine = [ci.zh, p.organismZh, p.kingdom, p.layer]
      .filter(Boolean)
      .join(" · ");
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
        <div class="idle-constellation" id="idleStructure">
          <span>${smiles ? "星点星座生成中…" : "SMILES 暂缺"}</span>
        </div>
        <div class="idle-intro-content">
          <p class="idle-kicker">LOTUS · 待机分子</p>
          <div class="idle-name-row">
            <span class="idle-section-label">名称</span>
            <h2 class="idle-name" title="${esc(raw || title)}">${esc(title)}</h2>
          </div>
          <p class="idle-meta">${esc(metaLine || "来源未标注")}${
            formula ? ` · ${esc(formula)}` : ""
          }</p>
          <span class="idle-section-label idle-structure-label">结构式 · SMILES 星座</span>
          <div class="idle-vertical-wrap">
            <span class="idle-section-label">简介</span>
            <div class="idle-vertical" data-text="${esc(intro)}" lang="zh-CN">${esc(
              intro
            )}</div>
          </div>
          <p class="idle-hint">轻触返回 · 将自动回到这颗分子</p>
        </div>
      </div>`;

    requestAnimationFrame(drawCallouts);
    if (!smiles) return;
    renderSmilesToStarCanvas(smiles, {
      width: 720,
      height: 400,
      maxPoints: 6200,
    })
      .then((canvas) => {
        if (seq !== renderSeq || !el.isConnected) return;
        const slot = el.querySelector("#idleStructure");
        if (!slot) return;
        slot.innerHTML = "";
        slot.appendChild(canvas);
        canvas.className = "idle-star-canvas";
        requestAnimationFrame(drawCallouts);
      })
      .catch(() => {
        if (seq !== renderSeq) return;
        const slot = el.querySelector("#idleStructure");
        if (slot) slot.innerHTML = `<span>${esc(smiles)}</span>`;
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
