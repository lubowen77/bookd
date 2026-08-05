---
name: bookd
description: 使用本地 bookd 伴读阅读器打开书籍、读取用户当前阅读位置、搜索正文、跳转和高亮。用户谈论正在读的书、说“打开某本书”、询问当前段落或要求定位原文时使用。
---

# bookd 伴读

bookd 服务运行在 `http://127.0.0.1:4123`，MCP 名称为 `bookd`。

## 打开书籍

1. 调用 `list_books` 按标题确认 ID，不要猜测。
2. 调用 `open_book`。
3. 用 Browser 面板导航到 `http://127.0.0.1:4123/read/<URL 编码后的书籍 ID>`。
4. 若服务不可用，在安装 bookd 的项目运行 `npx -y bookd start` 后重试。

## 讨论与控制

1. 先调用 `get_reading_state`，优先使用 `selection`，没有选区时使用章节和 `visibleTextHead`。
2. 需要更多上下文时才调用 `get_chapter` 或 `search_book`；不得编造工具没有返回的原文。
3. 只在用户明确要求时调用 `goto`、`highlight` 或 `clear_highlights`。
4. 删除高亮前确认目标；未指定单条 ID 会清空本书全部高亮。
5. 控制指令发出后，再用 `get_reading_state` 验证结果。
