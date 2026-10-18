// 数据契约的代码版（docs/04-data-contract.md v1）。
// 本文件只有 JSDoc 类型，没有运行时代码。字段名、取值、单位必须与 docs/04 保持一致。
// 单位一律厘米（cm），世界坐标 Y 轴向上；原点是"站在门口往里看"时房间左前角的地面。

// ───────────────────────── 基础类型（docs/04 §2） ─────────────────────────

/**
 * @typedef {{ w:number, d:number, h:number }} Size3
 * w：沿 x 的宽；d：沿 z 的深；h：沿 y 的高
 */

/**
 * @typedef {{ x:number, y:number, z:number, w:number, d:number, h:number }} Box
 * (x, y, z) 是最小角，(w, d, h) 是三个方向的长度。世界坐标。
 * 中心点 = (x + w/2, y + h/2, z + d/2)
 */

/** @typedef {'A'|'B'|'C'|'D'|'pub'} Owner  'pub' 表示公共，四人共用 */

/**
 * @typedef {'measured'|'product'|'estimated'|'unknown'} SizeSource
 * measured：自己量的；product：商品参数或物品库标准规格；estimated：AI/常识估计；unknown：完全不知道
 */

/**
 * @typedef {'luggage'|'clothes'|'bedding'|'books'|'study'|'electronics'|'appliance'|'toiletry'|'storage'|'food'|'sport'|'decor'|'trash'|'misc'} Category
 */

/** @typedef {'daily'|'weekly'|'monthly'|'seasonal'|'rare'} Freq */

/** @typedef {'+x'|'-x'|'+z'|'-z'} Front 人从哪一侧伸手（'+x' 表示人站在 x 更大的一侧） */

// ───────────────────────── 宿舍（docs/04 §3） ─────────────────────────

/**
 * @typedef {Object} RoomParams buildRoom() 的输入，默认值见 docs/07 §1.1
 * @property {string} templateId
 * @property {string} name
 * @property {Size3} room                 室内净宽、净深、净高
 * @property {number} wallT               墙厚，只用于渲染
 * @property {{ x:number, w:number, h:number }} door
 * @property {{ enabled:boolean, d:number, doorX:number, doorW:number }} balcony
 * @property {{ len:number, depth:number, startZ:number, wardrobeLen:number, wardrobeDepth:number, wardrobeH:number, rodY:number,
 *   deskLen:number, deskDepth:number, deskH:number, hutchDepth:number, hutchY:number, hutchH:number,
 *   bedY:number, bedThick:number, bedLen:number, bedW:number, bedFootLen:number, railH:number,
 *   underDeskSideLen:number, underDeskBackDepth:number, underDeskH:number, chairDepth:number }} unit
 * @property {Owner[]} occupants
 * @property {SizeSource} sizeSource       拿到实测数据后改为 'measured'
 */

/**
 * @typedef {Object} Fixture 固定家具，不可移动
 * @property {string} id                  约定：`${owner}.${type}#fx`
 * @property {'loftBed'|'bedRail'|'desk'|'hutch'|'wardrobe'|'ladder'|'chair'|'sink'|'dryingRod'} type
 * @property {Owner} owner
 * @property {Box} box
 * @property {string} label
 */

/**
 * @typedef {Object} Zone 可以放东西或必须保持空出的空间
 * @property {string} id                  约定：`${owner}.${slot}`，公共分区写作 `pub.${slot}`
 * @property {string} slot
 * @property {string} label
 * @property {Owner} owner
 * @property {'surface'|'shelf'|'floor'|'hang'|'inside'|'keepClear'} kind
 * @property {Box} box                    可用空间：底面就是放置面，h 是可用净高
 * @property {Front} front
 * @property {0|1|2} tier                 0 = 手边；1 = 起身可及；2 = 深层收纳
 * @property {Category[]|['*']} accepts
 * @property {boolean} stackable
 * @property {{ axis:'x'|'z', y:number }} [rod]   仅 kind = 'hang'
 * @property {string} [parentItemId]               仅 kind = 'inside'
 */

/**
 * @typedef {Object} Room buildRoom() 的输出
 * @property {string} id
 * @property {string} name
 * @property {RoomParams} params
 * @property {Box} bounds                 室内 + 阳台的总包围盒
 * @property {{ id:string, box:Box }[]} walls
 * @property {{ id:string, type:'door'|'window'|'balconyDoor', box:Box }[]} openings
 * @property {Fixture[]} fixtures
 * @property {Zone[]} zones
 */

// ───────────────────────── 物品（docs/04 §4） ─────────────────────────

/**
 * @typedef {Object} ItemFlags
 * @property {boolean} stackable          上面能不能再压东西
 * @property {boolean} canBearLoad        能否承重
 * @property {boolean} rotatable          能否绕 Y 轴转 90°（默认 true）
 * @property {boolean} canLieDown         能否放倒（h 与 d 互换）
 * @property {boolean} hangable           能否挂起来
 * @property {boolean} fragile
 * @property {boolean} focusTool          学习工具：允许出现在专注区
 * @property {boolean} disposable         可以直接扔
 * @property {number} [compressible]      压缩后高度比例 0–1
 * @property {Size3} [container]          当作容器时的内部尺寸
 */

/**
 * @typedef {Object} Item 一律表示"一件"（书例外：每 10 本合成一摞）
 * @property {string} id
 * @property {string} name
 * @property {string} [libId]
 * @property {Category} category
 * @property {Size3} size                 默认摆放（立着）时的 w × d × h
 * @property {SizeSource} sizeSource
 * @property {{ min:Size3, max:Size3 }} [sizeRange]
 * @property {Freq} freq
 * @property {number[]} [months]          活跃月份；省略表示全年都用
 * @property {Owner} owner
 * @property {ItemFlags} flags
 * @property {{ thickness:number, length:number }} [hang]
 * @property {number|null} [powerW]       额定功率，null 表示未知
 * @property {string[]} [preferred]       首选 slot
 * @property {number} [growthPerSemester]
 * @property {string} [note]
 * @property {{ status:'blocked'|'review'|'clear', reason:string }} [safety] AI 安全预检；clear不能撤销本地规则，review暂不安排位置
 */

// ───────────────────────── 放置（docs/04 §5） ─────────────────────────

/**
 * @typedef {Object} Placement
 * @property {string} itemId
 * @property {string} zoneId
 * @property {Box} box                    世界坐标；w/d/h 已经是旋转或放倒之后的实际尺寸
 * @property {0|90} rot
 * @property {boolean} lying
 * @property {number} layer               0 = 直接放在分区底面；>0 = 叠在别的物品上
 * @property {boolean} compressed
 */

/** @typedef {Record<string, Placement>} Placements */

// ───────────────────────── 规划结果（docs/04 §6） ─────────────────────────

/**
 * @typedef {Object} Verdict
 * @property {'fits'|'relocate'|'uncertain'|'overflow'|'banned'} status
 * @property {string|undefined} zoneId
 * @property {string[]} reasons
 * @property {string[]} suggestions
 * @property {{ zoneId:string, maxW:number, maxD:number, maxH:number, fitsMax:boolean|null, text:string }} [tolerance]  uncertain 时一定有
 * @property {{ zoneId:string, maxW:number, maxD:number, maxH:number, text:string }} [need]                           overflow 时一定有
 */

/**
 * @typedef {Object} SyncReport
 * @property {number} total               0..100 整数
 * @property {{ fit:number, access:number, focus:number, safety:number }} parts   各 0..1
 * @property {{ time:boolean, space:boolean, mind:boolean }} votes                 三审决议：时 / 空 / 心
 * @property {string[]} notes
 */

/**
 * @typedef {Object} FitReport planMoveIn 的返回值（EP01）
 * @property {Placements} placements
 * @property {Record<string, Verdict>} verdicts
 * @property {{ fits:number, relocate:number, uncertain:number, overflow:number, banned:number, total:number }} summary
 * @property {string[]} overflowIds
 * @property {Record<string, number>} zoneFill
 * @property {SyncReport} sync
 */

/**
 * @typedef {Object} MoveStep EP02 与 EP03 共用
 * @property {number} idx
 * @property {string} itemId
 * @property {string} itemName
 * @property {'move'|'cascade'|'dispose'|'store'|'retrieve'} kind
 * @property {string} fromZoneId
 * @property {string|null} toZoneId      dispose 时为 null
 * @property {Box} from
 * @property {Box|null} to               dispose 时为 null
 * @property {number} distance           两个中心点之间的距离（cm）
 * @property {string} text
 */

/**
 * @typedef {Object} MovePlan planFocusField 的返回值（EP02）
 * @property {string} focusZoneId
 * @property {Box} focusBox
 * @property {string[]} conflicts
 * @property {MoveStep[]} steps
 * @property {{ itemId:string, reason:string, suggestion:string }[]} unresolved
 * @property {Placements} placementsAfter
 * @property {{ moves:number, distanceCm:number, estSeconds:number, clearedArea:number, syncBefore:number, syncAfter:number }} metrics
 * @property {{ id:string, label:string, extraCostYuan:number, plan:MovePlan }[]} [alternatives]
 */

/**
 * @typedef {Object} MonthPlan
 * @property {Placements} placements
 * @property {string[]} active
 * @property {string[]} stored
 * @property {string[]} overflow
 * @property {Record<string, number>} zoneFill
 */

/**
 * @typedef {Object} TdmPlan planSeasons 的返回值（EP03）
 * @property {number[]} months
 * @property {boolean} tdm
 * @property {Record<number, MonthPlan>} byMonth
 * @property {{ zoneIds:string[], months:number[], fill:number[][] }} matrix   fill[分区下标][月份下标]
 * @property {{ on:{ maxFill:number, overflowMonths:number }, off:{ maxFill:number, overflowMonths:number } }} [compare]
 */

/**
 * @typedef {Object} Snapshot EP04 快照
 * @property {string} id
 * @property {string} label
 * @property {string} semester
 * @property {string} createdAt           ISO 字符串
 * @property {RoomParams} roomParams
 * @property {Item[]} items
 * @property {Placements} placements
 * @property {number} sync
 * @property {number} focusMinutes
 * @property {string} [thumb]
 */

/**
 * @typedef {Object} GrowthForecast
 * @property {string[]} semesters
 * @property {Record<string, number[]>} fill
 * @property {{ zoneId:string, semester:string }|null} firstOverflow
 * @property {string} text
 */

// ───────────────────────── 视觉状态（docs/04 §7） ─────────────────────────

/** @typedef {'fits'|'relocate'|'uncertain'|'overflow'|'banned'|'moved'|'conflict'|'stored'} ItemVisualState */
/** @typedef {'empty'|'designing'|'done'} ZoneStatus */

export {};
