# 04 · 数据契约（v1）

> **这是四条车道之间唯一的接口约定。** 字段名、取值、单位都以本文件为准。
> 代码版由 B 车道维护在 `src/core/types.js`（JSDoc @typedef），内容必须与本文件一致。
> 修改流程：先在 `tasks/CHANGES.md` 申请 → 人类改本文件 → B 同步 types.js → 通知 A、C、D。

## 1. 单位与坐标系

- **长度一律用厘米（cm）**，可以是小数。角度用度。月份 1–12。时间戳用 ISO 字符串。
- **世界坐标系**：Y 轴向上（与 three.js 一致）。
  - 原点：站在门口往屋里看，房间**左前角的地面**。
  - **x 轴**：从左墙指向右墙，宽度方向，0 → `room.w`。
  - **z 轴**：从门所在的墙指向窗和阳台，进深方向，0 → `room.d`；阳台在 `room.d` → `room.d + balcony.d`。
  - **y 轴**：从地面向上，0 → `room.h`。
- **一切盒子都是轴对齐的**：只允许绕 Y 轴转 0° 或 90°，体现为 w 和 d 互换。scene 渲染时不需要任何旋转矩阵。

```
        z ↑ （窗 / 阳台）
          │
          │   屋内
          │
  (0,0,0) └──────────→ x
        门所在的墙 z = 0（门在右侧）
```

## 2. 基础类型

```js
/** @typedef {{ w:number, d:number, h:number }} Size3
 *  w：沿 x 的宽；d：沿 z 的深；h：沿 y 的高 */

/** @typedef {{ x:number, y:number, z:number, w:number, d:number, h:number }} Box
 *  (x, y, z) 是最小角，(w, d, h) 是三个方向的长度。世界坐标。
 *  中心点 = (x + w/2, y + h/2, z + d/2) —— scene 放 mesh 时要用中心点！ */

/** @typedef {'A'|'B'|'C'|'D'|'pub'} Owner        // 'pub' 表示公共，四人共用 */
/** @typedef {'measured'|'product'|'estimated'|'unknown'} SizeSource
 *  measured：自己量的；product：商品参数或物品库标准规格；estimated：AI/常识估计；unknown：完全不知道 */
```

## 3. 宿舍

### 3.1 RoomParams：`buildRoom()` 的输入

完整字段和默认值见 `07-dorm-template-items.md` §1。最外层结构：

```js
{
  templateId: 'thu-4p-loft',
  name: '清华紫荆 · 四人间（上床下桌）',
  room:    { w, d, h },
  wallT:   10,
  door:    { x, w, h },
  balcony: { enabled, d, doorX, doorW },
  unit:    { len, depth, startZ, wardrobeLen, wardrobeDepth, wardrobeH, rodY,
             deskLen, deskDepth, deskH, hutchDepth, hutchY, hutchH,
             bedY, bedThick, bedLen, bedW, bedFootLen, railH,
             underDeskSideLen, underDeskBackDepth, underDeskH, chairDepth },
  occupants: ['A','B','C','D'],
  sizeSource: 'estimated'          // 拿到实测数据后改为 'measured'
}
```

### 3.2 Room：`buildRoom()` 的输出

```js
{
  id: 'thu-4p-loft',
  name: string,
  params: RoomParams,
  bounds: Box,                                   // 室内 + 阳台的总包围盒
  walls:     [{ id: string, box: Box }],
  openings:  [{ id: string, type: 'door'|'window'|'balconyDoor', box: Box }],
  fixtures:  Fixture[],
  zones:     Zone[]
}
```

### 3.3 Fixture：固定家具，不可移动

```js
{
  id: 'A.desk#fx',                // 约定：`${owner}.${type}#fx`
  type: 'loftBed'|'bedRail'|'desk'|'hutch'|'wardrobe'|'ladder'|'chair'|'sink'|'dryingRod',
  owner: Owner,
  box: Box,
  label: 'A 书桌'
}
```

> 椅子在现实中能挪，但本产品不规划它，只把它当作需要保持空出的区域（`${owner}.chair` keepClear）。

### 3.4 Zone：可以放东西或必须保持空出的空间

```js
{
  id: 'A.desk',                   // 约定：`${owner}.${slot}`，公共分区写作 `pub.${slot}`
  slot: 'desk',                   // 见下面的 slot 表
  label: 'A 书桌桌面',
  owner: Owner,
  kind: 'surface'|'shelf'|'floor'|'hang'|'inside'|'keepClear',
  box: Box,                       // 可用空间：底面就是放置面，h 是可用净高
  front: '+x'|'-x'|'+z'|'-z',     // 人从哪一侧伸手（'+x' 表示人站在 x 更大的一侧）
  tier: 0|1|2,                    // 0 = 手边；1 = 起身可及；2 = 深层收纳
  accepts: Category[] | ['*'],    // 允许放的类别
  stackable: boolean,             // 是否允许叠放
  rod: { axis: 'x'|'z', y: number } | undefined,   // 仅 kind = 'hang'：挂杆方向和杆的高度
  parentItemId: string | undefined                 // 仅 kind = 'inside'：所属行李箱的 itemId
}
```

**slot 一览**：同一个 slot 在四套单元里都有，公共分区只出现一次。

| slot | kind | tier | 说明 |
|---|---|---|---|
| desk | surface | 0 | 书桌桌面（书架以下的净高） |
| hutch | shelf | 0 | 桌上书架 |
| underDesk | floor | 1 | 桌下侧边（远离衣柜的一端） |
| underDeskBack | floor | 1 | 桌下靠墙的一条 |
| legSpace | keepClear | — | 腿部空间 |
| chair | keepClear | — | 椅子活动区 |
| wardrobeHang | hang | 1 | 衣柜挂衣区 |
| wardrobeBottom | floor | 1 | 衣柜底部 |
| bed | surface | 0 | 床面（只放被褥等） |
| bedFoot | surface | 2 | 床尾一段（深层收纳） |
| pubEntry | floor | 1 | `pub.entryL` 门口左侧公共角落 |
| pubCorner | floor | 1 | `pub.cornerL` / `pub.cornerR` 窗边公共角落 |
| doorBack | hang | 1 | `pub.doorBack` 门后挂钩 |
| balcony | floor | 1 | `pub.balcony` 阳台地面 |
| sinkShelf | shelf | 1 | `pub.sinkShelf` 洗漱台上方置物 |
| aisle / doorSwing / balconyWalk | keepClear | — | 过道、开门扇区、阳台通道（宿舍规定不得堵塞疏散通道） |
| inside | inside | 2 | 行李箱内部，仅 EP03 动态生成，id 为 `${itemId}.inside` |

## 4. Item：物品

```js
{
  id: 'it-001',                   // 由调用方保证唯一；parseItemsText 生成 `${idPrefix}-${三位序号}`
  name: '24寸行李箱',
  libId: 'luggage-24' | undefined,
  category: Category,
  size: Size3,                    // 默认摆放（立着）时的 w × d × h
  sizeSource: SizeSource,
  sizeRange: { min: Size3, max: Size3 } | undefined,   // estimated / unknown 时尽量给出
  freq: 'daily'|'weekly'|'monthly'|'seasonal'|'rare',
  months: number[] | undefined,   // 活跃月份；省略表示全年都用
  owner: Owner,
  flags: {
    stackable: boolean,           // 上面能不能再压东西（它自己能不能被叠在上面不受影响）
    canBearLoad: boolean,         // 能否承重（收纳箱 true，台灯 false）
    rotatable: boolean,           // 能否绕 Y 轴转 90°（默认 true）
    canLieDown: boolean,          // 能否放倒（h 与 d 互换）
    hangable: boolean,            // 能否挂起来
    fragile: boolean,
    focusTool: boolean,           // 学习工具（笔记本电脑等）：允许出现在专注区
    disposable: boolean,          // 可以直接扔（快递盒）
    compressible: number | undefined,   // 压缩后高度比例 0–1（真空压缩袋）
    container: Size3 | undefined  // 当作容器时的内部尺寸（行李箱）
  },
  hang: { thickness: number, length: number } | undefined,  // 挂起时沿杆方向的厚度、垂下的长度
  powerW: number | null | undefined,                        // 额定功率，null 表示未知
  preferred: string[] | undefined,                          // 首选 slot，例如 ['underDesk','pubEntry']
  growthPerSemester: number | undefined,                    // 每学期增长的件数（书）
  note: string | undefined
}
```

**Category 枚举**：`luggage` 行李 · `clothes` 衣物 · `bedding` 床品 · `books` 书 · `study` 文具资料 · `electronics` 电子 · `appliance` 电器 · `toiletry` 洗漱 · `storage` 收纳 · `food` 食品 · `sport` 运动/乐器 · `decor` 装饰 · `trash` 可丢弃 · `misc` 其他

**freq → 理想 tier**：daily → 0；weekly、monthly → 1；seasonal、rare → 2。

> **数量的处理**：Item 一律表示**一件**。"两床被子"会被解析成两个 Item。书例外：每 10 本合成一"摞"，余数按比例缩小高度。

## 5. Placement：一件物品放在哪

```js
{
  itemId: 'it-001',
  zoneId: 'A.underDesk',
  box: Box,              // 世界坐标；w/d/h 已经是旋转或放倒之后的实际尺寸
  rot: 0 | 90,           // 相对 item.size 是否交换了 w/d
  lying: boolean,        // 是否放倒
  layer: number,         // 0 = 直接放在分区底面；>0 = 叠在别的物品上
  compressed: boolean    // 是否按真空压缩后的尺寸放置
}
```

`placements` 一律是 `Record<itemId, Placement>`。没有出现在其中的物品就是"没放下"。

## 6. 规划结果

### 6.1 FitReport：`planMoveIn` 的返回值（EP01）

```js
{
  placements: Record<itemId, Placement>,
  verdicts: Record<itemId, {
    status: 'fits'|'relocate'|'uncertain'|'overflow'|'banned',
    zoneId: string | undefined,
    reasons: string[],                // 中文，给人看的
    suggestions: string[],            // 中文，可以直接照做的
    tolerance: { zoneId, maxW, maxD, maxH, fitsMax: boolean|null, text } | undefined,   // uncertain 时一定有
    need:      { zoneId, maxW, maxD, maxH, text } | undefined                            // overflow 时一定有
  }>,
  summary: { fits, relocate, uncertain, overflow, banned, total },
  overflowIds: string[],              // 进滞留区的顺序
  zoneFill: Record<zoneId, number>,
  sync: SyncReport
}
```

**五分类优先级**：banned > overflow > uncertain > relocate > fits，每件物品只取一个。

### 6.2 MovePlan：`planFocusField` 的返回值（EP02）

```js
{
  focusZoneId: 'A.desk',
  focusBox: Box,
  conflicts: string[],                // 力场内（及叠在其上）的物品
  steps: MoveStep[],
  unresolved: [{ itemId, reason, suggestion }],
  placementsAfter: Record<itemId, Placement>,
  metrics: { moves, distanceCm, estSeconds, clearedArea, syncBefore, syncAfter },
  alternatives: [{ id, label, extraCostYuan, plan: MovePlan }] | undefined   // 加分：加购方案
}
```

```js
/** MoveStep：EP02 与 EP03 共用 */
{
  idx: 0,
  itemId, itemName,
  kind: 'move'|'cascade'|'dispose'|'store'|'retrieve',
  fromZoneId, toZoneId,               // dispose 时 toZoneId = null
  from: Box, to: Box | null,          // dispose 时 to = null
  distance: number,                   // 两个中心点之间的距离（cm）
  text: '第 1 步：把「零食盒」从书桌桌面移到桌下（约 85 cm）'
}
```

### 6.3 TdmPlan：`planSeasons` 的返回值（EP03）

```js
{
  months: [9,10,11,12,1,2,3,4,5,6,7,8],
  tdm: true,
  byMonth: {
    [month]: {
      placements: Record<itemId, Placement>,
      active: string[],     // 当月在用（放在可达分区）
      stored: string[],     // 当月收起（放在深层或箱内）
      overflow: string[],
      zoneFill: Record<zoneId, number>
    }
  },
  matrix: { zoneIds: string[], months: number[], fill: number[][] },   // fill[分区下标][月份下标]
  compare: { on:  { maxFill, overflowMonths },
             off: { maxFill, overflowMonths } } | undefined
}
```

### 6.4 SyncReport：同步率

```js
{
  total: 0..100,                                   // 整数
  parts: { fit, access, focus, safety },           // 各 0..1
  votes: { time: boolean, space: boolean, mind: boolean },   // 三审决议：时 / 空 / 心
  notes: string[]                                  // 未通过的原因，中文
}
```

### 6.5 Snapshot：EP04 快照

```js
{
  id, label: '大一上 · 入住', semester: 'Y1-F',
  createdAt: ISOString,
  roomParams: RoomParams,
  items: Item[],
  placements: Record<itemId, Placement>,
  sync: number,
  focusMinutes: number,
  thumb: string | undefined          // dataURL，加分项
}
```

### 6.6 GrowthForecast：加分项

```js
{
  semesters: ['Y1-F','Y1-S','Y2-F',…],
  fill: Record<zoneId, number[]>,
  firstOverflow: { zoneId, semester } | null,
  text: string
}
```

## 7. 视觉状态

| 枚举 | 取值 | 由谁产生 |
|---|---|---|
| **ItemVisualState** | `fits` · `relocate` · `uncertain` · `overflow` · `banned` · `moved` · `conflict` · `stored` | UI 根据各话结果映射 |
| **ZoneStatus** | `empty` · `designing` · `done` | store 派生（docs/03 §5） |

颜色对应关系见 `06-eva-style.md` §2.2。

## 8. 示例 JSON（A、C 车道在 B0 之前自测用）

```json
{
  "room": {
    "id": "mock", "name": "示例：单套书桌",
    "bounds": { "x": 0, "y": 0, "z": 0, "w": 330, "d": 560, "h": 300 },
    "walls": [
      { "id": "wall-L", "box": { "x": -10, "y": 0, "z": 0,   "w": 10,  "d": 560, "h": 300 } },
      { "id": "wall-F", "box": { "x": 0,   "y": 0, "z": -10, "w": 330, "d": 10,  "h": 300 } }
    ],
    "openings": [
      { "id": "door", "type": "door", "box": { "x": 230, "y": 0, "z": -10, "w": 90, "d": 10, "h": 210 } }
    ],
    "fixtures": [
      { "id": "A.desk#fx",     "type": "desk",     "owner": "A", "label": "A 书桌", "box": { "x": 0, "y": 72,  "z": 170, "w": 60, "d": 130, "h": 3 } },
      { "id": "A.wardrobe#fx", "type": "wardrobe", "owner": "A", "label": "A 衣柜", "box": { "x": 0, "y": 0,   "z": 100, "w": 60, "d": 70,  "h": 170 } },
      { "id": "A.loftBed#fx",  "type": "loftBed",  "owner": "A", "label": "A 床",   "box": { "x": 0, "y": 175, "z": 105, "w": 90, "d": 200, "h": 15 } }
    ],
    "zones": [
      { "id": "A.desk", "slot": "desk", "label": "A 书桌桌面", "owner": "A", "kind": "surface",
        "box": { "x": 0, "y": 75, "z": 170, "w": 60, "d": 130, "h": 53 },
        "front": "+x", "tier": 0, "accepts": ["*"], "stackable": true },
      { "id": "A.underDesk", "slot": "underDesk", "label": "A 桌下", "owner": "A", "kind": "floor",
        "box": { "x": 0, "y": 0, "z": 260, "w": 60, "d": 40, "h": 70 },
        "front": "+x", "tier": 1, "accepts": ["luggage","storage","food","electronics","books","misc","toiletry"], "stackable": true },
      { "id": "pub.aisle", "slot": "aisle", "label": "过道", "owner": "pub", "kind": "keepClear",
        "box": { "x": 130, "y": 0, "z": 0, "w": 70, "d": 560, "h": 200 },
        "front": "+z", "tier": 1, "accepts": [], "stackable": false }
    ]
  },
  "items": [
    { "id": "it-001", "name": "27寸显示器", "category": "electronics", "size": { "w": 61, "d": 20, "h": 46 },
      "sizeSource": "product", "freq": "daily", "owner": "A",
      "flags": { "stackable": false, "canBearLoad": false, "rotatable": true, "canLieDown": false, "hangable": false,
                 "fragile": true, "focusTool": false, "disposable": false } },
    { "id": "it-002", "name": "零食盒", "category": "food", "size": { "w": 30, "d": 20, "h": 20 },
      "sizeSource": "estimated", "freq": "daily", "owner": "A",
      "flags": { "stackable": true, "canBearLoad": true, "rotatable": true, "canLieDown": false, "hangable": false,
                 "fragile": false, "focusTool": false, "disposable": false } },
    { "id": "it-003", "name": "24寸行李箱", "category": "luggage", "size": { "w": 42, "d": 26, "h": 66 },
      "sizeSource": "product", "freq": "rare", "owner": "A",
      "flags": { "stackable": false, "canBearLoad": true, "rotatable": true, "canLieDown": true, "hangable": false,
                 "fragile": false, "focusTool": false, "disposable": false,
                 "container": { "w": 38, "d": 22, "h": 61 } } }
  ],
  "placements": {
    "it-001": { "itemId": "it-001", "zoneId": "A.desk", "box": { "x": 0, "y": 75, "z": 205, "w": 20, "d": 61, "h": 46 }, "rot": 90, "lying": false, "layer": 0, "compressed": false },
    "it-002": { "itemId": "it-002", "zoneId": "A.desk", "box": { "x": 30, "y": 75, "z": 230, "w": 20, "d": 30, "h": 20 }, "rot": 90, "lying": false, "layer": 0, "compressed": false }
  }
}
```

it-003 没有 placement，因此应当出现在滞留区。
