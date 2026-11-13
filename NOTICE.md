# NOTICE · 原创性与第三方声明

本项目（天然产物 · 世界树）为独立开发的 Web 应用与 AI 分析系统。除下列明确标注的第三方数据、库与参考材料外，界面、场景代码、AI 工具层、研究任务流程、RAG 管线与文档均为本项目原创。

- 站点徽标、加载动画、星点树造型与交互均为本项目自制或程序化生成。
- 页面不包含其他学校、机构或商业品牌的标识素材。
- AI 生成的回答、图表与研究简报均标注来源；仅供科学传播与教学演示，不构成用药建议。

## 1. 数据

| 数据 | 许可 | 来源 |
| --- | --- | --- |
| LOTUS 天然产物结构、生物来源、分类、描述符（frozen 260413） | CC0 1.0 | <https://lotus.naturalproducts.net/> |
| LOTUS 3D 构象分片 | 由上述 LOTUS SMILES 经 RDKit ETKDG 离线生成 | 本项目 pipeline |
| 相似性索引 | 由上述 LOTUS 结构经 RDKit Morgan 指纹生成 | 本项目 pipeline |

使用 LOTUS 数据时请同时引用其论文与数据快照：

> Rutz A, Sorokina M, Galgonek J, et al. The LOTUS initiative for open knowledge management in natural products research. *eLife*. 2022;11:e70780. <https://doi.org/10.7554/eLife.70780>

LOTUS 数据快照版本为 **260413**（约 227,319 条结构记录）。本项目不重新分发 LOTUS 原始 CSV，只分发由其衍生的压缩分片；衍生数据同样遵循 CC0。

## 2. 第三方软件

| 组件 | 许可 | 用途 | 位置 |
| --- | --- | --- | --- |
| Three.js r169 | MIT | WebGL 场景、Bloom 后处理 | `vendor/three/` |
| RDKit.js / RDKit WASM | BSD 3-Clause | SMILES 解析、2D 结构式、Morgan 指纹 | `vendor/rdkit/` |
| MediaPipe Tasks Vision | Apache 2.0 | 手势识别（可选功能） | `vendor/mediapipe/` |
| Node.js 内置模块 | MIT | 静态站、领养服务、AI 代理 | `deploy/`、`ai/` |

各库的完整许可文本随其目录分发，或以链接形式提供：

- Three.js：<https://github.com/mrdoob/three.js/blob/dev/LICENSE>
- RDKit：<https://github.com/rdkit/rdkit/blob/master/license.txt>
- MediaPipe：<https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE>

## 3. 参考论文与网站

`data/kb-seed/references.json` 收录的是**参考资料条目**（题录、DOI、URL 与项目自写摘要），不是原文全文。涉及：

- LOTUS eLife 2022、ClassyFire、NPClassifier、COCONUT / COCONUT 2.0；
- LOTUS 官网与下载页、ChEBI、PubChem、RDKit、Three.js、智谱开放平台、MDN。

这些条目的版权归原作者或站点所有，本项目仅以链接和摘要形式引用。

## 4. 外部检索边界

- OpenAlex、Crossref、Europe PMC 通过其公开 API 检索题录。
- 知网、万方、Web of Science 没有公开检索 API；本项目只生成**官方检索入口链接**，不抓取、不保存需要机构登录或订阅的受限全文。
- Nature 通过 ISSN 在公开 API 中过滤，并附官网检索入口。

## 5. AI 服务

AI 分析通过 OpenAI 兼容接口调用用户自行配置的模型服务（DeepSeek / 智谱 GLM / MiMo / SiliconFlow 等）。API Key 只保存在服务端 `.env` 或 `.run/ai-config.json`，不写入前端、不进入仓库、不随部署包分发。模型的输出可能不准确，项目通过“数字必须走 LOTUS 工具、结论必须给出来源、不确定性必须写明”的约束降低风险，但不保证完全正确。

## 6. 许可

本项目代码以 **MIT License** 发布，见 [`LICENSE`](LICENSE)。第三方数据与软件仍遵循其各自许可。
