// B2：第一话 入住 planMoveIn（docs/05 §4、§10）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom, parseItemsText, planMoveIn, PRESETS, makeItem, LIBRARY } from '../src/planner/index.js';
import { lcg, assertValidPlacements } from './helpers.js';

const room = buildRoom();
const items = parseItemsText(PRESETS.freshman);
const report = planMoveIn(room, items);
const V = report.verdicts;
const find = (pred) => items.find(pred);

test('电热水壶判为 banned，原因含 1000W', () => {
  const k = find((it) => it.libId === 'kettle');
  assert.equal(V[k.id].status, 'banned');
  assert.ok(V[k.id].reasons.some((r) => r.includes('1000W')));
  assert.equal(report.placements[k.id], undefined);
});

test('24 寸行李箱进 A.underDesk，判为 fits', () => {
  const l = find((it) => it.libId === 'luggage-24');
  assert.equal(V[l.id].status, 'fits');
  assert.equal(report.placements[l.id].zoneId, 'A.underDesk');
});

test('28 寸行李箱判为 relocate（pub.entryL）或 overflow，不能是 fits', () => {
  const l = find((it) => it.libId === 'luggage-28');
  const v = V[l.id];
  assert.ok(v.status === 'overflow' || (v.status === 'relocate' && v.zoneId === 'pub.entryL'), JSON.stringify(v));
});

test('尺寸未知的收纳箱判为 uncertain，tolerance 三个值都 > 0', () => {
  const u = find((it) => it.sizeSource === 'unknown');
  const v = V[u.id];
  assert.equal(v.status, 'uncertain');
  assert.ok(v.tolerance.maxW > 0 && v.tolerance.maxD > 0 && v.tolerance.maxH > 0);
  assert.equal(v.tolerance.zoneId, v.zoneId);
  assert.match(v.suggestions[0], /下单前确认/);
});

test('docs/07 §4 预期：banned ≥ 1、uncertain ≥ 2、relocate ≥ 1；吹风机功率未知为 uncertain', () => {
  const s = report.summary;
  assert.ok(s.banned >= 1 && s.uncertain >= 2 && s.relocate >= 1, JSON.stringify(s));
  const h = find((it) => it.libId === 'hairdryer');
  assert.equal(V[h.id].status, 'uncertain');
  assert.ok(V[h.id].suggestions.some((t) => t.includes('1000W')));
});

test('summary 各项之和等于物品总数；uncertain ⇒ tolerance，overflow ⇒ need', () => {
  const s = report.summary;
  assert.equal(s.fits + s.relocate + s.uncertain + s.overflow + s.banned, items.length);
  assert.equal(s.total, items.length);
  for (const it of items) {
    const v = V[it.id];
    if (v.status === 'uncertain') assert.ok(v.tolerance, it.id);
    if (v.status === 'overflow') assert.ok(v.need, it.id);
    if (v.status === 'fits' || v.status === 'relocate' || v.status === 'uncertain') {
      if (!it.flags.disposable) assert.equal(v.zoneId, report.placements[it.id].zoneId);
    }
    assert.ok(v.reasons.every((r) => typeof r === 'string'));
  }
  for (const id of report.overflowIds) assert.equal(report.placements[id], undefined);
});

test('placement 不重叠、不越界、不进 keepClear；结果确定；不修改入参', () => {
  assertValidPlacements(room, report.placements);
  const before = JSON.stringify(items);
  assert.equal(JSON.stringify(planMoveIn(room, items)), JSON.stringify(report));
  assert.equal(JSON.stringify(items), before);
  assert.ok(report.sync.total >= 0 && report.sync.total <= 100);
});

test('新生初始布局自动避开桌面专注区（penaltyRect）', () => {
  const s = report.sync;
  assert.equal(s.parts.focus, 1);
});

test('放不下时给 need：30 个 28 寸箱塞满公共区后溢出', () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push(makeItem('luggage-28', { id: `L${String(i).padStart(2, '0')}` }));
  const r = planMoveIn(room, many);
  const over = many.filter((it) => r.verdicts[it.id].status === 'overflow');
  assert.ok(over.length > 0);
  for (const it of over) {
    const v = r.verdicts[it.id];
    assert.ok(v.need && v.need.text.includes('最大空位'));
    assert.match(v.suggestions[0], /换小一号/);
  }
  assertValidPlacements(room, r.placements);
});

test('可丢弃物品判为 relocate 且建议扔掉；existing 物品保持不动；lockedZones 不进新物品', () => {
  const parcel = makeItem('parcel', { id: 'p1' });
  const mate = makeItem('box-l', { id: 'mate', owner: 'pub' });
  const existing = { mate: { itemId: 'mate', zoneId: 'pub.entryL', box: { x: 0, y: 0, z: 0, w: 95, d: 100, h: 150 },
    rot: 0, lying: false, layer: 0, compressed: false } };
  const r = planMoveIn(room, [parcel, makeItem('guitar', { id: 'g' }), makeItem('books-10', { id: 'b' })],
    { existing, lockedZones: ['A.hutch'] });
  assert.equal(r.verdicts.p1.status, 'relocate');
  assert.deepEqual(r.verdicts.p1.suggestions, ['直接扔掉或拆平']);
  assert.notEqual(r.placements.g?.zoneId, 'pub.entryL');
  assert.notEqual(r.placements.b?.zoneId, 'A.hutch');
  assertValidPlacements(room, { ...r.placements, ...existing });
  void mate;
});

test('性能：40 件 ≤ 150ms，随机物品也满足不变量', () => {
  const rnd = lcg(7);
  const pool = LIBRARY.filter((e) => !['kettle', 'rice-cooker', 'e-blanket', 'heater'].includes(e.libId));
  const its = [];
  for (let i = 0; i < 40; i++) {
    const e = pool[Math.floor(rnd() * pool.length)];
    its.push(makeItem(e.libId, { id: `q-${String(i).padStart(3, '0')}` }));
  }
  planMoveIn(room, its);   // 预热
  const t = performance.now();
  const r = planMoveIn(room, its);
  const ms = performance.now() - t;
  assert.ok(ms <= 150, `planMoveIn 用时 ${ms.toFixed(1)}ms`);
  assertValidPlacements(room, r.placements);
  const s = r.summary;
  assert.equal(s.fits + s.relocate + s.uncertain + s.overflow + s.banned, 40);
});
