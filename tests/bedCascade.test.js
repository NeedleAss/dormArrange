// 腾桌级联不能单独搬走仍装有物品的箱子，避免箱内物品留在旧世界坐标。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom, PRESETS, makeItem, planFocusField, applySteps } from '../src/planner/index.js';
import { insideZoneFor } from '../src/planner/inside.js';
import { contains } from '../src/planner/geometry.js';
import { assertValidPlacements } from './helpers.js';

for (const explicitParent of [false, true]) test(`有箱内物品的桌下行李箱不能被级联单独搬走（显式父分区=${explicitParent}）`, () => {
  const room = buildRoom();
  const { items, placements } = structuredClone(PRESETS.messyDesk);
  const box = items.find((it) => it.id === 'md-024');
  const parent = placements[box.id];
  const inside = insideZoneFor(box, parent, room.zones.find((zone) => zone.id === parent.zoneId));
  if (explicitParent) {
    inside.id = 'legacy-case-interior';
    room.zones.push(inside);
  }
  // 小枕头仅用来复现容器依赖；不改变原演示箱子的尺寸、位置或其他物品。
  const pillow = makeItem('pillow', { id: 'inside-p', size: { w: 5, d: 5, h: 5 } });
  const child = { itemId: pillow.id, zoneId: inside.id,
    box: { x: inside.box.x, y: inside.box.y, z: inside.box.z, ...pillow.size },
    rot: 0, lying: false, layer: 0, compressed: false };
  items.push(pillow);
  placements[pillow.id] = child;
  const before = structuredClone({ room, items, placements });
  const plan = planFocusField(room, items, placements);
  assert.ok(!plan.steps.some((step) => step.itemId === box.id), '仍有箱内后代的行李箱不能成为级联腾位物品');
  assert.deepEqual(plan.placementsAfter[box.id], parent);
  assert.deepEqual(plan.placementsAfter[pillow.id], child);
  for (let upto = 0; upto <= plan.steps.length; upto++) {
    const current = applySteps(placements, plan.steps, upto);
    assert.ok(contains(current[box.id].box, current[pillow.id].box), `第${upto}步箱内物品仍在父箱内`);
    assertValidPlacements(room, current, [inside]);
  }
  assert.deepEqual(planFocusField(room, items, placements), plan);
  assert.deepEqual({ room, items, placements }, before);
  const locked = planFocusField(room, items, placements, {}, { lockedZones: [parent.zoneId] });
  assert.deepEqual(locked.placementsAfter[box.id], parent);
  assert.deepEqual(locked.placementsAfter[pillow.id], child);
  assert.ok(!locked.steps.some((step) => step.itemId === box.id || step.itemId === pillow.id));
});

test('腾桌候选箱内分区继承父箱锁区，不能经公共inside写入锁定容器', () => {
  const room = buildRoom();
  const box = makeItem('luggage-24', { id: 'locked-public-case', owner: 'pub' });
  const entry = room.zones.find((zone) => zone.id === 'pub.entryL');
  const parent = { itemId: box.id, zoneId: entry.id,
    box: { x: entry.box.x, y: entry.box.y, z: entry.box.z, ...box.size },
    rot: 0, lying: false, layer: 0, compressed: false };
  const inside = insideZoneFor(box, parent, entry);
  room.zones.push(inside);
  const desk = room.zones.find((zone) => zone.id === 'A.desk');
  const cup = makeItem('cup', { id: 'blocked-desk-cup', category: 'misc', libId: undefined, size: { w: 10, d: 10, h: 10 } });
  const initial = { itemId: cup.id, zoneId: desk.id,
    box: { x: desk.box.x, y: desk.box.y, z: desk.box.z, ...cup.size },
    rot: 0, lying: false, layer: 0, compressed: false };
  const items = [box, cup];
  const placements = { [box.id]: parent, [cup.id]: initial };
  const lockedZones = room.zones.filter((zone) => ![desk.id, inside.id].includes(zone.id)).map((zone) => zone.id);
  const before = structuredClone({ room, items, placements });
  const plan = planFocusField(room, items, placements, { w: 1000, d: 1000 }, { lockedZones });
  assert.equal(plan.steps.length, 0);
  assert.ok(plan.unresolved.some((entry) => entry.itemId === cup.id));
  assert.deepEqual(plan.placementsAfter, placements);
  assertValidPlacements(room, plan.placementsAfter);
  assert.deepEqual({ room, items, placements }, before);
});
