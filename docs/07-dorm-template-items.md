# 07 · 宿舍模板、物品库与宿舍规定

> 读者：B 车道负责实现，A 车道用来对照渲染结果，人类负责用实测值替换。
> ⚠️ **下面所有尺寸都是估计值**，必须用队友实测或数地砖得到的数据替换，并把 `sizeSource` 改成 `'measured'`。
> 未实测的数字在 UI 上标注"估"。

## 1. 宿舍模板 `thu-4p-loft`：四人间，上床下桌

### 1.1 默认参数 `DEFAULT_PARAMS`（单位 cm）

```js
export const DEFAULT_PARAMS = {
  templateId: 'thu-4p-loft',
  name: '清华紫荆 · 四人间（上床下桌）· 估计值',
  room:    { w: 330, d: 560, h: 300 },          // 室内净宽、净深、净高
  wallT:   10,                                  // 墙厚，只用于渲染
  door:    { x: 230, w: 90, h: 210 },           // 门在前墙 z=0 上，左边框位于 x=230，向内开
  balcony: { enabled: true, d: 140, doorX: 130, doorW: 70 },  // 阳台进深 140；阳台门开在 z=room.d 的墙上
  unit: {
    len: 210, depth: 95, startZ: 100,           // 每套组合床沿墙长 210、离墙深 95；第一套从 z=100 开始
    wardrobeLen: 70, wardrobeDepth: 60, wardrobeH: 170, rodY: 160,
    deskLen: 130, deskDepth: 60, deskH: 75,
    hutchDepth: 25, hutchY: 130, hutchH: 40,    // 桌上书架：层板面高 130，可用净高 40
    bedY: 175, bedThick: 15, bedLen: 200, bedW: 90, bedFootLen: 30, railH: 30,
    underDeskSideLen: 40, underDeskBackDepth: 20, underDeskH: 70,
    chairDepth: 50
  },
  occupants: ['A','B','C','D'],                 // A、B 在左墙（从门往里），C、D 在右墙
  sizeSource: 'estimated'
};
```

### 1.2 平面示意（俯视；z 向上为往里，门在下方）

```
 z=700 ┌──────────────────── 阳台外墙（窗）───────────────────┐
       │ pub.balcony │        │ 阳台通道 │         [洗漱台]    │
 z=560 ├─────────────┴────────┤ 阳台门  ├─────────────────────┤
       │ pub.cornerL          │         │          pub.cornerR │
 z=520 ├──────────┐           │         │           ┌──────────┤
       │ B 书桌    │ B 椅子     │         │     D 椅子 │ D 书桌    │
 z=380 │ B 衣柜    │           │  过道    │           │ D 衣柜    │
 z=310 ├──────────┤           │pub.aisle│           ├──────────┤
       │ A 书桌    │ A 椅子     │  70 宽   │     C 椅子 │ C 书桌    │
 z=170 │ A 衣柜    │           │         │           │ C 衣柜    │
 z=100 ├──────────┘           │         │           └──────────┤
       │ pub.entryL           │         │   ╲ 开门扇区          │
   z=0 └──────────────────────┴─────────┴──────[  门  ]────────┘
      x=0        x=95       x=130     x=200       x=230   x=320 x=330
```

每套单元沿墙的顺序：衣柜在靠门一端（z0 → z0+70），书桌在里侧（z0+70 → z0+200），梯子在最里端。床架在整套单元上方。

### 1.3 生成公式

记 `W = room.w`、`D = room.d`、`u = unit`。

**单元位置**：第 k 套单元（k = 0, 1）的起点 `z0 = u.startZ + k·u.len`。

- 左墙：A（k=0）、B（k=1）
- 右墙：C（k=0）、D（k=1）

**离墙方向的区间函数 `X(a, b)`**：

- 左墙单元：`X(a, b) = [a, b]`，front 为 `'+x'`
- 右墙单元：`X(a, b) = [W − b, W − a]`，front 为 `'-x'`

**书桌的 z 区间**：`zd0 = z0 + u.wardrobeLen`，`zd1 = zd0 + u.deskLen`。

#### 固定家具 fixtures（每套单元，owner = o）

| id | type | x | z | y |
|---|---|---|---|---|
| `o.wardrobe#fx` | wardrobe | X(0, wardrobeDepth) | [z0, z0+wardrobeLen] | [0, wardrobeH] |
| `o.desk#fx` | desk | X(0, deskDepth) | [zd0, zd1] | [deskH−3, deskH] |
| `o.hutch#fx` | hutch | X(0, hutchDepth) | [zd0, zd1] | [hutchY−2, hutchY+hutchH] |
| `o.loftBed#fx` | loftBed | X(0, bedW) | [z0+5, z0+5+bedLen] | [bedY, bedY+bedThick] |
| `o.bedRail#fx` | bedRail | X(bedW−3, bedW) | [z0+5, z0+5+bedLen] | [bedY+bedThick, bedY+bedThick+railH] |
| `o.ladder#fx` | ladder | X(bedW−35, bedW) | [z0+len−10, z0+len] | [0, bedY] |
| `o.chair#fx` | chair | X(deskDepth, deskDepth+chairDepth) | [zd0+25, zd0+75] | [0, 90] |

#### 分区 zones（每套单元）

| id | kind | x | z | y | tier | accepts | 可叠 |
|---|---|---|---|---|---|---|---|
| `o.desk` | surface | X(0, deskDepth) | [zd0, zd1] | [deskH, hutchY−2] | 0 | `*` | ✓ |
| `o.hutch` | shelf | X(0, hutchDepth) | [zd0, zd1] | [hutchY, hutchY+hutchH−2] | 0 | books, study, electronics, decor, food, toiletry, storage, misc | ✓ |
| `o.underDesk` | floor | X(0, deskDepth) | [zd1−underDeskSideLen, zd1] | [0, underDeskH] | 1 | luggage, storage, food, electronics, books, misc, toiletry, appliance | ✓ |
| `o.underDeskBack` | floor | X(0, underDeskBackDepth) | [zd0, zd1−underDeskSideLen] | [0, underDeskH] | 1 | storage, books, electronics, misc, food | ✓ |
| `o.legSpace` | keepClear | X(underDeskBackDepth, deskDepth) | [zd0, zd1−underDeskSideLen] | [0, underDeskH] | — | — | — |
| `o.chair` | keepClear | X(deskDepth, deskDepth+chairDepth) | [zd0, zd1−underDeskSideLen] | [0, 120] | — | — | — |
| `o.wardrobeHang` | hang（rod 沿 z，y = rodY） | X(0, wardrobeDepth) | [z0, z0+wardrobeLen] | [rodY−100, rodY] | 1 | clothes, misc | — |
| `o.wardrobeBottom` | floor | X(0, wardrobeDepth) | [z0, z0+wardrobeLen] | [2, rodY−102] | 1 | clothes, storage, toiletry, appliance, misc, sport, bedding | ✓ |
| `o.bed` | surface | X(0, bedW) | [z0+5+bedFootLen, z0+5+bedLen] | [bedY+bedThick, +40] | 0 | bedding, decor, electronics, books | ✓ |
| `o.bedFoot` | surface | X(0, bedW) | [z0+5, z0+5+bedFootLen] | [bedY+bedThick, +45] | 2 | storage, bedding, clothes, luggage, misc, books, sport | ✓ |

#### 公共分区（owner = 'pub'）

| id | kind | x | z | y | tier | accepts |
|---|---|---|---|---|---|---|
| `pub.entryL` | floor（front `+x`） | [0, u.depth] | [0, u.startZ] | [0, 200] | 1 | `*` |
| `pub.doorSwing` | keepClear | [door.x, door.x+door.w] | [12, door.w] | [0, door.h] | — | — |
| `pub.doorBack` | hang（rod 沿 x，y = 180） | [door.x+10, door.x+door.w−10] | [0, 10] | [90, 180] | 1 | misc, sport, clothes |
| `pub.aisle` | keepClear | [W/2−35, W/2+35] | [0, D] | [0, 200] | — | — |
| `pub.cornerL` | floor（front `+z`） | [0, u.depth] | [u.startZ+2·u.len, D] | [0, 120] | 1 | `*` |
| `pub.cornerR` | floor（front `+z`） | [W−u.depth, W] | [u.startZ+2·u.len, D] | [0, 120] | 1 | `*` |

#### 阳台（`balcony.enabled` 为 true 时生成，Db = balcony.d）

| id | 类型 | x | z | y | 其他 |
|---|---|---|---|---|---|
| `pub.balcony` | zone floor（front `+x`） | [0, 90] | [D+10, D+Db] | [0, 150] | tier 1；accepts toiletry, storage, sport, luggage, misc, clothes, appliance |
| `pub.balconyWalk` | zone keepClear | [doorX, doorX+doorW] | [D, D+Db] | [0, 200] | — |
| `pub.sink#fx` | fixture sink | [W−70, W] | [D+Db−55, D+Db] | [0, 85] | — |
| `pub.sinkShelf` | zone shelf（front `-z`） | [W−70, W] | [D+Db−15, D+Db] | [120, 150] | tier 1；accepts toiletry |
| `pub.dryingRod#fx` | fixture dryingRod | [10, W−10] | [D+68, D+72] | [198, 202] | 只渲染，不收纳 |

#### 墙与门窗（只用于渲染）

- **墙**：
  - 左墙 x ∈ [−wallT, 0]，右墙 x ∈ [W, W+wallT]
  - 前墙 z ∈ [−wallT, 0]
  - 室内与阳台之间的隔墙 z ∈ [D, D+wallT]
  - 阳台外墙 z ∈ [D+Db, D+Db+wallT]
  - 阳台左右两侧墙
  - 以上墙高都是 room.h
- **门窗 openings**：
  - 门：x ∈ [door.x, door.x+door.w]，z ∈ [−wallT, 0]，y ∈ [0, door.h]
  - 阳台门：x ∈ [doorX, doorX+doorW]，z ∈ [D, D+wallT]，y ∈ [0, 210]
  - 窗：在阳台外墙上（没有阳台时在隔墙上），x ∈ [20, W−20]，y ∈ [90, 250]
- `room.bounds` = { x: 0, y: 0, z: 0, w: W, d: D + (balcony.enabled ? Db : 0), h: room.h }

### 1.4 用实测数据更新

1. 优先实测：**房间长、宽**，**书桌长、深、高**，**书架层高**，**衣柜宽、深和挂杆高**，**桌下净高**，**阳台进深**。
2. 没有卷尺时用**数地砖法**：尺寸 ≈ 块数 × 砖长。宿舍地砖常见 60cm 或 80cm；先量一块砖，或数一排砖和已知物体对比。也可以拿 A4 纸当尺子（29.7 × 21.0cm）。门洞宽度一般在 80–100cm，可作交叉校验。
3. 修改 `DEFAULT_PARAMS` 后跑一次 `npm test`，确认 B2/B3 的断言仍然成立。必要时一起调整演示预设。

## 2. 物品库 `LIBRARY`

尺寸是常见规格或估计值。W×D×H 指立着摆放时的尺寸。"标记"一栏的缩写：

- st：stackable
- bear：canBearLoad
- lie：canLieDown
- hang：hangable
- frag：fragile
- focus：focusTool
- disp：disposable
- comp：compressible（括号里是压缩后的高度比例）
- cont：container（括号里是内部尺寸）

| libId | 名称 | 别名（解析用） | 类别 | W×D×H | 来源 | freq | 月份 | 标记 | 首选 slot |
|---|---|---|---|---|---|---|---|---|---|
| luggage-20 | 20寸行李箱 | 20寸,登机箱 | luggage | 36×23×55 | product | rare | — | bear, lie, cont 32×19×50 | underDesk, pubEntry |
| luggage-24 | 24寸行李箱 | 24寸 | luggage | 42×26×66 | product | rare | — | bear, lie, cont 38×22×61 | underDesk, pubEntry |
| luggage-28 | 28寸行李箱 | 28寸 | luggage | 48×29×77 | product | rare | — | bear, lie, cont 44×25×72 | pubEntry, balcony |
| bag-move | 折叠搬家袋 | 搬家袋,编织袋 | storage | 60×35×40 | estimated | rare | — | comp(0.3) | bedFoot, wardrobeBottom |
| box-l | 大号收纳箱 | 收纳箱,整理箱 | storage | 55×40×33 | product | monthly | — | st, bear | underDesk, bedFoot |
| box-m | 中号收纳箱 | 收纳盒 | storage | 44×32×26 | product | monthly | — | st, bear | underDesk, wardrobeBottom |
| box-desk | 桌面收纳盒 | 笔筒,桌面收纳 | study | 25×15×12 | estimated | daily | — | — | desk, hutch |
| quilt-winter | 冬被 | 被子,棉被 | bedding | 50×40×30 | estimated | seasonal | 11,12,1,2,3 | st, comp(0.35) | bed, bedFoot |
| quilt-summer | 夏凉被 | 空调被,凉被 | bedding | 40×35×12 | estimated | seasonal | 5,6,7,8,9 | st, comp(0.5) | bed |
| pillow | 枕头 | — | bedding | 48×30×12 | estimated | daily | — | st | bed |
| down-jacket | 羽绒服 | 棉服,棉衣 | clothes | 40×30×25（折叠） | estimated | seasonal | 11,12,1,2,3 | hang（厚 10、长 90）, comp(0.4) | wardrobeHang |
| coat | 外套 | 夹克,卫衣,风衣 | clothes | 35×28×12（折叠） | estimated | weekly | 9,10,11,3,4,5 | hang（厚 6、长 80） | wardrobeHang |
| clothes-stack | 衣物（一叠 10 件） | 衣服,T恤,衬衫,裤子 | clothes | 30×25×20 | estimated | daily | — | st, bear | wardrobeBottom |
| shoes | 鞋（一双） | 运动鞋,鞋子,拖鞋 | clothes | 32×20×12 | estimated | daily | — | st | pubEntry, wardrobeBottom |
| shoe-rack | 鞋架 | — | storage | 50×25×60 | product | daily | — | bear | pubEntry |
| laptop | 笔记本电脑 | 电脑,笔记本,平板 | electronics | 32×22×2 | product | daily | — | focus | desk |
| monitor-24 | 24寸显示器 | 24寸,显示器,屏幕 | electronics | 54×18×42 | product | daily | — | frag | desk |
| monitor-27 | 27寸显示器 | 27寸 | electronics | 61×20×46 | product | daily | — | frag | desk |
| riser | 显示器增高架 | 增高架 | storage | 55×20×9 | product | daily | — | bear | desk |
| lamp | 台灯 | — | electronics | 15×15×40 | estimated | daily | — | — | desk |
| power-strip | 插线板 | 插排,排插 | electronics | 30×6×4 | product | daily | — | — | desk, underDeskBack |
| keyboard | 键盘 | — | electronics | 44×13×3 | product | daily | — | — | desk |
| headphones | 耳机 | 耳机盒 | electronics | 20×18×9 | estimated | daily | — | — | hutch, desk |
| fan-desk | 台式小风扇 | 风扇,电扇,小风扇 | appliance | 25×20×35 | estimated | seasonal | 6,7,8,9 | powerW 30 | desk, hutch |
| hairdryer | 吹风机 | 电吹风 | appliance | 25×10×25 | estimated | weekly | — | powerW **null**（需确认 ≤1000W） | wardrobeBottom, balcony |
| kettle | 电热水壶 | 烧水壶,热水壶,电水壶 | appliance | 22×16×25 | estimated | daily | — | powerW **1500** → 禁用 | — |
| rice-cooker | 电饭锅 | 电饭煲 | appliance | 25×25×22 | estimated | — | — | 关键词禁用 | — |
| e-blanket | 电热毯 | — | appliance | 40×30×10 | estimated | — | — | 关键词禁用 | — |
| heater | 取暖器 | 小太阳,暖风机,电暖器 | appliance | 30×20×40 | estimated | — | — | 关键词禁用 | — |
| books-10 | 书（10 本一摞） | 书,教材,课本 | books | 26×19×25 | estimated | weekly | — | st, bear；每学期 +0.5 摞 | hutch, desk |
| folder | 讲义/文件夹 | 讲义,资料,试卷 | study | 31×24×4 | estimated | daily | — | st, bear | desk, hutch |
| cup | 水杯 | 杯子,保温杯 | food | 8×8×20 | estimated | daily | — | — | desk |
| snack-box | 零食箱 | 零食 | food | 30×20×20 | estimated | daily | — | st, bear | underDesk, hutch |
| toiletry-basket | 洗漱篮 | 洗漱用品,洗漱包 | toiletry | 30×20×20 | estimated | daily | — | — | sinkShelf, balcony |
| skincare | 护肤品 | 化妆品 | toiletry | 20×12×15 | estimated | daily | — | — | hutch, sinkShelf |
| basin | 盆 | 脸盆,洗衣盆 | toiletry | 40×40×15 | estimated | daily | — | st | balcony |
| bucket | 桶 | 水桶,洗衣桶 | toiletry | 30×30×35 | estimated | weekly | — | — | balcony |
| hangers | 衣架（20 个） | 衣架 | toiletry | 40×5×22 | estimated | weekly | — | — | balcony, wardrobeBottom |
| umbrella | 雨伞 | 伞 | misc | 8×8×60 | estimated | weekly | — | hang（厚 8、长 60） | doorBack, pubEntry |
| backpack | 书包 | 双肩包,背包 | misc | 32×18×45 | estimated | daily | — | hang（厚 18、长 45） | doorBack, pubEntry |
| guitar | 吉他 | 尤克里里 | sport | 40×12×105 | estimated | weekly | — | frag | pubEntry |
| yoga-mat | 瑜伽垫 | — | sport | 12×12×62 | estimated | weekly | — | — | pubEntry, bedFoot |
| parcel | 快递盒 | 纸箱,快递 | trash | 35×25×20 | estimated | rare | — | disp | — |

`makeItem(libId, overrides)` 的约定：

- 未列出的 flags 一律取默认值：`rotatable: true`，其余 false
- `owner` 默认为 `'A'`
- `sizeRange`：来源为 estimated 时设为 size × [0.8, 1.25]；来源为 unknown 时设为 size × [0.5, 2]

## 3. 宿舍规定 `RULES`

**来源**：清华大学学生社区管理服务中心《住宿注意事项》，页面日期 2026-03-18，https://www.tsinghua.edu.cn/xssqglfwzx/info/1043/1175.htm 。以下为转述。

| ruleId | 条款 | 判定 | 关键词 / 条件 |
|---|---|---|---|
| R-HEAT | 第 12 条 | 禁用 | 热得快、电炉、电热毯、电热水器、取暖器、小太阳、暖风机、电暖器 |
| R-COOK | 第 12 条 | 禁用 | 电饭锅、电饭煲、电磁炉、烤箱、电热锅、电煮锅、电饼铛、小火锅 |
| R-POWER | 第 12 条 | 禁用 | `powerW > 1000` |
| R-POWER-UNKNOWN | 第 12 条 | 警告 | `category === 'appliance' && powerW == null`：提示"需确认额定功率 ≤ 1000W" |
| R-CERT | 第 12 条 | 提示 | 电器必须有国家安全认证。无法自动判断，只在电器详情里提示 |
| R-EBIKE | 第 13 条 | 禁用 | 电动车电池、电瓶 |
| R-EXIT | 第 12 条 | 约束 | 不得堵塞疏散通道。对应 aisle / doorSwing / balconyWalk 三个 keepClear 分区 |
| R-FIXED | 第 17 条 | 产品前提 | 不得私自改变设施的位置和功能。所以固定家具不可移动，这也是本产品的出发点 |

`checkRules(item)` 的匹配逻辑：先用 `item.name` 和 `libId` 匹配关键词，再看 `powerW`。返回 `{ banned, ruleId, reason }` 或 `{ banned: false, warn }`。

## 4. 演示预设 `PRESETS`

收集到真实数据后替换。替换后要满足 B2/B3 测试里的断言。

- **`PRESETS.freshman`**：新生清单的文本。示例：
  > 24寸行李箱，28寸行李箱，冬被，夏凉被，枕头，羽绒服，外套3件，衣服3叠，鞋2双，大号收纳箱，27寸显示器，笔记本电脑，台灯，插线板，书20本，洗漱篮，盆，桶，衣架，台式小风扇，吹风机，1500W电热水壶，一个尺寸不确定的收纳箱，吉他

  预期结果：
  - banned ≥ 1：水壶
  - uncertain ≥ 2：未知收纳箱、吹风机功率
  - relocate ≥ 1：28 寸箱或吉他进公共区
  - overflow ≥ 0
- **`PRESETS.messyDesk`**：老生 A 的桌面，包含 items 和 placements，都放在 `A.desk`、`A.hutch`、`A.underDesk`。要求：
  - 力场（75×35，前沿居中）内有 4–6 件冲突物品：零食箱、两摞书、水杯、快递盒、耳机
  - 书架已经占用约 70%，保证至少触发一次"放不下 → 级联"
  - 27 寸显示器靠墙居中，不在力场内
- **`PRESETS.growth`**：4 个 Snapshot：
  1. 大一上 · 入住
  2. 大一下
  3. 大二上 · 满桌
  4. 大二上 · 腾桌后

  同步率依次大约为 72 → 64 → 48 → 86。
