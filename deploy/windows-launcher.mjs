/**
 * Windows 启动器：不用 bash，直接由 Node 拉起站点和领养服务。
 *
 * 用法：
 *   start-windows.cmd           前台运行（Ctrl+C 停止）
 *   start-windows.cmd status
 *   start-windows.cmd stop
 *
 * 环境变量：SITE_PORT / PORT / CLAIM_PORT / CLAIM_FILE / BIND_HOST
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_PORT = Number(process.env.SITE_PORT || process.env.PORT || 5173);
const CLAIM_PORT = Number(process.env.CLAIM_PORT || 8788);
const AI_PORT = Number(process.env.AI_PORT || 8790);
const AI_DISABLED = process.env.AI_DISABLED === "1";
const CLAIM_FILE = process.env.CLAIM_FILE || join(ROOT, "claims.jsonl");
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
const LOG_DIR = join(ROOT, "logs");
const RUN_DIR = join(ROOT, ".run");
const SITE_PID = join(RUN_DIR, "site.pid");
const CLAIM_PID = join(RUN_DIR, "claim.pid");
const AI_PID = join(RUN_DIR, "ai.pid");
const ACTION = (process.argv[2] || "start").toLowerCase();

mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(RUN_DIR, { recursive: true });

function readPid(file) {
  try {
    return Number(readFileSync(file, "utf8").trim()) || 0;
  } catch {
    return 0;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopPid(file, name) {
  const pid = readPid(file);
  if (pid && alive(pid)) {
    try {
      process.kill(pid);
      console.log(`[${name}] stopped PID ${pid}`);
    } catch (err) {
      console.log(`[${name}] stop failed: ${err.message}`);
    }
  } else {
    console.log(`[${name}] not running`);
  }
  try {
    rmSync(file, { force: true });
  } catch {}
}

async function waitHttp(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

if (ACTION === "stop") {
  stopPid(SITE_PID, "site");
  stopPid(CLAIM_PID, "claim");
  stopPid(AI_PID, "ai");
  process.exit(0);
}

if (ACTION === "status") {
  for (const [name, file, port, health] of [
    ["site", SITE_PID, SITE_PORT, `http://127.0.0.1:${SITE_PORT}/`],
    [
      "claim",
      CLAIM_PID,
      CLAIM_PORT,
      `http://127.0.0.1:${CLAIM_PORT}/api/claim/health`,
    ],
    ["ai", AI_PID, AI_PORT, `http://127.0.0.1:${AI_PORT}/api/ai/health`],
  ]) {
    const pid = readPid(file);
    const up = await waitHttp(health, 1);
    const state = alive(pid)
      ? `running PID ${pid}`
      : up
        ? "running (external)"
        : "not running";
    console.log(`[${name}] ${state} · port ${port}`);
  }
  process.exitCode = 0;
}

if (ACTION !== "status") {
function appendLog(file) {
  return createWriteStream(file, { flags: "a" });
}

function startChild(name, script, env, logFile) {
  const out = appendLog(logFile);
  const child = spawn(process.execPath, [join(ROOT, script)], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  child.on("exit", () => {
    try {
      out.end();
    } catch {}
  });
  console.log(`[${name}] started PID ${child.pid} · log ${logFile}`);
  return child;
}

let claim = null;
let ai = null;
let site = null;
let stopping = false;

function cleanup(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const [name, child, file] of [
    ["site", site, SITE_PID],
    ["claim", claim, CLAIM_PID],
    ["ai", ai, AI_PID],
  ]) {
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {}
    }
    try {
      rmSync(file, { force: true });
    } catch {}
  }
  setTimeout(() => process.exit(exitCode), 300);
}

process.on("SIGINT", () => {
  console.log("\nstopping ...");
  cleanup(0);
});
process.on("SIGTERM", () => cleanup(0));

const claimHealth = `http://127.0.0.1:${CLAIM_PORT}/api/claim/health`;
const aiHealth = `http://127.0.0.1:${AI_PORT}/api/ai/health`;
const siteHealth = `http://127.0.0.1:${SITE_PORT}/`;

console.log(`[eco] root: ${ROOT}`);
console.log(
  `[eco] site port: ${SITE_PORT} · claim port: ${CLAIM_PORT} · ai port: ${AI_PORT}`
);
console.log(`[eco] claim file: ${CLAIM_FILE}`);

if (await waitHttp(claimHealth, 2)) {
  console.log("[claim] already running, reuse");
} else {
  claim = startChild(
    "claim",
    "deploy/claim-server.mjs",
    {
      HOST: "127.0.0.1",
      PORT: String(CLAIM_PORT),
      CLAIM_FILE,
      ALLOW_ORIGIN: process.env.ALLOW_ORIGIN || "*",
    },
    join(LOG_DIR, "claim.log")
  );
  writeFileSync(CLAIM_PID, String(claim.pid));
  if (!(await waitHttp(claimHealth, 120))) {
    console.error("[claim] failed to start; see logs/claim.log");
    cleanup(1);
    process.exit(1);
  }
}

if (AI_DISABLED) {
  console.log("[ai] disabled by AI_DISABLED=1");
} else if (!existsSync(join(ROOT, "ai/server.mjs"))) {
  console.log("[ai] ai/server.mjs not found, skip");
} else if (await waitHttp(aiHealth, 2)) {
  console.log("[ai] already running, reuse");
} else {
  ai = startChild(
    "ai",
    "ai/server.mjs",
    {
      AI_HOST: process.env.AI_HOST || "127.0.0.1",
      AI_PORT: String(AI_PORT),
    },
    join(LOG_DIR, "ai.log")
  );
  writeFileSync(AI_PID, String(ai.pid));
  if (!(await waitHttp(aiHealth, 120))) {
    console.error("[ai] failed to start; see logs/ai.log");
    cleanup(1);
    process.exit(1);
  }
}

if (await waitHttp(siteHealth, 2)) {
  console.log("[site] already running, reuse");
} else {
  site = startChild(
    "site",
    "deploy/site-server.mjs",
    {
      HOST: BIND_HOST,
      SITE_PORT: String(SITE_PORT),
      CLAIM_PROXY: `http://127.0.0.1:${CLAIM_PORT}`,
      AI_PROXY: `http://127.0.0.1:${AI_PORT}`,
    },
    join(LOG_DIR, "site.log")
  );
  writeFileSync(SITE_PID, String(site.pid));
  if (!(await waitHttp(siteHealth, 120))) {
    console.error("[site] failed to start; see logs/site.log");
    cleanup(1);
    process.exit(1);
  }
}

console.log("");
console.log("[eco] ready");
console.log(`  site:  http://127.0.0.1:${SITE_PORT}/`);
console.log(`  claim: http://127.0.0.1:${SITE_PORT}/api/claim/health`);
if (!AI_DISABLED && existsSync(join(ROOT, "ai/server.mjs"))) {
  console.log(`  ai:    http://127.0.0.1:${SITE_PORT}/api/ai/health`);
}
console.log("  Ctrl+C to stop");
console.log("");

const onExit = (name, code) => {
  if (stopping) return;
  console.error(`[${name}] exited with code ${code}; stopping the other services`);
  cleanup(code || 1);
};
if (claim) claim.on("exit", (code) => onExit("claim", code));
if (ai) ai.on("exit", (code) => onExit("ai", code));
if (site) site.on("exit", (code) => onExit("site", code));

// keep the launcher (and the panel process) alive
setInterval(() => {
  if (claim && claim.exitCode != null) onExit("claim", claim.exitCode);
  if (ai && ai.exitCode != null) onExit("ai", ai.exitCode);
  if (site && site.exitCode != null) onExit("site", site.exitCode);
}, 2000);
}
