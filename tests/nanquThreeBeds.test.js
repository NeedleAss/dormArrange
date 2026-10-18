// 南区新装修按图库校正为右前、左后、右后三床和左前固定柜区。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom, makeItem, parseItemsText, planMoveIn, planFocusField, scatterOnDesk, PRESETS } from '../src/planner/index.js';
import { assertValidPlacements } from './helpers.js';

/** 只把正体积交集视为侵占，家具与分区边界相贴不算。 */
function overlaps(a, b) {
  return [['x', 'w'], ['y', 'h'], ['z', 'd']].every(([axis, size]) =>
    Math.min(a[axis] + a[size], b[axis] + b[size]) - Math.max(a[axis], b[axis]) > 1e-7);
}

test('南区新装修按照片生成三床：A右前、B左后、C右后，D没有家具或可规划分区', () => {
  const room = buildRoom({ templateId: 'nanqu1' });
  const { room: r, unit: u } = room.params;
  assert.deepEqual(room.params.occupants, ['A', 'B', 'C']);
  assert.match(room.name, /三人间/);
  assert.equal(room.params.sizeSource, 'estimated');
  for (const type of ['loftBed', 'bedRail', 'desk', 'hutch', 'ladder', 'chair']) {
    assert.equal(room.fixtures.filter((f) => f.type === type).length, 3, type);
  }
  for (const [owner, right, k] of [['A', true, 0], ['B', false, 1], ['C', true, 1]]) {
    const bed = room.fixtures.find((f) => f.id === `${owner}.loftBed#fx`);
    const desk = room.zones.find((z) => z.id === `${owner}.desk`);
    assert.equal(bed.box.x, right ? r.w - u.bedW : 0);
    assert.equal(bed.box.z, u.startZ + k * u.len + 5);
    assert.equal(desk.front, right ? '-x' : '+x');
  }
  assert.ok(!room.fixtures.some((f) => f.owner === 'D' || f.id.startsWith('D.')));
  assert.ok(!room.zones.some((z) => z.owner === 'D' || z.id.startsWith('D.')));
});

test('旧四席localStorage参数不能恢复南区新装修第四床，且不修改传入对象', () => {
  const current = buildRoom({ templateId: 'nanqu1' });
  const legacy = structuredClone(current.params);
  legacy.occupants = ['A', 'B', 'C', 'D'];
  legacy.name = '清华南区新装修 · 四人间（白梯L形桌）· 估计值';
  const before = structuredClone(legacy);
  assert.deepEqual(buildRoom(legacy), current);
  assert.deepEqual(legacy, before);
  assert.deepEqual(buildRoom(current.params), current);
});

test('左前原床位是通高固定柜，不增加空地或未实测的可规划容量', () => {
  const room = buildRoom({ templateId: 'nanqu1' });
  const u = room.params.unit;
  const cabinet = room.fixtures.find((f) => f.id === 'pub.cabinetBank#fx');
  assert.equal(cabinet?.type, 'wardrobe');
  assert.equal(cabinet.owner, 'pub');
  assert.equal(cabinet.label, '固定通高柜区');
  assert.deepEqual(cabinet.box, {
    x: 0, y: 0, z: u.startZ, w: u.wardrobeDepth, d: u.len,
    h: u.bedY + u.bedThick + u.railH
  });
  for (const z of room.zones) assert.ok(!overlaps(z.box, cabinet.box), `${z.id} 不得侵入柜区`);
  const oldLeftFront = { x: 0, y: 0, z: u.startZ, w: u.depth, d: u.len, h: room.params.room.h };
  for (const z of room.zones.filter((z) => z.kind !== 'keepClear')) {
    assert.ok(!overlaps(z.box, oldLeftFront), `${z.id} 不得把旧左前床位变成可规划空地`);
  }
  for (const f of room.fixtures.filter((f) => ['loftBed', 'desk', 'ladder'].includes(f.type))) {
    assert.ok(!overlaps(f.box, oldLeftFront), `${f.id} 不得在左前柜区保留床桌梯`);
  }
});

test('三床入住与腾桌结果确定且合法，物品不能进入左前固定柜区', () => {
  const room = buildRoom({ templateId: 'nanqu1' });
  const cabinet = room.fixtures.find((f) => f.id === 'pub.cabinetBank#fx');
  const items = parseItemsText(PRESETS.freshman);
  const moveIn = planMoveIn(room, items);
  assert.deepEqual(planMoveIn(room, items), moveIn);
  assertValidPlacements(room, moveIn.placements);
  const deskItems = ['laptop', 'lamp', 'cup', 'box-desk', 'keyboard', 'monitor-24'].map((libId) =>
    makeItem(libId, { id: `three-${libId}`, owner: 'A' }));
  const placements = scatterOnDesk(room, deskItems);
  assert.ok(Object.keys(placements).length > 0);
  assertValidPlacements(room, placements);
  const focus = planFocusField(room, deskItems, placements, { owner: 'A' });
  assert.deepEqual(planFocusField(room, deskItems, placements, { owner: 'A' }), focus);
  assertValidPlacements(room, focus.placementsAfter);
  for (const p of [...Object.values(moveIn.placements), ...Object.values(focus.placementsAfter)]) {
    assert.ok(!overlaps(p.box, cabinet.box), `${p.itemId} 不得进入固定柜`);
  }
});

test('紫荆和原南区继续使用原四席与左右双床拓扑', () => {
  for (const templateId of ['thu-4p-loft', 'nanqu']) {
    const room = buildRoom({ templateId });
    assert.deepEqual(room.params.occupants, ['A', 'B', 'C', 'D']);
    assert.equal(room.fixtures.filter((f) => f.type === 'loftBed').length, 4);
    assert.ok(!room.fixtures.some((f) => f.id === 'pub.cabinetBank#fx'));
    const a = room.fixtures.find((f) => f.id === 'A.loftBed#fx');
    const c = room.fixtures.find((f) => f.id === 'C.loftBed#fx');
    assert.equal(a.box.x, 0);
    assert.equal(c.box.x, room.params.room.w - room.params.unit.bedW);
    assert.equal(a.box.z, c.box.z);
  }
});
