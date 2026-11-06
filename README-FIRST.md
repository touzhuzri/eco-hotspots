# 世界树 · 校园服务器离线部署包

> 这是一个“拿来即可跑”的离线包：站点、Three.js、RDKit、LOTUS 数据、3D 分片、Node 运行时和部署文档都在里面。
> 不需要 npm install，不需要 Python，不需要数据库，不需要外网 CDN。

---

## 1. 三分钟开始

> Windows 服务器请直接看第 4 节。

### 第一步：上传并解压

把压缩包上传到服务器，例如 `/tmp`：

```bash
mkdir -p /opt/shijieshu
unzip shijieshu-school-offline-*.zip -d /opt/shijieshu
cd /opt/shijieshu
```

如果服务器没有 `unzip`，可以用：

```bash
busybox unzip shijieshu-school-offline-*.zip -d /opt/shijieshu
# 或
bsdtar -xf shijieshu-school-offline-*.zip -C /opt/shijieshu
# 或
python3 -m zipfile -e shijieshu-school-offline-*.zip /opt/shijieshu
```

都没有的话，在电脑上解压后直接上传目录。

### 第二步：启动

```bash
cd /opt/shijieshu
chmod +x install-offline.sh start.sh deploy/preflight.sh
./install-offline.sh
```

`install-offline.sh` 会：

- 优先使用系统 Node（要求 >= 18）
- 如果没有 Node 或版本太低，自动解压包内 Node 22.14.0 到 `.runtime/node`
- 然后调用 `start.sh` 启动站点和领养服务

面板/Docker 用前台运行（默认）；普通 VPS 也可以：

```bash
./install-offline.sh daemon
```

### 第三步：放行端口

默认公开端口 `5173`，面板可能注入 `PORT`。也可以指定：

```bash
SITE_PORT=41018 ./install-offline.sh
```

防火墙只放行这一个端口；**不要**放行内部领养端口 `8788`。

### 第四步：验证

```bash
curl -I http://127.0.0.1:41018/
curl http://127.0.0.1:41018/api/claim/health
```

浏览器访问：

```text
http://服务器IP:41018/
```

看到世界树、左侧探索栏、右侧详情卡就成功了。

---

## 2. 这个包里面有什么

```text
index.html, css/, src/, assets/       站点前端
data/curated/                          LOTUS 精选/结构云/土壤烷烃
data/molecules/                        LOTUS 元数据分片
data/molecules3d/                      202,665 个分子的 3D 分片（631 个分片）
vendor/three/                          本地 Three.js + addons（不走 CDN）
vendor/rdkit/                          本地 RDKit.js + WASM（2D 结构式）
deploy/site-server.mjs                 静态站 + /api 同源代理（零依赖）
deploy/claim-server.mjs                领养服务（零依赖，JSONL）
deploy/preflight.sh                    部署前环境体检（只读）
docs/DEPLOYMENT_HANDOVER.md            完整交接手册（部署/备份/回滚/灾难恢复）
install-offline.sh                     Linux/macOS 离线启动器（自动使用包内 Node）
start-windows.cmd                      Windows 启动/停止/状态
install-windows.ps1                    Windows Node 准备与启动
deploy/windows-launcher.mjs            Windows 进程拉起器（无需 bash）
start.sh                               Linux 一键启动/停止/状态
runtime/                               Node 22.14.0 Linux x64/arm64 + Windows x64 离线包
runtime/SHASUMS256.txt                 Node 官方校验值
```

不含：`claims.jsonl`、`logs/`、`.git/`、`node_modules/`、原始 LOTUS 数据。
`claims.jsonl` 是服务器上的运行时数据，升级时不会被这个包覆盖。

---

## 3. 端口与架构

```text
浏览器
  ↓ 443 或校园端口
学校 Nginx / TLS / WAF
  ↓ 127.0.0.1:41018
site-server.mjs
  ↓ 127.0.0.1:8788
claim-server.mjs
```

- 对外只暴露站点端口。
- `8788` 只绑定 `127.0.0.1`，不要开放。
- 如果学校只给 80/443，用 Nginx 反代到 `127.0.0.1:41018`；配置见交接手册。
- 站点必须放在**域名根路径**；如果只能给 `/world/` 子路径，需要改前端资源路径，先联系技术支持。

主要环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SITE_PORT` | `PORT` / `SERVER_PORT` / `5173` | 公开站点端口，优先级最高 |
| `CLAIM_PORT` | `8788` | 内部领养端口 |
| `CLAIM_FILE` | `./claims.jsonl` | 领养账本路径 |
| `BIND_HOST` | `0.0.0.0` | 站点绑定地址 |

示例：

```bash
SITE_PORT=41018 \
CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl \
./install-offline.sh
```

---

## 4. Windows 服务器

包内已经带 `node-v22.14.0-win-x64.zip`，不需要额外下载 Node。

### 首次准备

在解压后的目录打开 PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1
```

它会：

- 优先使用系统 Node 18+
- 没有或版本太低时解压包内 Windows Node 到 `.runtime\node`
- 启动站点和领养服务

也可以直接双击/运行：

```bat
start-windows.cmd
```

### 指定端口

```bat
set SITE_PORT=41018
start-windows.cmd
```

### 状态 / 停止

```bat
start-windows.cmd status
start-windows.cmd stop
```

### Windows 防火墙

管理员 PowerShell：

```powershell
New-NetFirewallRule -DisplayName "Eco Hotspots 41018" -Direction Inbound -Protocol TCP -LocalPort 41018 -Action Allow
```

云服务器/学校安全组也要放行同一端口。

### 开机自启

Windows 服务器可以用任务计划程序（Task Scheduler）在开机时运行：

```text
程序：C:\path	o\start-windows.cmd
起始于：C:\path	o
```

或用 NSSM 注册为 Windows 服务。不要用 `start.sh`，那是 Linux/macOS 的脚本。

### Windows 注意

- 包内是 **win-x64**；Windows ARM64 请另行准备 Node。
- `start-windows.cmd` 是前台进程，关闭窗口/按 Ctrl+C 会停止服务。
- 日志在 `logs\site.log`、`logs\claim.log`。
- 账本默认 `claims.jsonl`；长期部署请用 `CLAIM_FILE` 指向独立可备份目录。

---

## 5. 升级、备份与回滚

### 备份账本

```bash
mkdir -p /var/backups/eco-hotspots
cp -a /var/lib/eco-hotspots/claims.jsonl \
  /var/backups/eco-hotspots/claims-$(date +%F-%H%M).jsonl
chmod 600 /var/backups/eco-hotspots/*.jsonl
```

### 升级

```bash
./start.sh stop
# 解压新版本到新目录，或覆盖代码（不要覆盖 claims.jsonl）
cd /opt/shijieshu
CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl SITE_PORT=41018 ./install-offline.sh
```

### 回滚

```bash
./start.sh stop
mv /opt/shijieshu /opt/shijieshu-broken
mv /opt/shijieshu-previous /opt/shijieshu
cd /opt/shijieshu
CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl SITE_PORT=41018 ./install-offline.sh
```

完整的备份、迁移、灾难恢复和排障流程见：

```text
docs/DEPLOYMENT_HANDOVER.md
```

---

## 6. 学校服务器先做一次体检

```bash
cd /opt/shijieshu
sh deploy/preflight.sh > /tmp/eco-preflight.txt 2>&1
cat /tmp/eco-preflight.txt
```

把输出发给技术支持，可以快速确认：

- 有没有 Node、版本多少
- 系统是 x64 还是 arm64、glibc 还是 musl
- 端口占用和防火墙
- 3D 分片、vendor、RDKit 是否完整
- 磁盘/内存是否够

---

## 7. 常见问题

| 现象 | 处理 |
| --- | --- |
| 面板显示“服务器已停止” | 面板用前台 `./install-offline.sh`，不要用 `daemon` |
| 没有 `unzip` | 用 `busybox unzip`、`bsdtar`、`python3 -m zipfile -e`，或上传已解压目录 |
| 没有 `bash` | 按交接手册 5.7 手动启动两个 Node 服务 |
| Alpine/musl | 包内是 glibc Node；Alpine 请用 musl 兼容的 Node 或 apk 离线包 |
| Windows 服务器 | 用 `start-windows.cmd` 或 `install-windows.ps1`；包内已带 win-x64 Node |
| 页面卡在加载 | 检查 `vendor/three/` 是否完整、`index.html` 是否最新；不要使用旧 CDN 版本 |
| 2D 结构不显示 | 检查 `vendor/rdkit/RDKit_minimal.wasm`、Nginx 的 `.wasm` MIME |
| 3D 不显示 | 检查 `data/molecules3d/`；缺失时自动回退 2D，不是故障 |
| 领养不可用 | 检查 `8788`、`/api/claim/health`、`logs/claim.log` |
| 复制链接失败 | 使用 HTTPS；HTTP 下新版已有降级复制 |
| 域名子路径 | 需要改 import map / 资源路径；优先申请根路径子域名 |
| 上传限制 100MB | 用 SFTP/rsync 上传；或联系技术支持拆分上传 |
| 校徽/校名使用 | 确认已获学校宣传/信息化部门允许 |

---

## 8. 目录与文件完整性

正常完整包：

```text
3D 分片：631 个
data：约 122MB
vendor：约 22MB
项目解压后：约 312MB
Node 运行时：约 140MB（Linux x64/arm64 + Windows x64）
```

检查：

```bash
find data/molecules3d -name '*.json.gz' | wc -l
sha256sum -c runtime/SHASUMS256.txt
```

`runtime/SHASUMS256.txt` 只校验 Node 官方包；整个离线包的 SHA-256 由交付时单独提供。

---

## 9. 停止与状态

```bash
./start.sh stop
./start.sh status
./start.sh restart
```

`stop` 不需要 Node。`status` 和 `restart` 需要 Node；`install-offline.sh` 会准备好 Node。

---

## 10. 技术支持需要的信息

如果启动失败，请提供：

```text
sh deploy/preflight.sh 的输出
./start.sh status
tail -n 80 logs/site.log
tail -n 80 logs/claim.log
学校给的域名/端口/部署路径
是否有 Nginx / systemd / 面板
```

不要发送服务器密码、SSH 私钥或 `claims.jsonl` 内容。
