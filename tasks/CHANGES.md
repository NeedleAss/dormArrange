# 契约变更申请（只能在末尾追加）

需要别的车道改接口或数据时，在这里追加一条，然后**口头告诉对应车道的人**。
契约文档 `docs/04-data-contract.md` 由人类修改。

格式：`- [时间] [发起车道 → 目标车道] 想要的变更；原因；状态（待处理 / 已同意 / 已完成）`

---

- [14:30] [总架构 → 全体] 初始化契约 v1；状态：已完成
- [14:50] [总架构 → B] 新增加分函数 `scatterOnDesk(room, items, { owner })`（docs/03 §4.1、docs/05 §5.8），只是新增、不影响已有接口；状态：待处理（B6，可选）
- [15:00] [B → A/C/D] 补充说明（不改契约，只是新增可选内容）：① `LIBRARY` 是有序数组，每条含 `libId`；按 id 查用 `LIBRARY.find(e => e.libId === id)`。② `MoveStep` 可能额外带可选字段 `placement`（目标 Placement 全量，含 rot/lying/layer），`applySteps` 优先用它；scene 不需要理会。状态：已完成
- [15:05] [总架构 → B] 物品库别名扩展与 5 个新条目建议，见 assets/reference-notes.md §3；属于数据补充，不改接口；状态：待处理（B 车道自行决定，建议在 B2 前顺手做）
