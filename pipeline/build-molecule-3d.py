"""
Build lightweight 3D conformers for LOTUS molecules.

Input : data/molecules/<XX>.json.gz   (LOTUS metadata already in this repo)
Output: data/molecules3d/<XX>.json.gz (sharded by InChIKey prefix)

Each record is deliberately compact for static hosting:
  {
    "a": ["C", "O", ...],          # heavy-atom elements
    "c": [x, y, z, ...],           # coordinates in Angstrom, 3 decimals
    "b": [[i, j, order], ...]      # bonds; order 1, 2, 3 or 1.5 (aromatic)
  }

A single conformer is generated with RDKit ETKDG from the LOTUS SMILES.
No COCONUT / NPASS / ChEMBL content is merged.

Usage:
    python pipeline/build-molecule-3d.py --prefixes AA,AB,AC --limit 250
    python pipeline/build-molecule-3d.py            # all prefixes, full catalog
"""

import argparse
import gzip
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META_DIR = os.path.join(ROOT, "data", "molecules")
OUT_DIR = os.path.join(ROOT, "data", "molecules3d")

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem

RDLogger.DisableLog("rdApp.*")


def make_3d(smiles, optimize=True):
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        # 过大的天然产物在浏览器里也会太挤；留给 2D 回退
        if mol.GetNumHeavyAtoms() > 150:
            return None
        mol = Chem.AddHs(mol)
        params = AllChem.ETKDGv3()
        params.randomSeed = 0xC0FFEE
        params.maxIterations = 200
        params.timeout = 8
        params.useSmallRingTorsions = True
        if AllChem.EmbedMolecule(mol, params) != 0:
            return None
        if optimize:
            try:
                AllChem.MMFFOptimizeMolecule(mol, maxIters=80)
            except Exception:
                pass
        mol = Chem.RemoveHs(mol)
        if mol.GetNumConformers() == 0:
            return None
        conf = mol.GetConformer()
        atoms = []
        coords = []
        for atom in mol.GetAtoms():
            atoms.append(atom.GetSymbol())
            p = conf.GetAtomPosition(atom.GetIdx())
            coords.extend(
                [round(float(p.x), 3), round(float(p.y), 3), round(float(p.z), 3)]
            )
        bonds = []
        for bond in mol.GetBonds():
            order = float(bond.GetBondTypeAsDouble())
            if bond.GetIsAromatic():
                order = 1.5
            bonds.append([bond.GetBeginAtomIdx(), bond.GetEndAtomIdx(), order])
        return {"a": atoms, "c": coords, "b": bonds}
    except Exception:
        return None


def build_prefix(prefix, limit, skip_existing=False, optimize=True):
    src = os.path.join(META_DIR, f"{prefix}.json.gz")
    if not os.path.exists(src):
        return 0, 0, 0
    out_path = os.path.join(OUT_DIR, f"{prefix}.json.gz")
    if skip_existing and os.path.exists(out_path):
        return 0, 0, 0
    with gzip.open(src, "rt", encoding="utf-8") as fh:
        rows = json.load(fh)
    out = {}
    attempted = 0
    started = time.time()
    for key, row in rows.items():
        if limit and attempted >= limit:
            break
        if not isinstance(row, list) or not row or not row[0]:
            continue
        attempted += 1
        rec = make_3d(row[0], optimize)
        if rec:
            out[key] = rec

    raw_size = 0
    if attempted:
        payload = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
        raw_size = len(payload)
        os.makedirs(OUT_DIR, exist_ok=True)
        with gzip.open(out_path, "wb", compresslevel=9) as fh:
            fh.write(payload)

    took = time.time() - started
    print(
        f"{prefix}: {len(out)}/{attempted} ok | "
        f"{raw_size / 1024:.1f} KiB raw | {took:.1f}s",
        flush=True,
    )
    return attempted, len(out), raw_size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--prefixes",
        default="",
        help="comma separated InChIKey prefixes; default = every metadata shard",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=0,
        help="max molecules attempted per shard (0 = all)",
    )
    ap.add_argument(
        "--workers",
        type=int,
        default=1,
        help="parallel shard workers (default 1)",
    )
    ap.add_argument(
        "--skip-existing",
        action="store_true",
        help="keep already generated shard files",
    )
    ap.add_argument(
        "--no-optimize",
        action="store_false",
        dest="optimize",
        help="skip MMFF optimization (faster; ETKDG geometry is enough for display)",
    )
    args = ap.parse_args()

    if args.prefixes:
        prefixes = [p.strip().upper() for p in args.prefixes.split(",") if p.strip()]
    else:
        prefixes = sorted(
            f[:2].upper()
            for f in os.listdir(META_DIR)
            if f.endswith(".json.gz") and len(f) >= 8
        )

    total_attempted = 0
    total_ok = 0
    if args.workers > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as ex:
            futs = {
                ex.submit(
                    build_prefix,
                    p,
                    args.limit,
                    args.skip_existing,
                    args.optimize,
                ): p
                for p in prefixes
            }
            for fut in as_completed(futs):
                try:
                    attempted, ok, _ = fut.result()
                except Exception as exc:
                    print(f"{futs[fut]}: ERROR {exc}", flush=True)
                    continue
                total_attempted += attempted
                total_ok += ok
    else:
        for prefix in prefixes:
            attempted, ok, _ = build_prefix(
                prefix, args.limit, args.skip_existing, args.optimize
            )
            total_attempted += attempted
            total_ok += ok

    print(
        f"done: {total_ok}/{total_attempted} conformers "
        f"({(100 * total_ok / max(total_attempted, 1)):.1f}% success)",
        flush=True,
    )


if __name__ == "__main__":
    main()
