import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as planner from '../planner/index.js';
import { migrateLayout } from './layoutMigration.js';
import { createInitialState, createStore } from '../core/store.js';

function placement(room, item, zoneId) {
  const zone = room.zones.find(zone => zone.id === zoneId);
  return { itemId: item.id, zoneId, box: { ...zone.box, ...item.size }, rot: 0, lying: false, layer: 0 };
}

test('迁移床尾行李箱时保留完整清单、合法原位及历史输入，更新整份报告', () => {
  const room = planner.buildRoom();
  const items = [planner.makeItem('luggage-24', { id: 'old-box' }), planner.makeItem('cup', { id: 'keep-cup' })];
  const source = { roomParams: room.params, owner: 'A', items, placements: {
    'old-box': placement(room, items[0], 'A.bedFoot'), 'keep-cup': placement(room, items[1], 'A.hutch')
  }, movePlan: { steps: [{ toZoneId: 'A.bedFoot' }] }, stepIndex: 7, tdmPlan: { stale: true } };
  const before = structuredClone(source);
  const { patch, notices } = migrateLayout(planner, source);
  assert.deepEqual(source, before);
  assert.deepEqual(patch.items, items);
  assert.notEqual(patch.items, items);
  assert.deepEqual(patch.placements['keep-cup'], source.placements['keep-cup']);
  assert.ok(patch.placements['old-box']);
  assert.notEqual(patch.placements['old-box'].zoneId, 'A.bedFoot');
  assert.deepEqual(patch.fitReport.placements, patch.placements);
  assert.deepEqual(patch.sync, patch.fitReport.sync);
  assert.equal(patch.itemStates['old-box'], patch.fitReport.verdicts['old-box'].status);
  assert.equal(patch.movePlan, null);
  assert.equal(patch.stepIndex, 0);
  assert.equal(patch.tdmPlan, null);
  assert.match(notices.join(' '), /重新安排/);
});

test('锁定的旧床位不自动解锁，容量不足和安全问题保留物品及明确原因', () => {
  const room = planner.buildRoom();
  const luggage = planner.makeItem('luggage-24', { id: 'locked-box' });
  const danger = { ...planner.makeItem('cup', { id: 'blocked-cup' }), safety: { status: 'review', reason: '用途待核实' } };
  const source = { roomParams: room.params, items: [luggage, danger], owner: 'A',
    lockedZones: ['A.bedFoot'], placements: { [luggage.id]: placement(room, luggage, 'A.bedFoot') } };
  const { patch, notices } = migrateLayout(planner, source);
  assert.deepEqual(patch.lockedZones, ['A.bedFoot']);
  assert.equal(patch.items.length, 2);
  assert.deepEqual(patch.placements, {});
  assert.equal(patch.fitReport.verdicts[luggage.id].status, 'overflow');
  assert.equal(patch.fitReport.verdicts[danger.id].status, 'banned');
  assert.ok(patch.fitReport.overflowIds.includes(luggage.id));
  assert.ok(patch.fitReport.overflowIds.includes(danger.id));
  assert.match(notices.join(' '), /锁定/);
  assert.match(notices.join(' '), /用途待核实/);
  const full = migrateLayout(planner, { ...source, items: [luggage],
    lockedZones: room.zones.filter(zone => !['bed', 'bedFoot'].includes(zone.slot)).map(zone => zone.id) });
  assert.equal(full.patch.placements[luggage.id], undefined);
  assert.match(full.notices.join(' '), /放不下|空位/);
});

test('旧南区新四床参数重建为ABC加柜区，D物品不删除、不改归属', () => {
  const current = planner.buildRoom({ templateId: 'nanqu1' });
  const item = planner.makeItem('cup', { id: 'old-d', owner: 'D' });
  const source = { roomParams: { ...current.params, occupants: ['A', 'B', 'C', 'D'], name: '南区新装修四人间' },
    owner: 'D', items: [item], lockedZones: ['D.desk'], placements: {
      [item.id]: { ...placement(current, item, 'A.desk'), zoneId: 'D.desk' }
    } };
  const before = structuredClone(source);
  const { patch, notices } = migrateLayout(planner, source);
  assert.deepEqual(source, before);
  assert.deepEqual(patch.room.params.occupants, ['A', 'B', 'C']);
  assert.ok(patch.room.fixtures.some(fixture => fixture.id === 'pub.cabinetBank#fx'));
  assert.ok(!patch.room.zones.some(zone => zone.owner === 'D'));
  assert.equal(patch.owner, 'A');
  assert.equal(patch.items[0].owner, 'D');
  assert.equal(patch.items[0].id, 'old-d');
  assert.deepEqual(patch.lockedZones, ['D.desk']);
  assert.match(notices.join(' '), /仍保留 D 归属/);
  assert.match(notices.join(' '), /请核对/);
});

test('旧整份localStorage布局可迁移，持久化保留原物品/位置备份及全部历史档案', t => {
  const room = planner.buildRoom();
  const item = planner.makeItem('luggage-24', { id: 'legacy-box' });
  const original = { roomParams: room.params, items: [item], owner: 'A',
    lockedZones: [], placements: { [item.id]: placement(room, item, 'A.bedFoot') },
    snapshots: [{ id: 'untouched-history', items: [item], placements: {}, sync: 75 }], focusMinutes: 25,
    movePlan: { steps: [{ toZoneId: 'A.bedFoot' }] }, bloom: true };
  let serialized = JSON.stringify(original);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => serialized, setItem: (_key, value) => { serialized = value; }
  } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'localStorage', descriptor) : delete globalThis.localStorage);
  const store = createStore(createInitialState(planner));
  assert.deepEqual(store.get().items, original.items);
  assert.equal(store.get().movePlan, null);
  assert.equal(store.get().bloom, false);
  store.set(migrateLayout(planner, store.get()).patch);
  assert.notEqual(store.get().placements[item.id]?.zoneId, 'A.bedFoot');
  assert.deepEqual(store.get().snapshots, original.snapshots);
  assert.equal(store.get().focusMinutes, 25);
  const persisted = JSON.parse(serialized);
  assert.deepEqual(persisted.items, original.items);
  assert.deepEqual(persisted.placements, original.placements);
  assert.deepEqual(persisted.snapshots, original.snapshots);
  assert.equal(persisted.movePlan, undefined);
  assert.equal(persisted.bloom, undefined);
});

test('连续复核不会遗失被拒绝的原锁区，只有明确解锁后才重新安置', () => {
  const room = planner.buildRoom();
  const item = planner.makeItem('luggage-24', { id: 'locked-twice' });
  const source = { roomParams: room.params, items: [item], owner: 'A', lockedZones: ['A.bedFoot'],
    placements: { [item.id]: placement(room, item, 'A.bedFoot') } };
  const one = migrateLayout(planner, source).patch;
  const two = migrateLayout(planner, one).patch;
  assert.deepEqual(one.placements, {});
  assert.deepEqual(two.placements, {});
  assert.equal(two.fitReport.verdicts[item.id].status, 'overflow');
  assert.deepEqual(two.migrationPending[item.id], source.placements[item.id]);
  const unlocked = migrateLayout(planner, { ...two, lockedZones: [] }).patch;
  assert.ok(unlocked.placements[item.id]);
  assert.deepEqual(unlocked.migrationPending, {});
  assert.notEqual(unlocked.placements[item.id].zoneId, 'A.bedFoot');
});

test('连续复核保留危险容器与关联物的原位置依据，不自动摆放依赖物', () => {
  const room = planner.buildRoom();
  const container = { ...planner.makeItem('luggage-28', { id: 'danger-box' }),
    safety: { status: 'review', reason: '内容物待人工确认' } };
  const child = { ...planner.makeItem('bed-basket', { id: 'dependent' }), size: { w: 5, d: 5, h: 5 } };
  const parentPlacement = placement(room, container, 'A.bedFoot');
  const source = { roomParams: room.params, items: [container, child], owner: 'A', placements: {
    [container.id]: parentPlacement,
    [child.id]: { ...placement(room, child, 'A.bedFoot'), zoneId: `${container.id}.inside` }
  } };
  const one = migrateLayout(planner, source).patch;
  const two = migrateLayout(planner, one).patch;
  assert.equal(two.placements[container.id], undefined);
  assert.equal(two.placements[child.id], undefined);
  assert.equal(two.fitReport.verdicts[container.id].status, 'banned');
  assert.equal(two.fitReport.verdicts[child.id].status, 'overflow');
  assert.match(two.fitReport.verdicts[child.id].reasons.join(' '), /原容器|安全拦截/);
  assert.deepEqual(two.migrationPending, source.placements);
});
