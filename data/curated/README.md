# 灌库接缝（LOTUS）

## 你本机要做的

1. 打开 https://doi.org/10.5281/zenodo.5794106 （或 LNPN/Wikidata 导出）  
2. 下载表格，放到 `data/raw/lotus/`，例如 `lotus-zenodo-5794106.tsv`  
3. 运行：

```powershell
node pipeline/lotus-ingest.mjs --in data/raw/lotus/lotus-zenodo-5794106.tsv --limit 2000
```

4. 刷新页面：会优先加载 `data/curated/lotus-eco.json` 中的精选节点，并与目录星合并。

## 验证管线（无网）

```powershell
node pipeline/lotus-ingest.mjs --fixture
```

## 土壤层长链烷烃

`soil-alkanes.json` 由 `pipeline/build-soil-alkanes.py` 生成：从 LOTUS
`Hydrocarbons` 类中筛出饱和无环、仅含碳且碳数 ≥ 10 的结构，附带 RDKit 2D 碳骨架坐标。
页面仅把它作为土壤层随机蠕动的装饰动画，不做分子卡片展示。

## 注意

- 自动归层/中文名可能不准 → 人工核对后再当正式科普内容  
- `cat:*` / 目录星 ≠ 已核验 LOTUS 条目  
- 许可：LOTUS 数据 CC0；见 `data/raw/lotus/README-SNAPSHOT.md`
