#!/usr/bin/env python3
"""
构建相似分子索引（Morgan 指纹 + Tanimoto 用）

输入：data/molecules/*.json.gz（LOTUS 分片，key=InChIKey）
输出（data/similarity/）：
  morgan1024.bin   N × 128 bytes 的位图
  keys.json.gz     与位图行对齐的 InChIKey 数组
  meta.json.gz     与位图行对齐的展示字段
  manifest.json    位数/半径/数量/生成时间

用法（需要 Python 3 + RDKit）：
  python pipeline/build-molecule-similarity.py
  python pipeline/build-molecule-similarity.py --limit 2000   # 小样本试跑
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time

import numpy as np
from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem

RDLogger.DisableLog("rdApp.*")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_IN = os.path.join(ROOT, "data", "molecules")
DEFAULT_OUT = os.path.join(ROOT, "data", "similarity")


def fp_bytes(mol, bits: int) -> bytes:
    fp = AllChem.GetMorganFingerprintAsBitVect(mol, 2, nBits=bits)
    s = fp.ToBitString()
    arr = np.frombuffer(s.encode("ascii"), dtype=np.uint8) - ord("0")
    return np.packbits(arr).tobytes()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=DEFAULT_IN)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--bits", type=int, default=1024)
    ap.add_argument("--limit", type=int, default=0, help="0 = 全量")
    args = ap.parse_args()

    if args.bits % 8:
        print("bits 必须是 8 的倍数", file=sys.stderr)
        return 2

    files = sorted(
        f for f in os.listdir(args.data) if f.endswith(".json.gz")
    )
    if not files:
        print(f"没有找到 {args.data}/*.json.gz", file=sys.stderr)
        return 2

    os.makedirs(args.out, exist_ok=True)
    fp_path = os.path.join(args.out, "morgan%d.bin" % args.bits)
    keys_path = os.path.join(args.out, "keys.json.gz")
    meta_path = os.path.join(args.out, "meta.json.gz")
    manifest_path = os.path.join(args.out, "manifest.json")

    keys: list[str] = []
    meta: list[dict] = []
    seen = 0
    started = time.time()

    with open(fp_path, "wb") as fout:
        for fi, name in enumerate(files):
            with gzip.open(os.path.join(args.data, name), "rt", encoding="utf-8") as fh:
                obj = json.load(fh)
            for key, v in obj.items():
                if not isinstance(v, list):
                    continue
                smiles = v[0] if v else ""
                if not isinstance(smiles, str) or not smiles:
                    continue
                mol = Chem.MolFromSmiles(smiles)
                if mol is None:
                    continue
                try:
                    fout.write(fp_bytes(mol, args.bits))
                except Exception:
                    continue
                keys.append(key)
                name = v[18] if len(v) > 18 and isinstance(v[18], str) else ""
                family = v[6] if len(v) > 6 and isinstance(v[6], str) else ""
                classes = (
                    [c for c in v[4] if isinstance(c, str)]
                    if len(v) > 4 and isinstance(v[4], list)
                    else []
                )
                formula = v[1] if len(v) > 1 and isinstance(v[1], str) else ""
                try:
                    mass = float(v[2]) if len(v) > 2 else 0
                except Exception:
                    mass = 0
                try:
                    xlogp = float(v[3]) if len(v) > 3 else 0
                except Exception:
                    xlogp = 0
                meta.append(
                    {
                        "key": key,
                        "name": name,
                        "family": family,
                        "classes": classes,
                        "formula": formula,
                        "mass": mass,
                        "xlogp": xlogp,
                    }
                )
                seen += 1
                if args.limit and seen >= args.limit:
                    break
                if seen % 10000 == 0:
                    print(f"  {seen:,} fingerprints…", flush=True)
            if args.limit and seen >= args.limit:
                break
            if (fi + 1) % 50 == 0:
                print(
                    f"  shard {fi + 1}/{len(files)} · {seen:,} total",
                    flush=True,
                )

    with gzip.open(keys_path, "wt", encoding="utf-8") as fh:
        json.dump(keys, fh, ensure_ascii=False, separators=(",", ":"))
    with gzip.open(meta_path, "wt", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "bits": args.bits,
                "radius": 2,
                "count": len(keys),
                "source": "LOTUS frozen 260413",
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            },
            fh,
            ensure_ascii=False,
            indent=2,
        )

    size = os.path.getsize(fp_path)
    print(
        f"done: {len(keys):,} fingerprints · {size / 1024 / 1024:.1f} MB · {time.time() - started:.1f}s"
    )
    print(f"  {fp_path}")
    print(f"  {keys_path}")
    print(f"  {meta_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
