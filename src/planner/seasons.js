// 第三话 换季：时分复用 planSeasons + 换季步骤 diffMonths（docs/05 §6）。
// 思路：非季节物品（锚点）全年不动；季节物品按月分"在用 / 收起"，收起的进行李箱内部或深层分区，
// 每件优先放回上个月的位置，保证只有换季那个月才有动作。
// 复杂度 O(月数 × 季节物品数 × 分区数 × findSpot)；compare 时再跑一遍 tdm 关闭的版本。

import { buildEngines, cloneEngines, commitSpot, compressedItem, zoneFill, itemMap } from './engines.js';
import { Heightmap } from './heightmap.js';
import { rankZones } from './rank.js';
import { planMoveIn, placeFirstFit } from './moveIn.js';
import { checkRules } from './checkRules.js';
import { boxToLocal, volume, dist } from './geometry.js';
import { shortLabel } from './focusField.js';

const DEFAULT_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
const INSIDE_ACCEPTS = ['clothes', 'bedding', 'storage', 'misc', 'sport', 'appliance'];
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byVolDesc = (a, b) => volume(b.size) - volume(a.size) || byStr(a.id, b.id);
const r3 = (v) => Math.round(v * 1000) / 1000;

export const activeAt = (it, m) => !it.months || it.months.includes(m);
const isSeasonal = (it) => Array.isArray(it.months) && it.months.length > 0 && it.months.length < 12;

/**
 * 由行李箱的 placement 生成 inside 分区（docs/05 §2.7）：按 container 尺寸居中内缩，放倒时按放倒后的方向对应。
 */
export function insideZoneFor(item, pl, parentZone) {
  const c = item.flags.container;
  const s = item.size, b = pl.box;
  const near = (x, y) => Math.abs(x - y) < 0.05;
  // 世界 y 对应物品的哪一维
  let ky = 'h';
  if (pl.lying) ky = near(b.h, s.d) && !near(b.h, s.w) ? 'd' : near(b.h, s.w) ? 'w' : 'd';
  const rest = ['w', 'd', 'h'].filter((k) => k !== ky);
  // 世界 x 对应剩下两维中与 b.w 相等的那一维
  const kx = near(b.w, s[rest[0]]) ? rest[0] : rest[1];
  const kz = rest[0] === kx ? rest[1] : rest[0];
  const cx = Math.min(c[kx], b.w), cz = Math.min(c[kz], b.d), cy = Math.min(c[ky], b.h);
  return {
    id: `${item.id}.inside`, slot: 'inside', label: `${item.name}里`, owner: item.owner, kind: 'inside',
    box: { x: b.x + (b.w - cx) / 2, y: b.y + (b.h - cy) / 2, z: b.z + (b.d - cz) / 2, w: cx, d: cz, h: cy },
    front: parentZone?.front ?? '+x', tier: 2, accepts: [...INSIDE_ACCEPTS], stackable: true, parentItemId: item.id
  };
}

/** 尝试把物品放回上个月的原位（同分区、同局部矩形仍空闲） */
function tryPrev(eng, item, prevPl, compressed) {
  if (!prevPl || !eng || prevPl.compressed !== compressed) return null;
  if (eng.kind === 'rail') {
    const off = (eng.axis === 'x' ? prevPl.box.x : prevPl.box.z) - eng.start;
    const spot = eng.tryAt(item, off);
    return spot ? commitSpot(eng, item, spot, compressed) : null;
  }
  const l = boxToLocal(eng.zone, prevPl.box);
  const spot = eng.tryAt(item, l, prevPl.lying);
  if (!spot) return null;
  const pl = commitSpot(eng, item, spot, compressed);
  pl.rot = prevPl.rot;
  return pl;
}

/**
 * @param {import('../core/types.js').Room} room
 * @param {import('../core/types.js').Item[]} items
 * @param {{ owner?: string, tdm?: boolean, months?: number[], compare?: boolean, lockedZones?: string[] }} [opts]
 * @returns {import('../core/types.js').TdmPlan}
 */
export function planSeasons(room, items, opts = {}) {
  const owner = opts.owner ?? 'A';
  const tdm = opts.tdm ?? true;
  const months = [...(opts.months ?? DEFAULT_MONTHS)];
  const lockedZones = opts.lockedZones ?? [];
  const ctx = { lockedZones };
  const usable = items.filter((it) => !checkRules(it).banned && !it.flags?.disposable && it.category !== 'trash');
  const seasonal = usable.filter(isSeasonal).sort(byStr2);
  const anchors = usable.filter((it) => !isSeasonal(it));

  // ① 锚点：用 EP01 的放置流程放一次，全年不动
  const base = planMoveIn(room, anchors, { owner, lockedZones });
  const basePlacements = base.placements;
  const anchorOverflow = anchors.filter((it) => !basePlacements[it.id]).map((it) => it.id).sort(byStr);

  // ② 箱内分区
  const zoneById = new Map(room.zones.map((z) => [z.id, z]));
  const insideZones = [];
  if (tdm) {
    for (const it of [...anchors].sort((a, b) => byStr(a.id, b.id))) {
      const p = basePlacements[it.id];
      if (p && it.flags?.container) insideZones.push(insideZoneFor(it, p, zoneById.get(p.zoneId)));
    }
  }
  const allZones = [...room.zones, ...insideZones];
  const roomPlus = { ...room, zones: allZones };
  const baseEngines = buildEngines(room, basePlacements, { lockedZones, items: anchors });
  for (const z of insideZones) baseEngines[z.id] = new Heightmap(z);

  const byMonth = {};
  let prev = {};
  /** @type {Record<string, 'active'|'stored'>} */
  let prevState = {};
  for (const m of months) {
    const eng = cloneEngines(baseEngines);
    const P = structuredClone(basePlacements);
    const active = [], stored = [], overflow = [...anchorOverflow];
    const state = {};
    const act = seasonal.filter((it) => activeAt(it, m));
    const inact = seasonal.filter((it) => !activeAt(it, m));
    const fillOf = (id) => eng[id]?.fill() ?? 0;

    /**
     * 放一组物品：先把"状态没变、原位仍空闲"的放回原位（稳定性），再为其余的找新位置。
     * 只有状态相同才试原位：在用 → 收起时必须挪去深层，不能"原地收起"。
     */
    const placeGroup = (group, want, variant, candidates) => {
      const rest = [];
      for (const it of group) {
        const v = variant(it);
        const pp = prev[it.id];
        const ok = pp && (!tdm || prevState[it.id] === want);
        const pl = ok ? tryPrev(eng[pp.zoneId], v.item, pp, v.comp) : null;
        if (pl) { P[it.id] = pl; state[it.id] = want; } else rest.push(it);
      }
      for (const it of rest) {
        const v = variant(it);
        const pl = placeFirstFit(v.item, candidates(v.item), eng, { compressed: v.comp })?.pl ?? null;
        if (pl) { P[it.id] = pl; state[it.id] = want; } else overflow.push(it.id);
      }
    };

    if (tdm) {
      // 先收起：箱内 → 同主人 tier 2 → tier 1（都要过硬过滤；挂杆不算收起）
      placeGroup([...inact].sort(byVolDesc), 'stored', (it) => {
        const c = compressedItem(it);
        return { item: c ?? it, comp: !!c };
      }, (itC) => {
        const ranked = rankZones(itC, roomPlus, { ...ctx, fillOf }).filter((r) => r.zone.kind !== 'hang');
        return [
          ...ranked.filter((r) => r.zone.kind === 'inside'),
          ...ranked.filter((r) => r.zone.kind !== 'inside' && r.zone.tier === 2 && r.zone.owner === itC.owner),
          ...ranked.filter((r) => r.zone.kind !== 'inside' && r.zone.tier === 1)
        ];
      });
    }
    // 再放在用的（tdm 关闭时：所有季节物品同时占用可达分区，不压缩、没有箱内分区）
    placeGroup([...(tdm ? act : seasonal)].sort(byVolDesc), 'active', (it) => ({ item: it, comp: false }),
      (it) => rankZones(it, room, { ...ctx, fillOf }));
    for (const it of seasonal) {
      if (!P[it.id]) continue;
      if (activeAt(it, m)) active.push(it.id); else stored.push(it.id);
    }
    active.sort(byStr); stored.sort(byStr);
    byMonth[m] = { placements: P, active, stored, overflow: [...new Set(overflow)].sort(byStr),
      zoneFill: zoneFill(roomPlus, items, P) };
    prev = P;
    prevState = state;
  }

  // ④ matrix：全年占用率曾 > 0 的分区作为行
  const zoneIds = allZones.filter((z) => z.kind !== 'keepClear' && months.some((m) => (byMonth[m].zoneFill[z.id] ?? 0) > 0))
    .map((z) => z.id);
  const matrix = { zoneIds, months: [...months], fill: zoneIds.map((id) => months.map((m) => byMonth[m].zoneFill[id] ?? 0)) };

  /** @type {import('../core/types.js').TdmPlan} */
  const plan = { months, tdm, byMonth, matrix };
  if (opts.compare ?? true) {
    const off = tdm ? planSeasons(room, items, { ...opts, tdm: false, compare: false }) : plan;
    const on = tdm ? plan : planSeasons(room, items, { ...opts, tdm: true, compare: false });
    plan.compare = { on: seasonStats(room, on), off: seasonStats(room, off) };
  }
  return plan;
}

function byStr2(a, b) { return byStr(a.id, b.id); }

/** 统计：全年 tier ≤ 1 分区占用率的最大值、有溢出的月份数 */
export function seasonStats(room, plan) {
  const reach = room.zones.filter((z) => z.kind !== 'keepClear' && z.tier <= 1).map((z) => z.id);
  let maxFill = 0, overflowMonths = 0;
  for (const m of plan.months) {
    const bm = plan.byMonth[m];
    for (const id of reach) maxFill = Math.max(maxFill, bm.zoneFill[id] ?? 0);
    if (bm.overflow.length) overflowMonths++;
  }
  return { maxFill: r3(maxFill), overflowMonths };
}

/** 分区名：行李箱内部显示为"${箱名}里" */
function zoneName(zoneId, room, items) {
  if (zoneId && zoneId.endsWith('.inside')) {
    const pid = zoneId.slice(0, -'.inside'.length);
    const parent = items.find((it) => it.id === pid);
    return `${parent ? parent.name : '行李箱'}里`;
  }
  return shortLabel(room.zones.find((z) => z.id === zoneId)) || '滞留区';
}

/**
 * 两个月之间的换季步骤（docs/05 §6.3）。
 * @param {import('../core/types.js').MonthPlan} A
 * @param {import('../core/types.js').MonthPlan} B
 * @returns {import('../core/types.js').MoveStep[]}
 */
export function diffMonths(A, B, items, room) {
  const byId = itemMap(items);
  const ids = [...new Set([...Object.keys(A.placements), ...Object.keys(B.placements)])].sort(byStr);
  const steps = [];
  const same = (p, q) => p.zoneId === q.zoneId && JSON.stringify(p.box) === JSON.stringify(q.box);
  for (const id of ids) {
    const pa = A.placements[id], pb = B.placements[id];
    if (pa && pb && same(pa, pb)) continue;
    const name = byId[id]?.name ?? id;
    const kind = A.stored.includes(id) && B.active.includes(id) ? 'retrieve'
      : A.active.includes(id) && B.stored.includes(id) ? 'store' : 'move';
    const from = pa ? { ...pa.box } : pb ? { ...pb.box } : null;
    const to = pb ? { ...pb.box } : null;
    const distance = pa && pb ? Math.round(dist(pa.box, pb.box) * 10) / 10 : 0;
    const fromName = pa ? zoneName(pa.zoneId, room, items) : '滞留区';
    const toName = pb ? zoneName(pb.zoneId, room, items) : '滞留区';
    let text;
    if (kind === 'retrieve') text = `取出「${name}」：从${fromName}放到${toName}`;
    else if (kind === 'store') text = `收起「${name}」：放进${toName}`;
    else if (pa && pb && pa.zoneId === pb.zoneId) text = `把「${name}」挪到${toName}的空位（约 ${Math.round(distance)} cm）`;
    else text = `把「${name}」从${fromName}移到${toName}（约 ${Math.round(distance)} cm）`;
    const st = { idx: steps.length, itemId: id, itemName: name, kind,
      fromZoneId: pa ? pa.zoneId : null, toZoneId: pb ? pb.zoneId : null, from, to, distance,
      text: `第 ${steps.length + 1} 步：${text}` };
    if (pb) st.placement = structuredClone(pb);
    steps.push(st);
  }
  return steps;
}
