/** 二十四节气：0 = 立春；日期为公历近似值。 */
export const SOLAR_TERMS = [
  { m: 2, d: 4, name: "立春" },
  { m: 2, d: 19, name: "雨水" },
  { m: 3, d: 5, name: "惊蛰" },
  { m: 3, d: 20, name: "春分" },
  { m: 4, d: 5, name: "清明" },
  { m: 4, d: 20, name: "谷雨" },
  { m: 5, d: 5, name: "立夏" },
  { m: 5, d: 21, name: "小满" },
  { m: 6, d: 5, name: "芒种" },
  { m: 6, d: 21, name: "夏至" },
  { m: 7, d: 7, name: "小暑" },
  { m: 7, d: 23, name: "大暑" },
  { m: 8, d: 7, name: "立秋" },
  { m: 8, d: 23, name: "处暑" },
  { m: 9, d: 7, name: "白露" },
  { m: 9, d: 23, name: "秋分" },
  { m: 10, d: 8, name: "寒露" },
  { m: 10, d: 23, name: "霜降" },
  { m: 11, d: 7, name: "立冬" },
  { m: 11, d: 22, name: "小雪" },
  { m: 12, d: 7, name: "大雪" },
  { m: 12, d: 21, name: "冬至" },
  { m: 1, d: 5, name: "小寒" },
  { m: 1, d: 20, name: "大寒" },
];

export function currentSolarTermIndex(now = new Date()) {
  const y = now.getFullYear();
  const today = new Date(y, now.getMonth(), now.getDate()).getTime();
  let best = 21; // 默认冬至
  let bestT = -Infinity;
  for (let yy = y - 1; yy <= y; yy++) {
    for (let i = 0; i < SOLAR_TERMS.length; i++) {
      const { m, d } = SOLAR_TERMS[i];
      const t = new Date(yy, m - 1, d).getTime();
      if (t <= today && t > bestT) {
        bestT = t;
        best = i;
      }
    }
  }
  return best;
}

export function currentSolarTerm(now = new Date()) {
  const index = currentSolarTermIndex(now);
  const cur = SOLAR_TERMS[index];
  const next = SOLAR_TERMS[(index + 1) % SOLAR_TERMS.length];
  const year = now.getFullYear();
  const start = new Date(year, cur.m - 1, cur.d);
  let end = new Date(year, next.m - 1, next.d);
  if (end <= start) end = new Date(year + 1, next.m - 1, next.d);
  const fmt = (d) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
      d.getDate()
    ).padStart(2, "0")}`;
  return {
    index,
    name: cur.name,
    start: fmt(start),
    end: fmt(end),
  };
}
