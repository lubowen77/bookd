---
name: bookd
description: 使用本地 bookd 伴读阅读器打开书籍、读取用户当前阅读位置、搜索正文、跳转和高亮。用户谈论正在读的书、说“打开某本书”、询问当前段落或要求定位原文时使用。
---

# bookd 伴读

bookd 服务运行在 `http://127.0.0.1:4123`，MCP 名称为 `bookd`。

## 打开书籍

1. 先调用 `list_books`，按标题匹配用户指定的书；不要猜测书籍 ID。
2. 调用 `open_book`。
3. 用 Browser 面板导航到 `http://127.0.0.1:4123/read/<URL 编码后的书籍 ID>`。
4. 若服务不可用，在本项目执行 `node dist/cli.js start` 后重试；服务已经运行时该命令会直接复用，不会重复启动。

## 讨论当前阅读内容

1. 先调用 `get_reading_state`，优先使用 `selection`；没有选区时使用当前章节和 `visibleTextHead`。
2. 需要更多上下文时才调用 `get_chapter` 或 `search_book`，避免把整本书无关内容装入上下文。
3. 回答时明确区分原文事实、你的解释和推断，并标出书名与章节。
4. 不得编造未从工具返回内容中看到的原文。

## 反向操作

- 只有用户要求移动阅读位置时才调用 `goto`。
- 只有用户明确要求划线、标记或保存批注时才调用 `highlight`。
- 删除高亮前先确认目标；没有指定单条 ID 时，`clear_highlights` 会清空本书全部高亮。
- `goto`、`highlight` 发出后，再调用 `get_reading_state` 验证结果；阅读器未打开时说明指令会在打开页面后生效。
