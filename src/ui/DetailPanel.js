import {
  getNode,
  layerLabel,
  meta,
  getMoleculePoint,
} from "../engine/engineApi.js";
import { getState, setSelected } from "../state/store.js";

function emptyHtml() {
  const d = meta();
  return `
    <div class="detail-empty">
      <h2>选择一颗产物星</h2>
      <p>树上的每一颗亮星都是一个<strong>有机产物</strong>。滚轮可大幅飞近；点击星点查看分类、来源与结构字段。灰星为「目录星」，表示该分类可继续灌入 LOTUS 数据。</p>
      <ul class="legend">
        <li><span class="dot plant"></span>植物</li>
        <li><span class="dot fungus"></span>真菌</li>
        <li><span class="dot bacteria"></span>细菌</li>
        <li><span class="dot insect"></span>昆虫</li>
        <li><span class="dot role"></span>生态角色（叙事）</li>
      </ul>
      <p class="disclaimer">${(d.meta && d.meta.disclaimer) || ""}</p>
    </div>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kindLabel(kind) {
  if (kind === "featured") return "精选产物";
  if (kind === "lotus") return "LOTUS 结构云";
  if (kind === "catalog") return "目录星占位";
  return kind || "—";
}

/** 站内完整说明卡（方案 1：不离开 3D 场景） */
function molCardHtml(p) {
  const featured = p.kind === "featured";
  const lotus = p.kind === "lotus";
  const name = p.nameZh || p.nameEn || "未命名产物";
  const nameEn = p.nameEn || "";
  const org = p.organismZh || "—";
  const layer = layerLabel(p.layer) || p.layer || "—";
  const klass = p.chemClass || "—";
  const ik = p.inchikey || "—";
  const note = p.note || "";
  const eco = p.ecoRole || "";
  const id = p.id || "";
  // 超长 IUPAC 名：截断展示，完整放 title / details
  const longName = name.length > 48;
  const shortName = longName ? name.slice(0, 46) + "…" : name;

  return `
    <div class="detail-card">
      <button type="button" class="back-btn" id="backBtn">← 返回说明</button>
      <span class="kicker">${esc(layer)} · ${esc(p.kingdom || "")} · ${esc(kindLabel(p.kind))}</span>
      <h2 title="${esc(name)}">${esc(shortName)}</h2>
      ${nameEn ? `<p class="latin">${esc(nameEn)}</p>` : ""}
      ${
        longName
          ? `<details class="name-full"><summary>完整化学名</summary><p>${esc(name)}</p></details>`
          : ""
      }

      <div class="detail-meta">
        <div class="meta-row"><span class="key">来源</span><span>${esc(org)}</span></div>
        <div class="meta-row"><span class="key">类群</span><span>${esc(p.kingdom || "—")}</span></div>
        <div class="meta-row"><span class="key">化学分类</span><span>${esc(klass)}</span></div>
        <div class="meta-row"><span class="key">树层</span><span>${esc(layer)}</span></div>
        <div class="meta-row"><span class="key">InChIKey</span><span style="word-break:break-all">${esc(ik)}</span></div>
        ${eco ? `<div class="meta-row"><span class="key">生态角色</span><span>${esc(eco)}</span></div>` : ""}
        <div class="meta-row"><span class="key">条目类型</span><span>${esc(kindLabel(p.kind))}</span></div>
      </div>

      <div class="mol-list">
        <article class="mol-card">
          <h3>${esc(shortName)}</h3>
          ${nameEn ? `<p class="en">${esc(nameEn)}</p>` : ""}
          <span class="class">${esc(klass)}</span>
          ${note ? `<p class="note">${esc(note)}</p>` : ""}
          ${
            ik && ik !== "—"
              ? `<p class="note" style="opacity:.75">结构标识：InChIKey <code style="word-break:break-all">${esc(ik)}</code></p>`
              : ""
          }
        </article>
      </div>

      <div class="refs"><strong>说明</strong>
        <ul style="margin:6px 0 0;padding-left:18px">
          <li>${
            featured
              ? "精选条目，来自当前教学数据集（字段待与 LOTUS 逐条核对）。"
              : lotus
                ? "LOTUS frozen 结构–生物对灌库条目；名称与来源以数据快照为准，非用药建议。"
                : "目录星占位，表示该分类位可继续灌入数据，非已核验条目。"
          }</li>
          ${p.nodeId ? `<li>关联物种节点 <code>${esc(p.nodeId)}</code></li>` : ""}
          ${id ? `<li>场景内 ID <code style="word-break:break-all">${esc(id)}</code></li>` : ""}
        </ul>
      </div>
    </div>`;
}

function nodeCardHtml(node) {
  const mols =
    node.molecules.length === 0
      ? `<p class="latin" style="font-style:normal">叙事挂点，暂无分子。</p>`
      : `<div class="mol-list">${node.molecules
          .map(
            (m) => `
        <article class="mol-card">
          <h3>${m.nameZh}</h3>
          <p class="en">${m.nameEn}</p>
          <span class="class">${m.chemClass}</span>
          <p class="note">${m.note}</p>
          ${
            m.inchikey
              ? `<code>InChIKey（示例，待核对）: ${m.inchikey}</code>`
              : `<code>InChIKey: —</code>`
          }
        </article>`
          )
          .join("")}</div>`;

  const refs =
    node.refs && node.refs.length
      ? node.refs.map((r) => `<li>${r}</li>`).join("")
      : "<li>暂无</li>";

  return `
    <div class="detail-card">
      <button type="button" class="back-btn" id="backBtn">← 返回说明</button>
      <span class="kicker">${layerLabel(node.layer)} · ${node.kingdom}</span>
      <h2>${node.organismZh}</h2>
      <p class="latin">${node.organismLatin}</p>
      <div class="detail-meta">
        <div class="meta-row"><span class="key">树层</span><span>${layerLabel(node.layer)}</span></div>
        <div class="meta-row"><span class="key">生态角色</span><span>${node.ecoRole}</span></div>
        <div class="meta-row"><span class="key">用途</span><span style="color:#8a9bb0">暂不展示（后续检索层）</span></div>
      </div>
      ${mols}
      <div class="refs"><strong>文献 / 数据位</strong><ul style="margin:6px 0 0;padding-left:18px">${refs}</ul></div>
    </div>`;
}

export function mountDetailPanel(el) {
  function render() {
    const { selectedId } = getState();
    if (!selectedId) {
      el.innerHTML = emptyHtml();
      return;
    }
    if (
      selectedId.startsWith("mol:") ||
      selectedId.startsWith("cat:") ||
      selectedId.startsWith("ls:")
    ) {
      const p = getMoleculePoint(selectedId);
      if (!p) {
        el.innerHTML = emptyHtml();
        return;
      }
      el.innerHTML = molCardHtml(p);
      el.querySelector("#backBtn")?.addEventListener("click", () =>
        setSelected(null)
      );
      return;
    }
    const node = getNode(selectedId);
    if (!node) {
      // 兜底：按产物星查
      const p = getMoleculePoint(selectedId);
      if (p) {
        el.innerHTML = molCardHtml(p);
        el.querySelector("#backBtn")?.addEventListener("click", () =>
          setSelected(null)
        );
        return;
      }
      el.innerHTML = emptyHtml();
      return;
    }
    el.innerHTML = nodeCardHtml(node);
    el.querySelector("#backBtn")?.addEventListener("click", () =>
      setSelected(null)
    );
  }
  render();
  return { render };
}
