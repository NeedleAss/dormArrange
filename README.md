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

```bash
npm install            # 国内网络先执行：npm config set registry https://registry.npmmirror.com
npm run dev            # 打开 http://localhost:5173
npm test               # 规划引擎单测
```

AI 导入是可选功能：把 `.env.example` 复制为 `.env.local` 并填写（**不要提交**）。不配置时会自动使用本地规则解析。

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
