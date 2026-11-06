/**
 * 底部 AI 分析坞（静态界面版）
 *
 * 收起时只有一条输入栏；聚焦/发送后向上展开：
 *   回答区（分析计划 / 工具轨迹 / 图表 / 引用 / 动作）
 *   上传文件 chip
 *   输入框
 *
 * 目前用静态示例回答演示排版；后续接 /api/ai/chat 后替换 addAiAnswer。
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function humanSize(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 把服务端/网络的原始错误翻译成用户能照做的提示 */
function friendlyError(message) {
  const s = String(message || "").trim();
  if (/429|1305|访问量过大|繁忙|overload|rate.?limit/i.test(s)) {
    return "模型服务当前比较繁忙（429），已自动重试仍未成功。请等 10–30 秒后点“重试”。";
  }
  if (/abort|timeout|超时/i.test(s)) {
    return "模型响应超时。问题较大或网络较慢时可以点“重试”；也可以把问题分成两步。";
  }
  if (/50[234]|fetch|ECONNREFUSED|Failed to fetch|网络/i.test(s)) {
    return "连接 AI 服务失败，请确认 node ai/server.mjs 正在运行。";
  }
  return s.slice(0, 240) || "未知错误";
}

const INTRO_OPTIONS = [
  {
    label: "黄酮类按科分布",
    prompt: "找出黄酮类分子，按来源科分布",
  },
  {
    label: "带我去根际",
    prompt: "带我去根际看看",
  },
  {
    label: "带我逛逛",
    random: true,
    title: "随机挑一颗分子，让小助手滑到右边讲讲",
  },
  {
    label: "找相似分子",
    prompt: "找和当前选中分子相似的分子",
    title: "先在世界树里选中一颗分子",
  },
  {
    label: "上传 PDF / CSV 试试",
    prompt: "上传一份 PDF、Word 或 CSV 试试",
  },
];

const CAPABILITIES = [
  {
    label: "自然语言查询",
    prompt: "找出分子量 300 到 500、来自菊科的天然产物",
  },
  {
    label: "自动图表",
    prompt: "找出生物碱类分子，按来源科分布并画图",
  },
  {
    label: "结构相似分子",
    prompt: "找和当前选中分子相似的分子",
    title: "先在世界树里选中一颗分子",
  },
  {
    label: "场景导览",
    tour: true,
    title: "让小助手滑动界面、讲解并拖动世界树",
  },
  {
    label: "带出处解释",
    prompt: "解释黄酮类分子的来源和分类，并注明 LOTUS 出处",
  },
];

export function mountAiDock(el, { scene } = {}) {
  if (!el) return null;

  el.innerHTML = `
    <div class="ai-dock-shell" id="aiShell">
      <div class="ai-dock-head">
        <span class="ai-dock-badge">✦</span>
        <span class="ai-dock-title">AI 分析</span>
        <span class="ai-dock-sub">世界树 · LOTUS</span>
        <span class="ai-dock-status"><i></i><b id="aiStatusBadge">连接中…</b></span>
        <button type="button" class="ai-dock-capabilities" id="aiIntroBtn" title="查看能力与示例">能力</button>
        <button type="button" class="ai-dock-collapse" id="aiCollapse">收起</button>
      </div>

      <div class="ai-dock-thread" id="aiThread">
        <div id="aiExample" class="ai-example">
          <div class="ai-msg ai-msg-ai ai-intro">
            <div class="ai-msg-head">
              <span class="ai-avatar">✦</span><b>AI 分析</b><em>世界树助手</em>
            </div>
            <p>你好，我是世界树 AI 分析助手。你可以直接用中文提问，我会先查 LOTUS 数据，再给你结果、图表和出处。</p>
            <div class="ai-capabilities">
              ${CAPABILITIES.map(
                (c) =>
                  `<button type="button" ${
                    c.tour
                      ? `data-ai-tour="1"`
                      : c.random
                        ? `data-ai-random="1"`
                        : `data-ai-suggest="${esc(c.prompt)}"`
                  }${c.title ? ` title="${esc(c.title)}"` : ""}>${esc(
                    c.label
                  )}</button>`
              ).join("")}
            </div>
            <p class="ai-intro-hint">想先试试？点一个能力，或者直接输入你的问题：</p>
            <div class="ai-intro-options">
              ${INTRO_OPTIONS.map(
                (o) =>
                  `<button type="button" ${
                    o.tour
                      ? `data-ai-tour="1"`
                      : o.random
                        ? `data-ai-random="1"`
                        : `data-ai-suggest="${esc(o.prompt)}"`
                  }${o.title ? ` title="${esc(o.title)}"` : ""}>${esc(
                    o.label
                  )}</button>`
              ).join("")}
            </div>
            <div class="ai-sources">数据来源：LOTUS frozen 260413 · 仅作科学传播，不构成用药建议</div>
          </div>
        </div>
      </div>

      <div class="ai-dock-pending" id="aiPending" hidden>
        <div class="ai-pending-text" id="aiPendingText"></div>
        <div class="ai-pending-buttons">
          <button type="button" class="primary" id="aiPendingConfirm">执行并收起对话</button>
          <button type="button" id="aiPendingCancel">先不执行</button>
        </div>
      </div>

      <div class="ai-dock-attach" id="aiAttach" hidden></div>

      <form class="ai-dock-input" id="aiForm">
        <span class="ai-dock-spark" aria-hidden="true">✦</span>
        <button type="button" class="ai-dock-upload" id="aiUpload" title="上传 PDF / Word / Excel / PPT / CSV / 文本">📎</button>
        <textarea id="aiInput" rows="1" placeholder="问点什么：例如「找出抗氧化的黄酮，按来源科分布」"></textarea>
        <button type="submit" class="ai-dock-send" id="aiSend" title="发送">↑</button>
      </form>

      <input type="file" id="aiFile" accept=".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.json,.txt,.md,.markdown,.html,.htm,.xml,.yaml,.yml,.log,.smi,.smiles,text/*,application/pdf,application/json" hidden />
    </div>`;

  const shell = el.querySelector("#aiShell");
  const thread = el.querySelector("#aiThread");
  const form = el.querySelector("#aiForm");
  const input = el.querySelector("#aiInput");
  const sendBtn = el.querySelector("#aiSend");
  const attach = el.querySelector("#aiAttach");
  const fileInput = el.querySelector("#aiFile");
  const suggestions = el.querySelector("#aiSuggestions");
  const collapseBtn = el.querySelector("#aiCollapse");
  const statusBadge = el.querySelector("#aiStatusBadge");
  const pendingEl = el.querySelector("#aiPending");
  const pendingText = el.querySelector("#aiPendingText");
  const pendingConfirm = el.querySelector("#aiPendingConfirm");
  const pendingCancel = el.querySelector("#aiPendingCancel");
  const chatHistory = [];
  let pendingAction = null;

  // 打开时的透明点击遮罩：只负责拦住背后交互 + 点击收起
  const backdrop = document.createElement("div");
  backdrop.className = "ai-dock-backdrop";
  backdrop.hidden = true;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setOpen(false);
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !el.classList.contains("is-open")) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    },
    true
  );

  let currentFile = null;
  let currentParsed = null;
  let parsePromise = null;
  let parseSeq = 0;
  let submitting = false;
  let answering = false;
  let openedOnce = false;
  let lastAttempt = null;

  /** 回答过程中禁用发送，避免重复提交/两条回答叠在一起 */
  function setAnswering(value) {
    answering = value;
    sendBtn.disabled = value;
    sendBtn.textContent = value ? "…" : "↑";
    sendBtn.title = value ? "AI 正在回答，请稍候" : "发送";
    form.classList.toggle("is-answering", value);
    input.setAttribute("aria-busy", value ? "true" : "false");
  }

  function markAiActive() {
    window.__aiLastActive = performance.now();
  }

  function setOpen(open) {
    el.classList.toggle("is-open", open);
    document.body.classList.toggle("ai-dock-open", open);
    backdrop.hidden = !open;
    if (open) markAiActive();
    if (open && !openedOnce) {
      openedOnce = true;
      thread.scrollTop = 0;
    }
    if (!open) input.blur();
  }

  function scrollBottom() {
    requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight;
    });
  }

  let lastGeom = "";

  function applyGeom(left, right, bottom) {
    const key = `${Math.round(left)}|${Math.round(right)}|${Math.round(bottom)}`;
    if (key === lastGeom) return;
    lastGeom = key;
    el.style.left = `${Math.round(left)}px`;
    el.style.right = `${Math.round(right)}px`;
    el.style.width = "auto";
    el.style.bottom = `${Math.round(bottom)}px`;
  }

  function syncGeometry() {
    const compact = window.matchMedia(
      "(max-width: 900px), (max-height: 520px)"
    ).matches;
    const rail = document.querySelector(".explore-rail");
    const detail = document.querySelector(".detail");
    const railRect = rail ? rail.getBoundingClientRect() : null;
    const detailRect = detail ? detail.getBoundingClientRect() : null;
    const vw = window.innerWidth;
    const railVisible = !!(
      railRect &&
      railRect.width > 20 &&
      railRect.right > 4
    );
    const detailVisible = !!(
      detailRect &&
      detailRect.width > 20 &&
      detailRect.left < vw - 4
    );
    const leftMargin = 60;
    const rightMargin = 24;
    // 手机/矮屏且左栏是抽屉（不可见）：通栏底部抽屉
    if (compact && !railVisible) {
      applyGeom(10, 10, 10);
      return;
    }
    if (railVisible || detailVisible) {
      const left = railVisible ? railRect.right + leftMargin : 12;
      const right = detailVisible ? vw - detailRect.left + rightMargin : 12;
      if (vw - left - right >= 260) {
        applyGeom(left, right, compact ? 10 : 16);
        return;
      }
    }
    // 左右栏都不可用：通栏
    applyGeom(10, 10, compact ? 10 : 16);
  }

  /** 选文件后立刻送到 AI 服务读文字，状态显示在 chip 上 */
  function parseFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () =>
        resolve({ ok: false, name: file.name, error: "本地读取失败" });
      reader.onload = async () => {
        try {
          const s = String(reader.result || "");
          const data = s.slice(s.indexOf(",") + 1);
          const res = await fetch("/api/ai/file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file.name, type: file.type, data }),
          });
          const out = await res.json().catch(() => ({}));
          if (!res.ok || !out.ok) {
            resolve({
              ok: false,
              name: file.name,
              kind: out.kind,
              error: out.error || `读取失败（HTTP ${res.status}）`,
            });
          } else {
            resolve({ ...out, name: file.name });
          }
        } catch (err) {
          resolve({
            ok: false,
            name: file.name,
            error: `读取失败：${String(err?.message || err).slice(0, 120)}`,
          });
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function showFile(file) {
    if (!file) return;
    markAiActive();
    input.placeholder = "问点什么：例如「总结这份文件的要点」";
    const seq = ++parseSeq;
    currentFile = file;
    currentParsed = null;
    parsePromise = null;
    attach.hidden = false;
    attach.innerHTML = `
      <span class="ai-file-icon">📄</span>
      <span class="ai-file-name">${esc(file.name)}</span>
      <em class="ai-file-status">读取中…</em>
      <button type="button" class="ai-file-remove" id="aiFileRemove" title="移除">×</button>`;
    attach.querySelector("#aiFileRemove").addEventListener("click", () => {
      parseSeq++;
      currentFile = null;
      currentParsed = null;
      parsePromise = null;
      attach.hidden = true;
      attach.innerHTML = "";
      fileInput.value = "";
      input.placeholder =
        "问点什么：例如「找出抗氧化的黄酮，按来源科分布」";
    });
    parsePromise = parseFile(file).then((res) => {
      if (seq !== parseSeq) return res;
      currentParsed = res;
      const status = attach.querySelector(".ai-file-status");
      if (status) {
        status.classList.toggle("is-ok", !!res.ok);
        status.classList.toggle("is-error", !res.ok);
        status.textContent = res.ok
          ? `已读取 ${Number(res.chars || 0).toLocaleString("zh-CN")} 字${
              res.truncated ? "（已截断）" : ""
            }`
          : res.error || "未能读取";
      }
      return res;
    });
  }

  function addUser(text, file, parsed) {
    const div = document.createElement("div");
    div.className = "ai-msg ai-msg-user";
    const fileLine =
      file
        ? `<div class="ai-msg-file">📄 ${esc(file.name)}${
            parsed?.ok
              ? ` · 已读取 ${Number(parsed.chars || 0).toLocaleString("zh-CN")} 字`
              : parsed?.error
                ? ` · ${esc(parsed.error)}`
                : ""
          }</div>`
        : "";
    div.innerHTML = `<p>${esc(text)}</p>${fileLine}`;
    thread.appendChild(div);
  }

  function addAiAnswer(text, file) {
    const div = document.createElement("div");
    div.className = "ai-msg ai-msg-ai";
    const fileLine = file
      ? `<div class="ai-tags"><span>📄 ${esc(file.name)}</span><span>${humanSize(
          file.size
        )}</span></div>`
      : "";
    div.innerHTML = `
      <div class="ai-msg-head">
        <span class="ai-avatar">✦</span><b>AI 分析</b><em>刚刚</em>
      </div>
      <p>${esc(text)}</p>
      ${fileLine}
      <div class="ai-tags"><span>界面演示</span><span>等待接入分析后端</span></div>
      <div class="ai-sources">接入后会显示：解析条件、工具调用、图表、数据出处</div>`;
    thread.appendChild(div);
    scrollBottom();
  }

  function mdInline(block) {
    return block
      .replace(/\n/g, "<br>")
      // 联网结果 / 文献出处：Markdown 链接
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      )
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function mdToHtml(text) {
    const safe = esc(text);
    return safe
      .split(/\n{2,}/)
      .map((block) => {
        // 行内标题：## 来自哪里（模型经常不空行，直接按行替换）
        const body = block
          .replace(/^#{1,4}\s+(.+)$/gm, '<span class="ai-md-h">$1</span>')
          .replace(/^[-*]\s+/gm, "• ");
        return `<p>${mdInline(body)}</p>`;
      })
      .join("");
  }

  function chartHtml(spec) {
    const data = (Array.isArray(spec?.data) ? spec.data : []).slice(0, 8);
    if (!data.length) return "";
    const max = Math.max(...data.map((d) => Number(d.value) || 0), 1);
    const bars = data
      .map((d) => {
        const h = Math.round(((Number(d.value) || 0) / max) * 88) + 4;
        return `<div class="ai-bar" style="--h:${h}%"><i></i><span>${esc(
          d.label
        )}</span><b>${esc(d.value)}</b></div>`;
      })
      .join("");
    return `<div class="ai-chart"><div class="ai-chart-head"><span>${esc(
      spec.title || "分布"
    )}</span><em>${esc(spec.y_label || "")}</em></div><div class="ai-bars">${bars}</div></div>`;
  }

  function createLiveMessage() {
    const div = document.createElement("div");
    div.className = "ai-msg ai-msg-ai";
    div.innerHTML = `
      <div class="ai-msg-head">
        <span class="ai-avatar">✦</span><b>AI 分析</b><em>刚刚</em>
      </div>
      <details class="ai-think" hidden>
        <summary><span>思考过程</span><em></em></summary>
        <div class="ai-think-body"></div>
      </details>
      <div class="ai-live-status">AI 正在分析…</div>
      <div class="ai-live-tools"></div>
      <div class="ai-live-cards"></div>
      <div class="ai-live-text"></div>
      <div class="ai-live-actions"></div>
      <div class="ai-sources">数据来源：LOTUS frozen 260413 · 仅作科学传播，不构成用药建议</div>`;
    thread.appendChild(div);
    return {
      div,
      status: div.querySelector(".ai-live-status"),
      tools: div.querySelector(".ai-live-tools"),
      cards: div.querySelector(".ai-live-cards"),
      text: div.querySelector(".ai-live-text"),
      actions: div.querySelector(".ai-live-actions"),
      think: div.querySelector(".ai-think"),
      thinkMeta: div.querySelector(".ai-think summary em"),
      thinkBody: div.querySelector(".ai-think-body"),
    };
  }

  function addSceneProposal(live, event) {
    const labels = {
      focus: "带我去看",
      highlight: "高亮显示",
      reset: "回到总览",
    };
    const action = event.action || "focus";
    const target = String(event.target || "").trim();
    const shortTarget =
      target.length > 48 ? `${target.slice(0, 48)}…` : target;
    pendingAction = { action, target };
    pendingText.textContent = `建议动作：${labels[action] || action}${
      shortTarget ? ` · ${shortTarget}` : ""
    }`;
    pendingConfirm.disabled = false;
    pendingCancel.disabled = false;
    pendingEl.hidden = false;
    if (live?.actions) {
      const note = document.createElement("div");
      note.className = "ai-note";
      note.textContent = "已生成场景动作建议，请在输入框上方确认。";
      live.actions.appendChild(note);
    }
  }

  function clearPending() {
    pendingAction = null;
    pendingEl.hidden = true;
    pendingText.textContent = "";
    pendingConfirm.disabled = false;
    pendingCancel.disabled = false;
  }

  pendingConfirm.addEventListener("click", () => {
    if (!pendingAction) return;
    const { action, target } = pendingAction;
    pendingConfirm.disabled = true;
    pendingCancel.disabled = true;
    clearPending();
    setOpen(false);
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("eco:ai-action", {
          detail: { action, target },
        })
      );
    }, 260);
  });
  pendingCancel.addEventListener("click", clearPending);

  function addToolChip(live, name, result) {
    const labels = {
      query_molecules: "查询 LOTUS",
      find_similar: "相似分子",
      render_chart: "生成图表",
      scene_action: "场景动作",
      explain: "读取元数据",
      web_search: "联网搜索",
    };
    let summary = "";
    if (name === "query_molecules" && result?.ok) {
      summary = `${result.count ?? 0} 颗`;
    } else if (name === "find_similar" && result?.ok) {
      summary = `${result.results?.length ?? 0} 个`;
    } else if (name === "render_chart") {
      summary = result?.spec?.title || "已生成";
    } else if (name === "scene_action") {
      summary = `${result?.action || ""}${
        result?.target ? ` · ${result.target}` : ""
      }`;
    } else if (name === "explain") {
      const names = (result?.molecules || [])
        .map((m) => m?.name)
        .filter(Boolean);
      summary = names.length
        ? `${names.slice(0, 2).join("、")}${
            names.length > 2 ? ` 等 ${names.length} 个` : ""
          }`
        : `${result?.molecules?.length ?? 0} 条`;
    } else if (name === "web_search" && result?.ok) {
      summary = `${result.engine || "网络"} · ${result.results?.length ?? 0} 条`;
    } else if (result?.error) {
      summary = String(result.error).slice(0, 60);
    }
    if (!live.tools.firstChild) {
      live.tools.innerHTML = `<div class="ai-trace"></div>`;
    }
    const span = document.createElement("span");
    span.textContent = `${labels[name] || name}${summary ? ` · ${summary}` : ""}`;
    live.tools.firstChild.appendChild(span);
  }

  function refreshAiBadge() {
    if (!statusBadge) return;
    fetch("/api/ai/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((d) => {
        statusBadge.textContent = d.hasKey
          ? `已连接 · ${d.model || d.provider}`
          : "本地演示 · 未配置 API";
      })
      .catch(() => {
        statusBadge.textContent = "AI 服务未启动";
      });
  }

  async function streamChat(userText, file, parsed) {
    const live = createLiveMessage();
    let finalText = "";
    let thinkText = "";
    let hadError = false;
    const addRetry = () => {
      if (live.text.querySelector(".ai-retry")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-retry";
      btn.textContent = "重试";
      btn.addEventListener("click", () => retryLast());
      live.text.appendChild(btn);
    };
    try {
      const selected = scene?.getSelected?.();
      const context = selected
        ? {
            selectedName: selected.nameZh,
            selectedInchikey: selected.inchikey,
          }
        : {};
      const payload = { messages: chatHistory, context };
      if (file && parsed?.ok && parsed.text) {
        payload.attachments = [
          {
            name: parsed.name || file.name,
            kind: parsed.kind,
            text: parsed.text,
            truncated: parsed.truncated,
          },
        ];
      }
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let event;
          try {
            event = JSON.parse(raw);
          } catch (_) {
            continue;
          }
          if (event.type === "status") {
            live.status.textContent = event.text || "AI 正在分析…";
          } else if (event.type === "think") {
            thinkText += event.text || "";
            live.think.hidden = false;
            live.thinkBody.textContent = thinkText;
            live.thinkMeta.textContent = `${thinkText.length.toLocaleString(
              "zh-CN"
            )} 字`;
          } else if (event.type === "delta") {
            finalText += event.text || "";
            live.text.innerHTML = mdToHtml(finalText);
            scrollBottom();
          } else if (event.type === "replace") {
            // 自动联网后重写整段回答，避免前面“查不到”的话留在界面上
            finalText = event.text || "";
            live.text.innerHTML = mdToHtml(finalText);
            scrollBottom();
          } else if (event.type === "tool") {
            addToolChip(live, event.name, event.result);
          } else if (event.type === "chart") {
            live.cards.insertAdjacentHTML("beforeend", chartHtml(event.spec));
          } else if (event.type === "scene") {
            addSceneProposal(live, event);
          } else if (event.type === "error") {
            hadError = true;
            live.status.textContent = "分析失败";
            live.text.insertAdjacentHTML(
              "beforeend",
              `<p class="ai-error">${esc(friendlyError(event.message))}</p>`
            );
          }
        }
      }
      live.status.remove();
      if (!finalText.trim() && !hadError) {
        live.text.innerHTML =
          "<p>（模型这次没有返回正文，可能是服务繁忙。点“重试”再试一次，或换个问法。）</p>";
      }
      if (finalText.trim() && !hadError) {
        chatHistory.push({ role: "assistant", content: finalText.trim() });
      }
      if (!finalText.trim() || hadError) addRetry();
      scrollBottom();
    } catch (err) {
      live.status.remove();
      const message = friendlyError(err?.message || err);
      live.text.innerHTML = `<p class="ai-error">${esc(message)}</p>`;
      if (live.tools.firstChild) {
        live.tools.firstChild.insertAdjacentHTML(
          "beforeend",
          "<span>请求失败</span>"
        );
      }
      addRetry();
      scrollBottom();
      console.warn("[ai-dock]", err);
    }
  }

  async function submit() {
    let text = input.value.trim();
    let file = currentFile;
    let parsed = currentParsed;
    if (!text && !file) {
      input.focus();
      return;
    }
    if (submitting || answering) return;
    setAnswering(true);
    try {
      // 文件还在解析时，等它读完再发，避免把“读取中”的空附件交出去
      if (file && !parsed && parsePromise) {
        submitting = true;
        await parsePromise;
        submitting = false;
        if (currentFile === file) parsed = currentParsed;
        else {
          file = currentFile;
          parsed = currentParsed;
        }
        if (!text && !file) {
          input.focus();
          return;
        }
      }
      markAiActive();
      setOpen(true);
      if (suggestions) suggestions.remove();
      clearPending();
      // 首条能力介绍保留在顶部，方便随时回来再看或再次选择
      const userText = text || `请阅读并分析这个文件：${file.name}`;
      addUser(userText, file, parsed);
      chatHistory.push({
        role: "user",
        content:
          userText +
          (file
            ? `\n[附件] ${file.name} (${humanSize(file.size)})${
                parsed?.ok
                  ? ` · 已读取 ${parsed.chars} 字`
                  : parsed?.error
                    ? ` · ${parsed.error}`
                    : ""
              }`
            : ""),
      });
      if (file) {
        currentFile = null;
        currentParsed = null;
        parsePromise = null;
        parseSeq++;
        attach.hidden = true;
        attach.innerHTML = "";
        fileInput.value = "";
        input.placeholder =
          "问点什么：例如「找出抗氧化的黄酮，按来源科分布」";
      }
      input.value = "";
      input.style.height = "auto";
      scrollBottom();
      lastAttempt = { userText, file, parsed };
      await streamChat(userText, file, parsed);
    } finally {
      submitting = false;
      setAnswering(false);
    }
  }

  /** 失败后重试上一次提问；chatHistory 里已有用户消息，不重复添加 */
  async function retryLast() {
    if (answering || !lastAttempt) return;
    setAnswering(true);
    try {
      await streamChat(
        lastAttempt.userText,
        lastAttempt.file,
        lastAttempt.parsed
      );
    } finally {
      setAnswering(false);
    }
  }

  // 小助手快捷方式：打开分析坞 / 直接提交一条分析请求
  window.addEventListener("eco:ai-open", () => {
    setOpen(true);
    setTimeout(() => input.focus(), 60);
  });
  window.addEventListener("eco:ai-ask", (e) => {
    const text = String(e.detail?.text || "").trim();
    if (!text) return;
    setOpen(true);
    input.value = text;
    submit();
    setTimeout(() => input.focus(), 60);
  });

  window.addEventListener("eco:ai-config-changed", refreshAiBadge);
  refreshAiBadge();

  el.querySelector("#aiIntroBtn")?.addEventListener("click", () => {
    setOpen(true);
    const intro = el.querySelector("#aiExample");
    if (!intro) return;
    thread.scrollTo({ top: 0, behavior: "smooth" });
    intro.classList.add("is-flash");
    setTimeout(() => intro.classList.remove("is-flash"), 900);
  });

  // 展开 / 收起
  input.addEventListener("focus", () => setOpen(true));
  collapseBtn.addEventListener("click", () => setOpen(false));
  shell.addEventListener("click", (e) => {
    if (e.target.closest("button, textarea, label")) return;
    if (!el.classList.contains("is-open")) {
      setOpen(true);
      input.focus();
    }
  });
  shell.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.classList.contains("is-open")) {
      e.stopPropagation();
      setOpen(false);
    }
  });

  // 输入
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    markAiActive();
    input.style.height = "auto";
    input.style.height = `${Math.min(120, input.scrollHeight)}px`;
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });

  // 上传
  el.querySelector("#aiUpload").addEventListener("click", () =>
    fileInput.click()
  );
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    showFile(f);
    setOpen(true);
    input.focus();
  });
  shell.addEventListener("dragover", (e) => {
    e.preventDefault();
    shell.classList.add("is-dragover");
  });
  shell.addEventListener("dragleave", () => shell.classList.remove("is-dragover"));
  shell.addEventListener("drop", (e) => {
    e.preventDefault();
    shell.classList.remove("is-dragover");
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      showFile(f);
      setOpen(true);
    }
  });

  // 建议 chips
  el.addEventListener("click", (e) => {
    const tour = e.target.closest("[data-ai-tour]");
    if (tour) {
      setOpen(false);
      setTimeout(() => scene?.startCompanionTour?.(), 320);
      return;
    }
    const random = e.target.closest("[data-ai-random]");
    if (random) {
      setOpen(false);
      setTimeout(() => scene?.startRandomCompanionNarration?.(), 320);
      return;
    }
    const chip = e.target.closest("[data-ai-suggest]");
    if (chip) {
      const text = chip.dataset.aiSuggest || "";
      if (text.includes("上传")) {
        fileInput.click();
        return;
      }
      input.value = text;
      submit();
      return;
    }
    const action = e.target.closest("[data-ai-action]");
    if (action) {
      const kind = action.dataset.aiAction;
      action.classList.add("is-done");
      const note = document.createElement("div");
      note.className = "ai-note";
      note.textContent =
        kind === "highlight"
          ? "示意：接入后会高亮匹配的星点"
          : "示意：接入后小助手会飞到该区域";
      const actions = action.closest(".ai-actions");
      if (actions && !actions.nextElementSibling?.classList?.contains("ai-note")) {
        actions.after(note);
      }
    }
  });

  const scheduleSync = () => requestAnimationFrame(syncGeometry);
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("eco:intro-done", scheduleSync);
  scheduleSync();
  // 入场/待机/展开会改变左右栏的位置或透明度，重新量一次
  if (typeof MutationObserver !== "undefined") {
    const mo = new MutationObserver(scheduleSync);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(scheduleSync);
    const rail = document.querySelector(".explore-rail");
    const detail = document.querySelector(".detail");
    if (rail) {
      ro.observe(rail);
      rail.addEventListener("transitionend", scheduleSync);
    }
    if (detail) {
      ro.observe(detail);
      detail.addEventListener("transitionend", scheduleSync);
    }
  }
  // 兜底：入场动画/缩放结束后再校准一次
  setTimeout(scheduleSync, 900);
  setTimeout(scheduleSync, 2800);
  // 持续兜底：栏位缩放、抽屉、窗口缩放等任何布局变化都能跟上
  setInterval(() => {
    if (!document.body.classList.contains("idle")) syncGeometry();
  }, 500);

  return { setOpen, syncGeometry };
}
