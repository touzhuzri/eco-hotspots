import { listKingdoms, pointStats } from "../engine/engineApi.js";
import { getState, setKingdom } from "../state/store.js";

export function mountFilters(el) {
  function render() {
    const { kingdom } = getState();
    const options = ["全部", ...listKingdoms()];
    const s = pointStats();
    el.innerHTML = "";
    options.forEach((k) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-btn" + (kingdom === k ? " active" : "");
      const count = k === "全部" ? s.total : s.byKingdom[k] != null ? s.byKingdom[k] : 0;
      btn.textContent = `${k} · ${count.toLocaleString("zh-CN")}`;
      btn.addEventListener("click", () => setKingdom(k));
      el.appendChild(btn);
    });
  }
  render();
  return { render };
}
