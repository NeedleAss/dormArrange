@AGENTS.md

# Claude Code 补充说明

- 你默认负责 **B 车道（规划引擎）** 和 **D 车道（AI 与集成）**。人类会告诉你本次会话属于哪条车道；没说的话，先问。
- 同一位队友可能同时开两个 Claude Code 窗口，一个做 B、一个做 D。两个窗口按 AGENTS.md §5 的文件所有权分开，不要互相改对方的文件。
- B 车道开工顺序：先做 B0，10 分钟内推送 types、buildRoom、物品库、规则和 planner stub。A、C 两条车道在等这些接口。
- 算法规格在 `docs/05-algorithms.md`，数据结构在 `docs/04-data-contract.md`，模板与物品数值在 `docs/07-dorm-template-items.md`。
- 每个算法都要配 node:test 单测（`tests/*.test.js`），断言不重叠、不越界、不进入 keepClear 分区、结果确定。
- 写完一段就跑 `npm test`。除非确认是测试本身写错，否则不要为了让测试通过而改期望值；确实改了的，要在提交信息里说明原因。
- 不要运行 `npm install <新包>`，也不要修改 package.json（它属于 C 车道）。
