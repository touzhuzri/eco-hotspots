/**
 * 回答级引用评测（可选，需要已配置对话模型）
 *
 * 用法：
 *   AI_EVAL_CHAT=1 node scripts/citation-eval.mjs
 *   AI_EVAL_BASE=http://127.0.0.1:5173 AI_EVAL_CHAT=1 node scripts/citation-eval.mjs
 *   AI_EVAL_CHAT_LIMIT=8 AI_EVAL_CHAT=1 node scripts/citation-eval.mjs
 *
 * 指标：
 *   Cite@1   回答是否包含期望引用标识（DOI / URL / 文档名）
 *   KW@1     回答是否包含期望关键词
 *   Refuse   局限类问题是否明确说明“不提供 / 不含 / 不能”
 *
 * 注意：这个脚本会真实调用 /api/ai/chat，产生模型费用；默认只跑前 8 题。
 */

import { readFileSync } from "node:fs";

if (String(process.env.AI_EVAL_CHAT || "") !== "1") {
  console.log(
    "未启用。设置 AI_EVAL_CHAT=1 后运行，例如：\n" +
      "  AI_EVAL_CHAT=1 node scripts/citation-eval.mjs"
  );
  process.exit(0);
}

const BASE = (process.env.AI_EVAL_BASE || "http://127.0.0.1:5173").replace(
  /\/+$/,
  ""
);
const LIMIT = Math.max(
  1,
  Math.min(30, Number(process.env.AI_EVAL_CHAT_LIMIT || 8))
);
const MODE = process.env.AI_EVAL_MODE === "research" ? "research" : "chat";
const CASES = JSON.parse(
  readFileSync(new URL("../data/kb-eval/questions.json", import.meta.url), "utf8")
).slice(0, LIMIT);

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

async function ask(question) {
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
      mode: MODE,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let error = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      let event;
      try {
        event = JSON.parse(raw);
      } catch (_) {
        continue;
      }
      if (event.type === "delta") text += event.text || "";
      if (event.type === "replace") text = event.text || "";
      if (event.type === "error") error = String(event.message || "");
    }
  }
  return { text: text.trim(), error };
}

const rows = [];
let cite = 0;
let kw = 0;
let refuse = 0;
let refusalCases = 0;

for (const item of CASES) {
  let answer = "";
  let error = "";
  try {
    const out = await ask(item.q);
    answer = out.text;
    error = out.error;
  } catch (err) {
    error = String(err?.message || err);
  }
  const citationHit = [item.citation, item.doc]
    .filter(Boolean)
    .some((x) => answer.includes(x));
  const keywordHit = (item.keywords || []).some((k) => answer.includes(k));
  const refusalHit =
    item.type === "limitation"
      ? /不提供|不含|没有|不能|无法|不构成|不属于/.test(answer)
      : true;
  if (citationHit) cite++;
  if (keywordHit) kw++;
  if (item.type === "limitation") {
    refusalCases++;
    if (refusalHit) refuse++;
  }
  rows.push({
    q: item.q,
    type: item.type || "other",
    cite: citationHit ? "✓" : "✗",
    kw: keywordHit ? "✓" : "✗",
    refusal: item.type === "limitation" ? (refusalHit ? "✓" : "✗") : "-",
    error,
    answer: answer.slice(0, 100),
  });
}

for (const r of rows) {
  console.log(
    `${r.cite}  引用  ${r.kw}  关键词  ${r.refusal}  局限  [${r.type}] ${r.q}  ${
      r.error ? `错误=${r.error}` : `回答=${r.answer}`
    }`
  );
}

const n = CASES.length || 1;
console.log(`\n## 回答级汇总`);
console.log(`- 题目：${CASES.length} · 模式：${MODE}`);
console.log(`- Cite: ${cite}/${CASES.length} (${pct(cite / n)})`);
console.log(`- KW: ${kw}/${CASES.length} (${pct(kw / n)})`);
if (refusalCases) {
  console.log(
    `- 局限类明确说明：${refuse}/${refusalCases} (${pct(refuse / refusalCases)})`
  );
}
