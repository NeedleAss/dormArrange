// 同步率与三审决议（docs/05 §7）。复杂度 O(物品数 × keepClear 数)。

import { intersects, overlapArea2D, focusRect, intersection } from './geometry.js';
import { checkRules } from './checkRules.js';
import { idealTier } from './rank.js';
import { placementViolation } from './placementPolicy.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * @param {import('../core/types.js').Room} room
 * @param {import('../core/types.js').Item[]} items
 * @param {Record<string, import('../core/types.js').Placement>} placements
 * @param {{ owner?: string, focusBox?: any, moves?: number, decisions?: number, swaps?: number, extraZones?: any[] }} [ctx]
 * @returns {import('../core/types.js').SyncReport}
 */
export function computeSync(room, items, placements, ctx = {}) {
  const owner = ctx.owner ?? 'A';
  const zoneById = new Map([...room.zones, ...(ctx.extraZones ?? [])].map((z) => [z.id, z]));
  const rulesById = new Map(items.map((it) => [it.id, checkRules(it)]));
  const placedBanned = items.filter((it) => placements[it.id] && rulesById.get(it.id).banned)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const bedViolations = items.filter((it) => placements[it.id] && placementViolation(room, it, placements[it.id], placements, items));
  const considered = items.filter((it) => !rulesById.get(it.id).banned && !it.flags?.disposable && it.category !== 'trash');
  const placed = considered.filter((it) => placements[it.id]);
  const unplaced = considered.length - placed.length;
  const fit = considered.length ? placed.length / considered.length : 1;

  // access：已放下物品"频率与层级匹配度"的平均。inside 分区（行李箱内部）按 tier 2 计
  let accSum = 0, accN = 0;
  for (const it of placed) {
    const p = placements[it.id];
    const z = zoneById.get(p.zoneId);
    const tier = z ? z.tier : p.zoneId.endsWith('.inside') ? 2 : null;
    if (tier == null) continue;
    // 与 rank.js 一致：放在首选 slot 视为完全顺手
    accSum += z && it.preferred?.includes(z.slot) ? 1 : clamp01(1 - Math.abs(idealTier(it) - tier) / 2);
    accN++;
  }
  const access = accN ? clamp01(accSum / accN) : 1;

  // focus：专注区里非 focusTool 物品的覆盖面积占比
  let focusBox = ctx.focusBox;
  if (!focusBox) {
    const desk = zoneById.get(`${owner}.desk`);
    focusBox = desk ? focusRect(desk).box : null;
  }
  let focus = 1, inFocus = 0;
  if (focusBox && focusBox.w * focusBox.d > 0) {
    let cover = 0;
    for (const it of items) {
      const p = placements[it.id];
      if (!p || it.flags?.focusTool) continue;
      if (!intersection(p.box, focusBox)) continue;
      const a = overlapArea2D(p.box, focusBox);
      if (a > 1) { cover += a; inFocus++; }
    }
    focus = clamp01(1 - cover / (focusBox.w * focusBox.d));
  }

  // safety：禁物已经放进宿舍时直接否决；未安排禁物不扣分，保留正确拒绝后的原有评分。
  const kcs = room.zones.filter((z) => z.kind === 'keepClear');
  let blocking = 0;
  for (const p of Object.values(placements)) if (kcs.some((k) => intersects(k.box, p.box))) blocking++;
  const safety = placedBanned.length || bedViolations.length ? 0 : blocking === 0 ? 1 : Math.max(0, 1 - 0.5 * blocking);

  const total = Math.max(0, Math.min(100, Math.round(100 * (0.35 * fit + 0.25 * access + 0.25 * focus + 0.15 * safety))));
  const moves = ctx.moves ?? 0, decisions = ctx.decisions ?? 0, swaps = ctx.swaps ?? 0;
  const votes = {
    time: moves <= 5 && decisions <= 6 && swaps <= 8,
    space: fit >= 0.9 && safety === 1,
    mind: focus >= 0.9 && access >= 0.7
  };
  const notes = [];
  if (!votes.space) {
    if (unplaced > 0 && fit < 0.9) notes.push(`空：还有 ${unplaced} 件东西放不下`);
    if (blocking > 0) notes.push(`空：有 ${blocking} 件东西堵住了通道或活动区`);
    for (const it of placedBanned) notes.push(`空：「${it.name}」已放入宿舍但未通过安全检查：${rulesById.get(it.id).reason ?? '请联系宿管确认并安全移出宿舍'}`);
    for (const it of bedViolations) notes.push(`空：「${it.name}」位置不合法：${placementViolation(room, it, placements[it.id], placements, items)}`);
  }
  if (!votes.mind) {
    if (focus < 0.9) notes.push(`心：专注区里还有 ${inFocus} 件东西`);
    if (access < 0.7) notes.push(`心：常用的东西放得不顺手（顺手度 ${Math.round(access * 100)}%）`);
  }
  if (!votes.time) {
    if (moves > 5) notes.push(`时：需要挪 ${moves} 次，超过 5 步`);
    if (decisions > 6) notes.push(`时：还有 ${decisions} 件东西要你拿主意，超过 6 件`);
    if (swaps > 8) notes.push(`时：一年要换季搬动 ${swaps} 次，超过 8 次`);
  }
  return { total, parts: { fit: r3(fit), access: r3(access), focus: r3(focus), safety: r3(safety) }, votes, notes };
}
