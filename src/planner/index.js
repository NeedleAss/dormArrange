// 规划引擎公开 API（docs/03 §4.1）。跨模块只能 import 本文件。
// B0 阶段：尚未实现的函数返回与 docs/04 §6 形状一致的确定性 mock，后续任务逐个替换为真实实现。

export { DEFAULT_PARAMS, buildRoom } from '../data/roomTemplates.js';
export { LIBRARY, makeItem } from '../data/itemLibrary.js';
export { RULES } from '../data/rules.js';
export { PRESETS } from '../data/demoPresets.js';
export { checkRules } from './checkRules.js';
export { parseItemsText } from './parseText.js';
export { zoneFill } from './engines.js';
export { planMoveIn } from './moveIn.js';
export { computeSync } from './sync.js';
export { planFocusField, applySteps } from './focusField.js';

const DEFAULT_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

/** mock 同步率：B4 替换 */
function mockSync() {
  return { total: 0, parts: { fit: 0, access: 0, focus: 0, safety: 1 },
    votes: { time: true, space: false, mind: false }, notes: [] };
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

/** 加分：成长预测（mock） */
export function predictGrowth(items, room, opts = {}) {
  return { semesters: [], fill: {}, firstOverflow: null, text: '' };
}

/** 加分：乱桌生成器（mock：空） */
export function scatterOnDesk(room, items, opts = {}) {
  return {};
}
