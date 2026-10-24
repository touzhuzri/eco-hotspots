import { getMoleculeMeta } from "../engine/moleculeMeta.js";
import {
  classInfoFor,
  familyInfoFor,
  ecologyText,
} from "../data/taxonomyInfo.js";

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
  parts.push(ecologyText(p.kingdom, p.layer));
  return parts.join("");
}

export function mountIdleIntro(el) {
  if (!el) return;
  let token = 0;

  function hide() {
    token++;
    el.classList.remove("is-on");
    el.setAttribute("aria-hidden", "true");
    window.setTimeout(() => {
      if (!el.classList.contains("is-on")) el.hidden = true;
    }, 700);
  }

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

    el.innerHTML = `
      <div class="idle-intro-card">
        <div class="idle-slips" aria-hidden="true">${Array.from(
          { length: 9 },
          (_, i) => `<span style="--i:${i}"></span>`
        ).join("")}</div>
        <div class="idle-ink" aria-hidden="true"></div>
        <div class="idle-intro-content">
          <p class="idle-kicker">LOTUS · 待机分子</p>
          <h2 class="idle-name" title="${esc(raw || title)}">${esc(title)}</h2>
          <p class="idle-meta">${esc(metaLine || "来源未标注")}${
            formula ? ` · ${esc(formula)}` : ""
          }</p>
          <div class="idle-smiles">
            <span>SMILES</span>
            <code>${esc(smiles || "暂缺")}</code>
          </div>
          <div class="idle-vertical" data-text="${esc(intro)}" lang="zh-CN">${esc(
            intro
          )}</div>
          <p class="idle-hint">轻触返回 · 将自动回到这颗分子</p>
        </div>
      </div>`;
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
