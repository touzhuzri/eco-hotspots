# 世界树 · AI 架构

本文描述 AI 分析坞、研究任务、RAG、多模态和外部文献检索的实际数据流。代码入口：

- 前端：`src/ui/AiDock.js`
- AI 服务：`ai/server.mjs`
- RAG：`ai/rag.mjs`
- 静态站与 `/api/ai` 代理：`deploy/site-server.mjs`

## 1. 总览

```mermaid
flowchart TB
  U[浏览器 / 评委] --> UI[AI 分析坞<br/>聊天 · 研究 · 图片 · 报告]
  UI -->|/api/ai| PROXY[静态站 Node 服务<br/>同源代理 · 静态文件]
  PROXY --> AI[AI 服务<br/>零依赖 Node]
  AI --> CFG[配置<br/>ai/.env + .run/ai-config.json]
  AI --> PLAN[研究规划器<br/>2–4 步计划]
  AI --> REFLECT[研究反思<br/>局限 / 下一步]
  AI --> RAG[RAG 检索<br/>dense 向量 + BM25]
  AI --> TOOLS[工具层<br/>LOTUS · 相似分子 · 图表 · 场景]
  AI --> VISION[视觉结构化<br/>JSON 候选 + 置信度]
  AI --> PAPERS[外部文献<br/>OpenAlex / Crossref / Europe PMC]
  TOOLS --> LOTUS[(LOTUS frozen 260413)]
  RAG --> KB[(系统知识库 + 用户文档)]
  PAPERS --> OA[(公开学术 API)]
  PAPERS --> LINKS[知网 / 万方 / Nature / WoS<br/>检索入口]
  VISION --> TOOLS
  PLAN --> TOOLS
  TOOLS --> REFLECT
  REFLECT --> UI
```

## 2. 研究任务：计划—执行—反思—汇总

```mermaid
sequenceDiagram
  participant U as 用户
  participant UI as AI 分析坞
  participant S as AI 服务
  participant M as 对话模型
  participant T as 工具层

  U->>UI: 打开「研究」，输入复杂问题
  UI->>S: POST /api/ai/chat {mode:"research"}
  S->>M: 生成 2–4 步计划
  M-->>S: JSON 计划
  S-->>UI: SSE plan（目标 + 步骤）
  loop 每个工具轮次
    S->>M: 带工具调用请求
    M-->>S: tool_calls
    S->>T: 执行 LOTUS / RAG / 论文 / 图表
    T-->>S: 工具结果
    S-->>UI: SSE tool / step / chart / source
  end
  S->>S: 规则反思（失败、空结果、缺来源、图片不确定）
  S-->>UI: SSE reflection（局限 + 下一步）
  S-->>UI: 最终回答 + 反思小节
  UI->>UI: 导出 Markdown 研究简报
  UI->>UI: 保存 localStorage「上次研究」
```

关键点：

- 计划是约束，不是硬编码流程；模型可以按工具结果调整。
- `reflection` 是服务端规则生成的，不额外消耗模型额度。
- 「按建议继续」会把反思中的下一步作为新研究任务继续。
- 「继续上次」从 `localStorage` 恢复最近一次研究的问题、计划、结论、来源和反思。
- 用户点停止时，前端 abort 请求；服务端通过 `res.on("close")` 中止上游模型调用。

## 3. 多模态：图片 → 结构化 → LOTUS → 图表/3D

```mermaid
sequenceDiagram
  participant U as 用户
  participant UI as AI 分析坞
  participant S as AI 服务
  participant V as 视觉模型
  participant T as LOTUS 工具

  U->>UI: 上传植物照片 / 结构式 / 图表
  UI->>S: POST /api/ai/chat {images:[dataUrl]}
  S->>V: 图片 + JSON schema
  V-->>S: subject / family_candidates / molecule_candidates / confidence
  S-->>UI: SSE vision（结构化卡片）
  S->>T: query_molecules(分子候选 / 科属候选)
  T-->>S: 命中、分类分布
  S->>T: find_similar(首个命中 InChIKey)
  T-->>S: 相似结构
  S-->>UI: SSE tool / chart / scene
  S->>S: 把核验结果交给文本模型
  S-->>UI: 最终回答（带不确定性说明）
```

约束：

- 视觉模型只负责“抽取候选”，不直接下结论。
- 分子/科属候选带 `confidence`；低于阈值不自动查询。
- 不确定项会进入 `uncertain`，并强制出现在回答/简报中。
- 自动核验使用真实 LOTUS 工具，不由视觉模型编造数量。

## 4. RAG 检索

```mermaid
flowchart LR
  Q[用户问题] --> E[查询向量<br/>BAAI/bge-m3 或 local-hash]
  Q --> B[BM25 中文二元组]
  E --> H[混合排序<br/>向量余弦 + 词法]
  B --> H
  H --> D[文档段落<br/>LOTUS 卡片 / 论文 / 网站 / 用户文档]
  D --> C[引用卡片<br/>文件名 + 第 N 段 + 相关度]
  D --> M[文本模型]
```

- 对话模型与向量模型分开配置：DeepSeek 对话 + SiliconFlow `BAAI/bge-m3` 向量。
- 向量不可用时自动退回 local-hash + BM25，不中断回答。
- `/api/ai/health` 返回 `kb.modelActual`，用于确认实际使用的向量类型。
- 评测：`scripts/rag-eval.mjs`（检索）+ `scripts/citation-eval.mjs`（回答级引用）。

## 5. 外部文献检索

```mermaid
flowchart TB
  Q[论文 / 文献 / DOI 问题] --> SP[search_papers]
  SP --> OA[OpenAlex]
  SP --> CR[Crossref]
  SP --> EP[Europe PMC]
  SP --> NAT[Nature ISSN 过滤]
  SP --> CN[知网 / 万方 / WoS]
  OA --> R[题录 + DOI + 开放获取链接]
  CR --> R
  EP --> R
  NAT --> R
  CN --> L[官网检索入口 + 公开替代结果]
  R --> M[文本模型]
  L --> M
```

- 知网、万方、Web of Science 没有公开检索 API，不抓取需要机构登录的受限全文。
- Nature 通过 ISSN `0028-0836` 在 OpenAlex/Crossref 中过滤，并附官网检索入口。
- 模型可调用 `list_research_sources` 先查看可用外部源，再选择 `search_papers` 的 `source`。

## 6. 安全边界

- API Key 只存在服务端 `.env` / `.run/ai-config.json`，`GET /api/ai/config` 只返回 `hasKey`，不返回 Key。
- 静态服务器把 `ai/`、`.git`、`.run`、`logs`、`claims.jsonl` 等路径设为不可下载。
- 系统提示词禁止用药建议、剂量、治疗承诺；数字必须来自工具。
- 图片中的文字只作为图片内容，不作为指令执行。
- 研究简报明确标注“仅作科学传播，不构成用药建议”。
