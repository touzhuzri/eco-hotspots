import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { parseFileBuffer } from "../ai/files.mjs";

/** 构造一个最小 PDF：内容流用 Flate 压缩 */
function makePdf({ indirectFilter = false, text = "Hello PDF World" } = {}) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const z = deflateSync(Buffer.from(content, "latin1"));
  const filter = indirectFilter ? "5 0 R" : "/FlateDecode";
  const obj5 = indirectFilter
    ? "5 0 obj\n/FlateDecode\nendobj\n"
    : "";
  const head = Buffer.from(
    `%PDF-1.5\n` +
      `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
      `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n` +
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n` +
      `4 0 obj\n<< /Length ${z.length} /Filter ${filter} >>\nstream\n`,
    "latin1"
  );
  const mid = Buffer.from(
    `\nendstream\nendobj\n` +
      obj5 +
      `6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n%%EOF\n`,
    "latin1"
  );
  return Buffer.concat([head, z, mid]);
}

test("PDF：直接 FlateDecode 能提取文字", () => {
  const out = parseFileBuffer("demo.pdf", "application/pdf", makePdf());
  assert.equal(out.ok, true);
  assert.match(out.text, /Hello PDF World/);
});

test("PDF：间接 /Filter 引用也能解压", () => {
  const out = parseFileBuffer(
    "demo.pdf",
    "application/pdf",
    makePdf({ indirectFilter: true })
  );
  assert.equal(out.ok, true);
  assert.match(out.text, /Hello PDF World/);
});

test("PDF：无文字时返回具体原因而不是泛泛的二进制错误", () => {
  const empty = Buffer.from(
    "%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
    "latin1"
  );
  const out = parseFileBuffer("empty.pdf", "application/pdf", empty);
  assert.equal(out.ok, false);
  assert.match(out.error, /扫描|字体|加密|文字/);
});
