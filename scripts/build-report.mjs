#!/usr/bin/env node
/**
 * 生成参赛技术文档 PDF。
 *
 *   node scripts/build-report.mjs
 *
 * 需要本机安装 Chrome / Edge。也可用 CHROME_BIN 指定浏览器路径。
 * 源文件：docs/technical-report.html（A4 打印样式）
 * 输出：docs/technical-report.pdf、docs/世界之树-技术文档.pdf
 */
import { existsSync } from "node:fs";
import { copyFile, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const HTML = join(ROOT, "docs", "technical-report.html");
const PDF = join(ROOT, "docs", "technical-report.pdf");
const PDF_CN = join(ROOT, "docs", "世界之树-技术文档.pdf");

const candidates = [
  process.env.CHROME_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const chrome = candidates.find((p) => existsSync(p));
if (!chrome) {
  console.error("找不到 Chrome / Edge。请用 CHROME_BIN 指定浏览器路径。");
  process.exit(1);
}

const url = `file:///${HTML.replace(/\\/g, "/").replace(/^\//, "")}`;
const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-pdf-header-footer",
  "--run-all-compositor-stages-before-draw",
  "--virtual-time-budget=8000",
  `--print-to-pdf=${PDF}`,
  url,
];

await new Promise((resolve, reject) => {
  const child = spawn(chrome, args, { stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`浏览器退出码 ${code}`))
  );
});

const pdf = await readFile(PDF);
const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
const size = (await stat(PDF)).size;
if (!pages) {
  console.error("PDF 生成失败：没有检测到页面。");
  process.exit(1);
}
if (pages > 30) {
  console.error(`页数 ${pages} 超过 30 页，请压缩内容后重试。`);
  process.exit(1);
}
await copyFile(PDF, PDF_CN);
console.log(`已生成 ${PDF}`);
console.log(`已复制 ${PDF_CN}`);
console.log(`页数 ${pages}，大小 ${(size / 1024 / 1024).toFixed(2)} MB`);
