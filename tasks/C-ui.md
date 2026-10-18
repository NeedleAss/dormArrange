# C 车道 · 界面外壳与 EVA 视觉（Codex）

- **拥有**：`index.html`、`src/main.js`、`src/core/store.js`、`src/ui/**`、`src/styles/**`、`public/**`、`package.json`
- **规格**：
  - `docs/02-features-flows.md`：交互流程（第二批文档到位前，先按本卡和 docs/03 做）
  - `docs/03-architecture.md` §4–§6：模块 API、store 和时序
  - `docs/06-eva-style.md`：视觉规范
- **调用关系**：planner 同步调用；scene 用命令式 API；ai 是异步的。**只 import 各模块的 `index.js`。**
- 你负责把一切接起来，最终演示在你的电脑上跑。

---

## C0 外壳（15 分钟）

- [x] `index.html` + `src/main.js`。在 main.js 里引入字体：
  ```js
  import '@fontsource/noto-serif-sc/900.css';
  import '@fontsource/barlow-condensed/600.css';
  import '@fontsource/barlow-condensed/700.css';
  import '@fontsource/share-tech-mono/400.css';
  ```
- [x] `src/styles/tokens.css`：docs/06 §2 的色板，§3 的字体变量。
- [x] `src/styles/eva.css`：docs/06 §5 的面板（切角）、警示条、扫描线、六边形底纹、按钮。
- [x] 布局：顶栏 48px、左栏 320px（话导航 + 当前面板）、中间 3D 画布、右栏 320px（监视器）、底栏 76px（时间轴/滑块）。
  - 窗口宽度 < 1280px 时，右栏折叠成抽屉
- [x] `src/core/store.js`：
  - 状态按 docs/03 §5
  - 提供 `get()`、`set(patch)`、`subscribe(fn, keys?)`
  - 初始化时 `room = buildRoom()`
- [x] main.js：`createScene(中间容器, { onSelect })` → `scene.setRoom(store.get().room)`。
- [x] A0 / B0 还没推送时，用 try/catch 加占位，页面不能白屏。

**验收**：`npm run dev` 打开后，能看到 EVA 风格外壳和线框宿舍，控制台无报错。

## C1 开机与标题卡（15 分钟）

- [ ] `src/ui/boot.js`：开机序列。
  - 等宽字逐行打印约 2.5s，内容是自编的系统自检文案（见 docs/06 §5.11）
  - 结束后弹出「方寸」标题卡
  - 点击任意处可跳过
- [ ] `src/ui/titleCard.js`：`showTitleCard({ no, title, en })`，返回 Promise。
  - L 形排版，硬切进出，停留 1.4s（docs/06 §4）
- [ ] 话导航：EP00–EP04 五个按钮，键盘 0–4 对应。切换时先放标题卡，再切换左栏面板。

## C2 EP00 建模 + EP01 入住面板（25 分钟）

- [ ] **EP00**：
  - 模板参数表单：房间长宽高、门、阳台、单元尺寸等，字段见 docs/07 §1
  - 「数地砖」换算小工具：块数 × 砖长 = 尺寸
  - 每个尺寸后面标注来源（估计 / 实测）
  - 改动参数后立刻执行 `buildRoom(params)` → `scene.setRoom`
- [ ] **EP00 分区列表**：
  - 显示每个分区的名称、状态（空白 / 设计中 / 已完成）和占用率
  - 可以锁定或解锁分区
  - 点击分区 → `scene.focusOn(zoneId)`
- [ ] **EP01 输入区**：
  - 大文本框 + 「载入新生示例」按钮（`PRESETS.freshman`）
  - 物品库下拉，用来逐个添加
  - 每个物品可以编辑尺寸和来源
- [ ] 「开始规划」按钮：
  - 先调用 `ai.aiParseItems(text)`，它自带兜底；D 车道还没完成时，直接用 `parseItemsText`
  - 然后依次调用 `planMoveIn(room, items, { owner, lockedZones })` → `scene.setItems` → `scene.setItemStates`
- [ ] **结果区**：
  - 按五类分组，每组带数量徽章：能放下 / 需换位置 / 尺寸待定 / 放不下 / 禁止携带
  - 点击一条结果：执行 `scene.focusOn`，并展示原因、建议和容差句子
  - 如果是 uncertain，同时调用 `scene.showTolerance`

## C3 监视器 + EP02 腾桌面板（25 分钟）

- [ ] **右栏监视器**：
  - 同步率：大号 mono 数字，带 count-up 动画，下方是历史折线
  - 三审决议：「时 / 空 / 心」三格，承认显示绿，否决显示红，悬停时显示 notes
  - 警报流：最新的排在最上面
- [ ] **EP02 面板**：
  1. 「载入乱桌示例」（`PRESETS.messyDesk`）
  2. 专注区预设：仅笔记本 35×25 / 书+笔记本 75×35 / 双开书+笔记本 90×40，另可自定义
  3. 「展开专注力场」：调用 `scene.showFocusField(box)`，冲突物品显示为 conflict 状态
  4. 「生成作战指令」：调用 `planFocusField`，列出步骤（第 k 步……），提供播放 / 单步 / 拖动条
  5. 全部完成后：力场变绿，同步率更新，三审结果刷新
- [ ] **专注限界**：
  - 25:00 倒计时大数字，屏幕边缘显示警示条
  - 场景切到座位视角
  - 倒计时结束后，把时长累计到 `store.focusMinutes`；演示时可以点按钮把 25 分钟加速成 25 秒

## C4 EP03 换季 + EP04 成长（20 分钟，可砍）

- [ ] **EP03**：
  - 月份滑块：9 月 → 次年 8 月；时分复用开关
  - 时空占用谱：分区 × 月份的热力格，阈值按 docs/06 §5.8
  - 换季清单文字，来自 `diffMonths`
  - 拖动滑块时，调用 `scene.setItems(…, byMonth[m].placements)` 播放补间
- [ ] **EP04**：
  - 「保存快照」：填写 label 和学期，生成底栏时间轴上的节点
  - 点击节点加载该快照；「回放」依次播放相邻快照之间的补间
  - 展示同步率随时间变化的折线，以及累计专注时长
  - 可以一键载入 `PRESETS.growth`

## C5 加分

- [ ] 待机演示：60 秒无操作后，自动按 EP00→EP04 轮播（展会式 attract loop，吸引路过的人）。
- [ ] 快捷键：空格 = 播放/暂停，T = 切换视角，F = 展开力场，L = 锁定当前分区。
