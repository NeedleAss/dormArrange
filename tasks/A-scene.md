# A 车道 · 3D 场景（Codex）

- **拥有**：`src/scene/**`（只改这里）
- **要实现的接口**：`docs/03-architecture.md` §4.2 Scene API（函数名和参数一个字都不要改）
- **输入数据**：`docs/04-data-contract.md` 中的 Room / Zone / Fixture / Item / Placement / MoveStep
- **视觉规范**：`docs/06-eva-style.md` §6（3D）和 §2（颜色）
- **不依赖 planner 的实现。** B0 推送前，先用 `docs/04-data-contract.md` §8 的示例 JSON 自测，放在 `src/scene/__mock__.js`。
- **独立测试台**：建 `src/scene/__dev__.html` 和 `__dev__.js`，放一排按钮逐个调用 Scene API，访问 http://localhost:5173/src/scene/__dev__.html 。这样不依赖 C 车道外壳也能自测（见 docs/03 §4.2）。
- three 已安装。附加模块从 `three/examples/jsm/...` 引入：OrbitControls、CSS2DRenderer、EffectComposer、UnrealBloomPass。

---

## A0 场景启动（10 分钟）

- [ ] `src/scene/index.js` 导出 `createScene(container, { onSelect, onHover })`，返回 §4.2 列出的**全部方法**。先空实现，保证 C 车道调用不报错。
- [ ] 渲染基础：
  - WebGLRenderer：开启 antialias，`setPixelRatio(Math.min(devicePixelRatio, 2))`
  - PerspectiveCamera：fov 50、near 1、far 6000（单位 cm）
  - OrbitControls：开启 damping，限制不能钻到地面以下
- [ ] 用 ResizeObserver 监听容器尺寸变化，自动调整画布。
- [ ] 背景色 `#050506`，加 Fog（near 900、far 3500）。
- [ ] 地面网格：10cm 细线（极暗）+ 60cm 主线（暗琥珀，对应 60cm 地砖）。
- [ ] 全局只有一条 requestAnimationFrame 链；`dispose()` 要释放几何体、材质和事件监听。

**验收**：C 车道 import 后，页面中间出现网格地面，能旋转和缩放，控制台无报错。

## A1 宿舍建模渲染：`setRoom(room)`（20 分钟）

- [ ] 墙：`room.walls[].box` 画成极淡的填充（opacity 0.04），加琥珀色描边（EdgesGeometry + LineBasicMaterial，opacity 0.35）。
- [ ] 门窗：`room.openings[]` 画成青色描边框。
- [ ] 固定家具：`room.fixtures[]` 画成深色填充（`#101014`，opacity 0.9），加琥珀描边（opacity 0.8）。床、桌、书架、衣柜都只是 box。
  - ⚠️ `wardrobe` 和 `hutch` 是**容器型**：它们的 box 包住了里面的分区。必须只画描边，填充 opacity 降到 0.06，否则会挡住里面的物品。
- [ ] 分区：`room.zones[]` 默认隐藏，A4 实现 `setZoneStatus` 后再按状态显示。keepClear 分区在"显示分区"模式下画成红色斜线虚框。
- [ ] 悬停 fixture 或 zone 时，用 CSS2DRenderer 显示标签：中文名 + 尺寸（mono 字体）。
- [ ] 重复调用 `setRoom` 时先清掉旧对象，不能有内存泄漏。
- [ ] 相机初始位置自动对准 `room.bounds` 的中心。

**验收**：用 B 车道的 `buildRoom()`（或示例 JSON）渲染后，能看出四套上床下桌、中间过道、门和阳台。

## A2 物品渲染：`setItems(items, placements, opts)`（25 分钟）

- [ ] 有 placement 的物品画成一个 box（尺寸取 `placement.box`）。填充色按 docs/06 §2.3 的类别色（opacity 0.25），描边按状态色。
- [ ] 没有 placement 的物品排进**滞留区**：门外 z ∈ [-170, -20] 的地面，铺警示条纹理；按 `opts.overflowIds` 的顺序沿 x 方向依次排开。
- [ ] 按 itemId 做 diff：
  - 新增的物品淡入
  - 删除的物品淡出
  - 位置变化的物品用 600ms easeInOutCubic 补间（`opts.animate !== false` 时）
- [ ] `setItemStates(map)` 按状态改描边颜色：
  - fits：绿
  - relocate：琥珀
  - uncertain：青色虚线（LineDashedMaterial）
  - overflow：红
  - banned：红色并以 1Hz 闪烁
  - moved：紫
  - conflict：红色快闪
  - stored：暗紫
- [ ] 用 Raycaster 做点选，回调 `onSelect(itemId | null)`。被选中的物品描边变白，并显示标签：名称、W×D×H、尺寸来源。

**验收**：一次传入 40 个物品时操作流畅；切换 placements 时能看到补间动画。

## A3 视角：`setCamera(mode, { owner })`、`focusOn(id)`（15 分钟）

- [ ] `orbit`：默认视角，从斜上方约 45° 俯视全屋。
- [ ] `top`：切换到 OrthographicCamera 正交俯视，像蓝图一样只看平面布局。
- [ ] `seat`：第一人称"坐在书桌前"。
  - 从 `room.zones` 找到 `${owner}.desk`，默认 owner 为 A
  - 眼睛高 115cm，位于桌子前沿外 45cm（前沿方向见 zone.front）
  - 视线看向桌面后沿中点，FOV 70
- [ ] 视角切换用 700ms 补间。
- [ ] `focusOn(id)`：id 可以是 itemId 或 zoneId，相机平滑对准目标，并让它约占画面 40%。

**验收**：三种视角都能来回切换；座位视角能看清整张桌面。

## A4 特效（25 分钟）

- [ ] `showFocusField(box | null)`：画专注力场。
  - 半透明红橙色盒子（opacity 0.12）
  - 顶面贴六边形纹理（用 canvas 程序生成，不用外部图片）
  - 描边做 1Hz 呼吸效果
- [ ] `setFocusFieldState('conflict' | 'clear')`：变为 clear 时整体转绿，并显示 CSS2D 标签 `FIELD CLEAR / 净空`。
- [ ] `showTolerance(itemId, box | null)`：在物品位置画绿色虚线幽灵盒，表示"最大允许尺寸"。
- [ ] `playSteps(steps, { stepMs = 900, onStep, onDone })`：按顺序把每一步的 `from` 补间到 `to`。
  - 同时画紫色虚线轨迹：抬高 30cm 的二次贝塞尔曲线
  - `to === null` 的步骤（扔掉）：物品缩小并淡出
  - 返回控制器 `{ pause, resume, seek(i), stop }`；seek 时直接跳到第 i 步完成后的状态
- [ ] `setZoneStatus(map)`：按状态画分区轮廓。
  - empty：暗虚线
  - designing：橙色，1Hz 闪烁
  - done：绿色实线，加 `LOCKED` 标签

**验收**：EP02 演示时，能清楚看到"冲突物品变红 → 逐步移走 → 力场变绿"。

## A5 加分（有空再做）

- [ ] 加 EffectComposer + UnrealBloomPass 发光效果（strength 0.6、radius 0.4、threshold 0.2）。
  - `setBloom(bool)` 控制开关
  - 平均帧率低于 40 时自动关闭
- [ ] EP03 换季动画：stored 物品飞进行李箱时缩小淡出，取出时反向播放。
- [ ] `snapshot()`：返回当前画面的 dataURL，作为 EP04 的缩略图。
