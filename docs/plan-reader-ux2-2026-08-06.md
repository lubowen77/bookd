# 阅读器 UX 第二轮 · 实施方案

> 交接文档（2026-08-06）。自包含，不依赖会话上下文。行号以内容检索为准。
> 范围：5 项（1 个通用缺陷修复 + 1 项遗漏功能 + 3 项交互改进）。**纯前端**，服务端与 MCP 零改动。

## 0. 边界

- 只改 `src/client/`（`FoliateReader.tsx` / `App.tsx` / `settings.ts` / `styles.css` + 新增组件）。
- **不碰** `src/server.ts`、`src/storage.ts`、`src/mcp-server.ts`——上一轮安全硬化刚落地（H1–H4），任何服务端改动都可能破坏防护或误伤 MCP。
- 不新增运行时依赖。
- 不改变 `visibleTextHead` 的采集与上报逻辑（AI 通过 MCP 读到的内容不受本次任何改动影响）。

---

## 1 · 【缺陷】calibre 类书籍字号无法调整（最高优先级）

### 现象

切到《随椋鸟飞行：复杂系统的奇境》后，设置面板的字号 A−/A＋ 点了没反应；《舆论》正常。字体族（宋/黑/楷）能切。

### 根因（已用 DOM 实测确证，非推测）

该书 body 带 `class="calibre"`，书自带样式表含 `.calibre { font-size: 1em }`。实测命中 body 的 font-size 规则按优先级排序为：

```
.calibre  →  font-size: 1em      ← 书自带，类选择器，特异性 (0,1,0)  ★ 胜出
body      →  font-size: 1.16rem  ← 我们注入的，元素选择器，特异性 (0,0,1)
```

实测 `getComputedStyle(body).fontSize` = `16px`，而设置值 1.16rem 应为 18.56px。

`src/client/settings.ts` 的 `makeEbookStyles()` 里，`margin` / `padding` / `font-family` 都带了 `!important`，唯独 **`font-size` / `line-height` / `letter-spacing` 没带**——所以字体族能改、字号改不了。

**这是通用缺陷**：calibre 是最主流的电子书转换工具，其产出的 EPUB 普遍带 `.calibre` 类，不是这一本书的特例。

### 修复

`makeEbookStyles()` 中给排版三属性补 `!important`：

```
body {
  ...
  font-size: ${settings.fontSize}rem !important;
  line-height: 1.95 !important;
  letter-spacing: .025em !important;
}
p, li, blockquote, dd { line-height: 1.95 !important; text-align: justify; }
```

**不要**给子元素强加 `font-size`。body 字号提上去后，书内用相对单位（em/rem/%）的子元素会自动跟随继承——这是正确且保守的做法。少数用绝对 px/pt 的元素（版权页小字等）不跟随，属可接受的既有行为，不在本次处理。

### 验收（关键陷阱）

**必须用《随椋鸟飞行》验证，只测《舆论》会漏掉**。逐档点 A−/A＋，用以下方式确认 iframe 内实际生效：

```js
document.querySelector('foliate-view').renderer.getContents()[0].doc
```
取其 `body` 的 computed `fontSize`，应随档位变化（6 档：0.92/1/1.08/1.16/1.26/1.38 rem → 14.72/16/17.28/18.56/20.16/22.08 px）。两本书都要过。

---

## 2 · 【遗漏】「阅读上下文」折叠功能

上一轮已出方案 `docs/plan-context-collapse-2026-08-06.md` 但**未被执行**（代码中无 `contextOpen`）。本次一并实现，要求见该文档，此处只重申要点：

- 右栏 `bridge-card` 默认**折叠**：只显示标题「阅读上下文」+ 状态行（绿点/「同步通道已连接」）。
- 点标题行展开：显示**完整** `visibleTextHead` 与 CFI；再点收起。折叠态**不持久化**。
- 展开的正文容器 `max-height: 40vh; overflow-y: auto`——`visibleTextHead` 最长 1200 字符，不限高会把下方「我的批注」区挤出视口。
- 标题行改 `<button>`，带 `aria-expanded`，右侧 `ChevronDown`（lucide 已有依赖）展开时旋转 180°。
- 删除 `styles.css` 中 `bridge-card` 对 `<p>` 的现有截断/渐隐样式（折叠态已不渲染正文，截断失去意义）。

---

## 3 · 【UI】翻页浮钮与侧栏重开钮重叠

### 现状几何（已实测）

| 元素 | 定位 | 占据水平区间 |
|---|---|---|
| `.side-reopen` / `.right-reopen` | `position: fixed; top: 50%; left/right: 0; width: 24px` | 0–24px |
| `.page-arrow-left/right` | `position: absolute; top: 50%; left/right: 18px; width: 40px` | 18–58px |

两者 `top` 同为 50%，垂直完全重合，水平重叠 **18–24px**——即用户截图标记处。侧栏收起时必然重叠。

### 修复

把 `.page-arrow-left/right` 的偏移从 `18px` 统一改为 `40px`（`styles.css:139-140`）。

**统一改、不做条件判断**：若写成"仅侧栏收起时推开"，按钮会在开关侧栏时左右跳动。固定 40px 让位置恒定，让开重开钮的 24px 宽度 + 16px 间隙。

同步调整移动端与容器查询断点内的覆盖值（`styles.css` 检索 `.page-arrow-left`，现有 `left: 2px` / `left: 6px` 等，按同样思路让开边缘控件）。

---

## 4 · 【新功能】滚轮翻页

### 前提（已核实）

foliate-js **没有** wheel 处理（`grep wheel node_modules/foliate-js/paginator.js` 无结果），必须自行实现。

### 实现位置

正文在 iframe 内，**wheel 事件不会冒泡到宿主页**，必须在 iframe 文档上监听。`FoliateReader.tsx` 的 `onLoad` 回调（检索 `doc.addEventListener('mouseup'`）已经是给 iframe 文档挂监听的现成位置，且已有配套的 `cleanups.push(...)` 卸载逻辑——**新监听必须同样注册到 cleanups**，否则切书时泄漏。

同时给宿主页的 `reader-canvas` 挂一份，覆盖鼠标位于正文两侧留白区的情况。

### 行为

- **仅在分页模式生效**（`settings.view === 'single' | 'spread'`）。滚动模式（`flow: scrolled`）下**必须放行原生滚动**，不要 `preventDefault`。
- 一个 wheel 事件翻一页；`deltaY > 0` 下一页，`< 0` 上一页。
- **节流 ~300ms**：触控板惯性滚动会在一次手势内触发几十个 wheel 事件，不节流会飞掉十几页。
- 分页模式下对生效的事件 `preventDefault()`，避免浏览器把 iframe 内容整体滚动。
- 复用 App 里已有的 `pageBackward()` / `pageForward()` 语义（EPUB 翻页 / markdown 切章）——不要新写一套分派逻辑。设置需通过 prop 传入 FoliateReader（`settings` 已是现有 prop，可直接读 `view`）。

---

## 5 · 【交互】翻页按钮靠近边缘才显现 + 扩大点击热区

用户已确认的两个决策：**只扩大按钮本身**（不做侧边窄条或 Kindle 式三分之一点击区，避免抢掉正文选字/划线）；**靠近左右边缘时才淡入**（平时完全隐藏）。

### 5.1 扩大热区（视觉不变）

按钮视觉保持 40×40 圆形，用伪元素把可点区域扩到约 72×72：

```css
.page-arrow::before { content: ''; position: absolute; inset: -16px; border-radius: 50%; }
```

（`.page-arrow` 已是 `position: absolute`，伪元素定位以其为基准；不要改按钮自身尺寸，否则布局与圆形视觉都会变。）

### 5.2 靠近边缘才显现

替换现有的 `.reader-stage:hover .page-arrow { opacity: .82 }`（`styles.css:141`）。默认 `opacity: 0`，**但保留 `pointer-events`**（否则热区失效、按钮点不到）。

两条路径都要做，缺一会有死角：

1. **留白区（纯 CSS）**：在 `reader-stage` 内加左右两个透明探测区（`position: absolute`，宽约 120px，全高，`z-index` 低于按钮），`:hover` 时用兄弟选择器点亮对应按钮。覆盖鼠标位于正文两侧空白的情况。
2. **正文区（iframe 内转发）**：鼠标移到 iframe 上时宿主页拿不到精确坐标，纯 CSS 失效。在 §4 挂 wheel 监听的同一处加 `mousemove` 监听，判断 `event.clientX` 是否落在 iframe 宽度的左/右 ~120px 内，转发给宿主页（回调置 state 或直接切 class）。**必须节流**（rAF 或 ~50ms），mousemove 是高频事件。同样注册到 cleanups。

淡入淡出用 `transition: opacity .16s`，离开后回到 0。`:disabled` 的按钮（markdown 首/末章）保持不显现。

---

## 6 · 实施顺序与提交划分

1. §1 字号缺陷（独立提交，最高优先级，影响所有 calibre 书籍）
2. §3 重叠修复（纯 CSS，几行）
3. §2 折叠功能
4. §5 按钮显现与热区
5. §4 滚轮翻页（最复杂，放最后）

## 7 · 验收清单

**§1 字号**
1. 《随椋鸟飞行》（calibre 书）六档字号逐档生效，用 iframe 内 computed fontSize 核对像素值。
2. 《舆论》同样正常（不回归）。
3. 字体族三选、纸面四色、单/双/滚动仍全部正常。

**§2 折叠**
4. 默认折叠，仅两行；点击展开显示完整正文与 CFI；再点收起；`aria-expanded` 正确。
5. 长文本时卡片内部滚动，「我的批注」区不被挤出视口。

**§3 重叠**
6. 左右侧栏分别收起、双侧收起，三种状态下重开钮与翻页钮均不重叠、均可点。
7. 侧栏开关时翻页钮位置不跳动。

**§4 滚轮**
8. 单页/双页模式：鼠标在正文上滚轮翻页；在两侧留白区滚轮同样翻页。
9. **触控板快速滑动不飞页**（节流生效）。
10. 滚动模式下滚轮是正常滚动，未被拦截。
11. 切书后滚轮仍正常（验证监听未泄漏、新 iframe 已挂上）。

**§5 显现与热区**
12. 鼠标远离时按钮完全不可见；移近左右边缘淡入；移到正文中央区域消失。
13. 按钮周围约一圈透明区域可点（比视觉圆形大）。
14. **正文区域仍可正常选中文字并划线**（热区未抢占选择操作）。

**通用**
15. `npm run typecheck`、`npm test`、`npm run build` 三绿。
16. 明暗两主题、四种纸面下 §3/§5 的视觉均正常。
17. ≤820px 窄窗口下不破版。
18. **MCP 回归**：`get_reading_state` 仍能拿到位置与 `visibleTextHead`（本次不应影响，但需确认）。
19. 构建后重启 4123 常驻服务；更新 `PROGRESS.md`；按 §6 分 5 个提交。

## 8 · 注意事项

- **iframe 监听必须注册 cleanups**：§4 的 wheel 与 §5.2 的 mousemove 都挂在 iframe 文档上，切书时 iframe 销毁重建。不清理会累积监听器，表现为切几本书后翻页速度异常（一次滚动翻多页）。
- **不要给子元素强加 font-size**（§1）：会破坏书内有意的字号层次（小字注释、引文）。
- **`opacity: 0` 不等于 `display: none`**（§5.2）：必须保留 pointer-events，否则热区连同按钮一起失效。
