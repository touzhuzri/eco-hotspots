# Agent 任务级评测集

`tasks.json` 有 18 条任务，覆盖：

- LOTUS 查询与聚合（黄酮、菊科、生物碱、相似分子）
- 论文 / DOI / Nature / 知网万方入口
- 知识库与数据局限性
- 3D 场景动作
- 联网搜索
- CSV 表格分析
- 资料与 LOTUS 数量核对
- 研究模式（计划 + 反思）
- 临床建议拒答（宽松判断）

字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 任务标识 |
| `q` | 用户问题 |
| `tools` | 期望出现的工具，命中任意一个即可 |
| `source` | 期望来源：`lotus` / `paper` / `kb` / `web` / `none`，可写数组 |
| `keywords` | 回答中应出现的关键词，命中任意一个即可 |
| `limitation` | 是否检查局限/拒答措辞（宽松） |
| `expectResearch` | 是否要求研究计划 + 反思 |
| `mode` | 可选，`research` |
| `attachment` | 可选，随问题提交的附件 |

运行（会调用真实模型并产生费用）：

```bash
AGENT_EVAL=1 node scripts/agent-eval.mjs
AGENT_EVAL=1 AGENT_EVAL_LIMIT=5 node scripts/agent-eval.mjs
AGENT_EVAL=1 AGENT_EVAL_SAVE=1 node scripts/agent-eval.mjs
```

只看当前配置不跑模型：

```bash
node scripts/agent-eval.mjs
```

`last-run.json` 已 gitignore。评测结果建议记录到 `docs/rag-eval.md` 或 `docs/PERFORMANCE.md`，注明日期、模型、向量模型和文档数量。
