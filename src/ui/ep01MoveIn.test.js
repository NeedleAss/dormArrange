import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as planner from '../planner/index.js';
import { createStore, createInitialState } from '../core/store.js';
import { mount, unmount } from './panels/ep01MoveIn.js';
import { migrateLayout } from './layoutMigration.js';

/** 用轻量节点驱动真实面板回调，验证规划结果与观众提示之间的接线。 */
function setup(t, items = [], ai = null) {
  const store = createStore({ ...createInitialState(planner), items });
  const nodes = new Map();
  const el = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { value: '', innerHTML: '', textContent: '' });
      return nodes.get(selector);
    },
    querySelectorAll() { return []; }
  };
  const alerts = [];
  mount(el, { store, planner, ai, alert: (text, level) => alerts.push({ text, level }) });
  t.after(unmount);
  return { store, el, alerts, plan: () => el.querySelector('#plan').onclick() };
}

test('新生预设有禁用项而没有容量溢出时，完成提示仍为警告', async t => {
  const { store, alerts, plan } = setup(t, planner.parseItemsText(planner.PRESETS.freshman));
  await plan();
  assert.equal(store.get().fitReport.summary.banned, 1);
  assert.equal(store.get().fitReport.summary.overflow, 0);
  assert.equal(alerts.at(-1).level, 'warning');
  assert.match(alerts.at(-1).text, /1.*安全/);
  assert.doesNotMatch(alerts.at(-1).text, /没有放不下/);
});

test('入住重新规划仍保留已迁移锁区的原位置依据，解锁后才允许重排', async t => {
  const room = planner.buildRoom();
  const item = planner.makeItem('luggage-24', { id: 'locked-in-move-in' });
  const { store, plan } = setup(t, [item]);
  store.set(migrateLayout(planner, { ...store.get(), lockedZones: ['A.bedFoot'], placements: {
    [item.id]: { itemId: item.id, zoneId: 'A.bedFoot', box: { ...room.zones.find(zone => zone.id === 'A.bedFoot').box, ...item.size },
      rot: 0, lying: false, layer: 0 }
  } }).patch);
  await plan();
  assert.equal(store.get().placements[item.id], undefined);
  assert.equal(store.get().fitReport.verdicts[item.id].status, 'overflow');
  assert.ok(store.get().migrationPending[item.id]);
  store.set({ lockedZones: [] });
  await plan();
  assert.ok(store.get().placements[item.id]);
  assert.equal(store.get().migrationPending[item.id], undefined);
});

test('待核实、通用风险与校规禁用在同一安全分组内保留不同依据', async t => {
  const items = [
    { ...planner.makeItem('cup', { id: 'review-cup' }), safety: { status: 'review', reason: '成分尚待确认' } },
    { ...planner.makeItem('cup', { id: 'fire', name: '打火机' }), safety: { status: 'review', reason: '用途尚待确认' } },
    planner.makeItem('cup', { id: 'hotpot', name: '电饭锅' })
  ];
  const { store, el, plan } = setup(t, items);
  await plan();
  const html = () => el.querySelector('#results').innerHTML;
  assert.match(html(), /安全拦截\s*\/\s*待核实/);
  for (const [id, label] of [['review-cup', '安全待核实'], ['fire', '安全拦截'], ['hotpot', '宿舍禁用']]) {
    assert.match(html(), new RegExp(`data-result="${id}"[^]*?<span>${label}</span>`));
    assert.equal(store.get().fitReport.verdicts[id].status, 'banned');
    assert.equal(store.get().placements[id], undefined);
  }
  store.set({ selection: 'review-cup' });
  assert.match(html(), /成分尚待确认/);
  assert.match(html(), /安全风险待核实，暂不通过/);
  assert.equal(store.get().fitReport.summary.uncertain, 0);
  assert.equal(store.get().fitReport.verdicts['review-cup'].tolerance, undefined);
});

const safetyWarnings = [
  '部分物品安全信息待核实，核实前暂不安排位置。',
  '存在安全预检拦截物品，请查看原因并联系宿管。',
  '已补回模型遗漏或改名的原文风险物品，请核对并联系宿管。'
];

for (const source of ['ai', 'rules']) {
  test(`${source} 解析保留固定中文安全提示，过滤诊断码并去重`, async t => {
    const warnings = [...safetyWarnings, safetyWarnings[0], 'DISABLED', 'BAD_JSON', 'HTTP_5XX', '未过滤的安全诊断原文'];
    const item = { ...planner.makeItem('cup'), safety: { status: 'review', reason: '成分尚待确认' } };
    const { store, el, alerts } = setup(t, [], { aiParseItems: async () => ({ items: [item], source, warnings }) });
    el.querySelector('#items-text').value = '未知材质水杯';
    await el.querySelector('#parse').onclick();
    assert.equal(store.get().items[0].safety.status, 'review');
    assert.deepEqual(alerts.filter(({ text }) => safetyWarnings.includes(text)), safetyWarnings.map(text => ({ text, level: 'warning' })));
    assert.equal(alerts.length, 4);
    assert.doesNotMatch(JSON.stringify(alerts), /DISABLED|BAD_JSON|HTTP_5XX|未过滤的安全诊断原文/);
    if (source === 'rules') assert.equal(alerts.filter(({ text }) => text === 'AI 离线，已使用本地解析').length, 1);
  });
}
