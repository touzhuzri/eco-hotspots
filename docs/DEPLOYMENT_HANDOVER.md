# 世界树 · 部署与应急交接手册

> 适用项目：`touzhuzri/eco-hotspots`（天然产物 · 世界树）
> 文档目标：让没有参与开发的人，在一台**完全空白**的 Linux 服务器上也能部署、更新、回滚和排障。
> 最后更新：2026-10-28

---

## 0. 一页速查

```text
项目形态：纯静态前端 + 零依赖 Node 静态服务器 + 零依赖 Node 领养服务
运行时：Node.js >= 18（推荐 22.14.0）
不需要：npm install、Python、数据库、Redis、外网 CDN
公开端口：一个（默认 5173，面板常用 PORT/SITE_PORT，例如 41018）
内部端口：8788（领养服务，只绑定 127.0.0.1）
入口：http://服务器IP:端口/
健康检查：http://服务器IP:端口/api/claim/health
```

最小启动：

```bash
mkdir -p /opt/shijieshu
unzip shijieshu-full.zip -d /opt/shijieshu
cd /opt/shijieshu
chmod +x start.sh
./start.sh
```

只放行站点端口；**不要**把 8788 暴露到公网。

---

## 1. 系统组成

### 前端

- `index.html`、`css/`、`src/`
- Three.js：`vendor/three/`（本地，不走 CDN）
- RDKit.js：`vendor/rdkit/`（本地 2D 结构式 + WASM）
- 浏览器负责 WebGL 世界树、钟表、3D 球棍模型和 RDKit 渲染

### 服务端

| 文件 | 作用 | 依赖 |
| --- | --- | --- |
| `deploy/site-server.mjs` | 静态站 + 同源 `/api` 反向代理 | Node 内置模块 |
| `deploy/claim-server.mjs` | 分子领养接口 + JSONL 账本 | Node 内置模块 |
| `start.sh` | 启动/停止/查看状态 | Bash + Node |

### 数据

| 路径 | 内容 | 是否运行必需 |
| --- | --- | --- |
| `data/curated/` | 精选节点、LOTUS 结构云、土壤烷烃 | 是 |
| `data/molecules/` | LOTUS 元数据分片、facets | 是 |
| `data/molecules3d/` | 202,665 个分子的 3D 分片 | 否；缺失时回退 2D |
| `vendor/three/` | Three.js 和 addons | 是 |
| `vendor/rdkit/` | 2D 结构式渲染 | 否；缺失时结构式不可用 |

### 状态

| 文件 | 内容 | 说明 |
| --- | --- | --- |
| `claims.jsonl` | 领养事件账本 | **唯一必须长期保留的运行时数据** |
| `logs/` | 运行日志 | 可删 |
| `.run/` | PID 文件 | 可删 |

没有数据库。没有后端账号体系。没有 API key。

---

## 2. 交付物与校验

### 校园离线一体包（推荐）

```text
shijieshu-school-offline-20261028.zip    约 250MB
```

包含完整站点、全部数据、3D 分片、vendor、文档，以及：

```text
runtime/node-v22.14.0-linux-x64.tar.gz
runtime/node-v22.14.0-linux-arm64.tar.gz
runtime/node-v22.14.0-win-x64.zip
runtime/SHASUMS256.txt
install-offline.sh
start-windows.cmd
install-windows.ps1
deploy/windows-launcher.mjs
README-FIRST.md
```

解压后执行 `./install-offline.sh` 即可；它会优先使用系统 Node，缺失或低于 18 时自动解压包内 Node。适合“服务器完全空白”的学校环境。

### 完整包（不含 Node）

```text
shijieshu-full.zip
```

包含：站点代码、vendor、所有数据、3D 分片、启动脚本、部署脚本、文档。
**不包含**：`claims.jsonl`、`logs/`、`.git/`、`node_modules/`、原始 LOTUS 数据、Node 运行时。

### 增量/更新包

```text
site-update-3d.zip
```

包含：前端代码、vendor、favicon、pipeline、README、文档。
不包含：`data/molecules3d/`、`claims.jsonl`。适合“服务器已有数据和账本，只更新代码”。

### 仅 3D 数据

```text
molecules3d.zip
```

631 个 `.json.gz` 分片，解压后是 `data/molecules3d/`。

### 校验

```bash
cd 解压目录
sha256sum -c SHA256SUMS.txt
```

如果 `SHA256SUMS.txt` 和 zip 不在同一目录，先进入 zip 所在目录再执行。

**重要**：完整包里的 `claims.jsonl` 永远不会包含领养记录，升级时不要用旧包覆盖服务器上的账本。

---

## 3. 服务器要求

| 项目 | 最低 | 推荐 |
| --- | --- | --- |
| 系统 | Linux x86_64 / arm64 | Debian/Ubuntu/AlmaLinux |
| Node | 18 | 22.14.0 |
| 内存 | 512MB | 1GB |
| 磁盘 | 300MB 空闲 | 1GB |
| CPU | 1 核 | 1–2 核 |
| 浏览器 | 支持 WebGL2 的现代浏览器 | Chrome/Edge/Safari 最新版 |

服务端**不需要 GPU**；世界树在用户浏览器里渲染。

### Alpine / musl 注意

官方 `node-v22.14.0-linux-x64.tar.gz` 是 glibc 构建。Alpine 需要 musl 兼容的 Node（apk 安装或 musl 构建），不能直接把 glibc 版放进 Alpine。

### 权限

- 建议用普通用户运行，不要用 root。
- 运行用户需要对安装目录可读，对 `logs/`、`.run/` 和账本所在目录可写。
- `claims.jsonl` 建议权限 `600`。

### 浏览器

- 需要 WebGL2；老旧集显/无硬件加速浏览器可能卡顿。
- 手机竖屏会提示横屏；横屏使用桌面式布局。

---

## 3.5 学校服务器专用清单（已申请成功）

### 先跑一次体检

在解压后的项目根目录执行：

```bash
sh deploy/preflight.sh > /tmp/eco-preflight.txt 2>&1
cat /tmp/eco-preflight.txt
```

把输出发给技术支持。脚本只读，不安装、不改配置、不读取 claims 内容。

### 需要向学校/信息化中心确认

1. **系统**：Linux 发行版、`x86_64` 还是 `arm64`、是否 Alpine/musl。
2. **运行权限**：是否有 SSH、sudo、systemd 或面板进程管理；能否在用户目录运行自带的 Node。
3. **Node**：学校是否提供 Node 18+；能否使用我们携带的 Node 22.14.0 离线包。
4. **域名与路径**：能否分配独立子域名（推荐 `world.school.edu.cn`）并部署在**根路径**；如果只能给 `/world/` 子路径，需要改前端资源路径。
5. **端口**：公网只开放 80/443，还是允许自定义端口（如 41018）；是否需要 Nginx 反向代理和校园 TLS 证书。
6. **出站网络**：运行时不需要外网；但要确认没有“禁止本地监听端口”的安全策略。
7. **磁盘/内存**：当前完整项目解压约 **312MB**，完整 zip 约 **250MB**（含 Node）或 **114MB**（不含 Node），Node 运行时约 **140MB**；建议至少 **1GB 磁盘、1GB 内存**。
8. **备份**：`claims.jsonl` 是否在备份范围内；如果没有，需要自行加定时备份。
9. **安全策略**：Nginx/WAF 是否会加严格 CSP（可能拦截内联 import map）、是否允许 `.wasm` 和 `application/gzip`；是否会拦截 `/api`。
10. **内容与隐私**：领养功能会公开显示用户填写的名字（最长 20 字），是否需要审核/限流/关闭；校徽与校名使用是否已获允许。
11. **备案/访问范围**：公网访问是否需要 ICP 备案或校内审批；是否只允许校园网访问。

### 推荐部署形态

```text
浏览器
  ↓ HTTPS 443
学校 Nginx / WAF / TLS
  ↓ 127.0.0.1:41018
deploy/site-server.mjs
  ↓ 127.0.0.1:8788
deploy/claim-server.mjs
```

- 公网只开 443；41018/8788 都只在本机。
- 站点必须放在域名根路径，否则 `/vendor/...` 绝对路径会失效。
- 如果学校只给子路径，告诉技术支持，需要改 import map、favicon 和静态资源路径。

### Nginx 关键配置

```nginx
types {
  application/wasm wasm;
}

server {
  listen 443 ssl;
  server_name world.school.edu.cn;

  # 不要把 .json.gz 再套一层 gzip，避免双重压缩
  gzip off;

  location / {
    proxy_pass http://127.0.0.1:41018;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 60s;
  }

  # 可选：给领养接口加限流
  # limit_req zone=claim burst=5 nodelay;
}
```

如果学校要求 CSP，至少允许内联 import map 和本地脚本；否则页面会在加载阶段失败。

### 如果学校只给静态空间

- 世界树、搜索、2D/3D 结构、分享链接可用。
- 领养 API 不可用（需要 Node）。
- 用 Nginx 指向 `/opt/shijieshu`，并确保 `.wasm` MIME 为 `application/wasm`。
- 可把领养入口隐藏或在页面提示“校园版暂未开放领养”。

### 给学校的技术申请说明（可复制）

```text
项目：天然产物世界树（课程/科普展示）
类型：静态 WebGL 前端 + 两个零依赖 Node 服务
运行环境：Linux x86_64/arm64，Node.js >= 18（推荐 22.14.0）
资源：约 1GB 磁盘、512MB–1GB 内存、1 核 CPU；不需要数据库、不需要 GPU
端口：仅需公网 HTTPS 443；内部 Node 监听 127.0.0.1:41018 和 127.0.0.1:8788
网络：运行时不访问外网/CDN；Three.js/RDKit/数据全部随包部署
反向代理：Nginx 将 443 转到 127.0.0.1:41018，站点需部署在域名根路径
MIME：需要 application/wasm 和 application/gzip
备份：需要保留 claims.jsonl（领养记录，JSONL 小文件）
安全：静态服务器已屏蔽 .git/deploy/logs/claims 等敏感路径；领养接口可加限流
内容：LOTUS 数据 CC0；校徽/校名使用已按学校要求申请；页面有“非用药建议”声明
```

---

## 4. 正常部署（服务器已有 Node）

### 4.1 上传与解压

```bash
mkdir -p /opt/shijieshu
unzip /tmp/shijieshu-full.zip -d /opt/shijieshu
cd /opt/shijieshu
chmod +x start.sh
```

如果 zip 内的路径已经带顶层目录，按实际解压结果调整目录。

### 4.2 选择端口

默认公开端口 5173。面板通常注入 `PORT`，也可以显式指定：

```bash
SITE_PORT=41018 ./start.sh
```

优先级：

```text
SITE_PORT > PORT > SERVER_PORT > 5173
```

内部领养端口默认 8788，只绑定 `127.0.0.1`。不要把它暴露到公网。

### 4.3 启动

**面板/Docker（推荐前台）：**

```bash
./start.sh
```

前台进程不会退出，面板不会误判“服务已停止”。

**普通 VPS 后台：**

```bash
./start.sh daemon
./start.sh status
```

停止/重启：

```bash
./start.sh stop
./start.sh restart
```

### 4.4 防火墙

只放行站点端口，例如：

```bash
# ufw
ufw allow 41018/tcp

# firewalld
firewall-cmd --add-port=41018/tcp --permanent
firewall-cmd --reload
```

云服务器还需要在安全组放行同一端口。不要放行 8788。

### 4.5 验证

在服务器上：

```bash
curl -I http://127.0.0.1:41018/
curl http://127.0.0.1:41018/api/claim/health
```

预期：

```text
HTTP/1.1 200 OK
{"ok":true,...}
```

如果服务器没有 `curl`：

```bash
node -e "fetch('http://127.0.0.1:41018/api/claim/health').then(r=>r.text()).then(console.log)"
```

浏览器首屏检查：

1. 加载页能消失，世界树开始生长。
2. 左侧探索栏、右侧详情卡出现。
3. 点击一个分子，详情卡有 2D 结构式。
4. 等 6 秒进入钟表，钟表完整、垂直。
5. 再点分子，待机介绍卡里 3D 球棍模型可拖动。
6. 点“复制链接”显示“已复制”。
7. 点“领养这颗分子”弹窗能打开并提交。

### 4.6 systemd（可选）

```ini
[Unit]
Description=Eco Hotspots World Tree
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/shijieshu
Environment=PATH=/opt/node-v22.14.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin
Environment=SITE_PORT=41018
Environment=CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl
ExecStart=/opt/shijieshu/start.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now eco-hotspots
systemctl status eco-hotspots
```

`start.sh` 前台会启动子进程并保持存活；systemd 停止时会触发脚本的清理逻辑。不要把 systemd 和 `./start.sh daemon` 混用。

### 4.7 Nginx / 域名 / HTTPS（可选）

只代理到站点端口，保留 `/api` 同源：

```nginx
server {
  listen 443 ssl;
  server_name example.com;

  location / {
    proxy_pass http://127.0.0.1:41018;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

注意：当前 `index.html` 的 import map 使用绝对路径 `/vendor/three/...`，**站点必须部署在域名根路径**。如果必须部署在 `/world/` 子路径，需要同时改 import map、favicon 和资源路径，否则加载页会卡住。

使用 HTTPS 还能让浏览器 Clipboard API 直接可用；HTTP 下代码已有降级复制。

---

## 5. 完全空白服务器的离线部署

这一节假设服务器：**没有 Node、没有 git、没有 Python、没有 npm、没有外网**，但有 SSH 和文件传输能力。

推荐直接使用 `shijieshu-school-offline-20261028.zip`；它已经包含 Node x64/arm64、完整体检脚本和 `README-FIRST.md`。解压后：

```bash
cd /opt/shijieshu
chmod +x install-offline.sh start.sh deploy/preflight.sh
./install-offline.sh
```

以下步骤是手动等价流程，用于一体包不可用或需要自定义路径时。

### 5.1 在另一台电脑准备文件

准备两样东西：

1. `shijieshu-full.zip`（或不含 Node 的站点）
2. 与服务器架构匹配的 Node 离线包，例如：

```text
node-v22.14.0-linux-x64.tar.gz      # x86_64 glibc
node-v22.14.0-linux-arm64.tar.gz    # ARM64 glibc
```

Alpine/musl 请准备 musl 兼容的 Node，或使用对应 apk 离线包。

如果服务器没有 `unzip`/`tar`，可以：

- 在准备的电脑上解压好，直接上传**目录**；
- 或在服务器文件管理器中解压；
- 或准备一个静态 `busybox`/`unzip` 单文件工具。

### 5.2 上传

```bash
scp shijieshu-full.zip user@服务器:/tmp/
scp node-v22.14.0-linux-x64.tar.gz user@服务器:/tmp/
```

也可以用面板文件管理器、SFTP、U 盘等。

### 5.3 确认架构

```bash
uname -m
```

- `x86_64` → 用 `linux-x64`
- `aarch64` / `arm64` → 用 `linux-arm64`

Alpine 还要确认是 musl：

```bash
ldd --version 2>&1 | head -1
```

### 5.4 安装 Node（不需要 root 时改到家目录）

```bash
mkdir -p /opt/node
tar -xzf /tmp/node-v22.14.0-linux-x64.tar.gz -C /opt/node --strip-components=1
export PATH=/opt/node/bin:$PATH
node -v
```

写入长期 PATH：

```bash
echo 'export PATH=/opt/node/bin:$PATH' >/etc/profile.d/node.sh
chmod +x /etc/profile.d/node.sh
```

没有 root 时：

```bash
mkdir -p ~/node
tar -xzf /tmp/node-v22.14.0-linux-x64.tar.gz -C ~/node --strip-components=1
export PATH=$HOME/node/bin:$PATH
```

没有 `tar`：在另一台电脑解压好，把整个 `node-v22.14.0-linux-x64/` 目录上传到服务器。

### 5.5 解压站点

有 `unzip`：

```bash
mkdir -p /opt/shijieshu
unzip /tmp/shijieshu-full.zip -d /opt/shijieshu
```

没有 `unzip` 的替代方案：

```bash
busybox unzip /tmp/shijieshu-full.zip -d /opt/shijieshu
# 或
bsdtar -xf /tmp/shijieshu-full.zip -C /opt/shijieshu
# 或
python3 -m zipfile -e /tmp/shijieshu-full.zip /opt/shijieshu
```

如果这些都没有：在另一台电脑解压，直接上传解压后的目录。运行站点本身不需要 `unzip`。

### 5.6 准备领养账本目录

```bash
mkdir -p /var/lib/eco-hotspots
chmod 700 /var/lib/eco-hotspots
```

如果是普通用户，改为自己有权限的目录，例如 `~/eco-claims`。

### 5.7 启动

```bash
cd /opt/shijieshu
chmod +x start.sh
SITE_PORT=41018 \
CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl \
./start.sh
```

如果没有 Bash，或者 `start.sh` 因环境缺失不能运行，手动启动两个 Node 服务：

```bash
cd /opt/shijieshu
mkdir -p logs .run

HOST=127.0.0.1 \
PORT=8788 \
CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl \
node deploy/claim-server.mjs >>logs/claim.log 2>&1 &

HOST=0.0.0.0 \
SITE_PORT=41018 \
CLAIM_PROXY=http://127.0.0.1:8788 \
node deploy/site-server.mjs >>logs/site.log 2>&1 &
```

没有 `nohup` 时，用 `setsid`、`tmux`、`screen` 或面板的前台进程；不要在没有保持进程的情况下关掉 SSH。

### 5.8 验证

```bash
node -e "fetch('http://127.0.0.1:41018/api/claim/health').then(r=>r.text()).then(console.log)"
```

浏览器访问：

```text
http://服务器IP:41018/
```

防火墙/安全组放行 41018。没有 root 时可能无法改防火墙，使用面板安全组或已有反向代理。

### 5.9 没有任何可运行环境怎么办？

必须至少满足以下之一：

1. 能上传并运行 Node（完整功能）；
2. 已有任意静态 Web 服务器（Nginx/Apache/Python 等），可以只提供静态页面：
   - 世界树、2D/3D 结构、搜索和分享可用；
   - **领养 API 不可用**（需要 Node 服务）；
3. 有容器/面板可以运行 Node 镜像。

如果既没有任何运行时，也没有任何静态 Web 服务器、也不能传输文件，那么无法运行这个项目——这是物理限制，不是启动脚本能解决的。

静态-only 临时方案：

```bash
cd /opt/shijieshu
python3 -m http.server 41018 --bind 0.0.0.0
```

或使用 Nginx 指向 `/opt/shijieshu`。此时 `/api` 会 404，领养按钮会显示服务不可用；其他功能正常。

如果 2D 结构式不显示，检查 `.wasm` 的 MIME 是否为 `application/wasm`。有些 `python3 -m http.server` 版本会返回 `application/octet-stream`，建议改用 Nginx 或 `deploy/site-server.mjs`。

---

### 5.10 Windows 服务器

一体包同时带了 `node-v22.14.0-win-x64.zip`，并提供了不依赖 bash 的启动器：

```text
start-windows.cmd
install-windows.ps1
deploy/windows-launcher.mjs
```

首次准备（在解压后的目录打开 PowerShell）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1
```

它会优先使用系统 Node 18+；没有或版本太低时，解压包内 Node 到 `.runtime\node`，然后启动两个服务。

也可以直接运行：

```bat
start-windows.cmd
```

指定端口：

```bat
set SITE_PORT=41018
start-windows.cmd
```

状态/停止：

```bat
start-windows.cmd status
start-windows.cmd stop
```

Windows 防火墙（管理员）：

```powershell
New-NetFirewallRule -DisplayName "Eco Hotspots 41018" -Direction Inbound -Protocol TCP -LocalPort 41018 -Action Allow
```

开机自启：用任务计划程序运行 `start-windows.cmd`，或用 NSSM 注册服务。不要使用 `start.sh`。

注意：

- 包内是 win-x64；Windows ARM64 需要另外准备 Node。
- `start-windows.cmd` 是前台进程，关窗口/Ctrl+C 会停止。
- 日志在 `logs\site.log`、`logs\claim.log`，PID 在 `.run\`。
- 账本仍建议用 `CLAIM_FILE` 指向独立可备份目录。

---

## 6. 端口、环境变量与网络

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SITE_PORT` | `PORT` / `SERVER_PORT` / `5173` | 对外站点端口，优先级最高 |
| `PORT` | 未设置 | 面板常注入；被 `SITE_PORT` 覆盖 |
| `BIND_HOST` | `0.0.0.0` | 站点绑定地址；反向代理时可改 `127.0.0.1` |
| `CLAIM_PORT` | `8788` | 内部领养服务端口 |
| `CLAIM_HOST` | `127.0.0.1` | 领养服务绑定地址 |
| `CLAIM_FILE` | `./claims.jsonl` | 领养账本路径 |
| `ALLOW_ORIGIN` | `*` | 领养服务 CORS |

只暴露站点端口。若 Nginx 反代：

```bash
BIND_HOST=127.0.0.1 SITE_PORT=41018 ./start.sh
```

然后 Nginx 代理到 `127.0.0.1:41018`，公网只开 443。

---

## 7. 账本、备份与迁移

### 7.1 唯一需要长期保存的文件

```text
claims.jsonl
```

它记录：分子 key、公开显示名、时间、visitor token 的 SHA-256。没有 IP/UA/邮箱。

### 7.2 推荐布局（升级不丢账本）

```text
/opt/shijieshu/                 # 当前版本代码和数据
/opt/shijieshu-previous/        # 上一个版本
/var/lib/eco-hotspots/claims.jsonl   # 独立账本，升级时不动
/var/backups/eco-hotspots/      # 备份
```

启动时固定：

```bash
CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl SITE_PORT=41018 ./start.sh
```

### 7.3 备份

```bash
mkdir -p /var/backups/eco-hotspots
cp -a /var/lib/eco-hotspots/claims.jsonl \
  /var/backups/eco-hotspots/claims-$(date +%F-%H%M).jsonl
chmod 600 /var/backups/eco-hotspots/*.jsonl
```

建议每天定时备份，或每次更新前备份。

### 7.4 恢复

```bash
./start.sh stop
cp -a /var/backups/eco-hotspots/claims-YYYY-MM-DD-HHMM.jsonl \
  /var/lib/eco-hotspots/claims.jsonl
chown 运行用户:运行用户 /var/lib/eco-hotspots/claims.jsonl
chmod 600 /var/lib/eco-hotspots/claims.jsonl
./start.sh
```

**单进程写入**：同一份 `claims.jsonl` 只能有一个领养服务在写；不要同时启动两个实例。

### 7.5 迁移到新服务器

1. 旧服务器执行 `./start.sh stop`。
2. 备份 `claims.jsonl`。
3. 新服务器按第 5 节部署。
4. 把 `claims.jsonl` 放到新服务器的 `CLAIM_FILE` 路径，权限 600。
5. 启动并验证。
6. 切换 DNS/安全组。

---

## 8. 更新与回滚

### 8.1 更新前

```bash
./start.sh stop
cp -a /var/lib/eco-hotspots/claims.jsonl /var/backups/eco-hotspots/claims-before-update.jsonl
mv /opt/shijieshu /opt/shijieshu-previous
mkdir -p /opt/shijieshu
unzip shijieshu-full.zip -d /opt/shijieshu
```

或使用增量包：

```bash
unzip site-update-3d.zip -d /opt/shijieshu
```

增量包不包含 `data/molecules3d/`；若服务器已有则保留，若新装请用完整包或额外解压 `molecules3d.zip`。

### 8.2 启动并验证

```bash
cd /opt/shijieshu
chmod +x start.sh
CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl SITE_PORT=41018 ./start.sh
curl http://127.0.0.1:41018/api/claim/health
```

浏览器强刷（Ctrl+F5 / Cmd+Shift+R）。

### 8.3 回滚

```bash
./start.sh stop
mv /opt/shijieshu /opt/shijieshu-broken
mv /opt/shijieshu-previous /opt/shijieshu
cd /opt/shijieshu
CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl SITE_PORT=41018 ./start.sh
```

账本在独立目录，不需要回滚；仍然保留更新后的领养记录。

---

## 9. 故障排查

### 9.1 快速判断

| 症状 | 先查什么 |
| --- | --- |
| 页面打不开 | 端口、防火墙、进程、`curl` |
| 加载页卡住 | 浏览器 Console、`vendor/three`、`index.html` import map |
| 白屏/JS 报错 | 是否漏传 `src/`、`vendor/`；是否旧缓存 |
| 2D 结构不显示 | `vendor/rdkit/`、WASM MIME、Console |
| 3D 不显示 | `data/molecules3d/` 分片；缺失时应该回退 2D |
| 领养不可用 | 8788、`/api` 代理、`logs/claim.log`、facets |
| 复制按钮失败 | 是否 HTTPS/localhost；更新 `DetailPanel.js`；HTTP 有降级 |
| 服务反复停止 | 面板是否用前台；Node 是否存在；日志 |
| 磁盘满 | `du -sh logs claims.jsonl data` |

### 9.2 常用命令

```bash
cd /opt/shijieshu

# 进程/端口
./start.sh status
ss -ltnp | grep -E '41018|8788'
ps aux | grep -E 'site-server|claim-server' | grep -v grep

# 健康
curl -I http://127.0.0.1:41018/
curl http://127.0.0.1:41018/api/claim/health

# 日志
tail -n 80 logs/site.log
tail -n 80 logs/claim.log

# 关键文件
ls -l index.html start.sh
ls vendor/three/three.module.js
ls vendor/three/addons/controls/OrbitControls.js
ls vendor/rdkit/RDKit_minimal.wasm
find data/molecules3d -name '*.json.gz' | wc -l
```

预期 3D 分片数量（完整包）：**631**。

### 9.3 常见问题

#### 启动时报 `mise ERROR No version is set for shim: node`

服务器有 mise 但没设置默认 Node。两种修复：

```bash
mise use -g node@22.14.0
```

或直接使用离线 Node：

```bash
export PATH=/opt/node/bin:$PATH
./start.sh
```

`start.sh` 会优先使用 PATH 中可用的 Node，不强制 mise。

#### `./start.sh: /usr/bin/env bash: bad interpreter`

`start.sh` 被 CRLF 换行破坏：

```bash
sed -i 's/\r$//' start.sh
chmod +x start.sh
```

如果系统没有 bash：按 5.7 手动启动两个 Node 服务。

#### 面板显示“服务器已停止”

- 面板必须用**前台** `./start.sh`，不要用 `./start.sh daemon`。
- 查看面板日志/`logs/site.log`。
- 确认 Node 路径在面板环境中可见。
- 确认端口没有被面板自身占用。

#### 端口被占用

```bash
ss -ltnp | grep 41018
ss -ltnp | grep 8788
```

换端口：

```bash
SITE_PORT=41019 CLAIM_PORT=8789 ./start.sh
```

或停止旧进程。

#### 加载页一直卡住

最常见原因：Three.js 仍然从 CDN 加载，或 `vendor/three` 没上传。

```bash
grep -n "vendor/three" index.html
ls vendor/three/three.module.js
ls vendor/three/addons/controls/OrbitControls.js
```

浏览器 Network 里不应该再出现 `unpkg.com`。如果看到，说明上传的是旧 `index.html`。

#### 3D 模型不显示，但 2D 结构正常

这是正常的回退：

```bash
ls data/molecules3d/AA.json.gz
curl -I http://127.0.0.1:41018/data/molecules3d/AA.json.gz
```

完整包应有 631 个分片；没有对应分片时，前端会显示 2D SVG，不是故障。

#### 领养不可用

```bash
curl http://127.0.0.1:41018/api/claim/health
tail -n 80 logs/claim.log
ss -ltnp | grep 8788
```

常见原因：领养服务没启动、8788 被占用、`facets.json.gz` 缺失、代理地址错误。

#### 复制链接显示复制失败

- 旧版在 HTTP 下直接调用 Clipboard API 会失败；新版已用临时 textarea 降级。
- 确认已上传最新 `src/ui/DetailPanel.js`。
- 使用 HTTPS 可以完全避免；HTTP 下新版应显示“已复制”。

#### 领养账本损坏/丢失

- JSONL 是逐行追加；停止服务后可从备份恢复。
- 没有备份就无法恢复历史领养；没有数据库可以找回。
- 不要多实例同时写同一个 JSONL。

#### 中文乱码/文件缺失

- 完整包上传不完整：重新上传并用 `sha256sum -c SHA256SUMS.txt` 校验。
- `data/molecules`、`data/molecules3d` 是二进制分片，不要用会改换行的文本编辑器处理。

#### 大屏 UI 太大/太小

大屏 UI 使用 `--ui-scale` 自动缩放（1–2 倍）；小屏走响应式。强制刷新；若浏览器不支持 CSS zoom，会退化为原始固定尺寸。

---

## 10. 灾难恢复场景

### 场景 A：服务器完全空白（无 Node、无解压工具、无外网）

按第 5 节执行：

1. 另一台电脑准备完整包 + Node tar.gz。
2. 上传。
3. 解压 Node/站点；没有解压工具就上传已解压目录。
4. `export PATH=...`。
5. 手动或 `start.sh` 启动。
6. 放行端口。
7. 验证 `/api/claim/health`。

关键点：**不需要 npm install、不需要外网、不需要数据库**。

### 场景 B：Node 被删除/升级坏了

```bash
export PATH=/opt/node/bin:$PATH
node -v
./start.sh
```

如果 `/opt/node` 也没了，重新上传 Node tar.gz，或使用系统包管理器（离线包）。

### 场景 C：服务器没有任何运行时，但有一个静态 Web 服务器

用 Nginx/Apache/Python 提供 `/opt/shijieshu` 静态目录。
世界树和结构式可用；领养接口不可用。
这是降级方案，不是完整功能。

### 场景 D：磁盘损坏/迁移到新机器

1. 新机器部署完整包。
2. 恢复 `claims.jsonl` 备份。
3. 校验数据和端口。
4. 切换 DNS/安全组。
5. 旧机器保留 24 小时再下线。

### 场景 E：误覆盖了 claims.jsonl

立即停止服务，从最近备份恢复：

```bash
./start.sh stop
cp -a 备份文件 claims.jsonl
./start.sh
```

如果没有备份，无法恢复；告知用户领养记录丢失。

### 场景 F：新版本坏了

按第 8.3 回滚到 `/opt/shijieshu-previous`。账本不动。

### 场景 G：面板/容器重启后服务没起来

- 面板应配置前台启动，并设置重启策略。
- systemd 用 `Restart=always`。
- Docker 用 `restart: unless-stopped`（若使用容器）。
- 检查 Node 路径、工作目录、端口。

### 场景 H：只暴露一个端口但反向代理不工作

先绕过代理直连站点端口：

```bash
curl -I http://127.0.0.1:41018/
```

如果直连正常，问题在 Nginx/安全组/域名，不在应用。

---

## 11. 安全与运维

- 只公开站点端口；8788 只绑定本机。
- 运行用户最小权限；`claims.jsonl` 600。
- 建议 HTTPS；HTTP 下复制功能已有降级。
- 静态服务器已屏蔽 `.git`、`.run`、`logs`、`deploy`、`pipeline`、`data/raw`、`claims.jsonl`。
- `ALLOW_ORIGIN` 默认 `*`；若只用同源，可改成具体域名。
- 不在仓库/文档中放服务器密码、SSH 私钥；交接时单独保管。
- 定期备份账本；定期更新 Node。
- 数据来源 LOTUS frozen 260413（CC0）；仅作科学传播，不构成用药建议。

---

## 12. 可选：重建 3D 数据

运行站点不需要 Python。只有在缺失/需要更新 3D 数据时：

- 需要 Python 3.10+ 和 RDKit
- 输入：`data/molecules/*.json.gz` 中的 LOTUS SMILES
- 输出：`data/molecules3d/*.json.gz`

```bash
python pipeline/build-molecule-3d.py --workers 12
# 小范围试跑
python pipeline/build-molecule-3d.py --prefixes AA,AB --limit 200 --workers 2
# 续跑
python pipeline/build-molecule-3d.py --workers 12 --skip-existing
```

当前全量：227,301 条 LOTUS key，其中 202,665 条有 3D，数据约 60MB。缺失/失败的分子自动回退 2D。

---

## 13. 交接清单

请交接人逐项确认：

```text
[ ] 服务器 IP / SSH 端口 / 登录方式（密码或密钥单独保管，不写进仓库）
[ ] 公开访问地址 / 域名 / 端口
[ ] 安装目录（例如 /opt/shijieshu）
[ ] Node 路径和版本（例如 /opt/node/bin/node, v22.14.0）
[ ] 启动方式（面板前台 / systemd / daemon）
[ ] 站点端口（SITE_PORT）和内部领养端口（CLAIM_PORT）
[ ] CLAIM_FILE 实际路径
[ ] claims.jsonl 最近备份位置
[ ] 防火墙/安全组已放行的端口
[ ] 3D 分片数量（完整包应为 631）
[ ] 最近一次发布包 SHA-256
[ ] 最近一次验收时间
[ ] 已知问题/待办
```

验收命令：

```bash
cd /opt/shijieshu
./start.sh status
curl -I http://127.0.0.1:41018/
curl http://127.0.0.1:41018/api/claim/health
find data/molecules3d -name '*.json.gz' | wc -l
sha256sum -c SHA256SUMS.txt
```

---

## 14. 命令备忘

```bash
# 启动 / 停止 / 状态
./start.sh
./start.sh daemon
./start.sh stop
./start.sh restart
./start.sh status

# 换端口
SITE_PORT=41018 CLAIM_PORT=8788 ./start.sh

# 手动启动（无 bash/start.sh 时）
node deploy/claim-server.mjs
node deploy/site-server.mjs

# 健康
curl -I http://127.0.0.1:41018/
curl http://127.0.0.1:41018/api/claim/health

# 日志
tail -f logs/site.log
tail -f logs/claim.log

# 账本备份
cp -a claims.jsonl claims-$(date +%F-%H%M).jsonl

# 查端口
ss -ltnp | grep -E '41018|8788'

# 校验发布包
sha256sum -c SHA256SUMS.txt
```
