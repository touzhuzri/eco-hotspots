/**
 * 场景设置里的 AI / API 配置。
 *
 * 只和 /api/ai/config、/api/ai/test 通信；API Key 只发送到本机 AI 代理，
 * 不写 localStorage，也不写进前端代码。
 */

const DEFAULTS = {
  glm: {
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.6",
  },
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  mimo: {
    baseURL: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2-flash",
  },
  custom: { baseURL: "", model: "" },
};

export function mountAiSettings(panel) {
  if (!panel) return null;
  const providerEl = panel.querySelector("#ssAiProvider");
  const baseEl = panel.querySelector("#ssAiBase");
  const modelEl = panel.querySelector("#ssAiModel");
  const keyEl = panel.querySelector("#ssAiKey");
  const saveEl = panel.querySelector("#ssAiSave");
  const testEl = panel.querySelector("#ssAiTest");
  const statusEl = panel.querySelector("#ssAiStatus");
  if (!providerEl || !baseEl || !modelEl || !keyEl || !statusEl) return null;

  let presets = DEFAULTS;
  let hasKey = false;

  function status(text, kind = "") {
    statusEl.textContent = text;
    statusEl.className = `ss-ai-status${kind ? ` ${kind}` : ""}`;
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.presets) presets = cfg.presets;
    if ([...providerEl.options].some((o) => o.value === cfg.provider)) {
      providerEl.value = cfg.provider;
    }
    baseEl.value = cfg.baseURL || "";
    modelEl.value = cfg.model || "";
    hasKey = !!cfg.hasKey;
    keyEl.value = "";
    keyEl.placeholder = hasKey ? "已配置，留空不修改" : "填入 API Key";
    status(
      hasKey
        ? `已配置 · ${cfg.provider} / ${cfg.model}`
        : "未配置 API Key；填写后保存，或在 ai/.env 中填写",
      hasKey ? "ok" : ""
    );
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/ai/config", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      applyConfig(await res.json());
    } catch (_) {
      status(
        "AI 服务未启动：请先运行 node ai/server.mjs（或 ./start-ai.sh）后刷新",
        "err"
      );
    }
  }

  providerEl.addEventListener("change", () => {
    const p = presets[providerEl.value] || DEFAULTS[providerEl.value];
    if (!p) return;
    if (!baseEl.value || baseEl.dataset.auto !== "0") baseEl.value = p.baseURL;
    if (!modelEl.value || modelEl.dataset.auto !== "0") modelEl.value = p.model;
    baseEl.dataset.auto = "1";
    modelEl.dataset.auto = "1";
  });
  baseEl.addEventListener("input", () => (baseEl.dataset.auto = "0"));
  modelEl.addEventListener("input", () => (modelEl.dataset.auto = "0"));

  async function pushConfig() {
    const res = await fetch("/api/ai/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerEl.value,
        baseURL: baseEl.value.trim(),
        model: modelEl.value.trim(),
        apiKey: keyEl.value.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    applyConfig(data.config);
    window.dispatchEvent(new Event("eco:ai-config-changed"));
    return data;
  }

  async function save() {
    saveEl.disabled = true;
    status("保存中…");
    try {
      const data = await pushConfig();
      status(
        data.config?.hasKey
          ? "已保存。API Key 只保存在本机 .run/ai-config.json。"
          : "已保存，但还没有 API Key。",
        "ok"
      );
    } catch (err) {
      status(`保存失败：${String(err.message || err).slice(0, 200)}`, "err");
    } finally {
      saveEl.disabled = false;
    }
  }

  async function test() {
    testEl.disabled = true;
    status("保存并测试连接…");
    try {
      await pushConfig();
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      status(
        `连接正常 · ${data.model || modelEl.value} · ${data.latencyMs}ms`,
        "ok"
      );
    } catch (err) {
      status(`连接失败：${String(err.message || err).slice(0, 240)}`, "err");
    } finally {
      testEl.disabled = false;
    }
  }

  saveEl.addEventListener("click", save);
  testEl.addEventListener("click", test);
  loadConfig();

  return { reload: loadConfig };
}
