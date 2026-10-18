// 违章电器检查（docs/07 §3）：先用 name 和 libId 匹配关键词，再看 powerW。

import { RULES } from '../data/rules.js';

/**
 * @param {import('../core/types.js').Item} item
 * @returns {{ banned: boolean, ruleId?: string, reason?: string, warn?: string }}
 */
export function checkRules(item) {
  const hay = `${item.name ?? ''} ${item.libId ?? ''}`.toLowerCase();
  // ① 关键词禁用（按 RULES 顺序，命中第一个即止）
  for (const r of RULES) {
    if (r.kind !== 'ban' || !r.keywords) continue;
    const kw = r.keywords.find((k) => hay.includes(k.toLowerCase()));
    if (kw) return { banned: true, ruleId: r.id, reason: `「${kw}」属于宿舍禁用电器：${r.text}（${r.clause}）` };
  }
  // ② 功率
  const pw = item.powerW;
  const powerRule = RULES.find((r) => r.id === 'R-POWER');
  if (typeof pw === 'number' && pw > powerRule.maxPowerW) {
    return { banned: true, ruleId: 'R-POWER',
      reason: `额定功率 ${pw}W，超过宿舍 ${powerRule.maxPowerW}W 上限（${powerRule.clause}）` };
  }
  if (item.category === 'appliance' && pw == null) {
    return { banned: false, ruleId: 'R-POWER-UNKNOWN', warn: '功率未知：需确认额定功率 ≤ 1000W' };
  }
  return { banned: false };
}
