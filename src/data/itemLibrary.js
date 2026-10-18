// 物品库（docs/07 §2）。尺寸是常见规格或估计值，W×D×H 指立着摆放时的尺寸。
// LIBRARY 是有序数组（解析时按顺序遍历别名）；按 libId 查找用 LIBRARY_BY_ID 或 getLib()。

/** @typedef {import('../core/types.js').Item} Item */

const s = (w, d, h) => ({ w, d, h });

/**
 * 每条：{ libId, name, aliases, category, size, sizeSource, freq, months?, flags, hang?, powerW?, preferred, growthPerSemester? }
 * flags 只写非默认值；makeItem 时补齐其余默认值。
 */
export const LIBRARY = Object.freeze([
  { libId: 'luggage-20', name: '20寸行李箱', aliases: ['20寸', '登机箱'], category: 'luggage', size: s(36, 23, 55), sizeSource: 'product', freq: 'rare',
    flags: { canBearLoad: true, canLieDown: true, container: s(32, 19, 50) }, preferred: ['underDesk', 'pubEntry'] },
  { libId: 'luggage-24', name: '24寸行李箱', aliases: ['24寸'], category: 'luggage', size: s(42, 26, 66), sizeSource: 'product', freq: 'rare',
    flags: { canBearLoad: true, canLieDown: true, container: s(38, 22, 61) }, preferred: ['underDesk', 'pubEntry'] },
  { libId: 'luggage-28', name: '28寸行李箱', aliases: ['28寸'], category: 'luggage', size: s(48, 29, 77), sizeSource: 'product', freq: 'rare',
    flags: { canBearLoad: true, canLieDown: true, container: s(44, 25, 72) }, preferred: ['pubEntry', 'balcony'] },
  { libId: 'bag-move', name: '折叠搬家袋', aliases: ['搬家袋', '编织袋'], category: 'storage', size: s(60, 35, 40), sizeSource: 'estimated', freq: 'rare',
    flags: { compressible: 0.3 }, preferred: ['bedFoot', 'wardrobeBottom'] },
  { libId: 'box-l', name: '大号收纳箱', aliases: ['收纳箱', '整理箱'], category: 'storage', size: s(55, 40, 33), sizeSource: 'product', freq: 'monthly',
    flags: { stackable: true, canBearLoad: true }, preferred: ['underDesk', 'bedFoot'] },
  { libId: 'box-m', name: '中号收纳箱', aliases: ['收纳盒'], category: 'storage', size: s(44, 32, 26), sizeSource: 'product', freq: 'monthly',
    flags: { stackable: true, canBearLoad: true }, preferred: ['underDesk', 'wardrobeBottom'] },
  { libId: 'box-desk', name: '桌面收纳盒', aliases: ['笔筒', '桌面收纳'], category: 'study', size: s(25, 15, 12), sizeSource: 'estimated', freq: 'daily',
    flags: {}, preferred: ['desk', 'hutch'] },
  { libId: 'quilt-winter', name: '冬被', aliases: ['被子', '棉被'], category: 'bedding', size: s(50, 40, 30), sizeSource: 'estimated', freq: 'seasonal', months: [11, 12, 1, 2, 3],
    flags: { stackable: true, compressible: 0.35 }, preferred: ['bed', 'bedFoot'] },
  { libId: 'quilt-summer', name: '夏凉被', aliases: ['空调被', '凉被'], category: 'bedding', size: s(40, 35, 12), sizeSource: 'estimated', freq: 'seasonal', months: [5, 6, 7, 8, 9],
    flags: { stackable: true, compressible: 0.5 }, preferred: ['bed'] },
  { libId: 'pillow', name: '枕头', aliases: [], category: 'bedding', size: s(48, 30, 12), sizeSource: 'estimated', freq: 'daily',
    flags: { stackable: true }, preferred: ['bed'] },
  { libId: 'down-jacket', name: '羽绒服', aliases: ['棉服', '棉衣'], category: 'clothes', size: s(40, 30, 25), sizeSource: 'estimated', freq: 'seasonal', months: [11, 12, 1, 2, 3],
    flags: { hangable: true, compressible: 0.4 }, hang: { thickness: 10, length: 90 }, preferred: ['wardrobeHang'] },
  { libId: 'coat', name: '外套', aliases: ['夹克', '卫衣', '风衣'], category: 'clothes', size: s(35, 28, 12), sizeSource: 'estimated', freq: 'weekly', months: [9, 10, 11, 3, 4, 5],
    flags: { hangable: true }, hang: { thickness: 6, length: 80 }, preferred: ['wardrobeHang'] },
  { libId: 'clothes-stack', name: '衣物（一叠 10 件）', aliases: ['衣服', 'T恤', 't恤', '衬衫', '裤子'], category: 'clothes', size: s(30, 25, 20), sizeSource: 'estimated', freq: 'daily',
    flags: { stackable: true, canBearLoad: true }, preferred: ['wardrobeBottom'] },
  { libId: 'shoes', name: '鞋（一双）', aliases: ['运动鞋', '鞋子', '拖鞋', '鞋'], category: 'clothes', size: s(32, 20, 12), sizeSource: 'estimated', freq: 'daily',
    flags: { stackable: true }, preferred: ['pubEntry', 'wardrobeBottom'] },
  { libId: 'shoe-rack', name: '鞋架', aliases: [], category: 'storage', size: s(50, 25, 60), sizeSource: 'product', freq: 'daily',
    flags: { canBearLoad: true }, preferred: ['pubEntry'] },
  { libId: 'laptop', name: '笔记本电脑', aliases: ['电脑', '笔记本', '平板'], category: 'electronics', size: s(32, 22, 2), sizeSource: 'product', freq: 'daily',
    flags: { focusTool: true }, preferred: ['desk'] },
  { libId: 'monitor-24', name: '24寸显示器', aliases: ['24寸', '显示器', '屏幕'], category: 'electronics', size: s(54, 18, 42), sizeSource: 'product', freq: 'daily',
    flags: { fragile: true }, preferred: ['desk'] },
  { libId: 'monitor-27', name: '27寸显示器', aliases: ['27寸'], category: 'electronics', size: s(61, 20, 46), sizeSource: 'product', freq: 'daily',
    flags: { fragile: true }, preferred: ['desk'] },
  { libId: 'riser', name: '显示器增高架', aliases: ['增高架'], category: 'storage', size: s(55, 20, 9), sizeSource: 'product', freq: 'daily',
    flags: { canBearLoad: true }, preferred: ['desk'] },
  { libId: 'lamp', name: '台灯', aliases: [], category: 'electronics', size: s(15, 15, 40), sizeSource: 'estimated', freq: 'daily',
    flags: {}, preferred: ['desk'] },
  { libId: 'power-strip', name: '插线板', aliases: ['插排', '排插'], category: 'electronics', size: s(30, 6, 4), sizeSource: 'product', freq: 'daily',
    flags: {}, preferred: ['desk', 'underDeskBack'] },
  { libId: 'keyboard', name: '键盘', aliases: [], category: 'electronics', size: s(44, 13, 3), sizeSource: 'product', freq: 'daily',
    flags: {}, preferred: ['desk'] },
  { libId: 'headphones', name: '耳机', aliases: ['耳机盒'], category: 'electronics', size: s(20, 18, 9), sizeSource: 'estimated', freq: 'daily',
    flags: {}, preferred: ['hutch', 'desk'] },
  { libId: 'fan-desk', name: '台式小风扇', aliases: ['风扇', '电扇', '小风扇'], category: 'appliance', size: s(25, 20, 35), sizeSource: 'estimated', freq: 'seasonal', months: [6, 7, 8, 9],
    flags: {}, powerW: 30, preferred: ['desk', 'hutch'] },
  { libId: 'hairdryer', name: '吹风机', aliases: ['电吹风'], category: 'appliance', size: s(25, 10, 25), sizeSource: 'estimated', freq: 'weekly',
    flags: {}, powerW: null, preferred: ['wardrobeBottom', 'balcony'], note: '需确认额定功率 ≤ 1000W' },
  { libId: 'kettle', name: '电热水壶', aliases: ['烧水壶', '热水壶', '电水壶'], category: 'appliance', size: s(22, 16, 25), sizeSource: 'estimated', freq: 'daily',
    flags: {}, powerW: 1500, preferred: [] },
  // 以下三项由关键词直接禁用，freq 在表中为"—"，这里取 'rare'
  { libId: 'rice-cooker', name: '电饭锅', aliases: ['电饭煲'], category: 'appliance', size: s(25, 25, 22), sizeSource: 'estimated', freq: 'rare',
    flags: {}, powerW: null, preferred: [] },
  { libId: 'e-blanket', name: '电热毯', aliases: [], category: 'appliance', size: s(40, 30, 10), sizeSource: 'estimated', freq: 'rare',
    flags: {}, powerW: null, preferred: [] },
  { libId: 'heater', name: '取暖器', aliases: ['小太阳', '暖风机', '电暖器'], category: 'appliance', size: s(30, 20, 40), sizeSource: 'estimated', freq: 'rare',
    flags: {}, powerW: null, preferred: [] },
  { libId: 'books-10', name: '书（10 本一摞）', aliases: ['书', '教材', '课本'], category: 'books', size: s(26, 19, 25), sizeSource: 'estimated', freq: 'weekly',
    flags: { stackable: true, canBearLoad: true }, preferred: ['hutch', 'desk'], growthPerSemester: 0.5 },
  { libId: 'folder', name: '讲义/文件夹', aliases: ['讲义', '资料', '试卷', '文件夹'], category: 'study', size: s(31, 24, 4), sizeSource: 'estimated', freq: 'daily',
    flags: { stackable: true, canBearLoad: true }, preferred: ['desk', 'hutch'] },
  { libId: 'cup', name: '水杯', aliases: ['杯子', '保温杯'], category: 'food', size: s(8, 8, 20), sizeSource: 'estimated', freq: 'daily',
    flags: {}, preferred: ['desk'] },
  { libId: 'snack-box', name: '零食箱', aliases: ['零食'], category: 'food', size: s(30, 20, 20), sizeSource: 'estimated', freq: 'daily',
    flags: { stackable: true, canBearLoad: true }, preferred: ['underDesk', 'hutch'] },
  { libId: 'toiletry-basket', name: '洗漱篮', aliases: ['洗漱用品', '洗漱包'], category: 'toiletry', size: s(30, 20, 20), sizeSource: 'estimated', freq: 'daily',
    flags: {}, preferred: ['sinkShelf', 'balcony'] },
  { libId: 'skincare', name: '护肤品', aliases: ['化妆品'], category: 'toiletry', size: s(20, 12, 15), sizeSource: 'estimated', freq: 'daily',
    flags: {}, preferred: ['hutch', 'sinkShelf'] },
  { libId: 'basin', name: '盆', aliases: ['脸盆', '洗衣盆'], category: 'toiletry', size: s(40, 40, 15), sizeSource: 'estimated', freq: 'daily',
    flags: { stackable: true }, preferred: ['balcony'] },
  { libId: 'bucket', name: '桶', aliases: ['水桶', '洗衣桶'], category: 'toiletry', size: s(30, 30, 35), sizeSource: 'estimated', freq: 'weekly',
    flags: {}, preferred: ['balcony'] },
  { libId: 'hangers', name: '衣架（20 个）', aliases: ['衣架'], category: 'toiletry', size: s(40, 5, 22), sizeSource: 'estimated', freq: 'weekly',
    flags: {}, preferred: ['balcony', 'wardrobeBottom'] },
  { libId: 'umbrella', name: '雨伞', aliases: ['伞'], category: 'misc', size: s(8, 8, 60), sizeSource: 'estimated', freq: 'weekly',
    flags: { hangable: true }, hang: { thickness: 8, length: 60 }, preferred: ['doorBack', 'pubEntry'] },
  { libId: 'backpack', name: '书包', aliases: ['双肩包', '背包'], category: 'misc', size: s(32, 18, 45), sizeSource: 'estimated', freq: 'daily',
    flags: { hangable: true }, hang: { thickness: 18, length: 45 }, preferred: ['doorBack', 'pubEntry'] },
  { libId: 'guitar', name: '吉他', aliases: ['尤克里里'], category: 'sport', size: s(40, 12, 105), sizeSource: 'estimated', freq: 'weekly',
    flags: { fragile: true }, preferred: ['pubEntry'] },
  { libId: 'yoga-mat', name: '瑜伽垫', aliases: [], category: 'sport', size: s(12, 12, 62), sizeSource: 'estimated', freq: 'weekly',
    flags: {}, preferred: ['pubEntry', 'bedFoot'] },
  { libId: 'parcel', name: '快递盒', aliases: ['纸箱', '快递'], category: 'trash', size: s(35, 25, 20), sizeSource: 'estimated', freq: 'rare',
    flags: { disposable: true }, preferred: [] }
]);

/** 按 libId 索引 */
export const LIBRARY_BY_ID = Object.freeze(Object.fromEntries(LIBRARY.map((e) => [e.libId, e])));

/** @param {string} libId */
export function getLib(libId) {
  return LIBRARY_BY_ID[libId];
}

/** flags 默认值：rotatable 为 true，其余 false（docs/07 §2） */
export const DEFAULT_FLAGS = Object.freeze({
  stackable: false, canBearLoad: false, rotatable: true, canLieDown: false, hangable: false,
  fragile: false, focusTool: false, disposable: false
});

const r1 = (v) => Math.round(v * 10) / 10;
const scale = (size, k) => ({ w: r1(size.w * k), d: r1(size.d * k), h: r1(size.h * k) });

/**
 * 按来源给出尺寸范围：estimated → ×[0.8, 1.25]；unknown → ×[0.5, 2]；其余 undefined。
 * @param {{w:number,d:number,h:number}} size
 * @param {string} sizeSource
 */
export function rangeFor(size, sizeSource) {
  if (sizeSource === 'estimated') return { min: scale(size, 0.8), max: scale(size, 1.25) };
  if (sizeSource === 'unknown') return { min: scale(size, 0.5), max: scale(size, 2) };
  return undefined;
}

/**
 * 由物品库条目生成一个符合契约的 Item。
 * overrides 可覆盖任意字段；flags 按字段合并。未给 id 时用 libId（调用方负责保证唯一）。
 * 未显式给 sizeRange 时，按最终的 size 和 sizeSource 重新计算。
 * @param {string} libId
 * @param {Partial<Item>} [overrides]
 * @returns {Item}
 */
export function makeItem(libId, overrides = {}) {
  const lib = LIBRARY_BY_ID[libId];
  if (!lib) throw new Error(`makeItem：物品库里没有 ${libId}`);
  const size = { ...(overrides.size ?? lib.size) };
  const sizeSource = overrides.sizeSource ?? lib.sizeSource;
  const flags = { ...DEFAULT_FLAGS, ...lib.flags, ...(overrides.flags ?? {}) };
  if (flags.container) flags.container = { ...flags.container };
  /** @type {any} */
  const item = {
    id: overrides.id ?? libId,
    name: overrides.name ?? lib.name,
    libId,
    category: overrides.category ?? lib.category,
    size,
    sizeSource,
    freq: overrides.freq ?? lib.freq,
    owner: overrides.owner ?? 'A',
    flags
  };
  const sizeRange = 'sizeRange' in overrides ? overrides.sizeRange : rangeFor(size, sizeSource);
  if (sizeRange) item.sizeRange = structuredClone(sizeRange);
  const months = 'months' in overrides ? overrides.months : lib.months;
  if (months) item.months = [...months];
  const hang = 'hang' in overrides ? overrides.hang : lib.hang;
  if (hang) item.hang = { ...hang };
  const powerW = 'powerW' in overrides ? overrides.powerW : lib.powerW;
  if (powerW !== undefined) item.powerW = powerW;
  const preferred = overrides.preferred ?? lib.preferred;
  if (preferred && preferred.length) item.preferred = [...preferred];
  const g = overrides.growthPerSemester ?? lib.growthPerSemester;
  if (g !== undefined) item.growthPerSemester = g;
  const note = overrides.note ?? lib.note;
  if (note !== undefined) item.note = note;
  return item;
}
