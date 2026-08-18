# bookd 服务端安全硬化 · 增量审计报告（2026-08-06）

审计对象：commit `1fb2c1c`…`7cfc79b`（5 个提交），基线 `452d7a1`。
审计基准：`docs/plan-hardening-2026-08-06.md`。
方法：静态读 diff + 验收命令复跑 + **隔离实例上逐条复现 `docs/audit-2026-08-06.md` 的原始攻击链** + 真实 4123 环境功能回归（含真实 stdio MCP 子进程、vite dev 代理、浏览器阅读器）。

## 0. 边界声明

**审**：方案符合性、四条攻击链是否真被堵死、三条不可妥协约束是否被违反、功能回归、新引入缺陷。
**不审**：M7（iframe 同源）、M6（zip 炸弹）、M2/M3/M4 及其余 L 类——方案 §6 已明确排除；前端代码（本次未触碰）；foliate-js 上游。

所有破坏性验证均在隔离实例（端口 4199、`/tmp` 临时书库与状态目录）进行，**用户真实书库与 4123 服务全程未受破坏**，已确认。

## 1. 总览

| 检查面 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过 |
| `npm test` | ✅ 31/31（原 20 + 新 11） |
| `npm run build` | ✅ 通过 |
| 改动范围 | ✅ `server.ts` / `storage.ts` / `mcp-server.ts` + 测试 + 文档，无越界 |
| 提交划分 | ✅ 严格按方案 §2 分 5 个提交，与实施顺序一致 |
| 四条高危 | ✅ **H1–H4 全部实测封堵** |
| 附带项 | ✅ M5、L1、L6 均已实施 |
| 三条不可妥协约束 | ✅ 全部未被违反（MCP、vite dev、无 CORS 头） |
| 功能回归 | ✅ 未发现回归 |

**结论：本次硬化达标，未发现新引入缺陷。** 详见下方证据。

## 2. 攻击复现（隔离实例，端口 4199）

逐条按原审计报告的手法重打一遍：

| 原漏洞 | 攻击手法 | 硬化前（原审计实测） | 硬化后（本次实测） |
|---|---|---|---|
| **H4** | `Host: bookd.evil.example` | 200，全量读写可达 | **403** |
| **H4** | `Host: evil.com` 访问 `/api/books` | 200 | **403** |
| **H2** | `Content-Type: text/plain` + 空 body + 伪造 Origin 打 `clear-highlights` | `{"ok":true,"removed":1}`，批注与 notes.md 双双清空 | **403**（`{"error":"请求来源不受信任"}`） |
| **M1** | 伪造 Origin 的 multipart 导入 | 201，书进库并强制切换用户阅读器 | **403** |
| **H3** | 上传文件名 `...md`（无一级标题）越目录写 | 201，六个文件写入书库父目录 | **400**（`无效的书籍 ID`），库目录为空、**父目录无任何新增文件** |
| **L1** | `GET /api/books/a%2Fb` | 500 | **400** |
| **H1** | WS 握手 `Origin: https://evil.example.com` | 接受，立刻收到 `hello`（书库 + 阅读状态全泄露），并可 `state:update` 篡改 | **连接被拒**（socket hang up） |
| **H1** | WS 握手 `Origin: http://attacker.local` | — | **连接被拒** |

H3 的验证特别说明：**故意用「无 Origin」的合法本地客户端发起**，绕过第一层 Origin 校验，直击第二层路径断言。否则会被外层挡住、测不到 `bookDir()` 的修复是否真的生效。分层防御必须分层验证。

## 3. 三条不可妥协约束的验证（同等重要）

安全加固最常见的失败不是没修好，而是把自己锁在门外。逐条实测：

**约束一 · 未断 MCP（放行无 Origin）**

- WS 无 Origin 握手 → 正常收到 `hello` ✅
- 无 Origin 的 `POST /api/commands/goto` → 200 ✅
- 无 Origin 的 `PUT /api/state` → 200 ✅
- **真实 stdio MCP 子进程连接 dist/mcp.js，8 个工具逐个实测全部成功** ✅
  （`get_reading_state`、`list_books`、`open_book`、`get_chapter`、`search_book`、`goto`、`highlight`、`clear_highlights`）

**约束二 · 未断 vite dev（Host/Origin 忽略端口）**

- `Host: 127.0.0.1:5173`、`localhost:5173`、`[::1]:5173` → 均 200 ✅
- `Origin: http://127.0.0.1:5173` 的 WS 握手与 POST → 均成功 ✅
- **实起 vite 5173，经其代理访问 4123**：`/api/health`、`/api/books`、`POST /api/commands/goto` 全部 200 ✅
  （这是最关键的一条——vite 代理未设 `changeOrigin`，转发时 Host 保持 `127.0.0.1:5173`，若白名单比对了端口，dev 流程会全线 403）

**约束三 · 未加 CORS 放行头** — 检查响应头，无 `Access-Control-Allow-Origin` ✅

## 4. 实现质量

读过 diff，实现比方案要求更严谨的几处：

- **`hostHeaderHostname`** 用 `new URL('http://'+host).hostname` 解析而非手工切分，正确处理 IPv6 `[::1]:4123`（配合 `normalizeHostname` 剥方括号），并天然忽略端口。测试里有 `[::1]:5173` 用例。
- **路径断言**用 `resolved !== root && !resolved.startsWith(root + path.sep)`，正确规避了裸字符串前缀匹配会被 `~/Books-evil` 这类兄弟目录绕过的陷阱（方案点名要求，已照做）。
- **正则** `/^(?!\.+$)[\p{L}\p{N}._-]+$/u` 用负向先行断言排除纯点段，且有专门测试锁定《舆论》《随椋鸟飞行-复杂系统的奇境》两个现存中文 ID 仍可用——防止收紧规则时误伤真实数据。
- **WS upgrade 的 URL 解析**从 `request.headers.host` 改为硬编码 `'http://localhost'`（超出方案要求的额外加固）：避免恶意 Host 头影响 pathname 判定。
- **`InvalidBookIdError`** 用具名错误类型而非字符串匹配来区分 400/500，比方案设想的实现更干净。
- **测试**新增 11 条，其中「不误伤」类（无 Origin、dev Origin、dev Host、IPv6 Host、中文 ID 保留）与「防护生效」类并重——**这类测试才是防止未来有人"加强"规则时悄悄打断 MCP 的保险**。

## 5. 一次假阳性（审计方法记录，非缺陷）

首轮通过**本会话已加载的 MCP 客户端**调用 `clear_highlights`（省略 `book_id`）时返回 `缺少 bookId`，一度像是方案 §3.3 的联动改造失效。

核实为**客户端陈旧导致的假阳性**：`dist/mcp-server.js` 内 `resolvedBookId` 解析逻辑齐全（20:04 构建），而本会话的 MCP 进程 PID 59756 启动于 **09:15**，加载的是改造前的旧代码。改用**新起的 stdio 子进程**复测 → `{"ok":true,"removed":1}`，联动改造正确。

**方法论教训（写给后续审计者）**：bookd 的 MCP 在 Claude Code 会话启动时加载并常驻，**修改代码后本会话的 MCP 工具不会更新**。任何针对 MCP 行为的审计结论，必须用新起的 stdio 子进程验证，不能用会话内已加载的工具下判断。

## 6. 功能回归

| 项 | 结果 |
|---|---|
| 阅读器加载、正文渲染、纸面与主题 | ✅ 正常 |
| WebSocket 桥（顶栏「本地桥已连接」） | ✅ 正常 |
| 翻页 → 状态上报（`progress` / `visibleTextHead` / `updatedAt` 同步推进） | ✅ 正常 |
| MCP 8 工具 | ✅ 全部正常 |
| `clear_highlights` 省略 `book_id` 仍作用于当前书 | ✅ 正常（语义未变） |
| 用户既有批注数据 | ✅ 完好（《舆论》1 条，审计用的临时批注已清理） |
| vite dev 双端口 | ✅ 正常 |
| 断线补发（N1） | ⚠️ **未手工复测**，由 `useBookdSocket.test.ts` 的真实双服务集成测试覆盖且通过；本次未触碰该代码路径，风险低 |

## 7. 遗留与建议（非阻塞）

- **R1 · `/api/health` 仍泄露绝对路径**：当前返回 `libraryDir` `/Users/gothic/Books/bookd` 与 `stateFile` 全路径（含用户名）。加固后跨源已读不到，**自用无实际风险**；但方案 §7 与 `plan-packaging` 均已注明——**公开分发前必须收敛**为仅 `ok/service/version`。另注意：`plan-packaging-2026-08-06.md` §A1 计划给 health 增加 `pid` 字段（供 `bookd stop` 用），实施时应同步考虑把详细信息移到需本地校验的端点，两份方案在此处存在设计交叉。
- **R2 · 未修项照旧**：M7（书内容 iframe 与宿主同源，当前靠 sanitizer + CSP 双层防御，实测有效）、M6（zip 炸弹无解压上限）、M2（章节索引按标题匹配）、M3、M4。M6 成本低，建议紧接着做。
- **R3 · 文档**：`docs/audit-2026-08-06.md` 已按要求追加修复状态（+28 行），`PROGRESS.md` 已更新。三份 plan 文档尚未提交（工作区 untracked）。

## 8. 分发闸门状态

`plan-hardening` §7 定义的分发阻塞项：**H1–H4 已全部解除**。剩余的分发前置条件为 R1（health 信息收敛）与 npm 包名核实，均非安全阻塞。就"是否可以给别人装"这一问而言，**最危险的四道门已经关上**。
