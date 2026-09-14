/**
 * 从 LOTUS frozen 导出全部「有 InChIKey」的结构点（约 22 万）
 * 输出紧凑 JSON，供分子点云直接生成，不走完整 EcoDataset 节点膨胀。
 *
 * 用法: node pipeline/ingest-lotus-structures.mjs
 */

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const frozen = path.join(root, "19360665", "260413_frozen.csv.gz");
const meta = path.join(root, "19360665", "260413_frozen_metadata.csv.gz");
const outPath = path.join(root, "data", "curated", "lotus-structures.json");

function splitCsv(line) {
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
  if (/streptomy|bacillus|pseudomon|mycobacter|escherich|burkholder|enterobact|vibrio|staphyloc|streptococc/.test(s))
    return "细菌";
  if (
    /aspergill|penicill|trichoder|fusarium|beauver|metarhiz|claviceps|tolypocladium|acremonium|saccharopolyspora|candida|cryptococc|rhizopus|mucor/.test(
      s
    )
  )
    return "真菌";
  if (/apis |insecta|coleoptera|lepidoptera|formic|bombus|vespa /.test(s))
    return "昆虫";
  return "植物";
}

function layerFromOrganism(name, kingdom) {
  const s = (name || "").toLowerCase();
  if (kingdom === "细菌" || kingdom === "真菌") return "soil";
  if (/root|radix|rhizom|tuber/.test(s)) return "rhizosphere";
  if (/bark|stem|wood|xylem|caulis/.test(s)) return "trunk";
  if (/flower|pollen|nectar|apis/.test(s)) return "sky";
  if (kingdom === "昆虫") return "canopy";
  return "canopy";
}

async function loadNames() {
  const map = new Map();
  if (!fs.existsSync(meta)) return map;
  const rl = readline.createInterface({
    input: fs.createReadStream(meta).pipe(zlib.createGunzip()),
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
      const key = o.structure_inchikey;
      if (!key || map.has(key)) return;
      map.set(key, o.structure_nameTraditional || "");
    });
    rl.on("close", () => resolve(map));
  });
}

async function streamStructures(names) {
  const seen = new Set();
  const items = [];
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
      const key = o.structure_inchikey;
      if (!key || seen.has(key)) return;
      seen.add(key);
      const org = o.organism_name || "";
      const kingdom = kingdomFromOrganism(org);
      items.push({
        k: key,
        o: org.slice(0, 80),
        q: kingdom,
        l: layerFromOrganism(org, kingdom),
        n: (names.get(key) || "").slice(0, 60),
      });
    });
    rl.on("close", () => resolve(items));
  });
}

async function main() {
  if (!fs.existsSync(frozen)) {
    console.error("缺少", frozen);
    process.exit(1);
  }
  console.log("读结构名…");
  const names = await loadNames();
  console.log("meta keys", names.size);
  console.log("流式去重 InChIKey…");
  const items = await streamStructures(names);
  console.log("可用结构点", items.length);
  const payload = {
    meta: {
      source: "LOTUS frozen 260413",
      tripletsNote: "每 InChIKey 取第一条 organism 作为代表",
      count: items.length,
    },
    items,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload), "utf8");
  const mb = fs.statSync(outPath).size / 1e6;
  console.log("写出", outPath, mb.toFixed(1) + "MB");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
