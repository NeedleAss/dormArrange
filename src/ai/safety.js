import { checkRules, parseItemsText } from '../planner/index.js';

const STATUSES = new Set(['blocked', 'review', 'clear']);
const NEEDS_REVIEW = '安全信息缺失或无效，需核实物品用途、成分及宿舍管理要求。';

/** 安全理由只收字符串；不透传模型的嵌套对象或额外判定字段。 */
function reasonText(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 400) : '';
}

/** 暂时移除 AI 结论，只判断本地规则，防止把 review 误当成本地明确危险。 */
function localRule(item) {
  const { safety, ...local } = item;
  return checkRules(local);
}

/**
 * AI 只可补充风险；本地硬拦截的实体即使被模型判 clear 也必须保留 blocked。
 * @param {unknown} raw
 * @param {import('../core/types.js').Item} item
 * @returns {{status:'blocked'|'review'|'clear',reason:string}}
 */
export function normalizeSafety(raw, item) {
  const reason = reasonText(raw?.reason);
  const valid = raw && typeof raw === 'object' && !Array.isArray(raw)
    && STATUSES.has(raw.status) && reason;
  const safety = valid ? { status: raw.status, reason } : { status: 'review', reason: NEEDS_REVIEW };
  const rule = localRule(item);
  return rule.banned ? { status: 'blocked', reason: reasonText(`本地规则复核：${rule.reason || '该物品暂不允许进入宿舍规划'}`) } : safety;
}

/** 数量展开的序号不属于实体名称，排版空格与零宽字符也不能用于躲避对账。 */
function nameKey(item) {
  return String(item.name ?? '').normalize('NFKC').toLowerCase()
    .replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '').replace(/#\d+$/, '');
}

/**
 * 用原文的本地硬规则项对账，不让模型改名或漏项删除危险实体。
 * 逐件匹配数量，名称优先、库身份其次；不按 category 或 ruleId 合并不同危险品。
 * 别名包含关系的兜底为 O(N×H)，H 是原文硬拦截件数；排序为 O(H log H)。
 * @param {import('../core/types.js').Item[]} items
 * @param {string} text
 * @param {import('../core/types.js').Owner} owner
 */
export function restoreTextSafety(items, text, owner) {
  const original = parseItemsText(text, { owner, idPrefix: 'safety' }).filter(item => localRule(item).banned);
  const result = [...items];
  const names = new Map();
  const libraries = new Map();
  const used = new Set();
  const assigned = new Map();
  const warnings = new Set();
  const add = (map, key, index) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  };
  const candidates = items.map((item, index) => ({ item, index, key: nameKey(item), blocked: localRule(item).banned }));
  candidates.forEach(({ item, index, key }) => { add(names, key, index); add(libraries, item.libId, index); });
  const take = (map, key, needsLocalBlock = false) => map.get(key)?.find(index => !used.has(index)
    && (!needsLocalBlock || candidates[index].blocked));

  const order = original.map((item, index) => ({ item, index, key: nameKey(item) }))
    .sort((a, b) => b.key.length - a.key.length || a.index - b.index);
  const reserve = (sourceIndex, candidateIndex) => {
    if (candidateIndex === undefined || candidateIndex < 0) return;
    assigned.set(sourceIndex, candidateIndex);
    used.add(candidateIndex);
  };
  // 先全局保留精确候选，再按更具体的长名称匹配，避免“打火机”抢走“打火机油”。
  for (const entry of order) reserve(entry.index, take(names, entry.key));
  for (const entry of order) if (!assigned.has(entry.index)) reserve(entry.index, take(libraries, entry.item.libId, true));
  for (const entry of order) {
    if (assigned.has(entry.index)) continue;
    // 只对两侧本来都被硬拦截的实体容许长短名称匹配，空保护套不能匹配真实打火机。
    let best;
    let distance = Infinity;
    for (const candidate of candidates) {
      if (used.has(candidate.index) || !candidate.blocked || entry.key.length < 2 || candidate.key.length < 2) continue;
      if (!entry.key.includes(candidate.key) && !candidate.key.includes(entry.key)) continue;
      const nextDistance = Math.abs(candidate.key.length - entry.key.length);
      if (nextDistance < distance || (nextDistance === distance && candidate.key < best.key)) {
        best = candidate;
        distance = nextDistance;
      }
    }
    reserve(entry.index, best?.index);
  }

  for (let sourceIndex = 0; sourceIndex < original.length; sourceIndex += 1) {
    const item = original[sourceIndex];
    const index = assigned.get(sourceIndex);
    if (index === undefined) {
      result.push({ ...item, safety: normalizeSafety(undefined, item) });
      warnings.add('已补回模型遗漏或改名的原文风险物品，请核对并联系宿管。');
    } else {
      const candidate = result[index];
      const restored = { ...candidate, name: item.name };
      if (typeof item.powerW === 'number') restored.powerW = item.powerW;
      restored.safety = normalizeSafety(candidate.safety, restored);
      result[index] = restored;
    }
  }
  // 补回的本地条目与模型展开条目共享唯一编号，owner 始终来自调用方。
  return { items: result.map((item, index) => ({ ...item, id: `ai-${String(index + 1).padStart(3, '0')}`, owner })), warnings: [...warnings] };
}
