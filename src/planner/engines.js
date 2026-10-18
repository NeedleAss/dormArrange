// 为整间宿舍建引擎集合（docs/05 §2.3），并提供放置相关的公共小工具。

import { Heightmap } from './heightmap.js';
import { HangRail } from './hang.js';
import { EPS } from './geometry.js';

/** @typedef {import('../core/types.js').Room} Room */
/** @typedef {import('../core/types.js').Zone} Zone */
/** @typedef {import('../core/types.js').Item} Item */
/** @typedef {import('../core/types.js').Placement} Placement */

/** 把 items（数组或 Record）统一成 Record<id, Item> */
export function itemMap(items) {
  if (!items) return {};
  if (Array.isArray(items)) return Object.fromEntries(items.map((it) => [it.id, it]));
  return items;
}

/** 为单个分区建引擎；keepClear 返回 null */
export function engineFor(zone, keepClears) {
  if (zone.kind === 'keepClear') return null;
  if (zone.kind === 'hang') return new HangRail(zone);
  return new Heightmap(zone, keepClears);
}

/**
 * @param {Room} room
 * @param {Record<string, Placement>} [placements]   已有的物品，填进对应分区
 * @param {{ lockedZones?: string[], items?: Item[]|Record<string, Item>, extraZones?: Zone[] }} [opts]
 *   items：用于知道已有物品能否承重；extraZones：inside 等动态分区
 * @returns {Record<string, Heightmap|HangRail>}
 */
export function buildEngines(room, placements = {}, opts = {}) {
  const zones = [...room.zones, ...(opts.extraZones ?? [])];
  const kcs = zones.filter((z) => z.kind === 'keepClear');
  /** @type {Record<string, any>} */
  const engines = {};
  for (const z of zones) {
    const e = engineFor(z, kcs);
    if (e) engines[z.id] = e;
  }
  const byId = itemMap(opts.items);
  const ps = Object.values(placements)
    .filter((p) => engines[p.zoneId])
    .sort((p, q) => (p.layer ?? 0) - (q.layer ?? 0) || (p.box.y - q.box.y) || (p.itemId < q.itemId ? -1 : p.itemId > q.itemId ? 1 : 0));
  for (const p of ps) engines[p.zoneId].commitFromWorld(byId[p.itemId], p);
  for (const id of opts.lockedZones ?? []) if (engines[id]) engines[id].locked = true;
  return engines;
}

/** 克隆整个引擎集合 */
export function cloneEngines(engines) {
  const out = {};
  for (const k of Object.keys(engines)) out[k] = engines[k].clone();
  return out;
}

/**
 * 在分区里提交一个落点，生成 Placement。
 * @param {any} engine  Heightmap 或 HangRail
 * @param {Item} item
 * @param {any} spot    engine.findSpot 的结果
 * @param {boolean} [compressed]
 * @returns {Placement}
 */
export function commitSpot(engine, item, spot, compressed = false) {
  const zone = engine.zone;
  const pl = { itemId: item.id, zoneId: zone.id, box: null, rot: 0, lying: false, layer: 0, compressed };
  const res = engine.commit(item, spot, pl);
  pl.box = roundBox(res.box);
  pl.layer = res.layer;
  if (engine.kind === 'grid') {
    pl.lying = !!spot.lying;
    pl.rot = Math.abs(pl.box.w - item.size.w) <= EPS ? 0 : 90;
  }
  return pl;
}

/** 消除浮点尾巴（0.1 + 0.2 之类），保证 JSON 稳定可读 */
export function roundBox(b) {
  const r = (v) => Math.round(v * 1000) / 1000;
  return { x: r(b.x), y: r(b.y), z: r(b.z), w: r(b.w), d: r(b.d), h: r(b.h) };
}

/**
 * 压缩后的物品：高度乘以 compressible；真空压缩袋压成扁平的一块，可以侧立（canLieDown = true）。
 * 不可压缩时返回 null。
 */
export function compressedItem(item) {
  const cs = compressedSize(item);
  return cs ? { ...item, size: cs, flags: { ...item.flags, canLieDown: true } } : null;
}

/** 压缩后的尺寸：高度乘以 compressible */
export function compressedSize(item) {
  const k = item.flags?.compressible;
  if (!k) return null;
  return { ...item.size, h: Math.round(item.size.h * k * 10) / 10 };
}

/**
 * 各分区占用率 0..1（挂杆按长度，其余按体积）。只统计 room.zones 中可放置的分区。
 * @param {Room} room
 * @param {Item[]} items
 * @param {Record<string, Placement>} placements
 */
export function zoneFill(room, items, placements) {
  const out = {};
  const zs = room.zones.filter((z) => z.kind !== 'keepClear');
  const used = {};
  for (const p of Object.values(placements)) {
    const z = zs.find((zz) => zz.id === p.zoneId);
    if (!z) continue;
    let v;
    if (z.kind === 'hang') v = (z.rod?.axis ?? 'x') === 'x' ? p.box.w : p.box.d;
    else v = p.box.w * p.box.d * p.box.h;
    used[z.id] = (used[z.id] ?? 0) + v;
  }
  for (const z of zs) {
    const cap = z.kind === 'hang' ? ((z.rod?.axis ?? 'x') === 'x' ? z.box.w : z.box.d) : z.box.w * z.box.d * z.box.h;
    const f = cap > 0 ? Math.min(1, (used[z.id] ?? 0) / cap) : 0;
    out[z.id] = Math.round(f * 1000) / 1000;
  }
  return out;
}
