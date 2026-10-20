"""
Build LOTUS molecule metadata shards for the detail panel.

Input : 19360665/260413_frozen_metadata.csv.gz  (LOTUS frozen 260413, CC0)
Output: data/molecules/<XX>.json                (sharded by InChIKey prefix)

Only LOTUS fields are used. No COCONUT / NPASS / ChEMBL data is merged.

Usage:
    python pipeline/build-molecule-meta.py

Requires: rdkit (for structural descriptors; optional but recommended)
"""

import csv
import gzip
import json
import math
import os
import sys
import time
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "19360665", "260413_frozen_metadata.csv.gz")
OUT_DIR = os.path.join(ROOT, "data", "molecules")

try:
    from rdkit import Chem, RDLogger
    from rdkit.Chem import rdMolDescriptors

    RDLogger.DisableLog("rdApp.*")
    HAVE_RDKIT = True
except Exception:  # pragma: no cover
    HAVE_RDKIT = False


def clean(v):
    v = (v or "").strip()
    return v if v and v not in ("NA", "N/A", "null") else ""


def num(v, nd=6):
    try:
        x = float(v)
        if not math.isfinite(x):
            return None
        return round(x, nd)
    except Exception:
        return None


def descriptors(smiles):
    if not HAVE_RDKIT or not smiles:
        return None
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    try:
        return {
            "atoms": mol.GetNumAtoms(),
            "rings": rdMolDescriptors.CalcNumRings(mol),
            "aromaticRings": rdMolDescriptors.CalcNumAromaticRings(mol),
            "hbd": rdMolDescriptors.CalcNumHBD(mol),
            "hba": rdMolDescriptors.CalcNumHBA(mol),
            "tpsa": round(rdMolDescriptors.CalcTPSA(mol), 2),
            "rotatableBonds": rdMolDescriptors.CalcNumRotatableBonds(mol),
            "fractionCsp3": round(rdMolDescriptors.CalcFractionCSP3(mol), 3),
        }
    except Exception:
        return None


def wikidata_id(url):
    return (url or "").rsplit("/", 1)[-1] if url else ""


def main():
    if not os.path.exists(SRC):
        print("missing", SRC, file=sys.stderr)
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    records = {}
    rows = 0
    started = time.time()

    with gzip.open(SRC, "rt", encoding="utf-8", errors="replace", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows += 1
            key = clean(row.get("structure_inchikey"))
            if not key or key in records:
                continue

            smiles = clean(row.get("structure_smiles")) or clean(
                row.get("structure_smiles_2D")
            )
            np_path = [
                clean(row.get("structure_taxonomy_npclassifier_01pathway")),
                clean(row.get("structure_taxonomy_npclassifier_02superclass")),
                clean(row.get("structure_taxonomy_npclassifier_03class")),
            ]
            classyfire = clean(
                row.get("structure_taxonomy_classyfire_04directparent")
            )
            cid = num(row.get("structure_cid"), 0)
            stereo = num(row.get("structure_stereocenters_total"), 0)
            name = (
                clean(row.get("structure_nameTraditional"))
                or clean(row.get("structure_nameIupac"))
            )[:220]
            desc = descriptors(smiles) or {}

            # Compact array schema shared with src/engine/moleculeMeta.js
            rec = [
                smiles,
                clean(row.get("structure_molecular_formula")),
                num(row.get("structure_exact_mass")),
                num(row.get("structure_xlogp"), 3),
                [x for x in np_path if x],
                classyfire,
                clean(row.get("organism_taxonomy_06family")),
                clean(row.get("reference_doi")),
                int(cid) if cid is not None else None,
                wikidata_id(row.get("structure_wikidata")),
                int(stereo) if stereo is not None else None,
                desc.get("rings"),
                desc.get("aromaticRings"),
                desc.get("hbd"),
                desc.get("hba"),
                desc.get("tpsa"),
                desc.get("rotatableBonds"),
                desc.get("fractionCsp3"),
                name,
            ]
            records[key] = rec

            if rows % 50000 == 0:
                print(
                    f"  rows {rows:,} · unique {len(records):,} "
                    f"· {time.time()-started:.1f}s",
                    flush=True,
                )

    print(
        f"parsed rows {rows:,} · unique keys {len(records):,} "
        f"· {time.time()-started:.1f}s",
        flush=True,
    )

    shards = defaultdict(dict)
    for key, rec in records.items():
        prefix = key[:2].upper()
        shards[prefix][key] = rec

    total_bytes = 0
    for prefix, payload in sorted(shards.items()):
        path = os.path.join(OUT_DIR, f"{prefix}.json.gz")
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        total_bytes += os.path.getsize(path)

    manifest = {
        "source": "LOTUS frozen 260413",
        "license": "CC0",
        "rows": rows,
        "molecules": len(records),
        "shards": len(shards),
        "rdkit": HAVE_RDKIT,
        "generated": time.strftime("%Y-%m-%d"),
    }
    with open(
        os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8"
    ) as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    print(
        f"wrote {len(shards)} shards · {total_bytes/1e6:.1f}MB "
        f"· rdkit={HAVE_RDKIT}",
        flush=True,
    )


if __name__ == "__main__":
    main()
