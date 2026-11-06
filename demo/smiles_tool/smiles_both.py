#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMILES → 2D + 3D（推荐入口）
============================

在 VSCode 里打开本文件，点右上角“运行”，然后在终端输入 SMILES。
也可以直接把 SMILES 放在命令行参数里。

一次生成：
    <名字>-2d.svg     2D 结构式（矢量）
    <名字>-2d.png     2D 结构式（位图）
    <名字>-3d.html    左侧 2D + 右侧可旋转 3D 的单文件网页
    <名字>-3d.mol     3D 坐标文件
    <名字>-3d.png     3D 预览图

用法：
    python smiles_both.py
    python smiles_both.py "CC(=O)Oc1ccccc1C(=O)O"
    python smiles_both.py "CCO" --name Ethanol --open
"""

from __future__ import annotations

from pathlib import Path

from smiles_common import (
    UserInputError,
    build_parser,
    describe_molecule,
    display_name,
    fmt_path,
    output_stem,
    parse_smiles,
    print_molecule_info,
    resolve_args,
)
from smiles_2d import render_2d
from smiles_3d import render_3d


def main() -> int:
    parser = build_parser(
        "输入一个 SMILES，一次生成 2D 结构式和 3D 球棍模型",
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
    outdir = Path(args.outdir)

    print(f"\n=== {name} ===")
    print("  输入 SMILES:", args.smiles)
    print_molecule_info(info)

    try:
        paths_2d = render_2d(mol, info, name, stem, outdir)
        paths_3d = render_3d(
            mol,
            info,
            name,
            stem,
            outdir,
            svg_2d=str(paths_2d["svg_text"]),
            open_browser=args.open,
        )
    except UserInputError as exc:
        print(f"\n✗ {exc}\n")
        return 1
    except Exception as exc:
        print(f"\n✗ 生成失败：{exc}\n")
        return 1

    print("\n  2D 矢量图 :", fmt_path(Path(paths_2d["svg"])))
    print("  2D 位图   :", fmt_path(Path(paths_2d["png"])))
    print("  3D 网页   :", fmt_path(Path(paths_3d["html"])))
    print(f"  3D 坐标   : {fmt_path(Path(paths_3d['mol']))}（{paths_3d['atoms']} 个原子，含氢）")
    if paths_3d["png_ok"]:
        print("  3D 预览图 :", fmt_path(Path(paths_3d["png"])))
    else:
        print("  3D 预览图 : 跳过（未安装 matplotlib）")

    print("\n完成。推荐双击 3D 网页：2D 结构式和可旋转的 3D 模型在同一页。")
    print("如果浏览器不允许直接打开本地 HTML，可以运行：")
    print(f"    python -m http.server 8000 -d \"{outdir.resolve()}\"")
    print("然后访问 http://127.0.0.1:8000/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
