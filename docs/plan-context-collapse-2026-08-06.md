# 「阅读上下文」卡片折叠功能 · 实施方案

> 交接文档（2026-08-06）。自包含，不依赖会话上下文。行号以内容检索为准。

## 需求

右栏「阅读上下文」卡片（`src/client/App.tsx` 中检索 `bridge-card`）当前始终显示 `visibleTextHead` 正文（有截断/渐隐）与 CFI。改为：

- **默认折叠**：只显示标题「阅读上下文」+ 状态行（绿点「同步通道已连接」/「等待本地桥重连」）。
- **点击标题行展开**：显示**完整** `visibleTextHead`（不截断、不渐隐）与 CFI；再点收起。
- 折叠状态不持久化（每次会话默认折叠即可）。

## 实现要点

1. App.tsx 新增 `const [contextOpen, setContextOpen] = useState(false)`。
2. 标题行改为 `<button type="button">`，带 `aria-expanded={contextOpen}`、`aria-controls`；右侧加 lucide `ChevronDown`（已有依赖），展开时旋转 180°（CSS transition ~.15s）。
3. 状态行（`bridge-status`）**保留在折叠态**。正文 `<p>` 与 `<code>`（CFI）仅在 `contextOpen` 时条件渲染。
4. **展开态限高**：`visibleTextHead` 最长 1200 字符，无限撑开会把下方「我的批注」区挤没。展开的正文容器加 `max-height: 40vh; overflow-y: auto`，内部滚动。
5. 检索 `styles.css` 中 `bridge-card` 相关规则：现有对 `<p>` 的截断/渐隐样式（`max-height`、`mask-image` 或 `-webkit-line-clamp` 之类）直接删除——折叠态已不渲染正文，截断失去意义。
6. `visibleTextHead` 为空时的占位文案（「开始阅读后…」）移入展开态显示。
7. 纯展示交互，不加单测；`npm run typecheck` + `npm run build` 通过即可。

## 边界

- 只改 `src/client/App.tsx` 与 `src/client/styles.css`，服务端、MCP、状态桥零改动（`visibleTextHead` 的采集与上报逻辑完全不动——折叠只影响显示，AI 通过 MCP 读到的内容不受任何影响）。
- 不动顶栏「本地桥已连接」按钮。

## 验收

1. 默认折叠：卡片仅标题 + 状态行两行。
2. 点标题展开：完整正文 + CFI 出现；文本超长时卡片内部滚动、批注区不被挤出视口。
3. 再点收起；aria-expanded 正确切换。
4. 明暗两主题下样式无破损；≤820px 断点抽屉内表现正常。
5. 构建产物验收后重启 4123 常驻服务（`lsof -tnP -iTCP:4123 -sTCP:LISTEN | xargs kill` 后 `nohup node dist/cli.js serve --port 4123 >/dev/null 2>&1 &`）。
