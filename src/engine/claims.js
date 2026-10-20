/**
 * 分子领养客户端。
 *
 * 规则（与服务端一致）：
 * - 一个 InChIKey 只能被领养一次
 * - 同一访客可以领养多颗
 * - 名字可留空 → 前端显示「神秘用户」
 * - 同一 visitor token 可以改名
 *
 * 服务端默认运行在 :8788；生产环境可设置 window.ECO_CLAIM_ENDPOINT
 * 指向同源 /api 或独立服务地址。
 */

const VISITOR_KEY = "eco-visitor-v1";
// 本机开发：静态站 5173 + 领养服务 8788 分开跑。
// 服务器部署：站点同源 /api 反向代理到 8788，只需暴露一个端口。
const isLocalDev =
  ["localhost", "127.0.0.1"].includes(location.hostname) &&
  location.port === "5173";
const BASE =
  window.ECO_CLAIM_ENDPOINT ||
  (isLocalDev ? `http://${location.hostname}:8788/api` : "/api");

let memoryVisitor = null;

function randomToken() {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (_) {
    return `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export function getVisitorToken() {
  try {
    let token = localStorage.getItem(VISITOR_KEY);
    if (!token) {
      token = randomToken();
      localStorage.setItem(VISITOR_KEY, token);
    }
    return token;
  } catch (_) {
    if (!memoryVisitor) memoryVisitor = randomToken();
    return memoryVisitor;
  }
}

async function request(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      cache: "no-store",
      ...options,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok && !data) return { error: `HTTP ${res.status}` };
    return data || { error: `HTTP ${res.status}` };
  } catch (err) {
    return { error: "network", message: String(err?.message || err) };
  }
}

/** @returns {Promise<{claimed:boolean,name?:string,ts?:number,mine?:boolean,error?:string}>} */
export async function getClaimStatus(key) {
  if (!key) return { claimed: false };
  const visitor = getVisitorToken();
  return request(
    `/claim?key=${encodeURIComponent(key)}&visitor=${encodeURIComponent(
      visitor
    )}`
  );
}

export async function claimMolecule(key, name) {
  const visitor = getVisitorToken();
  return request("/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, name, visitor }),
  });
}

export async function renameClaim(key, name) {
  const visitor = getVisitorToken();
  return request("/claim", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, name, visitor }),
  });
}

export function claimDisplayName(name) {
  return String(name || "").trim() || "神秘用户";
}
