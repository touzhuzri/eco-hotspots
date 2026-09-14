/**
 * LOTUS → 站用 EcoDataset 灌库骨架
 *
 * 输入（任选其一，自动探测）：
 *   data/raw/lotus/*.tsv|.csv|.json
 *   或 --in <path>
 *
 * 输出：
 *   data/curated/lotus-eco.json   符合 src/data/contract.js
 *
 * 用法：
 *   node pipeline/lotus-ingest.mjs
 *   node pipeline/lotus-ingest.mjs --in data/raw/lotus/lotus.tsv --limit 500
 *   node pipeline/lotus-ingest.mjs --fixture   # 用内置小样跑通
 *
 * 说明：
 * - 只做字段归一 + 按来源粗分 kingdom/layer，不做农药用途标注。
 * - InChIKey / 学名未人工核验前，refs 标注「LOTUS 自动导入·待核对」。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const rawDir = path.join(root, "data", "raw", "lotus");
const outDir = path.join(root, "data", "curated");

const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const limit = Number(flag("--limit", "400"));
const inFile = flag("--in", null);
const useFixture = argv.includes("--fixture");

/** 内置 fixture：验证管线形状（非完整 LOTUS） */
const FIXTURE = [
  {
    inchikey: "NZHQPITWJEXOGW-UHFFFAOYSA-N",
    smiles: null,
    organism: "Azadirachta indica",
    organismZh: "印楝",
    kingdomHint: "plant",
    layerHint: "canopy",
    nameEn: "Azadirachtin",
    nameZh: "印楝素",
    chemClass: "terpenoid",
    doi: null,
  },
  {
    inchikey: "HKTQHSLKXBLFRH-UHFFFAOYSA-N",
    organism: "Beauveria bassiana",
    organismZh: "球孢白僵菌",
    kingdomHint: "fungus",
    layerHint: "soil",
    nameEn: "Beauvericin",
    nameZh: "白僵菌素",
    chemClass: "depsipeptide",
    doi: null,
  },
  {
    inchikey: "DCFYFFDGCXSDQY-UHFFFAOYSA-N",
    organism: "Mylabris spp.",
    organismZh: "斑蝥",
    kingdomHint: "insect",
    layerHint: "canopy",
    nameEn: "Cantharidin",
    nameZh: "斑蝥素",
    chemClass: "terpenoid",
    doi: null,
  },
];

function kingdomFromHint(h, organism) {
  const s = (h || organism || "").toLowerCase();
  if (/bacter|bacillus|pseudomonas|streptomy/.test(s)) return "细菌";
  if (/fung|asperg|trichoder|beauver|metarhiz|penicill/.test(s))
    return "真菌";
  if (/insect|coleoptera|lepidoptera|hymenoptera|mylabris|paederus|apis /.test(s))
    return "昆虫";
  if (/plant|leaf|bark|root|herba|folium|semen/.test(s)) return "植物";
  return "植物";
}

function layerFromHint(h, kingdom) {
  if (h && ["canopy", "trunk", "rhizosphere", "soil", "sky"].includes(h)) {
    return h;
  }
  if (kingdom === "细菌" || kingdom === "真菌") return "soil";
  if (kingdom === "昆虫") return "canopy";
  return "canopy";
}

function pickFields(obj) {
  // 宽松键名：兼容多种导出表头
  const get = (...keys) => {
    for (const k of keys) {
      if (obj[k] != null && obj[k] !== "") return obj[k];
      const found = Object.keys(obj).find(
        (x) => x.toLowerCase() === k.toLowerCase()
      );
      if (found && obj[found]) return obj[found];
    }
    return null;
  };
  return {
    inchikey: get("inchikey", "InChIKey", "inchi_key"),
    smiles: get("smiles", "SMILES"),
    inchi: get("inchi", "InChI"),
    organism: get("organism", "organismName", "taxon", "species", "canonical_name"),
    organismZh: get("organismZh", "organism_zh"),
    nameEn: get("nameEn", "name", "moleculeName", "compound"),
    nameZh: get("nameZh", "name_zh"),
    chemClass: get("chemClass", "class", "chemicalClass", "superclass"),
    doi: get("doi", "DOI", "reference", "ref"),
    kingdomHint: get("kingdomHint", "kingdom"),
    layerHint: get("layerHint", "layer"),
  };
}

function loadRows() {
  if (useFixture) return FIXTURE.map(pickFields);
  const file =
    inFile ||
    fs
      .readdirSync(rawDir)
      .filter((f) => /\.(tsv|csv|json)$/i.test(f))
      .filter((f) => !/meta\.json$/i.test(f))
      .map((f) => path.join(rawDir, f))
      .sort()
      .pop();
  if (!file) {
    console.error(
      "未找到 raw LOTUS 文件。请放入 data/raw/lotus/ 或使用 --fixture 验证管线。"
    );
    process.exit(1);
  }
  console.log("读取", file);
  const text = fs.readFileSync(file, "utf8");
  if (/\.json$/i.test(file)) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data.rows || data.data || [];
    return arr.slice(0, limit).map(pickFields);
  }
  const delim = file.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = splitLine(lines[0], delim);
  const rows = [];
  for (let i = 1; i < lines.length && rows.length < limit; i++) {
    const cells = splitLine(lines[i], delim);
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = cells[idx];
    });
    rows.push(pickFields(obj));
  }
  return rows;
}

function splitLine(line, delim) {
  // 简易切分（未处理引号内逗号；正式库建议用 csv 解析）
  return line.split(delim).map((s) => s.trim().replace(/^"|"$/g, ""));
}

function toDataset(rows) {
  const nodes = [];
  const seen = new Map();
  for (const r of rows) {
    if (!r.organism && !r.organismZh) continue;
    const kingdom = kingdomFromHint(r.kingdomHint, r.organism);
    const layer = layerFromHint(r.layerHint, kingdom);
    const key = (r.organismZh || r.organism || "unknown") + "|" + kingdom;
    let node = seen.get(key);
    if (!node) {
      node = {
        id: "lotus-" + slug(key),
        layer,
        hotspot: { x: 40 + (nodes.length % 20), y: 30 + (nodes.length % 40) },
        organismZh: r.organismZh || r.organism,
        organismLatin: r.organism || r.organismZh,
        kingdom,
        molecules: [],
        ecoRole: "LOTUS 结构–生物对（自动归层）",
        refs: r.doi ? [r.doi] : ["LOTUS 自动导入·待核对"],
      };
      seen.set(key, node);
      nodes.push(node);
    }
    const molId = r.inchikey || r.nameEn || r.smiles || "mol";
    if (node.molecules.some((m) => (m.inchikey || m.nameEn) === molId)) continue;
    node.molecules.push({
      nameZh: r.nameZh || r.nameEn || "未命名产物",
      nameEn: r.nameEn || r.nameZh || "",
      chemClass: r.chemClass || "待归类",
      inchikey: r.inchikey || null,
      note: r.smiles ? `SMILES 已收录（未在 UI 展示）` : "来自 LOTUS 自动导入",
    });
  }
  return {
    meta: {
      title: "天然产物 · LOTUS 灌库集",
      subtitle: "由 pipeline/lotus-ingest.mjs 从 raw 快照生成；用途层仍空",
      disclaimer:
        "本集由 LOTUS（CC0）自动归层导入，InChIKey/学名与树层映射未经人工逐条核验。不构成用药建议。",
      snapshotNote: "LOTUS ingest · " + new Date().toISOString().slice(0, 10),
    },
    layers: [
      { id: "sky", label: "天空", hint: "飞行生物与空中叙事" },
      { id: "canopy", label: "冠层", hint: "叶面与嫩枝" },
      { id: "trunk", label: "树干", hint: "茎干与树皮" },
      { id: "rhizosphere", label: "根际", hint: "根系共生" },
      { id: "soil", label: "土壤", hint: "腐生与土壤微生物" },
    ],
    nodes,
  };
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function main() {
  const rows = loadRows();
  console.log("行数", rows.length);
  const ds = toDataset(rows);
  console.log("节点", ds.nodes.length, "分子", ds.nodes.reduce((a, n) => a + n.molecules.length, 0));
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "lotus-eco.json");
  fs.writeFileSync(outFile, JSON.stringify(ds, null, 2), "utf8");
  console.log("写出", outFile);
}

main();
