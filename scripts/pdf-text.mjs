#!/usr/bin/env node
/**
 * 调试 PDF 文本提取：node scripts/pdf-text.mjs path/to/file.pdf
 * 只打印提取结果概况和前 300 字，不写文件。
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseFileBuffer } from "../ai/files.mjs";

const file = process.argv[2];
if (!file) {
  console.error("用法：node scripts/pdf-text.mjs <file.pdf>");
  process.exit(1);
}
const buf = readFileSync(file);
const out = parseFileBuffer(basename(file), "application/pdf", buf);
console.log(
  JSON.stringify(
    {
      ok: out.ok,
      kind: out.kind,
      chars: out.chars,
      truncated: out.truncated,
      note: out.note,
      error: out.error,
      sample: String(out.text || "").slice(0, 300),
    },
    null,
    2
  )
);
