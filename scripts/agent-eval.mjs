#!/usr/bin/env node
/**
 * Agent 任务级评测：工具选择、来源覆盖、关键词、局限说明、首字/总耗时。
 *
 * 需要真实模型服务：
 *   AGENT_EVAL=1 node scripts/agent-eval.mjs
 * 只跑前 5 条：
 *   AGENT_EVAL=1 AGENT_EVAL_LIMIT=5 node scripts/agent-eval.mjs
 * 保存明细：
 *   AGENT_EVAL=1 AGENT_EVAL_SAVE=1 node scripts/agent-eval.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TASKS_FILE = join(ROOT, "data", "agent-eval", "tasks.json");
const BASE = String(process.env.AI_EVAL_BASE || "http://127.0.0.1:5173").replace(
  /\/+$/,
  ""
);

if (!/^(1|true|yes)$/i.test(process.env.AGENT_EVAL || "")) {
  console.log("Agent 评测会调用真实模型并产生费用。确认后运行：");
  console.log("  AGENT_EVAL=1 node scripts/agent-eval.mjs");
  console.log("可加 AGENT_EVAL_LIMIT=5 只跑前 5 条。");
  process.exit(0);
}

const tasks = JSON.parse(await readFile(TASKS_FILE, "utf8"));
const limit = Math.max(0, Number(process.env.AGENT_EVAL_LIMIT || tasks.length));
const list = tasks.slice(0, limit || tasks.length);

const LIMIT_RE = /不提供|没有|不能|无法|不含|不包含|仅作|不构成|建议咨询|就医|不能替代/;
const LOTUS_TOOLS = new Set([
  "query_molecules",
  "find_similar",
  "explain",
  "verify_claim",
]);

function fmt(ms) {
  if (!Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function pct(n, d) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "—";
}

function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx];
}

async function readEvents(res) {
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          events.push(JSON.parse(data));
        } catch (_) {}
      }
    }
  }
  return events;
}

async function runTask(task) {
  const t0 = performance.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180000);
  const body = {
    messages: [{ role: "user", content: task.q }],
    ...(task.mode === "research" ? { mode: "research" } : {}),
    ...(task.attachment ? { attachments: [task.attachment] } : {}),
  };
  try {
    const res = await fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      return {
        task,
        error: `HTTP ${res.status}`,
        firstMs: NaN,
        totalMs: performance.now() - t0,
        tools: [],
        sources: 0,
        answer: "",
        plan: false,
        reflection: false,
        pass: false,
      };
    }
    const events = await readEvents(res);
    let firstMs = NaN;
    let totalMs = NaN;
    let answer = "";
    let sources = 0;
    let plan = false;
    let reflection = false;
    const tools = [];
    for (const ev of events) {
      const ts = performance.now() - t0;
      if (ev.type === "delta" || ev.type === "replace") {
        if (Number.isNaN(firstMs) && String(ev.text || "").trim()) firstMs = ts;
        if (ev.type === "replace") answer = String(ev.text || "");
        else answer += String(ev.text || "");
      } else if (ev.type === "tool") {
        tools.push(String(ev.name || ""));
      } else if (ev.type === "source") {
        sources += Array.isArray(ev.items) ? ev.items.length : 1;
      } else if (ev.type === "plan") {
        plan = true;
      } else if (ev.type === "reflection") {
        reflection = true;
      } else if (ev.type === "done") {
        totalMs = ts;
      }
    }
    if (Number.isNaN(totalMs)) totalMs = performance.now() - t0;
    return {
      task,
      firstMs,
      totalMs,
      tools: [...new Set(tools)],
      sources,
      answer,
      plan,
      reflection,
    };
  } catch (err) {
    return {
      task,
      error: String(err?.message || err).slice(0, 120),
      firstMs: NaN,
      totalMs: performance.now() - t0,
      tools: [],
      sources: 0,
      answer: "",
      plan: false,
      reflection: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

function sourceHit(task, r) {
  const expected = Array.isArray(task.source) ? task.source : [task.source];
  return expected.some((s) => {
    if (s === "lotus") return r.tools.some((t) => LOTUS_TOOLS.has(t));
    if (s === "paper") {
      return (
        r.tools.includes("search_papers") ||
        r.tools.includes("list_research_sources")
      );
    }
    if (s === "kb") return r.sources > 0 || r.tools.includes("search_knowledge");
    if (s === "web") return r.tools.includes("web_search");
    if (s === "none") return true;
    return false;
  });
}

function score(r) {
  const task = r.task;
  const expectedTools = Array.isArray(task.tools) ? task.tools : [];
  // 知识库是服务端自动检索的：有 source 事件时，不强制模型再调 search_knowledge
  const toolHit =
    expectedTools.length === 0 ||
    expectedTools.some((t) => r.tools.includes(t)) ||
    (expectedTools.includes("search_knowledge") && r.sources > 0);
  const sourceHitOk = sourceHit(task, r);
  const keywords = Array.isArray(task.keywords) ? task.keywords : [];
  const lower = String(r.answer || "").toLowerCase();
  const keywordHit =
    keywords.length === 0 || keywords.some((k) => lower.includes(String(k).toLowerCase()));
  const limitationHit = task.limitation ? LIMIT_RE.test(r.answer || "") : null;
  const researchHit = task.expectResearch ? r.plan && r.reflection : true;
  const pass = toolHit && keywordHit && researchHit;
  return {
    pass,
    toolHit,
    sourceHit: sourceHitOk,
    keywordHit,
    limitationHit,
  };
}

console.log(`# Agent 任务级评测`);
console.log(`- 服务：${BASE}`);
console.log(`- 任务：${list.length} 条`);
console.log("");

const rows = [];
for (const task of list) {
  const r = await runTask(task);
  const s = score(r);
  rows.push({ ...r, score: s });
  const toolText = r.tools.length ? r.tools.join(",") : "无";
  console.log(
    `${s.pass ? "✓" : "✗"}  ${task.id.padEnd(24)} 工具=${toolText.padEnd(
      28
    )} 来源=${s.sourceHit ? "✓" : "—"} 首字=${fmt(
      r.firstMs
    )} 总耗时=${fmt(r.totalMs)}${r.error ? ` 错误=${r.error}` : ""}`
  );
}

const n = rows.length;
const pass = rows.filter((r) => r.score.pass).length;
const toolOk = rows.filter((r) => r.score.toolHit).length;
const sourceOk = rows.filter((r) => r.score.sourceHit).length;
const keywordOk = rows.filter((r) => r.score.keywordHit).length;
const limitationRows = rows.filter((r) => r.task.limitation);
const limitationOk = limitationRows.filter((r) => r.score.limitationHit).length;
const researchRows = rows.filter((r) => r.task.expectResearch);
const researchOk = researchRows.filter(
  (r) => r.plan && r.reflection
).length;
const firsts = rows.map((r) => r.firstMs).filter(Number.isFinite);
const totals = rows.map((r) => r.totalMs).filter(Number.isFinite);

console.log("");
console.log("## 汇总");
console.log(`- 任务通过：${pass}/${n}（${pct(pass, n)}）`);
console.log(`- 工具选择：${toolOk}/${n}（${pct(toolOk, n)}）`);
console.log(`- 来源覆盖：${sourceOk}/${n}（${pct(sourceOk, n)}）`);
console.log(`- 关键词命中：${keywordOk}/${n}（${pct(keywordOk, n)}）`);
if (limitationRows.length) {
  console.log(
    `- 局限说明（宽松）：${limitationOk}/${limitationRows.length}（${pct(
      limitationOk,
      limitationRows.length
    )}）`
  );
}
if (researchRows.length) {
  console.log(
    `- 研究计划+反思：${researchOk}/${researchRows.length}（${pct(
      researchOk,
      researchRows.length
    )}）`
  );
}
if (firsts.length) {
  console.log(
    `- 首字：平均 ${fmt(
      firsts.reduce((a, b) => a + b, 0) / firsts.length
    )} · P50 ${fmt(percentile(firsts, 50))} · P90 ${fmt(
      percentile(firsts, 90)
    )}`
  );
}
if (totals.length) {
  console.log(
    `- 总耗时：平均 ${fmt(
      totals.reduce((a, b) => a + b, 0) / totals.length
    )} · P50 ${fmt(percentile(totals, 50))} · P90 ${fmt(
      percentile(totals, 90)
    )}`
  );
}

if (/^(1|true|yes)$/i.test(process.env.AGENT_EVAL_SAVE || "")) {
  const out = join(ROOT, "data", "agent-eval", "last-run.json");
  await writeFile(
    out,
    JSON.stringify(
      {
        base: BASE,
        at: new Date().toISOString(),
        tasks: rows.map((r) => ({
          id: r.task.id,
          q: r.task.q,
          pass: r.score.pass,
          toolHit: r.score.toolHit,
          sourceHit: r.score.sourceHit,
          keywordHit: r.score.keywordHit,
          limitationHit: r.score.limitationHit,
          tools: r.tools,
          firstMs: Number.isFinite(r.firstMs) ? Math.round(r.firstMs) : null,
          totalMs: Number.isFinite(r.totalMs) ? Math.round(r.totalMs) : null,
          error: r.error || "",
          answer: String(r.answer || "").slice(0, 1200),
        })),
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`- 明细已写入 ${out}`);
}

process.exit(pass / n >= 0.6 ? 0 : 1);
