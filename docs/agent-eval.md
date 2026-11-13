# Agent 任务级评测

评测脚本：`scripts/agent-eval.mjs`  
评测集：`data/agent-eval/tasks.json`（18 条任务）

## 2026-11-13 基线

环境：

```text
对话模型：deepseek-v4-pro
向量模型：BAAI/bge-m3（1024 维）
知识库：14 个文档 / 26 个片段
LOTUS：frozen 260413
```

结果：

| 指标 | 结果 |
| --- | --- |
| 任务通过 | **18/18（100%）** |
| 工具选择 | 18/18（100%） |
| 来源覆盖 | 18/18（100%） |
| 关键词命中 | 18/18（100%） |
| 局限说明（宽松） | 3/3（100%） |
| 研究计划 + 反思 | 1/1（100%） |
| 首字 | 平均 11.22s · P50 7.68s · P90 23.86s |
| 总耗时 | 平均 11.22s · P50 7.68s · P90 23.86s |

说明：

- 本机 deepseek-v4-pro 的正文增量在流末尾集中到达，因此“首字”和“总耗时”数值相同；这里记录的是首个正文事件的时间。
- 知识库是服务端自动检索的。出现 `source` 事件时，不强制模型再调用 `search_knowledge`，否则会把自动检索误判成“没有选工具”。
- 局限说明采用宽松判断（不提供 / 没有 / 不能 / 仅作 / 不构成 等），不要求固定措辞。

## 任务覆盖

| 类别 | 任务数 | 例子 |
| --- | --- | --- |
| LOTUS 查询与聚合 | 6 | 哪个科的黄酮最多、菊科记录数、相似分子、生物碱 |
| 论文 / DOI / 来源 | 4 | quercetin 近五年论文、Nature、知网万方入口、Rutz 2022 |
| 知识库与局限性 | 4 | LOTUS 记录数、药效/临床结论、InChIKey |
| 场景与联网 | 2 | 带我去根际、最新新闻 |
| 表格与数据核对 | 2 | CSV 分组统计、资料 1000 条 vs LOTUS |
| 研究模式 | 1 | 黄酮 vs 生物碱来源科分布 + 简报 |
| 安全边界 | 1 | 能否用于临床用药建议 |

## 复现

```bash
# 启动站点 + AI
./start.sh daemon

# 全量评测（会调用真实模型）
AGENT_EVAL=1 node scripts/agent-eval.mjs

# 只跑前 5 条
AGENT_EVAL=1 AGENT_EVAL_LIMIT=5 node scripts/agent-eval.mjs

# 保存明细到 data/agent-eval/last-run.json
AGENT_EVAL=1 AGENT_EVAL_SAVE=1 node scripts/agent-eval.mjs
```

自定义服务地址：

```bash
AI_EVAL_BASE=http://127.0.0.1:8790 AGENT_EVAL=1 node scripts/agent-eval.mjs
```

## 已知限制

- 18 条任务只能作为回归基线，不代表全部真实问题。
- 关键词判断是字符串包含，不判断语义是否完全正确。
- 评测会产生模型费用，默认不运行；需要 `AGENT_EVAL=1`。
- 与 `scripts/e2e-ai.mjs` 的分工：E2E 用 mock 验证工程链路，Agent 评测用真实模型验证任务完成情况。
