# 世界树 · 性能与运行指标

本文说明怎么测量、怎么记录、怎么把数据写进参赛材料。原则：**只写实测数字，不写估计值**。

## 1. 指标口径

| 指标 | 口径 | 来源 |
| --- | --- | --- |
| 首屏可交互 | `navigationStart` → 世界树入场完成的第一帧 | 浏览器 Performance API |
| 静态资源体积 | `dist` 等价目录的 JS/CSS/data 总和 | `du` 或 DevTools Network |
| LOTUS 查询延迟 | 工具 `query_molecules` 从进入到返回 | `/api/ai/metrics` → `tools.byName` |
| 模型平均延迟 | 每次 `/chat/completions` 总耗时（含流式输出） | `/api/ai/metrics` → `model.avgLatencyMs` |
| 工具成功率 | `1 - 工具错误 / 工具调用` | `/api/ai/metrics` → `tools.successRate` |
| 停止生效 | 用户点「■」后是否计入 `chat.aborted`，上游是否中止 | `/api/ai/metrics` → `chat.aborted` + `logs/ai.log` |
| 检索质量 | Hit@4 / MRR / KW@4 / Cite@4 | `node scripts/rag-eval.mjs` |
| 回答引用 | 回答是否包含期望 DOI/URL/文档名 | `node scripts/citation-eval.mjs` |

指标是**内存态**，服务重启清零；只统计数量和耗时，不记录问题正文、图片内容或 API Key。

## 2. 服务端指标

```bash
./start.sh daemon
node scripts/metrics.mjs
# 或直接
curl -s http://127.0.0.1:5173/api/ai/metrics
```

输出示例（字段说明，不是实测基线）：

```json
{
  "chat":   { "requests": 12, "completed": 11, "aborted": 1, "errors": 0, "inflight": 0 },
  "model":  { "calls": 37, "errors": 0, "retries": 1, "avgLatencyMs": 2140, "maxLatencyMs": 8900 },
  "tools":  { "calls": 28, "errors": 2, "successRate": 0.929, "avgLatencyMs": 46 },
  "vision": { "calls": 2, "errors": 0 },
  "papers": { "searches": 3 }
}
```

记录方式：每次演示或评测前重启服务 → 跑固定问题集 → 立刻导出一次指标。把 `chat.aborted` 与演示中实际点击停止的次数对照，可以证明“服务端真的停了”，而不是只断开浏览器。

### 固定问题集（建议 6 条）

1. `哪个科的黄酮最多？画分布图，并带我去看。`
2. `给我 5 个分子量 300–500 的黄酮，并解释它们的来源科。`
3. `quercetin 和相近结构有什么差异？找相似分子。`
4. `检索 quercetin 近五年的论文，优先 Nature，给出 DOI。`
5. `上传 demo/quercetin.png，判断分子并查 LOTUS。`
6. 研究模式：`总结知识库里关于黄酮的内容，并和 LOTUS 数字核对，给出可核对出处。`

每条记录：首字延迟、总耗时、模型调用数、工具调用数与成功率。

## 3. 前端首屏

在浏览器控制台执行：

```js
const nav = performance.getEntriesByType("navigation")[0];
const paint = performance.getEntriesByName("first-contentful-paint")[0];
console.log({
  domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
  load: Math.round(nav.loadEventEnd),
  firstContentfulPaint: Math.round(paint?.startTime || 0),
  worldTreeReady: Math.round(window.__worldTreeReadyAt || 0),
});
```

`window.__worldTreeReadyAt` 已在 `src/scene/TreeScene.js` 入场完成时写入（单位 ms，相对页面加载），用于记录“世界树完全长成”的时间点。

Lighthouse：Chrome DevTools → Lighthouse → Performance，移动端和桌面端各跑一次，记录 LCP / TBT / CLS。静态数据分片按需加载，首屏不应等待全部 LOTUS 分片。

## 4. 端到端延迟

```bash
# 记录首字和总耗时（SSE 流）
curl -N -s -X POST http://127.0.0.1:5173/api/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"哪个科的黄酮最多？"}]}' \
  | awk '{ print strftime("%H:%M:%S"), $0 }'
```

或用浏览器 DevTools → Network → `chat` → Timing / EventStream，看首个 `delta` 与 `done` 的时间差。

## 5. 检索评测

```bash
node scripts/rag-eval.mjs
AI_EVAL_CHAT=1 AI_EVAL_CHAT_LIMIT=8 node scripts/citation-eval.mjs
```

结果记录到 [`rag-eval.md`](rag-eval.md)，包含 Hit@4、MRR、KW@4、Cite@4。更换向量模型或切块参数后重跑，保留前后对比。

## 6. 参赛材料表格模板

| 项目 | 数值 | 测量条件 |
| --- | --- | --- |
| LOTUS 记录数 | 227,319 | frozen 260413 |
| 检索 Hit@4 | 30/30（100%） | 2026-11-13，30 题，`bge-m3` 1024 维，14 文档 / 26 片段 |
| 检索 MRR | 1.000 | 同上 |
| Cite@4 | 30/30（100%） | 同上 |
| Agent 任务通过 | 18/18（100%） | 2026-11-13，`deepseek-v4-pro`，18 条任务 |
| Agent 工具选择 | 18/18（100%） | 同上 |
| Agent 来源覆盖 | 18/18（100%） | 同上 |
| Agent 局限说明（宽松） | 3/3（100%） | 同上 |
| 首字 / 总耗时 | 平均 11.22s · P50 7.68s · P90 23.86s | 同上；该服务商正文增量在流末尾集中到达 |
| 回答引用准确率 | 待实测 | `citation-eval.mjs`，8 题 |
| 工具成功率 | 待实测 | `/api/ai/metrics` 固定问题集 |
| 模型平均延迟 | 待实测 | `/api/ai/metrics` |
| 首屏 LCP | 待实测 | Lighthouse 桌面端 |

> 提交前把「待实测」替换成当次运行的真实数字，并注明日期、模型、向量模型和文档数量。不同机器、不同服务商的结果不要混在同一行。
