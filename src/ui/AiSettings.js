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
  dspro: {
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-v4-pro",
  },
  dsflash: {
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
  },
  mimo: {
    baseURL: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2-flash",
  },
  custom: { baseURL: "", model: "" },
};

const EMBED_DEFAULTS = {
  siliconflow: {
    baseURL: "https://api.siliconflow.cn/v1",
    model: "BAAI/bge-m3",
  },
  zhipu: {
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "embedding-3",
  },
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
  const visionBaseEl = panel.querySelector("#ssVisionBase");
  const visionModelEl = panel.querySelector("#ssVisionModel");
  const visionKeyEl = panel.querySelector("#ssVisionKey");
  const visionStatusEl = panel.querySelector("#ssVisionStatus");
  const visionTestEl = panel.querySelector("#ssVisionTest");
  const visionClearEl = panel.querySelector("#ssVisionClear");
  const embedPresetEl = panel.querySelector("#ssEmbedPreset");
  const embedBaseEl = panel.querySelector("#ssEmbedBase");
  const embedModelEl = panel.querySelector("#ssEmbedModel");
  const embedKeyEl = panel.querySelector("#ssEmbedKey");
  const embedStatusEl = panel.querySelector("#ssEmbedStatus");
  const embedTestEl = panel.querySelector("#ssEmbedTest");
  const embedClearEl = panel.querySelector("#ssEmbedClear");
  if (!providerEl || !baseEl || !modelEl || !keyEl || !statusEl) return null;

  let presets = DEFAULTS;
  let embedPresets = EMBED_DEFAULTS;
  let hasKey = false;
  let hasVisionKey = false;
  let hasEmbedKey = false;

  function status(text, kind = "") {
    statusEl.textContent = text;
    statusEl.className = `ss-ai-status${kind ? ` ${kind}` : ""}`;
  }

  function visionStatus(text, kind = "") {
    if (!visionStatusEl) return;
    visionStatusEl.textContent = text;
    visionStatusEl.className = `ss-ai-status${kind ? ` ${kind}` : ""}`;
  }

  function embedStatus(text, kind = "") {
    if (!embedStatusEl) return;
    embedStatusEl.textContent = text;
    embedStatusEl.className = `ss-ai-status${kind ? ` ${kind}` : ""}`;
  }

  function embedPresetKey() {
    const base = String(embedBaseEl?.value || "")
      .trim()
      .replace(/\/+$/, "")
      .toLowerCase();
    const model = String(embedModelEl?.value || "").trim();
    for (const [key, p] of Object.entries(embedPresets || {})) {
      if (
        String(p.baseURL || "").replace(/\/+$/, "").toLowerCase() === base &&
        String(p.model || "") === model
      ) {
        return key;
      }
    }
    return "";
  }

  function syncEmbedPreset() {
    if (embedPresetEl) embedPresetEl.value = embedPresetKey();
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.presets) presets = cfg.presets;
    if (cfg.embedPresets) embedPresets = cfg.embedPresets;
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

    if (visionBaseEl) visionBaseEl.value = cfg.visionBaseURL || "";
    if (visionModelEl) visionModelEl.value = cfg.visionModel || "";
    hasVisionKey = !!cfg.hasVisionKey;
    if (visionKeyEl) {
      visionKeyEl.value = "";
      visionKeyEl.placeholder = hasVisionKey
        ? "已配置，留空不修改"
        : "填入视觉服务 Key";
    }
    if (cfg.visionReady) {
      visionStatus(`识图已就绪 · ${cfg.visionModel || cfg.model}`, "ok");
    } else if (cfg.visionModel) {
      visionStatus("已填视觉模型，但缺少可用的 Key", "err");
    } else {
      visionStatus("留空表示复用上面的对话服务商；纯文本模型无法识图", "");
    }

    if (embedBaseEl) embedBaseEl.value = cfg.embedBaseURL || "";
    if (embedModelEl) embedModelEl.value = cfg.embedModel || "";
    syncEmbedPreset();
    hasEmbedKey = !!cfg.hasEmbedKey;
    if (embedKeyEl) {
      embedKeyEl.value = "";
      embedKeyEl.placeholder = hasEmbedKey
        ? "已配置，留空不修改"
        : "填入向量服务 Key";
    }
    const effective = cfg.embedModelEffective || "local-hash";
    if (cfg.embedReady) {
      embedStatus(`向量已配置 · ${effective}（点「测试向量」确认额度）`, "ok");
    } else if (cfg.embedModel) {
      embedStatus("已填向量模型，但缺少 Base URL / Key，将退回本地向量", "err");
    } else {
      embedStatus(
        `当前为 ${effective}；可单独配置支持 /embeddings 的服务商`,
        ""
      );
    }
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

  embedPresetEl?.addEventListener("change", () => {
    const p = embedPresets[embedPresetEl.value];
    if (!p) return;
    if (embedBaseEl) embedBaseEl.value = p.baseURL;
    if (embedModelEl) embedModelEl.value = p.model;
    embedStatus(
      `已填入 ${p.model}；点「测试向量」确认 Key 与免费额度`,
      ""
    );
  });
  embedBaseEl?.addEventListener("input", syncEmbedPreset);
  embedModelEl?.addEventListener("input", syncEmbedPreset);

  async function pushConfig() {
    const res = await fetch("/api/ai/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerEl.value,
        baseURL: baseEl.value.trim(),
        model: modelEl.value.trim(),
        apiKey: keyEl.value.trim(),
        visionBaseURL: visionBaseEl?.value.trim() || "",
        visionModel: visionModelEl?.value.trim() || "",
        visionApiKey: visionKeyEl?.value.trim() || "",
        embedBaseURL: embedBaseEl?.value.trim() || "",
        embedModel: embedModelEl?.value.trim() || "",
        embedApiKey: embedKeyEl?.value.trim() || "",
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
      const vReady = data.config?.visionReady;
      status(
        data.config?.hasKey
          ? `已保存。${vReady ? "识图已就绪" : "识图未就绪"}。API Key 只保存在本机 .run/ai-config.json。`
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

  function makeVisionTestImage() {
    const c = document.createElement("canvas");
    c.width = 180;
    c.height = 130;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0b141c";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#7fe0a2";
    ctx.beginPath();
    ctx.arc(90, 52, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#eafff0";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("VISION TEST", 90, 106);
    return c.toDataURL("image/png");
  }

  async function testVision() {
    if (!visionTestEl) return;
    visionTestEl.disabled = true;
    visionStatus("保存配置并测试识图…");
    try {
      await pushConfig();
      const res = await fetch("/api/ai/vision-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: makeVisionTestImage() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      visionStatus(
        `识图正常 · ${data.model || visionModelEl?.value || ""} · ${String(
          data.sample || ""
        ).slice(0, 60)}`,
        "ok"
      );
    } catch (err) {
      visionStatus(
        `识图失败：${String(err.message || err).slice(0, 240)}`,
        "err"
      );
    } finally {
      visionTestEl.disabled = false;
    }
  }

  async function clearVisionKey() {
    if (!window.confirm("清除已保存的视觉 API Key？")) return;
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearVisionKey: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      applyConfig(data.config);
      window.dispatchEvent(new Event("eco:ai-config-changed"));
      visionStatus("已清除视觉 API Key", "");
    } catch (err) {
      visionStatus(
        `清除失败：${String(err.message || err).slice(0, 200)}`,
        "err"
      );
    }
  }

  async function testEmbed() {
    if (!embedTestEl) return;
    embedTestEl.disabled = true;
    embedStatus("保存配置并测试向量接口…");
    try {
      await pushConfig();
      const res = await fetch("/api/ai/embed-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      embedStatus(
        `向量正常 · ${data.model || ""} · ${data.dim || 0} 维`,
        "ok"
      );
    } catch (err) {
      embedStatus(
        `向量测试失败：${String(err.message || err).slice(0, 240)}`,
        "err"
      );
    } finally {
      embedTestEl.disabled = false;
    }
  }

  async function clearEmbedKey() {
    if (!window.confirm("清除已保存的向量 API Key？")) return;
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearEmbedKey: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      applyConfig(data.config);
      window.dispatchEvent(new Event("eco:ai-config-changed"));
      embedStatus("已清除向量 API Key", "");
    } catch (err) {
      embedStatus(
        `清除失败：${String(err.message || err).slice(0, 200)}`,
        "err"
      );
    }
  }

  saveEl.addEventListener("click", save);
  testEl.addEventListener("click", test);
  visionTestEl?.addEventListener("click", testVision);
  visionClearEl?.addEventListener("click", clearVisionKey);
  embedTestEl?.addEventListener("click", testEmbed);
  embedClearEl?.addEventListener("click", clearEmbedKey);
  loadConfig();

  return { reload: loadConfig };
}
