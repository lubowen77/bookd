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

## 阶段 1：秒开与只读感知（已完成自测）

- Node HTTP + WebSocket 常驻服务、React 阅读壳和原子状态文件已实现。
- 真实中文 EPUB 经 UI 文件选择器导入、打开并首次写出状态约 1.5 秒；`/api/state` 返回逻辑章节、CFI、进度和屏内文字。
- 书库同时保留原文件、逻辑章节 `chapters.json`、逐章 `extracted/*.md` 与 `meta.json`；渲染路径没有模型调用。
- Browser 面板确认 localhost 与 WebSocket 连通。foliate-js 使用 closed Shadow DOM，正文级自动化改由真实 Playwright 页面完成。

## 阶段 2：双向桥（已完成自测）

- 8 个 MCP 工具全部实现，MCP 进程是无状态 stdio → HTTP 薄客户端。
- 真实 stdio 子进程可列出并调用全部工具；HTTP/MCP `goto` 已将 EPUB 精确跳到“自旋玻璃：引入无序”。
- 阅读器与 MCP 创建的高亮会实时出现在 UI，并双写 `annotations.json` / `notes.md`；MCP 清除后 UI 和两份文件同步归零。
- 选区工具条连续触发 3 次时 DOM 中仍只有 1 个实例，完整位于视口内；滚动、Esc、关闭、保存和 10 秒超时均会清理。

## 阶段 3：格式与书库（已完成自测）

- 真实 Chromium 已打开同一本中文 EPUB、MOBI6 与 AZW3/KF8；MOBI 的 55 个、AZW3 的 53 个原始 section 均归并为 11 个逻辑章节并保留 CFI。
- MOBI/AZW3 书内元数据会在浏览器解析后补回正式书名和作者。
- 参考 Markdown 文件夹按 11 个文件导入为 11 个逻辑章节；文件内二级标题不会额外拆章。
- 桌面三栏和 580×720 响应式布局已回归；移动端左右抽屉默认收起、选书后自动关闭、无横向溢出。

## 阶段 4：打磨与开源准备（核心完成，PDF 延后）

- 完成默认主题、选区/批注交互、搜索、明暗主题、Claude Code skill、项目级 `.mcp.json` 和 Browser launch 配置。
- 电子书 HTML 会移除脚本、事件属性与 `javascript:` URL，并覆盖注入严格 CSP；对应安全测试通过。
- `bookd start` 已验证后台启动和复用；npm 生产打包、依赖审计与真实构建均通过。
- npm tarball 已安装到隔离目录，并从包目录之外启动；Web UI 返回 200，真实 EPUB 导入为 11 个逻辑章节，证明发布包不依赖仓库当前工作目录。
- PDF 管线没有启用：现有 MinerU 是联网 Electron GUI 且没有 CLI。遵照用户要求不重复安装；等用户提供明确的本地 CLI 再接入可插拔转换器。

## 当前验收状态

- 自动化自测：完成。
- Claude Code 配置：CLI 已识别 `bookd`，首次项目会话显示 `Pending approval`，符合项目级 MCP 的一次性信任流程。
- 剩余人工验收：用户在 Claude Code 中批准 MCP 后，确认 Browser 侧栏“打开书 → 询问当前段落 → 跳转/高亮”的主观体验。

## 阅读器 UX 迭代（2026-08-06）

- 状态文案改为“同步通道已连接”，品牌展示统一为 `BookD` 并修正顶栏垂直对齐。
- UI 与 WebSocket 两条划线路径共用按 ID upsert，修复单次划线出现两条批注；新增 3 个单测。
- 左右侧栏重开按钮移到侧栏外，桌面单侧/双侧收起后都能从屏幕边缘恢复，移动抽屉保持原行为。
- WebSocket 断线期间合并暂存最新阅读状态，重连后自动补发；真实停服、离线翻页、重启流程已验证。
- EPUB 与 Markdown 统一支持全局方向键、左右浮动翻页/切章按钮；输入框和搜索浮层内方向键不抢占。
- 新增视图、字号、字体和四色纸面设置，写入 `bookd:reader-settings`；EPUB iframe、分页边条、外层舞台和 Markdown 正文同步应用，刷新后保留。
- `npm run typecheck`、`npm test`（18 项）和 `npm run build` 通过；4123 构建产物已完成桌面、580×720、EPUB、隔离 Markdown 与 MCP 划线验收。

## 服务端安全硬化（2026-08-06）

- 完成 H1–H4：HTTP Host 白名单覆盖所有路由与静态资源；WebSocket 与变更类 HTTP 请求校验 Origin；无 Origin 的 MCP/CLI 请求继续放行，回环来源只比较主机名、不限制端口，服务端没有新增 CORS 放行头。
- `clear-highlights` HTTP API 不再缺省到当前书；MCP `clear_highlights` 省略 `book_id` 时改为先读当前状态再显式传书籍 ID，8 个 MCP 工具在 4199 隔离实例逐一实测通过。
- 完成 H3/M5/L1：纯点书籍 ID 被拒，解析路径断言留在书库根内，清除不存在书籍的批注不会创建目录，非法 ID 返回 400；正常中文 ID 保持兼容。
- 完成 L6：非回环绑定会打印“无身份认证、同网设备可读写”的显著警告，但不阻断用户自主配置。
- 隔离攻击复现：恶意 WS Origin 被断开；恶意 Origin 的 clear 与 multipart 导入均为 403；无 Origin 的 `text/plain` 空 body 为 400 且原批注完好；`...md` 为 400 且库父目录无新增产物；恶意 Host 为 403。
- 功能回归：生产页面完成开书、方向键翻章、搜索跳转、阅读设置、WS 上下文同步与批注/笔记实时呈现，控制台无应用错误；`npm run dev` 的 5173→4123 API 代理返回 200、WS 收到 `hello`。应用内浏览器未执行 Vite 开发模块而显示空白，故开发页视觉渲染未在该浏览器环境内确认，API/WS 双端口链路已确认。
- 自动化：`npm run typecheck`、`npm test`（31 项）、`npm run build` 全部通过；新增安全回归覆盖 Host、WS Origin、变更请求 Origin、危险空 body、路径逃逸、目录副作用、MCP 缺省解析与非回环警告。

## 阅读器 UX 第二轮（2026-08-06）

- 修复 calibre EPUB 的排版覆盖问题：注入到 iframe 的 body 字号、行高和字距改为 `!important`，不覆盖子元素字号层次；《随椋鸟飞行》与《舆论》六档实测分别为 14.72 / 16 / 17.28 / 18.56 / 20.16 / 22.08px。
- 「阅读上下文」改为默认折叠的无持久化卡片，标题按钮同步 `aria-expanded`；展开后显示完整可见文本与 CFI，1000 字状态下正文容器 288px、内容 750px，可内部滚动且批注区仍在视口内。
- 翻页钮在所有桌面与窄屏断点统一距阅读舞台边缘 40px；左右/双侧收起三种组合均与 24px 重开钮无重叠，开关侧栏时相对偏移不变。
- 翻页钮平时完全隐藏，左右 120px 边缘探测区分别淡入对应按钮；视觉圆外扩 16px 的约 72×72 热区可点击，正文中央真实拖选仍能正常出现唯一选区工具条。
- EPUB 单页/双页模式在正文 iframe 与两侧留白均支持滚轮翻页；300ms 节流下 8 个连续 wheel 事件只前进一页。滚动模式放行原生连续滚动；《随椋鸟飞行》与《舆论》来回切换后新 iframe 监听正常且未叠加。
- 生产构建在标准 Chromium 完成 1280×720、580×720、明暗主题与四色纸面验收；移动端无横向溢出，右抽屉内折叠卡片正常。应用内浏览器可验证应用壳但 foliate-js `open(file)` 停在加载态，因此 iframe 项按既有回退规则使用真实 Playwright Chromium 完成。
- MCP 回归使用新起的 `dist/mcp.js` stdio 子进程连接 4123：8 个工具可列出，`get_reading_state` 返回当前书、章节、CFI 与非空 `visibleTextHead`。
- 已知既有风险：从另一本书切回《随椋鸟飞行》且没有该书可恢复位置时，foliate-js 1.0.1 的 text-start 初始化可能在 `Range.setEnd` 抛错并显示提示，但 renderer、字号和滚轮仍可用；本轮未扩大范围修改上游初始化路径。
- 自动化：`npm run typecheck`、`npm test`（32 项）与 `npm run build` 全部通过；4123 已重启为本轮构建产物。
