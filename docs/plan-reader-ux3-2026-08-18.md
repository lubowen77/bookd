# 阅读器 UX 第三轮 + 启动优雅化 · 实施方案

> 交接文档（2026-08-18）。自包含，不依赖会话上下文。行号基于 2026-08-18 的 `main`（02a0ff5），以内容检索为准。
> 范围：3 项（2 项边缘控件交互/布局 + 1 项 MCP 按需启动）+ 1 项设计资产更新。

## 0. 边界

- 前端改动限 `src/client/`（`App.tsx` / `styles.css`，`FoliateReader.tsx` 预计零改动——iframe 内 mousemove 转发已存在，直接复用其信号）。
- §3 改 `src/mcp-server.ts`（MCP **客户端**进程），只新增"连接失败时拉起本地服务"的路径，**不改动任何工具语义、转发头、校验逻辑**。
- **不碰** `src/server.ts`、`src/storage.ts`、`src/cli.ts`——安全硬化（H1–H4）与 `start` 命令现状保持原样。
- 不新增运行时依赖。
- 不影响 `visibleTextHead` 采集与上报。

---

## 1 · 【交互】侧栏重开钮改为"靠近边缘才显现"

### 现状（代码事实，已核实）

| 元素 | 位置 | 显隐机制 |
|---|---|---|
| `.side-reopen` / `.right-reopen`（styles.css:98-107） | `position: fixed; top: 50%`，屏幕边缘 24×64 把手 | 对应侧栏收起时 `display: flex` **常驻**（opacity .58），自身 hover 提到 1 |
| `.page-arrow`（styles.css:133-151） | stage 内 absolute，`top: 50%`，距边缘 40px，40×40 圆 | 默认 `opacity: 0`，两条探测路径点亮 |

翻页钮的两条探测路径：

1. **留白区（纯 CSS）**：`.reader-edge-zone` 左右各 120px 全高透明层（styles.css:142-144），`:hover ~` 兄弟选择器点亮（146-147 行）。
2. **正文区（iframe 转发）**：`FoliateReader.tsx:75-91` 的 mousemove（rAF 节流）→ `onEdgeHover` → App 的 `pageArrowEdge` state（App.tsx:44）→ stage 上加 `edge-left` / `edge-right` class（App.tsx:385，styles.css:148-149）。

**关键结构差异**：重开钮渲染在 `reader-stage` **之外**（App.tsx:382、513，fixed 定位），CSS 兄弟选择器路径够不到它——它的显隐联动**必须走 state**，别试图用 `:hover ~`。

### 方案：统一为 state 驱动，一个信号点亮该侧全部边缘控件

1. **探测区改挂 JS 事件**：`leftEdgeZone` / `rightEdgeZone` 已有 refs（App.tsx:49-50），且 App.tsx:284-289 已经给它们挂过 wheel 监听——照同样模式加 `mouseenter` / `mouseleave` → `setPageArrowEdge('left'|'right'|null)`。也可直接用 JSX 的 `onMouseEnter/onMouseLeave`，更简单。
2. **删掉 CSS-only 路径**：移除 styles.css:146-147 两行 `:hover ~` 规则。此后显现只由 `edge-*` class 驱动，两套机制归一。
3. **edge class 提升到 `app-shell`**：现在 class 加在 stage 上（App.tsx:385），重开钮在 stage 外够不到。把 `edge-${pageArrowEdge}` 挪到根 `app-shell` 的 className（App.tsx:326），CSS 相应改为：
   ```css
   .app-shell.edge-left .page-arrow-left:not(:disabled),
   .app-shell.edge-right .page-arrow-right:not(:disabled) { opacity: .82; }
   .app-shell.edge-left .side-reopen,
   .app-shell.edge-right .right-reopen { opacity: .58; }
   ```
4. **重开钮默认透明**：`.side-reopen, .right-reopen` 基础规则里 `opacity: .58` 改为 `opacity: 0`（**保留 `display: flex` 的收起态逻辑与 pointer-events**）。自身 `:hover` / `:focus-visible` 提到 1 的规则保留并补 focus-visible（键盘可达）。
5. **无书态死锁防护（必做）**：探测区与翻页钮只在 `activeBook` 存在时渲染（App.tsx:397-416）。没有书时若侧栏被收起，重开钮将永无显现路径——**打不开侧栏，也就永远选不了书**。处理：给 `app-shell` 加 `has-book` class（`activeBook` 存在时），隐藏规则只在有书时生效：
   ```css
   .app-shell.has-book .side-reopen { opacity: 0; }   /* 无书时维持常驻 .58 */
   ```
   （具体写法可反转：基础 opacity .58，`has-book` 且非 edge 态时压到 0。任选，行为一致即可。）
6. **触屏兜底**：现有实现里翻页钮在无 hover 设备上没有任何显现路径（既有缺陷，本次一并补）：
   ```css
   @media (hover: none) {
     .page-arrow:not(:disabled) { opacity: .5; }
     .left-closed .side-reopen, .right-closed .right-reopen { opacity: .5; }
   }
   ```

### 已知交互衔接点（写给验收）

鼠标从探测区移到重开钮上时会触发 stage 的 `onMouseLeave`（App.tsx:387）清空 state——此时重开钮靠**自身 `:hover` 规则**兜底维持可见。所以千万不要删 styles.css:106 那条自身 hover 规则，否则表现为"鼠标移过去按钮就消失"。

---

## 2 · 【布局】重开钮与翻页钮垂直分区

### 现状问题（用户截图反馈）

两者 `top` 均为 50% 垂直重合；水平上重开钮占 0–24px、翻页钮占 40–80px，间隙仅 16px——视觉拥挤，且"布局控制"与"阅读导航"两类操作挤在同一处，语义不分。

### 方案：翻页钮留在垂直中线，重开钮移到顶部

- **翻页钮不动**：`top: 50%`、`left/right: 40px` 保持（阅读主操作，垂直居中是惯例；UX2 定下的 40px 偏移与各断点覆盖 styles.css:200-202、317-319 全部不动）。
- **重开钮上移**：`top: 50%` + `translateY(-50%)` 改为固定 `top: 120px`（顶栏高 68px，留 52px 间距；去掉 translateY）。语义：侧栏开关属于"面板/布局"操作，靠近顶栏符合通用心智（Obsidian / Notion 同位），与垂直居中的翻页钮拉开 240px+ 的距离，彻底解耦。
  - 用固定值而非百分比：矮窗口（如 580×720 验收尺寸）下 50% 会把两者重新拉近，固定 120px 始终贴近顶部。
- **扩热区**：24×64 偏小，参照翻页钮的伪元素做法补一个：
  ```css
  .side-reopen::before, .right-reopen::before { content: ''; position: absolute; inset: -12px; }
  ```
- 移动断点（≤820px）重开钮 `display: none !important`（styles.css:312）与抽屉逻辑**不动**。

---

## 3 · 【启动】MCP 客户端按需拉起本地服务

### 背景与现状

- `bookd start`（cli.ts:35-63）已实现：health 探测 → 已运行则复用 → 否则 spawn detached `serve` 并轮询就绪（30×100ms）。幂等、后台化。
- MCP 薄客户端（mcp-server.ts:13 起）把工具调用 fetch 转发到 `BOOKD_URL ?? http://127.0.0.1:4123`。**服务没跑时所有工具直接报连接错误**，用户必须手动跑一次 start——这是目前唯一的"命令行启动"摩擦点。
- 用户决策：**不做开机自启**（不配 LaunchAgent）。

### 方案：连接失败 → 自动拉起 → 重试一次

在 mcp-server.ts 的统一 fetch 转发处（:17 附近的封装函数）加故障路径：

1. **触发条件**：仅 fetch 抛网络层错误（`TypeError` / ECONNREFUSED）时触发；HTTP 4xx/5xx 是服务在跑的信号，**不触发**。
2. **回环门槛（安全约束）**：解析 baseUrl，仅当 hostname ∈ {`127.0.0.1`, `localhost`, `::1`} 才 autostart。`BOOKD_URL` 指向任何其他主机时保持原错误——绝不因远程地址连不上就在本地拉进程。
3. **拉起方式**：spawn `process.execPath [cliPath, 'start', '--port', <baseUrl 端口>]` 并**等待其退出**（`stdio: 'ignore'`），exit 0 即就绪。`cliPath` 用 `fileURLToPath(new URL('./cli.js', import.meta.url))` 从 dist 内自身定位，不依赖 cwd。
   - `cli start` 内部才是 detached+unref 的 serve——MCP 进程等的只是短命的 start 命令，服务生命周期与 MCP/Claude 会话**保持分离**（这是既有架构原则，不要改成 MCP 直接 spawn serve）。
   - `start` 自带幂等（已跑则秒退），所以不需要额外的"先探测再拉"。
4. **并发防抖**：模块级单例 promise——多个工具调用同时失败只 spawn 一次 start，其余 await 同一个 promise；结束后（无论成败）置回 null 允许下次重试。
5. **失败兜底**：autostart 失败时返回错误需包含手动命令提示（`node <绝对路径>/cli.js serve` 可看到前台日志），不要吞掉底层错误信息。
6. **重试一次**：拉起成功后重放原请求；重放再失败就报错，不循环。

### 测试要求

- **单测（注入 spawn mock）**：回环判定（远程 URL 不触发 spawn）；并发防抖（同时 N 个失败请求只 spawn 一次）；4xx/5xx 不触发。参照 mcp-server.test.ts 现有模式。
- **集成/手动验收**：真实场景——服务未跑，Claude 会话调用 `list_books`，服务被拉起且返回书目（首次延迟 ≤3s 可接受）；用随机高端口（参照既有 4199 隔离实例做法），测试结束 kill 拉起的进程。

### 明确不做（已评估排除）

- LaunchAgent 开机自启 / launchd socket activation：用户明确排除前者；后者配置复杂、收益低（autostart 已覆盖唯一高频场景）。
- 双击启动的 `BookD.command` / Automator app：一行脚本的事，用户需要时单独做，不进本轮。

---

## 4 · 【资产】设计图与 README 展示更新

UI 定稿（§1/§2 验收通过）后执行：

- 用真实 Playwright Chromium 截当前实现：1440×900、亮色主题、默认米白纸面、打开《随椋鸟飞行》正文章节、双侧栏展开，**覆盖** `docs/design/bookd-reader-implementation.png`。
- `README.md:5` 顶部展示图从 `bookd-reader-concept.png` 改为指向新的 `bookd-reader-implementation.png`（alt 文字同步改为"bookd 阅读器实况"）；`concept.png` 文件保留在 design 目录作为历史设计稿，不删除。
- 注：应用内 Browser 面板打不开 foliate iframe 内容是已知限制（见 PROGRESS.md），截图一律走真实 Playwright Chromium。

---

## 5 · 实施顺序与提交划分

1. §1 + §2（同一组控件的显隐与位置，一个提交）：`feat: move rail handles up and reveal on edge hover`
2. §3（含测试）：`feat: autostart bookd service from mcp client`
3. §4 + PROGRESS.md 更新：`docs: refresh reader snapshot and record ux3`

## 6 · 验收清单

**§1 显隐**
1. 侧栏收起后把手平时完全不可见；鼠标移近该侧 120px 边缘区淡入——**留白区与 iframe 正文区两条路径都要测**（正文区靠 FoliateReader 转发，只测留白会漏）。
2. 鼠标从探测区继续移到把手上，把手不闪烁、不消失（自身 hover 兜底生效）。
3. Tab 聚焦把手时可见（focus-visible）。
4. **无书 + 收起侧栏：把手常驻可见、可点**（死锁防护）。
5. 翻页钮零回归：边缘显现、72px 热区、滚轮翻页、方向键、markdown 首末章禁用态。
6. DevTools 模拟触摸（hover: none）：翻页钮与把手均以半透明常显。

**§2 布局**
7. 把手位于顶部（top 120px），翻页钮仍垂直居中；左/右/双侧收起三种组合下两者相距明显、互不遮挡。
8. 580×720 矮窗口下两者仍不相邻；≤820px 移动断点把手仍隐藏、抽屉正常。
9. 明暗主题 × 四色纸面下把手与翻页钮视觉正常。

**§3 启动**
10. 服务未跑 → Claude 会话调用 `list_books` → 服务自动拉起并返回书目；再次调用不产生重复进程。
11. `BOOKD_URL` 指向非回环地址 → 不 spawn、报原始连接错误。
12. 并发多个工具调用同时触发 → 只 spawn 一次（单测覆盖）。
13. MCP 进程退出（Claude 会话结束）后服务仍在运行（生命周期分离未被破坏）。
14. 8 个 MCP 工具全量回归。

**通用**
15. `npm run typecheck`、`npm test`、`npm run build` 三绿；构建后重启 4123 常驻服务。
16. §4 截图与 README 更新完成；PROGRESS.md 记录本轮；按 §5 分 3 个提交。

## 7 · 注意事项

- **重开钮在 stage 外**：显隐只能走 app-shell 上的 state class；`:hover ~` 兄弟选择器对它无效（§1 已述，这是最容易想当然踩的坑）。
- **`opacity: 0` ≠ `display: none`**：把手透明时必须保留 pointer-events，否则自身 hover 兜底与热区一起失效（UX2 同款教训）。
- **别删自身 hover 规则**（styles.css:106）：stage mouseleave 会在鼠标移向把手途中清空 edge state，删了就是"移过去就消失"。
- **autostart 只 spawn `cli.js start`，不直接 spawn serve**：生命周期分离靠 start 内部的 detached+unref 保证；MCP 直接 spawn serve 会让服务变成 MCP 进程的子进程树成员，Claude 会话结束可能带走服务。
- **回环判定不可省**：这是 autostart 唯一的安全门槛，必须有单测。
