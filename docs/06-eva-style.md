# 06 · EVA 风格视觉规范（致敬，不复制）

> 读者：C 车道负责 2D 界面，A 车道负责 3D。
> 目标：让人一眼联想到"作战指挥屏"的气质——黑底、高饱和警示色、粗宋体标题卡、等宽遥测数字、警示条、六边形网格；**但界面上不出现任何原作素材**。

## 1. 设计原则

1. **信息即装饰。** 每个装饰元素都对应真实数据：同步率是真实算出来的分数，警报是真实的冲突，倒计时是真实的番茄钟。不要放空转的假数据动画。
2. **硬切，不柔化。** 画面切换用硬切；闪烁用 `steps(2)`；数字跳变用 count-up。只有 3D 物体的补间用缓动。
3. **中文用粗宋，英文用窄体大写，数字用等宽。**
4. **一屏一个焦点。** 标题卡、警报、力场同一时间只突出一个。

## 2. 颜色

### 2.1 基础色板：写进 `src/styles/tokens.css` 的 `:root`

```css
:root {
  --bg-0: #050506;      /* 画布 / 最底层 */
  --bg-1: #0b0b0e;      /* 面板 */
  --bg-2: #15151a;      /* 抬起的块 / 输入框 */
  --grid: #2a1d0c;      /* 暗琥珀网格线 */
  --amber: #ff9a1f;     /* 主线条、主强调 */
  --orange: #ff5a00;    /* 激活、进行中、警示条 */
  --red: #e5161c;       /* 冲突、溢出、禁止、否决 */
  --green: #39ff7a;     /* 通过、能放下、承认、已锁定 */
  --cyan: #2ee6ff;      /* 信息、尺寸待定、门窗 */
  --purple: #8b5cf6;    /* 移动轨迹、被移动的物品、选中辅助 */
  --white: #f4efe6;     /* 标题卡文字（暖白） */
  --text: #e9e1d4;      /* 正文 */
  --muted: #8c8273;     /* 次要文字 */
  --line: rgba(255,154,31,.55);   /* 面板描边 */
}
```

### 2.2 状态色：2D 和 3D 必须一致

| 状态 | 颜色 | 线型 | 中文标签 | 英文代号 |
|---|---|---|---|---|
| fits | `--green` | 实线 | 能放下 | FIT |
| relocate | `--amber` | 实线 | 需换位置 | RELOCATE |
| uncertain | `--cyan` | **虚线** | 尺寸待定 | UNCERTAIN |
| overflow | `--red` | 实线 + 警示条底座 | 放不下 | OVERFLOW |
| banned | `--red` | 1Hz 闪烁 | 禁止携带 | PROHIBITED |
| conflict | `--red` | 2Hz 快闪 | 冲突 | CONFLICT |
| moved | `--purple` | 实线 | 已移动 | MOVED |
| stored | `#5b3f9e` | 实线，低亮度 | 已收起 | STORED |
| zone empty | `--grid` | 虚线 | 空白 | EMPTY |
| zone designing | `--orange` | 1Hz 闪烁 | 设计中 | ACTIVE |
| zone done | `--green` | 实线 | 已完成 | LOCKED |

### 2.3 物品类别填充色：3D 盒子的填充，opacity 0.25

| 类别 | 颜色 | 类别 | 颜色 |
|---|---|---|---|
| luggage | `#c2410c` | electronics | `#0ea5e9` |
| clothes | `#a855f7` | appliance | `#f43f5e` |
| bedding | `#64748b` | toiletry | `#14b8a6` |
| books | `#eab308` | storage | `#a16207` |
| study | `#facc15` | food | `#fb923c` |
| sport | `#22c55e` | decor | `#ec4899` |
| trash | `#6b7280` | misc | `#9ca3af` |

## 3. 字体

所有字体都是 **SIL OFL 1.1** 许可，已在 package.json 中，从 npm 本地加载。

| 用途 | 字体 | 字重 | CSS 变量 | 用法 |
|---|---|---|---|---|
| 标题卡、大标题 | Noto Serif SC（思源宋体） | 900 | `--font-display` | `transform: scaleY(1.18)` 纵向拉长；`letter-spacing: -0.04em`；`line-height: .92` |
| 英文标签、按钮、代号 | Barlow Condensed | 600 / 700 | `--font-label` | 全大写；`letter-spacing: .14em`；字号 11–14px |
| 数字、遥测、计时 | Share Tech Mono | 400 | `--font-mono` | 数字等宽；同步率、尺寸、倒计时都用它 |
| 中文正文 | 系统无衬线 | 400 / 600 | `--font-body` | `"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif`，13–14px |

```css
:root {
  --font-display: "Noto Serif SC", "Songti SC", serif;
  --font-label: "Barlow Condensed", "Arial Narrow", sans-serif;
  --font-mono: "Share Tech Mono", ui-monospace, monospace;
  --font-body: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
}
```

> ❌ 不要使用原作的商用标题字体文件，也不要用"仿原作"的盗版字体。粗宋 + 纵向拉伸 + 紧字距已经足够传达气质。

## 4. 标题卡 Title Card（C1）

```
┌──────────────────────────────────────────────┐
│ 第二话                                        │   ← 小号粗宋，左上
│                                              │
│ 腾                                            │   ← 巨号粗宋竖排（约 22vh/字），
│ 桌                                            │      沿左边缘排成 L 形的竖笔
│                                              │
│ ──────────────── EPISODE 02 // FOCUS FIELD ──│   ← 英文窄体大写，沿底边排成 L 形的横笔
└──────────────────────────────────────────────┘
```

- 背景纯黑 `#000`，文字 `--white`。整张卡**只用黑和白**。
- 进出都用硬切，停留 1.4s。可以在进入第一帧插一帧白闪（opacity 0.15，60ms）。
- 各话文案：

| no | title | en |
|---|---|---|
| 序 | 方寸 | FANGCUN // DORM SPACE-TIME OPS |
| 第零话 | 建模 | EPISODE 00 // MODELING |
| 第一话 | 入住 | EPISODE 01 // MOVE-IN |
| 第二话 | 腾桌 | EPISODE 02 // FOCUS FIELD |
| 第三话 | 换季 | EPISODE 03 // TIME-DIVISION |
| 第四话 | 成长 | EPISODE 04 // GROWTH |

- 标题卡文字全部是我们自拟的，**不要引用原作的分集标题或台词**。

## 5. 2D 组件（C 车道，写进 `src/styles/eva.css`）

### 5.1 面板 `.panel`

- 背景 `--bg-1`，1px `--line` 描边。
- 左上和右下切角 10px：`clip-path: polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)`。
- 头部条 28px 高：左侧是英文代号（`--font-label`，`--amber`），右侧是中文标题（`--font-display`，16px）。下面用 1px 虚线分隔。
- 四角加 6px 的 L 形刻度线（伪元素）。

### 5.2 警示条 `.hazard`

```css
background: repeating-linear-gradient(-45deg, var(--orange) 0 10px, #000 10px 20px);
```

用于溢出提示、专注限界的屏幕边框和危险操作按钮的底边。

### 5.3 底纹：叠加在整个界面上，`pointer-events: none`

- **扫描线**：`repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 1px, transparent 1px 3px)`
- **六边形网格**：内联 SVG data URI 平铺，描边 `--grid`，整体 opacity 0.35，边长约 18px

### 5.4 按钮 `.btn`

- 默认：透明底，1px `--amber` 描边，`--font-label` 大写。
- 悬停：底色 `--amber`，文字黑。
- 主操作 `.btn-primary`：橙底黑字。
- 危险操作：红色描边 + 警示条底边。

### 5.5 同步率 `syncGauge`

- 大号数字 64px，`--font-mono`，后面跟一个小号 `%`。上方标签 `SYNC RATIO / 同步率`。
- 数值变化时 600ms count-up。
- 颜色阈值：≥ 80 绿，60–79 琥珀，< 60 红。
- 下方 60px 高的折线显示 `syncHistory`，线色 `--green`，网格 `--grid`。

### 5.6 三审决议 `tribunal`

- 三个并排的格子，标题分别是 **时 TIME**、**空 SPACE**、**心 MIND**。
- 格内大字 `承认`（绿底黑字）或 `否决`（红底白字）。悬停显示 notes。
- 三格全部承认时，下方出现横幅 `全员承认 · 执行`；否则显示 `审议未通过`。
- 判定标准见 docs/05 §7。这是我们**自己的三项判定**，分别对应三个关键词。

### 5.7 警报流 `alerts`

- 每条一行：时间（mono）、等级色块、文字。新的排在最上，最多保留 6 条。
- error 级别时整行闪两下。

### 5.8 时空占用谱 `heatmap`（EP03）

- 行是分区，列是月份（9 月到次年 8 月），单元格 18×18px。
- 颜色：< 50% `--green`；50–75% `--amber`；≥ 75% `--red`；溢出的格子画警示条。
- 当前月份那一列用白色边框高亮；顶部月份标签用 mono 字体。

### 5.9 时间轴 `timeline`（底栏）

- 一条水平线加若干菱形节点（快照）。节点下面标学期，上面标同步率。
- 当前节点橙色，其余节点琥珀色描边。

### 5.10 专注限界 `focusTimer`

- 全屏半透明覆盖层：中间是巨号 mono 倒计时（约 18vw），四周屏幕边缘是 12px 宽的警示条。
- 上方标签 `FOCUS LIMIT / 专注限界`；下方是 `中止` 按钮，以及演示用的"×60 加速"开关。
- 最后 10 秒数字变红并闪烁。

### 5.11 开机序列 `boot`

等宽字逐行打印，每行 120–200ms，约 2.5s 打完，然后接「方寸」标题卡。文案示例（全部自拟）：

```
FANGCUN SYSTEM BOOT ........................ OK
LOAD DORM TEMPLATE  thu-4p-loft ............ OK
FIXED FURNITURE LOCK (RULE §17) ............ OK
EVACUATION PATH CHECK (RULE §12) ........... OK
ITEM LIBRARY  43 ENTRIES ................... OK
PLANNER CORE  HEIGHTMAP-2.5D ............... OK
SYNC RATIO ................................. STANDBY
```

## 6. 3D 视觉（A 车道）

| 元素 | 规格 |
|---|---|
| 背景 | `#050506`；Fog(near 900, far 3500) |
| 地面 | GridHelper：10cm 细线，颜色 `#120d06`；60cm 主线，颜色 `--grid`。60cm 正好对应常见地砖，也是"数地砖"校准时的视觉参照 |
| 墙 | 填充 opacity 0.04；琥珀描边 opacity 0.35 |
| 门窗 | 只画青色描边 |
| 固定家具 | 填充 `#101014`，opacity 0.9；琥珀描边 0.8。**衣柜和书架是容器型，填充降到 0.06** |
| 物品 | 类别色填充 0.25；状态色描边（§2.2）；被选中时描边变白，并显示 CSS2D 标签 |
| 分区（显示时） | 按 zone 状态色画线框；keepClear 分区画红色斜线 |
| 专注力场 | 红橙半透明盒（opacity 0.12）；顶面用 canvas 程序生成六边形纹理；描边 1Hz 呼吸。clear 后整体变绿，显示 `FIELD CLEAR` |
| 容差幽灵盒 | 绿色虚线框，表示最大允许尺寸 |
| 移动轨迹 | 紫色虚线，抬高 30cm 的二次贝塞尔曲线，动画结束后保留 2s |
| 滞留区 | 门外 z ∈ [−170, −20] 的警示条地面，上方悬浮标签 `OVERFLOW BAY / 滞留区` |
| 发光（加分） | UnrealBloomPass(strength 0.6, radius 0.4, threshold 0.2) |
| 视角 | orbit：斜 45°；top：正交俯视蓝图；seat：眼高 115cm，桌前沿外 45cm，FOV 70 |

## 7. 动效

| 场景 | 方式 |
|---|---|
| 切换"话" | 标题卡硬切（1.4s） |
| 面板出现 | 无过渡，直接出现；头部条从左到右"扫描"一次（200ms） |
| 数字变化 | count-up（600ms，等宽，避免抖动） |
| 警报、闪烁 | `animation: blink 1s steps(2) infinite` |
| 3D 物体移动 | easeInOutCubic，600–900ms |
| 视角切换 | easeInOutCubic，700ms |

## 8. 文案与术语（全部自拟）

| 中文 | 英文代号 | 用在哪里 |
|---|---|---|
| 方寸 · 宿舍时空作战系统 | FANGCUN // DORM SPACE-TIME OPS | 顶栏、开机序列 |
| 同步率 | SYNC RATIO | 右栏 |
| 三审决议：时 / 空 / 心 | TRIBUNAL: TIME / SPACE / MIND | 右栏 |
| 承认 / 否决 | APPROVED / DENIED | 三审格内 |
| 专注力场：展开 / 净空 | FOCUS FIELD: DEPLOY / CLEAR | EP02 |
| 作战指令 | ORDERS | EP02 步骤列表 |
| 专注限界 | FOCUS LIMIT | 番茄钟 |
| 滞留区 | OVERFLOW BAY | 3D 场景 |
| 深层收纳 | DEEP STORAGE | EP03 |
| 时分复用 | TIME-DIVISION MULTIPLEXING | EP03 开关 |
| 时空占用谱 | SPACE-TIME SPECTRUM | EP03 热力图 |
| 警告 / 紧急 | WARNING / EMERGENCY | 警报 |

## 9. 版权与授权边界

| ✅ 可以用（通用设计语言 / 自制） | ❌ 不可以用 |
|---|---|
| 黑底 + 橙红绿警示色 | 原作组织标志、徽章及其变体 |
| 粗宋体、纵向拉伸、L 形排版的标题卡（文字自拟） | 机体、角色、敌方生物的形象或剪影 |
| 六边形网格、警示条、扫描线、等宽遥测数字 | 原作截图、原画、海报、片头片尾 |
| "同步率""作战"等通用词 | 原作的组织名、系统名、专有名词，原作台词 |
| 自拟的"三审决议（时/空/心）" | 原作 BGM 和音效 |
| OFL 开源字体 | 原作所用的商用字体文件，或"仿原作"字体 |

> 原作参考图**只在队内聊天里看**，不放进仓库、作品包或演示画面。
> README 里写一句："界面风格致敬 90 年代日本动画的作战界面美学，所有图形、文字、字体均为原创或开源。"
