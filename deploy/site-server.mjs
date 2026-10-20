// 零依赖静态站点服务（生产用的简化版）。
//
// 用法：
//   SITE_PORT=5173 HOST=0.0.0.0 node deploy/site-server.mjs
//
// 只负责静态文件；领养 API 由 deploy/claim-server.mjs 单独提供。
// 前端在 5173 端口下会自动把领养请求发到 http://<host>:8788/api。

import { createReadStream, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SITE_PORT || process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const CLAIM_PROXY =
  process.env.CLAIM_PROXY || "http://127.0.0.1:8788";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".json.gz": "application/gzip",
  ".gz": "application/gzip",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

// 不要把部署脚本、数据管线、日志、领养账本暴露到公网
const BLOCKED = [
  ".git",
  ".run",
  "logs",
  "node_modules",
  "deploy",
  "pipeline",
  "scratch",
  "data/raw",
  "claims.jsonl",
];

function blocked(rel) {
  if (rel.startsWith(".")) return true;
  return BLOCKED.some(
    (p) => rel === p || rel.startsWith(`${p}/`) || rel.startsWith(`${p}${sep}`)
  );
}

function send(res, code, text) {
  res.writeHead(code, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

/** 同源 /api → 内部领养服务；这样部署时只需要暴露一个端口 */
function proxyApi(req, res, urlObj) {
  let target;
  try {
    target = new URL(CLAIM_PROXY);
  } catch (_) {
    return send(res, 502, "Bad Gateway");
  }
  const headers = { ...req.headers, host: target.host };
  const preq = httpRequest(
    {
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: urlObj.pathname + urlObj.search,
      headers,
    },
    (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    }
  );
  preq.on("error", () => {
    if (!res.headersSent) send(res, 502, "Claim Service Unavailable");
    else res.destroy();
  });
  req.pipe(preq);
}

const server = createServer((req, res) => {
  let urlObj;
  try {
    urlObj = new URL(req.url || "/", "http://localhost");
  } catch (_) {
    return send(res, 400, "Bad Request");
  }

  if (urlObj.pathname === "/api" || urlObj.pathname.startsWith("/api/")) {
    return proxyApi(req, res, urlObj);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return send(res, 405, "Method Not Allowed");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(urlObj.pathname);
  } catch (_) {
    return send(res, 400, "Bad Request");
  }

  let rel = normalize(pathname)
    .replace(/^([/\\])+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  if (!rel) rel = "index.html";

  if (blocked(rel)) return send(res, 404, "Not Found");

  let file = join(ROOT, rel);
  const rootPrefix = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
  if (!file.startsWith(rootPrefix)) return send(res, 403, "Forbidden");

  try {
    let st = statSync(file);
    if (st.isDirectory()) {
      file = join(file, "index.html");
      st = statSync(file);
    }
    if (!st.isFile()) return send(res, 404, "Not Found");

    const ext = extname(file).toLowerCase();
    const gzJson = file.endsWith(".json.gz");
    const type = gzJson
      ? MIME[".json.gz"]
      : MIME[ext] || "application/octet-stream";
    const noCache =
      /\.(html?|css|m?js)$/i.test(file) || file.endsWith(`${sep}index.html`);

    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Cache-Control": noCache
        ? "no-store, no-cache, must-revalidate, max-age=0"
        : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on("error", () => {
      if (!res.headersSent) send(res, 500, "Read Error");
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    if (err && err.code === "ENOENT") return send(res, 404, "Not Found");
    return send(res, 500, "Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[site] serving ${ROOT}`);
  console.log(`[site] listening http://${HOST}:${PORT}`);
  console.log(`[site] /api -> ${CLAIM_PROXY}`);
});

function shutdown(sig) {
  console.log(`[site] ${sig}, closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
