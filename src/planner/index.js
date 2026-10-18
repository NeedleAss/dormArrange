// 规划引擎公开 API（docs/03 §4.1）。跨模块只能 import 本文件。

export { DEFAULT_PARAMS, buildRoom } from '../data/roomTemplates.js';
export { LIBRARY, makeItem } from '../data/itemLibrary.js';
export { RULES } from '../data/rules.js';
import { PRESETS as DATA_PRESETS } from '../data/demoPresets.js';
import { buildGrowthSnapshots } from './growth.js';
export { predictGrowth } from './growth.js';
export { checkRules } from './checkRules.js';
export { parseItemsText } from './parseText.js';
export { zoneFill } from './engines.js';
export { planMoveIn } from './moveIn.js';
export { computeSync } from './sync.js';
export { planFocusField, applySteps } from './focusField.js';
export { planSeasons, diffMonths } from './seasons.js';
export { scatterOnDesk } from './scatter.js';

/**
 * 演示预设：freshman、messyDesk 来自 data/demoPresets.js；growth 的快照需要用规划器计算
 * （data/ 不能反向 import planner/），所以在这里合并。导入时确定性地算一次。
 */
export const PRESETS = Object.freeze({ ...DATA_PRESETS, growth: buildGrowthSnapshots() });

