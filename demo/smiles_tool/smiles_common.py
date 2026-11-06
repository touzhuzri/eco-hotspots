#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMILES 工具共用代码
===================

这里放三个脚本都会用到的东西：
  - 读取命令行 / 交互输入
  - 解析 SMILES，计算分子式、分子量等
  - 用 RDKit ETKDG 生成 3D 构象
  - 把 3D 坐标整理成网页画布需要的数据

本文件不负责生成输出；请运行：
    python smiles_2d.py
    python smiles_3d.py
    python smiles_both.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    from rdkit import Chem
    from rdkit.Chem import AllChem, Descriptors, rdMolDescriptors
except ImportError as exc:  # pragma: no cover - only shown when dependency is missing
    raise SystemExit(
        "缺少 RDKit，无法解析 SMILES。\n"
        "请在 VSCode 终端运行：\n"
        "    python -m pip install -r requirements.txt\n"
        f"\n原始错误：{exc}"
    ) from exc


def _configure_console() -> None:
    """Windows 默认可能是 GBK；统一成 UTF-8，避免中文或 Å² 报错。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


_configure_console()


HERE = Path(__file__).resolve().parent
DEFAULT_OUTDIR = HERE / "outputs"

# 默认示例：咖啡因（回车直接使用）
DEFAULT_SMILES = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"
DEFAULT_NAME = "Caffeine"

EXAMPLES = [
    ("咖啡因 Caffeine", "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"),
    ("阿司匹林 Aspirin", "CC(=O)Oc1ccccc1C(=O)O"),
    ("乙醇 Ethanol", "CCO"),
    ("苯 Benzene", "c1ccccc1"),
]

# 元素颜色（深色背景上也能看清的 CPK 风格）
ELEMENT_COLORS = {
    "H": "#f2f6fb",
    "C": "#c9d3e0",
    "N": "#5b8cff",
    "O": "#ff5f5f",
    "F": "#68e0a4",
    "Cl": "#4fd36b",
    "Br": "#d98a5b",
    "I": "#b57bff",
    "S": "#f4d35e",
    "P": "#ff9f43",
    "B": "#f0a6ca",
    "Si": "#b8b8c8",
}
DEFAULT_COLOR = "#b9a7d8"

# 画布上的相对原子半径（不是真实范德华半径，只用于球棍模型）
ELEMENT_RADII = {
    "H": 0.20,
    "C": 0.32,
    "N": 0.31,
    "O": 0.30,
    "F": 0.29,
    "Cl": 0.36,
    "Br": 0.38,
    "I": 0.40,
    "S": 0.39,
    "P": 0.39,
    "B": 0.34,
    "Si": 0.38,
}
DEFAULT_RADIUS = 0.33


class UserInputError(ValueError):
    """给用户看的、不需要 traceback 的输入错误。"""


# ---------------------------------------------------------------------------
# 命令行 / 交互输入
# ---------------------------------------------------------------------------


def build_parser(description: str, *, allow_open: bool = False) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=description,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例：\n"
            "  python %(prog)s\n"
            "  python %(prog)s \"CC(=O)Oc1ccccc1C(=O)O\"\n"
            "  python %(prog)s \"CCO\" --name Ethanol --open\n"
        ),
    )
    parser.add_argument(
        "smiles",
        nargs="?",
        help="要解析的 SMILES；省略时会进入交互输入",
    )
    parser.add_argument(
        "-n",
        "--name",
        default="",
        help="显示名称，同时用于输出文件名（可选）",
    )
    parser.add_argument(
        "-o",
        "--outdir",
        default=str(DEFAULT_OUTDIR),
        help=f"输出目录（默认：{DEFAULT_OUTDIR}）",
    )
    if allow_open:
        parser.add_argument(
            "--open",
            action="store_true",
            help="生成后用默认浏览器打开 3D HTML",
        )
    return parser


def ask_smiles() -> str:
    """没有命令行参数时，让用户在终端输入一行 SMILES。"""
    print("=" * 64)
    print("  SMILES → 2D / 3D 分子结构")
    print("=" * 64)
    print("  输入化学家使用的 SMILES 简写，程序会画出平面结构式")
    print("  并生成可旋转的 3D 球棍模型。")
    print()
    print("  示例：")
    for label, smiles in EXAMPLES:
        print(f"    {label:<16} {smiles}")
    print()
    print("  直接回车 = 咖啡因；输入 q = 退出。")
    print()

    try:
        raw = input("SMILES> ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        raise SystemExit("已退出。")

    if raw.lower() in {"q", "quit", "exit"}:
        raise SystemExit("已退出。")
    if not raw:
        raw = DEFAULT_SMILES
    return raw


def resolve_args(args: argparse.Namespace) -> argparse.Namespace:
    """补全交互输入，并去掉用户可能带上的引号。"""
    smiles = (args.smiles or "").strip()
    if not smiles:
        smiles = ask_smiles()
    if len(smiles) >= 2 and smiles[0] == smiles[-1] and smiles[0] in "\"'":
        smiles = smiles[1:-1].strip()
    # SMILES 本身不含空格；允许用户从别处粘贴时夹带换行/空格
    smiles = re.sub(r"\s+", "", smiles)
    args.smiles = smiles
    return args


# ---------------------------------------------------------------------------
# 分子信息
# ---------------------------------------------------------------------------


def parse_smiles(smiles: str) -> Chem.Mol:
    if not smiles:
        raise UserInputError("SMILES 为空。")
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise UserInputError(
            "这个 SMILES 解析失败。请检查括号、环编号、元素符号是否完整。"
        )
    if mol.GetNumAtoms() == 0:
        raise UserInputError("SMILES 没有解析出任何原子。")
    return mol


def describe_molecule(mol: Chem.Mol) -> dict[str, Any]:
    """收集网页和命令行都要展示的分子属性。"""
    try:
        inchikey = Chem.MolToInchiKey(mol) or ""
    except Exception:
        inchikey = ""

    try:
        canonical = Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)
    except Exception:
        canonical = Chem.MolToSmiles(mol, canonical=True)

    return {
        "canonical_smiles": canonical,
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "mw": round(float(Descriptors.MolWt(mol)), 3),
        "heavy_atoms": int(mol.GetNumHeavyAtoms()),
        "atoms": int(mol.GetNumAtoms()),
        "rings": int(rdMolDescriptors.CalcNumRings(mol)),
        "hbd": int(rdMolDescriptors.CalcNumHBD(mol)),
        "hba": int(rdMolDescriptors.CalcNumHBA(mol)),
        "tpsa": round(float(rdMolDescriptors.CalcTPSA(mol)), 2),
        "logp": round(float(Descriptors.MolLogP(mol)), 2),
        "inchikey": inchikey,
    }


def print_molecule_info(info: dict[str, Any]) -> None:
    print()
    print("  分子式    :", info["formula"])
    print("  分子量    :", f"{info['mw']:.2f}")
    print("  重原子数  :", info["heavy_atoms"])
    print("  环数      :", info["rings"])
    print("  HBD / HBA :", f"{info['hbd']} / {info['hba']}")
    print("  TPSA      :", f"{info['tpsa']:.2f} A^2")
    print("  XLogP     :", f"{info['logp']:.2f}")
    print("  规范 SMILES:", info["canonical_smiles"])
    if info["inchikey"]:
        print("  InChIKey  :", info["inchikey"])


_DEFAULT_CANONICAL = Chem.MolToSmiles(
    Chem.MolFromSmiles(DEFAULT_SMILES), canonical=True
)


def display_name(info: dict[str, Any], requested_name: str = "") -> str:
    if requested_name.strip():
        return requested_name.strip()
    if info["canonical_smiles"] == _DEFAULT_CANONICAL:
        return DEFAULT_NAME
    return "Molecule"


def _slugify(text: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", text.strip())
    return re.sub(r"-{2,}", "-", slug).strip("-._")


def output_stem(info: dict[str, Any], requested_name: str = "") -> str:
    """生成安全、可读的输出文件名前缀。"""
    if requested_name.strip():
        slug = _slugify(requested_name)
        if slug:
            return slug

    # 默认咖啡因示例给一个友好文件名；自定义分子用分子式 + InChIKey 避免重名
    if info["canonical_smiles"] == _DEFAULT_CANONICAL:
        return DEFAULT_NAME

    formula = _slugify(info["formula"]) or "molecule"
    if info["inchikey"]:
        return f"{formula}-{info['inchikey'][:14].lower()}"
    digest = hashlib.sha1(info["canonical_smiles"].encode("utf-8")).hexdigest()[:8]
    return f"{formula}-{digest}"


def ensure_outdir(outdir: str | Path) -> Path:
    path = Path(outdir).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


# ---------------------------------------------------------------------------
# 3D 构象
# ---------------------------------------------------------------------------


def embed_3d(mol: Chem.Mol, seed: int = 0xC0FFEE, optimize: bool = True) -> Chem.Mol:
    """
    从 SMILES 生成一个 3D 构象。

    ETKDGv3 负责按键长、键角、环和手性约束摆出初始结构；
    MMFF（没有参数时回退 UFF）再做一次力场优化。
    """
    heavy = int(mol.GetNumHeavyAtoms())
    if heavy > 300:
        raise UserInputError(
            f"这个分子有 {heavy} 个重原子，3D 构象生成可能非常慢。"
            "请换一个更小的分子。"
        )

    mh = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = int(seed)
    params.maxIterations = 300
    params.timeout = 20
    params.useSmallRingTorsions = True

    if AllChem.EmbedMolecule(mh, params) != 0:
        # 有些大环 / 柔性分子需要随机初始坐标才能成功
        params.useRandomCoords = True
        params.maxIterations = 1000
        params.timeout = 40
        if AllChem.EmbedMolecule(mh, params) != 0:
            raise UserInputError(
                "3D 构象生成失败。这个 SMILES 可能包含 RDKit 难以处理的环系。"
            )

    if optimize:
        try:
            AllChem.MMFFOptimizeMolecule(mh, maxIters=500)
        except Exception:
            try:
                AllChem.UFFOptimizeMolecule(mh, maxIters=500)
            except Exception:
                pass

    return mh


def viewer_data(
    mol3d: Chem.Mol,
    info: dict[str, Any],
    name: str,
) -> dict[str, Any]:
    """把 RDKit 的 3D 构象整理成 HTML 画布可直接使用的 JSON。"""
    conf = mol3d.GetConformer()

    # 以重原子质心为原点，避免氢原子把中心拉偏
    heavy_indices = [a.GetIdx() for a in mol3d.GetAtoms() if a.GetAtomicNum() > 1]
    if heavy_indices:
        cx = sum(conf.GetAtomPosition(i).x for i in heavy_indices) / len(heavy_indices)
        cy = sum(conf.GetAtomPosition(i).y for i in heavy_indices) / len(heavy_indices)
        cz = sum(conf.GetAtomPosition(i).z for i in heavy_indices) / len(heavy_indices)
    else:
        cx = cy = cz = 0.0

    atoms: list[dict[str, Any]] = []
    for atom in mol3d.GetAtoms():
        p = conf.GetAtomPosition(atom.GetIdx())
        atoms.append(
            {
                "e": atom.GetSymbol(),
                "x": round(float(p.x - cx), 3),
                "y": round(float(p.y - cy), 3),
                "z": round(float(p.z - cz), 3),
            }
        )

    bonds: list[list[float | int]] = []
    for bond in mol3d.GetBonds():
        order = float(bond.GetBondTypeAsDouble())
        if bond.GetIsAromatic():
            order = 1.5
        bonds.append([bond.GetBeginAtomIdx(), bond.GetEndAtomIdx(), order])

    return {
        "name": name,
        "smiles": info["canonical_smiles"],
        "formula": info["formula"],
        "mw": info["mw"],
        "heavyAtoms": info["heavy_atoms"],
        "atoms": atoms,
        "bonds": bonds,
    }


def web_json(data: dict[str, Any]) -> str:
    """紧凑 JSON，并防止名称里出现 </script> 破坏页面。"""
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return text.replace("<", "\\u003c").replace(">", "\\u003e")


def write_mol(mol3d: Chem.Mol, path: Path, name: str) -> None:
    mol = Chem.Mol(mol3d)
    mol.SetProp("_Name", name)
    path.write_text(Chem.MolToMolBlock(mol), encoding="utf-8")


# ---------------------------------------------------------------------------
# 3D PNG 预览（matplotlib 可选）
# ---------------------------------------------------------------------------


def render_3d_png(
    mol3d: Chem.Mol,
    info: dict[str, Any],
    path: Path,
    *,
    size: tuple[int, int] = (1400, 1050),
    dpi: int = 150,
) -> bool:
    """
    用 matplotlib 画一张 3D 球棍模型预览图。
    没有安装 matplotlib 时返回 False，不影响 HTML / MOL 输出。
    """
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        return False

    conf = mol3d.GetConformer()
    coords = np.array(
        [
            [conf.GetAtomPosition(i).x, conf.GetAtomPosition(i).y, conf.GetAtomPosition(i).z]
            for i in range(mol3d.GetNumAtoms())
        ],
        dtype=float,
    )
    symbols = [a.GetSymbol() for a in mol3d.GetAtoms()]

    # 用重原子的主成分轴摆正分子；平面分子也能以较好看的视角出现
    heavy = np.array([i for i, s in enumerate(symbols) if s != "H"], dtype=int)
    sample = coords[heavy] if len(heavy) >= 3 else coords
    center = sample.mean(axis=0)
    centered = sample - center
    try:
        _vals, vecs = np.linalg.eigh(centered.T @ centered)
        order = np.argsort(_vals)[::-1]
        rotation = vecs[:, order].T
        if np.linalg.det(rotation) < 0:
            rotation[2] *= -1
    except np.linalg.LinAlgError:
        rotation = np.eye(3)

    xyz = (coords - center) @ rotation.T

    bg = "#0b1220"
    fig = plt.figure(figsize=(size[0] / dpi, size[1] / dpi), dpi=dpi, facecolor=bg)
    ax = fig.add_subplot(111, projection="3d", facecolor=bg)
    ax.set_facecolor(bg)

    # 键
    for bond in mol3d.GetBonds():
        i, j = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        if symbols[i] == "H" or symbols[j] == "H":
            continue
        ax.plot(
            [xyz[i, 0], xyz[j, 0]],
            [xyz[i, 1], xyz[j, 1]],
            [xyz[i, 2], xyz[j, 2]],
            color="#9fb0c6",
            linewidth=2.2,
            solid_capstyle="round",
            zorder=1,
        )

    # 原子（只画重原子，氢隐含）
    sizes = {
        "C": 340,
        "N": 390,
        "O": 390,
        "S": 460,
        "P": 460,
        "F": 300,
        "Cl": 390,
        "Br": 420,
        "I": 440,
        "B": 360,
    }
    for i, symbol in enumerate(symbols):
        if symbol == "H":
            continue
        ax.scatter(
            [xyz[i, 0]],
            [xyz[i, 1]],
            [xyz[i, 2]],
            s=sizes.get(symbol, 340),
            c=ELEMENT_COLORS.get(symbol, DEFAULT_COLOR),
            edgecolors="#f4f8ff",
            linewidths=0.9,
            depthshade=False,
            zorder=3,
        )

    span = xyz.max(axis=0) - xyz.min(axis=0)
    max_span = max(float(span.max()), 1.0)
    mid = (xyz.max(axis=0) + xyz.min(axis=0)) / 2
    half = max_span * 0.58
    ax.set_xlim(mid[0] - half, mid[0] + half)
    ax.set_ylim(mid[1] - half, mid[1] + half)
    ax.set_zlim(mid[2] - half, mid[2] + half)
    # 平面分子从上方看，立体分子用较低视角；否则苯环会看起来像一条线
    planarity = float(span[2] / max(float(span[0]), float(span[1]), 1e-6))
    elev = 62 if planarity < 0.42 else 24
    ax.set_box_aspect((1, 1, 1), zoom=2.0)
    ax.view_init(elev=elev, azim=30)
    ax.set_axis_off()

    ax.set_title(
        f"{info['formula']}   MW {info['mw']:.2f}",
        color="#dce8f8",
        fontsize=15,
        pad=10,
    )
    fig.subplots_adjust(left=0, right=1, bottom=0, top=0.94)
    fig.savefig(path, facecolor=bg, dpi=dpi, bbox_inches="tight", pad_inches=0.12)
    plt.close(fig)
    return True


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------


def fmt_path(path: Path) -> str:
    """打印相对路径，VSCode 终端里更容易阅读。"""
    try:
        return str(path.relative_to(HERE))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    print(__doc__.strip())
    print("\n请运行 smiles_2d.py、smiles_3d.py 或 smiles_both.py。")
