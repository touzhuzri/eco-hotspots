/**
 * 附件读取：PDF / DOCX / XLSX / PPTX / CSV / 文本 / HTML / JSON
 *
 * 目标：零 npm 依赖，离线可用。只做“把文件里的文字读出来”这件小事，
 * 不追求完整还原排版；扫描版 PDF 或 CID 字体 PDF 可能读不到文字，会明确提示。
 */

import { inflateSync, inflateRawSync } from "node:zlib";

const MAX_TEXT = 60000;
// 解压上限：防 zip bomb / 超大 PDF 流把内存打满
const MAX_INFLATE = 32 * 1024 * 1024;
const MAX_PDF_STREAMS = 600;
const MAX_ZIP_ENTRIES = 4000;

const TEXT_EXT = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "xml",
  "yaml",
  "yml",
  "log",
  "tex",
  "rst",
  "html",
  "htm",
  "svg",
  "smi",
  "smiles",
]);

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

function decodeText(buf) {
  if (!buf?.length) return "";
  // UTF-8 BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString("utf8");
  }
  // UTF-16 BOM
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buf.toString("utf8");
}

function tidy(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}

function clip(text, limit = MAX_TEXT) {
  const s = tidy(text);
  return {
    text: s.slice(0, limit),
    chars: s.length,
    truncated: s.length > limit,
  };
}

// ── HTML / XML ──────────────────────────────────────────────
function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function htmlToText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n· ")
      .replace(/<t[dh]\b[^>]*>/gi, "\t")
      .replace(/<[^>]+>/g, " ")
  );
}

function xmlToText(xml) {
  return decodeEntities(
    String(xml || "")
      .replace(/<\/w:p>/gi, "\n")
      .replace(/<w:tab\/>/gi, "\t")
      .replace(/<w:br\/>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

// ── PDF ─────────────────────────────────────────────────────
function printableRatio(s) {
  const str = String(s || "").replace(/[\s]/g, " ");
  if (!str.length) return 0;
  let ok = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if ((c >= 0x20 && c <= 0x7e) || c >= 0xa0) ok++;
    else if (str[i] === " " || str[i] === "\n") ok++;
  }
  return ok / str.length;
}

/** PDF 字符串 → 字节（处理转义；十六进制去掉空白） */
function pdfStringBytes(raw, isHex) {
  if (isHex) {
    const hex = raw.replace(/[^0-9A-Fa-f]/g, "");
    const bytes = [];
    for (let i = 0; i + 1 < hex.length; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return Buffer.from(bytes);
  }
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") {
      bytes.push(raw.charCodeAt(i) & 0xff);
      continue;
    }
    const n = raw[++i];
    if (n === undefined) break;
    if (n === "n") bytes.push(10);
    else if (n === "r") bytes.push(13);
    else if (n === "t") bytes.push(9);
    else if (n === "b") bytes.push(8);
    else if (n === "f") bytes.push(12);
    else if (n === "(" || n === ")" || n === "\\") bytes.push(n.charCodeAt(0));
    else if (n === "\r" || n === "\n") {
      // 反斜杠续行
    } else if (n >= "0" && n <= "7") {
      let oct = n;
      for (let k = 0; k < 2; k++) {
        const d = raw[i + 1];
        if (d >= "0" && d <= "7") {
          oct += d;
          i++;
        } else break;
      }
      bytes.push(parseInt(oct, 8) & 0xff);
    } else bytes.push(n.charCodeAt(0) & 0xff);
  }
  return Buffer.from(bytes);
}

/** CMap 里的 <hex> 目标串按 UTF-16BE 解码 */
function hexToUnicode(hex) {
  const clean = String(hex || "").replace(/[^0-9A-Fa-f]/g, "");
  if (!clean) return "";
  const bytes = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  let buf = Buffer.from(bytes);
  if (buf[0] === 0xfe && buf[1] === 0xff) buf = buf.subarray(2);
  if (buf.length % 2 !== 0) return buf.toString("latin1");
  const swapped = Buffer.from(buf);
  swapped.swap16();
  return swapped.toString("utf16le");
}

/** 解析 ToUnicode CMap：bfchar / bfrange */
function pdfCMap(text) {
  const map = new Map();
  let codeLen = 1;
  const add = (srcHex, str) => {
    const hex = String(srcHex || "").toLowerCase();
    if (!hex) return;
    map.set(hex, str);
    codeLen = Math.max(codeLen, Math.ceil(hex.length / 2));
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      add(m[1], hexToUnicode(m[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re =
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[((?:\s*<[0-9A-Fa-f]*>\s*)+)\])/g;
    let m;
    while ((m = re.exec(block[1]))) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || hi - lo > 65535) {
        continue;
      }
      const width = Math.max(2, m[1].length, m[2].length);
      if (m[3] !== undefined) {
        const base = hexToUnicode(m[3]);
        const tail = base.length ? base.charCodeAt(base.length - 1) : 0;
        for (let c = lo; c <= hi; c++) {
          const s = base.slice(0, -1) + String.fromCharCode((tail + (c - lo)) & 0xffff);
          add(c.toString(16).padStart(width, "0"), s);
        }
      } else {
        const items = [...m[4].matchAll(/<([0-9A-Fa-f]*)>/g)];
        for (let k = 0; k < items.length && lo + k <= hi; k++) {
          add((lo + k).toString(16).padStart(width, "0"), hexToUnicode(items[k][1]));
        }
      }
    }
  }
  return { map, codeLen };
}

/** 用当前字体的 ToUnicode 映射解码字符串 */
function decodePdfBytes(bytes, font) {
  if (!bytes?.length) return "";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const rest = Buffer.from(bytes.subarray(2));
    if (rest.length % 2) return rest.toString("latin1");
    rest.swap16();
    return rest.toString("utf16le");
  }
  if (font?.map?.size) {
    const step = font.codeLen >= 2 ? 2 : 1;
    let out = "";
    let hits = 0;
    let total = 0;
    for (let i = 0; i + step <= bytes.length; i += step) {
      total++;
      const hex = bytes.subarray(i, i + step).toString("hex");
      let hit = font.map.get(hex);
      if (hit === undefined) hit = font.map.get(hex.replace(/^0+/, ""));
      if (hit !== undefined) {
        out += hit;
        hits++;
      } else if (step === 1) {
        out += String.fromCharCode(bytes[i]);
      }
    }
    if (total && hits / total >= 0.5) return out;
  }
  // 没有映射时：若多数字节为 0，尝试按 UTF-16BE 解
  if (bytes.length >= 2 && bytes.length % 2 === 0) {
    let zeros = 0;
    for (let i = 0; i < bytes.length; i += 2) if (bytes[i] === 0) zeros++;
    if (zeros >= bytes.length / 4) {
      const swapped = Buffer.from(bytes);
      swapped.swap16();
      const s = swapped.toString("utf16le");
      if (printableRatio(s) > 0.6) return s;
    }
  }
  return bytes.toString("latin1");
}

/** 支持 Filter 的流解压；图片/字体程序等返回 null */
function pdfStreamData(o) {
  if (!o?.data) return null;
  const filter = (/\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(o.dict) || [])[1] || "";
  if (!filter) return o.data;
  if (/\/(DCTDecode|JPXDecode|JBIG2Decode|CCITTFaxDecode)\b/.test(filter)) return null;
  if (/\/(FlateDecode|Fl)\b/.test(filter)) {
    try {
      return inflateSync(o.data, { maxOutputLength: MAX_INFLATE });
    } catch (_) {
      try {
        return inflateRawSync(o.data, { maxOutputLength: MAX_INFLATE });
      } catch (_) {
        return null;
      }
    }
  }
  // 只处理无过滤或 Flate；其余（ASCII85 等）不支持解码
  if (/^\[\s*\]$/.test(filter.trim())) return o.data;
  return null;
}

/** 粗解析 PDF 对象（含流），用于跳过图片/字体流、读取 ToUnicode */
function pdfObjects(buf) {
  const latin = buf.toString("latin1");
  const objs = new Map();
  const re = /(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(latin))) {
    const num = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    let objEnd = latin.indexOf("endobj", bodyStart);
    if (objEnd < 0) objEnd = latin.length;
    const streamAt = latin.indexOf("stream", bodyStart);
    if (streamAt >= 0 && streamAt < objEnd) {
      let dataStart = streamAt + 6;
      if (latin[dataStart] === "\r") dataStart++;
      if (latin[dataStart] === "\n") dataStart++;
      const dict = latin.slice(bodyStart, streamAt);
      let dataEnd = -1;
      let next = -1;
      const lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      if (lenM) {
        const len = Number(lenM[1]);
        if (
          dataStart + len <= buf.length &&
          /^\s*endstream/.test(latin.slice(dataStart + len, dataStart + len + 24))
        ) {
          dataEnd = dataStart + len;
          next = latin.indexOf("endstream", dataEnd) + 9;
        }
      }
      if (dataEnd < 0) {
        const es = latin.indexOf("endstream", dataStart);
        if (es < 0) break;
        dataEnd = es;
        if (latin[dataEnd - 1] === "\n") dataEnd--;
        if (latin[dataEnd - 1] === "\r") dataEnd--;
        next = es + 9;
      }
      if (!objs.has(num)) {
        objs.set(num, { num, dict, data: buf.subarray(dataStart, dataEnd) });
      }
      re.lastIndex = next;
    } else {
      if (!objs.has(num)) {
        objs.set(num, { num, dict: latin.slice(bodyStart, objEnd), data: null });
      }
      re.lastIndex = objEnd + 6;
    }
  }
  // PDF 1.5 起很多字典压在对象流里，展开后才能拿到字体和资源
  const extra = [];
  for (const o of objs.values()) {
    if (!/\/Type\s*\/ObjStm\b/.test(o.dict) || !o.data) continue;
    const data = pdfStreamData(o);
    if (!data) continue;
    const first = Number((/\/First\s+(\d+)/.exec(o.dict) || [])[1]);
    const n = Number((/\/N\s+(\d+)/.exec(o.dict) || [])[1]);
    if (!Number.isFinite(first) || !Number.isFinite(n) || n <= 0 || n > 10000) continue;
    const text = data.toString("latin1");
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = header[i * 2];
      const off = header[i * 2 + 1];
      const nextOff = i + 1 < n ? header[i * 2 + 3] : text.length - first;
      if (!Number.isFinite(num) || !Number.isFinite(off) || !Number.isFinite(nextOff)) {
        continue;
      }
      const body = text.slice(first + off, first + nextOff);
      if (!objs.has(num)) extra.push([num, { num, dict: body, data: null }]);
    }
  }
  for (const [num, o] of extra) if (!objs.has(num)) objs.set(num, o);
  return objs;
}

/** 资源名（/F1）→ 字体 ToUnicode 映射 */
function pdfFonts(objs) {
  const cmaps = new Map();
  for (const o of objs.values()) {
    const m = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.dict);
    if (!m) continue;
    const target = objs.get(Number(m[1]));
    const data = pdfStreamData(target);
    if (!data) continue;
    const parsed = pdfCMap(data.toString("latin1"));
    if (parsed.map.size) cmaps.set(o.num, parsed);
  }
  const byName = new Map();
  for (const o of objs.values()) {
    for (const fm of o.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
      for (const rm of fm[1].matchAll(/\/([^\s\/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
        if (!byName.has(rm[1])) {
          byName.set(rm[1], cmaps.get(Number(rm[2])) || null);
        }
      }
    }
  }
  // 兜底：资源字典是间接引用时，从任意 /Name n 0 R 找字体对象
  for (const o of objs.values()) {
    for (const rm of o.dict.matchAll(/\/([A-Za-z][A-Za-z0-9_.+-]*)\s+(\d+)\s+\d+\s+R/g)) {
      if (byName.has(rm[1])) continue;
      const target = objs.get(Number(rm[2]));
      if (target && /\/Type\s*\/Font\b/.test(target.dict)) {
        byName.set(rm[1], cmaps.get(Number(rm[2])) || null);
      }
    }
  }
  return byName;
}

/** 从内容流中抽 Tj / TJ / ' / " 的文本，按当前字体解码 */
function pdfContentText(src, fonts) {
  const clean = src.replace(/\bBI\b[\s\S]*?\bEI\b/g, " ");
  const token =
    /\/([^\s\/<>\[\]()]+)\s+([\d.+-]+)\s+Tf|\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|-?\d+(?:\.\d+)?|\bBT\b|\bET\b|\bTd\b|\bTD\b|\bT\*\b|\bTm\b|\bT[Jj]\b|'|"/g;
  let out = "";
  let pending = "";
  let font = null;
  let fontSize = 10;
  let inText = false;
  let arrayDepth = 0;
  let nums = [];
  let lastY = null;
  let m;
  while ((m = token.exec(clean))) {
    const t = m[0];
    if (t[0] === "/" && m[1]) {
      font = fonts.get(m[1]) || null;
      const size = Number(m[2]);
      if (Number.isFinite(size) && size > 0) fontSize = size;
    } else if (t === "[") {
      arrayDepth++;
    } else if (t === "]") {
      arrayDepth = Math.max(0, arrayDepth - 1);
    } else if (t === "BT") {
      inText = true;
      lastY = null;
    } else if (t === "ET") {
      out += `${pending}\n`;
      pending = "";
      inText = false;
      nums = [];
    } else if (t[0] === "(") {
      if (inText) pending += decodePdfBytes(pdfStringBytes(t.slice(1, -1), false), font);
    } else if (t[0] === "<") {
      if (inText) pending += decodePdfBytes(pdfStringBytes(t.slice(1, -1), true), font);
    } else if (t === "Tj" || t === "TJ" || t === "'" || t === '"') {
      out += pending;
      pending = "";
      if (t === "'" || t === '"') out += "\n";
      nums = [];
    } else if (t === "T*") {
      out += pending ? `${pending}\n` : out && !out.endsWith("\n") ? "\n" : "";
      pending = "";
      nums = [];
    } else if (t === "Td" || t === "TD") {
      const ty = nums.length ? nums[nums.length - 1] : 0;
      const tx = nums.length >= 2 ? nums[nums.length - 2] : 0;
      if (Math.abs(ty) > 6) {
        out += pending;
        pending = "";
        if (out && !out.endsWith("\n")) out += "\n";
        lastY = ty;
      } else {
        // tx 明显大于一个字的步进才当词间空格；逐字排版的 PDF 不能每个字都加空格
        const wordGap = Math.abs(tx) > Math.max(fontSize * 1.8, 4);
        out += wordGap && pending ? `${pending} ` : pending;
        pending = "";
      }
      nums = [];
    } else if (t === "Tm") {
      const y = nums.length ? nums[nums.length - 1] : null;
      if (y !== null) {
        if (lastY === null) lastY = y;
        else if (Math.abs(y - lastY) > 2 && inText) {
          out += pending;
          pending = "";
          if (out && !out.endsWith("\n")) out += "\n";
          lastY = y;
        }
      }
      nums = [];
    } else if (arrayDepth > 0 && /^-?\d/.test(t)) {
      // TJ 里较大的负数字距表示词间空格
      if (Number(t) <= -100 && inText && !pending.endsWith(" ")) pending += " ";
    } else if (/^-?\d/.test(t)) {
      nums.push(Number(t));
      if (nums.length > 6) nums.shift();
    }
  }
  out += pending;
  return out;
}

function pdfToText(buf) {
  const latin = buf.toString("latin1");
  if (/\/Encrypt\b/.test(latin.slice(0, 50000))) {
    return {
      text: "",
      note: "这个 PDF 带有加密标记，暂时无法读取文字；请先解除保护后再上传。",
    };
  }
  const objs = pdfObjects(buf);
  const fonts = pdfFonts(objs);
  const chunks = [];
  let streams = 0;
  for (const o of objs.values()) {
    if (!o.data || streams >= MAX_PDF_STREAMS) continue;
    const d = o.dict;
    // 跳过图片、对象流、字体程序、元数据等非正文流
    if (/\/Subtype\s*\/Image\b/.test(d)) continue;
    if (/\/Type\s*\/(ObjStm|XRef|Metadata|EmbeddedFile|Font|FontDescriptor)\b/.test(d)) {
      continue;
    }
    if (/\/Subtype\s*\/(Type1C|CIDFontType0C|OpenType|XML)\b/.test(d)) continue;
    if (/\/Length1\b/.test(d)) continue;
    const data = pdfStreamData(o);
    if (!data) continue;
    const src = data.toString("latin1");
    // 正文内容流一定同时有 BT 和文字绘制操作
    if (!/\bBT\b/.test(src) || !/\bT[Jj]\b/.test(src)) continue;
    const text = pdfContentText(src, fonts);
    if (text.trim()) {
      chunks.push(text);
      streams++;
    }
  }
  const text = chunks.join("\n");
  if (!text.trim()) {
    return {
      text: "",
      note: "没有从 PDF 中提取到文字。它可能是扫描件，或使用了暂不支持的字体编码。",
    };
  }
  return { text, note: "" };
}

// ── ZIP（DOCX / XLSX / PPTX） ───────────────────────────────
function readZip(buf) {
  const entries = new Map();
  // 从尾部找 End of Central Directory
  let eocd = -1;
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 ZIP 文件");
  const count = Math.min(buf.readUInt16LE(eocd + 10), MAX_ZIP_ENTRIES);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && ptr + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    // 跳过解压后会过大的条目，防止 zip bomb
    if (uncompSize <= MAX_INFLATE && buf.readUInt32LE(localOff) === 0x04034b50) {
      const lName = buf.readUInt16LE(localOff + 26);
      const lExtra = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lName + lExtra;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      let data = null;
      try {
        if (method === 0) data = Buffer.from(raw);
        else if (method === 8)
          data = inflateRawSync(raw, { maxOutputLength: MAX_INFLATE });
      } catch (_) {
        data = null;
      }
      if (data) entries.set(name, data);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function docxToText(buf) {
  const zip = readZip(buf);
  const parts = [];
  // 正文 + 页眉页脚 + 脚注
  for (const [name, data] of zip) {
    if (/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(name)) {
      parts.push(xmlToText(decodeText(data)));
    }
  }
  return parts.join("\n");
}

function xlsxToText(buf) {
  const zip = readZip(buf);
  const sharedRaw = zip.get("xl/sharedStrings.xml");
  const shared = [];
  if (sharedRaw) {
    const xml = decodeText(sharedRaw);
    for (const m of xml.matchAll(/<si\b[\s\S]*?<\/si>/gi)) {
      shared.push(xmlToText(m[0]).replace(/\s+/g, " ").trim());
    }
  }
  const sheets = [...zip.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d*\.xml$/i.test(n))
    .sort();
  const out = [];
  for (const sheet of sheets) {
    const xml = decodeText(zip.get(sheet));
    const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const cells = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attrs = cm[1] || "";
        const body = cm[2] || "";
        const isStr = /\bt="s"/.test(attrs);
        const inline = /\bt="inlineStr"/.test(attrs);
        let value = "";
        if (isStr) {
          const vm = /<v>([\s\S]*?)<\/v>/i.exec(body);
          value = shared[Number(vm?.[1])] ?? "";
        } else if (inline) {
          value = xmlToText(body).replace(/\s+/g, " ").trim();
        } else {
          const vm = /<v>([\s\S]*?)<\/v>/i.exec(body);
          value = decodeEntities(vm?.[1] ?? "").trim();
        }
        cells.push(value);
      }
      if (cells.some((c) => c !== "")) rows.push(cells.join("\t"));
    }
    if (rows.length) out.push(`## ${sheet.split("/").pop()}\n${rows.join("\n")}`);
  }
  return out.join("\n\n");
}

function pptxToText(buf) {
  const zip = readZip(buf);
  const slides = [...zip.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(/(\d+)/.exec(a)?.[1] || 0);
      const nb = Number(/(\d+)/.exec(b)?.[1] || 0);
      return na - nb;
    });
  return slides
    .map((name, i) => {
      const xml = decodeText(zip.get(name));
      const lines = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)].map((m) =>
        decodeEntities(m[1]).trim()
      );
      return lines.filter(Boolean).length
        ? `## 第 ${i + 1} 页\n${lines.filter(Boolean).join("\n")}`
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

// ── 对外入口 ───────────────────────────────────────────────
export function parseFileBuffer(name, mime, buf) {
  const ext = extOf(name);
  const kind =
    ext === "pdf"
      ? "pdf"
      : ext === "docx"
        ? "docx"
        : ext === "xlsx"
          ? "xlsx"
          : ext === "pptx"
            ? "pptx"
            : ext === "csv" || ext === "tsv"
              ? "table"
              : TEXT_EXT.has(ext)
                ? "text"
                : "unknown";

  if (!buf?.length) {
    return { ok: false, kind, name, chars: 0, text: "", error: "文件是空的" };
  }

  try {
    let raw = "";
    let note = "";
    if (kind === "pdf") {
      const r = pdfToText(buf);
      raw = r.text;
      note = r.note || "";
    } else if (kind === "docx") {
      raw = docxToText(buf);
    } else if (kind === "xlsx") {
      raw = xlsxToText(buf);
    } else if (kind === "pptx") {
      raw = pptxToText(buf);
    } else if (kind === "text" || kind === "table") {
      raw = decodeText(buf);
      if (ext === "html" || ext === "htm" || ext === "svg") {
        raw = htmlToText(raw);
      }
      if (ext === "json") {
        try {
          raw = JSON.stringify(JSON.parse(raw), null, 2);
        } catch (_) {
          // 保留原文
        }
      }
    } else {
      return {
        ok: false,
        kind,
        name,
        chars: 0,
        text: "",
        error: `暂不支持 .${ext || "未知"} 文件。可上传 PDF、Word、Excel、PPT、CSV、TXT、Markdown、JSON、HTML。`,
      };
    }

    // 二进制误判：出现大量 NUL 字符就当没读到
    const nul = (raw.match(/\u0000/g) || []).length;
    if (nul > Math.max(8, raw.length * 0.02)) {
      return {
        ok: false,
        kind,
        name,
        chars: 0,
        text: "",
        error: "文件内容看起来是二进制，未能提取文字。",
      };
    }

    const clipped = clip(raw);
    if (!clipped.chars && !note) {
      note = "没有读到可用文字。";
    }
    return {
      ok: clipped.chars > 0,
      kind,
      name,
      chars: clipped.chars,
      text: clipped.text,
      truncated: clipped.truncated,
      note,
    };
  } catch (err) {
    return {
      ok: false,
      kind,
      name,
      chars: 0,
      text: "",
      error: `读取失败：${String(err?.message || err).slice(0, 240)}`,
    };
  }
}

/** 聊天时注入模型的附件正文上限（每个文件） */
export function attachmentTextForModel(text, limit = 12000) {
  const s = String(text || "");
  if (s.length <= limit) return { text: s, truncated: false };
  return { text: s.slice(0, limit), truncated: true };
}
