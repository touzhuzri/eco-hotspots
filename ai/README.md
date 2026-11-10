# 世界树 · AI 分析代理（Step 1）

这个目录提供 **局域网/本机 AI 代理**，站点通过 `/api/ai/*` 同源访问，浏览器不接触 API Key。

## 1. 填写 GLM API Key

编辑 `ai/.env`（已创建，已被 `.gitignore` 忽略）：

```env
AI_PROVIDER=glm
AI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_MODEL=glm-4.6
AI_API_KEY=在这里填你的 GLM Key
AI_PORT=8790
```

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

工具调用轮次上限默认 **8 轮**（演示期放宽；正式部署可在 `ai/.env` 里用 `AI_MAX_TOOL_ROUNDS=4` 调回）。`/api/ai/health` 会返回当前 `maxToolRounds`；每轮工具调用会写到 `logs/ai.log`。

## 3. 服务商

`AI_PROVIDER` 支持：

| provider | 默认 Base URL | 默认模型 |
| --- | --- | --- |
| `glm` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.6` |
| `deepseek` | `https://api.deepseek.com/v1` | `deepseek-chat` |
| `mimo` | `https://api.xiaomimimo.com/v1` | `mimo-v2-flash` |
| `custom` | 自己填 | 自己填 |

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
| PDF | `.pdf` | 抽取内容流里的 Tj/TJ 文本；扫描件、加密 PDF、CID 字体 PDF 可能读不到 |
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
# 向量模型；DeepSeek / MiMo 没有 /embeddings 时可留空 → 自动用关键词检索
AI_EMBED_MODEL=embedding-3
AI_KB_MAX_CHUNKS=240
AI_KB_CHUNK_SIZE=500
AI_KB_CHUNK_OVERLAP=80
AI_KB_LOCAL_DIM=768
```

## 5.2 多模态识图

架构是“视觉模型看图，文本模型推理”：

1. 前端上传 PNG / JPEG / WebP / GIF（单张 ≤ 8MB，最多 2 张），以 base64 data URL 提交；
2. 服务端调用视觉模型，只让它描述图片中确实可见的内容（主体、文字、结构式骨架/官能团、图表坐标轴与趋势），并明确要求“不确定就说不确定”；
3. 描述作为【图片识别结果（视觉模型，仅供参考）】附在用户消息里，再交给主模型做推理；
4. 主模型可以继续调用 `query_molecules` / `find_similar` / `explain` 核对，回答里区分“图片看到的内容”和“LOTUS 核实的内容”。

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

## 6. 当前 Step 1 能力

- `/api/ai/health`：服务状态、是否配置 Key、相似索引是否加载
- `/api/ai/config` GET/POST：读取/保存 provider、Base URL、模型、Key（Key 不回传）
- `/api/ai/test`：用当前配置发一条最小请求
- `/api/ai/chat`：SSE 流式对话 + 工具调用 + 附件正文
- `/api/ai/file`：上传并解析常见文档
- `/api/ai/vision-test`：用一张图片探测视觉模型是否可用
- `/api/ai/models`：列出当前服务商的模型 ID
- `/api/ai/kb` GET/POST/DELETE：知识库列表、上传、删除
- `/api/ai/kb/search?q=...`：直接测试知识库召回
- `/api/ai/similar?inchikey=...`：直接测试相似分子

工具：

- `query_molecules`：真实读取 LOTUS 分片，按 classes/family/formula/mass/xlogp/name 筛选与聚合
- `find_similar`：真实 Tanimoto 近邻
- `render_chart`：返回图表 spec，前端渲染
- `scene_action`：返回镜头/高亮动作（Step 2 接 TreeScene）
- `explain`：返回用于引用的 LOTUS 元数据
- `web_search`：公开网页联网搜索（每轮最多 3 次）
- `search_knowledge`：检索用户上传的知识库段落（每轮最多 3 次）

无 Key 时 `/api/ai/chat` 会返回**本地演示回答**（真实查询 LOTUS + 图表），方便先联调界面。

## 7. 下一步

1. 评测集：查询理解准确率、工具选择正确率、引用正确性
2. 扫描版 PDF OCR（需要额外依赖，当前不做）
3. 附件多轮追问：把附件正文保留在当前会话，而不是只随第一轮发送
4. 知识库重排（rerank）与按文档过滤检索
