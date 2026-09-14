# 剩余步骤清单（星点树阶段之后）

当前已完成（可直接 `index.html` 预览）：

- 诗云式分层：`contract / provider / engineApi / store / permalink`
- 星点世界树场景（默认参数已按你锁定的档位写入 `TREE_DEFAULTS`）
- 挂点按层映射 3D 锚点，点击开详情；筛选 + `#n=` / `#k=` 分享
- 根→干运输光（方向：根尖→树基→树干，默认光速 0.115）
- 土层点 + 微生物/蚯蚓 + 蝶/蜂/鸟（无棕色椭圆地平）
- A 交互打磨：标签防重叠、fly-to、⚙ 场景设置、弱机降级
- C 合规基础：页脚 LOTUS 论文 DOI + 非用药声明

## 默认场景参数（已固化）

| 键 | 值 |
|---|---|
| n | 8000 |
| flowSpeed | 0.115 |
| flow | 0.85 |
| soil | 2 |
| fauna | 2 |
| spread | 1.2 |
| 显示土壤/光/飞行生物 | 开 |

## 你回来后建议顺序

### A. 打磨交互 ✅ 已完成

1. 标签防重叠：AABB 错位，过挤只留点（选中仍显示）
2. fly-to：点击挂点或从链接恢复时相机轻推
3. 场景设置：右下 ⚙（点数 / 光速 / 光粒 / 自转 / 三套开关）
4. 弱机：`detectWeak` → 点数减半、隔点绘制、无光拖尾

### B. 数据层 ✅ 接缝已就绪

1. ~~LOTUS 快照目录~~ → `data/raw/lotus/README-SNAPSHOT.md`
2. ~~灌库脚本~~ → `pipeline/lotus-ingest.mjs`（`--fixture` 可跑通）
3. ~~load 优先 curated~~ → `data/curated/lotus-eco.json` 有则覆盖 SAMPLE
4. 待你本机下载 Zenodo 快照后：`node pipeline/lotus-ingest.mjs --in <file>` 再人工核对

### D. 可选升级

### C. 内容与合规 ✅ 基础已完成

1. ecoRole / 文献槽已在详情面板
2. 不把「天然产物」默认成「农药」
3. 页脚已挂 LOTUS 论文 DOI 与非用药声明；可再加独立许可页

### D. 可选升级

1. three.js 真 3D（Points + 自定义 shader）替换 Canvas 2D 伪 3D
2. 分子 2D 结构图（RDKit.js 或静态 SVG）
3. 按 kingdom / layer 的目录侧栏（类似诗云 PoetPanel 列表）

## 稳定边界（改皮时勿破）

- UI 只调用 `src/engine/engineApi.js`
- 数据只经 `provider.setDataset`
- 永久链接格式：`#n=<nodeId>&k=<kingdom>`

## 验证

```powershell
# 静态服务任选其一后打开
# 例：若本机有 python
python -m http.server 5173 --directory D:\shijieshu
# 浏览器打开 http://localhost:5173
```

或直接用桌面打开 `D:\shijieshu\index.html`（ES module 需 http 源时更稳）。
