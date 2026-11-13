#!/usr/bin/env node
/**
 * E2E 测试用的 OpenAI 兼容 mock 服务。
 * 不调用任何真实模型，只根据请求内容返回固定工具调用/文本。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT || 18990);

const stats = {
  requests: 0,
  streams: 0,
  aborted: 0,
  vision: 0,
  plans: 0,
  tools: [],
};

const PLAN = JSON.stringify({
  goal: "核实 LOTUS 数据并给出可核对结论",
  steps: [
    { title: "查询 LOTUS 记录", tool: "query_molecules" },
    { title: "整理图表与来源", tool: "render_chart" },
  ],
});

const VISION = JSON.stringify({
  image_type: "structure",
  subject: "一张黄酮类化合物的结构式示意",
  family_candidates: [{ name: "Fabaceae", confidence: 0.42, reason: "叶片形态" }],
  molecule_candidates: [
    { name: "quercetin", confidence: 0.86, reason: "黄酮骨架与多个酚羟基" },
  ],
  structure_features: ["黄酮骨架", "多个酚羟基"],
  visible_text: "",
  uncertain: ["无法仅凭图片确认具体物种"],
  overall_confidence: 0.78,
});

function json(res, code, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function textOf(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((p) => p.text || "").join(" ");
  }
  return "";
}

function sseHead(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/stats") return json(res, 200, stats);
  if (url.pathname === "/reset") {
    for (const k of Object.keys(stats)) {
      stats[k] = Array.isArray(stats[k]) ? [] : 0;
    }
    return json(res, 200, stats);
  }
  if (!url.pathname.endsWith("/chat/completions")) {
    return json(res, 404, { error: "not found" });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (_) {
    return json(res, 400, { error: "bad json" });
  }
  stats.requests++;

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const all = messages.map(textOf).join("\n");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastText = textOf(lastUser);
  const hasToolResult = messages.some((m) => m.role === "tool");
  const isVision =
    /mock-vision/.test(String(body.model || "")) ||
    messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((p) => p.type === "image_url")
    );

  if (body.stream !== true) {
    if (isVision) {
      stats.vision++;
      return json(res, 200, {
        choices: [{ message: { role: "assistant", content: VISION } }],
      });
    }
    if (/研究规划器/.test(all)) {
      stats.plans++;
      return json(res, 200, {
        choices: [{ message: { role: "assistant", content: PLAN } }],
      });
    }
    return json(res, 200, {
      choices: [{ message: { role: "assistant", content: "mock ok" } }],
    });
  }

  stats.streams++;
  sseHead(res);
  let closed = false;
  res.on("close", () => {
    if (!closed) {
      closed = true;
      if (!res.writableEnded) stats.aborted++;
    }
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const finish = () => {
    if (closed) return;
    closed = true;
    res.write("data: [DONE]\n\n");
    res.end();
  };

  if (/慢/.test(lastText)) {
    let i = 0;
    const timer = setInterval(() => {
      if (closed) return clearInterval(timer);
      i++;
      send({ choices: [{ delta: { content: `慢速片段${i}。` } }] });
      if (i >= 30) {
        clearInterval(timer);
        finish();
      }
    }, 300);
    return;
  }

  if (!hasToolResult && Array.isArray(body.tools) && body.tools.length) {
    const names = body.tools.map((t) => t.function?.name).filter(Boolean);
    let name = "query_molecules";
    let args = { class_contains: "Flavon", group_by: "family", limit: 3 };
    if (names.includes("verify_claim") && /核对|差异|对比/.test(lastText)) {
      name = "verify_claim";
      args = { claimed: 1000, family: "Asteraceae", source_label: "测试资料" };
    } else if (names.includes("analyze_table") && /表格|CSV/i.test(lastText)) {
      name = "analyze_table";
      args = { group_by: "科", metric: "count" };
    } else if (names.includes("search_papers") && /论文|DOI|Nature/i.test(lastText)) {
      name = "search_papers";
      args = { query: "quercetin", source: "openalex", limit: 3 };
    }
    stats.tools.push(name);
    send({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_mock_1",
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    });
    return finish();
  }

  const answer =
    "这是 mock 环境下的回答：已根据工具结果核对 LOTUS 260413，数字与来源均来自工具。";
  const parts = answer.match(/[\s\S]{1,18}/g) || [answer];
  let i = 0;
  const timer = setInterval(() => {
    if (closed) return clearInterval(timer);
    send({ choices: [{ delta: { content: parts[i++] } }] });
    if (i >= parts.length) {
      clearInterval(timer);
      finish();
    }
  }, 8);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock] listening http://127.0.0.1:${PORT}`);
});
