// B0 契约冒烟测试：API 齐全、buildRoom 分区齐全且分区之间不与 keepClear 相交、makeItem 形状正确。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as planner from '../src/planner/index.js';

const API = ['DEFAULT_PARAMS', 'buildRoom', 'LIBRARY', 'makeItem', 'RULES', 'PRESETS',
  'planMoveIn', 'planFocusField', 'applySteps', 'planSeasons', 'diffMonths', 'computeSync',
  'zoneFill', 'parseItemsText', 'checkRules', 'predictGrowth', 'scatterOnDesk'];

test('planner/index.js 导出 docs/03 §4.1 的全部 API', () => {
  for (const k of API) assert.ok(k in planner, `缺少 ${k}`);
});

test('buildRoom 生成必需分区', () => {
  const room = planner.buildRoom();
  const ids = new Set(room.zones.map((z) => z.id));
  for (const id of ['A.desk', 'A.hutch', 'A.underDesk', 'A.underDeskBack', 'A.wardrobeHang', 'A.wardrobeBottom',
    'A.bed', 'A.bedFoot', 'pub.entryL', 'pub.aisle', 'pub.doorSwing', 'pub.balcony']) {
    assert.ok(ids.has(id), `缺少分区 ${id}`);
  }
  assert.equal(ids.size, room.zones.length, '分区 id 重复');
  assert.deepEqual(room.bounds, { x: 0, y: 0, z: 0, w: 330, d: 700, h: 300 });
  const desk = room.zones.find((z) => z.id === 'A.desk');
  assert.deepEqual(desk.box, { x: 0, y: 75, z: 170, w: 60, d: 130, h: 53 });
  const c = room.zones.find((z) => z.id === 'C.desk');
  assert.deepEqual(c.box, { x: 270, y: 75, z: 170, w: 60, d: 130, h: 53 });
  assert.equal(c.front, '-x');
});

test('可放置分区不与 keepClear 分区相交', () => {
  const room = planner.buildRoom();
  const kc = room.zones.filter((z) => z.kind === 'keepClear');
  const ov = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01 &&
    Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z) > 0.01;
  for (const z of room.zones) {
    if (z.kind === 'keepClear') continue;
    for (const k of kc) assert.ok(!ov(z.box, k.box), `${z.id} 与 ${k.id} 相交`);
  }
});

test('buildRoom 不修改入参且结果确定', () => {
  const p = structuredClone(planner.DEFAULT_PARAMS);
  const a = JSON.stringify(planner.buildRoom(p));
  assert.deepEqual(p, structuredClone(planner.DEFAULT_PARAMS));
  assert.equal(a, JSON.stringify(planner.buildRoom(p)));
});

test('makeItem 补齐默认值与 sizeRange', () => {
  const it = planner.makeItem('box-desk');
  assert.equal(it.owner, 'A');
  assert.equal(it.flags.rotatable, true);
  assert.equal(it.flags.stackable, false);
  assert.deepEqual(it.sizeRange.max, { w: 31.3, d: 18.8, h: 15 });
  assert.equal(planner.makeItem('luggage-24').sizeRange, undefined);
});

test('checkRules：水壶功率禁用，吹风机警告，电饭锅关键词禁用', () => {
  const k = planner.checkRules(planner.makeItem('kettle'));
  assert.equal(k.banned, true);
  assert.match(k.reason, /1000W/);
  assert.equal(planner.checkRules(planner.makeItem('hairdryer')).banned, false);
  assert.ok(planner.checkRules(planner.makeItem('hairdryer')).warn);
  assert.equal(planner.checkRules(planner.makeItem('rice-cooker')).ruleId, 'R-COOK');
  assert.deepEqual(planner.checkRules(planner.makeItem('lamp')), { banned: false });
});
