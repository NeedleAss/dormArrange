// 宿舍安全检查：本地硬规则优先，再接纳 AI 的补充风险；AI 不能撤销硬规则。

import { RULES } from '../data/rules.js';

/** 只消除排版差异，不让全角、零宽或插空格绕过实体检查。 */
function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u2060\ufeff]/g, '');
}

/**
 * 局部排除明确的空配件/参考资料和无火照明；不豁免整条名称。
 * 例如“打火机保护套（内含打火机）”仍保留后一个危险实体。
 */
function subject(value) {
  return value.replace(/\s+/g, '')
    .replace(/(?:打火机|点火石|打火石|电热毯|电饭锅|电磁炉)(?:使用说明书|说明书|科普书|保护套|空收纳盒)/g, '')
    .replace(/(?:led(?:电子)?|电子|无火)蜡烛/g, '')
    .replace(/酒精(?:棉片|棉球|湿巾|擦拭片)/g, '');
}

const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 规则在模块加载时只编译一次；名称每件只规范化一次，避免腾桌/换季反复构造正则。
// 所有正则均无 g/y 标志，不保存匹配状态；单次检查为 O(规则总词长×名称长)。
const BAN_RULES = RULES.filter((r) => r.kind === 'ban' && r.keywords).map((rule) => {
  const terms = rule.keywords.map((keyword) => {
    const english = /^[a-z][a-z0-9-]*$/i.test(keyword);
    const pattern = english ? keyword.split('').map((ch) => ch === '-' ? '[- ]?' : escapePattern(ch)).join('\\s*') : null;
    return { keyword, english, compact: normalize(keyword).replace(/\s+/g, ''),
      pattern: english ? new RegExp(`(^|[^a-z])${pattern}($|[^a-z])`, 'i') : null };
  });
  const compactTerms = terms.filter((t) => !t.english);
  return { rule, terms,
    compactPattern: compactTerms.length ? new RegExp(compactTerms.map((t) => escapePattern(t.compact)).join('|')) : null };
});

/**
 * @param {import('../core/types.js').Item} item
 * @returns {{ banned: boolean, ruleId?: string, reason?: string, warn?: string }}
 */
export function checkRules(item) {
  const fields = [item.name, item.libId].filter((v) => v != null).map((value) => {
    const text = normalize(value);
    return { compact: subject(text), english: text.replace(/\blighter\s+(?:case|cover|manual|guide|book)\b/g, '') };
  });
  // ① 关键词禁用（按 RULES 顺序，命中第一个即止）
  for (const { rule: r, terms, compactPattern } of BAN_RULES) {
    const compactHit = compactPattern && fields.some((f) => compactPattern.test(f.compact));
    const match = terms.find((t) => t.english ? fields.some((f) => t.pattern.test(f.english)) :
      compactHit && fields.some((f) => f.compact.includes(t.compact)));
    const kw = match?.keyword;
    if (kw) return { banned: true, ruleId: r.id, reason: `「${kw}」触发${r.label}规则：${r.text}（${r.clause}）` };
  }
  // ② 功率
  const pw = item.powerW;
  const powerRule = RULES.find((r) => r.id === 'R-POWER');
  if (typeof pw === 'number' && pw > powerRule.maxPowerW) {
    return { banned: true, ruleId: 'R-POWER',
      reason: `额定功率 ${pw}W，超过宿舍 ${powerRule.maxPowerW}W 上限（${powerRule.clause}）` };
  }
  // AI 只可增加风险；缺少或非法结论由 D 规范化为 review，不能以 clear 覆盖以上检查。
  const safety = item.safety;
  if (safety != null && (safety.status !== 'clear' || typeof safety.reason !== 'string' || !safety.reason.trim())) {
    const review = safety.status !== 'blocked';
    const detail = typeof safety.reason === 'string' ? safety.reason.trim().slice(0, 400) : '';
    return { banned: true, ruleId: review ? 'R-SAFETY-REVIEW' : 'R-AI-SAFETY',
      reason: `${review ? '安全风险待核实，暂不通过' : 'AI 安全预检拦截'}：${detail || '未取得有效的物品安全说明'}；核实前不安排宿舍位置` };
  }
  if (item.category === 'appliance' && pw == null) {
    return { banned: false, ruleId: 'R-POWER-UNKNOWN', warn: '功率未知：需确认额定功率 ≤ 1000W' };
  }
  return { banned: false };
}
