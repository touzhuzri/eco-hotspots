# 生态挂点 / Eco Hotspots — Architecture

借「诗云」的分层原则：**稳定边界 + 可替换前端壳**。可视化可以整页重写，数据契约与查询接口不能碎。

## 分层

```
┌──────────────────────────────────────────────┐
│  FRONTEND（可替换）                            │
│  src/scene/*   星点树 + 挂点投影（可替换皮）     │
│  src/ui/*      筛选、详情、壳                   │
│  src/main.ts   装配                             │
└───────────────────┬──────────────────────────┘
                    │ 只调用
                    ▼
┌──────────────────────────────────────────────┐
│  ENGINE API（稳定）                            │
│  src/engine/engineApi.js                     │
│  列表 / 过滤 / 按 id 取 / 分子汇总 / 永久链接      │
└───────────────────┬──────────────────────────┘
                    │ 只读
                    ▼
┌──────────────────────────────────────────────┐
│  DATA CONTRACT（稳定）                         │
│  src/data/contract.js  字段与枚举              │
│  src/data/provider.js  数据集接缝              │
│  src/data/dataset.js   当前示例集               │
└──────────────────────────────────────────────┘
```

## 稳定契约（新前端必须遵守）

1. **Engine API** — UI 不自己拼过滤逻辑；调用 `listNodes` / `getNode` / `filterNodes` / `moleculeCatalog`。
2. **Data contract** — 节点与分子字段见 `contract.js`；用途字段允许 `null`（本阶段不展示农药用途）。

## 数据流（点开一个挂点）

```
click hotspot
  → engineApi.getNode(id)
  → store.select(id)
  → DetailPanel 渲染
  → permalink.sync()  →  #n=<id>&k=<kingdom>
```

## 设计原则（来自诗云，按需裁剪）

| 原则 | 在本项目的落法 |
|---|---|
| 前端可替换 | 树可以先 SVG，以后换 Canvas/WebGL；engine/data 不动 |
| 稳定 API | 所有过滤/检索走 engineApi |
| 可分享链接 | `#n=nodeId`，`#k=植物` |
| 100% 静态 | 无后端；数据随包或后续可拆分片 |
| 示例 ≠ 正式库 | InChIKey/学名标注「待 LOTUS 核对」 |

## 目录

```text
index.html
css/styles.css
src/
  data/     contract · provider · dataset · load
  engine/   engineApi
  state/    store · permalink
  scene/    TreeScene
  ui/       Filters · DetailPanel
  main.js
docs/ARCHITECTURE.md
```

## 扩展顺序建议

1. 用 LOTUS 快照替换 `dataset.js`（或 `provider.setDataset`）  
2. 增加 `use` / `mechanism` 标注层（可选字段，engine 可过滤）  
3. 需要时再换 3D 树皮，不改 engine  
