# 分子领养服务

零依赖 Node HTTP 服务，负责“一个分子只能被领养一次”。

## 一键启动（含静态站）

项目根目录：

```bash
./start.sh          # 前台启动（面板推荐，进程不退出）
./start.sh daemon   # 后台启动
./start.sh status
./start.sh stop
```

默认只公开 **5173** 一个端口；站点会把同源 `/api` 反向代理到内部的 8788。
依赖 Node.js 18+（项目 `.mise.toml` 指定 Node 22.14.0）。
面板若设置 `$PORT`，启动脚本会优先使用该端口。

## 本地运行

```bash
node deploy/claim-server.mjs
# http://127.0.0.1:8788
```

本机开发访问 `localhost:5173` 时，前端直连 `http://localhost:8788/api`；
其他地址/端口统一请求同源 `/api`，由 `deploy/site-server.mjs` 代理到内部 8788。
服务端默认允许所有 Origin；生产环境建议设置：

```bash
ALLOW_ORIGIN=https://your-site.example \
HOST=0.0.0.0 \
CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl \
node deploy/claim-server.mjs
```

## 生产部署（同源 /api）

nginx 反代示例：

```nginx
location /api/claim {
  proxy_pass http://127.0.0.1:8788;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

如果服务在别的域名，在 `index.html` 里设置：

```html
<script>
  window.ECO_CLAIM_ENDPOINT = "https://claim.example.com/api";
</script>
```

## 规则

- 一个 InChIKey 只能被领养一次
- 同一访客可以领养多颗（visitor token 存 localStorage）
- 名字可留空 → 前端显示「神秘用户」
- 同一 visitor token 可以改名
- 领养信息只在该分子的介绍卡中出现；没有公开领养墙或排行榜

## 数据与隐私

`claims.jsonl` 每行只包含：

```json
{"op":"claim","key":"...","name":"...","ts":...,"ownerHash":"sha256(visitor)"}
```

- 不存 IP / UA / 邮箱
- 名字是公开显示名，前端渲染时会转义
- 名字最长 20 字；控制字符会被清理
- `claims.jsonl` 已加入 `.gitignore`，请单独备份
- 服务为单进程设计；不要多实例同时写同一个 JSONL

## 合法性校验

服务启动时会读取 `data/molecules/facets.json.gz`，只允许领养 LOTUS 中真实存在的 InChIKey。
如果该文件缺失，会退回 InChIKey 形状校验并在日志中警告。

## 接口

```text
GET   /api/claim?key=<InChIKey>&visitor=<token>
POST  /api/claim       { key, name, visitor }
PATCH /api/claim       { key, name, visitor }
GET   /api/claim/health
```
