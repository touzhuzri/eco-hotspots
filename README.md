# 天然产物 · 生态挂点

WebGL 星点世界树：LOTUS 天然产物结构云挂载在生态树上，可缩放、检索、连线。

## 本地预览

```powershell
cd D:\shijieshu
python -m http.server 5173
# 打开 http://127.0.0.1:5173/
```

`three` 已改为 unpkg CDN（见 `index.html` importmap），本地无需 `node_modules` 也能打开。

## 部署到 Vercel

1. 将本仓库推到 GitHub（勿提交 `node_modules/`、`scratch/`、大 zip、`data/raw/`）
2. 打开 [vercel.com](https://vercel.com) → **Add New… → Project** → Import 该仓库
3. Framework Preset 选 **Other**，无需 Build Command，Output 为根目录
4. Deploy 后得到 `https://<project>.vercel.app`

### 或用 CLI

```powershell
npm i -g vercel
cd D:\shijieshu
vercel
```

## 仓库应包含

- `index.html`
- `css/`
- `src/`
- `data/curated/`（约 31MB：`lotus-structures.json`、`lotus-eco.json`）
- `vercel.json`、`package.json`、本 README

## 数据说明

LOTUS frozen export（CC0）骨架，仅作科学传播与教学演示，**不构成用药建议**。
