// 规划引擎公开 API（docs/03 §4.1）。跨模块只能 import 本文件。
// B0 阶段：尚未实现的函数返回与 docs/04 §6 形状一致的确定性 mock，后续任务逐个替换为真实实现。

export { DEFAULT_PARAMS, buildRoom } from '../data/roomTemplates.js';
export { LIBRARY, makeItem } from '../data/itemLibrary.js';
export { RULES } from '../data/rules.js';
export { PRESETS } from '../data/demoPresets.js';
export { checkRules } from './checkRules.js';
export { parseItemsText } from './parseText.js';
export { zoneFill } from './engines.js';

const DEFAULT_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

/** mock 同步率：B4 替换 */
function mockSync() {
  return { total: 0, parts: { fit: 0, access: 0, focus: 0, safety: 1 },
    votes: { time: true, space: false, mind: false }, notes: [] };
}

/** EP01：规划新生带来的物品放在哪（mock：全部 fits，没有 placement） */
export function planMoveIn(room, items, opts = {}) {
  const verdicts = {};
  for (const it of items) verdicts[it.id] = { status: 'fits', zoneId: undefined, reasons: [], suggestions: [] };
  return {
    placements: {},
    verdicts,
    summary: { fits: items.length, relocate: 0, uncertain: 0, overflow: 0, banned: 0, total: items.length },
    overflowIds: [],
    zoneFill: {},
    sync: mockSync()
  };
}

/** EP02：腾出专注区（mock：steps 为空） */
export function planFocusField(room, items, placements, focusSpec = {}, opts = {}) {
  const zoneId = focusSpec.zoneId ?? 'A.desk';
  const desk = room.zones.find((z) => z.id === zoneId);
  const focusBox = desk ? { ...desk.box } : { x: 0, y: 0, z: 0, w: 0, d: 0, h: 0 };
  return {
    focusZoneId: zoneId,
    focusBox,
    conflicts: [],
    steps: [],
    unresolved: [],
    placementsAfter: structuredClone(placements),
    metrics: { moves: 0, distanceCm: 0, estSeconds: 0, clearedArea: 0, syncBefore: 0, syncAfter: 0 }
  };
}

/** EP02 辅助：把前 upto 步应用到 placements 上；dispose 步骤删除该 placement */
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

/** EP03：时分复用换季规划（mock：每月空） */
export function planSeasons(room, items, opts = {}) {
  const months = opts.months ?? DEFAULT_MONTHS;
  const byMonth = {};
  for (const m of months) byMonth[m] = { placements: {}, active: [], stored: [], overflow: [], zoneFill: {} };
  return {
    months: [...months],
    tdm: opts.tdm ?? true,
    byMonth,
    matrix: { zoneIds: [], months: [...months], fill: [] },
    compare: { on: { maxFill: 0, overflowMonths: 0 }, off: { maxFill: 0, overflowMonths: 0 } }
  };
}

/** EP03 辅助：两个月之间的换季步骤（mock：无步骤） */
export function diffMonths(monthPlanA, monthPlanB, items, room) {
  return [];
}

/** 同步率与三审决议（mock） */
export function computeSync(room, items, placements, ctx = {}) {
  return mockSync();
}

/** 加分：成长预测（mock） */
export function predictGrowth(items, room, opts = {}) {
  return { semesters: [], fill: {}, firstOverflow: null, text: '' };
}

/** 加分：乱桌生成器（mock：空） */
export function scatterOnDesk(room, items, opts = {}) {
  return {};
}
