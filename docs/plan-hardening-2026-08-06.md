# bookd 服务端安全硬化 · 实施方案（H1–H4）

> 交接文档（2026-08-06）。自包含，不依赖会话上下文。行号以内容检索为准。
> 依据：`docs/audit-2026-08-06.md`（全量安全审计，含每条漏洞的实测复现过程）。**动手前先通读该报告的高危章节**——本方案只给修复，不重复攻击链推导。

## 0. 背景

bookd 是本地常驻 HTTP + WebSocket 服务。威胁面的核心事实：**用户浏览器里的任意网页都能向 `127.0.0.1:4123` 发请求**。服务当前无认证、无 Origin 校验、无 Host 校验、无 CSRF 防护，审计已实测出四条可被恶意网页远程触发的攻击链。

本次目标：堵住 H1–H4，附带 M5、L1、L6。

## 1. 不可妥协的约束（违反即为失败，优先级高于安全加固本身）

这三条是本方案最容易被做坏的地方，全部已核实：

### 约束一 · 不能断 MCP

MCP 客户端是独立 Node 进程，用 `fetch` 调 HTTP API。Node 的 fetch **不发送 `Origin` 头**。
→ **Origin 校验必须放行"不带 Origin"的请求**。只有"带了 Origin 且不是回环来源"才拒绝。
（安全性不受损：现代浏览器发起的跨源 fetch / XHR / form POST 一律带 Origin，伪造不了。）

### 约束二 · 不能断 `npm run dev`

`vite.config.ts` 的代理是 `'/api': 'http://127.0.0.1:4123'`，**未设 `changeOrigin`**（默认 false），即代理转发时**保留原始 Host 头**。dev 模式下服务收到的 Host 是 `127.0.0.1:5173`，不是 `127.0.0.1:4123`。

→ **Host 白名单只校验主机名、忽略端口**。判定 `127.0.0.1` / `localhost` / `::1` / `[::1]` 即放行，不比对端口。
（安全性不受损：DNS rebinding 的特征是 Host 为攻击者域名，与端口无关。写成"必须等于 `127.0.0.1:4123`"会直接打断开发流程。）

同理 dev 模式下前端 Origin 是 `http://127.0.0.1:5173`，**Origin 白名单也不能限定端口**，只认主机名。

### 约束三 · 不能加 CORS 放行头

不要"顺手"加 `Access-Control-Allow-Origin`。当前没有该头，正是跨源读取响应被浏览器拦住的原因之一。加了等于自毁防线。

## 2. 实施顺序与提交划分

按审计给出的性价比排序，**每项独立提交**，便于出问题时二分定位：

| 序 | 项 | 收益 |
|---|---|---|
| 1 | H4 Host 白名单 | 挡 DNS rebinding，堵住通往全量读写的总闸 |
| 2 | H1 WS Origin 校验 | 堵跨源数据泄露 + 对 AI 的提示注入通道 |
| 3 | H2 CSRF（Origin 校验 + 去除危险缺省） | 堵不可恢复的批注抹除 |
| 4 | H3 + M5 收紧 bookId | 堵越目录写与凭空建目录 |
| 5 | L1 + L6（可选，顺手） | 错误码语义、非回环绑定警告 |

---

## 3. 各项修复

### 3.1 · H4 Host 白名单（`src/server.ts`）

**问题**：所有路由不校验 Host 头。实测 `Host: bookd.evil.example` 照常 200。攻击者把域名重绑到 127.0.0.1 后即取得**同源**权限，可读全书正文、任意写入，且响应可读——这绕过了其余所有靠 preflight 挡住的端点。

**修复**：加一个**最外层**全局中间件（必须在 `express.json` 与所有路由**之前**）：

- 解析 `request.headers.host`，取主机名部分（注意 IPv6 形如 `[::1]:4123`，方括号要正确剥离）。
- 主机名在 `{127.0.0.1, localhost, ::1}` 内 → 放行；否则 403（响应体不回显任何路径或配置信息）。
- 缺失 Host 头（HTTP/1.0）→ 拒绝。
- 若 `config.host` 被配置为非回环地址（见 L6），把它一并加入白名单——否则用户显式绑局域网时服务自己就不可用了。

**注意**：这条中间件同样适用于静态资源与 `/read/:id`，不要只挂在 `/api` 下。

### 3.2 · H1 WebSocket Origin 校验（`src/server.ts` 的 `httpServer.on('upgrade')`）

**问题**：upgrade 与 connection 均不校验 Origin。实测伪造 `Origin: https://evil.example.com` 握手**被接受**，立刻收到 `hello`（含完整书库列表与当前阅读状态：`visibleTextHead`、章节、进度、CFI、选区），再发 `state:update` **成功篡改服务器状态**。WebSocket 握手不受同源策略限制，任何网页都能连，端口可预测。

**额外危害（产品级）**：`integrations/claude-code/SKILL.md` 指示 AI 把 `selection` / `visibleTextHead` 当作"用户正在读/选中的内容"。跨源可写这两个字段 = **任意恶意网页可把任意文本塞进 AI 认为的用户阅读上下文**，这是一条对 AI 助手的间接提示注入通道。

**修复**：在 `httpServer.on('upgrade')` 内，`sockets.handleUpgrade` **之前**判定：

- 取 `request.headers.origin`。
- **无 Origin** → 放行（非浏览器客户端，见约束一）。
- 有 Origin → 解析出 protocol + hostname，主机名须在回环白名单内（**不限端口**，见约束二）；否则 `socket.destroy()` 并直接返回，不进入 `handleUpgrade`。
- 顺带保留现有的 `url.pathname !== '/ws'` 判定。

抽一个共享的 `isLoopbackOrigin(origin: string): boolean` 工具函数（放 `src/server.ts` 内或新建 `src/net-guard.ts`），供 3.2 与 3.3 复用，避免两处规则漂移。

### 3.3 · H2 CSRF 防护（两层，缺一不可）

**问题**：`POST /api/commands/clear-highlights` 用 `Content-Type: text/plain` + 空 body 发送（属 CORS 简单请求，**浏览器不发 preflight**），`express.json` 不解析该类型 → `req.body` 为空 → `bookId` 退回 `state.get().book`（用户当前正在读的书）。实测返回 `{"ok":true,"removed":1}`，`annotations.json` 清空、`notes.md` 中笔记消失，**数据不可恢复**，且攻击者**不需要知道任何 ID**。

#### 第一层 · 变更类请求的 Origin 校验

在全局中间件中（H4 之后），对 `POST` / `PUT` / `PATCH` / `DELETE`：

- 无 Origin → 放行（MCP / CLI / curl，见约束一）
- 有 Origin 且非回环 → 403

这一层同时覆盖审计的 **M1（multipart 导入 CSRF）**——实测伪造 Origin 上传会把书写进书库并强制切换用户阅读器，加上此校验后即被拒。

（可选加强：一并检查 `Sec-Fetch-Site` 头，值为 `cross-site` 直接拒。现代浏览器均发送且不可由脚本伪造，属纵深防御，不作为主防线。）

#### 第二层 · 去掉危险缺省值

只靠 Origin 校验不够——"不给 bookId 就删掉用户当前正在读的书的全部批注"这个设计本身就不该存在于最外层 API。

- `POST /api/commands/clear-highlights`：**要求显式 `bookId`**，缺失时返回 400，**不再回退 `state.get().book`**。
- **联动改造（不改会弄坏 MCP）**：`src/mcp-server.ts` 的 `clear_highlights` 工具当前直接把 `book_id` 透传（省略时 body 为空，依赖服务端缺省）。改为：`book_id` 缺失时，先请求 `/api/state` 取当前书，再显式传入；当前无书则返回明确错误。**MCP 工具对 AI 的语义保持不变**（"默认当前书"仍然成立），只是解析位置从服务端移到 MCP 客户端。
- `POST /api/commands/highlight` 的缺省（无参数时用当前选区）**保留不动**——它是创建而非销毁，需要有活跃选区，危害等级完全不同。

### 3.4 · H3 越目录写 + M5（`src/storage.ts`）

**问题**：ID 正则 `/^[\p{L}\p{N}._-]+$/u` 允许**纯点段**。实测链：上传文件名 `...md`（内容无一级标题）→ `path.basename('...md', '.md')` = `..` → 通过 ID 校验 → `path.join(root, '..')` 逃逸，`meta.json` / `source.md` / `notes.md` / `annotations.json` / `chapters.json` / `extracted/` 全部写进书库的**父目录**（默认即 `~/Books/`），同名文件被覆盖。导入端点是 multipart 无预检，**恶意网页可远程触发**。同源入口还有 EPUB 的 `<dc:title>..</dc:title>` 与 markdown 首个 `# ..` 标题。

**修复（三处都要做，纵深防御）**：

1. **正则收紧**：排除纯由点组成的 ID（`.`、`..`、`...` 等）。保留对正常中英文书名的支持——注意《舆论》《随椋鸟飞行-复杂系统的奇境》这类现有 ID 必须继续可用。
2. **路径断言**：`bookDir()`（或等价的路径拼接处）对结果做 `path.resolve`，断言其位于 `path.resolve(root)` 之内（用 `resolved === root || resolved.startsWith(root + path.sep)` 判定，不要用裸 `startsWith` 字符串前缀比较，会被 `~/Books-evil` 这类兄弟目录绕过），否则抛错。
3. **M5 存在性校验**：`clearAnnotations`（`src/storage.ts` 内）对任意 `bookId` 直接写文件、不检查书是否存在，实测可凭空创建目录。改为先校验书存在，不存在则报错，不落盘。

**L1（可选，顺手）**：非法 bookId 目前经 `storage.ts` 抛错 → 全局错误处理器一律 500。改为返回 400（区分"客户端输入非法"与"服务端故障"）。

### 3.5 · L6 非回环绑定警告（可选，成本极低）

`config.ts` 允许 `BOOKD_HOST` 绑 `0.0.0.0`（默认 `127.0.0.1` 安全）。因服务零认证，一旦绑非回环即把整个书库暴露给局域网。修复：启动时若 host 非回环，在控制台打印**显著警告**（说明无认证、任何同网设备可读写书库）。不阻断启动（保留用户自主权）。

---

## 4. 测试要求（必须写，否则必然回退）

`src/server.test.ts` 已有 supertest + 真实 WebSocket 的测试设施，沿用。新增用例：

**防护生效**
1. `Host: evil.example.com` 的 GET → 403
2. WS 握手带 `Origin: https://evil.example.com` → 连接被拒（不应收到 `hello`）
3. `POST /api/commands/clear-highlights` 带跨源 Origin → 403
4. `POST .../clear-highlights` 无 bookId（含 `Content-Type: text/plain` + 空 body 的原始攻击形态）→ 400，且**断言批注数据未被删除**
5. 导入文件名 `...md` → 被拒，且断言库父目录未产生任何文件
6. `clearAnnotations` 对不存在的 bookId → 报错且不创建目录

**不误伤（同等重要）**
7. **无 Origin** 的 POST（模拟 MCP）→ 正常成功
8. `Origin: http://127.0.0.1:5173`（模拟 vite dev）→ 正常成功
9. `Host: 127.0.0.1:5173`（模拟 dev 代理转发）→ 正常成功
10. 现有 12+ 用例全部保持通过

## 5. 验收清单

**自动化**
1. `npm run typecheck`、`npm test`、`npm run build` 三绿。

**攻击复现（照 `docs/audit-2026-08-06.md` 的手法逐条打一遍，确认现在被挡）**

2. 伪造 Origin 的 WS 握手：应连不上，拿不到书库与阅读状态。
3. `text/plain` 空 body 的 clear-highlights：应 400，批注完好。
4. 伪造 Origin 的 multipart 导入：应 403。
5. `...md` 文件名导入：应被拒，`~/Books/` 下无新增文件。
6. `Host: bookd.evil.example`：应 403。

> 所有攻击验证必须在**隔离实例**上做（自定端口 + 临时书库/状态目录，如 `BOOKD_LIBRARY_DIR=/tmp/xxx BOOKD_STATE_DIR=/tmp/yyy bookd serve --port 4199`）。**不得**在 4123 的真实书库上执行破坏性验证——上次审计即如此操作，用户数据全程未受影响。

**功能回归（最高风险区，逐项实测，不得省略）**

7. 阅读器全流程：打开书、翻页、方向键、划线、笔记、搜索、切换设置——全部正常。
8. WebSocket 状态同步正常（右栏「同步通道已连接」，翻页后 `visibleTextHead` 更新）。
9. **MCP 8 个工具逐个实测**：`get_reading_state`、`list_books`、`open_book`、`get_chapter`、`search_book`、`goto`、`highlight`、`clear_highlights`。**特别验证 `clear_highlights` 省略 `book_id` 时仍作用于当前书**（3.3 的联动改造是否正确）。
10. `npm run dev` 双端口模式正常：5173 前端能调通 4123 的 API 与 WS。
11. 断线补发未受影响：停服 → 翻页 → 重启 → 服务端状态为断线期间最新位置。

**收尾**
12. 构建产物验收后重启 4123 常驻服务。
13. 更新 `PROGRESS.md`；在 `docs/audit-2026-08-06.md` 对应条目下追加"修复状态"小节（写明改法与实测数据，格式参考 `docs/audit-reader-ux-2026-08-06.md` 的 N1 修复状态块）。
14. 按 §2 分 4–5 个 commit。

## 6. 本次不做

- **M7（电子书 iframe 与宿主同源）**：需要独立 origin/端口隔离或去掉 `allow-same-origin`，属架构级改动，需单独评估 foliate-js 兼容性。当前 sanitizer + CSP 双层防御实测有效，风险可控。
- **M6（zip 炸弹无解压上限）**：建议紧随本次之后做，成本低（解压前校验条目数与总大小），但与网络暴露面无关，不混入本次。
- **M2/M3/M4** 及其余 L 类：见审计报告，另行安排。
- **不引入认证机制**（token/密码）：本地单用户场景下 Origin + Host 校验已足够，加认证会破坏 MCP 与 CLI 的零配置体验。若将来公开分发再评估。

## 7. 与分发的关系

用户计划将来把 bookd 分享给 Claude Code / Codex 用户（见 `docs/plan-packaging-2026-08-06.md` §D）。**本方案是分发的阻塞项**：自用时这些漏洞的风险由用户自己承担；一旦装到他人机器上，等于给每个用户安装一个"任意网页可读取其阅读内容、可抹除其批注、可越目录写文件"的服务。本方案完成前不得对外分发。

分发前还需额外收敛 `/api/health`（当前返回 `libraryDir`、`stateFile` 绝对路径，含用户名）——本次可选做，公开发布前必做。
