# bookd

本地优先的 AI 伴读阅读器：人类在浏览器里读 EPUB、MOBI、AZW3 与 Markdown，AI 通过 MCP 精确获取当前书、章节、CFI、可见文字和选区，也能反向跳转与高亮。

![bookd 阅读器概念图](docs/design/bookd-reader-concept.png)

![bookd 阅读器实现](docs/design/bookd-reader-implementation.png)

## 核心边界

- 正文渲染与格式处理不调用模型；AI token 只用于讨论。
- `bookd` 是常驻 HTTP + WebSocket 服务；MCP 是无状态 stdio 薄客户端。关闭 Claude Code 不会关闭阅读器。
- 文件默认只写入 `~/Books/bookd`，阅读状态桥写入当前项目的 `.reading/state.json`。
- 不处理 DRM。PDF 只接受明确的本地转换器；当前不会把文件上传到 MinerU GUI 或重复安装 MinerU。

## 本仓库启动

要求 Node.js 20 或更高版本。

```bash
npm install
npm run build
node dist/cli.js start
```

打开 <http://127.0.0.1:4123>。`start` 会后台启动服务；服务已运行时直接复用。调试时可用 `npm run dev`，前台运行生产构建可用 `npm start`。

导入文件或 Markdown 目录：

```bash
node dist/cli.js import /path/to/book.epub
node dist/cli.js import /path/to/markdown-directory
```

发布到 npm 后的一行启动形式为：

```bash
npx -y bookd start
```

## Claude Code 集成

仓库内已经提供：

- [`.mcp.json`](.mcp.json)：注册 `bookd` stdio MCP。
- [`.claude/skills/bookd/SKILL.md`](.claude/skills/bookd/SKILL.md)：打开书籍、读取上下文和反向操作的 skill。
- [`.claude/launch.json`](.claude/launch.json)：Claude Code Browser 面板的本地服务配置。

首次使用项目级 `.mcp.json` 时，Claude Code 会要求确认信任。构建并启动 bookd 后，可在 Claude Code 中说“打开《书名》”或直接调用 `/bookd`。

可先用 `claude mcp list` 检查配置；首次看到 `Pending approval` 属于预期状态，需要在 Claude Code 项目会话中批准一次。

要在其他项目复用：把 [`integrations/claude-code/SKILL.md`](integrations/claude-code/SKILL.md) 放到目标项目的 `.claude/skills/bookd/SKILL.md`，并以 [`integrations/claude-code/mcp.example.json`](integrations/claude-code/mcp.example.json) 为目标项目的 `.mcp.json`。

## MCP 工具

| 工具 | 作用 |
|---|---|
| `get_reading_state` | 当前书、章节、进度、CFI、可见文字与选区 |
| `list_books` | 列出本地书库 |
| `open_book` | 让已打开的阅读器切换书籍 |
| `get_chapter` | 读取清洗后的章节 Markdown 与纯文本 |
| `search_book` | 全书检索，返回章节、摘录与可跳转 CFI（已打开后补齐） |
| `goto` | 按 CFI、章节或 0–1 进度跳转 |
| `highlight` | 高亮并可附笔记，双写 JSON / Markdown |
| `clear_highlights` | 删除单条或本书全部高亮 |

MCP 入口也可单独运行：

```bash
BOOKD_URL=http://127.0.0.1:4123 node dist/mcp.js
```

## 数据布局

```text
~/Books/bookd/<书名>/
├── source.epub              # 或 source.mobi / source.azw3 / source.md
├── extracted/               # 按逻辑章节缓存的 Markdown
├── chapters.json            # 搜索与 MCP 的结构化章节缓存
├── annotations.json         # 结构化批注
├── notes.md                 # 人可读、Git 友好的批注
└── meta.json

<当前项目>/.reading/state.json
```

`state.json` 使用稳定的文件桥字段：

```json
{
  "book": "随椋鸟飞行",
  "chapter": "与椋鸟齐飞",
  "chapter_index": 1,
  "cfi": "epubcfi(/6/12!/4/2)",
  "progress": 0.09,
  "visible_text_head": "当前屏幕内的文字…",
  "selection": null,
  "updated_at": "2026-08-06T00:00:00.000Z"
}
```

## 配置

| 环境变量 | 默认值 | 含义 |
|---|---|---|
| `BOOKD_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `BOOKD_PORT` | `4123` | HTTP / WebSocket 端口 |
| `BOOKD_LIBRARY_DIR` | `~/Books/bookd` | 书库目录 |
| `BOOKD_STATE_DIR` | `.reading` | 文件桥目录 |
| `BOOKD_URL` | `http://127.0.0.1:4123` | MCP 转发目标 |

## 验证

```bash
npm run check
npm audit --omit=dev
npm pack --dry-run
```

测试覆盖 EPUB/Markdown 导入、逻辑章节提取、全文检索、批注双写、状态原子写入、HTTP、WebSocket、8 个 MCP 工具与真实 stdio 子进程。

真实 Chromium 回归还覆盖了同一本中文书的 EPUB、MOBI6、AZW3/KF8：原始 spine/section 会按书内 TOC 合并成逻辑章节，并保留章节起点 CFI。Markdown 文件夹按“一个文件一个逻辑章节”导入，文件内二级标题不会把目录拆碎。

电子书正文由 foliate-js 在 iframe 中渲染。bookd 会移除内联脚本和事件处理器并注入严格 CSP；Chromium 仍会针对 foliate-js 为 WebKit 事件兼容所设的 `allow-scripts + allow-same-origin` 打出沙盒警告，这是已知上游实现提示，不代表书内脚本获准执行。

## PDF / MinerU 状态

本机现有 `/Applications/MinerU.app` 是联网 Electron GUI，没有提供 `mineru` CLI，因此当前构建在 `/api/health` 中明确报告 PDF 未启用。PDF 适配保持在核心依赖之外；只有检测到用户明确配置的本地 CLI 后才应启用，避免重复安装 Python/MinerU 或意外上传文档。

阶段记录与技术验证见 [PROGRESS.md](PROGRESS.md)。
