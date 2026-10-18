// 规则文本解析（docs/05 §8）：AI 不可用时的离线兜底。
// 流程：规范化 → 分句 → 逐段抽取数量/寸/尺寸/功率/不确定词 → 匹配物品库最长别名 → 展开数量 → 编号。
// 复杂度 O(片段数 × 物品库别名数)。

import { LIBRARY, LIBRARY_BY_ID, makeItem, rangeFor, DEFAULT_FLAGS } from '../data/itemLibrary.js';

/** 每个类别的"中号"默认尺寸（未匹配物品用） */
export const CATEGORY_DEFAULT_SIZE = Object.freeze({
  luggage: { w: 42, d: 26, h: 66 },
  clothes: { w: 30, d: 25, h: 20 },
  bedding: { w: 50, d: 40, h: 30 },
  books: { w: 26, d: 19, h: 25 },
  study: { w: 25, d: 15, h: 12 },
  electronics: { w: 30, d: 20, h: 15 },
  appliance: { w: 25, d: 20, h: 30 },
  toiletry: { w: 30, d: 20, h: 20 },
  storage: { w: 44, d: 32, h: 26 },
  food: { w: 20, d: 15, h: 15 },
  sport: { w: 40, d: 15, h: 80 },
  decor: { w: 20, d: 15, h: 20 },
  trash: { w: 35, d: 25, h: 20 },
  misc: { w: 30, d: 30, h: 30 }
});

/** guessCategory 关键词表，命中第一个即止 */
const GUESS = [
  [['箱', '包', '袋'], 'storage'],
  [['衣', '裤', '鞋', '袜'], 'clothes'],
  [['被', '枕', '褥', '毯'], 'bedding'],
  [['书', '本', '册'], 'books'],
  [['笔', '纸', '尺'], 'study'],
  [['机', '屏', '线', '灯', '电脑'], 'electronics'],
  [['壶', '锅', '器', '扇'], 'appliance'],
  [['盆', '桶', '刷', '巾', '洗'], 'toiletry'],
  [['零食', '饮料', '杯'], 'food'],
  [['球', '拍', '琴', '垫'], 'sport']
];

export function guessCategory(frag) {
  for (const [kws, cat] of GUESS) if (kws.some((k) => frag.includes(k))) return cat;
  return 'misc';
}

/** 有"寸"时的规格族：同前缀里取最接近的一档；距离相同时取大的一档（宁可保守） */
const FAMILIES = [
  { prefix: 'luggage-', keywords: ['行李箱', '拉杆箱', '登机箱', '箱'], sizes: [20, 24, 28] },
  { prefix: 'monitor-', keywords: ['显示器', '屏幕', '屏'], sizes: [24, 27] }
];

const QTY_UNIT = '个|本|件|套|双|台|张|条|盒|瓶|把|只|床|叠|摞';
const RE_QTY = new RegExp(`(\\d+)\\s*(${QTY_UNIT})`);
// 段首数字：后面不能紧跟寸、功率、尺寸、小数
const RE_LEAD = /^(\d+)(?!\s*(?:寸|w|瓦|[x×*]\s*\d|cm|厘米|mm|毫米|\d|\.))/;
const RE_XQTY = /[x×*]\s*(\d+)\s*$/;
const RE_INCH = /(\d+)\s*寸/;
const RE_DIMS = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\s*(cm|厘米|mm|毫米)?/;
const RE_POWER = /(\d+)\s*(w|瓦)/;
const RE_UNKNOWN = /不确定|不知道|未知|没量/;
const RE_ROUGH = /大概|左右|差不多/;
const RE_SPLIT = /[，,、；;。\n]|和|以及|还有|另外/;

const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 中文数字串 → 数字（支持到"百"；"十几"按 12） */
function cnToNum(s) {
  if (s === '十几') return 12;
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT) cur = CN_DIGIT[ch];
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
  }
  return total + cur;
}

/** 规范化：全角转半角、中文数字转阿拉伯数字。（小写在匹配时另做，保留原文大小写用于显示） */
function normalize(text) {
  let s = '';
  for (const ch of String(text ?? '')) {
    const c = ch.charCodeAt(0);
    if (c === 0x3000) s += ' ';
    else if (c >= 0xff01 && c <= 0xff5e) s += String.fromCharCode(c - 0xfee0);
    else s += ch;
  }
  s = s.replace(/×/g, 'x');
  // 单独出现的"零"不是数字（零食、零钱），只有和其他中文数字相连时才转换（一百零五）
  return s.replace(/十几|[零一二两三四五六七八九十百]+/g, (m) => (/^零+$/.test(m) ? m : String(cnToNum(m))));
}

/** 在物品库的 name 和 aliases 中找"出现在 frag 里的最长别名"；同长时按 LIBRARY 顺序 */
function matchLib(lower) {
  let best = null, bestLen = 0;
  for (const e of LIBRARY) {
    for (const a of [e.name, ...e.aliases]) {
      const al = a.toLowerCase();
      if (al.length > bestLen && lower.includes(al)) { best = e; bestLen = al.length; }
    }
  }
  return best;
}

function pickBySize(family, inch) {
  let best = family.sizes[0];
  for (const s of family.sizes) {
    if (Math.abs(s - inch) < Math.abs(best - inch) || (Math.abs(s - inch) === Math.abs(best - inch) && s > best)) best = s;
  }
  return LIBRARY_BY_ID[`${family.prefix}${best}`];
}

/**
 * @param {string} text
 * @param {{ owner?: string, idPrefix?: string }} [opts]
 * @returns {import('../core/types.js').Item[]}
 */
export function parseItemsText(text, opts = {}) {
  const owner = opts.owner ?? 'A';
  const idPrefix = opts.idPrefix ?? 'it';
  const frags = normalize(text).split(RE_SPLIT).map((f) => f.trim()).filter((f) => /[\p{L}]/u.test(f));
  const out = [];
  let seq = 0;
  const nextId = () => `${idPrefix}-${String(++seq).padStart(3, '0')}`;

  for (const frag of frags) {
    const lower = frag.toLowerCase();
    // 数量
    let qty = 1, qtyText = '';
    let m;
    if ((m = lower.match(RE_QTY))) { qty = +m[1]; qtyText = frag.substr(m.index, m[0].length); }
    else if ((m = lower.match(RE_LEAD))) { qty = +m[1]; qtyText = frag.substr(0, m[0].length); }
    else if (!RE_DIMS.test(lower) && (m = lower.match(RE_XQTY))) { qty = +m[1]; qtyText = frag.substr(m.index, m[0].length); }
    qty = Math.max(1, Math.min(qty, 200));
    const inchM = lower.match(RE_INCH);
    const inch = inchM ? +inchM[1] : null;
    const dimsM = lower.match(RE_DIMS);
    const powM = lower.match(RE_POWER);
    const powerW = powM ? +powM[1] : undefined;
    const sizeSourceHint = RE_UNKNOWN.test(lower) ? 'unknown' : RE_ROUGH.test(lower) ? 'estimated' : null;

    // 物品库匹配；有"寸"时在同一规格族里取最接近的一档
    let lib = matchLib(lower);
    let inchExact = true;
    if (inch != null) {
      const fam = (lib && FAMILIES.find((f) => lib.libId.startsWith(f.prefix))) ||
        FAMILIES.find((f) => f.keywords.some((k) => lower.includes(k)));
      if (fam) {
        lib = pickBySize(fam, inch);
        inchExact = fam.sizes.includes(inch);
      }
    }

    // 显示名：去掉数量词；正好就是库名/别名时用库名
    let cleaned = (qtyText ? frag.replace(qtyText, '') : frag).replace(/^[的\s]+|[的\s]+$/g, '').trim() || frag;
    let name;
    if (lib) {
      const plain = [lib.name, ...lib.aliases].some((a) => a.toLowerCase() === cleaned.toLowerCase());
      name = plain ? lib.name : cleaned;
    } else {
      name = cleaned;
    }

    // 尺寸
    const category = lib ? lib.category : guessCategory(lower);
    const baseSize = lib ? lib.size : CATEGORY_DEFAULT_SIZE[category];
    let size = { ...baseSize };
    let sizeSource = lib ? (inchExact ? lib.sizeSource : 'estimated') : 'unknown';
    if (dimsM) {
      const k = dimsM[4] === 'mm' || dimsM[4] === '毫米' ? 0.1 : 1;
      size = { w: +dimsM[1] * k, d: +dimsM[2] * k, h: dimsM[3] != null ? +dimsM[3] * k : baseSize.h };
      sizeSource = 'product';
    }
    if (sizeSourceHint) sizeSource = sizeSourceHint;

    const build = (id, nm, sz) => {
      if (lib) {
        /** @type {any} */
        const ov = { id, name: nm, size: sz, sizeSource, owner };
        if (powerW !== undefined) ov.powerW = powerW;
        return makeItem(lib.libId, ov);
      }
      /** @type {any} */
      const it = { id, name: nm, category, size: sz, sizeSource, freq: 'weekly', owner, flags: { ...DEFAULT_FLAGS } };
      const rg = rangeFor(sz, sizeSource);
      if (rg) it.sizeRange = rg;
      if (category === 'trash') it.flags.disposable = true;
      if (powerW !== undefined) it.powerW = powerW;
      else if (category === 'appliance') it.powerW = null;
      return it;
    };

    // 展开数量
    if (category === 'books') {
      // 每 10 本合成一摞，最后一摞的高度按余数比例缩小
      const stacks = Math.ceil(qty / 10);
      const per = lib ? 10 : 1;          // 未匹配的书类（如"笔记本"）不合摞
      if (per === 1) {
        for (let k = 0; k < qty; k++) out.push(build(nextId(), qty > 1 ? `${name}#${k + 1}` : name, { ...size }));
        continue;
      }
      for (let k = 0; k < stacks; k++) {
        const rem = qty - k * 10;
        const h = rem >= 10 ? size.h : Math.round(size.h * rem / 10 * 10) / 10;
        out.push(build(nextId(), stacks > 1 ? `${name}#${k + 1}` : name, { ...size, h }));
      }
    } else {
      for (let k = 0; k < qty; k++) out.push(build(nextId(), qty > 1 ? `${name}#${k + 1}` : name, { ...size }));
    }
  }
  return out;
}
