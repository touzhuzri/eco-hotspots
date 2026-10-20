"""从 LOTUS 元数据分片里抽取长链烷烃，供土壤层“烷烃蠕动”动画随机取用。

筛选条件：
- NPClassifier 含 Hydrocarbons
- 仅 C、仅单键、无环、碳数 >= 10
- 用 RDKit 生成 2D 碳骨架坐标

输出 data/curated/soil-alkanes.json
"""

import glob
import gzip
import json
import os

from rdkit import Chem
from rdkit.Chem import rdDepictor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARDS = os.path.join(ROOT, "data", "molecules", "*.json.gz")
OUT = os.path.join(ROOT, "data", "curated", "soil-alkanes.json")

rdDepictor.SetPreferCoordGen(True)

items = []
for path in sorted(glob.glob(SHARDS)):
    if os.path.basename(path) == "facets.json.gz":
        continue
    with gzip.open(path, "rt", encoding="utf-8") as f:
        shard = json.load(f)
    for key, v in shard.items():
        if not isinstance(v, list) or len(v) < 19:
            continue
        classes = v[4] or []
        if not any("Hydrocarbons" in c for c in classes):
            continue
        smiles = v[0]
        if not smiles:
            continue
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            continue
        mol = Chem.RemoveHs(mol)
        if mol.GetNumAtoms() < 10:
            continue
        if any(a.GetSymbol() != "C" for a in mol.GetAtoms()):
            continue
        if any(b.GetBondType() != Chem.BondType.SINGLE for b in mol.GetBonds()):
            continue
        if mol.GetRingInfo().NumRings() != 0:
            continue
        try:
            rdDepictor.Compute2DCoords(mol)
        except Exception:
            continue
        conf = mol.GetConformer()
        atoms = []
        for i in range(mol.GetNumAtoms()):
            p = conf.GetAtomPosition(i)
            atoms.append([round(p.x, 4), round(p.y, 4)])
        bonds = [
            [b.GetBeginAtomIdx(), b.GetEndAtomIdx()] for b in mol.GetBonds()
        ]
        items.append(
            {
                "k": key,
                "n": v[18] or "",
                "c": mol.GetNumAtoms(),
                "cls": classes,
                "fam": v[6] or "",
                "a": atoms,
                "b": bonds,
            }
        )

items.sort(key=lambda x: (x["c"], x["n"], x["k"]))
out = {
    "meta": {
        "source": "LOTUS frozen 260413（CC0）",
        "note": "NPClassifier = Hydrocarbons；饱和无环、仅碳；RDKit 2D 骨架坐标",
        "count": len(items),
    },
    "items": items,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("wrote", OUT, "items", len(items), "bytes", os.path.getsize(OUT))
