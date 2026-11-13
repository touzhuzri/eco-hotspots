/**
 * 上传表格的结构化分析（零依赖）
 *
 * 支持 CSV / TSV（前端已把 XLSX 首个工作表转成制表符文本）。
 * 只做确定性的行列统计，数字不经过模型。
 */

const MAX_ROWS = 50000;
const MAX_COLS = 60;

/** 解析带引号的 CSV / TSV；自动判断分隔符 */
export function parseDelimited(text) {
  const raw = String(text || "").replace(/^﻿/, "");
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim()) || "";
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  const delim =
    tabs > commas ? "\t" : commas === 0 && semis > 0 ? ";" : ",";

  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length > MAX_ROWS) break;
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows
    .map((r) => r.map((v) => String(v ?? "").trim()))
    .filter((r) => r.some((v) => v !== ""));
  if (!cleaned.length) {
    return {
      columns: [],
      data: [],
      delimiter: delim === "\t" ? "tab" : delim === ";" ? "semicolon" : "comma",
    };
  }

  const headerRaw = cleaned.shift().slice(0, MAX_COLS);
  const seen = new Map();
  const columns = headerRaw.map((h, i) => {
    let name = h || `列${i + 1}`;
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name}（${n}）`;
    return name;
  });

  const data = cleaned
    .map((r) => {
      const out = r.slice(0, columns.length);
      while (out.length < columns.length) out.push("");
      return out;
    })
    .slice(0, MAX_ROWS);

  return {
    columns,
    data,
    delimiter: delim === "\t" ? "tab" : delim === ";" ? "semicolon" : "comma",
    truncated: rows.length > MAX_ROWS + 1,
  };
}

/** 从本轮附件中挑出表格 */
export function tablesFromAttachments(attachments = []) {
  const out = [];
  for (const a of Array.isArray(attachments) ? attachments : []) {
    const kind = String(a?.kind || "");
    if (kind !== "table" && kind !== "xlsx") continue;
    const text = String(a?.text || "");
    if (!text.trim()) continue;
    const parsed = parseDelimited(text);
    if (!parsed.columns.length) continue;
    out.push({
      name: String(a?.name || "表格").slice(0, 120),
      kind,
      ...parsed,
    });
  }
  return out;
}

/** 给模型看的表格清单（不含全部行，避免占 token） */
export function tableContextText(tables = []) {
  if (!tables.length) return "";
  const lines = tables.map((t) => {
    const preview = t.data
      .slice(0, 3)
      .map((row) => row.join(" | "))
      .join("\n");
    return `- 《${t.name}》：${t.data.length} 行 × ${t.columns.length} 列\n  列名：${t.columns.join(
      "、"
    )}\n  预览：\n${preview}`;
  });
  return `【本轮上传的结构化表格】\n${lines.join(
    "\n"
  )}\n需要计数、求和、平均或分组时，必须调用 analyze_table 计算，不要手算或估算。`;
}

function toNumber(value) {
  const n = Number(String(value ?? "").replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function findColumn(columns, name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return -1;
  const exact = columns.findIndex((c) => c.toLowerCase() === key);
  if (exact >= 0) return exact;
  return columns.findIndex(
    (c) => c.toLowerCase().includes(key) || key.includes(c.toLowerCase())
  );
}

function publicTable(t) {
  return { name: t.name, rows: t.data.length, columns: t.columns };
}

/**
 * 对表格做分组统计。
 * args: { file, group_by, metric, value_column, filter_column, filter_contains, limit }
 */
export function analyzeTable(tables = [], args = {}) {
  if (!tables.length) {
    return {
      ok: false,
      error:
        "本轮没有可分析的结构化表格。请先上传 CSV / TSV / Excel 文件；PDF / Word 仍走知识库检索。",
    };
  }
  const wanted = String(args.file || "").trim().toLowerCase();
  const table =
    (wanted &&
      (tables.find((t) => t.name.toLowerCase().includes(wanted)) ||
        tables.find((t) => wanted.includes(t.name.toLowerCase())))) ||
    tables[0];

  const columns = table.columns;
  const limit = Math.max(1, Math.min(30, Number(args.limit) || 15));
  const filterCol = args.filter_column
    ? findColumn(columns, args.filter_column)
    : -1;
  if (args.filter_column && filterCol < 0) {
    return {
      ok: false,
      error: `找不到筛选列「${args.filter_column}」。可用列：${columns.join("、")}`,
      columns,
    };
  }
  const filterText = String(args.filter_contains || "").trim().toLowerCase();
  const rows = table.data.filter((row) =>
    filterCol < 0 || !filterText
      ? true
      : String(row[filterCol] || "").toLowerCase().includes(filterText)
  );
  if (!rows.length) {
    return {
      ok: true,
      file: table.name,
      rows: 0,
      columns,
      note: "筛选后没有数据行。",
      groups: [],
      preview: [],
    };
  }

  const groupIdx = args.group_by ? findColumn(columns, args.group_by) : -1;
  if (args.group_by && groupIdx < 0) {
    return {
      ok: false,
      error: `找不到分组列「${args.group_by}」。可用列：${columns.join("、")}`,
      columns,
      tables: tables.map(publicTable),
    };
  }
  const valueIdx = args.value_column
    ? findColumn(columns, args.value_column)
    : -1;
  if (args.value_column && valueIdx < 0) {
    return {
      ok: false,
      error: `找不到数值列「${args.value_column}」。可用列：${columns.join("、")}`,
      columns,
    };
  }
  const metric = ["count", "sum", "avg", "min", "max"].includes(args.metric)
    ? args.metric
    : "count";
  if (metric !== "count" && valueIdx < 0) {
    return {
      ok: false,
      error: `metric=${metric} 需要指定 value_column。可用列：${columns.join("、")}`,
      columns,
    };
  }

  const numeric = (row) =>
    metric === "count" ? 1 : toNumber(row[valueIdx]);

  const buckets = new Map();
  for (const row of rows) {
    const label = groupIdx >= 0 ? String(row[groupIdx] || "（空）") : "全部";
    const v = numeric(row);
    if (!Number.isFinite(v)) continue;
    const b = buckets.get(label) || { label, n: 0, sum: 0, min: Infinity, max: -Infinity };
    b.n++;
    b.sum += v;
    b.min = Math.min(b.min, v);
    b.max = Math.max(b.max, v);
    buckets.set(label, b);
  }
  const valueOf = (b) =>
    metric === "count"
      ? b.n
      : metric === "sum"
        ? b.sum
        : metric === "avg"
          ? b.sum / b.n
          : metric === "min"
            ? b.min
            : b.max;
  const groups = [...buckets.values()]
    .map((b) => ({
      label: b.label,
      value: Number(valueOf(b).toFixed(4)),
      n: b.n,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const valueLabel =
    metric === "count"
      ? "行数"
      : `${columns[valueIdx]} ${metric === "sum" ? "合计" : metric === "avg" ? "平均" : metric === "min" ? "最小" : "最大"}`;

  return {
    ok: true,
    file: table.name,
    rows: rows.length,
    total_rows: table.data.length,
    columns,
    group_by: groupIdx >= 0 ? columns[groupIdx] : "",
    metric,
    value_column: valueIdx >= 0 ? columns[valueIdx] : "",
    value_label: valueLabel,
    groups,
    preview: rows.slice(0, 5).map((row) =>
      Object.fromEntries(columns.map((c, i) => [c, row[i]]))
    ),
    note:
      groupIdx >= 0
        ? "系统已根据 groups 自动生成柱状图，不需要再调用 render_chart。"
        : "没有分组列，返回表格概览；需要分布时请指定 group_by。",
    tables: tables.map(publicTable),
  };
}
