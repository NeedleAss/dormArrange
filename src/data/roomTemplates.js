// 宿舍模板生成器：严格按 docs/07 §1.3 的公式由 RoomParams 生成 Room。
// 纯函数：不修改入参，相同输入得到相同输出。

/** @typedef {import('../core/types.js').RoomParams} RoomParams */
/** @typedef {import('../core/types.js').Room} Room */
/** @typedef {import('../core/types.js').Zone} Zone */
/** @typedef {import('../core/types.js').Box} Box */

/** @type {RoomParams} 估计值，拿到实测数据后替换（docs/07 §1.4） */
export const DEFAULT_PARAMS = Object.freeze({
  templateId: 'thu-4p-loft',
  name: '清华紫荆 · 四人间（上床下桌）· 估计值',
  room: { w: 330, d: 560, h: 300 },
  wallT: 10,
  door: { x: 230, w: 90, h: 210 },
  balcony: { enabled: true, d: 140, doorX: 130, doorW: 70 },
  unit: {
    len: 210, depth: 95, startZ: 100,
    wardrobeLen: 70, wardrobeDepth: 60, wardrobeH: 170, rodY: 160,
    deskLen: 130, deskDepth: 60, deskH: 75,
    hutchDepth: 25, hutchY: 130, hutchH: 40,
    bedY: 175, bedThick: 15, bedLen: 200, bedW: 90, bedFootLen: 30, railH: 30,
    underDeskSideLen: 40, underDeskBackDepth: 20, underDeskH: 70,
    chairDepth: 50
  },
  occupants: ['A', 'B', 'C', 'D'],
  sizeSource: 'estimated'
});

/** 单元位置：A、B 在左墙（k = 0, 1），C、D 在右墙（k = 0, 1） */
const UNIT_SLOTS = [
  { owner: 'A', side: 'L', k: 0 },
  { owner: 'B', side: 'L', k: 1 },
  { owner: 'C', side: 'R', k: 0 },
  { owner: 'D', side: 'R', k: 1 }
];

const ZONE_ACCEPTS = {
  desk: ['*'],
  hutch: ['books', 'study', 'electronics', 'decor', 'food', 'toiletry', 'storage', 'misc'],
  underDesk: ['luggage', 'storage', 'food', 'electronics', 'books', 'misc', 'toiletry', 'appliance'],
  underDeskBack: ['storage', 'books', 'electronics', 'misc', 'food'],
  wardrobeHang: ['clothes', 'misc'],
  wardrobeBottom: ['clothes', 'storage', 'toiletry', 'appliance', 'misc', 'sport', 'bedding'],
  bed: ['bedding', 'decor', 'electronics', 'books'],
  bedFoot: ['storage', 'bedding', 'clothes', 'luggage', 'misc', 'books', 'sport']
};

/** 深合并：params 可以只给部分字段（例如 UI 校准时只改了 room.w），其余取默认值 */
function mergeParams(base, over) {
  if (over === undefined) return structuredClone(base);
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || base === null ||
      typeof over !== 'object' || over === null) {
    return structuredClone(over);
  }
  const out = {};
  for (const k of Object.keys(base)) out[k] = mergeParams(base[k], over[k]);
  for (const k of Object.keys(over)) if (!(k in base)) out[k] = structuredClone(over[k]);
  return out;
}

/** 由三个区间组装盒子 */
function box([x0, x1], [y0, y1], [z0, z1]) {
  return { x: x0, y: y0, z: z0, w: x1 - x0, d: z1 - z0, h: y1 - y0 };
}

/**
 * 由 RoomParams 生成 Room（docs/07 §1.3）。
 * @param {Partial<RoomParams>} [params]
 * @returns {Room}
 */
export function buildRoom(params = DEFAULT_PARAMS) {
  const p = mergeParams(DEFAULT_PARAMS, params);
  const W = p.room.w, D = p.room.d, H = p.room.h;
  const u = p.unit;
  const T = p.wallT;
  const bal = p.balcony;
  const Db = bal.enabled ? bal.d : 0;

  const fixtures = [];
  /** @type {Zone[]} */
  const zones = [];

  const zone = (z) => {
    zones.push({
      id: z.id, slot: z.slot, label: z.label, owner: z.owner, kind: z.kind, box: z.box,
      front: z.front, tier: z.tier ?? 1, accepts: z.accepts ?? [], stackable: z.stackable ?? false,
      ...(z.rod ? { rod: z.rod } : {})
    });
  };

  // ── 四套单元 ──
  for (const { owner: o, side, k } of UNIT_SLOTS) {
    if (!p.occupants.includes(o)) continue;
    const z0 = u.startZ + k * u.len;
    const X = side === 'L' ? (a, b) => [a, b] : (a, b) => [W - b, W - a];
    const front = side === 'L' ? '+x' : '-x';
    const zd0 = z0 + u.wardrobeLen;
    const zd1 = zd0 + u.deskLen;
    const bz0 = z0 + 5, bz1 = z0 + 5 + u.bedLen;
    const bedTop = u.bedY + u.bedThick;

    fixtures.push(
      { id: `${o}.wardrobe#fx`, type: 'wardrobe', owner: o, label: `${o} 衣柜`,
        box: box(X(0, u.wardrobeDepth), [0, u.wardrobeH], [z0, z0 + u.wardrobeLen]) },
      { id: `${o}.desk#fx`, type: 'desk', owner: o, label: `${o} 书桌`,
        box: box(X(0, u.deskDepth), [u.deskH - 3, u.deskH], [zd0, zd1]) },
      { id: `${o}.hutch#fx`, type: 'hutch', owner: o, label: `${o} 书架`,
        box: box(X(0, u.hutchDepth), [u.hutchY - 2, u.hutchY + u.hutchH], [zd0, zd1]) },
      { id: `${o}.loftBed#fx`, type: 'loftBed', owner: o, label: `${o} 床`,
        box: box(X(0, u.bedW), [u.bedY, bedTop], [bz0, bz1]) },
      { id: `${o}.bedRail#fx`, type: 'bedRail', owner: o, label: `${o} 床护栏`,
        box: box(X(u.bedW - 3, u.bedW), [bedTop, bedTop + u.railH], [bz0, bz1]) },
      { id: `${o}.ladder#fx`, type: 'ladder', owner: o, label: `${o} 梯子`,
        box: box(X(u.bedW - 35, u.bedW), [0, u.bedY], [z0 + u.len - 10, z0 + u.len]) },
      { id: `${o}.chair#fx`, type: 'chair', owner: o, label: `${o} 椅子`,
        box: box(X(u.deskDepth, u.deskDepth + u.chairDepth), [0, 90], [zd0 + 25, zd0 + 75]) }
    );

    const base = { owner: o, front };
    zone({ ...base, id: `${o}.desk`, slot: 'desk', label: `${o} 书桌桌面`, kind: 'surface', tier: 0,
      accepts: ZONE_ACCEPTS.desk, stackable: true,
      box: box(X(0, u.deskDepth), [u.deskH, u.hutchY - 2], [zd0, zd1]) });
    zone({ ...base, id: `${o}.hutch`, slot: 'hutch', label: `${o} 桌上书架`, kind: 'shelf', tier: 0,
      accepts: ZONE_ACCEPTS.hutch, stackable: true,
      box: box(X(0, u.hutchDepth), [u.hutchY, u.hutchY + u.hutchH - 2], [zd0, zd1]) });
    zone({ ...base, id: `${o}.underDesk`, slot: 'underDesk', label: `${o} 桌下`, kind: 'floor', tier: 1,
      accepts: ZONE_ACCEPTS.underDesk, stackable: true,
      box: box(X(0, u.deskDepth), [0, u.underDeskH], [zd1 - u.underDeskSideLen, zd1]) });
    zone({ ...base, id: `${o}.underDeskBack`, slot: 'underDeskBack', label: `${o} 桌下靠墙`, kind: 'floor', tier: 1,
      accepts: ZONE_ACCEPTS.underDeskBack, stackable: true,
      box: box(X(0, u.underDeskBackDepth), [0, u.underDeskH], [zd0, zd1 - u.underDeskSideLen]) });
    zone({ ...base, id: `${o}.legSpace`, slot: 'legSpace', label: `${o} 腿部空间`, kind: 'keepClear', tier: 1,
      box: box(X(u.underDeskBackDepth, u.deskDepth), [0, u.underDeskH], [zd0, zd1 - u.underDeskSideLen]) });
    zone({ ...base, id: `${o}.chair`, slot: 'chair', label: `${o} 椅子活动区`, kind: 'keepClear', tier: 1,
      box: box(X(u.deskDepth, u.deskDepth + u.chairDepth), [0, 120], [zd0, zd1 - u.underDeskSideLen]) });
    zone({ ...base, id: `${o}.wardrobeHang`, slot: 'wardrobeHang', label: `${o} 衣柜挂衣区`, kind: 'hang', tier: 1,
      accepts: ZONE_ACCEPTS.wardrobeHang, stackable: false, rod: { axis: 'z', y: u.rodY },
      box: box(X(0, u.wardrobeDepth), [u.rodY - 100, u.rodY], [z0, z0 + u.wardrobeLen]) });
    zone({ ...base, id: `${o}.wardrobeBottom`, slot: 'wardrobeBottom', label: `${o} 衣柜底部`, kind: 'floor', tier: 1,
      accepts: ZONE_ACCEPTS.wardrobeBottom, stackable: true,
      box: box(X(0, u.wardrobeDepth), [2, u.rodY - 102], [z0, z0 + u.wardrobeLen]) });
    zone({ ...base, id: `${o}.bed`, slot: 'bed', label: `${o} 床面`, kind: 'surface', tier: 0,
      accepts: ZONE_ACCEPTS.bed, stackable: true,
      box: box(X(0, u.bedW), [bedTop, bedTop + 40], [z0 + 5 + u.bedFootLen, bz1]) });
    zone({ ...base, id: `${o}.bedFoot`, slot: 'bedFoot', label: `${o} 床尾`, kind: 'surface', tier: 2,
      accepts: ZONE_ACCEPTS.bedFoot, stackable: true,
      box: box(X(0, u.bedW), [bedTop, bedTop + 45], [bz0, z0 + 5 + u.bedFootLen]) });
  }

  // ── 公共分区 ──
  const door = p.door;
  const pub = { owner: 'pub' };
  zone({ ...pub, id: 'pub.entryL', slot: 'pubEntry', label: '门口左侧角落', kind: 'floor', front: '+x', tier: 1,
    accepts: ['*'], stackable: true, box: box([0, u.depth], [0, 200], [0, u.startZ]) });
  zone({ ...pub, id: 'pub.doorSwing', slot: 'doorSwing', label: '开门扇区', kind: 'keepClear', front: '+z', tier: 1,
    box: box([door.x, door.x + door.w], [0, door.h], [12, door.w]) });
  // 门后挂钩：人站在屋内（z 更大的一侧）伸手，front 取 '+z'
  zone({ ...pub, id: 'pub.doorBack', slot: 'doorBack', label: '门后挂钩', kind: 'hang', front: '+z', tier: 1,
    accepts: ['misc', 'sport', 'clothes'], stackable: false, rod: { axis: 'x', y: 180 },
    box: box([door.x + 10, door.x + door.w - 10], [90, 180], [0, 10]) });
  zone({ ...pub, id: 'pub.aisle', slot: 'aisle', label: '过道', kind: 'keepClear', front: '+z', tier: 1,
    box: box([W / 2 - 35, W / 2 + 35], [0, 200], [0, D]) });
  zone({ ...pub, id: 'pub.cornerL', slot: 'pubCorner', label: '窗边左角', kind: 'floor', front: '+z', tier: 1,
    accepts: ['*'], stackable: true, box: box([0, u.depth], [0, 120], [u.startZ + 2 * u.len, D]) });
  zone({ ...pub, id: 'pub.cornerR', slot: 'pubCorner', label: '窗边右角', kind: 'floor', front: '+z', tier: 1,
    accepts: ['*'], stackable: true, box: box([W - u.depth, W], [0, 120], [u.startZ + 2 * u.len, D]) });

  if (bal.enabled) {
    zone({ ...pub, id: 'pub.balcony', slot: 'balcony', label: '阳台', kind: 'floor', front: '+x', tier: 1,
      accepts: ['toiletry', 'storage', 'sport', 'luggage', 'misc', 'clothes', 'appliance'], stackable: true,
      box: box([0, 90], [0, 150], [D + 10, D + Db]) });
    zone({ ...pub, id: 'pub.balconyWalk', slot: 'balconyWalk', label: '阳台通道', kind: 'keepClear', front: '+z', tier: 1,
      box: box([bal.doorX, bal.doorX + bal.doorW], [0, 200], [D, D + Db]) });
    zone({ ...pub, id: 'pub.sinkShelf', slot: 'sinkShelf', label: '洗漱台置物架', kind: 'shelf', front: '-z', tier: 1,
      accepts: ['toiletry'], stackable: true, box: box([W - 70, W], [120, 150], [D + Db - 15, D + Db]) });
    fixtures.push(
      { id: 'pub.sink#fx', type: 'sink', owner: 'pub', label: '洗漱台',
        box: box([W - 70, W], [0, 85], [D + Db - 55, D + Db]) },
      { id: 'pub.dryingRod#fx', type: 'dryingRod', owner: 'pub', label: '晾衣杆',
        box: box([10, W - 10], [198, 202], [D + 68, D + 72]) }
    );
  }

  // ── 墙与门窗（只用于渲染） ──
  const zMax = D + Db;
  const walls = [
    { id: 'wall-L', box: box([-T, 0], [0, H], [-T, D]) },
    { id: 'wall-R', box: box([W, W + T], [0, H], [-T, D]) },
    { id: 'wall-F', box: box([-T, W + T], [0, H], [-T, 0]) },
    { id: 'wall-P', box: box([-T, W + T], [0, H], [D, D + T]) }   // 室内与阳台之间的隔墙（无阳台时即后墙）
  ];
  if (bal.enabled) {
    walls.push(
      { id: 'wall-BO', box: box([-T, W + T], [0, H], [zMax, zMax + T]) },
      { id: 'wall-BL', box: box([-T, 0], [0, H], [D + T, zMax]) },
      { id: 'wall-BR', box: box([W, W + T], [0, H], [D + T, zMax]) }
    );
  }
  const openings = [
    { id: 'door', type: 'door', box: box([door.x, door.x + door.w], [0, door.h], [-T, 0]) }
  ];
  if (bal.enabled) {
    openings.push(
      { id: 'balconyDoor', type: 'balconyDoor', box: box([bal.doorX, bal.doorX + bal.doorW], [0, 210], [D, D + T]) },
      { id: 'window', type: 'window', box: box([20, W - 20], [90, 250], [zMax, zMax + T]) }
    );
  } else {
    openings.push({ id: 'window', type: 'window', box: box([20, W - 20], [90, 250], [D, D + T]) });
  }

  return {
    id: p.templateId,
    name: p.name,
    params: p,
    bounds: { x: 0, y: 0, z: 0, w: W, d: zMax, h: H },
    walls,
    openings,
    fixtures,
    zones
  };
}
