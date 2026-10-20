import { listMoleculePoints, pointStats, stats } from "../engine/engineApi.js";
import { structureCount } from "../engine/moleculePoints.js";
import { loadFacets } from "../engine/moleculeFacets.js";
import {
  getState,
  setKingdom,
  setLayer,
  setClassIdx,
  setFamilyIdx,
  clearFilters,
  subscribe,
  setSelected,
} from "../state/store.js";
import {
  randomPoint,
  todayPoint,
  featuredPoints,
  focusSearch,
} from "./ExploreActions.js";
import { listBookmarks, removeBookmark } from "../state/bookmarks.js";
import { openCompare } from "./CompareDialog.js";

const LAYER_LABEL = {
  sky: "天空",
  canopy: "冠层",
  trunk: "树干",
  rhizosphere: "根际",
  soil: "土壤",
};

const KINGDOMS = ["全部", "植物", "真菌", "细菌", "昆虫", "生态角色"];

const MOBILE_MQ = "(max-width: 900px), (max-height: 520px)";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function short(s, n = 26) {
  const t = String(s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function layerCounts() {
  const counts = {};
  for (const p of listMoleculePoints()) {
    counts[p.layer] = (counts[p.layer] || 0) + 1;
  }
  return counts;
}

export function mountExploreRail(el, { scene, onHelp, onAbout }) {
  let facets = null;
  const counts = layerCounts();
  const ps = pointStats();
  const dsStats = stats();
  const nStruct = structureCount();

  el.innerHTML = `
    <div class="rail-head">
      <span class="rail-title">探索</span>
      <button type="button" class="rail-collapse" id="railCollapse" title="收起/展开">‹</button>
    </div>
    <div class="rail-body">
      <button type="button" class="rail-search" id="railSearch">搜索名称 / 来源…</button>

      <div class="rail-actions">
        <button type="button" data-action="random">随机漫游</button>
        <button type="button" data-action="today">今日分子</button>
      </div>

      <div class="rail-overview">
        <strong>${nStruct ? nStruct.toLocaleString("zh-CN") : ps.total.toLocaleString("zh-CN")}</strong>
        <span>LOTUS 结构 · ${dsStats.nodes.toLocaleString("zh-CN")} 物种节点</span>
      </div>

      <section class="rail-section">
        <h3>类群</h3>
        <div class="rail-chips">
          ${KINGDOMS.map(
            (k) => `
            <button type="button" class="rail-chip" data-kingdom="${esc(k)}">
              ${esc(k)}<em>${k === "全部" ? ps.total.toLocaleString("zh-CN") : (ps.byKingdom[k] || 0).toLocaleString("zh-CN")}</em>
            </button>`
          ).join("")}
        </div>
      </section>

      <section class="rail-section">
        <h3>层位</h3>
        <div class="rail-chips">
          <button type="button" class="rail-chip" data-layer="">全部</button>
          ${Object.keys(LAYER_LABEL)
            .map(
              (id) => `
            <button type="button" class="rail-chip" data-layer="${id}">
              ${LAYER_LABEL[id]}<em>${(counts[id] || 0).toLocaleString("zh-CN")}</em>
            </button>`
            )
            .join("")}
        </div>
      </section>

      <section class="rail-section" id="railClassSection" hidden>
        <h3>化学分类</h3>
        <div class="rail-list" id="railClassList"></div>
      </section>

      <section class="rail-section" id="railFamilySection" hidden>
        <h3>来源科</h3>
        <div class="rail-list" id="railFamilyList"></div>
      </section>

      <div class="rail-filterbar" id="railFilterBar" hidden>
        <span id="railFilterText"></span>
        <button type="button" id="railClear">清除</button>
      </div>

      <section class="rail-section" id="bookmarkSection" hidden>
        <h3 class="rail-h-with-action">
          我的收藏
          <button type="button" class="rail-mini" id="compareBtn">对比</button>
        </h3>
        <div class="rail-list" id="bookmarkList"></div>
      </section>

      <section class="rail-section" id="nearbySection" hidden>
        <h3>附近分子</h3>
        <div class="rail-list" id="nearbyList"></div>
      </section>

      <section class="rail-section">
        <h3>精选分子</h3>
        <div class="rail-list" id="featuredList"></div>
      </section>

      <section class="rail-section">
        <h3>图例</h3>
        <ul class="legend rail-legend">
          <li><span class="dot plant"></span>植物</li>
          <li><span class="dot fungus"></span>真菌</li>
          <li><span class="dot bacteria"></span>细菌</li>
          <li><span class="dot insect"></span>昆虫</li>
          <li><span class="dot role"></span>生态角色</li>
        </ul>
      </section>

      <div class="rail-foot">
        <button type="button" id="railHelp">使用帮助</button>
        <button type="button" id="railAbout">关于数据</button>
      </div>
    </div>
  `;

  const body = el.querySelector(".rail-body");
  const filterBar = el.querySelector("#railFilterBar");
  const filterText = el.querySelector("#railFilterText");
  const classSection = el.querySelector("#railClassSection");
  const classList = el.querySelector("#railClassList");
  const familySection = el.querySelector("#railFamilySection");
  const familyList = el.querySelector("#railFamilyList");
  const featuredList = el.querySelector("#featuredList");
  const nearbySection = el.querySelector("#nearbySection");
  const nearbyList = el.querySelector("#nearbyList");
  const bookmarkSection = el.querySelector("#bookmarkSection");
  const bookmarkList = el.querySelector("#bookmarkList");

  function renderFacets() {
    if (!facets) return;
    const classes = (facets.classes || [])
      .map((c, i) => ({ ...c, i }))
      .filter((c) => c.name && c.name !== "未细分化学类别")
      .slice(0, 12);
    classSection.hidden = classes.length === 0;
    classList.innerHTML = classes
      .map(
        (c) => `
        <button type="button" class="rail-list-item" data-class="${c.i}">
          <span>${esc(short(c.name, 24))}</span>
          <em>${c.count.toLocaleString("zh-CN")}</em>
        </button>`
      )
      .join("");

    const families = (facets.families || [])
      .map((f, i) => ({ ...f, i }))
      .filter((f) => f.name && f.name !== "未标注科")
      .slice(0, 10);
    familySection.hidden = families.length === 0;
    familyList.innerHTML = families
      .map(
        (f) => `
        <button type="button" class="rail-list-item" data-family="${f.i}">
          <span>${esc(short(f.name, 24))}</span>
          <em>${f.count.toLocaleString("zh-CN")}</em>
        </button>`
      )
      .join("");
  }

  function renderFeatured() {
    const pts = featuredPoints(6);
    featuredList.innerHTML = pts.length
      ? pts
          .map(
            (p) => `
          <button type="button" class="rail-list-item" data-select-id="${esc(
            p.id
          )}">
            <span>${esc(short(p.nameZh || p.nameEn || "未命名"))}</span>
            <em>${esc(short(p.organismZh || "", 14))}</em>
          </button>`
          )
          .join("")
      : `<p class="rail-muted">暂无精选分子</p>`;
  }

  function renderBookmarks() {
    const list = listBookmarks();
    bookmarkSection.hidden = list.length === 0;
    const compare = el.querySelector("#compareBtn");
    if (compare) compare.disabled = list.length < 2;
    bookmarkList.innerHTML = list
      .map(
        (b) => `
        <div class="rail-bookmark">
          <button type="button" class="rail-list-item" data-select-id="${esc(
            b.id
          )}">
            <span>${esc(short(b.name, 24))}</span>
            <em>${esc(short(b.organismZh || "", 12))}</em>
          </button>
          <button type="button" class="rail-remove" data-remove-bookmark="${esc(
            b.id
          )}" title="移除收藏">×</button>
        </div>`
      )
      .join("");
  }

  function refresh() {
    const state = getState();
    el.querySelectorAll("[data-kingdom]").forEach((b) => {
      b.classList.toggle("active", b.dataset.kingdom === state.kingdom);
    });
    el.querySelectorAll("[data-layer]").forEach((b) => {
      b.classList.toggle(
        "active",
        (b.dataset.layer || null) === state.layer
      );
    });
    classList.querySelectorAll("[data-class]").forEach((b) => {
      b.classList.toggle(
        "active",
        Number(b.dataset.class) === state.classIdx
      );
    });
    familyList.querySelectorAll("[data-family]").forEach((b) => {
      b.classList.toggle(
        "active",
        Number(b.dataset.family) === state.familyIdx
      );
    });

    const parts = [];
    if (state.kingdom && state.kingdom !== "全部")
      parts.push(state.kingdom);
    if (state.layer) parts.push(LAYER_LABEL[state.layer] || state.layer);
    if (state.classIdx != null && facets?.classes?.[state.classIdx])
      parts.push(facets.classes[state.classIdx].name);
    if (state.familyIdx != null && facets?.families?.[state.familyIdx])
      parts.push(facets.families[state.familyIdx].name);
    filterBar.hidden = parts.length === 0;
    filterText.textContent = parts.length ? `筛选：${parts.join(" · ")}` : "";
    renderFeatured();
  }

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "railCollapse") {
      toggle();
      return;
    }
    if (btn.id === "railSearch") {
      focusSearch();
      return;
    }
    if (btn.id === "railClear") {
      clearFilters();
      return;
    }
    if (btn.id === "railHelp") {
      onHelp?.();
      return;
    }
    if (btn.id === "railAbout") {
      onAbout?.();
      return;
    }
    if (btn.id === "compareBtn") {
      openCompare();
      return;
    }
    if (btn.dataset.removeBookmark) {
      removeBookmark(btn.dataset.removeBookmark);
      return;
    }
    if (btn.dataset.action === "random") {
      randomPoint();
      return;
    }
    if (btn.dataset.action === "today") {
      const p = todayPoint();
      if (p) setSelected(p.id);
      return;
    }
    if (btn.dataset.kingdom) {
      setKingdom(btn.dataset.kingdom);
      return;
    }
    if (btn.dataset.layer != null) {
      setLayer(btn.dataset.layer || null);
      return;
    }
    if (btn.dataset.class != null) {
      const idx = Number(btn.dataset.class);
      setClassIdx(getState().classIdx === idx ? null : idx);
      return;
    }
    if (btn.dataset.family != null) {
      const idx = Number(btn.dataset.family);
      setFamilyIdx(getState().familyIdx === idx ? null : idx);
      return;
    }
    if (btn.dataset.selectId) {
      setSelected(btn.dataset.selectId);
    }
  });

  function toggle() {
    const mobile = window.matchMedia(MOBILE_MQ).matches;
    if (mobile) el.classList.toggle("is-open");
    else el.classList.toggle("is-collapsed");
    const collapsed = el.classList.contains("is-collapsed");
    const btn = el.querySelector("#railCollapse");
    if (btn) btn.textContent = collapsed ? "›" : "‹";
  }

  // 附近分子：靠近树冠内部时出现
  const nearbyTimer = setInterval(() => {
    if (el.classList.contains("is-collapsed") && !el.classList.contains("is-open")) {
      nearbySection.hidden = true;
      return;
    }
    const cam = scene?.getCamera?.();
    if (!cam || cam.dist > 18) {
      nearbySection.hidden = true;
      return;
    }
    const pts = scene.getNearby?.(6) || [];
    if (!pts.length) {
      nearbySection.hidden = true;
      return;
    }
    nearbySection.hidden = false;
    nearbyList.innerHTML = pts
      .map(
        (p) => `
      <button type="button" class="rail-list-item" data-select-id="${esc(
        p.id
      )}">
        <span>${esc(short(p.nameZh || p.nameEn || "未命名", 24))}</span>
        <em>${esc(short(p.organismZh || p.layer || "", 14))}</em>
      </button>`
      )
      .join("");
  }, 900);

  loadFacets().then((f) => {
    facets = f || { classes: [], families: [], map: {} };
    renderFacets();
    refresh();
  });

  subscribe(refresh);
  window.addEventListener("eco-bookmarks", renderBookmarks);
  refresh();
  renderFeatured();
  renderBookmarks();

  return {
    refresh,
    toggle,
    destroy() {
      clearInterval(nearbyTimer);
      window.removeEventListener("eco-bookmarks", renderBookmarks);
    },
  };
}
