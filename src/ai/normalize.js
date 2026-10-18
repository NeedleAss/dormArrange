import { LIBRARY, makeItem } from '../planner/index.js';

const CATEGORIES = new Set(['luggage', 'clothes', 'bedding', 'books', 'study', 'electronics', 'appliance', 'toiletry', 'storage', 'food', 'sport', 'decor', 'trash', 'misc']);
const FREQUENCIES = new Set(['daily', 'weekly', 'monthly', 'seasonal', 'rare']);
const OWNERS = new Set(['A', 'B', 'C', 'D', 'pub']);
const DEFAULT_SIZE = {
  luggage: [42, 26, 66], clothes: [30, 25, 20], bedding: [50, 40, 30],
  books: [26, 19, 25], study: [25, 15, 12], electronics: [30, 20, 20],
  appliance: [25, 20, 30], toiletry: [30, 20, 20], storage: [44, 32, 26],
  food: [30, 20, 20], sport: [30, 20, 50], decor: [20, 20, 20],
  trash: [35, 25, 20], misc: [30, 30, 30],
};
const UNKNOWN = /不确定|不知道|未知|没量|未量|没测|未测|无法确定|不清楚|不详/;
const APPROXIMATE = /大概|左右|差不多|估计|大约|约\s*\d/;
const SPECIFICATION = /\d+(?:\.\d+)?\s*(?:寸|cm|厘米|mm|毫米)/i;

/** 全角和空格差异不影响名称、别名匹配。 */
function comparable(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** 按最长名称/别名命中，纯寸数别名必须与物品种类相容。 */
function findLibrary(name, category) {
  const text = comparable(name);
  const inch = text.match(/\d+(?:\.\d+)?寸/)?.[0];
  const monitor = /显示器|屏幕|显示屏/.test(text);
  const luggage = /行李箱|登机箱|拉杆箱/.test(text);
  const family = monitor && !luggage ? 'monitor' : luggage && !monitor ? 'luggage'
    : category === 'electronics' ? 'monitor' : category === 'luggage' ? 'luggage' : '';
  let found;
  let longest = 0;
  let specificity = 0;
  for (const entry of LIBRARY) {
    for (const alias of [entry.name, ...(entry.aliases ?? [])]) {
      const word = comparable(alias);
      if (!word || !text.includes(word) || word.length < longest) continue;
      if (/^\d+(?:\.\d+)?寸$/.test(word)) {
        if (entry.libId.startsWith('luggage-') && (monitor || (!luggage && category !== 'luggage'))) continue;
        if (entry.libId.startsWith('monitor-') && (luggage || (!monitor && category !== 'electronics'))) continue;
      }
      // 等长时用同类物品的明确寸数破除歧义，例如“显示器27寸”。
      const exactInch = inch && family && entry.libId.startsWith(`${family}-`)
        && comparable(entry.name).match(/\d+(?:\.\d+)?寸/)?.[0] === inch ? 1 : 0;
      if (word.length === longest && exactInch <= specificity) continue;
      found = entry;
      longest = word.length;
      specificity = exactInch;
    }
  }
  return found;
}

/** 先匹配未使用分句，避免同类物品的未知标记串到前面的标准件。 */
function findContext(name, library, fragments, used) {
  const word = comparable(name);
  const aliases = library ? [library.name, ...(library.aliases ?? [])].map(comparable) : [];
  let best;
  let score = 0;
  for (const allowUsed of [false, true]) {
    for (let index = 0; index < fragments.length; index += 1) {
      if (!allowUsed && used.has(index)) continue;
      const candidate = comparable(fragments[index]);
      let candidateScore = word && candidate.includes(word) ? 1000 + word.length : 0;
      if (library && findLibrary(fragments[index], library.category)?.libId === library.libId) {
        for (const alias of aliases) {
          if (candidate.includes(alias)) candidateScore = Math.max(candidateScore, 100 + alias.length);
        }
      }
      if (candidateScore > score) {
        best = index;
        score = candidateScore;
      }
    }
    if (best !== undefined) break;
  }
  if (best === undefined) return '';
  used.add(best);
  return fragments[best];
}

/** 缺省或非数值采用安全默认，有限数值裁剪到指定范围。 */
function bounded(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
}

function sizeFrom(raw, fallback) {
  return {
    w: bounded(raw?.w, fallback.w, 1, 250),
    d: bounded(raw?.d, fallback.d, 1, 250),
    h: bounded(raw?.h, fallback.h, 1, 250),
  };
}

function sizeRange(size, source) {
  const [min, max] = source === 'unknown' ? [0.5, 2] : [0.8, 1.25];
  const scale = (factor) => Object.fromEntries(Object.entries(size).map(([key, value]) => [key, Math.round(value * factor * 100) / 100]));
  return { min: scale(min), max: scale(max) };
}

/** 只复制契约允许的 flags，AI 无权写入承重、学习工具等内部字段。 */
function flagsFrom(raw, base) {
  const flags = {
    stackable: typeof raw.stackable === 'boolean' ? raw.stackable : Boolean(base?.stackable),
    canBearLoad: Boolean(base?.canBearLoad),
    rotatable: base?.rotatable !== false,
    canLieDown: Boolean(base?.canLieDown),
    hangable: typeof raw.hangable === 'boolean' ? raw.hangable : Boolean(base?.hangable),
    fragile: Boolean(base?.fragile),
    focusTool: Boolean(base?.focusTool),
    disposable: Boolean(base?.disposable),
  };
  if (raw.compressible === true) flags.compressible = 0.4;
  else if (typeof raw.compressible !== 'boolean' && typeof base?.compressible === 'number') flags.compressible = base.compressible;
  return flags;
}

/** 未确认尺寸不推定内部容积；已知外尺寸缩小时按原内外比例保守缩小。 */
function containerFrom(base, size, uncertain) {
  const original = base?.flags.container;
  if (!original || uncertain) return undefined;
  const axes = ['w', 'd', 'h'];
  if (axes.every((axis) => size[axis] === base.size[axis])) return { ...original };
  return Object.fromEntries(axes.map((axis) => {
    const value = Math.min(original[axis], size[axis], original[axis] * Math.min(1, size[axis] / base.size[axis]));
    // 向下保留小数，避免四舍五入扩大本就只是推定的内部容积。
    return [axis, Math.floor(value * 100) / 100];
  }));
}

/** 解析不包含供应商原文的固定错误，避免错误信息透传。 */
function badJson() {
  return Object.assign(new Error('物品数据格式无效'), { code: 'BAD_JSON' });
}

/**
 * 将受限 AI JSON 转为契约 Item；逐项白名单复制，不修改物品库。
 * 复杂度为 O(N×(L+F×L)+Q)，N≤60、Q≤3000，L 为物品库大小，F 为输入分句数。
 * @param {string} rawText
 * @param {{owner?:string, text?:string, photo?:boolean}} [options]
 * @returns {{items:Array<import('../core/types.js').Item>, warnings:string[]}}
 */
export function normalizeItems(rawText, { owner = 'A', text = '', photo = false } = {}) {
  let raw;
  try {
    if (typeof rawText !== 'string') throw badJson();
    const clean = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    raw = JSON.parse(clean);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) throw badJson();
  } catch {
    throw badJson();
  }

  const items = [];
  const warnings = new Set();
  const fragments = String(text ?? '').split(/[，,、；;。\n]|以及|还有|另外|和/).map((part) => part.trim()).filter(Boolean);
  const usedFragments = new Set();
  const safeOwner = OWNERS.has(owner) ? owner : 'A';
  if (raw.items.length > 60) warnings.add('物品种类超过上限，仅保留前60条。');

  for (const entry of raw.items.slice(0, 60)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.name !== 'string' || !entry.name.trim()) {
      warnings.add('已忽略缺少有效名称的物品。');
      continue;
    }
    const name = entry.name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
    if (!name) continue;
    const category = CATEGORIES.has(entry.category) ? entry.category : 'misc';
    const freq = FREQUENCIES.has(entry.freq) ? entry.freq : 'weekly';
    const library = findLibrary(name, category);
    const base = library ? makeItem(library.libId) : undefined;
    const context = findContext(name, library, fragments, usedFragments);
    const evidence = `${name} ${context}`;
    const approximate = APPROXIMATE.test(evidence);
    let confidence = ['product', 'estimated', 'unknown'].includes(entry.size_confidence) ? entry.size_confidence : 'estimated';
    if (UNKNOWN.test(evidence)) confidence = 'unknown';
    else if (approximate && confidence !== 'unknown') confidence = 'estimated';
    if (photo) confidence = 'estimated';

    const defaults = DEFAULT_SIZE[category];
    const defaultSize = base?.size ?? { w: defaults[0], d: defaults[1], h: defaults[2] };
    const aiSize = sizeFrom(entry.size_cm, defaultSize);
    // 用户说“大概”时保留估计尺寸，不能因命中库别名就提升为商品参数。
    const useLibrary = Boolean(library && confidence !== 'unknown' && !approximate && !photo);
    const explicitSize = SPECIFICATION.test(evidence);
    const size = useLibrary && !explicitSize ? { ...base.size } : aiSize;
    const source = photo ? 'estimated' : useLibrary ? 'product' : confidence;
    const qty = Math.floor(bounded(entry.qty, 1, 1, 50));
    const months = Array.isArray(entry.months)
      ? [...new Set(entry.months.filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))] : [];
    const flags = flagsFrom(entry, base?.flags);
    const explicitPower = evidence.match(/(\d+(?:\.\d+)?)\s*(?:w|瓦)/i);
    const power = explicitPower ? Number(explicitPower[1]) : entry.power_w;
    const powerW = typeof power === 'number' && Number.isFinite(power) && power >= 0 ? power : null;
    let note = typeof entry.note === 'string' ? entry.note.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 400) : '';
    if (photo) {
      const horizontal = { left: '左侧', center: '中间', right: '右侧' };
      const depth = { front: '前方', back: '后方' };
      const hint = entry.position_hint;
      // 位置只写入契约已有的 note，不把未校验字段或假坐标传给规划器。
      const parts = [typeof hint?.horizontal === 'string' && Object.hasOwn(horizontal, hint.horizontal) ? horizontal[hint.horizontal] : '',
        typeof hint?.depth === 'string' && Object.hasOwn(depth, hint.depth) ? depth[hint.depth] : ''].filter(Boolean);
      if (parts.length) note = `照片位置：${parts.join('、')}；${note}`.slice(0, 400);
    }
    if (!CATEGORIES.has(entry.category) || !FREQUENCIES.has(entry.freq)) warnings.add('部分物品分类或使用频率已使用默认值。');
    if (confidence === 'unknown') warnings.add('部分物品尺寸待确认，请测量后校准。');
    if (qty !== entry.qty) warnings.add('部分物品数量已修正为1至50的整数。');
    if (['w', 'd', 'h'].some((key) => aiSize[key] !== entry.size_cm?.[key])) warnings.add('部分尺寸已修正为有效范围。');

    const pieces = category === 'books' ? Math.ceil(qty / 10) : qty;
    for (let index = 0; index < pieces; index += 1) {
      const fraction = category === 'books' ? Math.min(10, qty - index * 10) / 10 : 1;
      const itemSize = { ...size, h: Math.max(1, Math.round(size.h * fraction * 100) / 100) };
      const itemFlags = { ...flags };
      const container = containerFrom(base, itemSize, source === 'unknown' || source === 'estimated');
      if (container) itemFlags.container = container;
      const item = {
        id: `ai-${String(items.length + 1).padStart(3, '0')}`,
        name: pieces > 1 ? `${name} #${index + 1}` : name,
        category,
        size: itemSize,
        sizeSource: source,
        freq,
        owner: safeOwner,
        flags: itemFlags,
        powerW,
      };
      if (library) item.libId = library.libId;
      // AI 未提供有效月份时沿用库的季节设置；明确月份仍以 AI 为准。
      if (months.length) item.months = [...months];
      else if (base?.months?.length) item.months = [...base.months];
      if (source === 'unknown' || source === 'estimated') item.sizeRange = sizeRange(itemSize, source);
      if (flags.hangable && base?.hang) item.hang = { ...base.hang };
      if (base?.preferred) item.preferred = [...base.preferred];
      if (typeof base?.growthPerSemester === 'number') item.growthPerSemester = base.growthPerSemester;
      if (note) item.note = note;
      items.push(item);
    }
  }
  return { items, warnings: [...warnings] };
}
