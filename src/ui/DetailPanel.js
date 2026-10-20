import {
  getNode,
  layerLabel,
  meta,
  getMoleculePoint,
  listMoleculePoints,
  stats,
} from "../engine/engineApi.js";
import { structureCount } from "../engine/moleculePoints.js";
import { isBookmarked, toggleBookmark } from "../state/bookmarks.js";
import { randomPoint, todayPoint, focusSearch } from "./ExploreActions.js";
import { getMoleculeMeta } from "../engine/moleculeMeta.js";
import {
  getClaimStatus,
  claimMolecule,
  renameClaim,
  claimDisplayName,
} from "../engine/claims.js";
import { openClaimDialog } from "./ClaimDialog.js";
import { getState, setSelected } from "../state/store.js";
import {
  classInfoFor,
  familyInfoFor,
  ecologyText,
} from "../data/taxonomyInfo.js";
import { renderSmilesToSvg } from "./smilesRender.js";

function legendHtml() {
  return `
    <ul class="legend">
      <li><span class="dot plant"></span>植物</li>
      <li><span class="dot fungus"></span>真菌</li>
      <li><span class="dot bacteria"></span>细菌</li>
      <li><span class="dot insect"></span>昆虫</li>
      <li><span class="dot role"></span>生态角色（叙事）</li>
    </ul>`;
}

function welcomeHtml() {
  const d = meta();
  const st = stats();
  const nStruct = structureCount();
  const today = todayPoint();
  return `
    <div class="detail-empty welcome">
      <span class="welcome-kicker">华中农业大学 · LOTUS</span>
      <h2>世界树 · 天然产物</h2>
      <p class="welcome-lead">
        一棵由 <strong>${nStruct.toLocaleString("zh-CN")}</strong> 个天然产物结构构成的世界树。
        每一颗星是一条结构–来源记录；树层是它所在的生态位置。
      </p>

      <div class="welcome-stats">
        <div><strong>${nStruct.toLocaleString("zh-CN")}</strong><span>LOTUS 结构</span></div>
        <div><strong>${st.nodes.toLocaleString("zh-CN")}</strong><span>物种节点</span></div>
        <div><strong>${st.molecules.toLocaleString("zh-CN")}</strong><span>精选分子</span></div>
      </div>

      <div class="welcome-actions">
        <button type="button" class="welcome-btn primary" id="welcomeRandom">✦ 随机漫游</button>
        <button type="button" class="welcome-btn" id="welcomeTodayBtn">今日分子</button>
        <button type="button" class="welcome-btn" id="welcomeSearch">搜索分子</button>
      </div>

      ${
        today
          ? `<div class="welcome-today" id="welcomeToday">
              <span class="kicker">今日分子</span>
              <strong id="welcomeTodayName">${esc(
                shortName(today.nameZh || today.nameEn || "未命名", 48)
              )}</strong>
              <p id="welcomeTodayMeta">${esc(today.organismZh || "")} · ${esc(
                layerLabel(today.layer) || today.layer || ""
              )}</p>
              <button type="button" class="welcome-link" data-select-id="${esc(
                today.id
              )}">查看这颗分子 →</button>
            </div>`
          : ""
      }

      <div class="welcome-steps">
        <h3>怎么探索</h3>
        <ol>
          <li>拖拽旋转，滚轮/双指飞近；<b>~</b> 进入第一人称。</li>
          <li>左栏按类群、层位、化学分类筛选，或随机漫游。</li>
          <li>点开一颗星，展开结构式，读来源与特性；喜欢就领养它。</li>
        </ol>
      </div>

      ${legendHtml()}
      <p class="disclaimer">${esc((d.meta && d.meta.disclaimer) || "")}</p>
    </div>`;
}

function shortName(name, n = 48) {
  const t = String(name || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(v, digits = 2) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const s = n.toFixed(digits);
  return digits > 0 ? s.replace(/\.?0+$/, "") : s;
}

function kindLabel(kind) {
  if (kind === "featured") return "精选产物";
  if (kind === "lotus") return "LOTUS 结构云";
  if (kind === "catalog") return "目录星占位";
  return kind || "—";
}

function badge(text, cls = "") {
  return `<span class="mol-badge ${cls}">${esc(text)}</span>`;
}

function metaRow(key, value, cls = "") {
  return `<div class="meta-row ${cls}"><span class="key">${esc(
    key
  )}</span><span>${value}</span></div>`;
}

function link(url, text) {
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(
    text
  )}</a>`;
}

function doiLink(doi) {
  if (!doi) return "";
  return link(`https://doi.org/${doi}`, doi);
}

function pubchemLink(cid) {
  if (cid == null) return "";
  return link(
    `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
    `PubChem CID ${cid}`
  );
}

function wikidataLink(qid) {
  if (!qid) return "";
  return link(`https://www.wikidata.org/wiki/${qid}`, qid);
}

function nameHtml(p, metaData) {
  const raw = metaData?.name || p.nameZh || p.nameEn || "";
  const ci = classInfoFor(metaData);
  const long = raw.length > 48;
  const title =
    long && (ci.label || p.organismZh)
      ? `${ci.zh}${p.organismZh ? ` · ${p.organismZh}` : ""}`
      : raw || "未命名天然产物";
  const sub =
    raw && raw !== title
      ? `<p class="latin">${esc(raw.length > 120 ? raw.slice(0, 118) + "…" : raw)}</p>`
      : "";
  return `
    <h2 title="${esc(raw || title)}">${esc(title)}</h2>
    ${sub}
    ${
      long
        ? `<details class="name-full"><summary>化学名 / IUPAC</summary><p>${esc(
            raw
          )}</p></details>`
        : ""
    }`;
}

function summaryText(p, metaData) {
  const ci = classInfoFor(metaData);
  const org = p.organismZh || "来源物种未标注";
  const fam = metaData?.family
    ? `（${familyInfoFor(metaData.family)?.zh || metaData.family}）`
    : "";
  const formula =
    metaData?.formula ||
    (p.chemClass && p.chemClass.startsWith("分子式 ")
      ? p.chemClass.slice(4)
      : "");
  const clsPhrase =
    ci.zh === "天然产物"
      ? "天然产物"
      : `${ci.zh}${ci.zh.endsWith("类") ? "" : "类"}天然产物`;
  return `由 ${org}${fam}产生的${clsPhrase}${
    formula ? `，分子式 ${formula}` : ""
  }。`;
}

function headerHtml(p, metaData) {
  const ci = classInfoFor(metaData);
  const layer = layerLabel(p.layer) || p.layer || "—";
  return `
    <button type="button" class="back-btn" id="backBtn">← 返回说明</button>
    <span class="kicker">${esc(layer)} · ${esc(p.kingdom || "—")} · ${esc(
    kindLabel(p.kind)
  )}</span>
    <div class="mol-title">${nameHtml(p, metaData)}</div>
    <div class="mol-badges">
      ${badge(ci.zh, "class")}
      ${badge(layer)}
      ${badge(p.kingdom || "—")}
      ${metaData?.formula ? badge(metaData.formula, "formula") : ""}
    </div>
    <p class="mol-summary">${esc(summaryText(p, metaData))}</p>`;
}

function loadingHtml(p) {
  return `
    <div class="detail-card mol-v2">
      ${headerHtml(p, null)}
      <div class="meta-status" role="status">
        <span class="spinner"></span> 正在读取 LOTUS 分子资料…
      </div>
      ${sourceSection(p, null)}
      ${provenanceSection(p, null)}
    </div>`;
}

function structureSection(p, metaData) {
  if (!metaData || !metaData.smiles) {
    return `
      <section class="mol-section">
        <h3>结构式 · SMILES</h3>
        <p class="muted">LOTUS 快照中未找到该分子的 SMILES，暂时无法计算结构图。</p>
      </section>`;
  }
  return `
    <section class="mol-section">
      <h3>结构式 · SMILES</h3>
      <details class="smiles-details" id="smilesDetails">
        <summary>
          <span class="cta-icon" aria-hidden="true"></span>
          <span class="cta-text">展开结构式</span>
          <em>点击后计算渲染</em>
        </summary>
        <div class="structure-slot" id="structureSlot">
          <div class="structure-hint">展开后将在浏览器内用 RDKit.js 解析 SMILES 并绘制 2D 结构。</div>
        </div>
      </details>
      <div class="smiles-line">
        <code id="smilesCode">${esc(metaData.smiles)}</code>
        <button type="button" class="mini-btn" id="copySmiles">复制</button>
      </div>
    </section>`;
}

function identitySection(p, metaData) {
  const ik = p.inchikey || "—";
  if (!metaData) {
    return `
      <section class="mol-section">
        <h3>分子身份</h3>
        <div class="meta-grid">
          ${metaRow("InChIKey", `<code class="wrap">${esc(ik)}</code>`, "wide")}
          ${metaRow("化学分类字段", esc(p.chemClass || "—"), "wide")}
        </div>
      </section>`;
  }
  const rows = [
    ["分子式", esc(metaData.formula || "—")],
    ["精确质量", fmt(metaData.mass, 4)],
    ["XLogP", fmt(metaData.xlogp, 2)],
    ["立体中心", metaData.stereocenters ?? "—"],
    [
      "环 / 芳香环",
      `${metaData.rings ?? "—"} / ${metaData.aromaticRings ?? "—"}`,
    ],
    ["氢键供体 / 受体", `${metaData.hbd ?? "—"} / ${metaData.hba ?? "—"}`],
    ["TPSA", fmt(metaData.tpsa, 1)],
    ["可旋转键", metaData.rotatableBonds ?? "—"],
    [
      "sp³ 碳比例",
      metaData.fractionCsp3 == null
        ? "—"
        : `${Math.round(metaData.fractionCsp3 * 100)}%`,
    ],
  ];
  return `
    <section class="mol-section">
      <h3>分子身份</h3>
      <div class="meta-grid">
        ${rows.map(([k, v]) => metaRow(k, v)).join("")}
        ${metaRow("InChIKey", `<code class="wrap">${esc(ik)}</code>`, "wide")}
      </div>
      <div class="source-links">
        ${[
          metaData.cid != null ? pubchemLink(metaData.cid) : "",
          metaData.wikidata ? wikidataLink(metaData.wikidata) : "",
          metaData.doi ? doiLink(metaData.doi) : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </section>`;
}

function classificationSection(metaData) {
  const np = metaData?.npclass?.length
    ? metaData.npclass.join(" › ")
    : "LOTUS 未细分到具体化学类别";
  const cf = metaData?.classyfire
    ? `ClassyFire 直系：${metaData.classyfire}`
    : "";
  return `
    <section class="mol-section">
      <h3>化学分类</h3>
      <p class="class-path">${esc(np)}</p>
      ${cf ? `<p class="class-sub">${esc(cf)}</p>` : ""}
    </section>`;
}

function sourceSection(p, metaData) {
  const fam = metaData?.family || "";
  const famInfo = familyInfoFor(fam);
  const layer = layerLabel(p.layer) || p.layer || "—";
  const org = p.organismZh || "来源物种未标注";
  return `
    <section class="mol-section">
      <h3>来源与生态</h3>
      <div class="meta-grid">
        ${metaRow("来源物种", esc(org))}
        ${metaRow(
          "所属科",
          fam
            ? `${esc(fam)}${famInfo ? `（${esc(famInfo.zh)}）` : ""}`
            : "LOTUS 未标注"
        )}
        ${metaRow("类群", esc(p.kingdom || "—"))}
        ${metaRow("树层", esc(layer))}
        ${metaRow("生态角色", esc(p.ecoRole || "—"), "wide")}
      </div>
      <p class="source-text">${esc(ecologyText(p.kingdom, p.layer))}</p>
      ${
        famInfo
          ? `<p class="source-text">${esc(famInfo.zh)}：${esc(
              famInfo.text
            )}</p>`
          : ""
      }
    </section>`;
}

function usageSection(p, metaData) {
  const ci = classInfoFor(metaData);
  const hasMeta = !!metaData;
  const formula = metaData?.formula || "—";
  const rings = metaData?.rings;
  const aromatic = metaData?.aromaticRings;
  const tpsa = metaData?.tpsa;
  const xlogp = metaData?.xlogp;
  const stereo = metaData?.stereocenters;
  const rotb = metaData?.rotatableBonds;
  const features = [];
  if (hasMeta) {
    features.push(
      `结构特征：分子式 ${formula}，精确质量 ${fmt(
        metaData.mass,
        3
      )}；含 ${rings ?? "—"} 个环（其中 ${
        aromatic ?? "—"
      } 个芳香环），${metaData.hbd ?? "—"} 个氢键供体、${
        metaData.hba ?? "—"
      } 个氢键受体。`
    );
    features.push(
      `理化轮廓：TPSA ${fmt(tpsa, 1)} Å²，XLogP ${fmt(
        xlogp,
        2
      )}，可旋转键 ${rotb ?? "—"}，立体中心 ${stereo ?? "—"}。`
    );
  } else {
    features.push(
      "LOTUS 快照中未找到该 InChIKey 的扩展字段；以下介绍基于来源物种、树层和现有字段生成。"
    );
  }
  return `
    <section class="mol-section usage-section">
      <h3>特性与用途</h3>
      <p class="usage-lead"><strong>${esc(ci.zh)}</strong>：${esc(
    ci.text
  )}</p>
      <ul class="feature-list">
        ${features.map((x) => `<li>${esc(x)}</li>`).join("")}
      </ul>
      <p class="source-text">${esc(ecologyText(p.kingdom, p.layer))}</p>
      <p class="usage-note">这一类结构在天然产物研究中常被关注的方向包括：化学防御、抗微生物/拒食、紫外防护、风味与香气、药物先导等。具体到本分子是否具有这些活性，需要实验或文献证据；LOTUS 本身不提供活性、毒理或用途数据。</p>
      <p class="caveat">本页为科学传播用途，不构成用药、农药或安全建议。</p>
    </section>`;
}

function provenanceSection(p, metaData) {
  const parts = [
    "LOTUS frozen 260413（CC0）",
    metaData?.doi ? `文献 DOI ${doiLink(metaData.doi)}` : "",
    metaData?.cid != null ? pubchemLink(metaData.cid) : "",
    metaData?.wikidata ? `Wikidata ${wikidataLink(metaData.wikidata)}` : "",
  ].filter(Boolean);
  return `
    <section class="mol-section sources-section">
      <h3>数据来源</h3>
      <p>${parts.join(" · ")}</p>
      <p class="muted">结构–物种关联来自 LOTUS；化学分类由 NPClassifier / ClassyFire 注释；结构描述符由 RDKit 计算。数据只基于 LOTUS，不含 NPASS/ChEMBL 等活性库。</p>
      <p class="muted">场景内 ID：<code class="wrap">${esc(
        p.id || ""
      )}</code> · InChIKey：<code class="wrap">${esc(
    p.inchikey || "—"
  )}</code></p>
    </section>`;
}

function actionsHtml(p) {
  const marked = isBookmarked(p.id);
  return `<div class="mol-actions">
    <button type="button" class="mol-action" data-bookmark-id="${esc(p.id)}">${
      marked ? "★ 已收藏" : "☆ 收藏"
    }</button>
    <button type="button" class="mol-action" data-share-id="${esc(
      p.id
    )}">复制链接</button>
    <button type="button" class="mol-action" data-export-id="${esc(
      p.id
    )}">下载资料</button>
  </div>`;
}

function relatedSection(p, metaData) {
  const all = listMoleculePoints();
  const sameOrg = all
    .filter(
      (x) =>
        x.organismZh &&
        x.organismZh === p.organismZh &&
        x.id !== p.id
    )
    .slice(0, 6);
  let sameClass = [];
  if (p._classIdx != null) {
    sameClass = all
      .filter((x) => x._classIdx === p._classIdx && x.id !== p.id)
      .slice(0, 6);
  }
  if (!sameOrg.length && !sameClass.length) return "";
  const className = metaData?.npclass?.length
    ? metaData.npclass[metaData.npclass.length - 1]
    : classInfoFor(metaData).zh;
  const item = (x) => `<button type="button" class="rail-list-item" data-select-id="${esc(
    x.id
  )}">
    <span>${esc(shortName(x.nameZh || x.nameEn || "未命名", 28))}</span>
    <em>${esc(shortName(x.organismZh || x.layer || "", 14))}</em>
  </button>`;
  return `<section class="mol-section related-section">
    <h3>继续探索</h3>
    ${
      sameOrg.length
        ? `<h4>同源物种 · ${esc(
            shortName(p.organismZh || "", 20)
          )}</h4><div class="rail-list">${sameOrg.map(item).join("")}</div>`
        : ""
    }
    ${
      sameClass.length
        ? `<h4>同类分子 · ${esc(
            shortName(className, 24)
          )}</h4><div class="rail-list">${sameClass.map(item).join("")}</div>`
        : ""
    }
  </section>`;
}

function molCardHtml(p, metaData, status) {
  return `
    <div class="detail-card mol-v2">
      ${headerHtml(p, metaData)}
      ${p.inchikey ? `<div class="claim-slot" id="claimSlot"></div>` : ""}
      ${actionsHtml(p)}
      ${
        status === "missing"
          ? `<div class="meta-status missing">LOTUS 快照中未找到该 InChIKey 的扩展字段；仍显示物种关联与基础信息。</div>`
          : ""
      }
      ${structureSection(p, metaData)}
      ${identitySection(p, metaData)}
      ${classificationSection(metaData)}
      ${sourceSection(p, metaData)}
      ${usageSection(p, metaData)}
      ${relatedSection(p, metaData)}
      ${provenanceSection(p, metaData)}
    </div>`;
}

function catalogCardHtml(p) {
  return `
    <div class="detail-card mol-v2">
      ${headerHtml(p, null)}
      <section class="mol-section">
        <h3>目录星</h3>
        <p>这是一个分类占位星，用于表示该冠层/树干/根际/土壤层位还可以继续灌入 LOTUS 结构。它没有对应的 InChIKey，因此没有结构式与分子元数据。</p>
        <p class="muted">${esc(p.note || "")}</p>
      </section>
      ${sourceSection(p, null)}
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
          <h3>${esc(m.nameZh)}</h3>
          <p class="en">${esc(m.nameEn)}</p>
          <span class="class">${esc(m.chemClass)}</span>
          <p class="note">${esc(m.note)}</p>
          ${
            m.inchikey
              ? `<code>InChIKey（示例，待核对）: ${esc(m.inchikey)}</code>`
              : `<code>InChIKey: —</code>`
          }
        </article>`
          )
          .join("")}</div>`;

  const refs =
    node.refs && node.refs.length
      ? node.refs.map((r) => `<li>${esc(r)}</li>`).join("")
      : "<li>暂无</li>";

  return `
    <div class="detail-card">
      <button type="button" class="back-btn" id="backBtn">← 返回说明</button>
      <span class="kicker">${esc(layerLabel(node.layer))} · ${esc(
    node.kingdom
  )}</span>
      <h2>${esc(node.organismZh)}</h2>
      <p class="latin">${esc(node.organismLatin)}</p>
      <div class="detail-meta">
        <div class="meta-row"><span class="key">树层</span><span>${esc(
          layerLabel(node.layer)
        )}</span></div>
        <div class="meta-row"><span class="key">生态角色</span><span>${esc(
          node.ecoRole
        )}</span></div>
      </div>
      ${mols}
      <div class="refs"><strong>文献 / 数据位</strong><ul style="margin:6px 0 0;padding-left:18px">${refs}</ul></div>
    </div>`;
}

export function mountDetailPanel(el) {
  let renderToken = 0;

  function bindBack() {
    el.querySelector("#backBtn")?.addEventListener("click", () =>
      setSelected(null)
    );
  }

  function bindWelcome() {
    el.querySelector("#welcomeRandom")?.addEventListener("click", () => {
      randomPoint();
    });
    el.querySelector("#welcomeTodayBtn")?.addEventListener("click", () => {
      const p = todayPoint();
      if (p) setSelected(p.id);
    });
    el.querySelector("#welcomeSearch")?.addEventListener("click", () => {
      focusSearch();
    });
    el.querySelectorAll("[data-select-id]").forEach((b) => {
      b.addEventListener("click", () => setSelected(b.dataset.selectId));
    });

    // 今日分子的补充资料（分类/分子式）
    const p = todayPoint();
    if (!p?.inchikey) return;
    getMoleculeMeta(p.inchikey).then((metaData) => {
      if (!metaData || getState().selectedId) return;
      const nameEl = el.querySelector("#welcomeTodayName");
      const metaEl = el.querySelector("#welcomeTodayMeta");
      if (nameEl && metaData.name) {
        nameEl.textContent = shortName(metaData.name, 48);
      }
      if (metaEl) {
        const ci = classInfoFor(metaData);
        metaEl.textContent = [p.organismZh, ci.zh, metaData.formula]
          .filter(Boolean)
          .join(" · ");
      }
    });
  }

  function renderWelcome() {
    el.innerHTML = welcomeHtml();
    bindWelcome();
  }

  function bindCardActions(p, metaData) {
    const bookmarkBtn = el.querySelector("[data-bookmark-id]");
    if (bookmarkBtn) {
      bookmarkBtn.addEventListener("click", () => {
        const title =
          el.querySelector(".mol-title h2")?.textContent?.trim() ||
          p.nameZh ||
          p.nameEn ||
          "未命名";
        toggleBookmark({
          id: p.id,
          name: title,
          organismZh: p.organismZh || "",
          inchikey: p.inchikey || "",
        });
        bookmarkBtn.textContent = isBookmarked(p.id)
          ? "★ 已收藏"
          : "☆ 收藏";
      });
    }

    const shareBtn = el.querySelector("[data-share-id]");
    if (shareBtn) {
      shareBtn.addEventListener("click", async () => {
        const url = `${location.origin}${
          location.pathname
        }#n=${encodeURIComponent(p.id)}`;
        try {
          await navigator.clipboard.writeText(url);
          shareBtn.textContent = "已复制";
          setTimeout(() => (shareBtn.textContent = "复制链接"), 1200);
        } catch (_) {
          shareBtn.textContent = "复制失败";
          setTimeout(() => (shareBtn.textContent = "复制链接"), 1200);
        }
      });
    }

    const exportBtn = el.querySelector("[data-export-id]");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const payload = {
          id: p.id,
          inchikey: p.inchikey || null,
          nameZh: p.nameZh || null,
          nameEn: p.nameEn || null,
          organismZh: p.organismZh || null,
          kingdom: p.kingdom || null,
          layer: p.layer || null,
          kind: p.kind || null,
          meta: metaData || null,
          source: "LOTUS frozen 260413 (CC0)",
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${p.inchikey || p.id || "molecule"}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        exportBtn.textContent = "已下载";
        setTimeout(() => (exportBtn.textContent = "下载资料"), 1200);
      });
    }

    el.querySelectorAll("[data-select-id]").forEach((b) => {
      b.addEventListener("click", () => setSelected(b.dataset.selectId));
    });
  }

  function bindClaim(p) {
    const slot = el.querySelector("#claimSlot");
    if (!slot || !p.inchikey) return;
    const key = p.inchikey;
    const label =
      el.querySelector(".mol-title h2")?.textContent?.trim() ||
      p.nameZh ||
      p.nameEn ||
      "这颗分子";

    function paint(state) {
      if (!slot.isConnected) return;
      if (state?.error && !state.claimed) {
        slot.innerHTML = `<span class="claim-note">领养服务暂不可用</span>`;
        return;
      }
      if (!state?.claimed) {
        slot.innerHTML = `<button type="button" class="claim-btn" id="claimBtn">✦ 领养这颗分子</button>`;
        slot.querySelector("#claimBtn")?.addEventListener("click", () => {
          openClaimDialog({
            mode: "claim",
            moleculeName: label,
            onSubmit: (name) => claimMolecule(key, name),
            onSuccess: (res) => paint(res),
          });
        });
        return;
      }
      const name = claimDisplayName(state.name);
      slot.innerHTML = `
        <span class="claim-mark" title="这颗分子已被领养">✦ 已领养</span>
        <span class="claim-by">由 <strong>${esc(
          name
        )}</strong> 领养${state.mine ? "（你）" : ""}</span>
        ${
          state.mine
            ? `<button type="button" class="claim-link" id="renameClaim">改名</button>`
            : ""
        }
      `;
      slot.querySelector("#renameClaim")?.addEventListener("click", () => {
        openClaimDialog({
          mode: "rename",
          moleculeName: label,
          currentName: state.name || "",
          onSubmit: (name) => renameClaim(key, name),
          onSuccess: (res) => paint(res),
        });
      });
    }

    slot.innerHTML = `<span class="claim-loading">查询领养状态…</span>`;
    getClaimStatus(key).then((state) => {
      if (slot.isConnected) paint(state);
    });
  }

  function bindStructure(metaData) {
    const details = el.querySelector("#smilesDetails");
    const slot = el.querySelector("#structureSlot");
    const copy = el.querySelector("#copySmiles");
    if (copy && metaData?.smiles) {
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(metaData.smiles);
          copy.textContent = "已复制";
          setTimeout(() => (copy.textContent = "复制"), 1200);
        } catch (_) {
          copy.textContent = "复制失败";
          setTimeout(() => (copy.textContent = "复制"), 1200);
        }
      });
    }
    if (!details || !slot || !metaData?.smiles) return;
    let state = "idle";
    details.addEventListener("toggle", () => {
      if (!details.open || state !== "idle") return;
      state = "loading";
      const started = performance.now();
      slot.innerHTML = `<div class="structure-loading"><span class="spinner"></span>等待中ing。。。</div>`;
      renderSmilesToSvg(metaData.smiles)
        .then((svg) => {
          // 即使本地很快，也保留一小段“等待中ing。。。”，避免一闪而过
          const wait = Math.max(0, 650 - (performance.now() - started));
          setTimeout(() => {
            if (!details.isConnected) return;
            slot.innerHTML = svg;
            slot.querySelector("svg")?.classList.add("mol-svg");
            state = "done";
            const hint = details.querySelector("summary em");
            if (hint) hint.textContent = "已渲染";
          }, wait);
        })
        .catch((err) => {
          state = "idle";
          slot.innerHTML = `<div class="structure-error">结构渲染失败：${esc(
            err?.message || err
          )}<br/>可查看下方 SMILES 原文，或稍后重试。</div>`;
        });
    });
  }

  function render() {
    const { selectedId } = getState();
    const my = ++renderToken;
    if (!selectedId) {
      renderWelcome();
      return;
    }

    if (
      selectedId.startsWith("mol:") ||
      selectedId.startsWith("cat:") ||
      selectedId.startsWith("ls:")
    ) {
      const p = getMoleculePoint(selectedId);
      if (!p) {
        renderWelcome();
        return;
      }
      if (p.kind === "catalog") {
        el.innerHTML = catalogCardHtml(p);
        bindBack();
        return;
      }

      el.innerHTML = loadingHtml(p);
      bindBack();
      if (!p.inchikey) {
        el.innerHTML = molCardHtml(p, null, "missing");
        bindBack();
        bindClaim(p);
        return;
      }

      getMoleculeMeta(p.inchikey).then((metaData) => {
        if (my !== renderToken || getState().selectedId !== selectedId) return;
        el.innerHTML = molCardHtml(
          p,
          metaData,
          metaData ? "ready" : "missing"
        );
        bindBack();
        bindClaim(p);
        bindCardActions(p, metaData);
        if (metaData) bindStructure(metaData);
      });
      return;
    }

    const node = getNode(selectedId);
    if (!node) {
      const p = getMoleculePoint(selectedId);
      if (p) {
        el.innerHTML = p.kind === "catalog" ? catalogCardHtml(p) : loadingHtml(p);
        bindBack();
        if (p.inchikey && p.kind !== "catalog") {
          getMoleculeMeta(p.inchikey).then((metaData) => {
            if (my !== renderToken || getState().selectedId !== selectedId)
              return;
            el.innerHTML = molCardHtml(
              p,
              metaData,
              metaData ? "ready" : "missing"
            );
            bindBack();
            bindClaim(p);
            bindCardActions(p, metaData);
            if (metaData) bindStructure(metaData);
          });
        }
        return;
      }
      renderWelcome();
      return;
    }
    el.innerHTML = nodeCardHtml(node);
    bindBack();
  }

  render();
  return { render };
}
