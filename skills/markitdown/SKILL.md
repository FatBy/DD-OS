---
name: markitdown
description: "将各种格式的文件转换为结构化 Markdown。支持 PDF、Word、PowerPoint、Excel、HTML、CSV、JSON、XML、EPub、图片等。输出保留标题层级、表格、列表等文档结构，特别适合 LLM 消费和知识库导入"
version: "1.0.0"
tags:
  - 文件转换
  - markdown
  - 文档解析
  - 格式转换
keywords:
  - 转markdown
  - 转md
  - 文件转换
  - pdf转md
  - word转md
  - pptx转md
  - excel转md
  - 格式转换
  - 文档转换
dangerLevel: safe
inputs:
  filePath:
    type: string
    description: "要转换的文件路径"
    required: true
  outputPath:
    type: string
    description: "输出 .md 文件路径（可选，不填则直接返回转换内容）"
    required: false
---

# MarkItDown - 文件转 Markdown 工具

基于 Microsoft MarkItDown 引擎，将各种格式的文件转换为结构化 Markdown 文本。

## 支持格式

| 格式类别 | 支持的扩展名 |
|---------|------------|
| 文档 | PDF, DOCX, PPTX, XLSX, XLS |
| 网页 | HTML, HTM |
| 数据 | CSV, JSON, XML, YAML |
| 媒体 | PNG, JPG, JPEG (图片描述/OCR) |
| 电子书 | EPub |
| 压缩包 | ZIP (自动解压并转换内部文件) |
| 其他 | Outlook MSG, RST, 纯文本 |

## 使用场景

- 用户说"把这个 PDF/Word/PPT/Excel 转成 Markdown"
- 需要将文档导入知识库/记忆系统
- 生成报告前需要从源文件提取结构化内容
- 多种格式文件的批量 Markdown 转换

## 与 parseFile 的区别

| 特性 | parseFile | convertToMarkdown |
|------|-----------|-------------------|
| 输出格式 | 纯文本 | 结构化 Markdown |
| 结构保留 | 仅文字内容 | 标题/表格/列表/链接 |
| 适用场景 | 快速提取文本 | 文档转换/知识入库 |
| 输出可读性 | 一般 | 高（直接可用） |

## Instructions

当用户需要将文件转换为 Markdown 格式时，使用 `convertToMarkdown` 工具：

1. 确定用户要转换的文件路径
2. 如果用户希望保存为文件，指定 `outputPath`；否则直接返回内容
3. 调用工具并将结果返回给用户

## Examples

### 转换 PDF 文件并直接返回内容
```json
{
  "name": "convertToMarkdown",
  "args": {
    "filePath": "报告.pdf"
  }
}
```

### 转换 Word 文件并保存为 .md
```json
{
  "name": "convertToMarkdown",
  "args": {
    "filePath": "D:/documents/方案.docx",
    "outputPath": "D:/documents/方案.md"
  }
}
```

### 转换 Excel 为 Markdown 表格
```json
{
  "name": "convertToMarkdown",
  "args": {
    "filePath": "数据分析.xlsx"
  }
}
```

## Safety Rules

- 仅处理本地文件，不支持 URL 转换
- 禁用第三方插件 (enable_plugins=False)
- 文件大小限制 10MB
- 不会修改源文件
