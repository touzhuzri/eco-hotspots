import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTable, parseDelimited, tablesFromAttachments } from "../ai/tables.mjs";

test("CSV：引号、逗号与转义双引号", () => {
  const parsed = parseDelimited(
    '名称,备注\n"槲皮素, 黄酮","他说""你好"""\n山奈酚,普通\n'
  );
  assert.deepEqual(parsed.columns, ["名称", "备注"]);
  assert.equal(parsed.data.length, 2);
  assert.equal(parsed.data[0][0], "槲皮素, 黄酮");
  assert.equal(parsed.data[0][1], '他说"你好"');
});

test("TSV 与重复列名", () => {
  const parsed = parseDelimited("科\t科\n菊科\t豆科\n");
  assert.equal(parsed.delimiter, "tab");
  assert.deepEqual(parsed.columns, ["科", "科（2）"]);
});

test("分号分隔", () => {
  const parsed = parseDelimited("名称;科\nA;菊科\nB;豆科\n");
  assert.equal(parsed.delimiter, "semicolon");
  assert.equal(parsed.data.length, 2);
});

test("分组计数", () => {
  const tables = tablesFromAttachments([
    {
      name: "demo.csv",
      kind: "table",
      text: "名称,科,分子量\nA,菊科,300\nB,豆科,350\nC,菊科,400",
    },
  ]);
  const out = analyzeTable(tables, { group_by: "科", metric: "count" });
  assert.equal(out.ok, true);
  assert.deepEqual(
    out.groups.map((g) => [g.label, g.value]),
    [
      ["菊科", 2],
      ["豆科", 1],
    ]
  );
});

test("求和 / 平均 / 筛选", () => {
  const tables = tablesFromAttachments([
    {
      name: "demo.csv",
      kind: "table",
      text: "名称,科,分子量\nA,菊科,300\nB,豆科,350\nC,菊科,400",
    },
  ]);
  const sum = analyzeTable(tables, {
    group_by: "科",
    metric: "sum",
    value_column: "分子量",
  });
  assert.equal(sum.groups[0].value, 700);
  const avg = analyzeTable(tables, {
    group_by: "科",
    metric: "avg",
    value_column: "分子量",
  });
  assert.equal(avg.groups[0].value, 350);
  const filtered = analyzeTable(tables, {
    filter_column: "科",
    filter_contains: "菊",
    group_by: "科",
    metric: "count",
  });
  assert.equal(filtered.rows, 2);
});

test("错误的列名给出可用列", () => {
  const tables = tablesFromAttachments([
    { name: "demo.csv", kind: "table", text: "名称,科\nA,菊科" },
  ]);
  const out = analyzeTable(tables, { group_by: "年份" });
  assert.equal(out.ok, false);
  assert.match(out.error, /名称/);
});

test("没有表格时明确报错", () => {
  const out = analyzeTable([], {});
  assert.equal(out.ok, false);
  assert.match(out.error, /CSV|表格/);
});
