import { chat, getConfig } from './client.js';
import { parseItemsText } from '../planner/index.js';
import { makeItemMessages } from './prompts.js';
import { normalizeItems } from './normalize.js';

const OFFLINE_WARNING = 'AI 离线，已使用本地解析';
const SAFE_CODES = new Set(['DISABLED', 'TIMEOUT', 'HTTP_4XX', 'HTTP_5XX', 'BAD_JSON', 'EMPTY_RESULT']);

/** 只接纳契约中的归属值，避免把无效 owner 传入规划器。 */
function itemOwner(options) {
  return ['A', 'B', 'C', 'D', 'pub'].includes(options?.owner) ? options.owner : 'A';
}

/** 规则解析本身异常也要兜底，任何输入都不能使入住页白屏。 */
function rules(text, owner, reason) {
  const warnings = [OFFLINE_WARNING, SAFE_CODES.has(reason) ? reason : 'HTTP_5XX'];
  try {
    const items = parseItemsText(text, { owner });
    if (!items.length) warnings.push('没有识别到物品');
    return { items, source: 'rules', warnings };
  } catch {
    return { items: [], source: 'rules', warnings: [...warnings, '没有识别到物品'] };
  }
}

/** @returns {Promise<boolean>} */
export async function aiAvailable() {
  return (await getConfig()).enabled;
}

/**
 * 自然语言提取后统一校验；不可用、非法 JSON、空清单及其他失败均回退规则。
 * @param {string} text
 * @param {{owner?:import('../core/types.js').Owner}} [options]
 * @returns {Promise<{items:import('../core/types.js').Item[],source:'ai'|'rules',warnings:string[]}>}
 */
export async function aiParseItems(text, options = {}) {
  const owner = itemOwner(options);
  const input = typeof text === 'string' ? text : '';
  try {
    if (!input.trim() || !await aiAvailable()) return rules(input, owner, 'DISABLED');
    const raw = await chat(makeItemMessages(input));
    const { items, warnings } = normalizeItems(raw, { owner, text: input });
    if (!items.length) return rules(input, owner, 'EMPTY_RESULT');
    return { items, source: 'ai', warnings };
  } catch (error) {
    return rules(input, owner, error?.code);
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
