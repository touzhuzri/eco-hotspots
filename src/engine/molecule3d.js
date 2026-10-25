/**
 * LOTUS 3D 构象（按 InChIKey 前两位分片，gzip 压缩）。
 *
 * 由 pipeline/build-molecule-3d.py 从 LOTUS SMILES 离线生成。
 * 记录格式：{ a:[元素...], c:[x,y,z...], b:[[i,j,键级]...] }
 */

const shardCache = new Map(); // "AB" -> Promise<Record<string, any>>

async function fetchShard(prefix) {
  if (!shardCache.has(prefix)) {
    const p = (async () => {
      const url = `data/molecules3d/${prefix}.json.gz`;
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) return {};
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
        return {};
      }
    })().catch(() => ({}));
    shardCache.set(prefix, p);
  }
  return shardCache.get(prefix);
}

/**
 * @param {string} inchikey
 * @returns {Promise<null | {a:string[], c:number[], b:number[][]}>}
 */
export async function getMolecule3D(inchikey) {
  if (!inchikey) return null;
  const key = String(inchikey).trim().toUpperCase();
  if (!/^[A-Z]{2}/.test(key)) return null;
  const shard = await fetchShard(key.slice(0, 2));
  const rec = shard[key];
  if (
    !rec ||
    !Array.isArray(rec.a) ||
    !rec.a.length ||
    !Array.isArray(rec.c) ||
    rec.c.length < rec.a.length * 3
  ) {
    return null;
  }
  return rec;
}

export function hasMolecule3DShard(inchikey) {
  if (!inchikey) return false;
  return /^[A-Z]{2}/.test(String(inchikey).toUpperCase());
}
