# 内置知识库种子

这里的内容会随仓库提交，服务启动时由 `ai/rag.mjs` 的 `ensureBuiltinKnowledge()` 同步到 `data/kb/`（运行时不进 Git）。

## 文件

- `lotus-dataset.md`：LOTUS 数据集卡片，第一知识库。包含版本、规模、字段、分类示例、使用方式、局限和引用格式。
- `references.json`：开发参考的论文与权威网站。`summary` / `usage` 是项目自写说明，不摘录论文原文摘要。

## 新增一条参考

在 `references.json` 的 `papers` 或 `websites` 里追加一项：

```json
{
  "id": "ref-example-2025",
  "name": "论文 · 第一作者 年份 主题",
  "title": "论文完整标题",
  "authors": "作者列表",
  "year": 2025,
  "venue": "期刊",
  "doi": "10.xxxx/xxxxx",
  "url": "https://doi.org/10.xxxx/xxxxx",
  "usage": "在本项目里用来做什么",
  "summary": "用自己的话写 1–2 句要点"
}
```

网站条目把 `authors` / `year` / `venue` 换成 `publisher` 即可。

## 同步规则

- 服务启动时按内容哈希比对：内容没变不重复向量化，变了自动重建分块并重新向量化。
- 从 JSON 删除条目后，对应的内置文档会在下次启动时一并移除。
- 内置文档在界面里显示 `LOTUS` / `论文` / `网站` 标签，**不可删除**；用户上传的文档显示 `我的`，可以删除。
- 引用格式统一为：LOTUS 数据 `LOTUS 260413`；论文 `第一作者 et al. 年份, 期刊, DOI`；网站 `站点名, URL（访问日期）`。
