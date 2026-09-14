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

## 注意

- 自动归层/中文名可能不准 → 人工核对后再当正式科普内容  
- `cat:*` / 目录星 ≠ 已核验 LOTUS 条目  
- 许可：LOTUS 数据 CC0；见 `data/raw/lotus/README-SNAPSHOT.md`
