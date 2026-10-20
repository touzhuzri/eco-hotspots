# 空间点云叙事站 — 制作手册（Agent 可读）

> 目标：用 **三维点云** 做可缩放、可检索、可连线的叙事/教育站。  
> 不必是「有机世界树」：可换成星系、建筑、立体生物、文字云、诗句星座等。  
> 核心是 **场（field）定义形态 + 拒绝采样 + 距离自适应渲染 + 交互拾取**。

---

## 0. 心智模型

```text
数据条目 (id, 名称, 来源, 元数据, 分层标签)
        ↓ 场采样 sample(field, layer)
三维点 (x,y,z, kind, layer, role)
        ↓ 打包 BufferAttribute
WebGL Points + 自定义 shader
        ↓ 屏幕投影
拾取 / 连线 / 检索 / 飞近详情
```

**不要**先做三角网格再挂点。先写「哪里允许有点、点多密」的**密度场**，再撒点。

---

## 1. 可替换的形态（场参数）

| 形态 | 场要点 |
|------|--------|
| 世界树 | 椭球冠 + 抛物面圆顶密度、管状干/枝、地下根、土盘 |
| 星系 | 旋臂 `ρ(r,θ) ∝ exp(-r/h)·cos(mθ-kr)` + 中心核球 |
| 建筑 | 多盒体/柱体 SDF 并集，楼层切片 `floor(y)` |
| 立体生物 | 骨骼线段管状 + 关节球 + 表皮噪声壳 |
| 文字/诗句 | 字形轮廓或字符网格转 2.5D，诗句按行分层、按字高程 |

**层（layer）** 是交互与配色的第一公民，例如：`core / limb / leaf / soil / sky` 或 `verse / line / char`。

---

## 2. 项目结构（稳定契约）

```text
index.html          importmap + 静态壳
css/styles.css      全屏虚空 UI
src/
  main.js           boot、加载层、订阅重渲染
  data/
    contract.js     数据形状约定
    provider.js     当前数据集
    load.js         拉取 + 进度回调
  engine/
    engineApi.js    UI 唯一查询入口（点列表、检索、缓存）
    shapePoints.js  形态场采样 → 点数组（本项目是 moleculePoints）
  scene/
    ShapeScene.js   three.js 场景、shader、拾取、相机
    field.js        纯函数场（本项目是 starTree）
  state/
    store.js        selectedId / filter / emit
    permalink.js    #n=id 深链
  ui/
    DetailPanel.js  选中详情
```

**规则：** UI 不直接遍历原始大数组做业务过滤；一切经 `engineApi`。

---

## 3. 场与采样（形态可复用）

### 3.1 密度场（决定轮廓）

```js
// 顶不要硬切：让 ρ → 0，轮廓是等值面
// 硬 clamp 只当保险
function shapeField(x, y, z, g) {
  // 1) 归一化到形态包围盒/骨架
  // 2) 基础密度 1 - d
  // 3) 多频噪声扰动有效半径 → 凹凸
  // 4) 边缘 soft cutoff
  return clamp01(rho);
}
```

**教训：**  
- `if (y > top) y = top` → 削平平台（红线）。  
- 应用抛物面/密度衰减（绿线弧顶）。  
- 冠/壳过大 + 中心柱过细 → 「台灯」：比例优先于噪声。

### 3.2 拒绝采样

```js
for (attempt = 0; attempt < maxTry; attempt++) {
  p = randomInBox();
  ρ = field(p);
  if (rnd() < ρ) return p;
}
return fallbackCenter;
```

每条数据点带 `layer / kind / part`，渲染与入场动画都靠这些标签。

### 3.3 骨架管（干、枝、旋臂、笔画）

```js
tubePoint(rnd, path(t), thick(t))
// path: 参数曲线；thick: 半径
// 沿 t 采样 + 截面圆盘偏移
```

---

## 4. 数据侧（内容可换）

```js
// 每条目最少字段
{
  id, nameZh, nameEn?,
  source,          // 来源：生物/作者/建筑名
  layer,           // 在形态中的层
  kingdom?/group?, // 大类（筛选）
  meta: { ... },
  inchikey? / ref? // 稳定外键或引用
}
```

- 精选条目（可点、可连线、有详情）  
- 海量结构/字词云（只构成形体，可飞近）  
- 检索：`name / source / id` 子串，防抖 180ms，精选优先  

大 JSON（>10MB）：流式 `fetch` + `Content-Length` 做进度条。

---

## 5. 渲染（WebGL 星点）

### 5.1 要点

- `THREE.Points` + `ShaderMaterial`  
- `AdditiveBlending`，`depthWrite: false`  
- 软圆盘：`smoothstep(0.5, 0.06, d)` + 核心 `core`  
- **自定义 shader 默认不吃 fog** → 远景压亮度必须在 shader 里做  

### 5.2 距离自适应（缩小过曝 / 放大发糊）

```glsl
vNear = smoothstep(18.0, 3.5, vz);
vFar  = smoothstep(22.0, 58.0, vz); // 只在很远压
// 近：收边 + 硬核；远：软盘 + 压 dim
// gl_PointSize 上限近处更小（锐利）
```

JS 侧再乘 `lodScale(dist)` 微调 `uSizeScale`。

### 5.3 闪烁（可选）

相位由 `aSeed` 决定的多正弦 + 偶发 `pow(sin, 12)` 尖峰。

### 5.4 沉浮（慎用）

`aFlex` 顶点位移很好看，但 **拾取/连线用静态坐标** → 看见的点点不中、线从虚空发出。  
**产物点 `aFlex=0`**；运动只给装饰流光/粒子。

---

## 6. 相机

| 模式 | 行为 |
|------|------|
| 默认环绕 | 拖拽改 yaw/pitch；滚轮乘法缩放 `×1.12 / ×0.89` |
| 阻尼 | `k = 1 - pow(0.0025, dt)`，位置与 **注视点同速率** lerp（防平移甩头） |
| flyTo | 选中飞近；中断飞行若停自转会像 bug，需恢复 |
| 选中自转 | 可降到 1/10 |
| WASD | 平移注视点，**不要**中途切成第一人称（远景半径大，必甩飞） |
| 第一人称 | 仅显式开关（如 `~` + Pointer Lock） |
| 远景回中 | 拉到最远且未交互时，缓动回形态中心 |

`DIST_MAX` 过大 → 总览里形体过小；过小 → 裁切。总览「放大约 3 倍」= **距离约 1/3**，不是点径 ×3。

---

## 7. 拾取与连线

### 7.1 星点拾取

- 远景只扫 featured（性能）  
- 近景全扫，命中半径随 `q.z` 变  
- **有连线时：线优先，星只认「贴核」~13px**（否则光晕永远抢过细线）

### 7.2 连线（同源/同作者/同 verse）

```text
按 parent key 归并（source / node / verseId）
最多 ~200 条，fat line (LineSegments2)
```

### 7.3 磁吸悬停（可选增强）

- **迟滞**：掠过贴近线身才吸上；吸上后保持到「两端屏幕距离一半」  
- 吸上后锁定该线，路过邻线不切换  
- 磁吸偏移 **压到相机平面**（3D 朝屏幕外拉会与屏幕拾取不一致 → 易断）  
- 保持距离对 **弯曲线** 采样，不对直线  
- 断开：弹性回弹淡出，不是瞬间消失  
- 名牌可点 = 与点线同一 `setSelected`

### 7.4 选中状态

- 一次 `setSelected` → 订阅里统一 `flyTo + links + glow`  
- **禁止**点击路径与 subscribe 双重 O(n) 扫描  
- `glowKey` 未变则跳过全量高亮  

---

## 8. 入场生长（可选）

```text
aReveal ∈ [0,1] 属性 + uReveal 时间轴
rev = smoothstep(aReveal-ε, aReveal+ε, uReveal)
size/alpha *= rev
```

- 顺序：底/核心先，顶/叶后；**同高度加方位微扰**，避免水平一刀切闪出  
- 总时长 4–6s 较舒服；9s+ 易觉得「卡住」  
- 首次进入播；之后 rebuild 不重播  

---

## 9. 性能红线

| 项 | 建议 |
|----|------|
| 点数 | 10万–30万可交互；>8万默认关 bloom |
| 状态变更 | 全量 glow/pointStats 要缓存或 key 去重 |
| 检索 | 防抖 + 精选优先 + 上限 12 条 |
| 拾取 | 远景不要 22 万次 project |
| 加载 | 流式进度；建点云前先 `requestAnimationFrame` 画一帧进度 |

---

## 10. UI 壳

- 全屏黑底 + 半透明详情栏（右侧）  
- 左上检索；右上 ⚙（点径/亮度/自转）  
- 竖屏手机：全屏「请横屏」；横屏布局≈桌面  
- 取景 `setViewOffset` 向左让出详情栏宽度  
- 字号/详情栏宽度用 `vw/vh` + 断点  

---

## 11. 部署

```text
静态站：index.html + css + src + data/curated
three: CDN importmap（unpkg/jsdelivr），不提交 node_modules
```

- 国际：Vercel / Netlify（GitHub push 自动）  
- 国内直连：腾讯云 IIS / COS 静态托管  
  - IIS：文件进 `C:\inetpub\wwwroot`，安全组 TCP 80  
  - 腾讯云 Web 终端：`$ProgressPreference='SilentlyContinue'`，避免 0x5 进度条报错  
- 深链：`#n=<id>`，便于分享选中态  

---

## 12. 踩坑清单（务必避免）

1. **TREE/形态体积旋钮来回改** → 一锁一改，问清再动  
2. **体积 / 抖动 / 点径混在一个旋钮** → 一旋钮一属性  
3. **加法混合 + 无距离压暗** → 缩小一片白  
4. **自定义点云 shader 无 fog** → 远景必须 shader 压亮  
5. **顶点沉浮 + 静态拾取** → 点不中、线穿虚空  
6. **未选中拖拽中途切相机模式** → 飞到原点/甩飞  
7. **注视点瞬时跳、相机位置阻尼** → WASD 像转视角，晕  
8. **硬 clamp 做造型** → 平顶；应用密度收紧  
9. **线优先级低于星** → 细线永远点不到  
10. **入场 9s+ 无进度** → 用户以为死了  

---

## 13. 换形态时的最小改造清单

1. 重写 `field.js`（一个 `shapeField` + 骨架路径）  
2. `layer` 枚举与 `LAYER_COLOR` 对齐新语义  
3. `samplePoints` 按 layer 权重撒点  
4. `revealOrder` 按新层的空间顺序  
5. 检索字段名（作者/诗句/构件）  
6. 连线 parent key（同源/同诗/同建筑）  
7. 详情卡文案  
8. 可选：保留磁吸连线与入场，交互层可原样搬  

---

## 14. 验收清单

- [ ] 总览剪影一眼可读（不是灯罩/不是削平球）  
- [ ] 缩小不糊成白团，放大点仍锐利  
- [ ] 点得中、线点得中、悬停有提示  
- [ ] 选中后 flyTo + 连线 + 详情一致  
- [ ] 空白点击 / Q 可取消  
- [ ] 首次加载有进度；二次明显变快  
- [ ] 手机横屏可用；竖屏有引导  
- [ ] 国内 IP 或 Vercel 链接可分享  

---

**一句话：**  
先用密度场定剪影，再采样挂数据；渲染管距离与拾取，交互管迟滞与单次 O(n)；形态可换，「场 → 点 → 星 → 交互」这条链不要拆。
