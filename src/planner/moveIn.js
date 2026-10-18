// 第一话 入住：planMoveIn（docs/05 §4）。
// 贪心放置：难放的先放（可行分区少、体积大），每件按 rankZones 的顺序找第一个放得下的分区；
// 放不下且可压缩时按压缩尺寸重试。然后做五分类、尺寸容差 / need 和中文建议。
// 复杂度 O(物品数 × 分区数 × findSpot)。40 件约几十毫秒。

import { buildEngines, commitSpot, compressedItem, zoneFill } from './engines.js';
import { rankZones, idealTier, hardOk } from './rank.js';
import { placementViolation, lockedPlacementZone } from './placementPolicy.js';
import { LIBRARY_BY_ID } from '../data/itemLibrary.js';
import { checkRules } from './checkRules.js';
import { computeSync } from './sync.js';
import { focusRect, volume, uIsWorldX, toWorld, contains, intersects, overlapArea2D } from './geometry.js';
import { insideZoneFor } from './inside.js';

const r1 = (v) => Math.round(v * 10) / 10;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const restsOnBox = (top, bottom) => Math.abs(top.y - bottom.y - bottom.h) < 0.05 && overlapArea2D(top, bottom) > 0.01;

/**
 * 在 ranked 分区里依次找第一个放得下的位置并提交。
 * @returns {{ pl:any, zone:any, spot:any } | null}
 */
export function placeFirstFit(item, ranked, engines, { compressed = false, room, placements, items, lockedZones = [], invalidSupports = [] } = {}) {
  for (const { zone } of ranked) {
    const eng = engines[zone.id];
    if (!eng) continue;
    if (compressed && eng.kind === 'rail') continue;
    let spot;
    if (eng.kind === 'rail') spot = eng.findSpot(item);
    else {
      const mode = item.flags?.focusTool ? 'reach' : 'store';
      // EP01 把桌面默认专注区作为 penaltyRect，新生的初始布局自动留出学习区（与 EP02 呼应）
      const penaltyRect = zone.slot === 'desk' && !item.flags?.focusTool ? focusRect(zone).rect : null;
      spot = eng.findSpot(item, { mode, penaltyRect });
    }
    if (spot) {
      const candidate = { zoneId: zone.id, box: eng.kind === 'rail' ? eng.boxFor(spot) : toWorld(zone, spot, spot.base, spot.h) };
      if (room && (placementViolation(room, item, candidate, placements, items) ||
          lockedPlacementZone(candidate, placements ?? {}, room, lockedZones))) continue;
      if (invalidSupports.some((p) => restsOnBox(candidate.box, p.box))) continue;
      return { pl: commitSpot(eng, item, spot, compressed), zone, spot };
    }
  }
  return null;
}

/** 放下一件：先原尺寸，再压缩尺寸（docs/05 §4.1 ③） */
export function placeWithCompression(item, room, engines, ctx) {
  const fillOf = (id) => engines[id]?.fill() ?? 0;
  const ranked = rankZones(item, room, { ...ctx, fillOf });
  const policy = { room, placements: ctx.placements ?? {}, items: ctx.items ?? [], lockedZones: ctx.lockedZones ?? [], invalidSupports: ctx.invalidSupports ?? [] };
  let res = placeFirstFit(item, ranked, engines, policy);
  if (!res) {
    const itC = compressedItem(item);
    if (itC) {
      res = placeFirstFit(itC, rankZones(itC, room, { ...ctx, fillOf }), engines, { ...policy, compressed: true });
      if (res) res.item = itC;
    }
  }
  return res;
}

/**
 * 尺寸容差（docs/05 §4.4）：把物品从引擎中移除后，以落点为中心向外膨胀。
 * 三个上限分别计算，每个都假设其余两维不变。
 */
function computeTolerance(item, zone, spot, engine) {
  const eng = engine.clone();
  eng.removeItem(item.id);
  const rng = item.sizeRange?.max;
  if (eng.kind === 'rail') {
    const maxT = r1(eng.freeLength());
    const maxL = r1(eng.maxLen);
    const k = rng && item.size.w > 0 ? rng.w / item.size.w : null;
    const fitsMax = k == null || !item.hang ? null : item.hang.thickness * k <= maxT + 0.01 && item.hang.length * k <= maxL + 0.01;
    const depth = r1(Math.min(eng.axis === 'x' ? zone.box.d : zone.box.w, 50));
    return { zoneId: zone.id, maxW: maxT, maxD: depth, maxH: maxL, fitsMax,
      text: `下单前确认：厚 ≤ ${maxT}、长 ≤ ${maxL} cm（约）就能挂进「${zone.label}」` +
        (fitsMax === false ? '（按最大估计会超出，建议实测）' : '') };
  }
  const { maxA, maxB } = eng.expandFrom(spot);
  const dims = { w: item.size.w, d: item.size.d, h: item.size.h };
  dims[spot.ka ?? (uIsWorldX(zone) ? 'w' : 'd')] = maxA;
  dims[spot.kb ?? (uIsWorldX(zone) ? 'd' : 'w')] = maxB;
  dims[spot.kh ?? 'h'] = zone.box.h - spot.base;
  const maxW = r1(dims.w), maxD = r1(dims.d), maxH = r1(dims.h);
  let fitsMax = null;
  if (rng) {
    const ok = (w, d) => w <= maxW + 0.01 && d <= maxD + 0.01 && rng.h <= maxH + 0.01;
    fitsMax = ok(rng.w, rng.d) || (item.flags?.rotatable !== false && ok(rng.d, rng.w));
  }
  return { zoneId: zone.id, maxW, maxD, maxH, fitsMax,
    text: `下单前确认：宽 ≤ ${maxW}、深 ≤ ${maxD}、高 ≤ ${maxH} cm（约）就能放进「${zone.label}」` +
      (fitsMax === false ? '（按最大估计会超出，建议实测）' : '') };
}

/** 放不下时的 need（docs/05 §4.5）：代价最小的候选分区里的最大空矩形 */
function computeNeed(item, room, engines, ctx) {
  const fillOf = (id) => engines[id]?.fill() ?? 0;
  let z = rankZones(item, room, { ...ctx, fillOf })[0]?.zone;
  if (!z) {
    // 连硬过滤都没有分区能过：取同 owner、accepts 包含该类别的最大分区
    const vol = (q) => q.box.w * q.box.d * q.box.h;
    const pool = room.zones.filter((q) => engines[q.id] && hardOk(item, q, { ...ctx, skipSize: true }) &&
      !placementViolation(room, item, { zoneId: q.id, box: q.box }, ctx.placements, ctx.items));
    z = [...pool].sort((p, q) => vol(q) - vol(p) || byId(p, q))[0];
  }
  if (!z) return { zoneId: '', maxW: 0, maxD: 0, maxH: 0, text: '没有可用的合法床外分区；床面和床尾不能作为普通收纳兜底' };
  const { a, b } = engines[z.id].maxEmptyRect();
  const maxW = r1(a), maxD = r1(b), maxH = r1(z.box.h);
  return { zoneId: z.id, maxW, maxD, maxH, text: `「${z.label}」目前最大空位约 ${maxW}×${maxD}×${maxH} cm` };
}

/** 物品尺寸就是物品库的默认估计值（w、d 相同，h 不超过库值；书的最后一摞会按余数缩高） */
function isLibDefaultSize(it) {
  const lib = it.libId ? LIBRARY_BY_ID[it.libId] : null;
  if (!lib || lib.sizeSource !== 'estimated') return false;
  return it.size.w === lib.size.w && it.size.d === lib.size.d && it.size.h <= lib.size.h;
}

/**
 * @param {import('../core/types.js').Room} room
 * @param {import('../core/types.js').Item[]} items
 * @param {{ owner?: string, lockedZones?: string[], existing?: Record<string, any> }} [opts]
 * @returns {import('../core/types.js').FitReport}
 */
export function planMoveIn(room, items, opts = {}) {
  const owner = opts.owner ?? 'A';
  const lockedZones = opts.lockedZones ?? [];
  const existing = opts.existing ?? {};
  const zoneById = new Map(room.zones.map((z) => [z.id, z]));
  const verdicts = {};
  const placements = {};
  const ctx = { lockedZones, placements, items };
  const byItem = new Map(items.map((it) => [it.id, it]));
  // 恢复换季快照时重建已有容器的内部净空，合法的箱内位置无需被搬动。
  const extraZones = [];
  for (const it of items) {
    const p = existing[it.id];
    if (!p || !it.flags?.container || zoneById.has(`${it.id}.inside`)) continue;
    const z = insideZoneFor(it, p, zoneById.get(p.zoneId));
    extraZones.push(z); zoneById.set(z.id, z);
  }
  const roomPlus = extraZones.length ? { ...room, zones: [...room.zones, ...extraZones] } : room;
  const invalidExisting = new Map();
  const legalExisting = {};
  const clears = room.zones.filter((z) => z.kind === 'keepClear');
  // 旧快照只保留合法位置；违规床位重新规划，不能因 existing 绕过新规则。
  for (const [id, old] of Object.entries(existing)) {
    const it = byItem.get(id);
    let reason = placementViolation(roomPlus, it, old, existing, items);
    const zone = zoneById.get(old.zoneId);
    if (it && !reason && (!zone || !hardOk(it, zone, { skipSize: true }) || !contains(zone.box, old.box) ||
        clears.some((z) => intersects(z.box, old.box)))) reason = '原有位置不符合分区、归属、尺寸或通道约束，需重新规划';
    if (reason && !it) throw new RangeError(`已有位置 ${id} 不合法但缺少物品信息：${reason}；请传入完整物品清单`);
    if (reason) invalidExisting.set(id, reason);
    // 禁物继续作为现实障碍保留给引擎，不会在返回值中被当作合法安置。
    if (!reason || (it && checkRules(it).banned)) legalExisting[id] = old;
  }
  // 安全拦截的容器/支撑物不可自动操作；其内及上层物品也不能继承悬空位置。
  // 沿依赖闭包传播，最坏 O(物品数³)，清单规模下优先保证安全与确定性。
  const blockedSupports = new Set(items.filter((it) => existing[it.id] && checkRules(it).banned).map((it) => it.id));
  const unsafeDependents = new Set();
  for (const id of blockedSupports) {
    for (const it of items) {
      const p = existing[it.id];
      if (!p || blockedSupports.has(it.id)) continue;
      const zone = zoneById.get(p.zoneId);
      const parentId = zone?.parentItemId ?? (p.zoneId.endsWith('.inside') ? p.zoneId.slice(0, -7) : null);
      if (parentId !== id && !restsOnBox(p.box, existing[id].box)) continue;
      blockedSupports.add(it.id); unsafeDependents.add(it.id);
      invalidExisting.set(it.id, '原容器或支撑物已被安全拦截，不能自动操作或沿用其内部位置');
      legalExisting[it.id] = p;
    }
  }
  // 违规容器/支撑物重排时，其上层床品也必须重放，不能保留在旧箱顶而悬空。
  for (const [id] of invalidExisting) {
    for (const it of items) {
      const p = existing[it.id];
      if (!p || invalidExisting.has(it.id) || !restsOnBox(p.box, existing[id].box)) continue;
      invalidExisting.set(it.id, '原支撑物需要移到床外，上层物品须重新放置以免悬空');
      delete legalExisting[it.id];
    }
  }
  ctx.invalidSupports = [...invalidExisting.keys()].map((id) => existing[id]);
  ctx.invalidSupports.push(...items.filter((it) => existing[it.id] && checkRules(it).banned).map((it) => existing[it.id]));
  const engines = buildEngines(roomPlus, legalExisting, { lockedZones, items });
  const spots = {};
  const warn = {};
  const overflowIds = [];

  // ① 规则检查；可丢弃物品直接判为"换位置：扔掉"
  const sorted = [...items].sort(byId);
  for (const it of sorted) {
    const r = checkRules(it);
    if (r.banned) {
      const riskReview = r.ruleId === 'R-SAFETY-REVIEW';
      const safetyRule = /^(R-FIRE|R-FUEL|R-EXPLOSIVE|R-HAZMAT|R-WEAPON|R-AI-SAFETY)$/.test(r.ruleId);
      const sug = [`${riskReview ? '安全待核实' : safetyRule ? '安全拦截' : '宿舍禁用'}：${r.reason}`];
      if (riskReview || safetyRule) sug.push('核实前不带入宿舍；向宿管确认安全要求，不在宿舍自行处置危险物');
      if (r.ruleId === 'R-POWER') sug.push('换额定功率 ≤ 1000W 的型号');
      verdicts[it.id] = { status: 'banned', zoneId: undefined, reasons: [r.reason], suggestions: sug };
      continue;
    }
    if (r.warn) warn[it.id] = r.warn;
    if (unsafeDependents.has(it.id)) {
      verdicts[it.id] = { status: 'overflow', zoneId: undefined,
        reasons: [invalidExisting.get(it.id), '须先由人工确认危险物及其关联物品的安全处置'],
        suggestions: ['保留物品记录；核实安全前不自动搬动危险容器、其内物品或支撑链'],
        need: computeNeed(it, room, engines, ctx) };
      overflowIds.push(it.id);
      continue;
    }
    if (invalidExisting.has(it.id) && lockedPlacementZone(existing[it.id], existing, roomPlus, lockedZones)) {
      verdicts[it.id] = { status: 'overflow', zoneId: undefined,
        reasons: [invalidExisting.get(it.id), '原位置所在分区已锁定，不能自动挪动或解锁'],
        suggestions: ['先手动移除违规床上物品或解锁该分区，再用现有位置重新规划'],
        need: computeNeed(it, room, engines, ctx) };
      overflowIds.push(it.id);
      continue;
    }
    if (it.category === 'trash' || it.flags?.disposable) {
      // 已在 existing 里的（例如锁定分区里的快递盒）保留原位，只给扔掉的建议
      if (!invalidExisting.has(it.id)) verdicts[it.id] = { status: 'relocate', zoneId: existing[it.id]?.zoneId, reasons: ['可丢弃物品'], suggestions: ['直接扔掉或拆平'] };
    }
  }

  // 已有 placement 的物品保持原位（可丢弃物品也一样，是否扔掉由用户决定）
  for (const it of sorted) {
    if (!existing[it.id] || invalidExisting.has(it.id)) continue;
    if (!verdicts[it.id] || verdicts[it.id].status === 'relocate') placements[it.id] = structuredClone(existing[it.id]);
  }

  // ② 排序（难放的先放）：可行分区数升序、最长边降序、体积降序、id
  // 规格空缺处的选择：在"可行分区数"与"体积"之间加入最长边。长条的东西更挑位置；
  // 否则大号收纳箱（体积只比 24 寸箱大 0.7%）会先占掉桌下，行李箱只能转移到公共区。
  const cands = sorted.filter((it) => !verdicts[it.id] && !placements[it.id]);
  const nFeasible = Object.fromEntries(cands.map((it) => [it.id, rankZones(it, room, ctx).length]));
  const maxEdge = (it) => Math.max(it.size.w, it.size.d, it.size.h);
  const order = [...cands].sort((a, b) =>
    nFeasible[a.id] - nFeasible[b.id] || maxEdge(b) - maxEdge(a) || volume(b.size) - volume(a.size) || byId(a, b));

  // ③ 放置
  for (const it of order) {
    const res = placeWithCompression(it, room, engines, ctx);
    if (res) { placements[it.id] = res.pl; spots[it.id] = { zone: res.zone, spot: res.spot }; }
    else overflowIds.push(it.id);
  }

  // ④ 五分类 ⑤ 容差与 need ⑥ 文案
  for (const it of sorted) {
    if (verdicts[it.id]) continue;
    const p = placements[it.id];
    if (!p) {
      const need = computeNeed(it, room, engines, ctx);
      const sug = [];
      if (it.category === 'luggage') {
        sug.push(`换小一号：${need?.text ?? '目前没有合适的空位'}`, '改用可折叠搬家袋，用完压扁', '开学后带回家，或寄存');
      } else if (it.flags?.compressible) {
        sug.push('真空压缩袋（体积约减到 35–50%）', '按季节轮换：见第三话「换季」');
      } else {
        sug.push(`换小尺寸：${need?.text ?? '目前没有合适的空位'}`, '放公共区需与室友协商', '考虑不带');
      }
      verdicts[it.id] = { status: 'overflow', zoneId: undefined,
        reasons: [...(invalidExisting.has(it.id) ? [invalidExisting.get(it.id)] : []),
          need ? `所有合适的位置都放不下；${need.text}` : '所有合适的位置都放不下'], suggestions: sug, need };
      continue;
    }
    const z = zoneById.get(p.zoneId);
    const rel = [], relSug = [];
    if (invalidExisting.has(it.id)) {
      rel.push(`已修复旧位置：${invalidExisting.get(it.id)}`);
      relSug.push(`改放到合法分区「${z.label}」，保留其他合法位置`);
    }
    if (z.owner === 'pub' && it.owner !== 'pub') {
      rel.push(`只能放在公共区「${z.label}」，需要和室友商量`);
      relSug.push('和室友约定公共区的使用规则');
    }
    if (it.preferred?.length && !it.preferred.includes(z.slot)) rel.push(`首选位置放不下，改放「${z.label}」`);
    // 首选位置本身就是物品库/用户的明确选择（如冬被放床面），不再提示层级不符
    if (Math.abs(idealTier(it) - z.tier) >= 2 && !it.preferred?.includes(z.slot)) {
      rel.push('使用频率和位置不匹配（常用的东西放得太深，或者反过来）');
      relSug.push('和不常用的东西交换位置');
    }
    if (p.compressed) { rel.push('需要真空压缩后才放得下'); relSug.push('准备一个真空压缩袋'); }

    // 规格空缺处的选择：unknown 与功率未知一律 uncertain；estimated 只在"不是物品库默认规格"时 uncertain
    // （AI/用户估计的尺寸）。物品库里大多数条目都标 estimated，若照 §4.3 字面全判 uncertain，
    // 新生清单会有近 20 件黄色、失去提示意义；docs/07 §4 的预期也只有"未知收纳箱、吹风机功率"两件。
    const src = it.sizeSource;
    const sizeUnsure = src === 'unknown' || (src === 'estimated' && !isLibDefaultSize(it));
    let tolerance;
    if (sizeUnsure || warn[it.id]) {
      const sp = spots[it.id];
      if (sp) tolerance = computeTolerance(it, sp.zone, sp.spot, engines[sp.zone.id]);
    }
    if (tolerance) {
      const reasons = [...rel];
      if (src === 'unknown') reasons.push('尺寸未知');
      else if (sizeUnsure) reasons.push('尺寸是估计值');
      if (warn[it.id]) reasons.push(warn[it.id]);
      const sug = [tolerance.text];
      if (warn[it.id]) sug.push('确认额定功率 ≤ 1000W，选购额定功率 ≤ 1000W 的型号');
      verdicts[it.id] = { status: 'uncertain', zoneId: p.zoneId, reasons, suggestions: sug, tolerance };
    } else if (rel.length) {
      verdicts[it.id] = { status: 'relocate', zoneId: p.zoneId, reasons: rel,
        suggestions: relSug.length ? relSug : [`按建议放到「${z.label}」`] };
    } else {
      verdicts[it.id] = { status: 'fits', zoneId: p.zoneId, reasons: [], suggestions: [] };
    }
  }

  // ⑦ summary、zoneFill、sync
  const summary = { fits: 0, relocate: 0, uncertain: 0, overflow: 0, banned: 0, total: items.length };
  for (const it of items) summary[verdicts[it.id].status]++;
  // 滞留区顺序：先放不下的（按放置顺序），再是禁用的、可丢弃的（按 id）
  for (const it of sorted) if (verdicts[it.id].status === 'banned') overflowIds.push(it.id);
  for (const it of sorted) if (!placements[it.id] && verdicts[it.id].status === 'relocate') overflowIds.push(it.id);
  const sync = computeSync(roomPlus, items, placements, { owner, decisions: summary.uncertain + summary.relocate });
  return { placements, verdicts, summary, overflowIds, zoneFill: zoneFill(roomPlus, items, placements), sync };
}
