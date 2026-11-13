# 公开发布清单

本文用于把项目发布到公开仓库（GitHub / Gitee）。当前仓库只有本地 `upstream` 指向旧目录，**没有公开远端**；`gh` CLI 未安装。发布前请逐项确认。

## 0. 当前状态（2026-11-13）

- `main` 已合并到最新提交 `dd947c6`，包含多模态、研究反思、表格分析、服务端会话、公网防护、导览和穿梭群星。
- 尚未创建公开远端，也没有打 tag。
- 发布前还需要：团队信息、仓库地址、在线演示 URL 确认；建议打 tag `v0.2.0-competition`。

### 需要团队提供的信息

| 字段 | 内容 |
| --- | --- |
| 团队名称 | 世界之树 |
| 成员 | 刘同字（队长，技术栈、工具调用）、刘峥（专业知识搜寻、权威网站查询、知识验证） |
| 单位 | 华中农业大学 · 化学学院 · 应用化学专业（大三） |
| 指导老师 | 无 |
| 仓库 | <https://github.com/touzhuzri/eco-hotspots.git> |
| 在线演示 | 待补充 |
| 作品名称 | 世界之树 |

## 1. 发布前检查

```bash
cd D:/mimo/shijieshu-lotus

# 1) 确认分支与提交
git status --short          # 应为空
git log --oneline -5

# 2) 确认敏感文件没有被跟踪
git ls-files | grep -E '(^|/)\.env$|(^|/)logs/|(^|/)\.run/|claims\.jsonl|data/kb/|data/similarity/'

# 3) 扫描疑似 Key（只匹配“赋值且非空”的行，避免误报注释）
git grep -nEI '^[A-Z_]*API_KEY[[:space:]]*=[[:space:]]*[^[:space:]#]+' -- . ':!ai/.env.example'
```

第 2 条应没有输出；第 3 条只允许示例文件中的占位符（如 `your-key-here`）。

必须保持被忽略的内容：

- `ai/.env`、`.env.*`（`.env.example` 除外）
- `.run/`（运行时配置，可能含 Key）
- `logs/`
- `claims.jsonl`
- `data/kb/`（用户上传的文档正文与向量）
- `data/similarity/`（可由 pipeline 重建）
- `scratch/`、`release/`

## 2. 创建公开仓库

没有 `gh` 时，先在 GitHub 网页新建空仓库（不要勾选 README / LICENSE / .gitignore），然后：

```bash
cd D:/mimo/shijieshu-lotus
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git push -u origin main
git push origin feat/agent-multimodal-evidence
```

如果有 `gh`：

```bash
gh repo create <仓库名> --public --source . --remote origin --push
```

安全提醒：推送前再跑一次第 1 节的检查。公开仓库一旦推送，历史提交里的内容也会公开；如果曾经提交过 Key，需要先改写历史或吊销 Key。

## 3. 仓库设置建议

- Description：`LOTUS 天然产物 WebGL 星点树 + AI 数据分析 / RAG / 多模态研究助手`
- Topics：`natural-products`、`lotus`、`webgl`、`threejs`、`rag`、`ai-agent`、`cheminformatics`
- 启用 Issues；不需要 Wiki（文档在 `docs/`）。
- About 里放演示地址：`http://play.simpfun.cn:41018/`

## 4. 首发 Release 材料

建议附：

| 文件 | 说明 |
| --- | --- |
| `docs/AI-ARCHITECTURE.md` | AI 架构与三条主流程 |
| `docs/DEMO-SCRIPTS.md` | 2–3 分钟演示脚本 |
| `docs/PERFORMANCE.md` | 指标口径与实测表 |
| `docs/rag-eval.md` | 30 题检索评测 |
| `NOTICE.md` | 第三方数据与软件声明 |
| `LICENSE` | MIT |

Release 说明模板：

```markdown
## 世界树 · AI 分析版

- LOTUS frozen 260413：227,319 条天然产物结构
- AI 分析坞：LOTUS 工具查询、图表、3D 定位、RAG 引用、论文检索、识图、研究任务
- 多模态：图片结构化 JSON → 自动查 LOTUS / 相似分子 / 分布图
- 研究任务：计划 → 执行 → 反思 → 简报，可继续上次、可服务端停止
- RAG：30 题 Hit@4 30/30、MRR 1.000、Cite@4 30/30（bge-m3）

仅作科学传播与教学演示，不构成用药建议。
```

## 5. 不要发布的内容

- 任何真实 API Key、`.env`、`.run/ai-config.json`
- `logs/`、`claims.jsonl`
- 用户上传的知识库正文
- 未获授权的第三方图片、校徽或论文全文
- 部署包中的 `ai/.env`（只放占位符，Key 由部署者在面板或环境变量中填写）

## 6. 许可证与引用

- 代码：MIT（`LICENSE`）
- LOTUS 数据：CC0；引用 Rutz et al. 2022, eLife, DOI `10.7554/eLife.70780`
- 第三方库与参考网站：见 `NOTICE.md`
