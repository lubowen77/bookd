# bookd 执行进度

执行依据：[伴读阅读器-执行方案.md](../read/伴读阅读器-执行方案.md)

## 阶段 0：技术验证（2026-08-05）

### Claude Reader

- 验证提交：`21eb3b826a7f5d57b284a5ad9aad4f2f59f42de9`，MIT。
- 本地服务与书库 API 可启动；测试环境在缺少可选 Turso 凭据时会有对应失败。
- 当前实现已提供 MCP、SSE 跳转和高亮，但阅读感知仍以“当前章节 / 手动发送上下文”为主。
- 结论：保留其 MCP 工具体验作为参考，不 fork。它的 Python、Turso 与 Apple Books 架构不适合本方案的独立本地书库。

### foliate-js

- 验证提交：`78914aef4466eb960965702401634c2cb348e9b1`；npm 版本 `1.0.1`，MIT。
- 使用 Calibre 9.10.0 将同一本 EPUB 转成 MOBI6 与 KF8/AZW3，并在真实 Chromium 中逐一打开。
- EPUB、MOBI6、AZW3 均成功渲染中文，均返回章节、进度与 `epubcfi(...)`；上游 CFI 测试页无断言失败。
- 安全边界：电子书内容在 iframe 中运行，脚本默认受 CSP 限制；集成时继续保持内容与宿主页隔离。
- 结论：采用 foliate-js 作为 EPUB/MOBI/AZW3 阅读内核。

### MinerU 与 Python

- 现有 `/Applications/MinerU.app` 为 0.14.1 Electron GUI；已确认应用存在并可启动。
- 该安装未提供 `mineru` CLI，空闲时也存在外网连接，因此不能把它当成本地离线、可自动化的转换器。
- 按用户要求，将用户级默认 Python 升级为 uv 管理的 3.12.13；`/usr/bin/python3` 仍为 macOS 自带 3.9.6，未修改。
- 取消的临时 MinerU Python 环境已移动到废纸篓 `bookd-phase0-cleanup-20260806`，可恢复；未保留另一份安装。
- 结论：PDF 保持可插拔转换器设计。核心 v1 不依赖 MinerU；只有检测到明确的本地 CLI 时才启用 PDF 导入。

## 已锁定架构

- `bookd` 是持续运行的本地 HTTP + WebSocket 服务。
- MCP 是无状态 stdio 薄客户端，仅转发到服务；退出 Claude Code 不会关闭阅读器。
- 书库默认位于 `~/Books/bookd`；桥接状态位于项目 `.reading/state.json`。
- 阅读状态以 CFI 为主，并携带章节、进度、可见文本头部和选择内容。
- 高亮同时写入 `annotations.json` 与 `notes.md`。

## 视觉基线

- 参考现有《随椋鸟飞行》阅读器的墨黑、暖纸、银灰细线和中文出版物气质。
- 新概念图：[`docs/design/bookd-reader-concept.png`](docs/design/bookd-reader-concept.png)。
- 实现需覆盖书库、目录、阅读正文、选择内容、AI 连接状态、跳转和高亮反馈，并保持正文优先。

