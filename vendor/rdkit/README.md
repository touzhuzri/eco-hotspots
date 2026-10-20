# RDKit.js (vendored)

用于详情卡中按需把 SMILES 渲染成 2D 结构 SVG。

- 来源：https://github.com/rdkit/rdkit-js
- 构建：`@rdkit/rdkit` npm 包的 `dist/RDKit_minimal.js` + `RDKit_minimal.wasm`
- 许可：BSD-3-Clause（以 RDKit / rdkit-js 上游许可为准）
- 加载方式：`src/ui/smilesRender.js` 在用户展开结构式时才动态加载，不在首屏加载。

文件：

- `RDKit_minimal.js`
- `RDKit_minimal.wasm`
