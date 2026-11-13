#!/usr/bin/env node
/**
 * AI 服务端到端测试（不调用真实模型）。
 *
 *   npm run test:e2e
 *
 * 覆盖：工具调用、研究计划/反思、多模态结构化与自动核验、表格分析、
 * 资料-LOTUS 核对、服务端会话、配置锁、限流、并发、客户端中止。
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

async function waitHealth(url, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (_) {}
    await delay(300);
  }
  throw new Error(`timeout: ${url}`);
}

async function readEvents(res) {
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          events.push(JSON.parse(data));
        } catch (_) {}
      }
    }
  }
  return events;
}

async function chat(base, body, { signal } = {}) {
  const res = await fetch(`${base}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ai-session": "e2e-session-0123456789" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  return { status: 200, events: await readEvents(res) };
}

const temp = await mkdtemp(join(tmpdir(), "wt-e2e-"));
const [mockPort, aiPort] = await Promise.all([freePort(), freePort()]);

const mock = spawn(process.execPath, [join(HERE, "mock-ai-server.mjs")], {
  env: { ...process.env, MOCK_PORT: String(mockPort) },
  stdio: ["ignore", "pipe", "pipe"],
});
mock.stdout.on("data", (d) => process.stdout.write(`[mock] ${d}`));
mock.stderr.on("data", (d) => process.stderr.write(`[mock:err] ${d}`));

const ai = spawn(process.execPath, [join(ROOT, "ai", "server.mjs")], {
  cwd: ROOT,
  env: {
    ...process.env,
    AI_PORT: String(aiPort),
    AI_HOST: "127.0.0.1",
    AI_PROVIDER: "custom",
    AI_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    AI_MODEL: "mock-chat",
    AI_API_KEY: "mock-key",
    AI_VISION_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    AI_VISION_MODEL: "mock-vision",
    AI_VISION_API_KEY: "mock-key",
    AI_EMBED_BASE_URL: "",
    AI_EMBED_MODEL: "",
    AI_EMBED_API_KEY: "",
    AI_THINKING: "0",
    AI_CONFIG_FILE: join(temp, "config.json"),
    AI_SESSION_FILE: join(temp, "sessions.json"),
    AI_ADMIN_TOKEN: "e2e-token",
    AI_RATE_LIMIT_CHAT: "50",
    AI_RATE_LIMIT_WRITE: "3",
    AI_RATE_LIMIT_READ: "500",
    AI_MAX_CONCURRENT_CHATS: "2",
    AI_MAX_CONCURRENT_PER_IP: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
ai.stdout.on("data", (d) => process.stdout.write(`[ai] ${d}`));
ai.stderr.on("data", (d) => process.stderr.write(`[ai:err] ${d}`));

const base = `http://127.0.0.1:${aiPort}`;
const mockBase = `http://127.0.0.1:${mockPort}`;
let exitCode = 0;

try {
  await waitHealth(`${mockBase}/stats`);
  const health = await waitHealth(`${base}/api/ai/health`);
  check("health", health.ok === true && health.hasKey === true);
  check("vision ready", health.visionReady === true, health.vision);

  const r1 = await chat(base, {
    messages: [{ role: "user", content: "哪个科的黄酮最多？" }],
  });
  check("chat tool", r1.events?.some((e) => e.type === "tool"));
  check("chat done", r1.events?.some((e) => e.type === "done"));

  const r2 = await chat(base, {
    mode: "research",
    messages: [{ role: "user", content: "核实黄酮的科属分布" }],
  });
  check("research plan", r2.events?.some((e) => e.type === "plan"));
  check("research reflection", r2.events?.some((e) => e.type === "reflection"));

  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const r3 = await chat(base, {
    messages: [{ role: "user", content: "这是什么？查 LOTUS 并说明不确定性。" }],
    images: [{ name: "q.png", dataUrl: png }],
  });
  const vision = r3.events?.find((e) => e.type === "vision");
  check("vision structured", !!vision && vision.analysis?.molecule_candidates?.length > 0);
  check(
    "vision auto evidence",
    r3.events?.some(
      (e) => e.type === "tool" && e.name === "query_molecules"
    ) && r3.events?.some((e) => e.type === "chart" || e.type === "scene")
  );

  const csv = "名称,科\nA,菊科\nB,豆科\nC,菊科";
  const r4 = await chat(base, {
    messages: [{ role: "user", content: "统计这张表格里每个科有多少条" }],
    attachments: [{ name: "demo.csv", kind: "table", text: csv }],
  });
  const tableTool = r4.events?.find((e) => e.type === "tool" && e.name === "analyze_table");
  check(
    "table analysis",
    tableTool?.result?.groups?.length === 2 && r4.events?.some((e) => e.type === "chart")
  );

  const r5 = await chat(base, {
    messages: [{ role: "user", content: "核对资料里的菊科数量" }],
    attachments: [
      { name: "claim.txt", kind: "text", text: "资料称菊科有 1000 条记录。" },
    ],
  });
  const claimTool = r5.events?.find((e) => e.type === "tool" && e.name === "verify_claim");
  const conflict = r5.events?.find((e) => e.type === "conflict");
  check(
    "verify_claim",
    claimTool?.result?.claimed === 1000 &&
      typeof conflict?.conflict?.actual === "number"
  );

  const sessionBody = {
    userText: "统计表格",
    plan: { goal: "统计表格", steps: [{ title: "统计", tool: "analyze_table" }] },
    answer: "完成",
    ts: Date.now(),
  };
  const sp = await fetch(`${base}/api/ai/session/last`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ai-session": "e2e-session-0123456789" },
    body: JSON.stringify(sessionBody),
  });
  const sg = await fetch(`${base}/api/ai/session/last`, {
    headers: { "x-ai-session": "e2e-session-0123456789" },
  });
  const saved = await sg.json();
  check("session save/get", sp.ok && saved.session?.plan?.goal === "统计表格");
  const badSession = await fetch(`${base}/api/ai/session/last`, {
    headers: { "x-ai-session": "short" },
  });
  check("session id rejected", badSession.status === 400);

  const configBody = JSON.stringify({
    provider: "custom",
    baseURL: `http://127.0.0.1:${mockPort}/v1`,
    model: "mock-chat",
  });
  const c1 = await fetch(`${base}/api/ai/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: configBody,
  });
  const c2 = await fetch(`${base}/api/ai/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ai-admin-token": "e2e-token" },
    body: configBody,
  });
  const c3 = await fetch(`${base}/api/ai/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ai-admin-token": "e2e-token" },
    body: configBody,
  });
  check("config locked", c1.status === 403);
  check("config token", c2.status === 200);
  check("write rate limit", c3.status === 429);

  const ac = new AbortController();
  const slow = chat(base, {
    messages: [{ role: "user", content: "慢慢回答" }],
  }, { signal: ac.signal }).catch(() => null);
  await delay(700);
  const second = await chat(base, { messages: [{ role: "user", content: "再来一个" }] });
  check("per-ip concurrency", second.status === 429);
  ac.abort();
  await slow;
  await delay(500);

  const before = await (await fetch(`${mockBase}/stats`)).json();
  const ac2 = new AbortController();
  const controller = setTimeout(() => ac2.abort(), 1500);
  await chat(base, { messages: [{ role: "user", content: "慢慢回答第二次" }] }, {
    signal: ac2.signal,
  }).catch(() => null);
  clearTimeout(controller);
  await delay(1200);
  const after = await (await fetch(`${mockBase}/stats`)).json();
  check("abort upstream", after.aborted > before.aborted, `${before.aborted}→${after.aborted}`);

  const ps = await (await fetch(`${base}/api/ai/paper-sources`)).json();
  check(
    "paper sources",
    ps.ok && ps.sources?.some((s) => s.id === "cnki") && ps.sources?.some((s) => s.id === "nature")
  );

  const metrics = await (await fetch(`${base}/api/ai/metrics`)).json();
  check(
    "metrics limits",
    metrics.limits?.adminTokenSet === true && metrics.limits?.maxConcurrentPerIp === 1
  );
  check(
    "metrics tools",
    (metrics.tools?.byName?.query_molecules?.calls || 0) >= 1
  );
} catch (err) {
  console.error("E2E ERROR:", err);
  check("fatal", false, String(err?.message || err));
} finally {
  try { ai.kill(); } catch (_) {}
  try { mock.kill(); } catch (_) {}
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
exitCode = failed.length ? 1 : 0;
process.exit(exitCode);
