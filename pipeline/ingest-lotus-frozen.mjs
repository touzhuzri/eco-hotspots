/**
 * 将 LOTUS frozen 导出灌入站用 curated 集
 * 输入: D:\shijieshu\19360665\260413_frozen.csv.gz (+ 可选 metadata)
 * 输出: data/curated/lotus-eco.json
 *
 * 用法: node pipeline/ingest-lotus-frozen.mjs
 *       node pipeline/ingest-lotus-frozen.mjs --limit 4000
 */

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const inDir = path.resolve(root, "19360665");
const frozen = path.join(inDir, "260413_frozen.csv.gz");
const meta = path.join(inDir, "260413_frozen_metadata.csv.gz");
const outPath = path.join(root, "data", "curated", "lotus-eco.json");

const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const LIMIT = Number(flag("--limit", "3500"));

function splitCsv(line) {
  // 简易：此导出字段无嵌套引号逗号时足够；有引号时粗切
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function kingdomFromOrganism(name) {
  const s = (name || "").toLowerCase();
  if (/streptomy|bacillus|pseudomon|mycobacter|escherich|burkholder|enterobact/.test(s))
    return "细菌";
  if (/aspergill|penicill|trichoder|fusarium|beauver|metarhiz|claviceps|toly pocladium|tolypocladium|acremonium|saccharopolyspora/.test(s))
    return "真菌";
  if (/apis |insecta|coleoptera|lepidoptera|formic/.test(s)) return "昆虫";
  return "植物";
}

function layerFromOrganism(name, kingdom) {
  const s = (name || "").toLowerCase();
  if (kingdom === "细菌" || kingdom === "真菌") {
    if (/rhizo|soil|streptomy|bacillus/.test(s)) return "soil";
    return "soil";
  }
  if (/root|radix|rhizom|tuber/.test(s)) return "rhizosphere";
  if (/bark|stem|wood|xylem|caulis/.test(s)) return "trunk";
  if (/flower|pollen|nectar|apis/.test(s)) return "sky";
  if (kingdom === "昆虫") return "canopy";
  return "canopy";
}

function loadStructureNames() {
  const map = new Map();
  if (!fs.existsSync(meta)) return map;
  const rl = readline.createInterface({
    input: fs.createReadStream(meta).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let header = null;
  let n = 0;
  return new Promise((resolve) => {
    rl.on("line", (line) => {
      if (!header) {
        header = splitCsv(line);
        return;
      }
      const cells = splitCsv(line);
      const o = {};
      header.forEach((h, i) => (o[h] = cells[i]));
      const key = o.structure_inchikey;
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, {
          nameTraditional: o.structure_nameTraditional || "",
          nameIupac: o.structure_nameIupac || "",
          smiles: o.structure_smiles_2D || o.structure_smiles || "",
          formula: o.structure_molecular_formula || "",
        });
      }
      n++;
      if (n > 400000) rl.close();
    });
    rl.on("close", () => resolve(map));
  });
}

async function loadTriplets() {
  const rows = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(frozen).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let header = null;
  return new Promise((resolve) => {
    rl.on("line", (line) => {
      if (!header) {
        header = splitCsv(line);
        return;
      }
      const cells = splitCsv(line);
      const o = {};
      header.forEach((h, i) => (o[h] = cells[i]));
      if (!o.structure_inchikey || !o.organism_name) return;
      rows.push(o);
      if (rows.length >= LIMIT) rl.close();
    });
    rl.on("close", () => resolve(rows));
  });
}

async function main() {
  if (!fs.existsSync(frozen)) {
    console.error("找不到", frozen);
    process.exit(1);
  }
  console.log("读取 frozen 三元组…");
  const triplets = await loadTriplets();
  console.log("三元组", triplets.length);
  console.log("读取 structure 元数据（可选）…");
  const names = await loadStructureNames();
  console.log("结构元数据", names.size);

  // organism → node
  const byOrg = new Map();
  for (const t of triplets) {
    const org = t.organism_name;
    let node = byOrg.get(org);
    if (!node) {
      const kingdom = kingdomFromOrganism(org);
      const layer = layerFromOrganism(org, kingdom);
      node = {
        id: "lotus-" + org.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
        layer,
        hotspot: { x: 40, y: 40 },
        organismZh: org,
        organismLatin: org,
        kingdom,
        molecules: [],
        ecoRole: "LOTUS frozen 2026-04-13 结构–生物对",
        refs: [],
        featured: true,
        _keys: new Set(),
      };
      byOrg.set(org, node);
    }
    if (node.molecules.length >= 12) continue;
    const key = t.structure_inchikey;
    if (node._keys.has(key)) continue;
    node._keys.add(key);
    const nm = names.get(key) || {};
    const display =
      nm.nameTraditional ||
      (nm.nameIupac ? nm.nameIupac.slice(0, 48) : "未命名产物");
    node.molecules.push({
      nameZh: display,
      nameEn: nm.nameTraditional || "",
      chemClass: nm.formula ? `分子式 ${nm.formula}` : "待归类",
      inchikey: key,
      note: nm.smiles ? "SMILES 已收录（UI 暂不展示）" : "LOTUS frozen 导入",
    });
    if (t.reference_doi && !node.refs.includes(t.reference_doi)) {
      node.refs.push(t.reference_doi);
    }
  }

  const nodes = [...byOrg.values()].map((n) => {
    const { _keys, ...rest } = n;
    rest.refs = rest.refs.slice(0, 3);
    if (!rest.refs.length) rest.refs = ["LOTUS frozen 2026-04-13"];
    return rest;
  });

  const mols = nodes.reduce((a, n) => a + n.molecules.length, 0);
  const ds = {
    meta: {
      title: "天然产物 · LOTUS frozen 导入",
      subtitle: "structure–organism pairs · 2026-04-13 export",
      disclaimer:
        "数据来自 LOTUS Initiative frozen export（约 67 万对全量中的采样子集）。CC0 路径见 data/raw/lotus/README-SNAPSHOT.md。不构成用药建议。",
      snapshotNote: `LOTUS frozen 260413 · 物种 ${nodes.length} · 分子 ${mols}`,
    },
    layers: [
      { id: "sky", label: "天空", hint: "" },
      { id: "canopy", label: "冠层", hint: "" },
      { id: "trunk", label: "树干", hint: "" },
      { id: "rhizosphere", label: "根际", hint: "" },
      { id: "soil", label: "土壤", hint: "" },
    ],
    nodes,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(ds), "utf8");
  console.log("物种节点", nodes.length, "分子", mols);
  console.log("写出", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
