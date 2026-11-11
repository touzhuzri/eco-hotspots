/**
 * RAG 检索评测（零依赖）
 *
 * 用法：
 *   node scripts/rag-eval.mjs
 *   AI_EVAL_BASE=http://127.0.0.1:5173 node scripts/rag-eval.mjs
 *   AI_EVAL_LIMIT=5 node scripts/rag-eval.mjs
 *
 * 指标：
 *   Hit@4    期望文档是否出现在前 4 条
 *   MRR      期望文档排名的倒数（第 1 名 = 1，未命中 = 0）
 *   KW@4     前 4 条片段是否包含期望关键词
 *
 * 评测集在 data/kb-eval/questions.json；新增问题只需补 doc / keywords。
 */

import { readFileSync } from "node:fs";

const BASE = (process.env.AI_EVAL_BASE || "http://127.0.0.1:5173").replace(
  /\/+$/,
  ""
);
const LIMIT = Math.max(1, Math.min(10, Number(process.env.AI_EVAL_LIMIT || 5)));
const TOP_K = Math.min(4, LIMIT);
const CASES = JSON.parse(
  readFileSync(new URL("../data/kb-eval/questions.json", import.meta.url), "utf8")
);

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

const rows = [];
let hit4 = 0;
let mrr = 0;
let kw4 = 0;

const health = await getJson("/api/ai/health").catch(() => null);
const kb = health?.kb || {};
const vectorModel = kb.modelActual || kb.model || "unknown";
const configured =
  kb.model && kb.model !== vectorModel ? `（配置 ${kb.model}）` : "";
console.log(`# RAG 检索评测`);
console.log(`- 服务：${BASE}`);
console.log(
  `- 向量：${vectorModel}${configured} · 文档 ${kb.docs ?? "?"} / 片段 ${kb.chunks ?? "?"}`
);
console.log(`- 评测集：${CASES.length} 题 · 取前 ${TOP_K} 条\n`);

for (const item of CASES) {
  let hits = [];
  let error = "";
  try {
    const data = await getJson(
      `/api/ai/kb/search?q=${encodeURIComponent(item.q)}&limit=${LIMIT}`
    );
    hits = Array.isArray(data.hits) ? data.hits : [];
  } catch (err) {
    error = String(err?.message || err);
  }

  const rank = hits.findIndex((h) => h.name === item.doc) + 1;
  const top = hits.slice(0, TOP_K);
  const keywordHit = top.some((h) =>
    (item.keywords || []).some((k) => String(h.snippet || "").includes(k))
  );
  const found = rank > 0 && rank <= TOP_K;

  if (found) hit4++;
  if (rank > 0) mrr += 1 / rank;
  if (keywordHit) kw4++;

  rows.push({
    q: item.q,
    expected: item.doc,
    rank: rank || "-",
    hit: found ? "✓" : "✗",
    kw: keywordHit ? "✓" : "✗",
    top: hits[0]?.name || error || "-",
  });
}

const width = Math.max(...rows.map((r) => [...r.q].length), 8);
for (const r of rows) {
  const pad = " ".repeat(Math.max(0, width - [...r.q].length));
  console.log(
    `${r.hit}  ${r.q}${pad}  期望=${r.expected}  排名=${r.rank}  关键词=${r.kw}  首条=${r.top}`
  );
}

const n = CASES.length || 1;
console.log(`\n## 汇总`);
console.log(`- Hit@${TOP_K}: ${hit4}/${CASES.length} (${pct(hit4 / n)})`);
console.log(`- MRR: ${(mrr / n).toFixed(3)}`);
console.log(`- KW@${TOP_K}: ${kw4}/${CASES.length} (${pct(kw4 / n)})`);

if (hit4 / n < 0.6) {
  console.log(
    "\n提示：命中率偏低时，先在设置面板配置支持 /embeddings 的向量模型，点“重建向量”后再跑一次。"
  );
}
