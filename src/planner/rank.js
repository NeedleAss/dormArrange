// 候选分区排序（docs/05 §3）：硬过滤 + 加权代价。复杂度 O(分区数 × 朝向数)。

import { EPS, localExtents, orientations } from './geometry.js';

/** freq → 理想 tier */
export const IDEAL_TIER = Object.freeze({ daily: 0, weekly: 1, monthly: 1, seasonal: 2, rare: 2 });

export const idealTier = (item) => IDEAL_TIER[item.freq] ?? 1;

/** 类别亲和表（docs/05 §3.3） */
export const AFFINITY = Object.freeze({
  luggage: ['underDesk', 'bedFoot', 'pubEntry', 'pubCorner', 'balcony'],
  clothes: ['wardrobeHang', 'wardrobeBottom', 'bedFoot'],
  bedding: ['bed', 'bedFoot', 'wardrobeBottom'],
  books: ['hutch', 'desk', 'underDeskBack'],
  study: ['desk', 'hutch'],
  electronics: ['desk', 'hutch', 'underDeskBack'],
  appliance: ['desk', 'hutch', 'wardrobeBottom'],
  toiletry: ['sinkShelf', 'balcony', 'wardrobeBottom'],
  storage: ['underDesk', 'underDeskBack', 'bedFoot', 'wardrobeBottom', 'pubEntry'],
  food: ['hutch', 'underDesk'],
  sport: ['pubEntry', 'doorBack', 'balcony', 'bedFoot'],
  decor: ['hutch', 'desk', 'bed'],
  misc: ['doorBack', 'underDesk', 'hutch', 'pubEntry'],
  trash: []
});

/** 不看容量、只看尺寸：物品有没有某个朝向能装进空分区 */
export function sizeFits(item, zone, size) {
  if (zone.kind === 'hang') {
    const rodY = zone.rod?.y ?? zone.box.y + zone.box.h;
    return !!item.hang && item.hang.length <= rodY - zone.box.y + EPS;
  }
  const { U, V } = localExtents(zone);
  return orientations(item, zone, size).some((o) => o.a <= U + EPS && o.b <= V + EPS && o.h <= zone.box.h + EPS);
}

/**
 * 硬过滤（docs/05 §3.1），通过返回 true。
 * @param {any} item
 * @param {any} zone
 * @param {{ lockedZones?: string[], skipSize?: boolean }} [ctx]
 */
export function hardOk(item, zone, ctx = {}) {
  if (zone.kind === 'keepClear') return false;
  if (item.owner === 'pub' ? zone.owner !== 'pub' : (zone.owner !== item.owner && zone.owner !== 'pub')) return false;
  if (!(zone.accepts.length === 1 && zone.accepts[0] === '*') && !zone.accepts.includes(item.category)) return false;
  if (ctx.lockedZones?.includes(zone.id)) return false;
  if (zone.kind === 'hang' && !item.flags?.hangable) return false;
  if (!ctx.skipSize && !sizeFits(item, zone)) return false;
  return true;
}

/**
 * 代价（docs/05 §3.2），越小越优先。
 * 规格空缺处的选择：分区在 item.preferred 里时 tierCost 记 0（再加 0.1 × 首选序号保持首选顺序）。
 * 否则按原公式，24 寸箱会因 tier 匹配被侧放到床尾（代价 1.5 < 桌下 3），与 docs/07 §4 / B2 测试的预期相反；
 * "首选"是物品库或用户的明确偏好，应当压过按频率推出的层级。
 */
export function zoneCost(item, zone, fill = 0) {
  const pi = item.preferred ? item.preferred.indexOf(zone.slot) : -1;
  const tierCost = pi >= 0 ? 0 : 3 * Math.abs(idealTier(item) - zone.tier);
  const affCost = pi >= 0 ? 0.1 * pi : (AFFINITY[item.category] ?? []).includes(zone.slot) ? 1.5 : 4;
  const pubCost = zone.owner === 'pub' && item.owner !== 'pub' ? 3 : 0;
  return tierCost + affCost + pubCost + 2 * fill;
}

/**
 * @param {any} item
 * @param {{ zones: any[] }} room
 * @param {{ lockedZones?: string[], fillOf?: (zoneId:string)=>number, zones?: any[], skipSize?: boolean }} [ctx]
 *   zones：覆盖候选分区列表（例如加上 inside 分区）
 * @returns {{ zone:any, cost:number }[]}
 */
export function rankZones(item, room, ctx = {}) {
  const zones = ctx.zones ?? room.zones;
  const out = [];
  for (const z of zones) {
    if (!hardOk(item, z, ctx)) continue;
    out.push({ zone: z, cost: zoneCost(item, z, ctx.fillOf ? ctx.fillOf(z.id) : 0) });
  }
  out.sort((p, q) => p.cost - q.cost || (p.zone.id < q.zone.id ? -1 : p.zone.id > q.zone.id ? 1 : 0));
  return out;
}
