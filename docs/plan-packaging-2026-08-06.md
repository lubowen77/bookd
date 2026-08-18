# BookD 封装方案 · 快捷入口 + PWA 应用化

> 交接文档（2026-08-06）。自包含，不依赖会话上下文。行号以内容检索为准。

## 目标与非目标

用户决策（已确认，勿自行更改）：

- ✅ 要一个**能启动也能停止**服务的快捷入口（双击即可，不开终端）
- ❌ **不要开机自启**（不配 LaunchAgent；服务只在用户主动启动时运行）
- ✅ PWA 应用化（Dock 图标、独立窗口）
- ❌ 本阶段**不做** Electron / Tauri 原生壳
- 🔜 将来分享给使用 Claude Code / Codex 的用户（本阶段只做"不挡路"的准备，不实现分发）

**必须保持的架构约束**：服务与阅读窗口**生命周期分离**。关闭 PWA 窗口 **不得** 停止服务——MCP 是独立进程，用户常在不开阅读器时让 AI 查书。只有显式的"停止服务"动作才停。这是原方案的不可妥协点。

## 现状（已核实）

- `bookd start` 已是幂等后台启动（健康检查 + 复用已运行实例），`src/cli.ts` 内实现。
- `bin` 已配 `bookd` / `bookd-mcp`；`files` 字段已就绪。
- **缺**：`stop`、`status` 子命令；全局安装；PWA 资源（无 manifest / 图标）；GUI 入口。
- `integrations/` 现有 `claude-code/`（SKILL.md + mcp.example.json），macOS 集成物应新建 `integrations/macos/`。
- `/api/health` 现返回 `ok/service/version/libraryDir/stateFile/pdf`。

---

## A · CLI 生命周期补全（先做，是 GUI 入口的地基）

### A1 · `/api/health` 增加 `pid`

`src/server.ts` 的 health 路由响应体加 `pid: process.pid`。

理由：让 `bookd stop` 能**先确认目标确实是 bookd 再杀**，避免误杀占用同端口的其他进程。比 PID 文件更可靠（无陈旧文件问题），比 `lsof` 更跨平台。

### A2 · `bookd status`

查 `http://127.0.0.1:PORT/api/health`：
- 运行中 → 打印 URL、PID、书库目录、版本，退出码 0
- 未运行 → 打印"未运行"，退出码 1（供脚本判断）

### A3 · `bookd stop`

1. 查 health；未运行则打印"未在运行"并退出 0（幂等，重复停止不报错）。
2. 校验 `body.service === 'bookd'`，取 `pid`。
3. `process.kill(pid, 'SIGTERM')`（server 已注册 SIGTERM → `server.close()` → `state.flush()`，状态会正常落盘）。
4. 轮询 health 直到不通，超时 5 秒后升级为 `SIGKILL` 并警告。
5. 打印结果。

### A4 · `bookd start` 增加 `--open`

启动成功（或已在运行）后执行 `open <url>`（macOS）打开阅读器。非 macOS 平台跳过并提示 URL。

### A5 · 更新 `usage()` 帮助文本

补 `stop` / `status` / `--open` 说明。

**测试**：`src/server.test.ts` 加一条断言 health 含 `pid` 且等于 `process.pid`。CLI 的 start/stop 属进程级操作，不强求自动化测试，手工验收即可。

---

## B · PWA 应用化

### B1 · 图标

现有 favicon 是内联 SVG（`src/client/index.html` 的 `<link rel="icon" href="data:image/svg+xml,...">`，深色圆角方块 + 金色字母造型）。以它为源生成：

- `public/icons/icon-192.png`、`icon-512.png`（PWA 必需尺寸）
- `icon-512-maskable.png`（`purpose: "maskable"`，四周留 ≥10% 安全边距，避免系统裁切时被切掉）
- `apple-touch-icon.png`（180×180，Safari「添加到程序坞」用）

放 `src/client/public/`（Vite 会原样拷到产物根）。生成方式不限（`sips`/`rsvg-convert`/在线转），产物提交进仓库——**不要**引入图像处理构建依赖。

### B2 · `manifest.webmanifest`

放 `src/client/public/`，内容要点：

```json
{
  "name": "BookD 伴读阅读器",
  "short_name": "BookD",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0d0f10",
  "theme_color": "#0d0f10",
  "icons": [ /* 192、512、512-maskable */ ]
}
```

`index.html` 加 `<link rel="manifest" href="/manifest.webmanifest">` 与 `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`；现有 `theme-color` meta 保留。

### B3 · 极简 Service Worker（保证可安装性）

**不确定项**：Chrome 桌面端「安装应用」的准入条件是否仍强制要求 Service Worker（历史上要求 SW 带 fetch 处理器，近年版本有放宽）。**执行时先实测**：不加 SW，看 Chrome 地址栏是否出现安装图标。

- 若已可安装 → **不加 SW**，本节跳过。
- 若不可安装 → 加一个**纯透传、不缓存**的 SW（`public/sw.js`，`fetch` 事件直接 `event.respondWith(fetch(event.request))`），在 `main.tsx` 里注册。

**硬性要求：SW 绝不能缓存应用外壳**。这是本地服务，构建产物随时会更新；缓存会导致改了代码但界面不变，制造极难排查的幻象。宁可不装 PWA 也不要引入缓存。

### B4 · 窗口内的观感检查

`display: standalone` 后没有浏览器地址栏，需确认：顶栏在窗口顶部无异常留白；左右侧栏收起浮钮不被窗口边缘裁切；≤820px 拖窄时抽屉行为正常。

---

## C · macOS 快捷入口（`integrations/macos/`）

### C1 · 形态：单个 `BookD.app`，双击即用

**行为设计**（一个图标同时满足"启动"和"停止"，且常用路径零摩擦）：

1. 检测服务是否在运行（curl health）。
2. **未运行** → 静默启动（`bookd start`），等待健康检查通过，然后打开阅读器。**不弹任何对话框**——这是最高频动作。
3. **已运行** → 弹一个原生对话框：
   - 标题：`BookD 正在运行`，副文本含端口与书库路径
   - 按钮：`打开阅读器`（默认）｜`停止服务`｜`取消`
4. 启动失败 → 弹错误对话框，提示用 `bookd serve` 看日志。

这样"启动 + 读书"是双击一下，"停止"是双击 + 点一下，都不用终端。

### C2 · 实现方式

在 `integrations/macos/` 放**生成脚本** `make-app.sh`，由它组装标准 .app bundle（而非提交二进制目录）：

```
BookD.app/Contents/
  Info.plist          # CFBundleName=BookD, CFBundleIdentifier=dev.bookd.launcher,
                      # CFBundleExecutable=bookd-launcher, CFBundleIconFile=BookD.icns,
                      # LSUIElement=false
  MacOS/bookd-launcher   # 可执行 shell 脚本（chmod +x）
  Resources/BookD.icns   # 由 B1 的 PNG 用 iconutil 生成
```

启动脚本要点：

- **不能依赖登录 shell 的 PATH**：Finder 启动的 .app 拿不到用户 `.zshrc` 里的 PATH，`node`/`bookd` 大概率找不到。脚本开头显式补齐常见路径（`/opt/homebrew/bin`、`/usr/local/bin`、nvm 的 node 路径），或直接写入构建时探测到的 node 绝对路径。**这是最容易踩的坑，务必实测双击启动而不是只在终端里跑通。**
- 对话框用 `osascript -e 'display dialog ...'`。
- 停止调 `bookd stop`（A3）。
- 打开阅读器用 `open http://127.0.0.1:4123`（若已装 PWA，系统会路由到 PWA 窗口；否则默认浏览器）。
- 脚本里的端口从 `BOOKD_PORT` 环境变量读，缺省 4123。

`make-app.sh` 生成到 `~/Applications/BookD.app`（用户级，不需 sudo），并打印"可拖到程序坞"的提示。README 补一节说明。

### C3 · 不做的事

- 不签名、不公证（自用；首次双击若被 Gatekeeper 拦，右键「打开」一次即可，README 里写明）
- 不做菜单栏常驻（属原生壳范畴，本阶段排除）

---

## D · 为将来分发做的最小准备（本阶段只做记录，不实现）

目标用户是 Claude Code / Codex 用户（自带 Node），**分发形态应是 npm 包**（`npm i -g bookd` + `claude mcp add`），不是 .app。已就绪的：`bin`、`files`、`engines.node>=20`。

分发前的**硬性前置条件**（写进 README 的 roadmap，不要静默忽略）：

1. **必须先修 `docs/audit-2026-08-06.md` 的 H1–H4 四个高危**。自用时风险由你自己承担；一旦分发给他人，等于把"任意网页可读取用户阅读内容、可抹除其批注、可越目录写文件"的服务装到别人机器上。**这是分发的阻塞项，不是优化项。**
2. `/api/health` 目前泄露 `libraryDir` / `stateFile` 绝对路径（含用户名），本次 A1 还会加 `pid`。公开分发前应收敛为仅 `ok/service/version`，详细信息移到需鉴权的端点或仅本地 CLI 可见。
3. npm 上 `bookd` 这个包名是否可用**未经核实**，需 `npm view bookd` 确认。
4. 跨平台：本方案的 C 节是 macOS 专属；分发时 Linux/Windows 用户走 CLI 即可，README 要说清。

---

## 验收清单

**A（CLI）**
1. `bookd status` 在服务开/关两态下输出正确、退出码正确。
2. `bookd stop` 能停掉服务；对已停止的服务重复执行不报错。
3. 停止后 `.reading/state.json` 内容完整（SIGTERM 触发了 flush，阅读位置没丢）。
4. `bookd start --open` 启动并打开浏览器；对已运行实例执行时仅打开、不重复启动。
5. `npm run typecheck` + `npm test` + `npm run build` 通过。

**B（PWA）**
6. Chrome 地址栏出现安装入口（或 Safari「添加到程序坞」可用），装出的窗口无地址栏、图标正确、标题为 BookD。
7. 明暗主题、纸面四色在独立窗口下无破损。
8. **改一行前端代码 → 重新 build → 重启服务 → 刷新 PWA 窗口，改动立即可见**（验证没有缓存幻象）。

**C（入口）**
9. 服务未运行时双击 `BookD.app`：无对话框，服务起来且阅读器打开。
10. 服务已运行时双击：出现三按钮对话框，「停止服务」确实停掉（`bookd status` 为未运行）。
11. **从 Finder / 程序坞双击验证**（不是从终端运行脚本），确认 PATH 问题已解决。
12. 关闭 PWA 窗口后 `bookd status` 仍显示运行中、MCP 工具仍可用（**验证生命周期分离未被破坏**）。

**收尾**
13. 构建产物验收后重启 4123 常驻服务。
14. README 补：快捷入口安装方式、Gatekeeper 首次打开提示、分发 roadmap 与 H1–H4 阻塞说明。
15. 更新 `PROGRESS.md`；分多个 commit（A / B / C / 文档）。
