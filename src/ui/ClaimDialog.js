/**
 * 领养 / 改名弹窗。
 * 名字可留空 → 服务端存空字符串，前端显示「神秘用户」。
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{
 *   mode: "claim"|"rename",
 *   moleculeName?: string,
 *   currentName?: string,
 *   onSubmit: (name:string) => Promise<any>,
 *   onSuccess: (result:any) => void
 * }} opts
 */
export function openClaimDialog(opts) {
  const isRename = opts.mode === "rename";
  const overlay = document.createElement("div");
  overlay.className = "claim-overlay";
  overlay.innerHTML = `
    <div class="claim-dialog" role="dialog" aria-modal="true" aria-labelledby="claimTitle">
      <h2 id="claimTitle">${isRename ? "修改领养名" : "领养这颗分子"}</h2>
      ${
        opts.moleculeName
          ? `<p class="claim-mol">${esc(opts.moleculeName)}</p>`
          : ""
      }
      <p class="claim-hint">名字会公开显示在这颗分子的介绍里；留空则显示为「神秘用户」。</p>
      <label class="claim-label" for="claimName">你的名字（可选）</label>
      <input id="claimName" maxlength="20" autocomplete="off" placeholder="神秘用户"
        value="${esc(opts.currentName || "")}" />
      <p class="claim-error" id="claimError" role="alert"></p>
      <div class="claim-actions">
        <button type="button" class="claim-cancel" id="claimCancel">取消</button>
        <button type="button" class="claim-confirm" id="claimConfirm">
          ${isRename ? "保存名字" : "确认领养"}
        </button>
      </div>
    </div>`;

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };

  function onKey(e) {
    if (e.key === "Escape") close();
    if (e.key === "Enter") {
      const tag = (e.target && e.target.tagName || "").toLowerCase();
      if (tag === "input") submit();
    }
  }

  let busy = false;
  async function submit() {
    if (busy) return;
    busy = true;
    const input = overlay.querySelector("#claimName");
    const errorEl = overlay.querySelector("#claimError");
    const confirm = overlay.querySelector("#claimConfirm");
    const cancel = overlay.querySelector("#claimCancel");
    const name = (input.value || "").trim().slice(0, 20);
    errorEl.textContent = "等待中ing。。。";
    confirm.disabled = true;
    cancel.disabled = true;
    try {
      const result = await opts.onSubmit(name);
      // 成功领养，或 409 已被别人领养：都用服务端返回的状态刷新卡片
      if (result && result.claimed) {
        close();
        opts.onSuccess(result);
        return;
      }
      errorEl.textContent =
        result?.error === "network"
          ? "领养服务不可用，请稍后再试"
          : "领养失败，请稍后再试";
    } catch (err) {
      errorEl.textContent = "领养失败，请稍后再试";
    } finally {
      busy = false;
      if (overlay.isConnected) {
        confirm.disabled = false;
        cancel.disabled = false;
      }
    }
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector("#claimCancel").addEventListener("click", close);
  overlay.querySelector("#claimConfirm").addEventListener("click", submit);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.querySelector("#claimName")?.focus());
}
