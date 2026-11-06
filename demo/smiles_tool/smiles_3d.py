#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMILES → 3D 球棍模型
====================

在 VSCode 里直接运行本文件，终端会提示输入 SMILES；
也可以把 SMILES 作为命令行参数。

输出（默认写入同目录 outputs/）：
    <名字>-3d.html  可旋转、缩放的 3D 球棍模型（单文件，离线可用）
    <名字>-3d.mol   3D 坐标文件，可用 Avogadro / PyMOL / Chimera 打开
    <名字>-3d.png   3D 预览图（需要 matplotlib）

用法：
    python smiles_3d.py
    python smiles_3d.py "CC(=O)Oc1ccccc1C(=O)O"
    python smiles_3d.py "CCO" --name Ethanol --open
"""

from __future__ import annotations

import html
import re
import webbrowser
from pathlib import Path

from rdkit import Chem

from smiles_common import (
    DEFAULT_COLOR,
    DEFAULT_RADIUS,
    ELEMENT_COLORS,
    ELEMENT_RADII,
    UserInputError,
    build_parser,
    describe_molecule,
    display_name,
    embed_3d,
    ensure_outdir,
    fmt_path,
    output_stem,
    parse_smiles,
    print_molecule_info,
    render_3d_png,
    resolve_args,
    viewer_data,
    web_json,
    write_mol,
)


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%%TITLE%% · 3D</title>
<style>
  :root{
    --bg:#04070d; --panel:rgba(9,15,26,.82); --line:rgba(150,175,210,.20);
    --ink:#e8effa; --muted:#93a4bb; --accent:#8fd8b0; --gold:#e3c477;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;overflow:hidden;color:var(--ink);
    font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;
    background:radial-gradient(ellipse at 67% 43%,#101d32 0%,#070c15 46%,#03060b 100%);}
  #stage{position:fixed;inset:0}
  #view{width:100%;height:100%;display:block;cursor:grab;touch-action:none}
  #view.dragging{cursor:grabbing}
  .panel{position:fixed;left:26px;top:26px;width:min(370px,calc(100vw - 52px));
    max-height:calc(100vh - 128px);overflow:auto;padding:20px 20px 18px;
    background:var(--panel);border:1px solid var(--line);border-radius:18px;
    backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
    box-shadow:0 22px 70px rgba(0,0,0,.48);scrollbar-width:thin;}
  .eyebrow{margin:0 0 7px;color:var(--accent);font-size:.66rem;letter-spacing:.24em}
  h1{margin:0 0 10px;font-size:clamp(1.3rem,2.4vw,1.72rem);line-height:1.25;color:#f4f8ff}
  .meta{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 4px}
  .meta span{border:1px solid rgba(227,196,119,.28);background:rgba(227,196,119,.08);
    color:#e8d7a5;border-radius:999px;padding:3px 10px;font-size:.68rem;letter-spacing:.02em}
  .twod{background:#fff;border-radius:11px;padding:5px;margin:14px 0 4px;
    box-shadow:0 5px 18px rgba(0,0,0,.25)}
  .twod svg{width:100%;height:auto;display:block;border-radius:8px}
  .label{margin:16px 0 5px;color:var(--muted);font-size:.64rem;letter-spacing:.18em}
  .smiles{font-family:ui-monospace,"Cascadia Code",Consolas,monospace;font-size:.76rem;
    line-height:1.6;color:#cfe1f7;background:rgba(3,8,16,.62);border:1px solid var(--line);
    border-radius:9px;padding:9px 11px;word-break:break-all}
  .hint{margin:14px 0 0;color:var(--muted);font-size:.72rem;line-height:1.6}
  .toolbar{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
    display:flex;gap:8px;padding:8px;border-radius:999px;
    background:rgba(8,13,23,.72);border:1px solid var(--line);
    backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    box-shadow:0 16px 44px rgba(0,0,0,.4);white-space:nowrap}
  button{appearance:none;border:1px solid rgba(160,185,220,.20);border-radius:999px;
    background:rgba(20,30,48,.72);color:#dbe8fa;padding:8px 15px;font:inherit;
    font-size:.75rem;cursor:pointer;transition:background .16s,border-color .16s,color .16s}
  button:hover{background:rgba(35,54,82,.92);border-color:rgba(143,216,176,.45);color:#fff}
  button:active{transform:translateY(1px)}
  .footnote{position:fixed;right:26px;bottom:31px;color:rgba(147,164,187,.7);
    font-size:.64rem;letter-spacing:.05em}
  @media(max-width:760px){
    .panel{left:12px;top:12px;width:calc(100vw - 24px);max-height:43vh;padding:14px 15px}
    .twod{max-height:130px;overflow:hidden}
    .twod svg{max-height:120px;width:auto;max-width:100%;margin:0 auto}
    .hint{margin-top:9px}
    .toolbar{bottom:14px;gap:6px;padding:6px}
    button{padding:7px 11px;font-size:.68rem}
    .footnote{display:none}
  }
</style>
</head>
<body>
<div id="stage"><canvas id="view"></canvas></div>

<aside class="panel">
  <p class="eyebrow">SMILES → 3D</p>
  <h1>%%NAME%%</h1>
  <p class="meta">
    <span>%%FORMULA%%</span>
    <span>MW %%MW%%</span>
    <span>%%HEAVY%% heavy atoms</span>
  </p>
  %%TWO_D_BLOCK%%
  <p class="label">SMILES</p>
  <div class="smiles">%%SMILES%%</div>
  <p class="hint">拖动旋转 · 滚轮缩放 · 双击重置<br>氢原子默认隐藏，可用下方按钮显示。</p>
</aside>

<div class="toolbar">
  <button id="btnH" type="button">显示氢原子</button>
  <button id="btnSpin" type="button">暂停自转</button>
  <button id="btnReset" type="button">重置视角</button>
</div>

<div class="footnote">RDKit ETKDG conformer · MMFF optimized</div>

<script>
(function () {
  "use strict";

  const DATA = %%MOL_JSON%%;
  const COLORS = %%COLORS%%;
  const RADII = %%RADII%%;
  const DEFAULT_COLOR = %%DEFAULT_COLOR%%;
  const DEFAULT_RADIUS = %%DEFAULT_RADIUS%%;

  const canvas = document.getElementById("view");
  const ctx = canvas.getContext("2d");
  const btnH = document.getElementById("btnH");
  const btnSpin = document.getElementById("btnSpin");
  const btnReset = document.getElementById("btnReset");

  const atoms = (DATA.atoms || []).map((a) => ({
    e: a.e,
    x: Number(a.x) || 0,
    y: Number(a.y) || 0,
    z: Number(a.z) || 0,
    color: COLORS[a.e] || DEFAULT_COLOR,
    radius: RADII[a.e] || DEFAULT_RADIUS,
    isH: a.e === "H",
  }));
  const bonds = DATA.bonds || [];

  let showH = false;
  let spin = true;
  let dragging = false;
  let yaw = -0.5;
  let pitch = 0.22;
  let zoom = 1;
  let lastX = 0;
  let lastY = 0;
  let W = 0;
  let H = 0;
  let DPR = 1;

  // 把分子缩放到半径约 1.55 的球里，相机固定在 +Z 方向
  let maxR = 0.8;
  for (const a of atoms) {
    maxR = Math.max(maxR, Math.hypot(a.x, a.y, a.z));
  }
  const norm = 1.55 / maxR;
  for (const a of atoms) {
    a.x *= norm;
    a.y *= norm;
    a.z *= norm;
    a.radius *= norm;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    render();
  }

  function viewCenter() {
    const panel = document.querySelector(".panel");
    const rect = panel ? panel.getBoundingClientRect() : null;

    // 窄屏：信息卡在上方，把分子放到卡片下方的可视区域中心
    if (W < 760) {
      const top = rect ? Math.min(H - 92, rect.bottom + 12) : 0;
      const bottom = H - 74;
      return {
        x: W * 0.5,
        y: (top + bottom) * 0.5,
        size: Math.max(120, Math.min(W - 24, bottom - top)),
      };
    }

    // 宽屏：信息卡在左侧，分子在剩余的右侧区域里居中并按区域大小缩放
    const left = rect ? rect.right + 18 : 0;
    return {
      x: (left + W) * 0.5,
      y: H * 0.5,
      size: Math.max(160, Math.min(W - left - 24, H - 80)),
    };
  }

  function rotatePoint(a) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cx = Math.cos(pitch);
    const sx = Math.sin(pitch);
    const x1 = a.x * cy + a.z * sy;
    const z1 = -a.x * sy + a.z * cy;
    const y2 = a.y * cx - z1 * sx;
    const z2 = a.y * sx + z1 * cx;
    return { x: x1, y: y2, z: z2 };
  }

  function render() {
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    if (!atoms.length) return;

    const view = viewCenter();
    const focal = view.size * 1.45 * zoom;
    const camZ = 5.6;
    const projected = atoms.map((a) => {
      const p = rotatePoint(a);
      const s = focal / Math.max(camZ + p.z, 0.35);
      return {
        ...a,
        sx: view.x + p.x * s,
        sy: view.y - p.y * s,
        sz: p.z,
        scale: s,
        r: Math.max(2.2, a.radius * s),
      };
    });

    // 键：按深度从远到近画；球棍模型里统一用一根粗棍
    const visibleBonds = [];
    for (const b of bonds) {
      const A = projected[b[0]];
      const B = projected[b[1]];
      if (!A || !B) continue;
      if (!showH && (A.isH || B.isH)) continue;
      visibleBonds.push({ A, B, order: b[2], z: (A.sz + B.sz) / 2 });
    }
    visibleBonds.sort((a, b) => a.z - b.z);

    for (const b of visibleBonds) {
      const orderScale = b.order >= 2.5 ? 1.45 : b.order >= 1.95 ? 1.22 : 1.0;
      const lineWidth = Math.max(2.0, 0.052 * (b.A.scale + b.B.scale) * 0.5 * orderScale);
      ctx.lineCap = "round";

      ctx.lineWidth = lineWidth + 2.0;
      ctx.strokeStyle = "rgba(3, 7, 13, 0.62)";
      ctx.beginPath();
      ctx.moveTo(b.A.sx, b.A.sy);
      ctx.lineTo(b.B.sx, b.B.sy);
      ctx.stroke();

      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = "rgba(174, 193, 216, 0.82)";
      ctx.beginPath();
      ctx.moveTo(b.A.sx, b.A.sy);
      ctx.lineTo(b.B.sx, b.B.sy);
      ctx.stroke();

      ctx.lineWidth = Math.max(0.8, lineWidth * 0.22);
      ctx.strokeStyle = "rgba(255,255,255,0.30)";
      ctx.beginPath();
      ctx.moveTo(b.A.sx, b.A.sy);
      ctx.lineTo(b.B.sx, b.B.sy);
      ctx.stroke();
    }

    // 原子：远 → 近，近的盖住远的
    const visibleAtoms = projected.filter((a) => showH || !a.isH);
    visibleAtoms.sort((a, b) => a.sz - b.sz);

    for (const a of visibleAtoms) {
      const r = a.r;

      ctx.beginPath();
      ctx.arc(a.sx, a.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = a.color;
      ctx.fill();

      const g = ctx.createRadialGradient(
        a.sx - r * 0.35,
        a.sy - r * 0.40,
        Math.max(0.5, r * 0.06),
        a.sx,
        a.sy,
        r * 1.04
      );
      g.addColorStop(0, "rgba(255,255,255,0.74)");
      g.addColorStop(0.26, "rgba(255,255,255,0.13)");
      g.addColorStop(0.70, "rgba(0,0,0,0.04)");
      g.addColorStop(1, "rgba(0,0,0,0.44)");
      ctx.beginPath();
      ctx.arc(a.sx, a.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(a.sx, a.sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.24)";
      ctx.lineWidth = Math.max(0.7, r * 0.045);
      ctx.stroke();

      // 杂原子标签（碳和氢不标，避免画面太吵）
      if (!a.isH && a.e !== "C" && r > 7) {
        const fontSize = Math.max(9, r * 0.92);
        ctx.font = '700 ' + fontSize.toFixed(1) + 'px ui-monospace, "Cascadia Code", Consolas, monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(2, fontSize * 0.18);
        ctx.strokeStyle = "rgba(0,0,0,0.62)";
        ctx.strokeText(a.e, a.sx, a.sy + fontSize * 0.04);
        ctx.fillStyle = "#f8fbff";
        ctx.fillText(a.e, a.sx, a.sy + fontSize * 0.04);
      }
    }
  }

  function resetView() {
    yaw = -0.5;
    pitch = 0.22;
    zoom = 1;
    render();
  }

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.classList.add("dragging");
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.008;
    pitch = clamp(pitch + (e.clientY - lastY) * 0.008, -1.45, 1.45);
    lastX = e.clientX;
    lastY = e.clientY;
    render();
  });

  function endDrag(e) {
    dragging = false;
    canvas.classList.remove("dragging");
    try {
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", () => {
    dragging = false;
    canvas.classList.remove("dragging");
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0011), 0.35, 4.0);
    render();
  }, { passive: false });

  canvas.addEventListener("dblclick", resetView);

  btnH.addEventListener("click", () => {
    showH = !showH;
    btnH.textContent = showH ? "隐藏氢原子" : "显示氢原子";
    render();
  });

  btnSpin.addEventListener("click", () => {
    spin = !spin;
    btnSpin.textContent = spin ? "暂停自转" : "开始自转";
  });

  btnReset.addEventListener("click", resetView);

  window.addEventListener("resize", resize);

  let lastTime = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if (spin && !dragging) {
      yaw += dt * 0.32;
      render();
    }
    requestAnimationFrame(tick);
  }

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    spin = false;
    btnSpin.textContent = "开始自转";
  }

  resize();
  requestAnimationFrame(tick);
})();
</script>
</body>
</html>
"""


def _two_d_block(svg_2d: str | None) -> str:
    if not svg_2d:
        return ""
    # RDKit 可能输出单引号 / 双引号 / 不同 encoding 的 XML 声明
    svg = re.sub(r"^\s*<\?xml[^>]*\?>\s*", "", svg_2d, flags=re.IGNORECASE)
    return f'<div class="twod">{svg.strip()}</div>'


def write_3d_html(
    data: dict,
    path: Path,
    *,
    name: str,
    info: dict,
    svg_2d: str | None = None,
) -> None:
    replacements = {
        "%%TITLE%%": html.escape(name),
        "%%NAME%%": html.escape(name),
        "%%FORMULA%%": html.escape(info["formula"]),
        "%%MW%%": f"{info['mw']:.2f}",
        "%%HEAVY%%": str(info["heavy_atoms"]),
        "%%SMILES%%": html.escape(info["canonical_smiles"]),
        "%%TWO_D_BLOCK%%": _two_d_block(svg_2d),
        "%%MOL_JSON%%": web_json(data),
        "%%COLORS%%": web_json(ELEMENT_COLORS),
        "%%RADII%%": web_json(ELEMENT_RADII),
        "%%DEFAULT_COLOR%%": web_json(DEFAULT_COLOR),
        "%%DEFAULT_RADIUS%%": f"{DEFAULT_RADIUS}",
    }

    page = HTML_TEMPLATE
    for key, value in replacements.items():
        page = page.replace(key, value)
    path.write_text(page, encoding="utf-8")


def render_3d(
    mol: Chem.Mol,
    info: dict,
    name: str,
    stem: str,
    outdir: Path,
    *,
    svg_2d: str | None = None,
    open_browser: bool = False,
) -> dict[str, Path | bool]:
    outdir = ensure_outdir(outdir)

    print("\n  正在生成 3D 构象（ETKDG）...")
    mol3d = embed_3d(mol)
    data = viewer_data(mol3d, info, name)

    mol_path = outdir / f"{stem}-3d.mol"
    html_path = outdir / f"{stem}-3d.html"
    png_path = outdir / f"{stem}-3d.png"

    write_mol(mol3d, mol_path, name)
    write_3d_html(data, html_path, name=name, info=info, svg_2d=svg_2d)
    try:
        png_ok = render_3d_png(mol3d, info, png_path)
    except Exception as exc:
        print(f"  ! 3D 预览图生成失败：{exc}")
        png_ok = False

    if open_browser:
        try:
            webbrowser.open(html_path.as_uri())
        except Exception:
            pass

    return {
        "html": html_path,
        "mol": mol_path,
        "png": png_path,
        "png_ok": png_ok,
        "atoms": len(data["atoms"]),
    }


def main() -> int:
    parser = build_parser(
        "把 SMILES 生成 3D 球棍模型（HTML + MOL + PNG）",
        allow_open=True,
    )
    args = resolve_args(parser.parse_args())

    try:
        mol = parse_smiles(args.smiles)
    except UserInputError as exc:
        print(f"\n✗ {exc}\n")
        return 1

    info = describe_molecule(mol)
    name = display_name(info, args.name)
    stem = output_stem(info, args.name)

    print(f"\n=== {name} ===")
    print("  输入 SMILES:", args.smiles)
    print_molecule_info(info)

    try:
        paths = render_3d(
            mol,
            info,
            name,
            stem,
            Path(args.outdir),
            open_browser=args.open,
        )
    except UserInputError as exc:
        print(f"\n✗ {exc}\n")
        return 1
    except Exception as exc:
        print(f"\n✗ 3D 生成失败：{exc}\n")
        return 1

    print(f"\n  3D 网页   : {fmt_path(Path(paths['html']))}")
    print(f"  3D 坐标   : {fmt_path(Path(paths['mol']))}（{paths['atoms']} 个原子，含氢）")
    if paths["png_ok"]:
        print(f"  3D 预览图 : {fmt_path(Path(paths['png']))}")
    else:
        print("  3D 预览图 : 跳过（未安装 matplotlib）")

    print("\n完成。双击 3D HTML，或运行：")
    print(f"    python -m http.server 8000 -d \"{Path(args.outdir).resolve()}\"")
    print("然后访问 http://127.0.0.1:8000/ 也可以。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
