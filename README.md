# dsh-codeglance

[English](#english) · 中文

给 DeepSeek Harness Web GUI 用的 **CodeGlance 式会话缩略图**：在会话栏右（或左）侧贴一条缩略图，
把整段对话按真实排版压缩成细线，一眼看清结构，点击或拖动即可跳转。

思路取自 JetBrains 的 CodeGlance —— 只不过它缩的是代码，这里缩的是**对话**。

## 特性

- **逐行映射，不是色块堆**：每一根细线对应屏幕上一行**真实文本**，长度、缩进、位置都来自
  `getClientRects()` / `getBoundingClientRect()` 的实测值。长段落长、短句短、代码块宽、
  右对齐的用户消息靠右 —— 与正文排版一致。
- **三类语义着色**：
  - 你的提问 → DeepSeek 蓝（`--dsw-alias-state-business-primary`）
  - 正式回答 → 深灰（主题主文字色混合）
  - 思考过程 / 工具调用 → 浅灰
  - 另外代码、表格、图片各有一档独立权重
- **跟随真实折叠状态**：思考过程折叠起来时，缩略图里也只占折叠后那么点高度，
  不会留下一条虚假的空白。
- **可视区滑块**：高度 = 可见内容占比，可拖动；点击轨道空白处直接跳转。
- **深色 / 浅色主题自适应**，全部用主题 token，不硬编码颜色。
- **可配置**：左右侧、宽度、不透明度、各类内容权重、折叠行数、窄屏隐藏等，都在
  DSH 设置页 →「会话缩略图」里。

## 安装

插件走 DSH 的本地 bundle 机制，安装方式是把仓库放进 profile 的 `node_modules` 并做软链接。

```powershell
# 1. 取代码
git clone https://github.com/palmyer/dsh-codeglance.git C:\Users\<你>\workspace\dsh-codeglance

# 2. 链到 profile（Windows 需要开发者模式或管理员权限才能建软链接）
New-Item -ItemType SymbolicLink `
  -Path   "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@local\dsh-codeglance" `
  -Target "C:\Users\<你>\workspace\dsh-codeglance"
```

3. 重启 DSH（或重载 Web GUI）即可。缩略图出现在会话栏右侧，设置项在设置页里。

> 包名是 `@local/dsh-codeglance`，路径里的 `@local` 是约定俗成的本地作用域，
> 不是 npm 上的包。本仓库**没有**发布到 npm。

## 设置项

设置页 →「会话缩略图」，分四组：

| 组 | 项 | 说明 |
| --- | --- | --- |
| 配色 | 提问色相 | 蓝 / 绿 / 橙 / 红 / 中性 |
| | 图片色相 | 图片用独立色相，和代码区分开 |
| | 回答浓度 | 回答向主题主文字色混合的比例 |
| | 代码 / 表格 / 图片 / 思考 / 工具 权重 | 各类内容的透明度 |
| 折叠 | 折叠思考过程 | 缩略图是否跟随折叠 |
| | 折叠后行数 | 折叠后保留几行 |
| 尺寸 | 宽度 | 面板宽度（px） |
| | 内边距 | 距会话栏的距离 |
| | 行高 / 行距 | 每根线的粗细和最小间距 |
| 行为 | 停靠侧 | 左 / 右 |
| | 不透明度 | 面板静止时不透明度 |
| | 显示可视区滑块 | 开关 |
| | 窄屏隐藏 / 最小宽度 | 会话栏太窄时不显示 |
| | 隐藏系统侧栏 / 隐藏悬浮齿轮 | 收起其他插件的 UI |

设置存在 `localStorage`（键 `dsh-codeglance:settings`），即时生效，无需重启。

## 工作原理

| 步骤 | 做法 |
| --- | --- |
| 找行 | 读 Chat view 的 `[data-chat-anchor-key]`（每个 flow item 一个） |
| 过滤空行 | 跳过 `hidden` 和 `:empty` 的行；用户/提问行只按 `hidden` 过滤 |
| 量尺寸 | 文本节点用 `Range.getClientRects()`（一行一个矩形），块级元素用 `getBoundingClientRect()` |
| 算长度 | 以真实 `charsPerLine`（来自 `--dsh-chat-content-width` 和内容字号）为分母 |
| 定缩进 | 用居中列几何 `box.left + (box.width - contentWidth) / 2`，不用最左实测值 —— 否则右对齐的短气泡会把整列左边界拉偏 |
| 算比例 | 总高扣除 Chat view 的尾部 spacer（`[data-chat-turn-spacer]` 的**内联**高度） |
| 重绘 | `MutationObserver` 监听 childList / characterData / attributes，150ms 节流 + rAF 合并 |

滑块和内容共用同一个 `range.max`，所以写入位置和滑块位置不会各算一套。

## 已知限制

- 依赖 Chat view 的 DOM 契约（`data-chat-anchor-key`、`data-chat-flow-kind`、
  `data-step-process-body` 等）。这些是内部属性，DSH 升级后可能需要跟进。
- 只测**当前已渲染**的行。DSH 若做虚拟滚动，未挂载的部分不会出现在缩略图里。
- 超长会话（几千行）会触及 400 行/行的绘制预算，缩略图会按比例抽样，不会卡顿但精度下降。

## 许可

[MIT](LICENSE) © 2026 weijingjiang

---

## English

A **CodeGlance-style session minimap** for the DeepSeek Harness Web GUI. It docks a slim
overview strip against the conversation column and compresses the whole conversation into
thin lines, so you can see its structure at a glance and jump by clicking or dragging.

The idea is JetBrains' CodeGlance — except it shrinks a *conversation*, not code.

### What it does

- **Per-line mapping, not colour blobs.** Every thin bar is one real rendered text line. Length,
  indent and position come from measured `getClientRects()` / `getBoundingClientRect()` values,
  so long paragraphs are long, short replies are short, code blocks are wide, and right-aligned
  user messages sit on the right — matching the actual layout.
- **Three semantic tones:** your prompts are DeepSeek blue, formal answers are deep grey, and
  thinking / tool calls are light grey. Code, tables and images each get their own weight.
- **Follows the real collapse state.** When a thinking block is folded, the map shows only the
  folded height — no phantom blank band.
- **Draggable viewport thumb**, plus click-to-jump on the track.
- **Light / dark themes** via theme tokens only.
- **Configurable** from the DSH settings page.

### Install

```powershell
git clone https://github.com/palmyer/dsh-codeglance.git C:\Users\<you>\workspace\dsh-codeglance
New-Item -ItemType SymbolicLink `
  -Path   "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@local\dsh-codeglance" `
  -Target "C:\Users\<you>\workspace\dsh-codeglance"
```

Then restart DSH. The package name `@local/dsh-codeglance` is a local scope, not an npm
package — this repo is **not** published to npm.

### Caveats

- Relies on the Chat view's internal DOM contract (`data-chat-anchor-key`,
  `data-chat-flow-kind`, `data-step-process-body`, …). A DSH upgrade may require follow-up.
- Only measures currently rendered rows; virtualised history is not represented.
- Very long sessions hit the 400-line painting budget and are sampled proportionally.

### License

[MIT](LICENSE) © 2026 weijingjiang
