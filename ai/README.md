# 世界树 · AI 分析代理

这个目录提供 **局域网/本机 AI 代理**，站点通过 `/api/ai/*` 同源访问，浏览器不接触 API Key。

## 1. 填写 API Key（默认 DS Pro）

编辑 `ai/.env`（已创建，已被 `.gitignore` 忽略）：

```env
AI_PROVIDER=dspro
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-v4-pro
AI_API_KEY=在这里填 DeepSeek 兼容接口 Key

# 向量默认用 SiliconFlow；Key 与对话 Key 分开填
AI_EMBED_BASE_URL=https://api.siliconflow.cn/v1
AI_EMBED_MODEL=BAAI/bge-m3
AI_EMBED_API_KEY=在这里填 SiliconFlow Key

AI_PORT=8790
```

GLM 示例：`AI_PROVIDER=glm` + `https://open.bigmodel.cn/api/paas/v4` + `glm-4.6`。设置面板的「服务商」下拉会预填 DS / DS Pro / DS Flash / GLM / MiMo。

也可以在页面右上角 ⚙ **场景设置 → AI / API** 里填写并保存；保存后的配置在 `.run/ai-config.json`（同样不会进 git）。

> 不要把 API Key 写进前端代码、README 或提交到仓库。

## 2. 启动

项目根目录的一键启动脚本会同时拉起站点、领养服务和 AI 代理：

```bash
./start.sh daemon
# Windows
start-windows.cmd
```

站点会把 `/api/ai/*` 代理到 `127.0.0.1:8790`；`/api` 的其它请求仍然走领养服务。用 `./start.sh status` 可以看到三项服务状态；`AI_DISABLED=1 ./start.sh` 可跳过 AI。

只调试 AI 时，也可以单独启动：

```bash
node ai/server.mjs
# 或
./start-ai.sh
```

然后单独启动站点：

```bash
node deploy/site-server.mjs
```

AI 代理没有 npm 依赖，使用 Node 内置 `fetch`，要求 Node 20.12+（当前项目 Node 24）。

工具调用轮次上限默认 **16 轮**（复杂研究任务可多步查询；正式部署可在 `ai/.env` 里用 `AI_MAX_TOOL_ROUNDS=6` 调回）。`/api/ai/health` 会返回当前 `maxToolRounds`；每轮工具调用会写到 `logs/ai.log`。

## 3. 服务商

`AI_PROVIDER` 支持：

| provider | 默认 Base URL | 默认模型 |
| --- | --- | --- |
| `deepseek`（DS） | `https://api.deepseek.com/v1` | `deepseek-chat` |
| `dspro`（DS Pro） | `https://api.deepseek.com/v1` | `deepseek-v4-pro` |
| `dsflash`（DS Flash） | `https://api.deepseek.com/v1` | `deepseek-flash` |
| `glm` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.6` |
| `mimo` | `https://api.xiaomimimo.com/v1` | `mimo-v2-flash` |
| `custom` | 自己填 | 自己填 |

设置面板的「服务商」下拉会按 DS / DS Pro / DS Flash / GLM / MiMo / 自定义预填 Base URL 和模型；「常用向量」下拉可一键填入 SiliconFlow `BAAI/bge-m3` 或智谱 `embedding-3`。

所有服务商都走 OpenAI 兼容的 `/chat/completions`（流式 + function calling）。如果 MiMo 的实际地址/模型不同，直接在设置面板里改。

## 4. 相似分子索引

已完成一次全量构建（227,298 条，Morgan r=2，1024 bit）：

```text
data/similarity/morgan1024.bin   27.7 MB
data/similarity/keys.json.gz
data/similarity/meta.json.gz
```

重建（需要 Python 3 + RDKit）：

```bash
python3 pipeline/build-molecule-similarity.py
# 小样本试跑
python3 pipeline/build-molecule-similarity.py --limit 2000
```

索引目录在 `.gitignore` 中；部署时把 `data/similarity/` 一起带走即可。

## 5. 附件读取（PDF / Word / Excel / PPT / CSV / 文本）

零 npm 依赖，`ai/files.mjs` 直接解析：

| 类型 | 扩展名 | 说明 |
| --- | --- | --- |
| PDF | `.pdf` | 抽取内容流里的 Tj/TJ 文本；支持 Flate / ASCII85 / ASCIIHex / RunLength 和间接 `/Filter` 引用。扫描件、加密 PDF、没有 ToUnicode 的 CID 字体 PDF 仍可能读不到，会返回具体原因 |
| Word | `.docx` | 解压 `word/document.xml`，保留段落换行 |
| Excel | `.xlsx` | 读取 `sharedStrings.xml` + 第一个工作表，输出制表符分隔行 |
| PPT | `.pptx` | 按页读取 `<a:t>` 文本 |
| 表格/文本 | `.csv .tsv .txt .md .json .html .xml .yaml .yml .log .smi` | 原样或去标签读取 |

接口：

```text
POST /api/ai/file
{ "name": "paper.pdf", "type": "application/pdf", "data": "<base64>" }
→ { "ok": true, "kind": "pdf", "chars": 12345, "text": "...", "truncated": false }
```

限制：单文件 16MB；提取文本最多返回 60,000 字；聊天时每个附件最多注入 12,000 字，总计 24,000 字。前端选文件后立刻解析并把状态显示在附件 chip 上，发送时通过 `attachments` 字段随问题提交。

PDF 读不到时先单独诊断：

```bash
node scripts/pdf-text.mjs "path/to/paper.pdf"
```

输出会说明是成功提取、扫描件、加密，还是没有可用的 ToUnicode 字体编码。扫描版 PDF 需要先用外部 OCR 转成文字再上传。

`AI_MAX_TOKENS` 会在服务端钳制到 `[1, 98304]`，避免 `.env` 里填了越界值后聊天接口直接 400（GLM 的上限）。

思考过程：GLM 默认请求 `thinking: { type: "enabled" }`，流里的 `reasoning_content` 会以 SSE `{type:"think"}` 转发给前端，AI 坞里显示为默认折叠的「思考过程」，用户可展开/收起。`AI_THINKING=0` 可关闭请求；服务商不认这个参数时会自动去掉重试一次。

## 5.1 知识库（RAG）

知识库分两层：

1. **系统知识库（内置、不可删除）**
   - `data/kb-seed/lotus-dataset.md`：LOTUS 数据集卡片，说明版本、规模、字段、分类示例、局限和引用方式——本项目的第一知识库；
   - `data/kb-seed/references.json`：开发参考的论文与权威网站（LOTUS eLife 2022、ClassyFire、NPClassifier、COCONUT、LOTUS 官网/下载、ChEBI、PubChem、RDKit、Three.js、智谱开放平台、MDN SSE），每篇都带 DOI / URL、项目用途和自写摘要；
   - 服务启动时按内容哈希同步到 `data/kb/`，内容没变不重复向量化，变了自动重建。
2. **我的知识库（用户上传）**
   - 在 AI 坞右上角 **知识库 → 上传文档**，支持 PDF / Word / Excel / PPT / CSV / 文本；
   - 服务端抽正文 → 切块 → 向量化 → 存到 `data/kb/`（已 gitignore）。

切块规则：按段落 / 句子切成约 500 字、80 字重叠的块；「第 X 章」和小标题不跨块合并，引用能落到具体小节。重叠只用于向量化和检索，引用展示的仍是干净正文。

检索采用 **向量余弦 + BM25 词法（中文二元组）混合**。神经向量优先；没有 API Key、服务商不支持 `/embeddings`、或额度不足时，自动改用**本地特征哈希向量**（768 维、零依赖、零费用），文档状态显示为「本地向量化」，仍然可以按余弦召回，而不是只剩关键词。

来源类型会随检索结果一起返回，前端显示为 `LOTUS` / `论文` / `网站` / `我的` 标签；系统知识库文档不允许删除。提示词规定引用格式：LOTUS 数据写 `LOTUS 260413`，论文写“第一作者 et al. 年份, 期刊, DOI”，网站写“站点名, URL（访问日期）”，用户文档写《文件名》第 N 段。

```text
GET    /api/ai/kb                  文档列表 + 统计
POST   /api/ai/kb                  { name, type, data(base64) }
DELETE /api/ai/kb?id=<docId>
GET    /api/ai/kb/search?q=&limit= 直接测试召回
```

对话时：

- 自动检索最相关的 4 个段落，注入模型上下文，并通过 SSE `source` 事件把引用推给前端；
- 模型也可以调用 `search_knowledge` 工具换关键词再查（每轮最多 3 次）；
- 系统提示词要求优先依据知识库、标注《文件名》第 N 段，知识库没有的要明说。

相关环境变量：

```env
# 向量模型（可与对话模型分开；DeepSeek / MiMo 没有 /embeddings 时可留空 → 自动用本地向量）
# Base URL 只填到 /v4 或 /v1，不要带 /chat/completions
AI_EMBED_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_EMBED_MODEL=embedding-3
# AI_EMBED_API_KEY=...
AI_KB_MAX_CHUNKS=240
AI_KB_CHUNK_SIZE=500
AI_KB_CHUNK_OVERLAP=80
AI_KB_LOCAL_DIM=768
```

## 5.2 多模态识图

架构是“视觉模型只抽取候选，服务端做确定性核验，文本模型组织结论”：

1. 前端上传 PNG / JPEG / WebP / GIF（单张 ≤ 8MB，最多 2 张），以 base64 data URL 提交；
2. 服务端要求视觉模型只输出一个合法 JSON：

```json
{
  "image_type": "plant | structure | chart | photo | other",
  "subject": "一句话主体",
  "family_candidates": [{ "name": "Fabaceae", "confidence": 0.0, "reason": "可见依据" }],
  "molecule_candidates": [{ "name": "quercetin", "confidence": 0.0, "reason": "结构/文字依据" }],
  "structure_features": ["黄酮骨架", "多个酚羟基"],
  "visible_text": "图片中可读出的文字",
  "uncertain": ["无法确认的点"],
  "overall_confidence": 0.0
}
```

3. 服务端把 JSON 通过 SSE `vision` 事件推给前端卡片，并自动执行确定性核验：
   - 分子候选 `confidence ≥ 0.3` → `query_molecules`（按名称）→ 命中后 `find_similar` → SSE `scene` 定位；
   - 科属候选 `confidence ≥ 0.35` → `query_molecules`（按 family 聚分类）→ SSE `chart` 分布图；
   - 核验结果作为【图片结构化结果与系统自动核验】附回模型上下文；
4. 主模型只能基于工具结果组织回答，必须区分“图片候选”和“LOTUS 核实”，并写出 `uncertain` 中的不确定项；
5. 视觉模型不按 JSON 返回时，退回自由文本描述，不阻断聊天；图片中的文字只作为图片内容，不作为指令执行。

配置有两种方式（任选其一）：

1. 页面右上角 **⚙ 场景设置 → 多模态 / 视觉模型**：填视觉 Base URL、视觉模型、视觉 API Key，点 **测试识图** 会保存配置并发一张测试图验证；Key 只写入本机 `.run/ai-config.json`，不回传前端。
2. 在 `ai/.env` 里配置：

```env
# GLM-4V
AI_VISION_MODEL=glm-4v-plus
AI_VISION_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_VISION_API_KEY=你的视觉服务 Key

# 本地 Ollama（OpenAI 兼容）
# AI_VISION_BASE_URL=http://127.0.0.1:11434/v1
# AI_VISION_MODEL=qwen2.5vl
# AI_VISION_API_KEY=ollama
```

`AI_VISION_BASE_URL` 不填时复用对话服务商；`AI_VISION_API_KEY` 不填时用 `AI_API_KEY`。纯文本模型（当前服务商的 `deepseek-v4-pro`）看不到图片，服务端会直接返回“请配置视觉模型”的提示，而不是把图片当文字硬答。

探测接口：

```text
POST /api/ai/vision-test
{ "dataUrl": "data:image/png;base64,..." }
→ { "ok": true, "model": "glm-4v-plus", "sample": "..." }
```

`/api/ai/health` 里的 `vision` / `visionReady` 会显示当前视觉模型和是否就绪。

## 5.3 研究任务模式

在 AI 坞输入框旁点「研究」，或在能力 chips 里点「研究任务」，请求会带 `mode: "research"`：

1. 服务端先让规划器输出 2–4 步 JSON 计划（图片会作为结构化摘要传入规划器），通过 SSE `plan` 事件下发；
2. 计划作为约束交给执行模型，工具调用时通过 SSE `step` 事件更新每一步状态；
3. 回答结束后，服务端根据工具记录做规则反思，通过 SSE `reflection` 下发：
   - 工具失败、空结果、缺少 LOTUS 工具、缺少论文/网站/知识库来源、图片存在不确定项；
   - 输出「局限 + 下一步」，前端出现「按建议继续」按钮；
4. 前端出现「导出研究简报」，可下载包含问题、计划、结论、研究反思、工具记录、图表数据、图像结构化和来源（DOI/URL/《文件名》第 N 段）的 Markdown；
5. 最近一次研究保存到浏览器 `localStorage`，同时通过匿名会话 ID 保存到服务端 `.run/ai-sessions.json`；标题栏「继续上次」可恢复问题、计划、结论、来源和反思，换设备或清缓存后仍可用；
6. 回答过程中可以点「■」停止：前端 abort 请求，服务端通过 `res.on("close")` 中止上游模型调用和后续工具轮次。

规划器失败时自动使用本地兜底计划，不影响正常回答。`mode` 不传或传 `chat` 时保持原来的单轮/多轮工具对话。

## 5.4 独立向量配置与 RAG 评测

对话模型和向量模型可以分开配置：

- 设置面板 →「知识库 / 向量模型」填 Base URL、模型（如 `embedding-3` / `bge-m3`）和 Key；
- Base URL 只填到 `/v4` / `/v1` 这一级，例如 `https://open.bigmodel.cn/api/paas/v4`；带 `/chat/completions` 会被自动去掉；
- 模型必须是有 embedding 能力的模型，不能填 `GLM-4.5-Flash` / `deepseek-chat` 等对话模型；智谱用 `embedding-3`；
- SiliconFlow 示例：Base URL `https://api.siliconflow.cn/v1` + 模型 `BAAI/bge-m3`（免费档需实名认证；`Pro/BAAI/bge-m3` 是付费加速版）；
- 也可以写 `AI_EMBED_BASE_URL` / `AI_EMBED_MODEL` / `AI_EMBED_API_KEY`；
- 切换后点知识库面板的「重建向量」，或 `POST /api/ai/kb/reembed`。

智谱返回 `1113 / 余额不足或无可用资源包` 时，说明当前账号没有 Embedding 资源包，与对话模型额度不通用；需要在智谱开放平台单独开通 `embedding-3` 资源包，或换用其它支持 `/embeddings` 的服务商。失败时文档会自动退回本地 768 维特征哈希向量，检索不中断。

`POST /api/ai/embed-test` 用当前配置发一条最小向量请求，返回模型和维度。`GET /api/ai/health` 的 `embedding` / `kb.embedReady` 会显示是否真的走神经向量；没有可用配置时自动退回本地 768 维特征哈希 + BM25，不会中断检索。

评测：

```bash
node scripts/rag-eval.mjs
# AI_EVAL_BASE=http://127.0.0.1:5173 AI_EVAL_LIMIT=5 node scripts/rag-eval.mjs

# 回答级引用评测（会调用模型，默认 8 题）
AI_EVAL_CHAT=1 AI_EVAL_CHAT_LIMIT=8 node scripts/citation-eval.mjs
```

评测集在 `data/kb-eval/questions.json`（30 题，覆盖 LOTUS 卡片、论文、权威网站、数据局限性），输出 Hit@4、MRR、KW@4 和 Cite@4（前 4 条是否包含期望 DOI/URL/文档名）。回答级评测额外检查回答是否带期望引用标识，以及局限类问题是否明确说“不提供 / 不能”。基线结果见 [`docs/rag-eval.md`](../docs/rag-eval.md)。

## 5.5 运行指标

`GET /api/ai/metrics` 返回内存态指标（重启清零），不含问题正文、图片内容和 Key：

```json
{
  "chat": { "requests": 12, "completed": 11, "aborted": 1, "errors": 0, "inflight": 0 },
  "model": { "calls": 37, "errors": 0, "retries": 1, "avgLatencyMs": 2140, "maxLatencyMs": 8900 },
  "tools": { "calls": 28, "errors": 2, "successRate": 0.929, "byName": { "query_molecules": { "calls": 9 } } },
  "vision": { "calls": 2, "errors": 0 },
  "papers": { "searches": 3 }
}
```

用途：

- 证明工具调用成功率、模型平均耗时、停止按钮确实中止了请求（`chat.aborted`）；
- 作为参赛材料的量化证据，配合 [`docs/PERFORMANCE.md`](../docs/PERFORMANCE.md) 的测量方法；
- `scripts/metrics.mjs` 可直接打印一份快照。

## 5.6 表格分析（CSV / Excel）

上传 CSV / TSV，或 Excel（读取第一个工作表，转成制表符文本）后，服务端会用 `ai/tables.mjs` 解析成行列，并把表结构（列名、行数、前 3 行）注入模型上下文：

```text
【本轮上传的结构化表格】
- 《demo.csv》：120 行 × 5 列
  列名：名称、科、分子量、年份、活性
```

模型需要计数或分组时必须调用 `analyze_table`，由服务端做确定性计算：

```json
{
  "file": "demo.csv",
  "group_by": "科",
  "metric": "count",
  "value_column": "",
  "filter_column": "年份",
  "filter_contains": "2024",
  "limit": 15
}
```

- `metric`：`count` / `sum` / `avg` / `min` / `max`；后四者需要 `value_column`。
- 返回 `groups: [{label, value, n}]`，服务端自动通过 SSE `chart` 画柱状图，模型不再重复调用 `render_chart`。
- 限制：最多 50,000 行 × 60 列；Excel 只读第一个工作表，公式单元格使用缓存值；合并单元格可能落在首列。
- 行数、求和、平均都由工具计算，不使用模型口算，便于核对。

## 5.7 数据核对（资料 vs LOTUS）

当用户要求“核对/对比/是否一致/差异”，或资料中出现“某科/某类有 N 条”的数量断言时，模型调用 `verify_claim`：

```json
{
  "claimed": 1200,
  "family": "Asteraceae",
  "source_label": "Rutz 2022",
  "tolerance_pct": 5
}
```

- 服务端用 `query_molecules` 做真实统计，再和 `claimed` 比较，返回 `claimed`、`actual`、`delta`、`percent`、`verdict`。
- 默认容差 ±5%；超过容差 `verdict=conflict`。
- 比较纯数字，不判断资料可信度；模型负责把资料里的数字和筛选条件传进来。
- 服务端通过 SSE `conflict` 下发核对结果，前端生成「数据核对」卡片，研究简报也会包含这一节。
- 限制：目前只支持按 `family` / `class_contains` / `name_contains` 统计 LOTUS 记录数，不支持论文里的实验数值（IC50、产量等）。

## 6. 接口与工具

- `/api/ai/health`：服务状态、是否配置 Key、相似索引是否加载
- `/api/ai/metrics`：对话 / 模型 / 工具 / 视觉 / 文献检索的运行指标与限流配置
- `/api/ai/session/last` GET/POST：按 `x-ai-session` 取回/保存最近一次研究（匿名 ID，30 天过期）
- `/api/ai/config` GET/POST：读取/保存 provider、Base URL、模型、Key（Key 不回传）
- `/api/ai/test`：用当前配置发一条最小请求
- `/api/ai/chat`：SSE 流式对话 + 工具调用 + 附件正文
- `/api/ai/file`：上传并解析常见文档
- `/api/ai/vision-test`：用一张图片探测视觉模型是否可用
- `/api/ai/models`：列出当前服务商的模型 ID
- `/api/ai/kb` GET/POST/DELETE：知识库列表、上传、删除
- `/api/ai/kb/search?q=...`：直接测试知识库召回
- `/api/ai/kb/reembed`：用当前向量配置重建全部文档向量
- `/api/ai/embed-test`：测试向量接口连通性和维度
- `/api/ai/similar?inchikey=...`：直接测试相似分子
- `/api/ai/papers?q=...&source=auto`：直接检索论文题录，不需要模型 Key
- `/api/ai/paper-sources`：列出可用的文献数据源和能力/限制

工具：

- `query_molecules`：真实读取 LOTUS 分片，按 classes/family/formula/mass/xlogp/name 筛选与聚合
- `find_similar`：真实 Tanimoto 近邻
- `render_chart`：返回图表 spec，前端渲染
- `scene_action`：返回镜头/高亮动作（Step 2 接 TreeScene）
- `explain`：返回用于引用的 LOTUS 元数据
- `web_search`：公开网页联网搜索（每轮最多 3 次）
- `search_papers`：学术文献检索（每轮最多 3 次）。OpenAlex/Crossref/Europe PMC 走公开 API；Nature 用 ISSN 过滤；知网/万方/WoS 没有公开检索 API，只返回官网入口和 OpenAlex 公开替代结果，不抓取需要登录的受限全文。
- `search_knowledge`：检索用户上传的知识库段落（每轮最多 3 次）
- `analyze_table`：对 CSV / Excel 做分组计数、求和、平均、最小/最大，返回 groups 并自动画图
- `verify_claim`：把资料/论文里的数量断言与 LOTUS 实际统计比较，返回 claimed / actual / percent / verdict

无 Key 时 `/api/ai/chat` 会返回**本地演示回答**（真实查询 LOTUS + 图表），方便先联调界面。

## 6.1 公网防护

公开演示时建议在 `ai/.env` 开启：

```env
# 锁定前端「保存配置」；仍可通过 .env 修改
AI_CONFIG_LOCK=1
# 管理令牌：设置后，前端保存配置必须带 x-ai-admin-token
AI_ADMIN_TOKEN=换成一段随机长字符串

# 设置面板「AI / API」解锁密码；不填则复用 AI_ADMIN_TOKEN，再退回默认 worldtree
AI_SETTINGS_PASSWORD=换成你自己的密码

# 每个 IP 每分钟的请求上限
AI_RATE_LIMIT_CHAT=12
AI_RATE_LIMIT_WRITE=30
AI_RATE_LIMIT_READ=240

# 并发上限：整个服务 / 单个 IP
AI_MAX_CONCURRENT_CHATS=4
AI_MAX_CONCURRENT_PER_IP=2
```

行为：

- 设置面板的「AI / API」区域默认显示锁定卡片；输入管理密码后才会渲染模型、视觉和向量配置。密码由 `POST /api/ai/settings/unlock` 在服务端比对，前端不保存明文；关闭设置面板会自动重新锁定。
- 未配置任何密码时，解锁密码默认为 `worldtree`，公网演示前务必修改。
- `POST /api/ai/config` 在锁定或设置了管理令牌但没有正确令牌时返回 403；设置面板会提示输入管理令牌，令牌只存在浏览器 localStorage，不发往第三方。
- `/api/ai/chat` 超过每 IP 每分钟上限返回 429；同一 IP 的并行聊天超过上限也返回 429，避免一个人占满额度。
- 站点代理会把真实来源 IP 写入 `x-real-ip`，AI 服务优先用它做限流；直连时退回 socket 地址。
- 限流与并发是内存态，重启清零；指标接口的 `limits` 字段会返回当前配置。

## 6.2 测试与评测

```bash
# 单元测试：表格解析、数据核对、PDF 提取
npm test

# 端到端测试：mock 模型，不消耗 API
# 覆盖工具、研究反思、多模态、表格、数据核对、会话、配置锁、限流、并发、中止
npm run test:e2e

# Agent 任务级评测：真实模型，18 条任务
AGENT_EVAL=1 node scripts/agent-eval.mjs
```

评测基线见 [`docs/agent-eval.md`](../docs/agent-eval.md) 和 [`docs/rag-eval.md`](../docs/rag-eval.md)。

## 7. 下一步

1. 把回答级引用评测从默认 8 题扩到全部 30 题，并记录工具选择正确率
2. 扫描版 PDF OCR（需要额外依赖，当前不做）
3. 附件多轮追问：把附件正文保留在当前会话，而不是只随第一轮发送
4. 知识库重排（rerank）与按文档过滤检索
5. 把平台抓取到的模型/工具耗时写入结构化日志，做长期趋势

架构与演示材料：

- [`docs/AI-ARCHITECTURE.md`](../docs/AI-ARCHITECTURE.md)
- [`docs/DEMO-SCRIPTS.md`](../docs/DEMO-SCRIPTS.md)
- [`docs/PERFORMANCE.md`](../docs/PERFORMANCE.md)
