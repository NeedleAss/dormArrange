# AGENTS.md — 方寸 FANGCUN · 宿舍时空作战系统（repo: dormArrange）

> 所有编码智能体（Codex、Claude Code）开工前必读。
> 阅读顺序：本文件 → `tasks/README.md` → 你所在车道的任务卡 `tasks/<车道>.md` → 任务卡里引用的 `docs/` 章节。
> 冲突时的优先级：接口以 `docs/04-data-contract.md` 为准，协作规则以本文件为准。

## 1. 一句话

在浏览器里运行的宿舍空间规划工具：**不换宿舍、不动固定家具，用最少的调整，找回能学习、收纳和生活的空间。**
界面是 EVA 风格的致敬设计，3D 部分用 three.js 渲染线框宿舍。

## 2. 产品结构：五个"话"

| 编号 | 名称 | 解决什么 | 对应关键词 |
|---|---|---|---|
| EP00 | 建模 | 选宿舍模板、校准尺寸，查看每块空间的状态（空白/设计中/已完成） | 空间 |
| EP01 | 入住 | 新生：带来的东西哪些能放下、哪些要换位置、哪些尺寸还不能确定 | 空间 |
| EP02 | 腾桌 | 老生：不全部重来，最少几步腾出能摊开书和电脑的桌面 | 专注 |
| EP03 | 换季 | 用时间换空间：时分复用收纳 | 时间空间 |
| EP04 | 成长 | 布局快照时间轴、同步率曲线、累计专注时长 | 成长 |

**MVP = EP00 + EP01 + EP02 全部走通。** EP03、EP04 是加分项，进度落后就砍（见 `docs/00-overview.md` §3）。

## 3. 硬规则（违反任何一条前，先停下来问人类）

1. **只改你车道拥有的路径**（见 §5）。需要别人改接口时，在 `tasks/CHANGES.md` 追加一条并提醒人类队友，不要动别人的文件。
2. **接口以 `docs/04-data-contract.md` 为准。** 字段名、函数签名、坐标系都不能自行发明；要改，先改文档再通知所有车道。
3. **单位一律厘米（cm），世界坐标 Y 轴向上。** 原点是"站在门口往里看"时房间左前角的地面；x 向右，z 向里（门所在墙 z=0，窗和阳台在 z 大的一侧）。
4. **绝不提交密钥。** API key 只放在 `.env.local`（已被 gitignore），只能由 vite 开发服务器的代理读取。前端代码、日志、截图里都不能出现 key。
5. **不使用《新世纪福音战士》原作素材**：标志、机体、角色、截图、音效、原作字体文件、台词原文一律不用。只做风格致敬，字体和配色按 `docs/06-eva-style.md` 选用开源方案。作品会以 MIT 协议开源，组委会要核查授权。
6. **不新增 npm 依赖。** 需要的依赖已写进 package.json：three、vite、@fontsource 字体。确有需要先问人类；package.json 只由 C 车道修改。
7. **只用纯 JavaScript（ES Modules）+ JSDoc 类型注释。** 不用 TypeScript、React、Vue 或 CSS 框架。
8. **规划引擎（`src/planner/**`、`src/data/**`）必须是纯函数**：不碰 DOM、不 import three、不读写全局可变状态。相同输入必须得到相同输出，禁用 `Math.random`。
9. 不重排、不格式化你没改动的代码，不删除别人的文件。
10. 注释用中文写。算法部分要写清意图和复杂度。

## 4. 命令

- 需要 Node ≥ 18（用 `node -v` 查看）。国内装依赖慢时先执行 `npm config set registry https://registry.npmmirror.com`
- `npm install`：安装依赖
- `npm run dev`：启动开发服务器，打开 http://localhost:5173
- `npm test`：运行规划引擎单测（node:test，自动发现 `tests/*.test.js`）
- `npm run build`：构建生产版本

## 5. 车道与文件所有权

| 车道 | 默认智能体 | 职责 | 只能改这些路径 | 任务卡 |
|---|---|---|---|---|
| **A 3D 场景** | Codex | three.js 渲染：宿舍建模、物品、状态色、三种视角、补间动画、专注力场等特效 | `src/scene/**` | `tasks/A-scene.md` |
| **B 规划引擎** | Claude Code | 数据类型、宿舍模板生成器、物品库、违章电器规则、放置算法、入住五分类与尺寸容差、最少步腾桌、时分复用、同步率、文本解析、演示预设、单测 | `src/core/types.js` `src/data/**` `src/planner/**` `tests/**` | `tasks/B-planner.md` |
| **C 界面外壳** | Codex | 入口与布局、状态仓库、EVA 视觉、开机动画、标题卡、各话面板、时间轴；负责把 A/B/D 接起来 | `index.html` `src/main.js` `src/core/store.js` `src/ui/**` `src/styles/**` `public/**` `package.json` | `tasks/C-ui.md` |
| **D AI 与集成** | Codex | vite 代理、AI 客户端、自然语言/照片导入（带离线兜底）、集成测试、README 运行说明 | `vite.config.js` `src/ai/**` `.env.example` `README.md` | `tasks/D-ai-integration.md` |
| 文档 | 人类 + 总架构 | 方案、契约、任务卡、提交材料 | `docs/**` `tasks/**` `AGENTS.md` `CLAUDE.md` `submission/**` | — |

例外：任何车道都可以在 `tasks/BUGS.md` 和 `tasks/CHANGES.md` **末尾追加**内容，也可以勾选**自己**任务卡上的复选框。

## 6. 模块依赖方向（禁止反向 import）

```
main.js ─▶ ui/* ─▶ core/store.js
ui/*    ─▶ planner/index.js   （同步纯函数）
ui/*    ─▶ ai/index.js        （异步；失败时自动回退到 planner.parseItemsText）
ui/*    ─▶ scene/index.js     （命令式 API）
planner/* ─▶ data/*、core/types.js
scene/*   ─▶ three            （只认 Room / Item / Placement 等数据，不 import planner 和 ui）
```

各模块的公开 API 见 `docs/03-architecture.md` §4。**跨模块只能引用对方的 `index.js`**，不要直接引用别人的内部文件。

## 7. 工作流

1. 先 `git pull --rebase`，再读任务卡，从第一个没勾选的任务开始做。
2. **先导出接口、后写实现**：接口可以先返回 mock，保证别人随时 import 都不报错。
3. 做完一个任务：
   1. 自测：跑 `npm test`；用 `npm run dev` 打开页面，确认控制台无报错。
   2. 把任务卡里的 `[ ]` 改成 `[x]`。
   3. 依次执行：
      ```
      git add <你的路径>
      git commit -m "[A|B|C|D] <任务号> <一句话说明>"
      git pull --rebase
      git push
      ```
4. 需求不清或契约冲突时，停下来在终端里问人类，不要猜着做。
5. 提交信息和注释要写清"做了什么、为什么"。组委会会看 Git 历史，用来证明是现场开发。

## 8. 检查点（北京时间 2026-10-18）

| 时间 | 检查点 | 要求 |
|---|---|---|
| 14:50 | CP0 骨架 | 页面能打开：EVA 外壳 + 线框宿舍 + stub 数据，控制台无报错 |
| 15:20 | CP1 入住 | EP00 + EP01 端到端走通 |
| 15:55 | CP2 腾桌 | EP02 端到端走通。**核心冻结，此后只修 bug、做加分项** |
| 16:20 | CP3 加分 | EP03 / EP04 / 待机演示，落后就砍 |
| 16:35 | 保底上传 | 先传一版到清华云盘 |
| 16:55 | 最终上传 | 17:00 截止 |

## 9. 完成的定义

- `npm run dev` 运行时控制台无报错；`npm test` 全部通过；`npm run build` 构建成功。
- `docs/01-story-pitch.md` §5 的演示脚本能从头走到尾。
- 仓库里搜不到密钥：执行 `git grep -nE "sk-[A-Za-z0-9]{8,}|AI_API_KEY=.+"` 应无结果。
