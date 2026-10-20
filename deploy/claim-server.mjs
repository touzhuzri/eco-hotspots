// 分子领养服务 — 零依赖 Node HTTP + JSONL。
//
// 规则：
//   - 每个 InChIKey 只能被领养一次
//   - 同一访客可以领养多颗
//   - 留名可选；留空显示“神秘用户”
//   - 领养人可在本机（同一 visitor token）改名
//   - 领养信息只在对应分子卡中公开，没有排行榜/领养墙
//
// 隐私：
//   - 只存 molecule key、公开显示名、时间、visitor token 的 SHA-256
//   - 不存 IP / UA / 邮箱
//
// 端点：
//   GET   /api/claim?key=<InChIKey>&visitor=<token>
//   POST  /api/claim       { key, name, visitor }
//   PATCH /api/claim       { key, name, visitor }   —— 仅领养人可改名
//   GET   /api/claim/health
//
// 运行：
//   node deploy/claim-server.mjs
//   PORT=8788 HOST=0.0.0.0 CLAIM_FILE=./claims.jsonl node deploy/claim-server.mjs
//
// 生产建议：由 nginx 把 /api/claim 反代到该服务；或直接把前端
// window.ECO_CLAIM_ENDPOINT 指向服务地址。

import { createServer } from "node:http";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";
const FILE = process.env.CLAIM_FILE || "./claims.jsonl";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const NAME_MAX = 20;
const MAX_BODY = 4096;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FACETS = join(ROOT, "data", "molecules", "facets.json.gz");

// ── LOTUS 合法 key 集合（防止伪造任意 key） ──
let validKeys = null;
try {
  const facets = JSON.parse(gunzipSync(readFileSync(FACETS)).toString("utf8"));
  validKeys = new Set(Object.keys(facets.map || {}));
  console.log(`[claim] loaded ${validKeys.size} LOTUS keys`);
} catch (err) {
  console.warn(
    "[claim] facets.json.gz not found; falling back to InChIKey shape check"
  );
}
const KEY_RE = /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/;

// ── 内存表 + JSONL 事件 ──
/** @type {Map<string, {key:string,name:string,ts:number,ownerHash:string}>} */
const claims = new Map();

function hashVisitor(visitor) {
  return createHash("sha256").update(String(visitor)).digest("hex");
}

function cleanName(raw) {
  return Array.from(String(raw ?? ""))
    .filter((ch) => {
      const c = ch.codePointAt(0);
      return (
        c >= 32 &&
        c !== 127 &&
        c !== 0x2028 &&
        c !== 0x2029 &&
        !(c >= 0x200b && c <= 0x200f) &&
        !(c >= 0x202a && c <= 0x202e)
      );
    })
    .join("")
    .trim()
    .slice(0, NAME_MAX);
}

function loadClaims() {
  if (!existsSync(FILE)) return;
  const text = readFileSync(FILE, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || !row.key || !row.ownerHash || !KEY_RE.test(row.key)) continue;
    if (row.op === "rename") {
      const cur = claims.get(row.key);
      if (cur && cur.ownerHash === row.ownerHash) {
        cur.name = cleanName(row.name);
        cur.ts = Number(row.ts) || cur.ts;
      }
      continue;
    }
    if (!claims.has(row.key)) {
      claims.set(row.key, {
        key: row.key,
        name: cleanName(row.name),
        ts: Number(row.ts) || Date.now(),
        ownerHash: String(row.ownerHash),
      });
    }
  }
  console.log(`[claim] recovered ${claims.size} claims`);
}

function appendEvent(event) {
  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, `${JSON.stringify(event)}\n`, "utf8");
}

loadClaims();

// ── 简单按 IP 限流（只在内存，不落地） ──
const WINDOW = 10 * 60_000;
const LIMIT = 120; // GET + POST + PATCH per window
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  if (arr.length >= LIMIT) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (now - v[v.length - 1] >= WINDOW) hits.delete(k);
    }
  }
  return false;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function json(res, code, body) {
  cors(res);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function validateKey(key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) return false;
  if (validKeys && !validKeys.has(key)) return false;
  return true;
}

function validateVisitor(visitor) {
  return typeof visitor === "string" && visitor.length >= 8 && visitor.length <= 128;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const ip = req.socket.remoteAddress || "unknown";

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/api/claim/health" && req.method === "GET") {
    return json(res, 200, { ok: true, claims: claims.size });
  }

  if (url.pathname !== "/api/claim") {
    return json(res, 404, { error: "not found" });
  }

  if (rateLimited(ip)) return json(res, 429, { error: "too many requests" });

  // 查询领养状态
  if (req.method === "GET") {
    const key = url.searchParams.get("key") || "";
    const visitor = url.searchParams.get("visitor") || "";
    if (!validateKey(key)) return json(res, 400, { error: "invalid key" });
    const rec = claims.get(key);
    if (!rec) return json(res, 200, { claimed: false });
    return json(res, 200, {
      claimed: true,
      name: rec.name,
      ts: rec.ts,
      mine:
        validateVisitor(visitor) && hashVisitor(visitor) === rec.ownerHash,
    });
  }

  // 领养
  if (req.method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "invalid body" });
    const { key, visitor } = body;
    if (!validateKey(key)) return json(res, 400, { error: "invalid key" });
    if (!validateVisitor(visitor))
      return json(res, 400, { error: "invalid visitor" });

    const ownerHash = hashVisitor(visitor);
    const existing = claims.get(key);
    if (existing) {
      return json(res, 409, {
        claimed: true,
        name: existing.name,
        ts: existing.ts,
        mine: existing.ownerHash === ownerHash,
        error: "already claimed",
      });
    }

    const rec = {
      key,
      name: cleanName(body.name),
      ts: Date.now(),
      ownerHash,
    };
    // 单进程内 check+set 是原子的
    claims.set(key, rec);
    appendEvent({ op: "claim", ...rec });
    return json(res, 200, {
      claimed: true,
      name: rec.name,
      ts: rec.ts,
      mine: true,
    });
  }

  // 改名（仅领养人）
  if (req.method === "PATCH") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "invalid body" });
    const { key, visitor } = body;
    if (!validateKey(key)) return json(res, 400, { error: "invalid key" });
    if (!validateVisitor(visitor))
      return json(res, 400, { error: "invalid visitor" });
    const rec = claims.get(key);
    if (!rec) return json(res, 404, { error: "not claimed" });
    if (rec.ownerHash !== hashVisitor(visitor)) {
      return json(res, 403, { error: "not owner" });
    }
    rec.name = cleanName(body.name);
    rec.ts = Date.now();
    appendEvent({
      op: "rename",
      key,
      name: rec.name,
      ts: rec.ts,
      ownerHash: rec.ownerHash,
    });
    return json(res, 200, {
      claimed: true,
      name: rec.name,
      ts: rec.ts,
      mine: true,
    });
  }

  return json(res, 405, { error: "method not allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`[claim] listening http://${HOST}:${PORT}`);
});
