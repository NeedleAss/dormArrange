# 05 · 算法设计

> 读者：B 车道（实现）、总架构（审查）。所有算法都是**纯函数、确定性**的。
> 数据结构见 `04-data-contract.md`，模板与物品数值见 `07-dorm-template-items.md`。
> 本文只给伪代码和规则，不给实现代码。实现时文件划分参考 `03-architecture.md` §2。

## 0. 总览

| 模块 | 回答的问题 | 核心方法 | 规模 / 预算 |
|---|---|---|---|
| 放置引擎 §2 | 这件东西在这个分区里放哪？ | 2.5D 高度图 + 栅格扫描 + 评分 | 单分区 ≤ 2000 格 |
| 候选排序 §3 | 这件东西该先试哪个分区？ | 硬过滤 + 加权代价（层级、亲和、公共、拥挤） | 20 分区 |
| EP01 入住 §4 | 能不能放下？要不要换位置？尺寸还差多少？ | 贪心放置 + 五分类 + 容差 / 最大空矩形 | 40 件 ≤ 150ms |
| EP02 腾桌 §5 | 最少挪几件、挪到哪，能腾出专注区？ | 冲突集 + 就近落点 + 一层级联 | ≤ 50ms |
| EP03 换季 §6 | 什么时候放哪？ | 按月分活跃/收起 + 稳定性优先的时分复用 | 12 月 × 2 遍 ≤ 800ms |
| 同步率 §7 | 布局好不好？ | 四项加权 + 三审决议 | — |
| 文本解析 §8 | 一段话里有哪些东西？ | 规则分句 + 别名匹配 + 尺寸/数量/功率正则 | — |

**统一约定**

- 排序时最后都用 `id` 字典序做 tie-break，保证确定性。
- 浮点比较的容差 `EPS = 0.01`（cm）。
- 不修改任何入参，返回新对象（可以用 `structuredClone`）。

## 1. 几何与分区局部坐标

### 1.1 盒子运算

```
intersects(a, b): 三个轴的区间都有正长度重叠（各轴重叠 > EPS）
contains(outer, inner): 每个轴都满足 inner ⊆ outer（允许 EPS）
overlapArea2D(a, b): 在 x-z 平面上的重叠面积（用于专注区覆盖率）
center(b) = (b.x + b.w/2, b.y + b.h/2, b.z + b.d/2)
dist(a, b) = |center(a) − center(b)|（欧氏距离，cm）
```

### 1.2 分区局部坐标

放置算法统一在分区的**局部平面**里计算：

- `u` 轴沿"前沿"方向
- `v` 轴从前沿往里，表示深度
- `y` 从分区底面往上

先求局部尺寸 `U × V`：

| front | U（沿前沿） | V（深度） |
|---|---|---|
| `+x` 或 `-x` | `box.d`（沿 z） | `box.w`（沿 x） |
| `+z` 或 `-z` | `box.w`（沿 x） | `box.d`（沿 z） |

**世界 → 局部**：`toLocal(zone, x, z) → (u, v)`

```
'+x': u = z − box.z ; v = (box.x + box.w) − x
'-x': u = z − box.z ; v = x − box.x
'+z': u = x − box.x ; v = (box.z + box.d) − z
'-z': u = x − box.x ; v = z − box.z
```

**局部 → 世界**：`toWorld(zone, {u0, v0, a, b}, base, h) → Box`

其中 `a` 是沿 u 的长度，`b` 是沿 v 的长度。

```
'+x': x = box.x + box.w − (v0 + b), z = box.z + u0, w = b, d = a
'-x': x = box.x + v0,               z = box.z + u0, w = b, d = a
'+z': x = box.x + u0,               z = box.z + box.d − (v0 + b), w = a, d = b
'-z': x = box.x + u0,               z = box.z + v0, w = a, d = b
y = box.y + base, h = h
```

### 1.3 物品的候选朝向 `orientations(item)`

```
立着：(sx, sz, h) = (size.w, size.d, size.h)
放倒（仅 canLieDown 时）：(size.w, size.h, size.d) 和 (size.h, size.d, size.w)
对每种 (sx, sz, h)：
  局部 footprint 有两种：(a, b) = (sx, sz) 或 (sz, sx)（rotatable 为 false 时只取与世界轴一致的那种）
去重后返回 [{ a, b, h, lying }]
```

`placement.rot` 由 `toWorld` 的结果反推：世界盒子的 `w === size.w` 为 0，否则为 90。

## 2. 放置引擎：2.5D 高度图

### 2.1 为什么用高度图

宿舍收纳里，绝大多数东西是"摆在某个面上，可能叠在别的东西上"。高度图把每个分区的底面切成方格，记录每格当前的"顶面高度"。这样可以：

- 自然地处理叠放：新物品落在它脚下最高点上
- 天然避免重叠：不可能有两个物品占用同一格的同一高度
- 用同一套代码支持 EP01 的整体规划、EP02 的找空位、EP03 的逐月重排

### 2.2 数据结构（每个非 hang、非 keepClear 的分区一个）

```
Heightmap {
  zone, U, V, r                  // r = 分辨率：U·V ≤ 10000 cm² 时为 2，否则为 5
  nu = floor(U / r), nv = floor(V / r)
  top:   Float32Array(nu·nv)     // 当前顶面高度（相对分区底面），初值 0
  bear:  Uint8Array(nu·nv)       // 该格顶面能否承重；地面初值 1
  block: Uint8Array(nu·nv)       // 1 = 禁止放置（keepClear 投影、专注区等）
  owner: Int32Array(nu·nv)       // 该格最上层物品在 placed 中的下标，−1 表示地面
  placed: [{ itemId, u0, v0, a, b, base, h, canBear }]   // 按放入顺序
}
```

格子覆盖区间一律"向外取整"：`i0 = floor(u0 / r)`、`i1 = ceil((u0 + a) / r) − 1`。宁可保守，保证绝不重叠。

### 2.3 建立：`buildEngines(room, placements, { lockedZones, extraBlocks })`

```
for zone in room.zones:
  hang → HangRail（§2.6）；keepClear → 跳过；inside → 和 floor 一样建高度图
  建 Heightmap
  for kc in room.zones where kc.kind == 'keepClear':
    若 kc.box 与 zone.box 在 3D 上相交 → 把相交部分的投影格设 block = 1
for p in placements（按 layer 升序，再按 itemId）:
  engines[p.zoneId].commitFromWorld(p)    // 用世界盒子反算局部矩形和 base
for zoneId in lockedZones: engines[zoneId].locked = true   // 不接受新物品，也不允许移出
```

### 2.4 找位置：`findSpot(item, opts)`

```
opts: { mode: 'store'|'near'|'reach', origin?: (u, v), avoidRect?: Rect, penaltyRect?: Rect }
best = null
for o in orientations(item):
  ca = ceil(o.a / r); cb = ceil(o.b / r)
  if ca > nu or cb > nv or o.h > zone.box.h: continue
  stride = (nu·nv > 1500) ? 2 : 1
  for j = 0; j ≤ nv − cb; j += stride:          // v 方向
    for i = 0; i ≤ nu − ca; i += stride:        // u 方向
      maxTop = 0; blocked = false
      for 覆盖的每一格 c:
        if block[c]: blocked = true; break
        maxTop = max(maxTop, top[c])
      if blocked: continue
      base = maxTop
      if base + o.h > zone.box.h + EPS: continue
      if base > EPS:
        if !zone.stackable: continue
        sup = 覆盖格中 top[c] ≥ base − 1 的个数
        if sup / (ca·cb) < 0.6: continue                  // 支撑面积不足 60%，悬空
        if 存在 top[c] ≥ base − 1 且 bear[c] == 0: continue   // 压在不能承重的东西上
      s = score(mode, i·r, j·r, o, base, opts)
      if best == null or s < best.s − EPS or (|s − best.s| ≤ EPS and 更靠前的 (j, i)):
        best = { u0: i·r, v0: j·r, a: o.a, b: o.b, h: o.h, lying: o.lying, base, s }
return best          // null 表示放不下
```

### 2.5 评分：越小越好

| mode | 公式 | 用途 |
|---|---|---|
| `store` | `1.0·base + 0.5·(V − (v0+b)) + 0.05·u0` | 默认收纳：先铺满底面，靠里，再靠左 |
| `reach` | `2.0·base + 0.3·(V − (v0+b)) + 0.2·|(u0 + a/2) − U/2|` | 每天用的东西放在手边（目前只给 focusTool 物品用） |
| `near` | `dist2D((u0 + a/2, v0 + b/2), origin) + 2.0·base` | EP02：在原位置附近找落点 |

附加项：

- `penaltyRect`：落点与它相交时 `+50`。EP01 把桌面的**默认专注区**（75×35，前沿居中）作为 penaltyRect，这样新生的初始布局就自动留出学习区——这是 EP01 和 EP02 的呼应。
- `avoidRect`：直接视为 block。EP02 用它封住专注区。

### 2.6 挂杆：一维装箱 `HangRail`

```
L = 分区沿 rod.axis 的长度；used = 0；list = []
fits(item): item.flags.hangable && item.hang.length ≤ rod.y − zone.box.y + EPS
            && used + item.hang.thickness ≤ L + EPS
place(item):
  offset = used；used += thickness
  世界盒子：沿 rod.axis 取 [起点 + offset, 起点 + offset + thickness]；
           垂直于杆的方向取分区深度居中的 min(分区深度, 50)；
           y 取 [rod.y − length, rod.y]
```

### 2.7 inside 分区（行李箱内部，只有 EP03 用）

行李箱被放下且 `flags.container` 存在时，用它的 placement 生成：

```
{ id: `${itemId}.inside`, slot: 'inside', kind: 'inside', owner, tier: 2, stackable: true,
  accepts: ['clothes','bedding','storage','misc','sport','appliance'],
  box: 行李箱盒子按 container 尺寸居中内缩（放倒时按放倒后的方向对应），
  front: 同父分区, parentItemId }
```

### 2.8 移除与克隆

- `removeItem(itemId)`：从 `placed` 删除后，按原顺序重放其余物品重建网格。分区很小，重建只要几毫秒，比做增量撤销更可靠。
- `clone()`：拷贝数组和 `placed`。

### 2.9 最大空矩形 `maxEmptyRect()`：给 EP01 的 need 用

把 `top == 0 且 block == 0` 的格子看成 1，在二值矩阵上找面积最大的全 1 矩形（直方图 + 单调栈，O(nu·nv)）。返回 `{ a, b }`（cm）。

## 3. 候选分区排序 `rankZones(item, room, ctx)`

### 3.1 硬过滤：满足任一条就排除

1. `zone.kind === 'keepClear'`
2. 归属不符：
   - `zone.owner !== item.owner && zone.owner !== 'pub'`
   - 物品是公共的（`item.owner === 'pub'`）时，只能进 pub 分区
3. `zone.accepts` 不是 `['*']`，且不包含 `item.category`
4. 分区被锁定（`ctx.lockedZones` 包含它）
5. 挂杆分区但物品不可挂（`!item.flags.hangable`）。可挂的物品也可以折叠后进普通分区。
6. 快速尺寸检查：所有朝向都满足不了 `a ≤ U 且 b ≤ V 且 h ≤ zone.box.h`；挂杆分区则检查 `hang.length` 是否超高

### 3.2 代价：越小越优先

```
idealTier = { daily: 0, weekly: 1, monthly: 1, seasonal: 2, rare: 2 }

tierCost = 3 × |idealTier[item.freq] − zone.tier|
affCost  = item.preferred 包含 zone.slot → 0
           否则 AFFINITY[item.category] 包含 zone.slot → 1.5
           否则 → 4
pubCost  = (zone.owner === 'pub' && item.owner !== 'pub') ? 3 : 0
fillCost = 2 × 当前占用率(zone)        // 0..1，用于均摊

cost = tierCost + affCost + pubCost + fillCost
```

按 `cost` 升序排列，相同时按 `zone.id`。

### 3.3 类别亲和表 `AFFINITY`

| 类别 | 亲和 slot（越靠前越合适，但代价都是 1.5） |
|---|---|
| luggage | underDesk, bedFoot, pubEntry, pubCorner, balcony |
| clothes | wardrobeHang, wardrobeBottom, bedFoot |
| bedding | bed, bedFoot, wardrobeBottom |
| books | hutch, desk, underDeskBack |
| study | desk, hutch |
| electronics | desk, hutch, underDeskBack |
| appliance | desk, hutch, wardrobeBottom |
| toiletry | sinkShelf, balcony, wardrobeBottom |
| storage | underDesk, underDeskBack, bedFoot, wardrobeBottom, pubEntry |
| food | hutch, underDesk |
| sport | pubEntry, doorBack, balcony, bedFoot |
| decor | hutch, desk, bed |
| misc | doorBack, underDesk, hutch, pubEntry |
| trash | （无，直接建议丢弃） |

## 4. 第一话 入住：`planMoveIn(room, items, opts)`

### 4.1 主流程

```
opts: { owner = 'A', lockedZones = [], existing = {} }
engines = buildEngines(room, existing, { lockedZones })
verdicts = {}; placements = {}

① 规则检查
for it in items:
  r = checkRules(it)
  if r.banned: verdicts[it.id] = { status: 'banned', reasons: [r.reason], suggestions: SUGGEST.banned(it, r) }
  else if r.warn: it._warn = r.warn               // 只是记下，后面分类时用
  if it.category === 'trash' or it.flags.disposable:
     verdicts[it.id] = { status: 'relocate', reasons: ['可丢弃物品'], suggestions: ['直接扔掉或拆平'] }

② 排序（难放的先放）
cands = 未判定的物品
order = sort(cands, by [可行分区数 asc, 体积 desc, id asc])

③ 放置
for it in order:
  for z in rankZones(it, room, { lockedZones }):
    mode = it.flags.focusTool ? 'reach' : 'store'
    penalty = (z.slot === 'desk' && !it.flags.focusTool) ? defaultFocusRect(z) : null
    spot = engines[z.id].findSpot(it, { mode, penaltyRect: penalty })
    if spot: commit; placements[it.id] = toPlacement(it, z, spot); break
  if 没放下 && it.flags.compressible:
    itC = { ...it, size: { ...it.size, h: it.size.h × compressible } }
    再试一遍，成功则 placement.compressed = true
  if 仍没放下: overflow.push(it.id)

④ 分类（§4.3）⑤ 容差与 need（§4.4、§4.5）⑥ 文案（§4.6）
⑦ summary、zoneFill、sync = computeSync(room, items, placements, { owner, decisions: uncertain + relocate })
```

`defaultFocusRect(desk)` 是局部矩形 `{ u0: (U − 75)/2, v0: 0, a: min(75, U), b: min(35, V) }`。

### 4.2 为什么用贪心

宿舍场景只有几十件物品、十几个分区。贪心算法可解释（每件东西为什么放在那里都说得清）、确定、快。

全局最优的 3D 装箱是 NP 难问题，而且最优解往往"反直觉"，人不会照着摆。这一点也是路演答辩时的标准回答（docs/01 §6）。

### 4.3 五分类

优先级：banned > overflow > uncertain > relocate > fits。

```
p = placements[it.id]
if 已是 banned: 保持
else if !p: status = 'overflow'
else:
  z = zone(p.zoneId)
  rel = []
  if z.owner === 'pub' && it.owner !== 'pub': rel.push(`只能放在公共区「${z.label}」，需要和室友商量`)
  if it.preferred?.length && !it.preferred.includes(z.slot): rel.push(`首选位置放不下，改放「${z.label}」`)
  if |idealTier − z.tier| ≥ 2: rel.push('使用频率和位置不匹配（常用的东西放得太深，或者反过来）')
  if p.compressed: rel.push('需要真空压缩后才放得下')
  uncertain = it.sizeSource ∈ {'estimated','unknown'} || it._warn
  status = uncertain ? 'uncertain' : (rel.length ? 'relocate' : 'fits')
  reasons = [...rel, ...(it._warn ? [it._warn] : [])]
```

### 4.4 尺寸容差 `tolerance`：回答"哪些尺寸还不能确定"

对每件已放下的 uncertain 物品：把它从引擎中移除，然后以它的落点为中心向外"膨胀"。

```
eng' = engine 克隆后 removeItem(it.id)
base = spot.base
maxH = zone.box.h − base
// u 方向：在物品的 v 区间内，逐列向左、向右扩展，直到碰到 top > base + 0.5 或 block 的格子
maxA = a + (左扩格数 + 右扩格数) × r
// v 方向：在原 u 区间内逐行向前、向后扩展，同理
maxB = b + (前扩格数 + 后扩格数) × r
把 (maxA, maxB) 映射回物品自身的 (maxW, maxD)：footprint 若是 (w, d) 则直接对应，若是 (d, w) 则交换
fitsMax = sizeRange?.max 存在 ? (max 在任一可行朝向下 ≤ (maxW, maxD, maxH)) : null
text = `下单前确认：宽 ≤ ${maxW}、深 ≤ ${maxD}、高 ≤ ${maxH} cm 就能放进「${zone.label}」`
       + (fitsMax === false ? `（按最大估计会超出，建议实测）` : '')
```

- 三个上限是**分别**计算的：每个上限都假设其余两维不变。文案里用"约"。
- 挂杆分区：`maxThickness = L − 其他已用长度`，`maxLength = rod.y − zone.box.y`，文案改成"厚 ≤ …、长 ≤ …"。
- 功率未知（R-POWER-UNKNOWN）：tolerance 之外再加一句"选购额定功率 ≤ 1000W 的型号"。

### 4.5 放不下时的 `need`

```
z* = rankZones(it) 中代价最小的分区。这一步不做容量检查，只排除硬过滤不通过的。
     如果连硬过滤都没有分区能过，取同 owner、accepts 包含该类别的最大分区。
{ a, b } = engines[z*].maxEmptyRect()
need = { zoneId: z*.id, maxW: a, maxD: b, maxH: z*.box.h,          // 按"立着"的朝向描述
         text: `「${z*.label}」目前最大空位约 ${a}×${b}×${z*.box.h} cm` }
```

### 4.6 建议文案 `SUGGEST`

| 情况 | 建议（按顺序给 1–3 条） |
|---|---|
| banned | `宿舍禁用：${reason}`；如果只是功率超标："换额定功率 ≤ 1000W 的型号" |
| overflow · luggage | `换小一号：${need.text}`；"改用可折叠搬家袋，用完压扁"；"开学后带回家，或寄存" |
| overflow · 可压缩（被子/衣服） | "真空压缩袋（体积约减到 35–50%）"；"按季节轮换：见第三话「换季」" |
| overflow · 其他 | `换小尺寸：${need.text}`；"放公共区需与室友协商"；"考虑不带" |
| relocate · 公共区 | "和室友约定公共区的使用规则" |
| relocate · 压缩 | "准备一个真空压缩袋" |
| relocate · 层级不符 | "和不常用的东西交换位置" |
| uncertain | `tolerance.text`；功率未知时加"确认额定功率 ≤ 1000W" |
| fits | 不给建议，只显示位置 |

## 5. 第二话 腾桌：`planFocusField(room, items, placements, spec, opts)`

### 5.1 专注区

```
desk = zone(spec.zoneId)           // 默认 'A.desk'
(U, V) = localExtents(desk)
w = min(spec.w, U); d = min(spec.d, V)
rect = { u0: (U − w) / 2, v0: 0, a: w, b: d }      // 前沿居中：书和电脑总是摊在靠近人的这边
focusBox = toWorld(desk, rect, 0, desk.box.h)
```

预设尺寸：

| 预设 | w × d (cm) |
|---|---|
| 仅笔记本 | 35 × 25 |
| 书 + 笔记本 | 75 × 35（默认） |
| 双开书 + 笔记本 | 90 × 40 |

### 5.2 冲突集

```
conflicts = { 放在 desk 分区、且局部 footprint 与 rect 重叠面积 > 1 cm² 的物品 }
  减去 flags.focusTool 的物品（笔记本电脑本来就该在这里）
// 依赖闭包：压在冲突物品上面的东西也必须一起处理
repeat:
  for 放在 desk 上且 layer > 0 的物品 q:
    若 q 的支撑格的 owner 里有冲突物品 → 把 q 加入 conflicts
until 不再变化
```

### 5.3 逐件找落点

```
engines = buildEngines(room, placements 去掉 conflicts, { lockedZones })
engines[desk].blockRect(rect)                      // 封住专注区
syncBefore = computeSync(room, items, placements, { focusBox }).total
order = sort(conflicts, by [layer desc（先拿上面的）, 体积 desc, id])
for c in order:
  if c.flags.disposable or c.category === 'trash':
    steps.push(dispose 步骤); continue
  cands = []
  for z in rankZonesForMove(c):
    origin = (z === desk) ? c 在 desk 上的局部中心 : null
    spot = engines[z].findSpot(c, { mode: z === desk ? 'near' : 'store', origin })
    if spot: cands.push({ z, spot, cost: moveCost(c, z, spot) })
  if cands 非空: 取 cost 最小者 → commit → steps.push(move 步骤)
  else: tryCascade(c)（§5.4）；仍失败 → unresolved.push({ itemId, reason: '附近放不下', suggestion })
```

`rankZonesForMove(c)` 与 §3 相同，但有三点不同：

- **桌面本身优先**：桌面代价额外 −2，因为挪到桌子后排是最省事的。
- **同主人的近处分区**（hutch、underDesk、underDeskBack）代价额外 −1。
- **公共分区**代价额外 +5：腾桌不应该把东西塞给室友。

```
moveCost(c, z, spot) = 1                                         // 每挪一件，基本代价 1
                     + 0.02 × dist(原中心, 新中心)                 // 走得越远越费事
                     + 3 × |idealTier(c) − z.tier|                // 常用的别放太深
                     + (z.id !== c.当前分区 ? 2 : 0)              // 换分区比在桌上挪位更费事
                     + (z.owner === 'pub' ? 5 : 0)
```

### 5.4 一层级联 `tryCascade(c)`：先腾地方，再放

```
near = [desk, hutch, underDesk, underDeskBack]（同主人、未锁定）
evictables = near 中已放置、不在 conflicts、本轮还没被移动过的物品，
             按 [idealTier 降序（越不常用越先赶走）, 体积 desc, id] 排序，最多取 6 个
for x in evictables:
  deep = rankZones(x) 中 tier ≥ 1、不在 near 里的分区
  for dz in deep:
    s2 = engines[dz].findSpot(x, { mode: 'store' })
    if !s2: continue
    临时：engines[x.zone].removeItem(x)；engines[dz].commit(x, s2)
    再为 c 找落点（同 §5.3）
    若成功：依次记录 cascade 步骤（x）和 move 步骤（c）；return true
    否则：回滚两个引擎
return false
```

`maxCascade` 默认为 1，即每件冲突物品最多触发一次"赶走一件"。这样保证"最少调整"的承诺：步骤数 ≤ 冲突数 × 2。

### 5.5 步骤与文案

- **顺序**：级联步骤紧排在它所服务的 move 步骤之前；其余步骤按处理顺序排列。
- **文案**：

| kind | 文案模板 |
|---|---|
| move / cascade | `第 ${k} 步：把「${name}」从${from.label}移到${to.label}（约 ${round(distance)} cm）` |
| cascade（追加后缀） | `……，给「${c.name}」腾位置` |
| dispose | `第 ${k} 步：「${name}」直接扔掉或拆平` |

- `distance` 是两个盒子中心的 3D 距离。

### 5.6 指标

```
moves       = steps.length
distanceCm  = Σ distance
estSeconds  = Σ (15 + 0.3 × distance)          // 每件 15 秒起步，每厘米 0.3 秒
clearedArea = w × d
syncAfter   = computeSync(room, items, placementsAfter, { focusBox, moves }).total
```

`applySteps(placements, steps, upto)`：依次应用前 upto 步。dispose 步骤删除该 placement。

### 5.7 加购方案（加分，`allowUpgrades: true`）

依次尝试三种虚拟升级，每种都在原 room 上**添加虚拟分区**后重跑 §5.2–§5.6：

| id | 名称 | 价格 | 改动 |
|---|---|---|---|
| riser | 显示器增高架 | ¥39 | 桌上有显示器时：显示器抬高 9cm；在它原来的位置下方生成 `A.riserUnder` 分区（shelf，50 × 18 × 7），accepts study, books, electronics |
| deskShelf | 桌面双层置物架 | ¥29 | 桌面后排角落占 40×20，生成两层 shelf 分区（各 40 × 20 × 14） |
| sideHook | 桌侧挂钩 | ¥9 | 生成一个 hang 分区，挂书包和耳机 |

只要 moves 或 unresolved 有减少，就加入 `alternatives`，label 写成 `多花 ¥39，少挪 2 步`，按 moves 升序排列。

### 5.8 乱桌生成器（加分）：`scatterOnDesk(room, items, { owner })`

用于观众互动：把观众说出的桌面物品"像真实生活一样"堆在桌上，再现场腾桌。

```
desk = `${owner}.desk`；near = [desk, `${owner}.hutch`]
for it in sort(items, by 体积 desc, id):
  origin = 桌面局部的 (U/2, V × 0.35)            // 偏前、居中：乱桌的东西总堆在人面前
  spot = engines[desk].findSpot(it, { mode: 'near', origin })   // 不加专注区惩罚
  if !spot: 依次试 hutch、underDesk（store 模式）
return placements
```

生成结果直接作为 `planFocusField` 的输入。

## 6. 第三话 换季：`planSeasons(room, items, opts)`

### 6.1 思路：宿舍里的时分复用（TDM）

电子系的同学都熟悉"时分复用"：同一条信道，按时间片轮流传不同的信号。宿舍收纳也一样：

- 冬天的羽绒服和夏天的风扇**从不同时在用**，可以轮流占用同一个"可达位置"。
- 不用的那一个，进入**深层收纳**：床尾，或者**行李箱内部**。
- 行李箱一年到头都占着地方，不管空着还是装满。用它装过季的东西，相当于白拿一块空间。

### 6.2 流程

```
opts: { owner = 'A', tdm = true, months = [9,10,11,12,1,2,3,4,5,6,7,8], compare = true }
activeAt(it, m) = !it.months || it.months.includes(m)
seasonal = items 中 months 存在且长度 < 12 的
anchors  = 其余物品

① 锚点：anchors 用 §4 的放置流程放一次 → baseEngines、basePlacements（全年不动）
② 箱内分区：tdm 为 true 时，为每个已放下且有 container 的行李箱生成 inside 分区（§2.7）
③ 逐月：
prev = {}
for m in months:
  eng = clone(baseEngines) + inside 引擎（tdm 时）
  P = { ...basePlacements }
  active = seasonal.filter(activeAt(·, m)); inactive = seasonal − active
  if tdm:
    for it in sort(inactive, by 体积 desc, id):        // 先收起
      deep = [inside 分区…, 同主人 tier 2 分区…, tier 1 分区…]（都要过硬过滤）
      itC = it.flags.compressible ? 压缩后 : it
      先试 prev[it.id] 的原位（同分区、同局部矩形仍空闲）；否则在 deep 中 findSpot(store)
      → stored 或 overflow
  for it in sort(tdm ? active : seasonal, by 体积 desc, id):   // 再放在用的
    先试原位，否则 rankZones（排除 inside）→ findSpot
    → active（放下）或 overflow
  byMonth[m] = { placements: P, active, stored, overflow, zoneFill: zoneFill(room, items, P) }
  prev = P
④ matrix：取全年中占用率曾 > 0 的分区作为行，月份作为列
⑤ compare（仅当 compare 为 true，内部调用时传 compare: false 防止递归）：
   off = planSeasons(room, items, { ...opts, tdm: false, compare: false })
   compare = { on: 统计(this), off: 统计(off) }
   统计(plan) = { maxFill: 全年 tier ≤ 1 分区占用率的最大值, overflowMonths: overflow 非空的月份数 }
```

- **稳定性**："先试原位"保证一件物品在连续的活跃月份里不跳来跳去，动画也就只在换季那个月发生。
- **tdm 关闭时**：没有 inside 分区，不压缩，所有季节物品同时占用可达分区。这正是"不懂时分复用"的宿舍，用来和打开时对比。

### 6.3 换季步骤：`diffMonths(A, B, items, room)`

```
for itemId in A、B placements 的并集（按 id 排序）:
  pa = A.placements[itemId]; pb = B.placements[itemId]
  if 两者都在且 zoneId 和 box 都相同: continue
  kind = (A.stored 包含 && B.active 包含) ? 'retrieve'
       : (A.active 包含 && B.stored 包含) ? 'store'
       : 'move'
  text: retrieve → `取出「${name}」：从${pa 的分区}放到${pb 的分区}`
        store    → `收起「${name}」：放进${pb 的分区}`（行李箱内部显示为"${箱名}里"）
        move     → 同 EP02 的 move 文案
```

## 7. 同步率与三审决议：`computeSync(room, items, placements, ctx)`

```
considered = items 去掉 banned 和可丢弃的
fit    = considered 为空 ? 1 : 已放下数 / considered.length
access = 已放下物品的平均值 of (1 − |idealTier(it) − tier(zone)| / 2)，截断到 [0, 1]
focusBox = ctx.focusBox ?? `${ctx.owner ?? 'A'}.desk` 的默认专注区（75×35，前沿居中）
focus  = 1 − Σ overlapArea2D(该桌面上非 focusTool 物品, focusBox) / (focusBox.w × focusBox.d)，截断到 [0, 1]
safety = 与任一 keepClear 分区 3D 相交的物品数为 0 ? 1 : max(0, 1 − 0.5 × 违规件数)

total = round(100 × (0.35·fit + 0.25·access + 0.25·focus + 0.15·safety))

votes:
  space（空）= fit ≥ 0.9 && safety === 1
  mind（心） = focus ≥ 0.9 && access ≥ 0.7
  time（时） = (ctx.moves ?? 0) ≤ 5 && (ctx.decisions ?? 0) ≤ 6 && (ctx.swaps ?? 0) ≤ 8

notes：每个未通过的票都给一句中文原因，例如：
  '空：还有 2 件东西放不下'
  '心：专注区里还有 3 件东西'
  '时：需要挪 7 次，超过 5 步'
```

三审对应三个关键词：**时**（时间成本：要花几步）、**空**（空间：放不放得下、通道是否畅通）、**心**（专注：桌面是否净空、常用的东西是否顺手）。

## 8. 文本解析：`parseItemsText(text, { owner, idPrefix })`

```
① 规范化
   全角转半角；英文转小写
   中文数字转阿拉伯数字：一二两三四五六七八九十 → 1..10；"十几"按 12
② 分句
   按 /[，,、；;。\n]|和|以及|还有|另外/ 切开，去掉空白片段
③ 逐段处理 frag
   qty   = /(\d+)\s*(个|本|件|套|双|台|张|条|盒|瓶|把|只|床|叠|摞)/ 的数字，或段首的数字，缺省为 1
   inch  = /(\d+)\s*寸/                                    → 行李箱或显示器的规格
   dims  = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\s*(cm|厘米|mm|毫米)?/
           mm 要除以 10；两维时 h 用库默认值；sizeSource = 'product'
   power = /(\d+)\s*(w|瓦)/                                 → powerW
   uncertain = /不确定|不知道|未知|没量|大概|左右|差不多/  → sizeSource 置为 'unknown'（"大概""左右"时为 'estimated'）
   lib   = 在 LIBRARY 的 name 和 aliases 中找"出现在 frag 里的最长别名"
           有 inch 时，在同前缀的规格里取最接近的（luggage-20/24/28、monitor-24/27）
   未匹配：{ name: frag 原文（去掉数量词）, category: guessCategory(frag), size: CATEGORY_DEFAULT_SIZE[category], sizeSource: 'unknown' }
④ 展开数量
   books 类：ceil(qty / 10) 摞，最后一摞的高度按余数比例缩小
   其余：生成 qty 个独立物品，name 后缀 #1、#2…（qty = 1 时不加后缀）
⑤ id = `${idPrefix}-${三位序号}`，按出现顺序编号
```

`guessCategory` 的关键词表（命中第一个即止）：

| 关键词 | 类别 |
|---|---|
| 箱、包、袋 | storage |
| 衣、裤、鞋、袜 | clothes |
| 被、枕、褥、毯 | bedding |
| 书、本、册 | books |
| 笔、纸、尺 | study |
| 机、屏、线、灯、电脑 | electronics |
| 壶、锅、器、扇 | appliance |
| 盆、桶、刷、巾、洗 | toiletry |
| 零食、饮料、杯 | food |
| 球、拍、琴、垫 | sport |
| 其他 | misc |

`CATEGORY_DEFAULT_SIZE`：每个类别取一个"中号"尺寸，例如 storage 44×32×26、clothes 30×25×20、misc 30×30×30。

## 9. 成长预测（加分）：`predictGrowth(items, room, { owner, semesters: 8 })`

```
对 growthPerSemester > 0 的物品（如书），每学期按增长量累加体积（books：每 +1 摞 = 26×19×25）
对每个学期，用 §4 的放置流程试放增长后的物品集合，或者用体积近似 hutch + desk 的占用
firstOverflow = 第一个出现溢出的 (zoneId, semester)
text = `按每学期 +5 本书的速度，${semesterLabel} 书架会满。建议届时把旧教材收进床尾箱`
```

## 10. 测试清单（B 车道必须覆盖）

| 不变量 | 适用 |
|---|---|
| 任意两个 placement 的 box 不相交 | 全部 |
| placement.box 完全包含在其 zone.box 内 | 全部（inside 分区包含在行李箱盒子内） |
| 不与任何 keepClear 分区相交 | 全部 |
| 相同输入两次调用，JSON.stringify 结果完全相同 | 全部 |
| summary 各项之和 = 物品数 | EP01 |
| uncertain ⇒ 一定有 tolerance，overflow ⇒ 一定有 need | EP01 |
| 应用 placementsAfter 后专注区内没有非 focusTool 物品 | EP02 |
| 非冲突且未被级联的物品 placement 不变；锁定分区不变 | EP02 |
| 当月不活跃的季节物品都在 tier 2 或 inside 分区 | EP03 |
| `compare.on.maxFill ≤ compare.off.maxFill` | EP03 |
| `0 ≤ total ≤ 100`；腾桌后 total 不降 | 同步率 |
