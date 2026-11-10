# LOTUS 天然产物数据集（本项目第一知识库）

类型：结构化数据库 / 系统知识库
版本：LOTUS frozen 260413
许可：LOTUS 数据以 CC0 开放
官网：https://lotus.naturalproducts.net/
下载：https://lotus.naturalproducts.net/download
引用：Rutz et al. 2022, eLife 11:e70780, https://doi.org/10.7554/eLife.70780

## 规模

本项目使用的 frozen 260413 快照包含约 227,319 条结构记录、1,602 个物种节点、2,038 个精选分子。页面上的“227,319 颗星”是记录数；按 InChIKey 去重后，当前元数据索引加载到 227,300 个唯一结构（早期构建说明记为 227,298，相差 2 条来自索引构建版本）。元数据按 InChIKey 前两位分成 631 个压缩分片存放。涉及实时数量时，以 query_molecules 工具的返回为准。

## 字段说明

每条分子记录包含以下字段：

- InChIKey：结构唯一标识，也是本项目跨模块关联、相似分子检索和领养的主键。
- SMILES：结构线性表示，用于 RDKit 计算、2D 结构式和 3D 构象生成。
- formula：分子式。
- exact mass：精确质量。
- XLogP：脂水分配系数预测值。
- npclass：NPClassifier 给出的天然产物分类路径。
- classyfire：ClassyFire 化学本体分类路径。
- family：来源生物科（如 Asteraceae、Fabaceae、Streptomycetaceae）。
- doi：原始文献 DOI，用于追溯数据来源。
- pubchem cid：PubChem 化合物编号，可做外部交叉引用。
- wikidata：Wikidata 标识。
- stereocenters、rings、aromaticRings、hbd、hba、tpsa、rotatableBonds、fractionCsp3：RDKit 计算的分子描述符。
- name：传统名或 IUPAC 名，过长时截断。

## 分类与来源示例

化学分类中记录较多的包括：未细分化学类别 6,635 条、Oleanane triterpenoids 6,375 条、Germacrane sesquiterpenoids 4,308 条、Flavonols 4,044 条、Flavones 3,209 条。

来源科中记录较多的包括：Asteraceae（菊科）22,670 条、Fabaceae（豆科）10,731 条、Streptomycetaceae 10,245 条、未标注科 9,675 条、Trichocomaceae 9,168 条。

## 本项目如何使用 LOTUS

1. 世界树：每颗星是一个 LOTUS 结构记录，树冠、树干、根际、土壤是展示用的生态层位映射，不是 LOTUS 原始字段。
2. 精确统计：问题里的数量、分类分布、来源科分布必须通过 query_molecules 工具查询，不能凭印象回答。
3. 相似分子：用 RDKit Morgan 指纹（半径 2、1024 位）加 Tanimoto 系数，在 227,298 条结构里找近邻。
4. 解释与出处：explain 工具返回 LOTUS 元数据；回答中的天然产物事实应注明“LOTUS 260413”。

## 局限性

- 卡片和论文里的数字可能来自不同快照；与 query_molecules 的实时统计冲突时，以工具返回为准，并说明差异。
- LOTUS 以文献报道为主，不等于自然界全部天然产物。
- 同一结构可能对应多条来源记录，统计时要区分“记录数”和“唯一结构数”。
- 分类和来源科来自原始文献与自动分类，存在未标注或标注不一致。
- LOTUS 不包含本项目展示用的生态层位字段，也不提供药效、安全性或临床结论。
- 数据只用于科学传播和教学演示，不构成用药建议。
