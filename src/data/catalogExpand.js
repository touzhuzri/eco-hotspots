/**
 * 从精选挂点扩展出「产物星」目录：
 * - 保留 16 条精选（可开详情、有分子）
 * - 按层/类群再生成大量目录星（稳定 id，可点开占位卡）
 * 用于诗云式：树体由产物星构成，可飞近个体。
 */

import { SAMPLE_DATASET } from "./dataset.js";
import { TREE_DEFAULTS, mulberry32 } from "../scene/starTree.js";

const FILLER_NAME = {
  canopy: ["叶面萜类", "嫩枝酚类", "冠层生物碱", "花部挥发物"],
  trunk: ["茎皮苷类", "木质部精油", "韧皮部代谢物", "树皮鞣质"],
  rhizosphere: ["根际分泌物", "共生信号分子", "根表甾醇", "菌根关联物"],
  soil: ["腐殖关联物", "芽孢代谢物", "放线菌产物", "蚯蚓相关物"],
  sky: ["访花相关物", "空气花粉关联", "飞行昆虫信息素", "鸟媒植物挥发物"],
};

const KINGDOM_BY_LAYER = {
  canopy: ["植物", "昆虫"],
  trunk: ["植物", "昆虫"],
  rhizosphere: ["植物", "真菌"],
  soil: ["真菌", "细菌"],
  sky: ["昆虫", "生态角色"],
};

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 与 starTree.anchorForNode 相同的分层落点，供填充星使用 */
function placeOnLayer(layer, index, P) {
  const rnd = mulberry32(hashStr(layer + ":" + index));
  const R = 1.05 * P.spread;
  const CY0 = 1.42;
  const half0 = R * 0.72 * 1.08;
  const half1 = half0 * P.vscale;
  const CY = CY0 - half0 + half1;
  const vDiv = 0.72 * P.vscale;

  if (layer === "canopy") {
    const a = rnd() * Math.PI * 2;
    const r = R * (0.15 + 0.85 * Math.pow(rnd(), 0.55));
    const y = CY + (rnd() * 2 - 1) * half1 * 0.95;
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
  }
  if (layer === "trunk") {
    const t = 0.12 + rnd() * 0.78;
    const a = rnd() * Math.PI * 2;
    const rad = 0.08 + 0.14 * (1 - t);
    return {
      x: 0.06 * Math.sin(t * 2.8) + Math.cos(a) * rad,
      y: t * 1.15,
      z: 0.04 * Math.cos(t * 2.2) + Math.sin(a) * rad,
    };
  }
  if (layer === "rhizosphere") {
    const a = rnd() * Math.PI * 2;
    const r = 0.15 + rnd() * 0.7;
    return {
      x: Math.cos(a) * r * P.spread * 0.7,
      y: -0.08 - rnd() * 0.35,
      z: Math.sin(a) * r * P.spread * 0.7,
    };
  }
  if (layer === "soil") {
    const a = rnd() * Math.PI * 2;
    const r = 0.2 + Math.pow(rnd(), 0.6) * 1.25;
    return {
      x: Math.cos(a) * r * P.spread * 0.85,
      y: -0.34 + rnd() * 0.22,
      z: Math.sin(a) * r * P.spread * 0.85,
    };
  }
  // sky
  const a = rnd() * Math.PI * 2;
  const r = 0.9 + rnd() * 1.1;
  return {
    x: Math.cos(a) * r,
    y: CY + half1 * 0.5 + rnd() * 0.9,
    z: Math.sin(a) * r,
  };
}

/**
 * @param {number} extra 每层额外填充星数量（合计约 extra * 5）
 */
export function expandCatalog(extra = 70) {
  const P = { ...TREE_DEFAULTS };
  const featured = SAMPLE_DATASET.nodes.map((n) => ({
    ...n,
    featured: true,
  }));

  const fillers = [];
  const layers = ["canopy", "trunk", "rhizosphere", "soil", "sky"];
  for (const layer of layers) {
    const kingdoms = KINGDOM_BY_LAYER[layer];
    const names = FILLER_NAME[layer];
    for (let i = 0; i < extra; i++) {
      const idx = fillers.length;
      const id = `np-${layer}-${String(i).padStart(3, "0")}`;
      const kingdom = kingdoms[i % kingdoms.length];
      const base = names[i % names.length];
      const pos = placeOnLayer(layer, idx + 1000, P);
      fillers.push({
        id,
        layer,
        hotspot: {
          x: Math.round(((pos.x + 2) / 4) * 100),
          y: Math.round(((1.8 - pos.y) / 3.2) * 100),
        },
        // 场景用 3D 锚；hotspot 2D 仅兼容契约
        anchor3d: pos,
        organismZh: `${base} · ${String(i + 1).padStart(3, "0")}`,
        organismLatin: `Catalog entry ${layer}/${i + 1}`,
        kingdom,
        molecules: [
          {
            nameZh: `${base}组分`,
            nameEn: `Uncharacterized ${layer} constituent`,
            chemClass: "待归类天然产物",
            inchikey: null,
            note: "目录占位星：表示该层位可挂更多有机产物；正式版由 LOTUS 切片填充。",
          },
        ],
        ecoRole: `${layer} 层目录点（待关联物种–结构对）`,
        refs: ["待接入 LOTUS 切片"],
        featured: false,
        _pos3d: pos,
      });
    }
  }

  // 精选星也写入 _pos3d（场景统一读）
  const nodes = [...featured, ...fillers].map((n, i) => {
    if (n._pos3d) return n;
    return { ...n, _pos3d: placeOnLayer(n.layer, i, P) };
  });

  return {
    ...SAMPLE_DATASET,
    meta: {
      ...SAMPLE_DATASET.meta,
      subtitle:
        "产物星图：可飞近个体 · 精选挂点 + 目录占位星 · 用途待后续检索",
      snapshotNote: `${SAMPLE_DATASET.meta.snapshotNote} · 产物星 ${nodes.length}`,
    },
    nodes,
  };
}
