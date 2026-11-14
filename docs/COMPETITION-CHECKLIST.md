# 参赛材料对照清单

本文把比赛要求逐项映射到仓库中的实际文件，便于提交前自查。

## 一、代码仓库

| 要求 | 现状 | 证据 |
| --- | --- | --- |
| GitHub / Gitee 托管，Public 或提供评审访问 | ✅ GitHub Public | <https://github.com/touzhuzri/eco-hotspots>，默认分支 `main` |
| 代码结构清晰、有效注释、主流规范 | ✅ | `src/`、`ai/`、`deploy/` 分层；原生 ES Modules；中文注释与字段契约 |
| README 含项目介绍、技术架构、安装运行、团队信息 | ✅ | `README.md`：AI 分析、特性、操作、本地运行、部署、项目结构、技术栈、团队 |
| 完整 Git 提交历史 | ✅ | 60+ 次提交，2026-09-14 至 2026-11-14；功能分支均已合并到 `main` |
| 环境配置说明、变量模板、依赖清单 | ✅ | `docs/ENVIRONMENT.md`、`ai/.env.example`、`README.md`、`package.json` |

自查命令：

```bash
git log --oneline | wc -l          # 64
git status --short                 # 应为空
git branch --merged main           # 功能分支均已合并
git ls-files | grep -E '(^|/)\.env$|(^|/)logs/|claims\.jsonl'  # 应为空
```

公开仓库前的安全扫描：

```bash
git grep -nEI '^[A-Z_]*API_KEY[[:space:]]*=[[:space:]]*[^[:space:]#]+' \
  -- . ':!ai/.env.example'
```

只允许示例文件中的占位符；真实 Key 不应出现在任何提交中。

## 二、技术文档

| 要求 | 现状 | 证据 |
| --- | --- | --- |
| PDF 格式，不超过 30 页 | ✅ 18 页 | `docs/technical-report.pdf` |
| 项目概述 | ✅ 第 1 章 | 背景、定位、主要工作、成果概览 |
| 需求分析 | ✅ 第 2 章 | 用户角色、功能需求、非功能需求、约束取舍 |
| 系统架构设计 | ✅ 第 3 章 | 总体架构图、前后端分层、数据层、数据流、技术选型 |
| AI 技术方案 | ✅ 第 4 章 | 模型选型理由、集成方式、11 个工具、RAG、多模态、研究任务、优化、安全 |
| 核心功能实现 | ✅ 第 5 章 | WebGL 世界树、交互、AI 分析坞、文件表格、分子详情 |
| 测试与部署 | ✅ 第 6 章 | 单元 / 端到端 / Agent / RAG 评测、部署形态、安全验证 |
| 总结与展望 | ✅ 第 8 章 | 总结、不足、后续方向 |
| AI 选型理由、集成方式、优化策略 | ✅ 第 4.2 / 4.3 / 4.10 节 | 对话、视觉、向量、Agent 框架逐项说明 |
| 技术创新点与应用创新点 | ✅ 第 7 章 | 6 项技术创新 + 5 项应用创新，逐条给出做法与价值 |

文档源文件与重新生成方式见 [`TECHNICAL-REPORT.md`](TECHNICAL-REPORT.md)。

## 三、提交前最后检查

- [ ] 在线演示地址填入 `README.md` 与 `docs/PUBLISH.md`
- [ ] 仓库 About 填写演示地址与 Topics
- [ ] 创建 Release / tag（建议 `v0.2.0-competition`）
- [ ] 确认演示环境已设置 `AI_CONFIG_LOCK=1` 与非默认 `AI_SETTINGS_PASSWORD`
- [ ] 确认 `GET /ai/.env` 返回 404
- [ ] 确认部署包内 `.env` 为空 Key 模板
- [ ] 录屏 5–8 分钟演示视频（`docs/DEMO-SCRIPTS.md` 可直接使用）
- [ ] 提交 PDF 前再次确认页数与文件大小

## 四、可复现证据

```bash
npm test                                  # 15/15
npm run test:e2e                          # 20/20，mock 模型
node scripts/rag-eval.mjs                 # RAG 30 题
AGENT_EVAL=1 node scripts/agent-eval.mjs  # Agent 18 条，真实模型
```

结果分别记录在 `docs/agent-eval.md`、`docs/rag-eval.md`、`docs/PERFORMANCE.md`。
