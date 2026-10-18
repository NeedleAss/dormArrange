// 宿舍模板生成器：紫荆沿用 docs/07 §1.3；南区按图库估计并保守开放可用空间。
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

// 三组照片没有尺标：绝对尺寸均为估计，不将透视照片当作实测。
// 南区取 1607 的仅窗样本；图库 1610/1614 另有带玻璃门的变体。
// 以约 200cm 床长、75cm 桌高作比例参照，较大的柜体、短桌和储物梯占据更长单元。
/** @type {RoomParams} */
const NANQU_PARAMS = {
  templateId: 'nanqu',
  name: '清华南区 · 四人间（木床储物梯）· 估计值',
  room: { w: 320, d: 660, h: 300 },
  wallT: 10,
  door: { x: 220, w: 85, h: 210 },
  balcony: { enabled: false, d: 140, doorX: 125, doorW: 70 },
  unit: {
    len: 245, depth: 100, startZ: 90,
    wardrobeLen: 75, wardrobeDepth: 65, wardrobeH: 175, rodY: 165,
    deskLen: 110, deskDepth: 55, deskH: 74,
    hutchDepth: 24, hutchY: 126, hutchH: 44,
    bedY: 182, bedThick: 14, bedLen: 205, bedW: 95, bedFootLen: 30, railH: 44,
    underDeskSideLen: 40, underDeskBackDepth: 18, underDeskH: 69,
    chairDepth: 45
  },
  occupants: ['A', 'B', 'C', 'D'],
  sizeSource: 'estimated'
};

// 新装修 1615–1619：狭长房间、窗旁右侧阳台门、白色直梯、L 桌及分格衣柜。
// 桌面靠墙净深 58cm，L 翼外伸到 92cm；由照片比例估计，翼部不增加规划容量。
/** @type {RoomParams} */
const NANQU_NEW_PARAMS = {
  templateId: 'nanqu1',
  name: '清华南区新装修 · 四人间（白梯L形桌）· 估计值',
  room: { w: 310, d: 630, h: 290 },
  wallT: 10,
  door: { x: 215, w: 85, h: 210 },
  balcony: { enabled: true, d: 110, doorX: 155, doorW: 75 },
  unit: {
    len: 220, depth: 92, startZ: 90,
    wardrobeLen: 65, wardrobeDepth: 60, wardrobeH: 174, rodY: 164,
    deskLen: 135, deskDepth: 58, deskH: 75,
    hutchDepth: 23, hutchY: 132, hutchH: 38,
    bedY: 180, bedThick: 12, bedLen: 200, bedW: 90, bedFootLen: 30, railH: 38,
    underDeskSideLen: 40, underDeskBackDepth: 18, underDeskH: 70,
    chairDepth: 45
  },
  occupants: ['A', 'B', 'C', 'D'],
  sizeSource: 'estimated'
};

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

/** 深合并：只覆盖明确传入的校准值，不共享模板的嵌套对象或数组。O(参数字段数)。 */
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
 * 新模板校准先验证净空关系，拒绝会让桌板穿楼梯、分区倒置或出口被占的尺寸。
 * 固定字段数量，复杂度 O(1)；抛错由 C 现有校准表单捕获，不改变原紫荆生成规则。
 * @param {RoomParams} p
 */
function checkTemplateGeometry(p) {
  const r = p.room, u = p.unit, door = p.door, bal = p.balcony;
  const fail = (message) => { throw new RangeError(`宿舍校准无效：${message}`); };
  for (const [group, values] of Object.entries({ room: r, unit: u, door, balcony: bal })) {
    for (const [key, value] of Object.entries(values)) {
      if (key === 'enabled') continue;
      const allowZero = (group === 'door' && key === 'x') || (group === 'unit' && key === 'startZ');
      if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) fail(`${group}.${key} 必须为有效厘米值`);
    }
  }
  if (!(Number.isFinite(p.wallT) && p.wallT > 0)) fail('墙厚必须为正');
  if (r.w < 2 * Math.max(u.depth, u.bedW, u.wardrobeDepth, u.deskDepth + u.chairDepth) + 70) fail('家具侵入70cm中央过道');
  if (u.depth < u.deskDepth || u.underDeskBackDepth >= u.deskDepth || u.hutchDepth > u.deskDepth) fail('桌面、桌后或书架净深不成立');
  const stairDepth = p.templateId === 'nanqu' ? 55 : 10;
  if (u.wardrobeLen + u.deskLen > u.len - stairDepth) fail('桌面不能伸入梯子占地，请增大单元长或缩短桌长');
  if (u.bedLen + 5 > u.len || u.bedFootLen >= u.bedLen || u.bedW <= 45 || u.wardrobeLen < 35) fail('床面超出单元或床尾/正面梯尺寸无效');
  const drawerLen = p.templateId === 'nanqu' ? 30 : 0;
  if (u.deskLen <= u.underDeskSideLen + drawerLen) fail('桌下净长不足以避开抽屉及侧边分区');
  if (u.underDeskH > u.deskH - 3 || u.hutchH <= 2 || u.hutchY <= u.deskH + 2 || u.hutchY + u.hutchH > u.bedY) fail('桌下、书架或床下净高不足');
  if (u.rodY <= 104 || u.rodY > u.wardrobeH || u.wardrobeH > u.bedY) fail('衣柜挂杆或柜体净高无效');
  if (u.bedY + u.bedThick + Math.max(45, u.railH) > r.h || r.h < 250) fail('床上空间或窗高超出房间');
  if (door.x < u.depth || door.x + door.w > r.w || door.w <= 20 || door.w > u.startZ || door.h > r.h) fail('门洞或开门扇区与家具冲突');
  const rearClear = bal.enabled ? Math.max(20, bal.doorW) : 20;
  if (u.startZ <= 0 || u.startZ + 2 * u.len >= r.d - rearClear) fail('单元后方没有足够窗角及出口通路');
  if (bal.enabled && (bal.d <= 72 || bal.doorX < 90 || bal.doorX + bal.doorW > r.w - 70)) fail('阳台门、洗漱台或阳台通道相互侵占');
}

/**
 * 由 RoomParams 生成 Room（docs/07 §1.3）。
 * @param {Partial<RoomParams>} [params]
 * @returns {Room}
 */
export function buildRoom(params = DEFAULT_PARAMS) {
  const baseParams = params.templateId === 'nanqu' ? NANQU_PARAMS :
    params.templateId === 'nanqu1' ? NANQU_NEW_PARAMS : DEFAULT_PARAMS;
  const p = mergeParams(baseParams, params);
  const southern = p.templateId === 'nanqu';
  const modern = p.templateId === 'nanqu1';
  const shapedDesk = southern || modern;
  if (shapedDesk) checkTemplateGeometry(p);
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
    // 新模板的 fixture 是 L 桌外包络；desk 分区只取靠墙连续矩形，凹口和翼部不放物。
    const deskEnvelopeDepth = shapedDesk ? u.depth : u.deskDepth;
    // 南区照片中的抽屉占主桌靠衣柜端 30cm；对应桌下不开放容量。
    const underStart = zd0 + (southern ? 30 : 0);
    // 新装修衣柜靠门半边是层板，只开放另一半挂衣及底部，防止穿过层板。
    const hangStart = modern ? z0 + u.wardrobeLen / 2 : z0;
    // 人类最新确认：紫荆和新装修直梯在朝过道的长边正面，不能放在床的端侧。
    // 梯宽沿 z，厚度沿 x；放在衣柜邻桌端，避开桌面与椅子净空，右侧只镜像 x。
    const frontLadder = p.templateId === 'thu-4p-loft' || modern;
    const ladderBox = frontLadder
      ? box(X(u.bedW - 10, u.bedW), [0, u.bedY], [zd0 - 35, zd0])
      : box(X(u.bedW - (southern ? 45 : 35), u.bedW), [0, u.bedY],
        [z0 + u.len - (southern ? 55 : 10), z0 + u.len]);

    fixtures.push(
      { id: `${o}.wardrobe#fx`, type: 'wardrobe', owner: o, label: `${o} 衣柜`,
        box: box(X(0, u.wardrobeDepth), [0, u.wardrobeH], [z0, z0 + u.wardrobeLen]) },
      { id: `${o}.desk#fx`, type: 'desk', owner: o, label: `${o} 书桌`,
        box: box(X(0, deskEnvelopeDepth), [u.deskH - 3, u.deskH], [zd0, zd1]) },
      { id: `${o}.hutch#fx`, type: 'hutch', owner: o, label: `${o} 书架`,
        box: box(X(0, u.hutchDepth), [u.hutchY - 2, u.hutchY + u.hutchH], [zd0, zd1]) },
      { id: `${o}.loftBed#fx`, type: 'loftBed', owner: o, label: `${o} 床`,
        box: box(X(0, u.bedW), [u.bedY, bedTop], [bz0, bz1]) },
      { id: `${o}.bedRail#fx`, type: 'bedRail', owner: o, label: `${o} 床护栏`,
        box: box(X(u.bedW - 3, u.bedW), [bedTop, bedTop + u.railH], [bz0, bz1]) },
      { id: `${o}.ladder#fx`, type: 'ladder', owner: o, label: `${o} 梯子`,
        box: ladderBox },
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
      box: box(X(0, u.underDeskBackDepth), [0, u.underDeskH], [underStart, zd1 - u.underDeskSideLen]) });
    zone({ ...base, id: `${o}.legSpace`, slot: 'legSpace', label: `${o} 腿部空间`, kind: 'keepClear', tier: 1,
      box: box(X(u.underDeskBackDepth, u.deskDepth), [0, u.underDeskH], [underStart, zd1 - u.underDeskSideLen]) });
    zone({ ...base, id: `${o}.chair`, slot: 'chair', label: `${o} 椅子活动区`, kind: 'keepClear', tier: 1,
      box: box(X(u.deskDepth, u.deskDepth + u.chairDepth), [0, 120], [zd0, zd1 - u.underDeskSideLen]) });
    zone({ ...base, id: `${o}.wardrobeHang`, slot: 'wardrobeHang', label: `${o} 衣柜挂衣区`, kind: 'hang', tier: 1,
      accepts: ZONE_ACCEPTS.wardrobeHang, stackable: false, rod: { axis: 'z', y: u.rodY },
      box: box(X(0, u.wardrobeDepth), [u.rodY - 100, u.rodY], [hangStart, z0 + u.wardrobeLen]) });
    zone({ ...base, id: `${o}.wardrobeBottom`, slot: 'wardrobeBottom', label: `${o} 衣柜底部`, kind: 'floor', tier: 1,
      accepts: ZONE_ACCEPTS.wardrobeBottom, stackable: true,
      box: box(X(0, u.wardrobeDepth), [2, u.rodY - 102], [hangStart, z0 + u.wardrobeLen]) });
    zone({ ...base, id: `${o}.bed`, slot: 'bed', label: `${o} 床面`, kind: 'surface', tier: 0,
      accepts: ZONE_ACCEPTS.bed, stackable: true,
      box: box(X(0, u.bedW), [bedTop, bedTop + 40], [z0 + 5 + u.bedFootLen, bz1]) });
    zone({ ...base, id: `${o}.bedFoot`, slot: 'bedFoot', label: `${o} 床尾`, kind: 'surface', tier: 2,
      accepts: ZONE_ACCEPTS.bedFoot, stackable: true,
      box: box(X(0, u.bedW), [bedTop, bedTop + 45], [bz0, z0 + 5 + u.bedFootLen]) });
  }

  // ── 公共分区 ──
  const door = p.door;
  // 新模板窗下预留 20cm 暖气进深；带偏右阳台门时还预留一门宽的横向通路。
  const cornerEnd = shapedDesk ? D - (bal.enabled ? Math.max(20, bal.doorW) : 20) : D;
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
    accepts: ['*'], stackable: true, box: box([0, u.depth], [0, 120], [u.startZ + 2 * u.len, cornerEnd]) });
  zone({ ...pub, id: 'pub.cornerR', slot: 'pubCorner', label: '窗边右角', kind: 'floor', front: '+z', tier: 1,
    accepts: ['*'], stackable: true, box: box([W - u.depth, W], [0, 120], [u.startZ + 2 * u.len, cornerEnd]) });

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
    if (shapedDesk) {
      // 照片中的室内窗与阳台门并列；现有 opening 类型足以描述，无需扩展 RoomParams。
      openings.push({ id: 'roomWindow', type: 'window',
        box: box([20, bal.doorX - 10], [90, 250], [D, D + T]) });
    }
  } else {
    const windowX = shapedDesk ? [W / 2 - 75, W / 2 + 75] : [20, W - 20];
    openings.push({ id: 'window', type: 'window', box: box(windowX, [90, 250], [D, D + T]) });
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
