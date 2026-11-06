# SMILES → 2D / 3D

在 VSCode 里运行 Python，输入一行 SMILES，生成：

- **2D 结构式**：`SVG` + `PNG`
- **3D 球棍模型**：可旋转的离线 `HTML` + `MOL` 坐标 + `PNG` 预览

所有文件都放在这个子目录里，不改动世界树项目的其它代码。

## 一、安装依赖

需要 Python 3.10+ 和 RDKit（3D 预览图还需要 matplotlib）。

在 VSCode 终端进入本目录：

```bash
cd demo/smiles_tool
python -m pip install -r requirements.txt
```

如果本机已经装过 RDKit，可以跳过。检查：

```bash
python -c "import rdkit; print(rdkit.__version__)"
```

## 二、在 VSCode 里运行

1. 用 VSCode 打开项目根目录（或直接打开 `demo/smiles_tool`）。
2. 打开 `smiles_both.py`。
3. 点右上角 **▷ Run Python File**，或按 `Ctrl+F5`。
4. 在下方终端出现提示后输入 SMILES，例如：

```text
SMILES> CC(=O)Oc1ccccc1C(=O)O
```

直接回车会使用内置的咖啡因示例；输入 `q` 退出。

> 如果点“运行”后没有看到输入提示，请确认运行的是 **Terminal**（终端）而不是 Output 面板。也可以在 VSCode 终端里执行：
>
> ```bash
> python smiles_both.py
> ```

## 三、输出在哪里

默认写入 `demo/smiles_tool/outputs/`：

```text
outputs/
  Caffeine-2d.svg
  Caffeine-2d.png
  Caffeine-3d.html   ← 推荐打开这个
  Caffeine-3d.mol
  Caffeine-3d.png
```

如果输入自定义 SMILES 且没有 `--name`，文件前缀会自动使用「分子式 + InChIKey」，
例如 `C8H10N4O2-ryyvlzvuvijvgh-2d.svg`，这样不同分子不会互相覆盖。

`-3d.html` 是单文件、离线可用的页面：左侧是 2D 结构式，右侧是可以拖动旋转、滚轮缩放的 3D 球棍模型。

- 拖动：旋转
- 滚轮：缩放
- 双击：重置视角
- “显示氢原子”：显示 / 隐藏氢原子

如果浏览器限制直接打开本地 HTML，可以在本目录运行：

```bash
python -m http.server 8000 -d outputs
```

然后访问 <http://127.0.0.1:8000/>。

## 四、三个入口脚本

| 文件 | 作用 |
| --- | --- |
| `smiles_both.py` | **推荐**：一次生成 2D + 3D，并做成一页 HTML |
| `smiles_2d.py` | 只生成 2D 的 SVG / PNG |
| `smiles_3d.py` | 只生成 3D 的 HTML / MOL / PNG |

三个脚本都支持两种输入方式：

```bash
# 1. 交互输入
python smiles_2d.py

# 2. 直接把 SMILES 放在命令行
python smiles_2d.py "CC(=O)Oc1ccccc1C(=O)O"
python smiles_3d.py "CCO" --name Ethanol --open
python smiles_both.py "CN1C=NC2=C1C(=O)N(C(=O)N2C)C" --name Caffeine
```

常用参数：

```text
-n, --name NAME     显示名称，同时作为输出文件名
-o, --outdir DIR    输出目录（默认 outputs/）
--open              生成后用默认浏览器打开 3D HTML（仅 3d / both）
```

## 五、SMILES 小抄

| 写法 | 含义 |
| --- | --- |
| `C` / `O` / `N` | 碳 / 氧 / 氮 |
| `c1ccccc1` | 苯环 |
| `=` / `#` | 双键 / 三键 |
| `C(=O)O` | 羧基 |
| 数字 `1`、`2` | 成环的接口 |
| `@` / `@@` | 手性方向 |

常见示例：

```text
咖啡因     CN1C=NC2=C1C(=O)N(C(=O)N2C)C
阿司匹林   CC(=O)Oc1ccccc1C(=O)O
乙醇       CCO
苯         c1ccccc1
葡萄糖     OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O
```

## 六、实现说明

- 2D：RDKit `rdMolDraw2D`，自动排版并绘制杂原子颜色。
- 3D：RDKit `ETKDGv3` 生成构象，`MMFF`（无参数时回退 `UFF`）优化。
- 3D 网页：纯 Canvas / JavaScript 球棍模型，不依赖 CDN，离线可用。
- 数据来源：你输入的 SMILES；脚本不会上传任何内容。
