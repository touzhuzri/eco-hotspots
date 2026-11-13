/**
 * 资料数量断言 vs LOTUS 实际统计的确定性比较。
 * 只做数字比较，不判断资料本身的可信度。
 */
export function compareClaim(claimed, actual, opts = {}) {
  const claimedNum = Number(claimed);
  const actualNum = Number(actual) || 0;
  const tolerance = Number.isFinite(Number(opts.tolerance_pct))
    ? Math.max(0, Math.min(100, Number(opts.tolerance_pct)))
    : 5;
  const delta = actualNum - claimedNum;
  const percent =
    claimedNum > 0 ? (delta / claimedNum) * 100 : actualNum > 0 ? 100 : 0;
  const verdict = Math.abs(percent) <= tolerance ? "consistent" : "conflict";
  return {
    ok: true,
    verdict,
    claimed: claimedNum,
    actual: actualNum,
    delta,
    percent: Number(percent.toFixed(2)),
    tolerance_pct: tolerance,
    filters: opts.filters || {},
    source_label: String(opts.source_label || "资料").slice(0, 80),
    lotus: "LOTUS frozen 260413",
    note:
      verdict === "consistent"
        ? `在 ±${tolerance}% 容差内，可以认为与 LOTUS 一致。`
        : `与 LOTUS 实际统计相差 ${Math.abs(
            Number(percent.toFixed(1))
          )}%，以 LOTUS 为准，并在回答中说明差异。`,
  };
}
