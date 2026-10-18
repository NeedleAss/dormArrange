# 方寸 FANGCUN · 宿舍时空作战系统

> EE 黑客松 2026 · 校园学习生活赛道 · 现场关键词：**时间空间 / 专注 / 成长**

**不换宿舍、不动固定家具，用最少的调整，在方寸之间找回能学习、收纳和生活的空间。**

- **新生**：我准备带来的这些东西，哪些能放下，哪些需要换位置，哪些尺寸还不能确定？
- **老生**：东西已经摆满了，我不想全部重来，只想腾出一块能摊开书和电脑的桌面。

| 话 | 名称 | 做什么 |
|---|---|---|
| 第零话 | 建模 | 参数化生成宿舍 3D 模型；可以"数地砖"校准尺寸；分区状态一览 |
| 第一话 | 入住 | 输入清单（文字 / AI）→ 自动规划 → 五色判定 + 尺寸容差（下单前该查哪个数） |
| 第二话 | 腾桌 | 展开专注力场 → 最少步数的作战指令 → 3D 动画执行 → 专注限界番茄钟 |
| 第三话 | 换季 | 时分复用收纳：空间不够，用时间来换 |
| 第四话 | 成长 | 布局快照时间轴、同步率曲线、累计专注时长 |

## 快速开始

环境：**Node.js ≥ 18**、npm，以及支持 WebGL 的现代浏览器。项目使用原生 JavaScript（ES Modules）、Vite 和 three.js；字体由 `@fontsource` 随依赖本地打包，安装完成后不依赖外部字体 CDN。

```bash
npm install            # 国内网络先执行：npm config set registry https://registry.npmmirror.com
npm run dev            # 打开 http://localhost:5173
npm test               # 规划引擎、AI 客户端与安全代理测试
npm run build          # 构建到 dist/
npm run preview        # 本地预览 dist/，默认 http://localhost:4173
```

端口占用时以终端显示的地址为准。AI 导入是可选功能；没有配置、请求失败或结果不合法时，文字导入自动使用本地规则，规划与 3D 不依赖模型。**AI 代理只在 `npm run dev` 中提供**；生产静态文件和 `npm run preview` 使用规则解析，需要现场演示 AI 时请运行开发服务器。

## 可选 AI 配置

由使用者手工把 `.env.example` 复制为项目根目录的 `.env.local`，再在本地编辑器里填写。`.env.local` 已被 `.gitignore` 忽略；不要提交该文件，也不要把凭据粘贴到终端、聊天或截图中。

| 变量 | 填写内容 |
|---|---|
| `AI_BASE_URL` | 服务商 API 根地址，**包含所需版本路径**，例如 `https://example.com/v1`；不要填写 `/chat/completions` 或 `/responses` 端点 |
| `AI_API_KEY` | 使用者在 `.env.local` 中手工填写的凭据；下面的样例故意留空 |
| `AI_MODEL` | 服务商实际支持的模型名称 |
| `AI_WIRE_API` | `chat` 对应 Chat Completions；`responses` 对应 Responses；默认 `chat` |
| `AI_VISION` | 模型支持图片时可设为 `true`，否则保持 `false`；它只声明模型能力，照片导入还需对应功能已启用 |

```dotenv
AI_BASE_URL=https://example.com/v1
AI_API_KEY=
AI_MODEL=your-model-name
AI_WIRE_API=chat
AI_VISION=false
```

在 macOS 上，可逐行运行 `cp -n .env.example .env.local` 和 `open -e .env.local`，在本地文本编辑器中填写并保存。并行智算云的基础地址为 `https://llmapi.paratera.com/v1`，协议填 `chat`，模型名按平台显示填写（本项目已实测 `GLM-5.3-FlashX`）；先保持 `AI_VISION=false` 验证文字导入。地址可核对[平台官方文档](https://ai.paratera.com/document/llm/api/assistance/Chatbox)。

修改后停止并重新运行 `npm run dev`，再刷新浏览器，以更新服务端配置与客户端缓存。凭据仅由 Vite 代理读取，并在转发时添加请求头；浏览器只访问同源 `/ai/`，`/ai/__config` 仅返回 `enabled`、`model`、`wire`、`vision` 四个字段。不要使用 `VITE_` 前缀存放凭据。

### 文字导入验收

打开独立[AI 导入自测页](http://localhost:5173/src/ai/__dev__.html)，输入以下内容后点「解析」：

> 24寸行李箱，两床被子，27寸显示器，书20本，1500W电热水壶，一个尺寸不确定的收纳箱

- **尚未配置 AI**：`available` 为 `false`，`source` 为 `rules`，页面显示离线回退提示且控制台无错误。
- **手工配置并重启后**：`available` 为 `true`；请求成功且输出合法时，`source` 为 `ai`。若仍为 `rules`，查看页面的安全错误码并核对地址、模型与协议；超时或无效结果都会自动回退。
- 两种路径都应得到 **8 件物品**：行李箱 1 件、被子 2 件、显示器 1 件、书 2 摞、水壶 1 件、收纳箱 1 件。书每 10 本合成一摞；水壶的 `powerW` 为 `1500`，收纳箱的 `sizeSource` 为 `unknown` 或 `estimated`，尺寸单位均为 cm。

完整页面的「第一话 · 入住」会调用同一个 `aiParseItems`：可直接使用该文本，点「解析清单」→「开始规划」，核对来源提示、物品清单和五类判定。

## 现场 60 秒演示

提前启动 `npm run dev`，刷新首页，确认字体、3D 和浏览器控制台正常；全屏、缩放 100%，演示机接电。AI 离线也可完成核心演示，建议另备一份录屏。

| 时间 | 操作与讲解 |
|---|---|
| 0–8 秒 | 展示「方寸」标题与线框宿舍；第零话选自己的座位，说明可以数地砖校准尺寸。讲述「家具不能动，能动的是物品和时间」。 |
| 8–25 秒 | 第一话点「载入新生示例」→「开始规划」；展示五类判定，点开「尺寸待定」的收纳箱，解释购物前应核对哪个尺寸，再点开禁止携带的电器。 |
| 25–45 秒 | 第二话载入乱桌示例，展开专注力场，查看作战指令并执行；观察物品移动、桌面净空和同步率变化，启动专注计时。**步数、容差厘米数和同步率均以界面实际计算为准。** |
| 45–55 秒 | 已启用第三话时，切换月份和时分复用，对比占用；否则留在第二话，展示整理前后和专注计时。 |
| 55–60 秒 | 已启用第四话时回放成长记录，或切到座位视角看桌面；以「方寸之间，自有天地」收尾。 |

核心流程为 EP00 建模、EP01 入住、EP02 腾桌；EP03 换季、EP04 成长和待机演示属于加分项。完整脚本和现场备份安排见 [`docs/01-story-pitch.md` §5](docs/01-story-pitch.md)。

## 目录与隐私

```text
src/main.js        入口，接合界面、规划器、场景与 AI
src/core/          数据类型和浏览器状态
src/data/          宿舍模板、物品库、规则与演示预设
src/planner/       确定性的放置、腾桌、换季和规则文字解析
src/scene/         three.js 宿舍、物品、视角和动画
src/ui/            五话面板与交互
src/styles/        视觉样式
src/ai/            AI 客户端、提示词、校验合并、回退与独立自测页
tests/             规划引擎测试
vite.config.js     开发服务器 AI 代理与安全配置端点
docs/、tasks/      规格、接口契约、任务与集成问题记录
```

放置、腾桌等规划计算在浏览器内完成。启用 AI 文字导入时，输入清单会发送给所配置的模型；照片能力启用后，也只在主动调用照片解析时发送图片给 AI，本项目不把照片写入磁盘。请先去除照片中的人脸、姓名、门牌等个人信息。打包前按 [`docs/10-submission-compliance.md` §4](docs/10-submission-compliance.md)检查密钥与隐私，确认导出包不含 `.env.local`。

## 给开发者和智能体

- 协作规则：[`AGENTS.md`](AGENTS.md)（Codex）和 [`CLAUDE.md`](CLAUDE.md)（Claude Code）
- 任务看板：[`tasks/README.md`](tasks/README.md)
- 文档：

| 文档 | 内容 |
|---|---|
| [`docs/03-architecture.md`](docs/03-architecture.md) | 系统架构、模块 API、状态、时序 |
| [`docs/04-data-contract.md`](docs/04-data-contract.md) | 数据契约（唯一接口约定） |
| [`docs/05-algorithms.md`](docs/05-algorithms.md) | 放置引擎、入住五分类与容差、最少步腾桌、时分复用、同步率、文本解析 |
| [`docs/06-eva-style.md`](docs/06-eva-style.md) | 视觉规范与版权边界 |
| [`docs/07-dorm-template-items.md`](docs/07-dorm-template-items.md) | 宿舍模板参数、物品库、宿舍规定 |
| `docs/00`、`01`、`02`、`08`、`09`、`10` | 总览与时间线、故事与路演、功能流程、AI 接入、资料清单、提交与合规 |

## 第三方清单

| 名称 | 用途 | 许可 |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) 0.186.1 | 3D 渲染 | MIT |
| [Vite](https://github.com/vitejs/vite) 6.4.4 | 开发服务器与构建 | MIT |
| [@fontsource/noto-serif-sc](https://fontsource.org/fonts/noto-serif-sc) | 标题字体（思源宋体） | OFL-1.1 |
| [@fontsource/barlow-condensed](https://fontsource.org/fonts/barlow-condensed) | 英文标签字体 | OFL-1.1 |
| [@fontsource/share-tech-mono](https://fontsource.org/fonts/share-tech-mono) | 等宽数字字体 | OFL-1.1 |
| [清华大学学生社区管理服务中心《住宿注意事项》](https://www.tsinghua.edu.cn/xssqglfwzx/info/1043/1175.htm) | 违章电器规则的来源（转述） | 引用 |

界面风格致敬 90 年代日本动画中作战界面的美学；所有图形、文字和字体均为原创或开源，不含任何原作素材。

## 许可

本队原创部分采用 [MIT License](LICENSE)，第三方内容保留各自原许可。
