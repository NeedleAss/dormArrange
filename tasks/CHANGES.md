# 契约变更申请（只能在末尾追加）

需要别的车道改接口或数据时，在这里追加一条，然后**口头告诉对应车道的人**。
契约文档 `docs/04-data-contract.md` 由人类修改。

格式：`- [时间] [发起车道 → 目标车道] 想要的变更；原因；状态（待处理 / 已同意 / 已完成）`

---

- [14:30] [总架构 → 全体] 初始化契约 v1；状态：已完成
- [14:50] [总架构 → B] 新增加分函数 `scatterOnDesk(room, items, { owner })`（docs/03 §4.1、docs/05 §5.8），只是新增、不影响已有接口；状态：待处理（B6，可选）
- [15:00] [B → A/C/D] 补充说明（不改契约，只是新增可选内容）：① `LIBRARY` 是有序数组，每条含 `libId`；按 id 查用 `LIBRARY.find(e => e.libId === id)`。② `MoveStep` 可能额外带可选字段 `placement`（目标 Placement 全量，含 rot/lying/layer），`applySteps` 优先用它；scene 不需要理会。状态：已完成
- [15:05] [总架构 → B] 物品库别名扩展与 5 个新条目建议，见 assets/reference-notes.md §3；属于数据补充，不改接口；状态：待处理（B 车道自行决定，建议在 B2 前顺手做）
- [15:15] [B → C] 算法口径说明（不改契约字段）：EP01 中 ① 分区在物品 `preferred` 里时不计层级代价、也不提示"层级不符"；② `estimated` 只有在"不是物品库默认规格"（AI/用户估计）时才判 uncertain，`unknown` 和功率未知照旧判 uncertain；③ `overflowIds` 包含所有进滞留区的物品：先放不下的（按放置顺序），再是 banned、可丢弃的。新生预设结果：fits 20 / relocate 7 / uncertain 2 / banned 1。状态：已完成
- [15:20] [B → 全体] 已采纳 assets/reference-notes.md §3：8 组别名 + 6 个新库条目（床边收纳筐、桌面简易书架、泡面盒、浴巾、晾衣架（袜夹）、床帘）；`PRESETS.freshman` 换成 assets/item-lists/freshman.txt 演示精简版（34 件：fits 22 / relocate 9 / uncertain 2 / banned 1）。状态：已完成
- [15:35] [B → C] EP02 口径说明（不改契约字段）：冲突物品优先在本人书桌周边（桌面/书架/桌下/桌下靠墙）找位；放不下先做一层级联（赶走一件最不常用的去深层收纳）；级联也失败才放公共区，仍不行进 unresolved（这些物品留在原位）。同一分区内挪位的文案是"把「X」挪到书桌桌面的空位"。`PRESETS.messyDesk` 已就绪：6 件冲突、1 次级联、7 步、同步率 75 → 100。状态：已完成
- [15:17] [B → C] EP03/EP04 说明（不改契约字段）：① `byMonth[m].active / stored` 只列季节物品（锚点全年不动，不列）；`zoneFill` 与 `matrix` 含 `${itemId}.inside` 箱内分区，箱内分区的 label 是"${箱名}里"。② diffMonths 文案统一以"第 k 步："开头；步骤也带可选 `placement`。③ `PRESETS.growth` 由 planner 计算（data 不能反向依赖 planner），请从 planner/index.js 取；4 个快照的 sync 是 computeSync 的真实值：100 → 86 → 75 → 100（docs/07 建议的 72→64→48→86 只是示意，走势一致）。④ 新生清单的 compare 结果 on/off maxFill 都是 0.516（峰值来自全年在用的物品），差异要看矩阵里季节物品所在的行。⑤ `scatterOnDesk` 已可用，opts 额外支持 `existing`（桌上已有物品作障碍）。状态：已完成

- [15:28] [D → C] D2 已实现：从 `src/ai/index.js` 调用 `aiAvailable` 与 `aiParseItems`，返回 `{ items, source, warnings }`，失败自动使用本地规则。`warnings` 含固定安全诊断码（如 BAD_JSON），请观众界面在 source 为 rules 时只显示「AI 离线，已使用本地解析」，不要直接逐条展示诊断码；独立开发页可展示完整 warnings。不改契约；状态：待处理（C 面板已接入 API，待过滤诊断码）。
- [15:19] [B → C] B6：`predictGrowth` 已可用（新生清单 → "按每学期 +5 本书的速度，大三上书架会满…"）。`allowUpgrades` 暂不实现，`alternatives` 保持 undefined：默认模板 + 居中 27 寸显示器下三种加购都不可行或不减步（增高架 46+9 > 桌面净高 53；双层置物架 40cm 后角与 61cm 显示器重叠；侧挂钩挂耳机仍是一步）。状态：已完成（allowUpgrades 不做）
- [15:12] [C → B/总架构] C3 真实验收发现 PRESETS.messyDesk 默认 75×35 力场生成 7 步（6 冲突 + 1 级联，sync 75→100），与 docs/02 §3 验收“步骤 ≤6”不符。请 B 调整预设至 ≤6 步，或由人类确认接受 7 步；UI 保留真实步骤，不伪造计数。状态：待处理
- [15:13] [总架构确认 → C/B] 人类已确认接受当前乱桌示例 7 步（6 冲突 + 1 级联），C3 按真实 7 步演示验收，无需 B 修改预设。状态：已同意
- [15:28] [C → B] EP04 恢复 PRESETS.growth[3] 时发现 items 仍含已 dispose 的 md-002 快递盒，placements 已无此项，而 Snapshot 契约不含 movePlan/丢弃状态，因此恢复后会在场景滞留区复活且物品数仍为30。请 B 在该预设快照中剔除已丢弃物品，保证 items 表示快照在场集合；不改字段或接口。状态：待处理
- [15:28] [C → D] 已接入 AI 公开入口，观众界面的 rules 回退仅显示“AI 离线，已使用本地解析”，不逐条展示 warnings 诊断码。代理隔离测试需释放5173后运行；本机停止dev后 npm test 105项全通过。状态：已完成

- [15:34] [D → C] C4 已完成 D2 的观众警报过滤，离线端到端复验只显示「AI 离线，已使用本地解析」，没有技术诊断码；此前 D2 接线说明现为已完成。真实 AI 路径 available=true/source=ai/8 件、powerW=1500、收纳箱 unknown 已在独立开发页验收。不改契约；状态：已完成。
- [15:50] [人类授权 → C] 根据新增 EVA Style 参考图强化视觉：保留语义状态色，增加高饱和紫/亮绿/青橙对比、巨字错位构图、真实数据弧线和参数蓝图占位、帧式开机与标题动效，折叠分区以突出主任务。参考原图不入库，图形全部程序生成；不改 A/B/D 目录或数据契约。状态：已完成

- [16:06] [人类授权 / C → Claude Code 美术] src/styles/** 已由人类移交 Claude Code，C 此后不修改 CSS。两张新参考图的重点是模块厚度、同一透视下的斜面、前后叠压和接触阴影；请调整整体空间关系，避免仅加切角或卡片描边。C 已提供 workspace.spatial-console 及三大区 depth-module-control / depth-module-scene / depth-module-monitor 结构钩子。状态：待美术接入。
- [16:06] [人类授权 / C → Claude Code 美术] 字体需按功能和层级灵活搭配明朝体、思源宋体：大标题、话数、关键审议状态使用明朝体的高对比字形；表单、操作标签及密集说明用思源宋体保证可读性，结合位置与字距排版，不把所有标签机械统一为一种字体。使用项目已有或系统兼容字体，不新增依赖。状态：待美术接入。
- [16:06] [C → Claude Code 美术] C 已删除被点名的模板说明、重复提示、营销段落和启动模板警报；三审已用程序 SVG 提供一上两下、中央连接、薄荷青框线、橙色辅助信息、红色否决的构图，并保留真实时/空/心评估。请样式布局围绕新 DOM/SVG 配合，无需沿用旧 monitor-votes 的三张矩形卡片。状态：C 结构已完成，待美术接入整体透视与字体。

- [16:11] [人类追补 / C → Claude Code 美术] 三审构图已获人类认可，请保留一上两下结构；右栏要求取消整栏纵向滚动，同步率与三审同屏放在一起。C 新增 monitor-overview（同步率与三审整体）及 monitor-inspectors（分区/警报），每话内容提供 module-surface。请根据可用高度压缩同步率装饰与历史区，给 SVG 保留完整比例；分区/警报用紧凑展开方式，不能只 overflow:hidden 后裁掉下半块三审。1280×720 和常见桌面高度需完整可见。状态：DOM 已完成，待 CSS。
- [16:11] [人类追补 / C → Claude Code 美术] 左右主栏目及其内部模块仍需重做立体材质和空间关系：参考 e4a430eb794b71f9f5afc4a5338125d6.jpg 的倾斜控制台面、厚侧边、前后遮挡、接触阴影和连续转折，减少通栏细线与同尺寸矩形框；三大区 depth-module-* 和内部 module-surface 可做不同深度的面。不要仅继续增加切角、描边或颜色。状态：待 CSS。
