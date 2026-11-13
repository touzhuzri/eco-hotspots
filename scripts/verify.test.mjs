import test from "node:test";
import assert from "node:assert/strict";
import { compareClaim } from "../ai/verify.mjs";

test("数量在容差内判为一致", () => {
  const out = compareClaim(1000, 1030, { tolerance_pct: 5 });
  assert.equal(out.verdict, "consistent");
  assert.equal(out.percent, 3);
  assert.equal(out.delta, 30);
});

test("超过容差判为冲突", () => {
  const out = compareClaim(1000, 1200, { tolerance_pct: 5 });
  assert.equal(out.verdict, "conflict");
  assert.equal(out.percent, 20);
});

test("低于资料值也能识别", () => {
  const out = compareClaim(1000, 700, { tolerance_pct: 5 });
  assert.equal(out.verdict, "conflict");
  assert.equal(out.percent, -30);
});

test("资料为 0 时按实际值判断", () => {
  const zero = compareClaim(0, 0);
  assert.equal(zero.verdict, "consistent");
  const nonzero = compareClaim(0, 10);
  assert.equal(nonzero.verdict, "conflict");
  assert.equal(nonzero.percent, 100);
});

test("容差与来源标签可配置", () => {
  const out = compareClaim(100, 110, {
    tolerance_pct: 20,
    source_label: "Rutz 2022",
  });
  assert.equal(out.verdict, "consistent");
  assert.equal(out.source_label, "Rutz 2022");
});
