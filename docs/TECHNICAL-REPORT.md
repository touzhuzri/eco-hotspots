# 世界之树 · 技术文档

- PDF（提交版，18 页）：[`technical-report.pdf`](technical-report.pdf)
- 中文文件名副本（内容相同，便于直接上传）：[`世界之树-技术文档.pdf`](世界之树-技术文档.pdf)
- HTML 源文件（可重新打印）：[`technical-report.html`](technical-report.html)
- 团队：刘同字（队长）、刘峥
- 单位：华中农业大学 · 化学学院 · 应用化学
- 版本：v1.0 · 对应提交 `41bab21` · 2026 年 11 月

> PDF 为本项目的参赛技术文档，正文 18 页，满足“不超过 30 页”的要求。
> HTML 使用 A4 打印样式，可直接用浏览器“打印 → 另存为 PDF”重新生成。

## 章节结构

| 章节 | 内容 | 对应材料 |
| --- | --- | --- |
| 01 项目概述 | 背景、定位、主要工作、成果概览 | `README.md` |
| 02 需求分析 | 用户角色、功能需求、非功能需求、约束取舍 | `docs/ARCHITECTURE.md` |
| 03 系统架构设计 | 总体架构、前后端分层、数据层、数据流、技术选型 | `docs/ARCHITECTURE.md` |
| 04 AI 技术方案 | 模型选型理由、集成方式、工具层、RAG、多模态、研究任务、优化、安全 | `docs/AI-ARCHITECTURE.md` |
| 05 核心功能实现 | WebGL 世界树、场景交互、AI 分析坞、文件与表格、分子详情 | `src/`、`ai/` |
| 06 测试与部署 | 测试体系、实测结果、部署形态、安全验证、复现 | `docs/agent-eval.md`、`docs/rag-eval.md`、`docs/PERFORMANCE.md` |
| 07 创新点说明 | 6 项技术创新 + 5 项应用创新 | 本文档 |
| 08 总结与展望 | 总结、不足、后续方向 | `docs/NEXT_STEPS.md` |
| 附录 | 环境变量、依赖清单、仓库与团队、复现命令 | `docs/ENVIRONMENT.md` |

## 关键实测数据

| 指标 | 结果 | 条件 |
| --- | --- | --- |
| LOTUS 记录 | 227,319 | frozen 260413 |
| Agent 任务通过 | 18/18（100%） | `deepseek-v4-pro`，2026-11-13 |
| RAG Hit@4 | 30/30（100%） | `BAAI/bge-m3`，14 文档 / 26 片段 |
| RAG MRR | 1.000 | 同上 |
| RAG Cite@4 | 30/30（100%） | 同上 |
| 端到端测试 | 20/20 | mock 模型，不消耗 API |
| 单元测试 | 15/15 | 表格、核对、PDF |

## 重新生成 PDF

```bash
npm run docs:pdf
```

脚本会自动查找 Chrome / Edge（也可用 `CHROME_BIN` 指定），生成
`docs/technical-report.pdf` 与中文文件名副本，并检查页数不超过 30 页。
生成后请确认 `/ai/.env` 等敏感内容未写入文档。

## 相关文档

- [环境配置说明](ENVIRONMENT.md)
- [总体架构](ARCHITECTURE.md)
- [AI 架构](AI-ARCHITECTURE.md)
- [Agent 任务级评测](agent-eval.md)
- [RAG 检索评测](rag-eval.md)
- [性能与运行指标](PERFORMANCE.md)
- [部署与应急交接](DEPLOYMENT_HANDOVER.md)
- [公开仓库清单](PUBLISH.md)
