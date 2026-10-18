import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom, checkRules, planMoveIn } from '../planner/index.js';
import { normalizeItems } from './normalize.js';
import { forgetChat } from './client.js';
import { makeItemMessages } from './prompts.js';

test('发送给模型的全部few-shot均带有效安全字段，并区分危险实体与相似普通物品', () => {
  const examples = makeItemMessages('测试清单').filter(message => message.role === 'assistant')
    .flatMap(message => JSON.parse(message.content).items);
  assert.ok(examples.every(item => ['blocked', 'review', 'clear'].includes(item.safety?.status)
    && typeof item.safety.reason === 'string' && item.safety.reason.trim()));
  for (const [name, status] of [['打火机', 'blocked'], ['点火石', 'blocked'], ['不明化学试剂', 'review'],
    ['打火机保护套', 'clear'], ['打火石科普书', 'clear'], ['无火LED蜡烛', 'clear'], ['酒精棉片', 'clear']]) {
    assert.equal(examples.find(item => item.name === name)?.safety.status, status, name);
  }
});

/** 全部为合成数据；不读取任何真实供应商配置。 */
function rawItem(name = '普通测试物件', overrides = {}) {
  return {
    name, qty: 1, category: 'misc', size_cm: { w: 10, d: 10, h: 10 },
    size_confidence: 'estimated', freq: 'weekly', months: [], power_w: null,
    hangable: false, stackable: false, compressible: false, note: '',
    safety: { status: 'clear', reason: '普通生活物品，未发现安全风险。' }, ...overrides,
  };
}

function normalize(rows, options = {}) {
  return normalizeItems(JSON.stringify({ items: rows }), options).items;
}

for (const [label, safety] of [
  ['缺失', undefined], ['null', null], ['数组', []], ['空对象', {}],
  ['非法枚举', { status: 'safe', reason: '不能冒充白名单枚举' }],
  ['空理由', { status: 'clear', reason: ' \n\u0000' }],
  ['非字符串理由', { status: 'clear', reason: 7 }],
]) {
  test(`AI安全结论${label}时保守review，不分配位置`, () => {
    const [item] = normalize([rawItem('普通测试物件', { safety })]);
    assert.equal(item.safety.status, 'review');
    assert.match(item.safety.reason, /需核实/u);
    const report = planMoveIn(buildRoom(), [item]);
    assert.equal(report.verdicts[item.id].status, 'banned');
    assert.match(report.verdicts[item.id].reasons.join(' '), /待核实/u);
    assert.equal(report.placements[item.id], undefined);
  });
}

test('安全字段只复制枚举与清理后的理由，展开物品不共享safety引用', () => {
  const safety = JSON.parse('{"status":"clear","reason":"  普通\\u0000物品  ","banned":false,"ruleId":"假规则","__proto__":{"polluted":true}}');
  const items = normalize([rawItem('普通测试物件', { qty: 2, safety })]);
  assert.deepEqual(items[0].safety, { status: 'clear', reason: '普通物品' });
  assert.notEqual(items[0].safety, items[1].safety);
  items[0].safety.reason = '修改第一件';
  assert.equal(items[1].safety.reason, '普通物品');
  assert.equal(Object.prototype.polluted, undefined);
  const [bounded] = normalize([rawItem('普通测试物件', { safety: { status: 'clear', reason: '说明'.repeat(400) } })]);
  assert.equal(bounded.safety.reason.length, 400);
});

for (const [name, status, reason] of [
  ['有明确危险用途的物件', 'blocked', '明确危险用途，不能在宿舍使用。'],
  ['不明化学试剂', 'review', '无法确认成分和用途，需向宿管核实。'],
]) {
  test(`AI${status}结论保留，规划拒绝且原因不混淆`, () => {
    const [item] = normalize([rawItem(name, { safety: { status, reason } })]);
    assert.deepEqual(item.safety, { status, reason });
    const report = planMoveIn(buildRoom(), [item]);
    assert.equal(report.placements[item.id], undefined);
    assert.equal(report.verdicts[item.id].status, 'banned');
    assert.match(report.verdicts[item.id].reasons.join(' '), status === 'review' ? /待核实/u : /拦截/u);
  });
}

for (const name of ['打火机', '点火石', '汽油', '电热毯', '1500W电热水壶']) {
  test(`AI误报clear不能覆盖本地硬拦截：${name}`, () => {
    const [item] = normalize([rawItem(name, { power_w: name.includes('1500W') ? 1500 : null })]);
    assert.equal(item.safety.status, 'blocked');
    assert.match(item.safety.reason, /本地规则复核/u);
    assert.equal(checkRules(item).banned, true);
    assert.equal(planMoveIn(buildRoom(), [item]).placements[item.id], undefined);
  });
}

for (const name of ['打火机保护套', '电热毯保护套', '电饭锅保护套', '打火石科普书', 'LED电子蜡烛（无火）', '小包装酒精棉片']) {
  test(`普通物品不因危险词被误改为blocked：${name}`, () => {
    const [item] = normalize([rawItem(name)]);
    assert.equal(item.safety.status, 'clear');
    assert.equal(checkRules(item).banned, false);
  });
}

test('公开文字接口防漏项、改名、少报及clear绕过，503保留本地规则且不伪造AI结论', async (t) => {
  const originalFetch = globalThis.fetch;
  let rows = [];
  let status = 200;
  globalThis.fetch = async (url) => {
    if (url === '/ai/__config') return response({ enabled: true, model: 'synthetic', wire: 'chat', vision: false });
    return response({ choices: [{ message: { content: JSON.stringify({ items: rows }) } }] }, status);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { aiParseItems } = await import('./index.js');
  const cases = [
    { text: '台灯、打火机', rows: [rawItem('台灯')], names: ['打火机'], count: 2 },
    { text: '台灯、点火石', rows: [rawItem('台灯'), rawItem('户外工具')], names: ['点火石'], count: 3 },
    { text: '汽油、煤油', rows: [rawItem('收纳液体')], names: ['汽油', '煤油'], count: 3 },
    { text: '两只打火机', rows: [rawItem('打火机')], names: ['打火机'], count: 2 },
    { text: '两只打火机', rows: [rawItem('打火机', { qty: 2 })], names: ['打火机'], count: 2 },
    { text: '户外点火石', rows: [rawItem('点火石')], names: ['户外点火石'], count: 1 },
    { text: '打火机保护套、打火机、台灯', rows: [rawItem('打火机保护套'), rawItem('台灯')], names: ['打火机'], count: 3 },
    { text: '电热毯保护套、电热毯', rows: [rawItem('电热毯保护套')], names: ['电热毯'], count: 2 },
    { text: '电饭锅保护套、电饭锅', rows: [rawItem('电饭锅保护套')], names: ['电饭锅'], count: 2 },
    { text: '1500W电热水壶', rows: [rawItem('电热水壶', { category: 'appliance', power_w: 0 })], names: ['1500W电热水壶'], count: 1 },
    { text: '不带打火机、台灯', rows: [rawItem('台灯')], names: [], count: 1 },
    { text: '水杯', rows: [rawItem('水杯', { safety: undefined })], names: [], count: 1, review: true },
    ...[['打火机油', '小型打火机'], ['小型打火机', '打火机油'], ['户外打火机油', '小型打火机']].map(names => ({
      text: '打火机、打火机油', rows: names.map(name => rawItem(name)), names: ['打火机', '打火机油'], count: 2, exactNames: ['打火机', '打火机油'],
    })),
    { text: '酒精、工业酒精', rows: [rawItem('工业酒精'), rawItem('消毒酒精')], names: ['酒精', '工业酒精'], count: 2, exactNames: ['酒精', '工业酒精'] },
  ];
  for (const scenario of cases) await t.test(`${scenario.text} / 模型返回${scenario.rows.length}条`, async () => {
    rows = scenario.rows;
    forgetChat(makeItemMessages(scenario.text));
    const result = await aiParseItems(scenario.text, { owner: 'C' });
    assert.equal(result.source, 'ai');
    assert.equal(result.items.length, scenario.count);
    assert.equal(new Set(result.items.map(item => item.id)).size, result.items.length);
    assert.ok(result.items.every(item => item.owner === 'C'));
    for (const name of scenario.names) {
      const dangerous = result.items.filter(item => item.name.startsWith(name) && checkRules(item).banned);
      assert.ok(dangerous.length, `必须保留原文危险实体：${name}`);
      const report = planMoveIn(buildRoom(), dangerous);
      assert.deepEqual(report.placements, {});
      assert.ok(dangerous.every(item => item.safety.status === 'blocked'));
    }
    if (scenario.text.includes('保护套')) assert.ok(result.items.some(item => item.name.endsWith('保护套') && !checkRules(item).banned));
    if (scenario.review) {
      assert.equal(result.items[0].safety.status, 'review');
      assert.ok(result.warnings.some(warning => warning.includes('安全信息待核实')));
      assert.deepEqual(planMoveIn(buildRoom(), result.items).placements, {});
    }
    if (scenario.exactNames) assert.deepEqual(result.items.map(item => item.name).sort(), [...scenario.exactNames].sort());
    forgetChat(makeItemMessages(scenario.text));
  });

  status = 503;
  const offline = await aiParseItems('打火机、点火石、台灯', { owner: 'B' });
  assert.equal(offline.source, 'rules');
  assert.equal(offline.items.length, 3);
  assert.ok(offline.items.every(item => item.safety === undefined && item.owner === 'B'));
  assert.equal(offline.items.filter(item => checkRules(item).banned).length, 2);
  assert.ok(offline.warnings.includes('AI 离线，已使用本地解析'));
});

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
