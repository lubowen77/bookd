# bookd 阅读器 UX 改进 · 技术实施方案

> 交接文档 v1.0（2026-08-06）。写给执行开发的 agent：本文自包含，所有根因定位、已验证事实、设计决策均已显式化，不依赖任何会话上下文。引用的行号以当前 git HEAD 为准，若有偏移以内容检索为准。

## 0. 背景与总原则

bookd 是本地伴读阅读器：Node 服务（4123）+ Web 阅读器 UI + WebSocket 双向桥 + MCP 薄客户端。本次是纯前端 UX 迭代，共 7 项改动（5 项来自用户，2 项为已确认顺手修复）。

**硬边界（全部必须遵守）：**

- 只改 `src/client/` 与 `src/client/styles.css`。**服务端（src/server.ts 等）与 MCP（src/mcp*.ts）零改动**——所有问题根因都在客户端，且服务端行为（如 highlight 命令广播给发起者自己）是 MCP 路径依赖的设计，不许"顺手优化"。
- 不新增运行时依赖，不升级依赖版本。
- 渲染零 AI 参与原则不变：全部是确定性代码。
- 现有默认观感不变：改动后不调设置的用户看到的排版应与现在一致（默认值全部取现状值）。

**验收命令：**

```bash
npm run typecheck   # 两个 tsconfig 都过
npm test            # vitest
npm run build       # 服务端 tsc + vite build
```

构建后要在 4123 端口看到新前端，必须重启常驻服务（它跑的是 dist 产物）：

```bash
lsof -nP -iTCP:4123 -sTCP:LISTEN   # 找到旧进程 PID
kill <PID>
nohup node dist/cli.js serve --port 4123 >/dev/null 2>&1 &
```

开发期间用 `npm run dev`（tsx watch 4123 + vite 5173，前端在 5173 热更）更方便，但**最终验收必须在 4123 的构建产物上做一遍**。

---

## 1. 改动总览

| # | 项目 | 类型 | 主要文件 |
|---|------|------|----------|
| 1 | 「状态正在同步」→「同步通道已连接」 | 文案 | App.tsx |
| 2 | 划线一次出现两条批注 | Bug 修复 | App.tsx |
| 3 | 品牌区改「BookD」+ 垂直对齐 | UI | App.tsx, styles.css |
| 4a | 左右两侧翻页浮钮 | 功能 | App.tsx, styles.css |
| 4b | 键盘方向键翻页（全局） | 功能 | App.tsx |
| 4c | 顶部点击唤出功能区（视图/字体/纸面） | 功能 | 新组件 + FoliateReader.tsx + styles.css |
| 5 | 侧栏收起后无法重新打开 | Bug 修复 | App.tsx, styles.css |
| 6 | WS 断线时阅读位置静默丢失 | Bug 修复 | useBookdSocket.ts |

建议实施顺序：2 → 5 → 1 → 3 → 6 → 4b → 4a → 4c（先小后大，4c 最后因为它引入设置系统）。

---

## 2. 各项详细方案

### 2.1 文案修改（#1）

`src/client/App.tsx:380`：

```
{connected ? '状态正在同步' : '等待本地桥重连'}
```

改为：

```
{connected ? '同步通道已连接' : '等待本地桥重连'}
```

背景：`connected` 唯一来源是 WebSocket 的 open/close 事件（useBookdSocket.ts:24,41），它证明的是"管道通"而非"数据已同步成功"，旧文案的进行时语态在 relocate 事件停发时会误导用户。顶栏另一处「本地桥已连接」（App.tsx:271）语义正确，**不动**。

### 2.2 划线重复 Bug（#2）——根因已定位，必现

**根因**：从阅读器 UI 划线时，同一条 annotation 通过两条路径进入客户端状态，其中一条没有去重：

1. 服务端 `/api/commands/highlight` 处理顺序是：保存 → `issueCommand` 广播（server.ts:195，**广播对象包含发起请求的客户端自己**）→ 返回 HTTP 201（server.ts:196）。
2. 客户端 WS 路径（App.tsx:69-72）**有**按 id 去重：`current.some(item => item.id === command.annotation.id) ? current : [...current, command.annotation]`。
3. 客户端 HTTP 响应路径（App.tsx:226，`addHighlight` 内）**无**去重：`setAnnotations(current => [...current, result.annotation])`。

由于服务端先广播后回响应，WS 消息几乎必然先到：WS 先 append（此时列表里还没有，通过去重检查）→ HTTP 响应再无条件 append → **每次从 UI 划线必得两条**。MCP 发起的划线只走 WS 单路径，所以不受影响。

**修复**：抽一个按 id 去重的纯函数，两处共用：

```ts
// src/client/annotations.ts（新文件）
import type { Annotation } from '../shared'
export const upsertAnnotation = (list: Annotation[], item: Annotation): Annotation[] =>
  list.some(existing => existing.id === item.id)
    ? list.map(existing => existing.id === item.id ? item : existing)
    : [...list, item]
```

- App.tsx:226 改为 `setAnnotations(current => upsertAnnotation(current, result.annotation))`
- App.tsx:70-72 的 WS 分支改用同一函数（行为不变，消除重复实现）
- 配套单测 `src/client/annotations.test.ts`（vitest 已配置）：新增、重复 id 不增条目、重复 id 更新内容，三个 case。

**数据层核查**：服务端每次请求只 `addAnnotation` 一次，正常情况下磁盘只有一条。但用户可能在 bug 存续期间多点过保存，先核查：

```bash
curl -s 'http://127.0.0.1:4123/api/books/%E8%88%86%E8%AE%BA/annotations' | python3 -m json.tool
```

若存在 cfi+text 完全相同的重复条目，逐条 `POST /api/commands/clear-highlights`（body: `{"bookId":"舆论","annotationId":"<重复条目id>"}`）清掉多余的。**不要**在服务端加"同 cfi 防重"逻辑——超出本次范围。

**验证**：修复后在 UI 划一条线，侧栏只出现一条；刷新页面仍是一条；再用 MCP `highlight` 工具划一条，同样只出现一条。

### 2.3 品牌区（#3）

**现状**：`App.tsx:263` 是 `<span className="brand-word">bookd</span><span className="brand-sub">伴读阅读器</span>`；styles.css:41 `.brand` 用 `align-items: baseline`，Georgia 27px 与 12px 中文小字基线对齐，视觉上整体偏上（用户已指出）。

**改动**：

1. App.tsx:263 改为只保留 `<span className="brand-word">BookD</span>`，删除 `brand-sub` span。
2. styles.css：
   - `.brand` 的 `align-items: baseline` → `center`；`gap` 可删。
   - `.brand-word` 加 `line-height: 1`，微调 `letter-spacing`（大小写混排后 -.03em 可能过挤，目检定夺，-.01em 起试）。
   - 删除 `.brand-sub` 规则（styles.css:43）及移动端分支里的 `.brand-sub { display: none; }`（styles.css:199 附近）。
   - `.theme-light .brand-word` 颜色覆盖（styles.css:181）保留。
3. 同步改 `src/client/index.html` 的 `<title>`（若含"bookd"字样则统一为 BookD；只改展示文案，**不改**代码里的 id、包名、API 路径）。

**验证**：明暗两主题下目检顶栏，wordmark 垂直居中；窄窗口（<820px）不溢出。

### 2.4 侧栏重开 Bug（#5）——根因已定位

**根因**：重开按钮存在（左 `side-reopen` App.tsx:311，右 `right-reopen` App.tsx:395）但被两层埋葬：

1. styles.css:92 `.side-reopen, .right-reopen { display: none; }` —— 桌面端直接不渲染。
2. 按钮位于侧栏元素**内部**，而收起时侧栏 `transform: translateX(±100%)`（styles.css:62-63）移出屏幕。CSS transform 会为后代创建 containing block，**连 `position: fixed` 的后代都会被一起带走**——所以就算把 display 改掉，按钮在栏内也救不回来。

桌面端唯一入口是顶栏 `mobile-only` 的 menu 按钮（只救左栏、只在移动端显示）。

**修复**：把两个重开按钮**移出侧栏**，作为 `.app-shell` 的直接子元素（紧邻两个 aside 放置），默认隐藏，仅收起态显示为贴屏幕边缘的浮钮：

```css
.side-reopen, .right-reopen {
  display: none;
  position: fixed; top: 50%; transform: translateY(-50%);
  z-index: 30; width: 22px; height: 64px;
  align-items: center; justify-content: center;
  border: 1px solid var(--line); background: var(--chrome-bg, rgba(20,20,20,.85));
  color: #aaa9a4; cursor: pointer; opacity: .55; transition: opacity .15s;
}
.side-reopen { left: 0; border-left: 0; border-radius: 0 8px 8px 0; }
.right-reopen { right: 0; border-right: 0; border-radius: 8px 0 0 8px; }
.side-reopen:hover, .right-reopen:hover { opacity: 1; }
.left-closed .side-reopen { display: flex; }
.right-closed .right-reopen { display: flex; }
```

（变量名与配色按 styles.css 现有 token 对齐，上面是形态示意；明亮主题下配色要跟随 `.theme-light`。）

按钮加 `aria-label="展开书库"` / `"展开伴读栏"`，加 `title` 提示。移动端现有抽屉逻辑（styles.css:196-212）不动，浮钮在 <820px 断点下隐藏（移动端已有 menu 按钮）。

**验证**：桌面端分别收起左、右、双栏，均能通过边缘浮钮恢复；移动端行为不回归。

### 2.5 WS 断线补发（#6）

**根因**：`useBookdSocket.ts:54-58` 的 `sendState` 在 `readyState !== OPEN` 时直接 return，静默丢弃。断线期间的翻页进度永久丢失，绿点恢复后状态也不会补上。

**修复**（全部在 useBookdSocket.ts 内）：

```ts
const pending = useRef<Partial<ReadingState> | null>(null)

const sendState = useCallback((state: Partial<ReadingState>) => {
  if (socket.current?.readyState === WebSocket.OPEN) {
    socket.current.send(JSON.stringify({ type: 'state:update', state }))
  } else {
    pending.current = { ...pending.current, ...state }   // 合并累积，只留最后值
  }
}, [])

// ws 'open' 监听器里，设置 connected=true 之后：
if (pending.current) {
  ws.send(JSON.stringify({ type: 'state:update', state: pending.current }))
  pending.current = null
}
```

**已知小瑕疵（接受，不修）**：重连时服务端会先发 `hello`（携带旧状态）再处理补发，客户端界面可能闪一下旧位置，随后服务端广播新状态纠正。消除它需要给状态加时间戳比较，超出本次范围。

**手动验证**：翻到某页 → kill 4123 服务 → 再翻几页（绿点灭）→ 重启服务 → 等重连（≤1s）→ `curl -s http://127.0.0.1:4123/api/state` 确认 cfi/progress 是断线期间的最新位置。

### 2.6 键盘方向键翻页（#4b）

**现状**：正文 iframe 内已监听 ArrowLeft/Right（FoliateReader.tsx:81-83，调 `element.goLeft()/goRight()`），但焦点在外层 document（点过侧栏、顶栏之后）时无人处理——这就是"时灵时不灵"的原因。

**修复**：在 App.tsx 现有的全局 keydown（App.tsx:97-114）里补充：

```ts
if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    && activeBook && !searchOpen
    && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
  event.preventDefault()
  const backwards = event.key === 'ArrowLeft'
  if (activeBook.format === 'markdown') {
    gotoChapter(backwards
      ? Math.max(0, chapterIndex - 1)
      : Math.min(activeBook.chapters.length - 1, chapterIndex + 1))
  } else {
    dispatchLocal({ type: 'page', direction: backwards ? 'previous' : 'next' })
  }
}
```

与底部 page-controls（App.tsx:349-353）的分派逻辑完全一致，**建议抽成共享的 `pageBackward()/pageForward()` 函数**，供 page-controls、键盘、4a 浮钮三处共用。

注意：这个 effect 现在依赖数组是 `[]`，引入 activeBook/chapterIndex/searchOpen 后要么补依赖，要么用 ref 承载最新值——按项目现有风格（useCallback + 依赖数组）处理，别引入 stale closure。

iframe 内已有的监听**保留**（焦点在正文内时不冒泡到外层 window，两层互不冲突）。

**验证**：点击侧栏任意处后按方向键仍能翻页；搜索框、笔记 textarea 内按方向键光标正常移动、不翻页；markdown 书方向键切章。

### 2.7 左右翻页浮钮（#4a）

在 `reader-stage`（App.tsx:314 的 `<main>`）内、阅读器组件之外，加左右两个浮钮：

```tsx
{activeBook && <>
  <button className="page-arrow page-arrow-left" onClick={pageBackward} aria-label="上一页"><ChevronLeft size={22} /></button>
  <button className="page-arrow page-arrow-right" onClick={pageForward} aria-label="下一页"><ChevronRight size={22} /></button>
</>}
```

行为与键盘一致（epub 翻页 / markdown 翻章），复用 2.6 抽出的共享函数。

样式要点：

- 绝对定位于 reader-stage 左右两侧、垂直居中；圆形（~40px），默认低透明度（.35 左右），hover 到按钮或 reader-stage 时升到 .9。
- 位于纸面左右的空白 margin 区（参考截图标注意图）；窄视口纸面占满时允许叠在纸面边缘上层，半透明不遮字。
- `z-index` 低于选区工具栏与功能区面板。
- 不要覆盖大面积热区（用户可能在纸面边缘选字），**只有按钮本身可点**。

**验证**：epub 点击左右钮翻页、markdown 切章；按钮不遮挡文本选择。

### 2.8 顶部功能区（#4c）——本次最大项

#### 交互形态

- 在 `reader-canvas`（FoliateReader.tsx:249 附近的容器）顶部、iframe 之外，放一个全宽窄条（高约 28px）作为触发区：默认透明，hover 显示居中的短横条 pill 提示，点击 toggle 设置面板。
- 设置面板从顶部滑下，绝对定位覆盖在正文上方（不推挤布局）。点击面板外或按 Esc 关闭。Esc 处理并入 App.tsx 现有全局 keydown 的 Escape 分支。
- markdown 书同样显示功能区，但「视图」组隐藏（markdown 天然滚动，单双页无意义）。

可选增强（P2，时间富余再做）：正文 iframe 内点击顶部 80px 区域也 toggle 面板——在 FoliateReader onLoad 已有的事件挂载处加 click 监听，判断 `event.clientY < 80` 且当前无选区。与 mouseup 选区逻辑并存无冲突（点击时 selection 是 collapsed）。

#### 面板内容（三组）

1. **视图**（三选一段控件，epub only）：单页 / 双页 / 滚动
2. **文字**：字号 A− / A＋（显示当前档位）+ 字体族三选：宋体 / 黑体 / 楷体
3. **纸面**（四色块单选）：白纸 / 米黄 / 豆沙绿 / 墨色

#### 设置系统设计

新文件 `src/client/settings.ts`：

```ts
export interface ReaderSettings {
  view: 'single' | 'spread' | 'scroll'
  fontSize: number            // rem 档位
  fontFamily: 'song' | 'hei' | 'kai'
  paper: 'white' | 'cream' | 'green' | 'dark'
}

export const FONT_SIZES = [0.92, 1.0, 1.08, 1.16, 1.26, 1.38]  // rem，6 档

export const DEFAULT_SETTINGS: ReaderSettings = {
  view: 'single', fontSize: 1.08, fontFamily: 'song', paper: 'cream',
}   // 全部取现状值，保证存量用户升级无感

const KEY = 'bookd:reader-settings'
export const loadSettings = (): ReaderSettings => { /* localStorage + JSON.parse，try/catch 回 DEFAULT，逐字段校验合法性（枚举/档位表内），非法字段回默认 */ }
export const saveSettings = (settings: ReaderSettings): void => { /* localStorage.setItem */ }
```

字体族映射（macOS 本机字体，均有安装兜底链）：

| 值 | font-family |
|----|-------------|
| song（默认） | `"Songti SC", "STSong", "Noto Serif CJK SC", serif` |
| hei | `"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif` |
| kai | `"Kaiti SC", "STKaiti", serif` |

纸面色板（bg / 正文 ink / 链接色，selection 背景沿用金色系但按纸面调 alpha）：

| 值 | bg | ink | link | 备注 |
|----|----|----|------|------|
| white | `#ffffff` | `#2a2926` | `#7a5b2b` | |
| cream（默认） | `#f5f0e7` | `#242321` | `#7a5b2b` | 即现状（FoliateReader.tsx:8-23 的 ebookStyles） |
| green | `#c9e0c9` | `#24312a` | `#5b7a4b` | 目标观感：低饱和豆沙绿，长时阅读不刺眼；具体值可目检微调 |
| dark | `#17181a` | `#c9c7c1` | `#b8935a` | selection 用 `rgba(197,153,68,.35)`；`color-scheme: dark` |

**纸面色的两层应用**（关键，漏一层会出现色差边框）：

1. **iframe 内**：把 FoliateReader.tsx 顶部的静态 `ebookStyles` 字符串改为 `makeEbookStyles(settings)` 函数（放 settings.ts），模板里注入 bg/ink/link/font-size/font-family。
2. **iframe 外**：纸面外的舞台区（`reader-canvas` / `reader-stage` 的背景，在 styles.css 中检索这两个类名定位现值）必须同步。实现方式：在 `.app-shell` 上加 `data-paper={settings.paper}` 属性，styles.css 用 `[data-paper="green"] .reader-canvas { background: ... }` 四组覆盖。MarkdownReader 的正文样式类同样通过这组 CSS 变量吃到纸面色与字号（检索 `.markdown` 前缀类名接入，MarkdownReader.tsx 组件本身预计零改动或极小改动）。

#### 应用到 foliate 渲染器

已验证事实（node_modules/foliate-js/paginator.js:417-419）：renderer（`view.renderer`，即 foliate-paginator 元素）的 observedAttributes 包括 `flow`、`gap`、`margin`、`max-inline-size`、`max-block-size`、`max-column-count`，改属性即时生效并保持阅读位置。`setStyles` 重注入样式的先例在 FoliateReader.tsx:140。

视图映射：

| view | 操作 |
|------|------|
| single | `renderer.setAttribute('flow', 'paginated')`；`setAttribute('max-column-count', '1')`；`max-inline-size` 720px（≈现状观感） |
| spread | `flow=paginated`；`max-column-count=2`；`max-inline-size` 降到 ~560px 使常见视口（~1160px 中栏）能排出双栏，配 `gap` 微调 |
| scroll | `renderer.setAttribute('flow', 'scrolled')`（column 属性此时无意义） |

FoliateReader 改动：

- 新增 prop `settings: ReaderSettings`。
- 初次 open 流程里（现 FoliateReader.tsx:140-141 附近）：`init` **之前**按 settings 设置 flow/columns 属性，`setStyles(makeEbookStyles(settings))` 替代静态样式。
- 新增 `useEffect([settings])`：view 存在时重新 setAttribute + setStyles。foliate 内部会触发 relocate 保持位置，无需手动恢复 CFI。

App.tsx 改动：

- `const [settings, setSettings] = useState(loadSettings)`；变更时 `saveSettings`。
- settings 传入 FoliateReader；`data-paper` 挂到 app-shell。
- 功能区面板做成新组件 `src/client/ReaderSettingsPanel.tsx`（受控：`settings` + `onChange` + `format`），触发条与面板挂在 reader-stage 内。

#### 已知取舍（写给验收，不是问题）

- 双页模式下 relocate 的 `visibleTextHead` 覆盖两页内容，更易触及 1000 字符截断——MCP 侧可见文本变成"当前 spread 的前 1000 字符"，可接受。
- 滚动模式下 relocate 触发频率显著升高，WS 消息变密；服务端已有 180ms 防抖落盘（state.ts:84），无需处理。
- 滚动模式下方向键/浮钮的 goLeft/goRight 行为是按屏滚动，foliate 原生如此，保持。

**验证**：三种视图互切且阅读位置不漂移（记住当前段落，切换后仍在附近）；字号/字体即时生效；四种纸面 iframe 内外无色差边框；设置刷新页面后保留；markdown 书功能区无「视图」组但字体/纸面生效；MCP `get_reading_state` 在滚动模式下仍持续回报位置。

---

## 3. 交付物清单

1. 代码：上述 7 项全部实现，`typecheck` / `test` / `build` 三绿。
2. 新增单测：`annotations.test.ts`（upsert 三 case）、`settings.test.ts`（loadSettings 对非法 localStorage 的回退）。
3. 数据核查：清理《舆论》可能存在的重复批注（见 2.2）。
4. 在 4123 构建产物上完成第 2 节各项「验证」步骤，并重启常驻服务（见第 0 节命令）。
5. 更新 `PROGRESS.md`：记录本次 7 项改动与日期。
6. git commit（可多个，按项分）；不 push（无远端约定）。

## 4. 风险提示

- **App.tsx 的 keydown effect 依赖**（2.6）是本次最容易写出 bug 的点：stale closure 会让翻页停在旧章节。改完务必手测"切书后方向键翻的是新书"。
- FoliateReader 的 settings effect 不要依赖整个 settings 对象引用又在内部 setState 造成循环；settings 由 App 单向下发，FoliateReader 只消费。
- styles.css 是手写体系（无预处理器），新增规则注意放进已有的 `.theme-light` / 移动端 `@media` 分支结构里，别破坏 820px 断点行为。
