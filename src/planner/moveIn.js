// 第一话 入住：planMoveIn（docs/05 §4）。
// 贪心放置：难放的先放（可行分区少、体积大），每件按 rankZones 的顺序找第一个放得下的分区；
// 放不下且可压缩时按压缩尺寸重试。然后做五分类、尺寸容差 / need 和中文建议。
// 复杂度 O(物品数 × 分区数 × findSpot)。40 件约几十毫秒。

import { buildEngines, commitSpot, compressedItem, zoneFill } from './engines.js';
import { rankZones, idealTier } from './rank.js';
import { LIBRARY_BY_ID } from '../data/itemLibrary.js';
import { checkRules } from './checkRules.js';
import { computeSync } from './sync.js';
import { focusRect, volume, uIsWorldX } from './geometry.js';

const r1 = (v) => Math.round(v * 10) / 10;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 在 ranked 分区里依次找第一个放得下的位置并提交。
 * @returns {{ pl:any, zone:any, spot:any } | null}
 */
export function placeFirstFit(item, ranked, engines, { compressed = false } = {}) {
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
    if (spot) return { pl: commitSpot(eng, item, spot, compressed), zone, spot };
  }
  return null;
}

/** 放下一件：先原尺寸，再压缩尺寸（docs/05 §4.1 ③） */
export function placeWithCompression(item, room, engines, ctx) {
  const fillOf = (id) => engines[id]?.fill() ?? 0;
  const ranked = rankZones(item, room, { ...ctx, fillOf });
  let res = placeFirstFit(item, ranked, engines);
  if (!res) {
    const itC = compressedItem(item);
    if (itC) {
      res = placeFirstFit(itC, rankZones(itC, room, { ...ctx, fillOf }), engines, { compressed: true });
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
    const pool = room.zones.filter((q) => q.kind !== 'keepClear' && engines[q.id] && q.owner === item.owner &&
      (q.accepts.includes('*') || q.accepts.includes(item.category)));
    const pool2 = pool.length ? pool : room.zones.filter((q) => q.kind !== 'keepClear' && engines[q.id] &&
      (q.owner === item.owner || q.owner === 'pub'));
    z = [...pool2].sort((p, q) => vol(q) - vol(p) || byId(p, q))[0];
  }
  if (!z) return undefined;
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
  const ctx = { lockedZones };
  const zoneById = new Map(room.zones.map((z) => [z.id, z]));
  const engines = buildEngines(room, existing, { lockedZones, items });
  const verdicts = {};
  const placements = {};
  const spots = {};
  const warn = {};
  const overflowIds = [];

  // ① 规则检查；可丢弃物品直接判为"换位置：扔掉"
  const sorted = [...items].sort(byId);
  for (const it of sorted) {
    const r = checkRules(it);
    if (r.banned) {
      const sug = [`宿舍禁用：${r.reason}`];
      if (r.ruleId === 'R-POWER') sug.push('换额定功率 ≤ 1000W 的型号');
      verdicts[it.id] = { status: 'banned', zoneId: undefined, reasons: [r.reason], suggestions: sug };
      continue;
    }
    if (r.warn) warn[it.id] = r.warn;
    if (it.category === 'trash' || it.flags?.disposable) {
      verdicts[it.id] = { status: 'relocate', zoneId: undefined, reasons: ['可丢弃物品'], suggestions: ['直接扔掉或拆平'] };
    }
  }

  // 已有 placement 的物品保持原位
  for (const it of sorted) {
    if (!verdicts[it.id] && existing[it.id]) placements[it.id] = structuredClone(existing[it.id]);
  }

  // ② 排序（难放的先放）：可行分区数升序、最长边降序、体积降序、id
  // 规格空缺处的选择：在"可行分区数"与"体积"之间加入最长边。长条的东西更挑位置；
  // 否则大号收纳箱（体积只比 24 寸箱大 0.7%）会先占掉桌下，行李箱被挤到床尾。
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
        reasons: [need ? `所有合适的位置都放不下；${need.text}` : '所有合适的位置都放不下'], suggestions: sug, need };
      continue;
    }
    const z = zoneById.get(p.zoneId);
    const rel = [], relSug = [];
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
  const sync = computeSync(room, items, placements, { owner, decisions: summary.uncertain + summary.relocate });
  return { placements, verdicts, summary, overflowIds, zoneFill: zoneFill(room, items, placements), sync };
}
