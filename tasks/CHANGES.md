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
