import { mountSample, setDataset, getDataset } from "./provider.js";
import { expandCatalog } from "./catalogExpand.js";
import { setStructureCloud } from "../engine/moleculePoints.js";

/** 带进度的 JSON 下载（Content-Length 可用时更新字节进度） */
async function fetchJsonProgress(url, onByte) {
  let res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!res.body || !onByte) return res.json();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onByte(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

/**
 * 启动数据装配。
 * 1) 优先 lotus-structures.json（约 22 万 InChIKey）
 * 2) 其次 lotus-eco.json 精选节点
 * 3) 目录星仅在无结构云时补充密度
 * @param {{onStage?: (t: string, p?: number) => void}} [opts]
 */
export async function loadData(opts = {}) {
  const onStage = opts.onStage || (() => {});
  mountSample();
  onStage("正在连接数据源…", 0.02);

  let structures = null;
  try {
    onStage("正在下载结构云（约 30MB，请稍候）…", 0.05);
    structures = await fetchJsonProgress(
      "data/curated/lotus-structures.json",
      (loaded, total) => {
        if (!total) {
          onStage("正在下载结构云…", Math.min(0.45, 0.05 + loaded / 8e7));
          return;
        }
        const p = 0.05 + 0.5 * Math.min(1, loaded / total);
        onStage("正在下载结构云…", p);
      }
    );
    onStage("正在解析结构云…", 0.58);
  } catch (_) {}

  if (structures && structures.items && structures.items.length) {
    setStructureCloud(structures.items);
  }

  let curated = null;
  try {
    onStage("正在加载精选节点…", 0.62);
    const res = await fetch("data/curated/lotus-eco.json", { cache: "no-cache" });
    if (res.ok) curated = await res.json();
  } catch (_) {}

  onStage("正在装配数据集…", 0.72);
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
