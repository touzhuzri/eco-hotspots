# LOTUS 分子元数据分片

由 `pipeline/build-molecule-meta.py` 生成，**不要手工修改**。

- 来源：LOTUS frozen 260413 metadata
- 许可：LOTUS 数据 CC0
- 规模：约 227,298 个唯一 InChIKey，631 个分片
- 文件：`<InChIKey 前两位>.json.gz`，key 为完整 InChIKey

每条记录是一个数组：

```text
0  smiles            1  formula          2  exact mass      3  xlogp
4  npclass[]         5  classyfire       6  family          7  doi
8  pubchem cid       9  wikidata         10 stereocenters
11 rings             12 aromaticRings    13 hbd             14 hba
15 tpsa              16 rotatableBonds   17 fractionCsp3
18 name（传统名/IUPAC，截断）
```

前端由 `src/engine/moleculeMeta.js` 按 InChIKey 前缀懒加载并解压；结构与分类描述来自 LOTUS 字段，描述符由 RDKit 计算。

重新生成：

```bash
python pipeline/build-molecule-meta.py
```
