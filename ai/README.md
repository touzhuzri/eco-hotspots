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

先启动 AI 代理：

```bash
node ai/server.mjs
# 或
./start-ai.sh
```

再启动站点（如果还没启动）：

```bash
./start.sh daemon
# 或者直接
node deploy/site-server.mjs
```

站点会把 `/api/ai/*` 代理到 `127.0.0.1:8790`；`/api` 的其它请求仍然走领养服务。

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

## 6. 当前 Step 1 能力

- `/api/ai/health`：服务状态、是否配置 Key、相似索引是否加载
- `/api/ai/config` GET/POST：读取/保存 provider、Base URL、模型、Key（Key 不回传）
- `/api/ai/test`：用当前配置发一条最小请求
- `/api/ai/chat`：SSE 流式对话 + 工具调用 + 附件正文
- `/api/ai/file`：上传并解析常见文档
- `/api/ai/similar?inchikey=...`：直接测试相似分子

工具：

- `query_molecules`：真实读取 LOTUS 分片，按 classes/family/formula/mass/xlogp/name 筛选与聚合
- `find_similar`：真实 Tanimoto 近邻
- `render_chart`：返回图表 spec，前端渲染
- `scene_action`：返回镜头/高亮动作（Step 2 接 TreeScene）
- `explain`：返回用于引用的 LOTUS 元数据

无 Key 时 `/api/ai/chat` 会返回**本地演示回答**（真实查询 LOTUS + 图表），方便先联调界面。

## 7. 下一步

1. 语义搜索：本地 embedding + 预计算向量
2. 评测集：查询理解准确率、工具选择正确率、引用正确性
3. 扫描版 PDF OCR（需要额外依赖，当前不做）
4. 附件多轮追问：把附件正文保留在当前会话，而不是只随第一轮发送
