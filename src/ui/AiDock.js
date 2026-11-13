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
  if (/请求过于频繁|并行请求过多|演示请求较多|请求较多/i.test(s)) {
    return s.slice(0, 160) || "当前请求较多，请稍后再试。";
  }
  if (/429|1305|访问量过大|繁忙|overload|rate.?limit/i.test(s)) {
    return "模型服务当前比较繁忙（429），已自动重试仍未成功。请等 10–30 秒后点“重试”。";
  }
  if (/abort|timeout|超时/i.test(s)) {
    return "模型响应超时。问题较大或网络较慢时可以点“重试”；也可以把问题分成两步。";
  }
  if (/请求体过大|payload too large|entity too large|HTTP 413/i.test(s)) {
    return "图片或附件太大，单次请求上限约 24MB。请压缩图片或减少数量后重试。";
  }
  if (/50[234]|Bad Gateway|Service Unavailable|Gateway Timeout/i.test(s)) {
    return "AI 上游模型服务暂时不可用（5xx），请等 10–30 秒后点“重试”。";
  }
  if (/ECONNREFUSED|Failed to fetch|NetworkError|fetch failed|Load failed|网络/i.test(s)) {
    return "连接本地 AI 代理失败，请确认服务正在运行（./start.sh status 或 node ai/server.mjs）。";
  }
  return s.slice(0, 240) || "未知错误";
}

/** 聊天请求失败时先探一下 /api/ai/health，避免把上游 5xx 误报成“服务未启动” */
async function friendlyChatError(err) {
  const raw = String(err?.message || err);
  if (/请求体过大|payload too large|entity too large|HTTP 413/i.test(raw)) {
    return "图片或附件太大，单次请求上限约 24MB。请压缩图片或减少数量后重试。";
  }
  if (
    /50[234]|ECONNREFUSED|Failed to fetch|NetworkError|fetch failed|Load failed|网络/i.test(
      raw
    )
  ) {
    try {
      const res = await fetch("/api/ai/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        return "AI 代理正在运行，但本轮聊天连接失败（可能是上游 5xx 或网络抖动）。请等 10–30 秒后点“重试”。";
      }
    } catch (_) {
      // 健康检查也失败，说明本地代理确实不可用
    }
    return "连接 AI 服务失败，请确认 node ai/server.mjs 正在运行（可用 ./start.sh status 检查）。";
  }
  return friendlyError(raw);
}

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
    label: "识图",
    image: true,
    title: "上传结构式、论文图表或实验照片，先识别再查 LOTUS",
  },
  {
    label: "场景导览",
    tour: true,
    title: "让小助手滑动界面、讲解并拖动世界树",
  },
  {
    label: "穿梭群星",
    shuttle: true,
    title: "让小助手带着镜头贴近星点、穿过星云，掠过冠层和根际",
  },
  {
    label: "带出处解释",
    prompt: "解释黄酮类分子的来源和分类，并注明 LOTUS 出处",
  },
  {
    label: "论文 / DOI 检索",
    prompt: "检索槲皮素 quercetin 近五年的论文，给出标题、期刊、年份和 DOI",
    title: "OpenAlex / Crossref / Europe PMC；知网、万方、Nature、WoS 提供检索入口",
  },
  {
    label: "研究任务",
    research: true,
    title: "多步规划、工具执行，并生成可导出的研究简报",
  },
];

const TOOL_LABELS = {
  query_molecules: "查询 LOTUS",
  find_similar: "相似分子",
  render_chart: "生成图表",
  scene_action: "场景动作",
  explain: "读取元数据",
  web_search: "联网搜索",
  search_papers: "论文检索",
  list_research_sources: "查看数据源",
  search_knowledge: "检索知识库",
  analyze_table: "分析表格",
};

const LAST_RESEARCH_KEY = "worldtree:last-research:v1";
const SESSION_STORAGE_KEY = "worldtree:session:v1";

/** 匿名会话 ID：用于服务端保存最近一次研究，不含个人信息 */
function getSessionId() {
  try {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (/^[A-Za-z0-9_-]{16,64}$/.test(saved || "")) return saved;
    const raw =
      (globalThis.crypto?.randomUUID?.() ||
        `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`) +
      Math.random().toString(36).slice(2);
    const id = raw.replace(/-/g, "").slice(0, 40);
    localStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch (_) {
    return "";
  }
}

function sessionHeaders(extra = {}) {
  const id = getSessionId();
  return id ? { ...extra, "x-ai-session": id } : extra;
}

function loadLastResearch() {
  try {
    const raw = localStorage.getItem(LAST_RESEARCH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.plan?.goal || !Array.isArray(data?.plan?.steps)) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function writeLocalResearch(data) {
  try {
    localStorage.setItem(LAST_RESEARCH_KEY, JSON.stringify(data));
  } catch (_) {
    // 浏览器禁用 localStorage 或空间不足时静默失败，不影响当前对话
  }
}

function saveLastResearch(data) {
  writeLocalResearch(data);
  // 服务端副本：换设备 / 清缓存后仍能「继续上次」
  try {
    fetch("/api/ai/session/last", {
      method: "POST",
      headers: sessionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(data),
    }).catch(() => {});
  } catch (_) {}
}

/** 启动时用服务端副本补齐本地缓存（服务端更新才覆盖） */
async function syncResearchFromServer() {
  try {
    const res = await fetch("/api/ai/session/last", {
      headers: sessionHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const remote = data?.session;
    if (!remote?.plan?.goal || !Array.isArray(remote.plan.steps)) return false;
    const local = loadLastResearch();
    if (local && Number(local.ts || 0) >= Number(remote.ts || 0)) return false;
    writeLocalResearch(remote);
    return true;
  } catch (_) {
    return false;
  }
}

export function mountAiDock(el, { scene } = {}) {
  if (!el) return null;

  el.innerHTML = `
    <div class="ai-dock-shell" id="aiShell">
      <div class="ai-dock-head">
        <span class="ai-dock-badge">✦</span>
        <span class="ai-dock-title">AI 分析</span>
        <span class="ai-dock-sub">世界树 · LOTUS</span>
        <span class="ai-dock-status"><i></i><b id="aiStatusBadge">连接中…</b></span>
        <button type="button" class="ai-dock-kb" id="aiKbBtn" title="上传文档，回答时自动检索引用">知识库<b id="aiKbCount">0</b></button>
        <button type="button" class="ai-dock-continue" id="aiContinueBtn" title="恢复上次研究任务" hidden>继续上次</button>
        <button type="button" class="ai-dock-capabilities" id="aiIntroBtn" title="查看能力与示例">能力</button>
        <button type="button" class="ai-dock-collapse" id="aiCollapse">收起</button>
      </div>

      <div class="ai-kb-panel" id="aiKbPanel" hidden>
        <div class="ai-kb-panel-head">
          <b>知识库</b>
          <span>系统：LOTUS / 论文 / 权威网站 · 我的文档上传后自动向量化</span>
          <button type="button" class="ai-kb-close" id="aiKbClose" title="关闭">×</button>
        </div>
        <div class="ai-kb-actions">
          <button type="button" class="ai-kb-upload-btn" id="aiKbUpload">＋ 上传文档</button>
          <button type="button" class="ai-kb-upload-btn" id="aiKbReembed" title="切换向量模型后，用当前配置重建全部文档向量">重建向量</button>
          <em id="aiKbHint">支持 PDF / Word / Excel / PPT / CSV / TXT</em>
        </div>
        <div class="ai-kb-list" id="aiKbList"></div>
      </div>

      <div class="ai-dock-thread" id="aiThread">
        <div id="aiExample" class="ai-example">
          <div class="ai-msg ai-msg-ai ai-intro">
            <div class="ai-msg-head">
              <span class="ai-avatar">✦</span><b>AI 分析</b><em>世界树助手</em>
            </div>
            <div class="ai-hero">
              <div class="ai-hero-kicker">AI 研究台</div>
              <h2>从 22.7 万条 LOTUS 结构开始</h2>
              <p>查数据、读论文、识图、分析表格，最后导出可核对的研究简报。</p>
              <div class="ai-hero-tasks">
                <button type="button" data-ai-suggest="找出黄酮类分子，按来源科分布并画图">
                  <b>查数据</b><span>黄酮类按科分布</span>
                </button>
                <button type="button" data-ai-suggest="检索槲皮素 quercetin 近五年的论文，给出标题、期刊、年份和 DOI">
                  <b>读论文</b><span>检索 DOI 与期刊</span>
                </button>
                <button type="button" data-ai-image="1">
                  <b>识图</b><span>结构式 / 植物照片</span>
                </button>
                <button type="button" data-ai-upload="1">
                  <b>分析表格</b><span>CSV / Excel 统计</span>
                </button>
              </div>
            </div>
            <p>你好，我是世界树 AI 分析助手。你可以直接用中文提问，我会先查 LOTUS 数据，再给你结果、图表和出处。</p>
            <div class="ai-capabilities">
              ${CAPABILITIES.map(
                (c) =>
                  `<button type="button" ${
                    c.shuttle
                      ? `data-ai-shuttle="1"`
                      : c.image
                        ? `data-ai-image="1"`
                        : c.tour
                        ? `data-ai-tour="1"`
                        : c.kb
                          ? `data-ai-kb="1"`
                          : c.random
                            ? `data-ai-random="1"`
                            : c.research
                              ? `data-ai-research="1"`
                              : `data-ai-suggest="${esc(c.prompt)}"`
                  }${c.title ? ` title="${esc(c.title)}"` : ""}>${esc(
                    c.label
                  )}</button>`
              ).join("")}
            </div>
            <div class="ai-sources">数据来源：LOTUS frozen 260413 · 论文：OpenAlex / Crossref / Europe PMC · 仅作科学传播，不构成用药建议</div>
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
        <button type="button" class="ai-dock-mode" id="aiResearchMode" aria-pressed="false" title="多步规划、工具执行并生成可导出的研究简报">研究</button>
        <button type="button" class="ai-dock-stop" id="aiStop" title="停止本轮回答" hidden>■</button>
        <button type="submit" class="ai-dock-send" id="aiSend" title="发送">↑</button>
      </form>

      <input type="file" id="aiFile" accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.xlsx,.pptx,.csv,.tsv,.json,.txt,.md,.markdown,.html,.htm,.xml,.yaml,.yml,.log,.smi,.smiles,text/*,application/pdf,application/json" hidden />
      <input type="file" id="aiKbFile" accept=".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.json,.txt,.md,.markdown,.html,.htm,.xml,.yaml,.yml,.log,.smi,.smiles,text/*,application/pdf,application/json" hidden />
    </div>`;

  const shell = el.querySelector("#aiShell");
  const thread = el.querySelector("#aiThread");
  const form = el.querySelector("#aiForm");
  const input = el.querySelector("#aiInput");
  const sendBtn = el.querySelector("#aiSend");
  const researchBtn = el.querySelector("#aiResearchMode");
  const stopBtn = el.querySelector("#aiStop");
  const attach = el.querySelector("#aiAttach");
  const fileInput = el.querySelector("#aiFile");
  const kbBtn = el.querySelector("#aiKbBtn");
  const kbPanel = el.querySelector("#aiKbPanel");
  const kbList = el.querySelector("#aiKbList");
  const kbCount = el.querySelector("#aiKbCount");
  const kbFile = el.querySelector("#aiKbFile");
  const kbReembed = el.querySelector("#aiKbReembed");
  const suggestions = el.querySelector("#aiSuggestions");
  const collapseBtn = el.querySelector("#aiCollapse");
  const continueBtn = el.querySelector("#aiContinueBtn");
  const statusBadge = el.querySelector("#aiStatusBadge");
  const pendingEl = el.querySelector("#aiPending");
  const pendingText = el.querySelector("#aiPendingText");
  const pendingConfirm = el.querySelector("#aiPendingConfirm");
  const pendingCancel = el.querySelector("#aiPendingCancel");
  const chatHistory = [];
  let pendingAction = null;
  let researchMode = false;
  let activeAbort = null;

  function refreshContinueBtn() {
    if (continueBtn) continueBtn.hidden = !loadLastResearch();
  }

  function setResearchMode(value) {
    researchMode = !!value;
    researchBtn?.classList.toggle("is-active", researchMode);
    researchBtn?.setAttribute("aria-pressed", String(researchMode));
    if (researchMode) {
      input.placeholder =
        "研究任务：例如「对比黄酮和生物碱的来源科分布，并给出可引用简报」";
    } else {
      input.placeholder = "问点什么：例如「找出抗氧化的黄酮，按来源科分布」";
    }
  }

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
    if (stopBtn) stopBtn.hidden = !value;
    form.classList.toggle("is-answering", value);
    input.setAttribute("aria-busy", value ? "true" : "false");
  }

  stopBtn?.addEventListener("click", () => {
    activeAbort?.abort();
  });

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

  function isImageFile(file) {
    return !!file?.type && /^image\/(png|jpe?g|webp|gif)$/i.test(file.type);
  }

  /** 选文件后立刻送到 AI 服务读文字，状态显示在 chip 上 */
  function parseFile(file) {
    if (isImageFile(file)) {
      return new Promise((resolve) => {
        if (file.size > 8 * 1024 * 1024) {
          resolve({
            ok: false,
            name: file.name,
            error: "图片超过 8MB，请压缩后再上传",
          });
          return;
        }
        const reader = new FileReader();
        reader.onerror = () =>
          resolve({ ok: false, name: file.name, error: "本地读取失败" });
        reader.onload = () =>
          resolve({
            ok: true,
            kind: "image",
            name: file.name,
            type: file.type,
            dataUrl: String(reader.result || ""),
            chars: 0,
            size: file.size,
          });
        reader.readAsDataURL(file);
      });
    }
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
    const image = isImageFile(file);
    input.placeholder = image
      ? "问点什么：例如「这是什么分子？」"
      : "问点什么：例如「总结这份文件的要点」";
    const seq = ++parseSeq;
    currentFile = file;
    currentParsed = null;
    parsePromise = null;
    attach.hidden = false;
    attach.innerHTML = `
      <span class="ai-file-icon">${image ? "🖼" : "📄"}</span>
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
      input.placeholder = researchMode
        ? "研究任务：例如「对比黄酮和生物碱的来源科分布，并给出可引用简报」"
        : "问点什么：例如「找出抗氧化的黄酮，按来源科分布」";
    });
    parsePromise = parseFile(file).then((res) => {
      if (seq !== parseSeq) return res;
      currentParsed = res;
      const status = attach.querySelector(".ai-file-status");
      if (status) {
        status.classList.toggle("is-ok", !!res.ok);
        status.classList.toggle("is-error", !res.ok);
        status.textContent = res.ok
          ? res.kind === "image"
            ? `图片 · ${humanSize(file.size)}`
            : `已读取 ${Number(res.chars || 0).toLocaleString("zh-CN")} 字${
                res.truncated ? "（已截断）" : ""
              }`
          : res.error || "未能读取";
      }
      if (res.ok && res.kind === "image" && res.dataUrl) {
        const icon = attach.querySelector(".ai-file-icon");
        if (icon) {
          icon.outerHTML = `<img class="ai-file-thumb" src="${res.dataUrl}" alt="">`;
        }
      }
      return res;
    });
  }

  function addUser(text, file, parsed) {
    const div = document.createElement("div");
    div.className = "ai-msg ai-msg-user";
    const image =
      parsed?.kind === "image" && /^data:image\//i.test(parsed.dataUrl || "");
    const fileLine = image
      ? `<img class="ai-msg-image" src="${parsed.dataUrl}" alt="${esc(
          file.name
        )}"><div class="ai-msg-file">🖼 ${esc(file.name)} · ${humanSize(
          file.size
        )}</div>`
      : file
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
      <div class="ai-plan" hidden></div>
      <div class="ai-live-status">AI 正在分析…</div>
      <div class="ai-live-tools"></div>
      <div class="ai-live-cards"></div>
      <div class="ai-live-text"></div>
      <div class="ai-live-actions"></div>
      <div class="ai-sources">数据来源：LOTUS frozen 260413 · 论文：OpenAlex / Crossref / Europe PMC · 仅作科学传播，不构成用药建议</div>`;
    thread.appendChild(div);
    return {
      div,
      status: div.querySelector(".ai-live-status"),
      plan: div.querySelector(".ai-plan"),
      tools: div.querySelector(".ai-live-tools"),
      cards: div.querySelector(".ai-live-cards"),
      text: div.querySelector(".ai-live-text"),
      actions: div.querySelector(".ai-live-actions"),
      think: div.querySelector(".ai-think"),
      thinkMeta: div.querySelector(".ai-think summary em"),
      thinkBody: div.querySelector(".ai-think-body"),
      sources: [],
      toolLog: [],
      charts: [],
    };
  }

  function renderPlan(live, event) {
    if (!live?.plan || !Array.isArray(event?.steps) || !event.steps.length) {
      return;
    }
    live._plan = {
      goal: String(event.goal || "研究任务"),
      steps: event.steps.map((s) => ({
        title: String(s.title || "研究步骤"),
        tool: String(s.tool || "none"),
      })),
    };
    live.plan.hidden = false;
    live.plan.innerHTML = `
      <div class="ai-plan-head">
        <span>研究计划</span>
        <b>${esc(live._plan.goal)}</b>
      </div>
      <ol class="ai-plan-steps">
        ${live._plan.steps
          .map(
            (s, i) => `<li data-step="${i}" class="is-pending">
              <i></i><span>${esc(s.title)}</span>
              <em>${esc(TOOL_LABELS[s.tool] || (s.tool === "none" ? "整理" : s.tool))}</em>
            </li>`
          )
          .join("")}
      </ol>`;
    scrollBottom();
  }

  function renderVision(live, analysis) {
    if (!live?.cards || !analysis) return;
    live.vision = analysis;
    const rows = [];
    const families = (analysis.family_candidates || [])
      .map((c) => `${c.name} ${Math.round((Number(c.confidence) || 0) * 100)}%`)
      .join("、");
    const molecules = (analysis.molecule_candidates || [])
      .map((c) => `${c.name} ${Math.round((Number(c.confidence) || 0) * 100)}%`)
      .join("、");
    if (families) rows.push(["科属候选", families]);
    if (molecules) rows.push(["分子候选", molecules]);
    if (analysis.structure_features?.length) {
      rows.push(["结构特征", analysis.structure_features.join("、")]);
    }
    const confidence = Math.round(
      (Number(analysis.overall_confidence) || 0) * 100
    );
    const card = document.createElement("div");
    card.className = "ai-vision-card";
    card.innerHTML = `
      <div class="ai-vision-head">
        <span>图像结构化</span>
        <em>${esc(analysis.image_type || "other")} · 置信度 ${confidence}%</em>
      </div>
      ${analysis.subject ? `<p class="ai-vision-subject">${esc(analysis.subject)}</p>` : ""}
      ${rows
        .map(
          ([label, value]) =>
            `<div class="ai-vision-row"><b>${esc(label)}</b><span>${esc(
              value
            )}</span></div>`
        )
        .join("")}
      ${
        analysis.uncertain?.length
          ? `<details class="ai-vision-uncertain"><summary>不确定项 ${analysis.uncertain.length} 条</summary><p>${esc(
              analysis.uncertain.join("；")
            )}</p></details>`
          : ""
      }`;
    live.cards.appendChild(card);
  }

  function renderReflection(live, reflection) {
    if (!live?.cards || !reflection) return;
    live.reflection = reflection;
    const card = document.createElement("div");
    card.className = "ai-reflection";
    card.innerHTML = `
      <div class="ai-reflection-head">
        <span>研究反思</span>
        <em>${reflection.needs_replan ? "建议重规划" : "已核对"}</em>
      </div>
      <p>${esc(reflection.summary || "")}</p>
      ${
        reflection.issues?.length
          ? `<ul>${reflection.issues
              .slice(0, 5)
              .map((x) => `<li>${esc(x)}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${
        reflection.next_steps?.length
          ? `<div class="ai-reflection-next"><b>下一步</b>${reflection.next_steps
              .slice(0, 4)
              .map((x) => `<span>${esc(x)}</span>`)
              .join("")}</div>`
          : ""
      }`;
    if (reflection.next_steps?.length) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-reflection-continue";
      btn.textContent = "按建议继续";
      btn.addEventListener("click", () => {
        setResearchMode(true);
        setOpen(true);
        input.value = `继续上次研究：${
          reflection.plan_goal || live._plan?.goal || ""
        }。请按以下建议继续：${reflection.next_steps
          .slice(0, 4)
          .join("；")}`;
        submit();
      });
      card.appendChild(btn);
    }
    live.cards.appendChild(card);
  }

  function restoreLastResearch() {
    const last = loadLastResearch();
    if (!last) {
      refreshContinueBtn();
      return;
    }
    chatHistory.splice(
      0,
      chatHistory.length,
      ...(Array.isArray(last.history) ? last.history : [])
        .filter((m) => m?.role === "user" || m?.role === "assistant")
        .slice(-12)
        .map((m) => ({
          role: m.role,
          content: String(m.content || "").slice(0, 4000),
        }))
    );
    setResearchMode(true);
    setOpen(true);
    const live = createLiveMessage();
    live.status?.remove();
    if (last.vision) renderVision(live, last.vision);
    renderPlan(live, { goal: last.plan.goal, steps: last.plan.steps });
    live.plan?.querySelectorAll("li").forEach((li) => {
      li.classList.remove("is-pending", "is-running", "is-error");
      li.classList.add("is-done");
    });
    if (last.reflection) renderReflection(live, last.reflection);
    live.text.innerHTML = mdToHtml(
      `已恢复上次研究：**${last.plan.goal}**\n\n${
        last.answer
          ? `上次结论摘要：${String(last.answer).slice(0, 800)}${
              String(last.answer).length > 800 ? "…" : ""
            }`
          : "上次没有保存正文。"
      }`
    );
    const cont = document.createElement("button");
    cont.type = "button";
    cont.className = "ai-report-btn";
    cont.textContent = "继续追问";
    cont.addEventListener("click", () => {
      input.focus();
      input.placeholder = "继续追问这次研究…";
    });
    const redo = document.createElement("button");
    redo.type = "button";
    redo.className = "ai-report-btn";
    redo.textContent = "重新执行";
    redo.addEventListener("click", () => {
      chatHistory.length = 0;
      input.value = String(last.userText || last.plan.goal || "");
      submit();
    });
    live.actions.append(cont, redo);
    scrollBottom();
  }

  function updatePlanStep(live, event) {
    const li = live?.plan?.querySelector(
      `[data-step="${Number(event?.index)}"]`
    );
    if (!li) return;
    const status = ["running", "done", "error"].includes(event.status)
      ? event.status
      : "pending";
    li.classList.remove("is-pending", "is-running", "is-done", "is-error");
    li.classList.add(`is-${status}`);
    if (event.detail) {
      const em = li.querySelector("em");
      if (em) em.textContent = String(event.detail).slice(0, 60);
    }
  }

  function finishPlan(live) {
    if (!live?.plan || live.plan.hidden) return;
    live.plan.querySelectorAll("li.is-running").forEach((li) => {
      li.classList.remove("is-running");
      li.classList.add("is-done");
    });
    live.plan.querySelectorAll("li.is-pending").forEach((li) => {
      li.classList.remove("is-pending");
      li.classList.add("is-skipped");
    });
  }

  function addReportButton(live, payload) {
    if (!live?.actions || !live._plan) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ai-report-btn";
    btn.textContent = "导出研究简报";
    btn.title = "下载 Markdown：问题、计划、结论、工具记录与来源";
    btn.addEventListener("click", () => downloadReport(payload));
    live.actions.appendChild(btn);
  }

  function downloadReport({
    userText,
    answer,
    plan,
    vision,
    reflection,
    sources,
    tools,
    charts,
  }) {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    const visionLines = [];
    if (vision) {
      visionLines.push(
        `- 图像类型：${vision.image_type || "other"}`,
        `- 主体：${vision.subject || "未给出"}`,
        `- 总体置信度：${Math.round(
          (Number(vision.overall_confidence) || 0) * 100
        )}%`
      );
      const families = (vision.family_candidates || [])
        .map((x) => `${x.name}（${Math.round((Number(x.confidence) || 0) * 100)}%）`)
        .join("、");
      const molecules = (vision.molecule_candidates || [])
        .map((x) => `${x.name}（${Math.round((Number(x.confidence) || 0) * 100)}%）`)
        .join("、");
      if (families) visionLines.push(`- 科属候选：${families}`);
      if (molecules) visionLines.push(`- 分子候选：${molecules}`);
      if (vision.structure_features?.length) {
        visionLines.push(`- 结构特征：${vision.structure_features.join("、")}`);
      }
      if (vision.uncertain?.length) {
        visionLines.push(`- 不确定项：${vision.uncertain.join("；")}`);
      }
    }
    const reflectionLines = [];
    if (reflection) {
      reflectionLines.push(`- 判断：${reflection.summary || ""}`);
      for (const item of reflection.issues || []) {
        reflectionLines.push(`- 局限：${item}`);
      }
      for (const item of reflection.next_steps || []) {
        reflectionLines.push(`- 下一步：${item}`);
      }
    }
    const chartLines = [];
    for (const c of charts || []) {
      chartLines.push(`### ${c.title || "图表"}`, "");
      if (Array.isArray(c.data) && c.data.length) {
        chartLines.push("| 项目 | 数值 |", "| --- | --- |");
        for (const row of c.data.slice(0, 20)) {
          chartLines.push(`| ${row.label} | ${row.value} |`);
        }
      } else {
        chartLines.push(`（${c.type || "chart"}，无表格数据）`);
      }
      chartLines.push("");
    }
    const sourceLines = [];
    const seenSources = new Set();
    for (const s of sources || []) {
      const key = `${s.url || ""}|${s.name || ""}|${s.chunk || ""}`;
      if (seenSources.has(key)) continue;
      seenSources.add(key);
      if (s.url) {
        const meta = [s.year, s.journal].filter(Boolean).join(", ");
        sourceLines.push(
          `- 【${s.tag || s.sourceType || "资料"}】${s.name || s.url}${
            meta ? `（${meta}）` : ""
          } — ${s.url}`
        );
      } else if (s.sourceType === "paper") {
        const meta = [s.year, s.journal].filter(Boolean).join(", ");
        sourceLines.push(
          `- 【${s.tag || "论文"}】${s.name}${meta ? `（${meta}）` : ""}`
        );
      } else if (s.name) {
        sourceLines.push(
          `- 【${s.tag || s.sourceType || "资料"}】《${s.name}》第 ${
            s.chunk ?? "?"
          } 段${
            s.score != null
              ? `（相关度 ${Math.round(Number(s.score) * 100)}%）`
              : ""
          }`
        );
      }
    }
    const lines = [
      `# 世界树研究简报：${plan?.goal || userText.slice(0, 60)}`,
      "",
      `- 生成时间：${now.toLocaleString("zh-CN")}`,
      `- 数据底座：LOTUS frozen 260413`,
      `- 说明：仅作科学传播与教学演示，不构成用药建议。`,
      "",
      "## 研究问题",
      "",
      userText,
      "",
      "## 研究计划",
      "",
      ...(plan?.steps || []).map(
        (s, i) =>
          `${i + 1}. ${s.title}${s.tool && s.tool !== "none" ? `（${TOOL_LABELS[s.tool] || s.tool}）` : ""}`
      ),
      "",
      ...(visionLines.length
        ? ["## 图像结构化", "", ...visionLines, ""]
        : []),
      "## 结论",
      "",
      answer || "（本轮没有生成正文）",
      "",
      ...(reflectionLines.length
        ? ["## 研究反思", "", ...reflectionLines, ""]
        : []),
      "## 工具记录",
      "",
      ...(tools?.length
        ? tools.map((t) => `- ${t.name}：${t.summary || "已执行"}`)
        : ["- 无"]),
      "",
      "## 图表",
      "",
      ...(chartLines.length ? chartLines : ["- 无", ""]),
      "## 来源",
      "",
      ...(sourceLines.length
        ? sourceLines
        : ["- 本轮没有可结构化的引用；LOTUS 统计以工具返回为准。"]),
      "",
      "---",
      "",
      "由「世界树 · LOTUS AI 分析」生成。论文/网站引用请回到对话中的原始链接核对。",
      "",
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `世界树研究简报-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  /** 论文检索入口：知网/万方/Nature/WoS 直接点开，不把入口伪装成已检索结果 */
  function addPaperLinks(live, result) {
    const links = Array.isArray(result?.links) ? result.links : [];
    live._paperLinks ||= new Set();
    live._paperSources ||= new Set();
    let box = live.cards.querySelector(".ai-paper-links");
    if (links.length && !box) {
      box = document.createElement("div");
      box.className = "ai-paper-links";
      box.innerHTML = `<div class="ai-paper-links-head">文献检索入口</div>`;
      live.cards.appendChild(box);
    }
    for (const link of links) {
      const url = String(link?.url || "").trim();
      if (!/^https?:\/\//i.test(url) || live._paperLinks.has(url)) continue;
      live._paperLinks.add(url);
      const a = document.createElement("a");
      a.className = "ai-paper-link";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = `<span>${esc(
        link.label || link.source || "文献"
      )}</span><em>${esc(link.note || "")}</em>`;
      box.appendChild(a);
    }
    const papers = [
      ...(Array.isArray(result?.results) ? result.results : []).map((p) => ({
        ...p,
        tag: "论文",
      })),
      ...(Array.isArray(result?.alternatives) ? result.alternatives : []).map(
        (p) => ({ ...p, tag: "公开替代" })
      ),
    ].slice(0, 8);
    for (const paper of papers) {
      const name = String(paper.title || paper.name || "").trim();
      const doi = String(paper.doi || "").trim();
      const url = String(
        doi
          ? /^https?:\/\//i.test(doi)
            ? doi
            : `https://doi.org/${doi.replace(/^doi:\s*/i, "")}`
          : paper.url || ""
      ).trim();
      const key = `${name}|${url}`;
      if (!name || live._paperSources.has(key)) continue;
      live._paperSources.add(key);
      live.sources.push({
        tag: paper.tag || "论文",
        sourceType: "paper",
        name,
        url,
        year: paper.year || "",
        journal: paper.journal || "",
        snippet: paper.abstract || paper.snippet || "",
      });
    }
  }

  function addWebSources(live, result) {
    const rows = Array.isArray(result?.results) ? result.results : [];
    live._webSources ||= new Set();
    for (const row of rows.slice(0, 6)) {
      const url = String(row.url || "").trim();
      const name = String(row.title || url).trim();
      const key = `${name}|${url}`;
      if (!url || live._webSources.has(key)) continue;
      live._webSources.add(key);
      live.sources.push({
        tag: "网站",
        sourceType: "website",
        name,
        url,
        snippet: row.snippet || "",
      });
    }
  }

  function addToolChip(live, name, result) {
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
      addWebSources(live, result);
    } else if (name === "search_papers" && result?.ok) {
      const n = result.results?.length ?? 0;
      const alt = result.alternatives?.length ?? 0;
      summary = `${result.sourceLabel || "论文"} · ${
        n || (alt ? `公开替代 ${alt} 篇` : "检索入口")
      }`;
      addPaperLinks(live, result);
    } else if (name === "list_research_sources" && result?.ok) {
      summary = `${result.sources?.length ?? 0} 个源`;
    } else if (name === "search_knowledge" && result?.ok) {
      summary = `${result.count ?? 0} 段`;
    } else if (name === "analyze_table" && result?.ok) {
      summary = `${result.rows ?? 0} 行${
        result.group_by ? ` · 按${result.group_by}` : ""
      }`;
    } else if (result?.error) {
      summary = String(result.error).slice(0, 60);
    }
    if (!live.tools.firstChild) {
      live.tools.innerHTML = `<div class="ai-trace"></div>`;
    }
    const span = document.createElement("span");
    span.textContent = `${TOOL_LABELS[name] || name}${summary ? ` · ${summary}` : ""}`;
    live.tools.firstChild.appendChild(span);
    live.toolLog.push({
      name: TOOL_LABELS[name] || name,
      summary: summary || (result?.ok === false ? "失败" : "已执行"),
    });
  }

  /** 知识库引用：按 文档 + 段落 去重，折叠显示原文片段 */
  function addSources(live, items) {
    if (!Array.isArray(items) || !items.length) return;
    live._kbKeys ||= new Set();
    let box = live.cards.querySelector(".ai-kb-sources");
    if (!box) {
      box = document.createElement("div");
      box.className = "ai-kb-sources";
      box.innerHTML = `<div class="ai-kb-sources-head">知识库引用</div>`;
      live.cards.appendChild(box);
    }
    for (const it of items) {
      // 用文件名+段号去重：同一份文件重复入库时只显示一条引用
      const key = `${it.name}:${it.chunk}`;
      if (live._kbKeys.has(key)) continue;
      live._kbKeys.add(key);
      const card = document.createElement("details");
      card.className = "ai-kb-source";
      const pct = Math.round((Number(it.score) || 0) * 100);
      const tag = it.builtin
        ? it.sourceType === "lotus"
          ? "LOTUS"
          : it.sourceType === "paper"
            ? "论文"
            : "网站"
        : "我的";
      live.sources.push({
        name: it.name,
        chunk: it.chunk,
        sourceType: it.sourceType,
        tag,
        score: it.score,
      });
      card.innerHTML = `
        <summary>
          <span class="ai-kb-tag is-${esc(it.sourceType || "user")}">${tag}</span>
          <span>《${esc(it.name)}》第 ${esc(it.chunk)} 段</span>
          <em>相关度 ${pct}%</em>
        </summary>
        <p>${esc(it.snippet || "")}</p>`;
      box.appendChild(card);
    }
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

  // ── 知识库面板 ──────────────────────────────────────────
  let kbTimer = null;
  let kbBusy = false;

  const KB_STATUS = {
    ready: (d) => `已向量化 · ${d.chunks} 段`,
    pending: (d) => `向量化中 ${d.embedded || 0}/${d.chunks} 段…`,
    local: (d) => `本地向量化 · ${d.chunks} 段`,
    lexical: (d) => `仅关键词检索 · ${d.chunks} 段`,
  };

  function renderKbList(docs) {
    if (!kbList) return;
    if (!docs.length) {
      kbList.innerHTML = `<p class="ai-kb-empty">还没有文档。上传 PDF、Word、Excel 或 CSV，提问时我会自动检索并标注出处。</p>`;
      return;
    }
    kbList.innerHTML = docs
      .map((d) => {
        const status = (KB_STATUS[d.status] || KB_STATUS.lexical)(d);
        const title = d.embedError ? ` title="${esc(d.embedError)}"` : "";
        const icon =
          d.kind === "pdf" ? "📕" : d.kind === "table" ? "📊" : "📄";
        const tag = d.builtin
          ? d.sourceType === "lotus"
            ? "LOTUS"
            : d.sourceType === "paper"
              ? "论文"
              : "网站"
          : "我的";
        const delBtn =
          d.removable === false
            ? ""
            : `<button type="button" class="ai-kb-del" data-kb-del="${esc(
                d.id
              )}" title="从知识库删除">×</button>`;
        return `<div class="ai-kb-doc" data-id="${esc(d.id)}">
        <span class="ai-kb-icon">${icon}</span>
        <span class="ai-kb-tag is-${esc(d.sourceType || "user")}">${tag}</span>
        <div class="ai-kb-doc-main">
          <b title="${esc(d.name)}">${esc(d.name)}</b>
          <em class="is-${esc(d.status)}"${title}>${esc(status)}${
            d.truncated ? " · 已截断" : ""
          }</em>
        </div>
        ${delBtn}
      </div>`;
      })
      .join("");
  }

  async function refreshKb() {
    if (!kbList) return;
    try {
      const res = await fetch("/api/ai/kb", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (kbCount) kbCount.textContent = String(j.stats?.docs || 0);
      renderKbList(j.docs || []);
      const pending = (j.docs || []).some((d) => d.status === "pending");
      if (pending && !kbTimer) {
        kbTimer = setTimeout(() => {
          kbTimer = null;
          refreshKb();
        }, 2500);
      }
    } catch (err) {
      if (kbPanel && !kbPanel.hidden) {
        kbList.innerHTML = `<p class="ai-kb-empty">知识库读取失败：${esc(
          err.message
        )}</p>`;
      }
    }
  }

  function readFileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("本地读取失败"));
      reader.onload = () => {
        const s = String(reader.result || "");
        resolve(s.slice(s.indexOf(",") + 1));
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadToKb(file) {
    if (!file || kbBusy) return;
    kbBusy = true;
    if (kbBtn) kbBtn.disabled = true;
    if (kbList) {
      kbList.insertAdjacentHTML(
        "afterbegin",
        `<div class="ai-kb-doc is-uploading">
          <span class="ai-kb-icon">⏳</span>
          <div class="ai-kb-doc-main"><b>${esc(
            file.name
          )}</b><em>解析并切段中…</em></div>
        </div>`
      );
    }
    try {
      const data = await readFileBase64(file);
      const res = await fetch("/api/ai/kb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, type: file.type, data }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        throw new Error(j.error || `上传失败（HTTP ${res.status}）`);
      }
      await refreshKb();
    } catch (err) {
      if (kbList) {
        kbList.insertAdjacentHTML(
          "afterbegin",
          `<div class="ai-kb-doc is-error"><span class="ai-kb-icon">⚠️</span>
            <div class="ai-kb-doc-main"><b>${esc(file.name)}</b><em>${esc(
              String(err?.message || err).slice(0, 120)
            )}</em></div></div>`
        );
      }
    } finally {
      kbBusy = false;
      if (kbBtn) kbBtn.disabled = false;
      if (kbFile) kbFile.value = "";
    }
  }

  async function streamChat(userText, file, parsed) {
    const live = createLiveMessage();
    const ac = new AbortController();
    activeAbort = ac;
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
      if (researchMode) payload.mode = "research";
      if (file && parsed?.kind === "image" && parsed.dataUrl) {
        payload.images = [
          {
            name: parsed.name || file.name,
            type: parsed.type || file.type,
            dataUrl: parsed.dataUrl,
          },
        ];
      } else if (file && parsed?.ok && parsed.text) {
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
        headers: sessionHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        let detail = "";
        try {
          const j = await res.json();
          detail = j?.error ? String(j.error) : "";
        } catch (_) {}
        throw new Error(
          detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`
        );
      }
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
            live.status.hidden = false;
            live.status.textContent = event.text || "AI 正在分析…";
          } else if (event.type === "vision") {
            renderVision(live, event.analysis);
          } else if (event.type === "reflection") {
            renderReflection(live, event.reflection);
          } else if (event.type === "plan") {
            renderPlan(live, event);
          } else if (event.type === "step") {
            updatePlanStep(live, event);
          } else if (event.type === "think") {
            thinkText += event.text || "";
            live.think.hidden = false;
            live.thinkBody.textContent = thinkText;
            live.thinkMeta.textContent = `${thinkText.length.toLocaleString(
              "zh-CN"
            )} 字`;
          } else if (event.type === "delta") {
            // 正文开始流式输出后隐藏“正在分析”，让引用和答案占主位
            live.status.hidden = true;
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
          } else if (event.type === "source") {
            addSources(live, event.items);
          } else if (event.type === "chart") {
            live.charts.push(event.spec);
            live.cards.insertAdjacentHTML("beforeend", chartHtml(event.spec));
          } else if (event.type === "scene") {
            addSceneProposal(live, event);
          } else if (event.type === "done") {
            finishPlan(live);
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
      if (live._plan && finalText.trim() && !hadError) {
        addReportButton(live, {
          userText,
          answer: finalText.trim(),
          plan: live._plan,
          vision: live.vision || null,
          reflection: live.reflection || null,
          sources: live.sources,
          tools: live.toolLog,
          charts: live.charts,
        });
        if (researchMode) {
          saveLastResearch({
            userText,
            plan: live._plan,
            vision: live.vision || null,
            reflection: live.reflection || null,
            answer: finalText.trim().slice(0, 12000),
            history: chatHistory.slice(-10).map((m) => ({
              role: m.role,
              content: String(m.content || "").slice(0, 4000),
            })),
            sources: live.sources.slice(-20),
            tools: live.toolLog.slice(-20),
            charts: live.charts.slice(-5),
            ts: Date.now(),
          });
          refreshContinueBtn();
        }
      }
      if (!finalText.trim() || hadError) addRetry();
      scrollBottom();
    } catch (err) {
      live.status.remove();
      const aborted =
        err?.name === "AbortError" || /aborted|abort/i.test(String(err?.message));
      const message = aborted
        ? "已停止本轮回答。"
        : await friendlyChatError(err);
      live.text.innerHTML = `<p class="ai-error">${esc(message)}</p>`;
      if (live.tools.firstChild) {
        live.tools.firstChild.insertAdjacentHTML(
          "beforeend",
          `<span>${aborted ? "已停止" : "请求失败"}</span>`
        );
      }
      addRetry();
      scrollBottom();
      if (!aborted) console.warn("[ai-dock]", err);
    } finally {
      if (activeAbort === ac) activeAbort = null;
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
      const image = parsed?.kind === "image";
      const userText =
        text || (image ? "请分析这张图片。" : `请阅读并分析这个文件：${file.name}`);
      addUser(userText, file, parsed);
      chatHistory.push({
        role: "user",
        content:
          userText +
          (file
            ? `\n[${image ? "图片" : "附件"}] ${file.name} (${humanSize(
                file.size
              )})${
                image
                  ? ""
                  : parsed?.ok
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
        input.placeholder = researchMode
          ? "研究任务：例如「对比黄酮和生物碱的来源科分布，并给出可引用简报」"
          : "问点什么：例如「找出抗氧化的黄酮，按来源科分布」";
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
  window.addEventListener("eco:ui-close", () => setOpen(false));
  refreshAiBadge();
  refreshContinueBtn();
  continueBtn?.addEventListener("click", restoreLastResearch);

  // 服务端「最近一次研究」补齐本地缓存
  syncResearchFromServer().then((updated) => {
    if (updated) refreshContinueBtn();
  });

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
  researchBtn?.addEventListener("click", () => {
    setResearchMode(!researchMode);
    input.focus();
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

  // 知识库面板
  kbBtn?.addEventListener("click", () => {
    setOpen(true);
    kbPanel.hidden = !kbPanel.hidden;
    if (!kbPanel.hidden) refreshKb();
  });
  el.querySelector("#aiKbClose")?.addEventListener("click", () => {
    kbPanel.hidden = true;
  });
  el.querySelector("#aiKbUpload")?.addEventListener("click", () =>
    kbFile.click()
  );
  kbReembed?.addEventListener("click", () => {
    if (
      !window.confirm(
        "用当前向量配置重新向量化全部文档？内置知识库和已上传文档都会重算，耗时取决于文档数量。"
      )
    ) {
      return;
    }
    kbReembed.disabled = true;
    const hint = el.querySelector("#aiKbHint");
    if (hint) hint.textContent = "正在重建向量…";
    fetch("/api/ai/kb/reembed", { method: "POST" })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "重建失败");
        if (hint) hint.textContent = `已排队 ${j.queued || 0} 个文档，后台向量化中`;
      })
      .catch((err) => {
        if (hint) hint.textContent = `重建失败：${String(err.message || err)}`;
      })
      .finally(() => {
        kbReembed.disabled = false;
        refreshKb();
      });
  });
  kbFile?.addEventListener("change", () => {
    const f = kbFile.files?.[0];
    if (f) uploadToKb(f);
  });
  kbList?.addEventListener("click", (e) => {
    const del = e.target.closest("[data-kb-del]");
    if (!del) return;
    const id = del.dataset.kbDel;
    const name =
      del.closest(".ai-kb-doc")?.querySelector("b")?.textContent || "这份文档";
    if (!window.confirm(`从知识库删除「${name}」？`)) return;
    fetch(`/api/ai/kb?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      .then((r) => r.json().catch(() => ({})))
      .finally(() => refreshKb());
  });
  refreshKb();

  // 建议 chips
  el.addEventListener("click", (e) => {
    const shuttle = e.target.closest("[data-ai-shuttle]");
    if (shuttle) {
      setOpen(false);
      setTimeout(() => scene?.startStarShuttle?.(), 320);
      return;
    }
    const uploadChip = e.target.closest("[data-ai-upload]");
    if (uploadChip) {
      setOpen(true);
      fileInput.click();
      return;
    }
    const imageChip = e.target.closest("[data-ai-image]");
    if (imageChip) {
      setOpen(true);
      fileInput.click();
      return;
    }
    const kbChip = e.target.closest("[data-ai-kb]");
    if (kbChip) {
      kbPanel.hidden = false;
      refreshKb();
      return;
    }
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
    const research = e.target.closest("[data-ai-research]");
    if (research) {
      setResearchMode(true);
      setOpen(true);
      input.value =
        "对比黄酮类和生物碱类的来源科分布，并生成一份带来源的研究简报";
      input.focus();
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
