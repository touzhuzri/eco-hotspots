# 环境配置说明

本文列出运行「世界之树」所需的环境、依赖、配置文件和全部环境变量。完整模板见
[`ai/.env.example`](../ai/.env.example)。

## 1. 运行环境

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | 18+，推荐 22.14.0 | AI 服务使用内置 `fetch`，要求 20.12+ |
| 浏览器 | 支持 WebGL 2 / ES Modules | Chrome、Edge、Firefox、Safari 近两年版本 |
| 操作系统 | Linux / Windows / macOS | 生产推荐 Linux |
| 数据库 | 不需要 | 数据以 JSON / JSONL / 分片文件存放 |
| Redis / 消息队列 | 不需要 | 会话与限流为单进程内存态 |
| 前端构建 | 不需要 | 原生 ES Modules，源码即产物 |
| Python | 仅重建数据时需要 | Python 3.10+、RDKit |

AI 服务、静态站、领养服务均为零 npm 依赖。前端第三方库已放在 `vendor/`，不依赖外网 CDN。

## 2. 依赖清单

| 类别 | 依赖 | 版本 / 许可 |
| --- | --- | --- |
| 前端 3D | Three.js | r169，MIT |
| 前端结构式 | RDKit.js + WASM | BSD 3-Clause |
| 手势（可选） | MediaPipe Tasks Vision | Apache 2.0 |
| 服务端 | Node 内置 `http` / `fs` / `fetch` / `crypto` | Node 18+ |
| 数据构建 | Python 3.10+、RDKit | 仅 pipeline 使用 |
| 测试 | Node `node:test`、内置 fetch、mock 服务 | 无第三方测试框架 |

## 3. 配置文件与优先级

| 文件 | 用途 | 是否入库 |
| --- | --- | --- |
| `ai/.env` | AI 服务主配置，填写 Key 与服务商 | 否（`.gitignore`） |
| `ai/.env.example` | 配置模板与注释 | 是 |
| `.run/ai-config.json` | 前端设置面板保存的运行时配置 | 否 |
| `.run/ai-sessions.json` | 匿名研究会话 | 否 |
| `claims.jsonl` | 领养账本 | 否，需长期备份 |
| `data/kb/` | 用户知识库正文与向量 | 否，需备份 |
| `data/kb-seed/` | 内置知识库种子 | 是 |

读取顺序：**环境变量 / `ai/.env` → `.run/ai-config.json` → 内置默认值**。
公开部署建议设置 `AI_CONFIG_LOCK=1`，禁止前端改配置。

## 4. 对话模型

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_PROVIDER` | `dspro` | `deepseek` / `dspro` / `dsflash` / `glm` / `mimo` / `custom` |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容地址，只填到 `/v1` 或 `/v4` |
| `AI_MODEL` | `deepseek-v4-pro` | 对话与工具调用模型 |
| `AI_API_KEY` | 空 | 必填；只存服务端 |
| `AI_MAX_TOKENS` | `2048` | 单次最大输出 token |
| `AI_MAX_TOOL_ROUNDS` | `16` | 工具调用轮次上限 |
| `AI_THINKING` | 自动 | 是否向服务商请求思考过程；`0`/`false` 关闭 |
| `AI_PORT` | `8790` | 内部 AI 服务端口 |
| `AI_HOST` | `127.0.0.1` | 内部绑定地址 |

服务商示例：

```env
# DeepSeek
AI_PROVIDER=dspro
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-v4-pro

# 智谱 GLM
AI_PROVIDER=glm
AI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_MODEL=glm-4.6

# 小米 MiMo
AI_PROVIDER=mimo
AI_BASE_URL=https://api.xiaomimimo.com/v1
AI_MODEL=mimo-v2-flash
```

## 5. 视觉模型（多模态识图）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_VISION_MODEL` | `deepseek-flash` | 视觉模型名 |
| `AI_VISION_BASE_URL` | 复用 `AI_BASE_URL` | 可单独指向 GLM-4V / Ollama |
| `AI_VISION_API_KEY` | 复用 `AI_API_KEY` | 视觉服务 Key |

```env
# 智谱 GLM-4V
AI_VISION_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_VISION_MODEL=glm-4v-plus

# 本地 Ollama（需先 ollama pull qwen2.5vl）
AI_VISION_BASE_URL=http://127.0.0.1:11434/v1
AI_VISION_MODEL=qwen2.5vl
AI_VISION_API_KEY=ollama
```

## 6. 向量模型与知识库

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_EMBED_BASE_URL` | `https://api.siliconflow.cn/v1` | 向量服务地址 |
| `AI_EMBED_MODEL` | `BAAI/bge-m3` | 1024 维；留空则用 local-hash |
| `AI_EMBED_API_KEY` | 空 | 与对话 Key 分开 |
| `AI_KB_MAX_DOCS` | `40` | 知识库文档上限 |
| `AI_KB_MAX_CHUNKS` | `240` | 单文档最大片段数 |
| `AI_KB_CHUNK_SIZE` | `500` | 每段字数 |
| `AI_KB_CHUNK_OVERLAP` | `80` | 相邻段重叠字数 |
| `AI_KB_MIN_SCORE` | `0.32` | 检索最低相关度 |
| `AI_KB_LOCAL_DIM` | `768` | local-hash 维度 |
| `AI_KB_EMBED_TIMEOUT` | `60000` | 单次 embedding 超时（毫秒） |

向量不可用时自动退回 `local-hash + BM25`，回答不中断。切换向量模型后需在知识库面板
「重建向量」，再运行 `node scripts/rag-eval.mjs` 对比。

## 7. 公网演示防护

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_CONFIG_LOCK` | 未设置 | 设为 `1` 锁定前端配置写操作 |
| `AI_ADMIN_TOKEN` | 空 | 管理令牌；写配置需 `x-ai-admin-token` |
| `AI_SETTINGS_PASSWORD` | `worldtree` | 设置面板「AI / API」解锁密码 |
| `AI_RATE_LIMIT_CHAT` | `12` | 每 IP 每分钟对话请求上限 |
| `AI_RATE_LIMIT_WRITE` | `30` | 每 IP 每分钟写请求上限 |
| `AI_RATE_LIMIT_READ` | `240` | 每 IP 每分钟读请求上限 |
| `AI_MAX_CONCURRENT_CHATS` | `4` | 全局并发对话上限 |
| `AI_MAX_CONCURRENT_PER_IP` | `2` | 单 IP 并发对话上限 |
| `AI_CONFIG_FILE` | `.run/ai-config.json` | 运行时配置路径 |
| `AI_SESSION_FILE` | `.run/ai-sessions.json` | 匿名会话路径 |

公网部署至少设置：

```env
AI_CONFIG_LOCK=1
AI_SETTINGS_PASSWORD=换成你自己的密码
```

## 8. 站点与部署

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SITE_PORT` / `PORT` / `SERVER_PORT` | `5173` | 公开站点端口；面板 `PORT` 优先 |
| `BIND_HOST` | `0.0.0.0` | 站点绑定地址 |
| `CLAIM_PORT` | `8788` | 内部领养服务端口 |
| `CLAIM_HOST` | `127.0.0.1` | 领养服务绑定地址 |
| `CLAIM_FILE` | `./claims.jsonl` | 领养账本路径 |
| `CLAIM_PROXY` | `http://127.0.0.1:8788` | 站点代理目标 |
| `AI_PROXY` | `http://127.0.0.1:8790` | 站点代理目标 |
| `ALLOW_ORIGIN` | `*` | 领养服务 CORS |
| `AI_DISABLED` | `0` | 设为 `1` 只启动站点与领养 |
| `NODE_DIR` | 自动 | 离线 Node 目录 |
| `USE_BUNDLED_NODE` | 未设置 | 设为 `1` 强制使用包内 Node |

对外只放行站点端口；`8788` 与 `8790` 默认只绑定本机。

## 9. 文献检索（可选）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OPENALEX_API_KEY` | 空 | OpenAlex 可选 Key，减少限流 |
| `OPENALEX_MAILTO` | 空 | OpenAlex 联系邮箱 |
| `CROSSREF_MAILTO` | 空 | Crossref 联系邮箱 |

不填也能使用 OpenAlex / Crossref / Europe PMC / Nature。知网、万方、Web of Science
只返回官方检索入口，不抓取需要机构登录的全文。

## 10. 评测变量

| 变量 | 说明 |
| --- | --- |
| `AGENT_EVAL=1` | 启用 Agent 任务级评测（真实模型，会产生费用） |
| `AGENT_EVAL_LIMIT` | 只跑前 N 条任务 |
| `AGENT_EVAL_SAVE=1` | 保存明细到 `data/agent-eval/last-run.json` |
| `AI_EVAL_BASE` | 评测服务地址，默认 `http://127.0.0.1:5173` |
| `AI_EVAL_CHAT=1` | 启用回答级引用评测（调用模型） |
| `AI_EVAL_CHAT_LIMIT` | 引用评测题数 |
| `MOCK_PORT` | 端到端测试 mock 服务端口 |

## 11. 安全约定

- 不要提交 `ai/.env`、`.run/`、`logs/`、`claims.jsonl`、`data/kb/`。
- 不要把 Key 写进前端代码、README、Issue 或截图。
- 部署包只带空 Key 模板；真实 Key 在服务器填写。
- 公开演示前修改默认设置密码，并开启 `AI_CONFIG_LOCK`。
- 站点服务器已屏蔽 `ai/`、`.git`、`.run`、`logs`、`claims.jsonl`；上线后可用
  `curl -i http://你的地址/ai/.env` 验证返回 404。
