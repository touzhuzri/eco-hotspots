#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMILES → 2D 结构式
==================

在 VSCode 里直接运行本文件，终端会提示输入 SMILES；
也可以把 SMILES 作为命令行参数。

输出（默认写入同目录 outputs/）：
    <名字>-2d.svg   矢量结构式，浏览器 / VSCode 可直接预览
    <名字>-2d.png   位图结构式，方便贴进 Word / PPT

用法：
    python smiles_2d.py
    python smiles_2d.py "CC(=O)Oc1ccccc1C(=O)O"
    python smiles_2d.py "CCO" --name Ethanol
"""

from __future__ import annotations

from pathlib import Path

from rdkit import Chem
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D

from smiles_common import (
    UserInputError,
    build_parser,
    describe_molecule,
    display_name,
    ensure_outdir,
    fmt_path,
    output_stem,
    parse_smiles,
    print_molecule_info,
    resolve_args,
)

WIDTH = 900
HEIGHT = 650


def _prepare(mol: Chem.Mol) -> Chem.Mol:
    mol2 = Chem.Mol(mol)
    rdDepictor.Compute2DCoords(mol2)
    return mol2


def _legend(info: dict) -> str:
    return f"{info['formula']}    MW {info['mw']:.2f}"


def make_2d_svg(mol: Chem.Mol, info: dict, width: int = WIDTH, height: int = HEIGHT) -> str:
    mol2 = _prepare(mol)
    drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
    opts = drawer.drawOptions()
    opts.clearBackground = False
    opts.backgroundColour = (1.0, 1.0, 1.0, 1.0)
    opts.addStereoAnnotation = True
    opts.bondLineWidth = 2.0
    opts.padding = 0.07
    opts.minFontSize = 18
    opts.maxFontSize = 42
    opts.legendFontSize = 22
    rdMolDraw2D.PrepareAndDrawMolecule(drawer, mol2, legend=_legend(info))
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def make_2d_png(
    mol: Chem.Mol, info: dict, width: int = WIDTH, height: int = HEIGHT
) -> bytes:
    mol2 = _prepare(mol)
    drawer = rdMolDraw2D.MolDraw2DCairo(width, height)
    opts = drawer.drawOptions()
    opts.clearBackground = False
    opts.backgroundColour = (1.0, 1.0, 1.0, 1.0)
    opts.addStereoAnnotation = True
    opts.bondLineWidth = 2.0
    opts.padding = 0.07
    opts.minFontSize = 18
    opts.maxFontSize = 42
    opts.legendFontSize = 22
    rdMolDraw2D.PrepareAndDrawMolecule(drawer, mol2, legend=_legend(info))
    drawer.FinishDrawing()
    data = drawer.GetDrawingText()
    if isinstance(data, str):  # 某些 RDKit 构建会返回文本
        return data.encode("utf-8")
    return data


def render_2d(
    mol: Chem.Mol,
    info: dict,
    name: str,
    stem: str,
    outdir: Path,
) -> dict[str, Path | str]:
    outdir = ensure_outdir(outdir)
    svg_path = outdir / f"{stem}-2d.svg"
    png_path = outdir / f"{stem}-2d.png"

    svg_text = make_2d_svg(mol, info)
    svg_path.write_text(svg_text, encoding="utf-8")
    png_path.write_bytes(make_2d_png(mol, info))

    return {"svg": svg_path, "png": png_path, "svg_text": svg_text, "name": name}


def main() -> int:
    parser = build_parser("把 SMILES 画成 2D 结构式（SVG + PNG）")
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

    paths = render_2d(mol, info, name, stem, Path(args.outdir))

    print("\n  2D 结构式 :", fmt_path(Path(paths["svg"])))
    print("  2D 位图   :", fmt_path(Path(paths["png"])))
    print("\n完成。用 VSCode 点开 SVG/PNG 即可预览。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
