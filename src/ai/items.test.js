import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItems } from './normalize.js';
import { buildRoom, makeItem, parseItemsText, planMoveIn } from '../planner/index.js';
import { forgetChat } from './client.js';
import { makeItemMessages } from './prompts.js';

const acceptanceText = '24寸行李箱，两床被子，27寸显示器，书20本，1500W电热水壶，一个尺寸不确定的收纳箱';
const audienceText = '台灯、两摞书、水杯、零食箱、快递盒、耳机';

/** 使用完全合成的模型结果，不需要真实 AI 配置。 */
function item(overrides = {}) {
  return {
    name: '特殊测试物件', qty: 1, category: 'misc', size_cm: { w: 40, d: 20, h: 10 },
    size_confidence: 'estimated', freq: 'weekly', months: [], power_w: null,
    hangable: false, stackable: false, compressible: false, note: '',
    safety: { status: 'clear', reason: '普通测试物品，未发现宿舍安全风险。' }, ...overrides,
  };
}

function normalize(items, options = {}) {
  return normalizeItems(JSON.stringify({ items }), options);
}

function acceptanceItems() {
  return [
    item({ name: '24寸行李箱', category: 'luggage', size_cm: { w: 42, d: 26, h: 66 }, size_confidence: 'product', freq: 'rare' }),
    item({ name: '被子', qty: 2, category: 'bedding', size_cm: { w: 50, d: 40, h: 30 }, freq: 'seasonal', months: [11, 12, 1, 2, 3], stackable: true, compressible: true }),
    item({ name: '27寸显示器', category: 'electronics', size_cm: { w: 61, d: 20, h: 46 }, size_confidence: 'product', freq: 'daily' }),
    item({ name: '书', qty: 20, category: 'books', size_cm: { w: 26, d: 19, h: 25 }, stackable: true }),
    item({ name: '电热水壶', category: 'appliance', size_cm: { w: 22, d: 16, h: 25 }, power_w: 1500, freq: 'daily' }),
    item({ name: '收纳箱', category: 'storage', size_cm: { w: 44, d: 32, h: 26 }, size_confidence: 'unknown' }),
  ];
}

test('六条验收模型结果按数量展开为八个契约物品', () => {
  const { items, warnings } = normalize(acceptanceItems(), { owner: 'B', text: acceptanceText });
  assert.equal(items.length, 8);
  assert.equal(items.filter(({ category }) => category === 'bedding').length, 2);
  assert.equal(items.filter(({ category }) => category === 'books').length, 2);
  assert.equal(items.find(({ category }) => category === 'appliance').powerW, 1500);
  assert.ok(['unknown', 'estimated'].includes(items.at(-1).sizeSource));
  assert.deepEqual(items.map(({ id }) => id), Array.from({ length: 8 }, (_, index) => `ai-${String(index + 1).padStart(3, '0')}`));
  assert.ok(items.every(({ owner }) => owner === 'B'));
  assert.ok(Array.isArray(warnings));
});

test('21 本书合成三摞，余下一本的高度是 2.5cm', () => {
  const { items } = normalize([item({ name: '书', category: 'books', qty: 21, size_cm: { w: 26, d: 19, h: 25 } })]);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(({ size }) => size.h), [25, 25, 2.5]);
  assert.ok(items.every(({ size }) => size.w === 26 && size.d === 19));
});

for (const text of ['两摞书', '二摞书', '２摞书', '书2摞', '两叠书', '2.0摞书']) {
  for (const qty of [2, 20]) {
    test(`原文 ${text} 覆盖模型 qty=${qty}，保持两摞完整高度`, () => {
      const { items } = normalize([item({ name: '书（一摞）', category: 'books', qty })], { text });
      assert.equal(items.length, 2);
      assert.ok(items.every(({ libId, size }) => libId === 'books-10' && size.h === 25));
    });
  }
}

test('原文按本计数时不重复乘十，余数高度和原有数量上限保留', () => {
  for (const [text, qty, heights] of [
    ['20本书', 20, [25, 25]],
    ['20.0本书', 20, [25, 25]],
    ['21本书', 2, [25, 25, 2.5]],
    ['十摞书', 10, [25, 25, 25, 25, 25]],
    ['100本书', 100, [25, 25, 25, 25, 25]],
  ]) {
    const { items } = normalize([item({ name: '书', category: 'books', qty })], { text });
    assert.deepEqual(items.map(({ size }) => size.h), heights, text);
  }
});

test('多种书按各自原文分句校正数量，不把前一条的摞数套到下一条', () => {
  const rows = [item({ name: '教材', category: 'books', qty: 2 }), item({ name: '课外书', category: 'books', qty: 3 })];
  for (const entries of [rows, [...rows].reverse()]) {
    const { items } = normalize(entries, { text: '两摞教材、3本课外书' });
    assert.deepEqual(items.filter(({ name }) => name.startsWith('教材')).map(({ size }) => size.h), [25, 25]);
    assert.deepEqual(items.filter(({ name }) => name.startsWith('课外书')).map(({ size }) => size.h), [7.5]);
  }
});

test('照片和没有匹配原文时不从模型名或库名推断摞数', () => {
  const books = item({ name: '两摞书', category: 'books', qty: 2, size_cm: { w: 26, d: 19, h: 25 } });
  for (const options of [{}, { photo: true, text: '两摞书' }]) {
    const { items } = normalize([books], options);
    assert.equal(items.length, 1);
    assert.equal(items[0].size.h, 5);
  }
});

test('非法枚举使用默认值，尺寸和数量截断，月份仅保留有效整数', () => {
  const { items } = normalize([item({
    name: '不匹配库的测试物件', category: 'invalid', freq: 'invalid', qty: 99,
    size_cm: { w: -10, d: 800, h: 0 }, months: [0, 1, 12, 13, 2.5, '3', null],
  })]);
  assert.equal(items.length, 50);
  for (const result of items) {
    assert.equal(result.category, 'misc');
    assert.equal(result.freq, 'weekly');
    assert.deepEqual(result.size, { w: 1, d: 250, h: 1 });
    assert.deepEqual(result.months, [1, 12]);
  }
});

test('数量下限为一，不产生零件或负件物品', () => {
  const { items } = normalize([item({ qty: -4 })]);
  assert.equal(items.length, 1);
});

test('只处理模型结果的前六十条', () => {
  const { items } = normalize(Array.from({ length: 65 }, (_, index) => item({ name: `特殊测试物件${index}` })));
  assert.equal(items.length, 60);
  assert.equal(items[59].id, 'ai-060');
});

test('逐项坏数据被跳过，不丢弃同一批次的有效项', () => {
  const { items } = normalize([null, [], 3, '错误类型', {}, { name: '' }, item()]);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '特殊测试物件');
  assert.equal(items[0].id, 'ai-001');
});

for (const raw of ['不是 JSON', 'null', '[]', '{}', '{"items":{}}']) {
  test(`非法顶层结果 ${raw} 抛 BAD_JSON`, () => {
    assert.throws(() => normalizeItems(raw), { code: 'BAD_JSON' });
  });
}

test('兼容 Markdown JSON 代码围栏', () => {
  const raw = `\`\`\`json\n${JSON.stringify({ items: [item()] })}\n\`\`\``;
  assert.equal(normalizeItems(raw).items.length, 1);
});

test('物品库选择最长别名，使用库尺寸并保留库标记', () => {
  const { items: [result] } = normalize([item({ name: '桌面收纳盒', category: 'study' })]);
  assert.equal(result.libId, 'box-desk');
  assert.deepEqual(result.size, makeItem('box-desk').size);
  assert.equal(result.sizeSource, 'product');
});

test('AI 返回空月份时，外套和夏凉被回退到物品库的季节月份', () => {
  const { items } = normalize([
    item({ name: '外套', category: 'clothes', qty: 2, months: [] }),
    item({ name: '夏凉被', category: 'bedding', months: [] }),
  ]);
  assert.deepEqual(items[0].months, makeItem('coat').months);
  assert.deepEqual(items[1].months, makeItem('coat').months);
  assert.deepEqual(items[2].months, makeItem('quilt-summer').months);
  assert.notEqual(items[0].months, items[1].months);
  items[0].months.push(8);
  assert.deepEqual(items[1].months, makeItem('coat').months);
});

test('AI 明确给出非空月份时，保持 AI 月份而不合并物品库默认值', () => {
  const months = [4, 5, 6];
  const { items: [result] } = normalize([item({ name: '外套', category: 'clothes', months })]);
  assert.deepEqual(result.months, months);
  assert.notDeepEqual(result.months, makeItem('coat').months);
});

test('24寸显示器不会误匹配为24寸行李箱，明确规格保留 AI 尺寸', () => {
  const size = { w: 55, d: 19, h: 43 };
  const { items: [result] } = normalize([item({
    name: '24寸显示器', category: 'electronics', size_cm: size, size_confidence: 'product',
  })], { text: '24寸显示器' });
  assert.equal(result.libId, 'monitor-24');
  assert.deepEqual(result.size, size);
  assert.equal(result.sizeSource, 'product');
  assert.equal(result.flags.fragile, true);
});

test('寸数在名称末尾时按27寸匹配正确的显示器库条目', () => {
  const { items: [result] } = normalize([item({
    name: '显示器27寸', category: 'electronics', size_cm: { w: 61, d: 20, h: 46 }, size_confidence: 'product',
  })], { text: '显示器27寸' });
  assert.equal(result.libId, 'monitor-27');
});

test('unknown 尺寸不被物品库标准尺寸与 product 来源覆盖', () => {
  const size = { w: 43, d: 31, h: 24 };
  const { items: [result] } = normalize([item({
    name: '收纳箱', category: 'storage', size_cm: size, size_confidence: 'unknown',
  })]);
  assert.equal(result.sizeSource, 'unknown');
  assert.deepEqual(result.size, size);
});

test('unknown 行李箱和照片行李箱不推断可用内容积', () => {
  const suitcase = item({
    name: '24寸行李箱', category: 'luggage', size_cm: { w: 30, d: 20, h: 40 }, size_confidence: 'unknown',
  });
  const unknown = normalize([suitcase]).items[0];
  const photo = normalize([{ ...suitcase, size_confidence: 'product' }], { photo: true }).items[0];
  assert.equal(unknown.flags.container, undefined);
  assert.equal(photo.flags.container, undefined);
});

test('显式缩小行李箱时内容积不超过外尺寸和物品库，默认24寸箱不变', () => {
  const base = makeItem('luggage-24');
  const { items: [smaller] } = normalize([item({
    name: '24寸行李箱', category: 'luggage', size_cm: { w: 30, d: 20, h: 40 }, size_confidence: 'product',
  })], { text: '24寸行李箱，外尺寸30×20×40cm' });
  assert.deepEqual(smaller.size, { w: 30, d: 20, h: 40 });
  assert.ok(smaller.flags.container);
  for (const dimension of ['w', 'd', 'h']) {
    assert.ok(smaller.flags.container[dimension] < smaller.size[dimension]);
    assert.ok(smaller.flags.container[dimension] <= base.flags.container[dimension]);
  }
  const { items: [standard] } = normalize([item({
    name: '24寸行李箱', category: 'luggage', size_cm: base.size, size_confidence: 'product',
  })]);
  assert.deepEqual(standard.flags.container, base.flags.container);
});

test('用户原句中的不确定提示优先于 AI product，但不影响其他物品', () => {
  const { items } = normalize([
    item({ name: '收纳箱', category: 'storage', size_confidence: 'product' }),
    item({ name: '27寸显示器', category: 'electronics', size_cm: { w: 61, d: 20, h: 46 }, size_confidence: 'product' }),
  ], { text: '一个尺寸不确定的收纳箱，27寸显示器' });
  assert.ok(['unknown', 'estimated'].includes(items[0].sizeSource));
  assert.equal(items[1].sizeSource, 'product');
});

for (const confidence of ['product', 'estimated']) {
  test(`近似尺寸不被库匹配提升为商品参数（模型 ${confidence}）`, () => {
    const size = { w: 53, d: 37, h: 31 };
    const { items } = normalize([
      item({ name: '收纳箱', category: 'storage', size_cm: size, size_confidence: confidence }),
      item({ name: '27寸显示器', category: 'electronics', size_confidence: 'product' }),
      item({ name: '24寸行李箱', category: 'luggage', size_confidence: confidence }),
    ], { text: '一个大概53×37×31cm的收纳箱，27寸显示器，24寸行李箱外尺寸大约40×25×60cm' });
    assert.equal(items[0].libId, 'box-l');
    assert.equal(items[0].sizeSource, 'estimated');
    assert.deepEqual(items[0].size, size);
    assert.ok(items[0].sizeRange.min.w < size.w && items[0].sizeRange.max.w > size.w);
    assert.equal(items[1].sizeSource, 'product');
    assert.equal(items[2].sizeSource, 'estimated');
    assert.equal(items[2].flags.container, undefined);
    const report = planMoveIn(buildRoom(), [items[0]]);
    assert.equal(report.verdicts[items[0].id].status, 'uncertain');
    assert.ok(report.verdicts[items[0].id].tolerance);
  });
}

test('照片识别的尺寸来源始终是 estimated，包括库中标准物品', () => {
  const { items } = normalize([
    item({ name: '收纳箱', category: 'storage', size_confidence: 'product' }),
    item({ name: '27寸显示器', category: 'electronics', size_confidence: 'unknown' }),
  ], { photo: true });
  assert.ok(items.every(({ sizeSource }) => sizeSource === 'estimated'));
});

test('调用方 owner 和生成的 id 覆盖模型值，flags 完整且只接受严格布尔值', () => {
  const { items: [result] } = normalize([item({
    id: '不可信 id', owner: 'D', hangable: true, stackable: true, compressible: true,
    flags: { rotatable: false, container: { w: 999, d: 999, h: 999 }, extra: '不透传' },
  })], { owner: 'pub' });
  assert.equal(result.owner, 'pub');
  assert.equal(result.id, 'ai-001');
  assert.equal(result.flags.stackable, true);
  assert.equal(result.flags.hangable, true);
  assert.equal(result.flags.compressible, 0.4);
  for (const key of ['stackable', 'canBearLoad', 'rotatable', 'canLieDown', 'hangable', 'fragile', 'focusTool', 'disposable']) {
    assert.equal(typeof result.flags[key], 'boolean', key);
  }
  assert.equal(result.flags.rotatable, true);
  assert.equal(result.flags.extra, undefined);
  assert.equal(result.flags.container, undefined);
});

test('字符串布尔值不会被映射为真实物理属性', () => {
  const { items: [result] } = normalize([item({ hangable: 'true', stackable: 'false', compressible: 'true' })]);
  assert.equal(result.flags.hangable, false);
  assert.equal(result.flags.stackable, false);
  assert.equal(result.flags.compressible, undefined);
});

for (const [confidence, minFactor, maxFactor] of [['estimated', 0.8, 1.25], ['unknown', 0.5, 2]]) {
  test(`${confidence} 的 sizeRange 与最终尺寸保持一致`, () => {
    const { items: [result] } = normalize([item({ size_confidence: confidence })]);
    assert.ok(result.sizeRange);
    for (const dimension of ['w', 'd', 'h']) {
      assert.equal(result.sizeRange.min[dimension], result.size[dimension] * minFactor);
      assert.equal(result.sizeRange.max[dimension], result.size[dimension] * maxFactor);
    }
  });
}

test('书摞余数改变高度时，同时重算 unknown 的高度范围', () => {
  const { items } = normalize([item({
    name: '书', category: 'books', qty: 21, size_cm: { w: 26, d: 19, h: 25 }, size_confidence: 'unknown',
  })]);
  assert.equal(items[2].size.h, 2.5);
  assert.equal(items[2].sizeRange.min.h, 1.25);
  assert.equal(items[2].sizeRange.max.h, 5);
});

test('模型只能提供受限字段，不透传原型或额外属性', () => {
  const raw = JSON.stringify({ items: [item()] });
  const injected = JSON.parse(raw);
  injected.items[0] = JSON.parse(`{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"unexpected":"禁止透传",${JSON.stringify(injected.items[0]).slice(1)}`);
  const { items: [result] } = normalizeItems(JSON.stringify(injected));
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), false);
  assert.equal(Object.hasOwn(result, 'constructor'), false);
  assert.equal(result.unexpected, undefined);
  assert.equal(result.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(result.size_cm, undefined);
  assert.equal(result.qty, undefined);
  assert.equal(result.power_w, undefined);
});

test('aiParseItems 模拟 AI 成功、坏 JSON、空结果和服务失败均返回稳定结果', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const textCalls = new Map();
  globalThis.fetch = async (url, init = {}) => {
    calls.push(url);
    if (url === '/ai/__config') return jsonResponse({ enabled: true, model: 'test-model', wire: 'chat', vision: false });
    const body = JSON.parse(init.body);
    const text = body.messages.findLast(({ role }) => role === 'user').content;
    const count = (textCalls.get(text) ?? 0) + 1;
    textCalls.set(text, count);
    if (text.includes('服务失败测试')) return jsonResponse({}, 503);
    const content = text.includes('非法结果测试') && count === 1 ? 'not-json'
      : text.includes('空结果测试') && count === 1 ? '{"items":[]}' : JSON.stringify({ items: acceptanceItems() });
    return jsonResponse({ choices: [{ message: { content } }] });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const ai = await import('./index.js?items-integration');

  assert.equal(await ai.aiAvailable(), true);
  const success = await ai.aiParseItems(acceptanceText, { owner: 'C' });
  assert.equal(success.source, 'ai');
  assert.equal(success.items.length, 8);
  assert.ok(success.items.every(({ owner }) => owner === 'C'));
  assert.equal((await ai.aiParseItems(acceptanceText, { owner: 'C' })).source, 'ai');
  assert.equal(textCalls.get(acceptanceText), 1);

  for (const marker of ['非法结果测试', '空结果测试', '服务失败测试']) {
    const result = await ai.aiParseItems(`台灯，${marker}`, { owner: 'B' });
    assert.equal(result.source, 'rules', marker);
    assert.ok(result.items.some(({ name }) => name.includes('台灯')), marker);
    assert.ok(result.items.every(({ owner }) => owner === 'B'));
    assert.ok(result.warnings.includes('AI 离线，已使用本地解析'));
    if (marker === '非法结果测试') assert.ok(result.warnings.includes('BAD_JSON'));
    if (marker !== '服务失败测试') {
      const retry = await ai.aiParseItems(`台灯，${marker}`, { owner: 'B' });
      assert.equal(retry.source, 'ai', marker);
      assert.equal(textCalls.get(`台灯，${marker}`), 2);
      assert.equal((await ai.aiParseItems(`台灯，${marker}`, { owner: 'B' })).source, 'ai');
      assert.equal(textCalls.get(`台灯，${marker}`), 2);
    }
  }
  assert.equal(calls.filter((url) => url === '/ai/__config').length, 1);
});

test('互动清单在模型两种数量表示和规则降级下均为七件、两摞书', async (t) => {
  const originalFetch = globalThis.fetch;
  const messages = makeItemMessages(audienceText);
  let mode = 'legacy';
  let requests = 0;
  globalThis.fetch = async (url) => {
    if (url === '/ai/__config') return jsonResponse({ enabled: true, model: 'test-model', wire: 'chat', vision: false });
    requests += 1;
    if (mode === 'offline') return jsonResponse({}, 503);
    const items = [
      item({ name: '台灯', category: 'electronics' }),
      item({ name: '书（一摞）', category: 'books', qty: mode === 'legacy' ? 2 : 20 }),
      item({ name: '水杯', category: 'food' }),
      item({ name: '零食箱', category: 'food' }),
      item({ name: '快递盒', category: 'trash' }),
      item({ name: '耳机', category: 'electronics' }),
    ];
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ items }) } }] });
  };
  t.after(() => { globalThis.fetch = originalFetch; forgetChat(messages); });
  const { aiParseItems } = await import('./index.js');

  function assertAudience(items) {
    assert.equal(items.length, 7);
    const books = items.filter(({ category }) => category === 'books');
    assert.equal(books.length, 2);
    assert.ok(books.every(({ libId, size }) => libId === 'books-10' && size.w === 26 && size.d === 19 && size.h === 25));
    assert.equal(items.filter(({ libId }) => libId === 'snack-box').length, 1);
    assert.equal(new Set(items.map(({ id }) => id)).size, 7);
    assert.ok(items.every(({ owner }) => owner === 'D'));
  }

  assertAudience(parseItemsText(audienceText, { owner: 'D' }));
  for (const value of ['legacy', 'canonical', 'offline']) {
    mode = value;
    forgetChat(messages);
    const result = await aiParseItems(audienceText, { owner: 'D' });
    assert.equal(result.source, value === 'offline' ? 'rules' : 'ai');
    assertAudience(result.items);
    if (value === 'offline') assert.ok(result.warnings.includes('AI 离线，已使用本地解析'));
  }
  assert.equal(requests, 3);
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
