// 第二话 腾桌：planFocusField（docs/05 §5）。
// 思路：力场（前沿居中的 w×d 矩形）内的东西 + 压在它们上面的东西 = 冲突集；
// 先把冲突集从引擎中拿掉、封住力场，再逐件就近找落点；放不下时做一层级联（先赶走一件不常用的）。
// 复杂度 O(冲突数 × 候选分区数 × findSpot)，典型 < 20ms。

import { buildEngines, commitSpot, cloneEngines, itemMap } from './engines.js';
import { rankZones, hardOk, idealTier, zoneCost } from './rank.js';
import { computeSync } from './sync.js';
import { boxToLocal, focusRect, dist, volume, EPS } from './geometry.js';

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const r1 = (v) => Math.round(v * 10) / 10;

/** 步骤文案里的分区名：个人分区去掉"A "前缀（"从书桌桌面移到桌下"） */
export function shortLabel(zone) {
  if (!zone) return '';
  return zone.owner !== 'pub' ? zone.label.replace(/^[A-D]\s*/, '') : zone.label;
}

/** 局部矩形重叠面积 */
function rectOverlap(p, q) {
  const du = Math.min(p.u0 + p.a, q.u0 + q.a) - Math.max(p.u0, q.u0);
  const dv = Math.min(p.v0 + p.b, q.v0 + q.b) - Math.max(p.v0, q.v0);
  return du > 0 && dv > 0 ? du * dv : 0;
}

/** q 是否直接压在 p 上：q 的底面 ≈ p 的顶面，且水平投影有重叠 */
function restsOn(q, p) {
  if (q.zoneId !== p.zoneId) return false;
  if (Math.abs(q.box.y - (p.box.y + p.box.h)) > 1) return false;
  const ox = Math.min(q.box.x + q.box.w, p.box.x + p.box.w) - Math.max(q.box.x, p.box.x);
  const oz = Math.min(q.box.z + q.box.d, p.box.z + p.box.d) - Math.max(q.box.z, p.box.z);
  return ox > EPS && oz > EPS;
}

/** docs/05 §5.3 moveCost */
function moveCost(item, fromPl, zone, toBox) {
  return 1 + 0.02 * dist(fromPl.box, toBox) + 3 * Math.abs(idealTier(item) - zone.tier) +
    (zone.id !== fromPl.zoneId ? 2 : 0) + (zone.owner === 'pub' ? 5 : 0);
}

/**
 * @param {import('../core/types.js').Room} room
 * @param {import('../core/types.js').Item[]} items
 * @param {Record<string, import('../core/types.js').Placement>} placements
 * @param {{ zoneId?: string, w?: number, d?: number }} [spec]
 * @param {{ lockedZones?: string[], maxCascade?: number, allowUpgrades?: boolean, owner?: string }} [opts]
 * @returns {import('../core/types.js').MovePlan}
 */
export function planFocusField(room, items, placements, spec = {}, opts = {}) {
  const deskId = spec.zoneId ?? `${opts.owner ?? 'A'}.desk`;
  const desk = room.zones.find((z) => z.id === deskId);
  if (!desk) throw new Error(`planFocusField：找不到分区 ${deskId}`);
  const owner = desk.owner;
  const lockedZones = opts.lockedZones ?? [];
  const maxCascade = opts.maxCascade ?? 1;
  const ctx = { lockedZones };
  const byId = itemMap(items);
  const zoneById = new Map(room.zones.map((z) => [z.id, z]));
  const { rect, box: focusBox } = focusRect(desk, spec.w ?? 75, spec.d ?? 35);

  // ── §5.2 冲突集 ──
  const conflictSet = new Set();
  const deskLocked = lockedZones.includes(desk.id);
  const onDesk = Object.values(placements).filter((p) => p.zoneId === desk.id && byId[p.itemId]).sort((a, b) => byStr(a.itemId, b.itemId));
  if (!deskLocked) {
    for (const p of onDesk) {
      if (byId[p.itemId].flags?.focusTool) continue;
      const l = boxToLocal(desk, p.box);
      if (rectOverlap(l, rect) > 1) conflictSet.add(p.itemId);
    }
    // 依赖闭包：压在冲突物品上面的东西也必须一起处理（不论是不是 focusTool）
    let changed = true;
    while (changed) {
      changed = false;
      for (const q of onDesk) {
        if (conflictSet.has(q.itemId) || (q.layer ?? 0) <= 0) continue;
        if (onDesk.some((p) => conflictSet.has(p.itemId) && restsOn(q, p))) { conflictSet.add(q.itemId); changed = true; }
      }
    }
  }
  const conflicts = [...conflictSet].sort(byStr);

  // ── §5.3 逐件找落点 ──
  const cur = structuredClone(placements);
  const rest = {};
  for (const [id, p] of Object.entries(placements)) if (!conflictSet.has(id)) rest[id] = p;
  let engines = buildEngines(room, rest, { lockedZones, items });
  engines[desk.id].blockRect(rect);
  const syncBefore = computeSync(room, items, placements, { owner, focusBox }).total;

  const near = ['desk', 'hutch', 'underDesk', 'underDeskBack']
    .map((s) => zoneById.get(`${owner}.${s}`)).filter((z) => z && !lockedZones.includes(z.id));
  const nearIds = new Set(near.map((z) => z.id));
  const moved = new Set();
  const groups = [];          // 每组是一件冲突物品产生的步骤（级联在前），便于保持顺序
  const unresolved = [];

  /**
   * 为冲突物品 c 在候选分区里找最优落点（不提交）。
   * 规格空缺处的选择：候选分区 = 本人书桌周边（near）+ 公共区；腾桌只在书桌附近动手，
   * 不把桌上的东西搬进衣柜或床上。公共区代价 +5，并且只有在级联也失败时才用（见 placeConflict）。
   */
  const bestSpot = (c, eng, { pubOnly = false, nearOnly = false } = {}) => {
    const fromPl = cur[c.id];
    const fromLocal = boxToLocal(desk, fromPl.box);
    const origin = { u: fromLocal.u0 + fromLocal.a / 2, v: fromLocal.v0 + fromLocal.b / 2 };
    const zs = [...near, ...room.zones.filter((z) => z.owner === 'pub')];
    let best = null;
    for (const z of zs) {
      const isPub = z.owner === 'pub';
      if ((pubOnly && !isPub) || (nearOnly && isPub)) continue;
      if (!hardOk(c, z, ctx) || !eng[z.id]) continue;
      const e = eng[z.id];
      const spot = e.kind === 'rail' ? e.findSpot(c)
        : e.findSpot(c, z.id === desk.id ? { mode: 'near', origin } : { mode: 'store' });
      if (!spot) continue;
      const toBox = e.kind === 'rail' ? e.boxFor(spot) : boxFromSpot(z, spot);
      // rankZonesForMove 的三点调整只用于同分代价时的先后：桌面 −2、同主人近处 −1、公共 +5
      const rk = zoneCost(c, z) + (z.id === desk.id ? -2 : nearIds.has(z.id) ? -1 : 0) + (isPub ? 5 : 0);
      const cost = moveCost(c, fromPl, z, toBox);
      if (!best || cost < best.cost - EPS || (Math.abs(cost - best.cost) <= EPS && (rk < best.rk - EPS ||
          (Math.abs(rk - best.rk) <= EPS && z.id < best.zone.id)))) {
        best = { zone: z, spot, cost, rk };
      }
    }
    return best;
  };

  const makeStep = (it, kind, fromPl, toPl, extra = '') => ({
    idx: 0, itemId: it.id, itemName: it.name, kind,
    fromZoneId: fromPl.zoneId, toZoneId: toPl ? toPl.zoneId : null,
    from: { ...fromPl.box }, to: toPl ? { ...toPl.box } : null,
    distance: toPl ? r1(dist(fromPl.box, toPl.box)) : 0,
    text: '', _suffix: extra,
    placement: toPl ? structuredClone(toPl) : undefined
  });

  /** §5.4 一层级联：在 near 里赶走一件不常用的东西到深层分区，再为 c 找落点 */
  const tryCascade = (c) => {
    const evictables = [];
    for (const z of near) {
      const e = engines[z.id];
      if (!e || e.locked) continue;
      for (const pe of e.placed) {
        const x = byId[pe.itemId];
        if (!x || conflictSet.has(x.id) || moved.has(x.id) || !cur[x.id]) continue;
        const px = cur[x.id];
        // 上面压着东西的不能直接抽走
        if (Object.values(cur).some((q) => q.itemId !== x.id && restsOn(q, px))) continue;
        evictables.push(x);
      }
    }
    evictables.sort((a, b) => idealTier(b) - idealTier(a) || volume(b.size) - volume(a.size) || byStr(a.id, b.id));
    for (const x of evictables.slice(0, 6)) {
      const deep = rankZones(x, room, ctx).map((r) => r.zone).filter((z) => z.tier >= 1 && !nearIds.has(z.id));
      for (const dz of deep) {
        const de = engines[dz.id];
        if (!de) continue;
        const s2 = de.kind === 'rail' ? de.findSpot(x) : de.findSpot(x, { mode: 'store' });
        if (!s2) continue;
        const backup = cloneEngines(engines);
        const fromX = cur[x.id];
        engines[fromX.zoneId].removeItem(x.id);
        const toX = commitSpot(engines[dz.id], x, s2);
        const b = bestSpot(c, engines, { nearOnly: true });
        if (b) {
          const toC = commitSpot(engines[b.zone.id], c, b.spot);
          return [{ x, fromX, toX }, { c, toC }];
        }
        engines = backup;
      }
    }
    return null;
  };

  const order = conflicts.map((id) => byId[id]).sort((a, b) =>
    (cur[b.id].layer ?? 0) - (cur[a.id].layer ?? 0) || volume(b.size) - volume(a.size) || byStr(a.id, b.id));
  for (const c of order) {
    const fromPl = cur[c.id];
    if (c.flags?.disposable || c.category === 'trash') {
      groups.push([makeStep(c, 'dispose', fromPl, null)]);
      delete cur[c.id];
      moved.add(c.id);
      continue;
    }
    // ① 书桌周边直接放得下
    const b = bestSpot(c, engines, { nearOnly: true });
    if (b) {
      const toPl = commitSpot(engines[b.zone.id], c, b.spot);
      groups.push([makeStep(c, 'move', fromPl, toPl)]);
      cur[c.id] = toPl; moved.add(c.id);
      continue;
    }
    // ② 一层级联
    if (maxCascade > 0) {
      const res = tryCascade(c);
      if (res) {
        const [{ x, fromX, toX }, { toC }] = res;
        groups.push([makeStep(x, 'cascade', fromX, toX, `，给「${c.name}」腾位置`), makeStep(c, 'move', fromPl, toC)]);
        cur[x.id] = toX; cur[c.id] = toC; moved.add(x.id); moved.add(c.id);
        continue;
      }
    }
    // ③ 公共区兜底
    const pb = bestSpot(c, engines, { pubOnly: true });
    if (pb) {
      const toPl = commitSpot(engines[pb.zone.id], c, pb.spot);
      groups.push([makeStep(c, 'move', fromPl, toPl)]);
      cur[c.id] = toPl; moved.add(c.id);
      continue;
    }
    unresolved.push({ itemId: c.id, reason: '附近放不下',
      suggestion: c.flags?.compressible ? '真空压缩后收进床尾' : '收进床尾或带回家；也可以加购桌面置物架' });
  }

  // ── §5.5 步骤与文案 ──
  const steps = groups.flat();
  steps.forEach((st, i) => {
    st.idx = i;
    const k = i + 1;
    if (st.kind === 'dispose') st.text = `第 ${k} 步：「${st.itemName}」直接扔掉或拆平`;
    else if (st.fromZoneId === st.toZoneId) {
      // 同一分区内挪位：避免"从书桌桌面移到书桌桌面"
      st.text = `第 ${k} 步：把「${st.itemName}」挪到${shortLabel(zoneById.get(st.toZoneId))}的空位（约 ${Math.round(st.distance)} cm）${st._suffix}`;
    } else {
      st.text = `第 ${k} 步：把「${st.itemName}」从${shortLabel(zoneById.get(st.fromZoneId))}移到${shortLabel(zoneById.get(st.toZoneId))}（约 ${Math.round(st.distance)} cm）${st._suffix}`;
    }
    delete st._suffix;
    if (st.placement === undefined) delete st.placement;
  });

  // ── §5.6 指标 ──
  const distanceCm = r1(steps.reduce((s, st) => s + st.distance, 0));
  const estSeconds = Math.round(steps.reduce((s, st) => s + 15 + 0.3 * st.distance, 0));
  const syncAfter = computeSync(room, items, cur, { owner, focusBox, moves: steps.length }).total;
  return {
    focusZoneId: desk.id,
    focusBox,
    conflicts,
    steps,
    unresolved,
    placementsAfter: cur,
    metrics: { moves: steps.length, distanceCm, estSeconds, clearedArea: r1(rect.a * rect.b), syncBefore, syncAfter }
  };
}

/** 网格落点 → 世界盒子（与 commitSpot 一致，用于算 moveCost 的距离） */
function boxFromSpot(zone, spot) {
  const bx = zone.box;
  const y = bx.y + spot.base;
  switch (zone.front) {
    case '+x': return { x: bx.x + bx.w - (spot.v0 + spot.b), y, z: bx.z + spot.u0, w: spot.b, d: spot.a, h: spot.h };
    case '-x': return { x: bx.x + spot.v0, y, z: bx.z + spot.u0, w: spot.b, d: spot.a, h: spot.h };
    case '+z': return { x: bx.x + spot.u0, y, z: bx.z + bx.d - (spot.v0 + spot.b), w: spot.a, d: spot.b, h: spot.h };
    default:   return { x: bx.x + spot.u0, y, z: bx.z + spot.v0, w: spot.a, d: spot.b, h: spot.h };
  }
}

/** 把前 upto 步应用到 placements 上；dispose 步骤删除该 placement（docs/05 §5.6） */
export function applySteps(placements, steps, upto = steps.length) {
  const out = structuredClone(placements);
  const n = Math.max(0, Math.min(upto, steps.length));
  for (let i = 0; i < n; i++) {
    const st = steps[i];
    if (st.kind === 'dispose' || !st.to) { delete out[st.itemId]; continue; }
    const prev = out[st.itemId];
    out[st.itemId] = st.placement
      ? structuredClone(st.placement)
      : { itemId: st.itemId, zoneId: st.toZoneId, box: { ...st.to },
          rot: prev?.rot ?? 0, lying: prev?.lying ?? false, layer: prev?.layer ?? 0, compressed: prev?.compressed ?? false };
  }
  return out;
}

