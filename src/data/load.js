import { mountSample, setDataset, getDataset } from "./provider.js";
import { expandCatalog } from "./catalogExpand.js";
import { setStructureCloud } from "../engine/moleculePoints.js";

/**
 * 启动数据装配。
 * 1) 优先 lotus-structures.json（约 22 万 InChIKey）
 * 2) 其次 lotus-eco.json 精选节点
 * 3) 目录星仅在无结构云时补充密度
 */
export async function loadData() {
  mountSample();

  let structures = null;
  try {
    let res = await fetch("data/curated/lotus-structures.json", {
      cache: "force-cache",
    });
    if (!res.ok) {
      res = await fetch("data/curated/lotus-structures.json", {
        cache: "no-cache",
      });
    }
    if (res.ok) structures = await res.json();
  } catch (_) {}

  if (structures && structures.items && structures.items.length) {
    setStructureCloud(structures.items);
  }

  let curated = null;
  try {
    const res = await fetch("data/curated/lotus-eco.json", { cache: "no-cache" });
    if (res.ok) curated = await res.json();
  } catch (_) {}

  const base = expandCatalog(70);
  const hasCloud = !!(structures && structures.items && structures.items.length);

  if (curated && Array.isArray(curated.nodes) && curated.nodes.length) {
    const curatedNodes = curated.nodes.map((n) => ({
      ...n,
      featured: true,
      refs: n.refs?.length ? n.refs : ["LOTUS 灌库·待核对"],
    }));
    const curatedIds = new Set(curatedNodes.map((n) => n.id));
    // 有全量结构云时：少带目录星，减轻渲染
    const fillers = hasCloud
      ? base.nodes.filter((n) => !n.featured && !curatedIds.has(n.id)).slice(0, 0)
      : base.nodes.filter((n) => !curatedIds.has(n.id));
    const nodes = [...curatedNodes, ...fillers];
    const note = (curated.meta && curated.meta.snapshotNote) || "LOTUS";
    const extra = hasCloud
      ? ` · 结构云 ${structures.items.length}`
      : "";
    setDataset({
      ...base,
      meta: {
        ...base.meta,
        title: (curated.meta && curated.meta.title) || base.meta.title,
        subtitle: hasCloud
          ? "LOTUS 结构云（全量 InChIKey）· 可飞近个体"
          : base.meta.subtitle,
        disclaimer:
          (curated.meta && curated.meta.disclaimer) || base.meta.disclaimer,
        snapshotNote: note + extra + " · 总节点 " + nodes.length,
      },
      nodes,
    });
    return getDataset();
  }

  setDataset(base);
  return getDataset();
}
