#!/usr/bin/env node
/**
 * 打印 AI 服务运行指标：node scripts/metrics.mjs
 *
 * 环境变量：
 *   AI_EVAL_BASE  站点地址，默认 http://127.0.0.1:5173
 *   AI_METRICS_URL 直接指定指标地址（跳过站点代理）
 */

const base = String(process.env.AI_EVAL_BASE || "http://127.0.0.1:5173").replace(
  /\/+$/,
  ""
);
const url = process.env.AI_METRICS_URL || `${base}/api/ai/metrics`;

function ms(v) {
  const n = Number(v || 0);
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${Math.round(n)}ms`;
}

function pct(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

try {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    console.error(`指标接口返回 ${res.status}:`, data);
    process.exit(1);
  }
  const { chat = {}, model = {}, tools = {}, vision = {}, papers = {} } = data;

  console.log(`指标来源: ${url}`);
  console.log(
    `运行时长: ${(Number(data.uptimeMs || 0) / 1000 / 60).toFixed(1)} 分钟`
  );
  console.log("");
  console.log("对话");
  console.log(`  请求 ${chat.requests ?? 0} · 完成 ${chat.completed ?? 0} · 停止 ${chat.aborted ?? 0} · 错误 ${chat.errors ?? 0} · 进行中 ${chat.inflight ?? 0}`);
  console.log(`  最近一次: ${chat.lastAt || "—"}`);
  console.log("");
  console.log("模型");
  console.log(`  调用 ${model.calls ?? 0} · 错误 ${model.errors ?? 0} · 重试 ${model.retries ?? 0}`);
  console.log(`  平均耗时 ${ms(model.avgLatencyMs)} · 最长 ${ms(model.maxLatencyMs)}`);
  console.log("");
  console.log("工具");
  console.log(`  调用 ${tools.calls ?? 0} · 错误 ${tools.errors ?? 0} · 成功率 ${pct(tools.successRate)}`);
  console.log(`  平均耗时 ${ms(tools.avgLatencyMs)}`);
  const byName = tools.byName || {};
  for (const [name, s] of Object.entries(byName)) {
    console.log(
      `    ${name.padEnd(22)} ${String(s.calls).padStart(4)} 次 · 错误 ${String(s.errors).padStart(3)} · 平均 ${ms(s.avgLatencyMs)}`
    );
  }
  console.log("");
  console.log(
    `视觉 ${vision.calls ?? 0} 次（错误 ${vision.errors ?? 0}） · 文献检索 ${papers.searches ?? 0} 次`
  );
} catch (err) {
  console.error(`无法读取指标 ${url}: ${String(err?.message || err)}`);
  console.error("请确认站点和 AI 服务已启动（./start.sh status）。");
  process.exit(1);
}
