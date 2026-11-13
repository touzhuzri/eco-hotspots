# RAG 检索评测

评测脚本：`scripts/rag-eval.mjs`  
评测集：`data/kb-eval/questions.json`（30 题，覆盖 LOTUS 卡片、论文、权威网站、数据局限性）

题目类型：`lotus` / `paper` / `website` / `limitation`。每题包含 `doc`、`citation`、`keywords`，用于同时检查文档命中、引用标识和内容关键词。

## 2026-11-13 扩展评测集

在原有 12 题基础上扩到 30 题，新增：

- LOTUS 数据规模、许可、字段含义、来源科记录数
- Rutz 2022、ClassyFire、NPClassifier、COCONUT 1.0/2.0 的题录与方法问题
- LOTUS 官网、下载页、ChEBI、PubChem、RDKit、Three.js、智谱开放平台
- 数据局限性：LOTUS 是否提供药效、安全性或临床结论

检索评测新增 `Cite@4`：前 4 条结果是否包含期望引用标识（DOI / URL / 文档名）。运行：

```bash
node scripts/rag-eval.mjs
```

### 30 题实测结果

环境：`data/kb/` 内置知识库 14 个文档 / 26 个片段（LOTUS 卡片 + 5 篇论文 + 8 个权威网站），取前 4 条。

| 指标 | local-hash（768 维） | BAAI/bge-m3（1024 维） |
| --- | --- | --- |
| Hit@4 | 30/30（100%） | 30/30（100%） |
| MRR | 0.983 | **1.000** |
| KW@4 | 30/30（100%） | 30/30（100%） |
| Cite@4 | 30/30（100%） | 30/30（100%） |

两套向量都能把期望文档召回；`bge-m3` 把全部 30 题的目标文档排到第 1 位（local-hash 有 1 题排第 2）。`Cite@4` 要求前 4 条里出现期望 DOI / URL / 文档名，30 题全部命中。

回答级引用评测（可选，会产生模型费用）：

```bash
AI_EVAL_CHAT=1 AI_EVAL_CHAT_LIMIT=8 node scripts/citation-eval.mjs
```

它会检查回答是否包含期望 DOI / URL / 文档名、关键词，以及局限类问题是否明确说明“不提供 / 不含 / 不能”。

## 2026-11-11 基线（local-hash）

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

## 2026-11-11 神经向量（当前）

改用 SiliconFlow 的 `BAAI/bge-m3`：

```text
Base URL: https://api.siliconflow.cn/v1
模型:     BAAI/bge-m3
维度:     1024
```

重建 14 个文档 / 26 个片段后：

| 指标 | local-hash | BAAI/bge-m3 |
| --- | --- | --- |
| 向量维度 | 768 | 1024 |
| Hit@4 | 12/12（100%） | 12/12（100%） |
| MRR | 0.958 | **1.000** |
| KW@4 | 12/12（100%） | 12/12（100%） |

命中率不变，MRR 从 0.958 提升到 1.000：所有期望文档都排到第 1 位。

## 智谱 embedding-3 的额度问题（历史记录）

曾尝试智谱 `embedding-3`（Base URL `https://open.bigmodel.cn/api/paas/v4`），接口返回：

```text
embedding 429: {"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}
```

说明当前账号没有 Embedding 资源包，与对话模型额度不通用。文档自动回退到 `local-hash`，检索不中断。SiliconFlow 的 `BAAI/bge-m3` 免费档可用，因此后续改用该服务。

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

- 对话与向量分开配置：DeepSeek 对话 + SiliconFlow `BAAI/bge-m3` 向量。
- 增加真实用户问题，而不是只覆盖内置知识库文档。
- 用更大的用户文档集测试长文档切块、top-k 与 `AI_KB_MIN_SCORE` 的影响。
