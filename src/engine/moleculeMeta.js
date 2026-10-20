/**
 * LOTUS 分子元数据（按 InChIKey 前两位分片，gzip 压缩）。
 *
 * 生成：pipeline/build-molecule-meta.py
 * 来源：LOTUS frozen 260413 metadata（CC0）
 *
 * 数组字段顺序（与 pipeline 保持一致）：
 *  0 smiles        1 formula       2 exact mass     3 xlogp
 *  4 npclass[]     5 classyfire    6 family         7 doi
 *  8 pubchem cid   9 wikidata      10 stereocenters
 * 11 rings        12 aromaticRings 13 hbd          14 hba
 * 15 tpsa         16 rotatableBonds 17 fractionCsp3
 * 18 name（传统名/IUPAC，截断）
 */

const shardCache = new Map(); // "AB" -> Promise<Record<string, any[]>>

async function fetchShard(prefix) {
  if (!shardCache.has(prefix)) {
    const p = (async () => {
      const url = `data/molecules/${prefix}.json.gz`;
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) return {};
      try {
        // 若托管平台已经把 .gz 标记为 Content-Encoding: gzip，
        // fetch 会自动解压，这里直接 json()。
        const enc = (res.headers.get("content-encoding") || "").toLowerCase();
        if (!enc.includes("gzip") && typeof DecompressionStream === "function" && res.body) {
          const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
          return await new Response(stream).json();
        }
        return await res.json();
      } catch (_) {
        return {};
      }
    })()
      .catch(() => ({}))
      .then((data) => data || {});
    shardCache.set(prefix, p);
  }
  return shardCache.get(prefix);
}

/**
 * @param {string} inchikey
 * @returns {Promise<null | {
 *   smiles:string, formula:string, mass:number|null, xlogp:number|null,
 *   npclass:string[], classyfire:string, family:string, doi:string,
 *   cid:number|null, wikidata:string, stereocenters:number|null,
 *   rings:number|null, aromaticRings:number|null, hbd:number|null,
 *   hba:number|null, tpsa:number|null, rotatableBonds:number|null,
 *   fractionCsp3:number|null
 * }>}
 */
export async function getMoleculeMeta(inchikey) {
  if (!inchikey) return null;
  const key = String(inchikey).trim().toUpperCase();
  if (!/^[A-Z]{2}/.test(key)) return null;
  const shard = await fetchShard(key.slice(0, 2));
  const row = shard[key];
  if (!Array.isArray(row)) return null;
  return {
    smiles: row[0] || "",
    formula: row[1] || "",
    mass: row[2] ?? null,
    xlogp: row[3] ?? null,
    npclass: Array.isArray(row[4]) ? row[4].filter(Boolean) : [],
    classyfire: row[5] || "",
    family: row[6] || "",
    doi: row[7] || "",
    cid: row[8] ?? null,
    wikidata: row[9] || "",
    stereocenters: row[10] ?? null,
    rings: row[11] ?? null,
    aromaticRings: row[12] ?? null,
    hbd: row[13] ?? null,
    hba: row[14] ?? null,
    tpsa: row[15] ?? null,
    rotatableBonds: row[16] ?? null,
    fractionCsp3: row[17] ?? null,
    name: row[18] || "",
  };
}

export function clearMoleculeMetaCache() {
  shardCache.clear();
}
