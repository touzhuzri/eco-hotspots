# RAG 检索评测

评测脚本：`scripts/rag-eval.mjs`  
评测集：`data/kb-eval/questions.json`（12 题，覆盖 LOTUS 卡片、论文、权威网站）

## 2026-11-11 基线

| 指标 | 结果 |
| --- | --- |
| 文档数 / 片段数 | 14 / 26 |
| 向量模型 | `local-hash`（768 维；当时对话服务商未提供 `/embeddings`） |
| Hit@4 | 12/12（100%） |
| MRR | 0.958 |
| KW@4 | 12/12（100%） |

说明：

- `Hit@4`：期望文档是否出现在前 4 条检索结果。
- `MRR`：期望文档排名的倒数均值，越接近 1 越好。
- `KW@4`：前 4 条片段是否包含期望关键词，用于检查召回内容而不只是文档名。
- 这一版是本地特征哈希 + BM25 的基线。配置神经向量（如 GLM `embedding-3` / BGE）后，在知识库面板点「重建向量」，再跑一次即可对比。

## 复现

```bash
# 先启动站点 + AI
./start.sh daemon

node scripts/rag-eval.mjs
```

自定义服务地址或返回条数：

```bash
AI_EVAL_BASE=http://127.0.0.1:5173 AI_EVAL_LIMIT=5 node scripts/rag-eval.mjs
```

## 提升方向

- 对话与向量分开配置：DeepSeek 对话 + GLM/BGE 向量，避免退回本地向量。
- 重建后对比 Hit@4 / MRR / KW@4，记录在本文档。
- 增加真实用户问题，而不是只覆盖内置知识库文档。
