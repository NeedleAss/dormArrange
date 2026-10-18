# B 车道 · 规划引擎（Claude Code）

- **拥有**：`src/core/types.js`、`src/data/**`、`src/planner/**`、`tests/**`
- **规格文档**：
  - `docs/04-data-contract.md`：数据结构
  - `docs/05-algorithms.md`：算法
  - `docs/07-dorm-template-items.md`：模板参数、物品库、违章电器规则
- **原则**：
  - 纯函数、结果确定：不 import three，不碰 DOM，禁用 `Math.random`
  - 排序一律以 `id` 作为最后的 tie-break
  - 每个算法都有单测
- **公开 API**：只从 `src/planner/index.js` 导出，签名见 `docs/03-architecture.md` §4.1。
- **执行顺序（已调整）**：B0 → B1 → **B5 前半**（`parseItemsText` + `PRESETS.freshman`，C/D 车道在 CP1 前要用）→ B2 → B3（同时做 `PRESETS.messyDesk`）→ B4（同时做 `PRESETS.growth`）→ B6。

---

## B0 契约落地（目标 10 分钟内推送，A、C 车道在等）

- [ ] `src/core/types.js`：把 docs/04 的全部类型写成 JSDoc `@typedef`。文件里没有运行时代码，末尾 `export {}`。
- [ ] `src/data/roomTemplates.js`：
  - 导出 `DEFAULT_PARAMS`
  - 实现 `buildRoom(params = DEFAULT_PARAMS)`：严格按 docs/07 §1 的公式生成 walls、openings、fixtures、zones
- [ ] `src/data/itemLibrary.js`：
  - 导出 `LIBRARY`（docs/07 §2 全表）
  - 实现 `makeItem(libId, overrides)`，返回符合契约的 Item
- [ ] `src/data/rules.js`：导出 `RULES`（docs/07 §3，附来源 URL）。
- [ ] `src/planner/index.js`：导出 docs/03 §4.1 的**全部**函数和常量。还没实现的函数先返回与 docs/04 §6 形状一致的确定性 mock：
  - planMoveIn：所有物品都判为 fits，没有 placement
  - planFocusField：steps 为空数组
  - 其他函数同理

**验收**：
- 运行 `node -e "import('./src/planner/index.js').then(m=>console.log(Object.keys(m)))"`，能列出全部 API
- `buildRoom().zones` 至少包含：A.desk、A.hutch、A.underDesk、A.underDeskBack、A.wardrobeHang、A.wardrobeBottom、A.bed、A.bedFoot、pub.entryL、pub.aisle、pub.doorSwing、pub.balcony

## B1 几何与放置引擎（25 分钟）

- [ ] `src/planner/geometry.js`：实现 docs/05 §1，包括盒子相交/包含/重叠面积、分区局部坐标 `toLocal` / `toWorld`、`localExtents`。
- [ ] `src/planner/heightmap.js`：实现 docs/05 §2 的 2.5D 高度图。
  - 方法：`findSpot`、`commit`、`removeItem`（重建）、`clone`、`blockRect`、`maxEmptyRect`
  - 三种评分模式：store / near / reach
  - 支撑规则：底面支撑率 ≥ 0.6，支撑面必须可承重
  - 遇到 keepClear 分区时，把对应格子封锁
- [ ] `src/planner/hang.js`：挂杆一维装箱（docs/05 §2.6）。
- [ ] `src/planner/engines.js`：`buildEngines(room, placements, opts)`，为每个分区建一个引擎，并把已有 placement 填进去。
- [ ] `tests/engine.test.js`：用固定种子的伪随机（LCG）生成 50 个物品，放进 3 个分区，然后断言：
  - 两两不重叠
  - 都在分区范围内
  - 不进入 keepClear
  - 高度不超出分区
  - 同样输入运行两次，结果完全一致

## B2 第一话 入住：`planMoveIn`（25 分钟）

- [ ] 实现 docs/05 §3 的 `rankZones`。
- [ ] 实现 docs/05 §4 的放置主流程，包括压缩重试。
- [ ] 五分类：banned > overflow > uncertain > relocate > fits，按此优先级取一个。
- [ ] 尺寸容差 `tolerance`（§4.4）和放不下时的 `need`（§4.5，用最大空矩形算）。
- [ ] 中文原因和建议文案（§4.6）。
- [ ] `tests/moveIn.test.js`，用 `PRESETS.freshman`，断言：
  - 电热水壶判为 banned，原因里含"1000W"
  - 24 寸行李箱放进 `A.underDesk`，判为 fits
  - 28 寸行李箱判为 relocate（`pub.entryL`）或 overflow，不能判为 fits
  - "尺寸未知的收纳箱"判为 uncertain，且 tolerance 的三个值都 > 0
  - summary 各项相加等于物品总数
  - 所有 placement 两两不重叠

## B3 第二话 腾桌：`planFocusField`（25 分钟）

- [ ] 实现 docs/05 §5：
  - 力场矩形计算
  - 冲突检测（含叠在冲突物品上面的物品）
  - 逐件找落点（near 模式）
  - 一层级联
  - 可丢弃物品直接生成"扔掉"步骤
  - 步骤排序和中文指令
  - metrics
- [ ] 导出 `applySteps(placements, steps, upto)`，供 UI 拖动步骤条时使用。
- [ ] `tests/focus.test.js`，用 `PRESETS.messyDesk`，断言：
  - 应用 `placementsAfter` 后，力场内没有任何物品
  - 不在冲突列表里的物品位置不变（级联移动的除外）
  - 锁定分区里的物品不变
  - steps.length ≤ 冲突数 + 级联数
  - `syncAfter > syncBefore`

## B4 同步率 + 第三话 时分复用（20 分钟）

- [ ] `computeSync`：实现 docs/05 §7，包括三审决议 votes 和中文 notes。
- [ ] `planSeasons`：实现 docs/05 §6。
  - 12 个月逐月放置；inside 分区（行李箱内部）作为深层收纳
  - 每件物品优先放回上个月的位置，保证月与月之间稳定
  - 输出 matrix；`compare: true` 时同时算 tdm 关闭的结果做对比
- [ ] `diffMonths(monthPlanA, monthPlanB, items, room)`：输出换季步骤和文案。
- [ ] `tests/seasons.test.js`，断言：
  - 每个月都没有重叠
  - 当月不活跃的季节物品都在 tier 2 或 inside 分区
  - `compare.on.maxFill <= compare.off.maxFill`

## B5 文本解析 + 演示预设（15 分钟）

- [ ] `parseItemsText`：实现 docs/05 §8，支持中文数字、数量词、"寸"、"长×宽×高"、功率（W/瓦）；匹配不到物品库的物品，sizeSource 设为 `'unknown'`。
- [ ] `src/data/demoPresets.js` 导出 `PRESETS`（具体见 docs/07 §4）：
  - `freshman`：新生清单的文本
  - `messyDesk`：老生乱桌，包含 items 和 placements，用 `buildRoom()` 的 A.desk 等分区
  - `growth`：4 个快照
- [ ] 队友收集到真实清单后，替换掉示例数据，但要保持各测试的断言仍然成立。
- [ ] `tests/parse.test.js`：输入 `"24寸行李箱，两床被子，27寸显示器，书20本，1500W电热水壶"`，断言：
  - 解析出 7 个物品：1 箱 + 2 被 + 1 显示器 + 2 摞书 + 1 水壶
  - 水壶的 `powerW === 1500`

## B6 加分

- [ ] `allowUpgrades: true`：生成"增高架 / 桌面置物架 / 侧边挂钩"三种虚拟分区，输出 alternatives，例如"多花 ¥39，少挪 2 步"（docs/05 §5.7）。
- [ ] `predictGrowth(items, room, semesters)`：书架溢出预测（docs/05 §9）。
- [ ] `scatterOnDesk(room, items, { owner })`：乱桌生成器（docs/05 §5.8），用于观众互动"说出你桌上的东西 → 现场腾桌"。
