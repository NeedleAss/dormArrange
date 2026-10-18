import { getConfig } from './client.js';
import { parseItemsText } from '../planner/index.js';

/** @returns {Promise<boolean>} */
export async function aiAvailable() {
  return (await getConfig()).enabled;
}

/** D1 先提供稳定接口，D2 接入模型；任何异常都不得中断入住页面。 */
export async function aiParseItems(text, { owner = 'A' } = {}) {
  try {
    const items = parseItemsText(typeof text === 'string' ? text : '', { owner });
    return { items, source: 'rules', warnings: ['AI 离线，已使用本地解析', ...(!items.length ? ['没有识别到物品'] : [])] };
  } catch {
    return { items: [], source: 'rules', warnings: ['没有识别到物品'] };
  }
}

/** 照片加分项尚未启用时，调用方可直接置灰。 */
export async function aiParsePhoto() {
  return { items: [], source: 'unavailable', warnings: ['当前模型不支持图片'] };
}

/** 解说为可选功能，UI 可继续使用规划器已有步骤文案。 */
export async function aiExplainPlan() {
  throw Object.assign(new Error('AI 解说暂未启用'), { code: 'NOT_IMPLEMENTED' });
}
