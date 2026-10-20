import { listBookmarks } from "../state/bookmarks.js";
import { getMoleculeMeta } from "../engine/moleculeMeta.js";
import { classInfoFor } from "../data/taxonomyInfo.js";
import { renderSmilesToSvg } from "./smilesRender.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(v, digits = 2) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
  return Number(v)
    .toFixed(digits)
    .replace(/\.?0+$/, "");
}

export function openCompare() {
  const items = listBookmarks().slice(0, 4);
  const overlay = document.createElement("div");
  overlay.className = "help-overlay";
  overlay.innerHTML = `<div class="help-dialog compare-dialog" role="dialog" aria-modal="true">
    <span class="help-kicker">本机收藏 · 对比</span>
    <h2>分子对比</h2>
    <div id="compareBody"><p class="muted">正在读取收藏…</p></div>
    <div class="help-actions"><button type="button" class="help-primary" id="compareClose">关闭</button></div>
  </div>`;

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  overlay.querySelector("#compareClose").addEventListener("click", close);

  if (items.length < 2) {
    overlay.querySelector("#compareBody").innerHTML =
      `<p class="muted">至少收藏 2 个分子才能对比。打开分子介绍，点「☆ 收藏」即可加入。</p>`;
    return;
  }

  Promise.all(items.map((it) => getMoleculeMeta(it.inchikey))).then((metas) => {
    if (!overlay.isConnected) return;
    const rows = items
      .map((it, i) => {
        const m = metas[i];
        const ci = classInfoFor(m);
        return `<tr>
          <td class="cmp-name">
            <strong title="${esc(it.name)}">${esc(
          it.name.length > 42 ? it.name.slice(0, 40) + "…" : it.name
        )}</strong>
            <span>${esc(it.organismZh || m?.family || "")}</span>
          </td>
          <td class="cmp-struct" data-struct="${i}">${
          m?.smiles ? "等待中ing。。。" : "—"
        }</td>
          <td>${esc(m?.formula || "—")}</td>
          <td>${fmt(m?.mass, 3)}</td>
          <td>${esc(ci.zh)}</td>
          <td>${m?.rings ?? "—"} / ${m?.aromaticRings ?? "—"}</td>
          <td>${m?.hbd ?? "—"} / ${m?.hba ?? "—"}</td>
          <td>${fmt(m?.tpsa, 1)}</td>
          <td>${fmt(m?.xlogp, 2)}</td>
        </tr>`;
      })
      .join("");

    overlay.querySelector("#compareBody").innerHTML = `
      <div class="compare-scroll">
        <table class="compare-table">
          <thead><tr>
            <th>分子 / 来源</th><th>结构</th><th>分子式</th><th>质量</th>
            <th>分类</th><th>环/芳香环</th><th>HBD/HBA</th><th>TPSA</th><th>XLogP</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="muted">结构由 RDKit.js 在浏览器内渲染；领养信息不会出现在这里。</p>`;

    // 按需渲染结构（共享 RDKit 实例）
    items.forEach((it, i) => {
      const m = metas[i];
      const cell = overlay.querySelector(`[data-struct="${i}"]`);
      if (!cell || !m?.smiles) return;
      renderSmilesToSvg(m.smiles)
        .then((svg) => {
          if (!cell.isConnected) return;
          cell.innerHTML = svg;
          cell.querySelector("svg")?.classList.add("cmp-svg");
        })
        .catch(() => {
          if (cell.isConnected) cell.textContent = "渲染失败";
        });
    });
  });
}
