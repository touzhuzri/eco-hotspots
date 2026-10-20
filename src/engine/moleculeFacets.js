/**
 * LOTUS 分类 / 科属 facet（用于左栏筛选与浏览）。
 * 由 pipeline/build-molecule-facets.py 生成，gzip 懒加载。
 */

let facetsPromise = null;

export function loadFacets() {
  if (!facetsPromise) {
    facetsPromise = (async () => {
      const res = await fetch("data/molecules/facets.json.gz", {
        cache: "force-cache",
      });
      if (!res.ok) return { classes: [], families: [], map: {} };
      try {
        const enc = (res.headers.get("content-encoding") || "").toLowerCase();
        if (
          !enc.includes("gzip") &&
          typeof DecompressionStream === "function" &&
          res.body
        ) {
          const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
          return await new Response(stream).json();
        }
        return await res.json();
      } catch (_) {
        return { classes: [], families: [], map: {} };
      }
    })().catch(() => ({ classes: [], families: [], map: {} }));
  }
  return facetsPromise;
}

export function clearFacetsCache() {
  facetsPromise = null;
}
