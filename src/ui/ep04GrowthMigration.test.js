import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as planner from '../planner/index.js';
import { createStore, createInitialState } from '../core/store.js';
import { esc, clone } from './helpers.js';
import { migrateLayout } from './layoutMigration.js';
import { createSnapshotThumb, isSnapshotThumb } from './snapshotThumb.js';

function node() {
  const children = new Map();
  const listeners = new Map();
  return {
    value: '', innerHTML: '', textContent: '', hidden: false,
    classList: { toggle() {}, remove() {} },
    contains() { return false; },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, node());
      return children.get(selector);
    },
    querySelectorAll() { return []; },
    setAttribute() {}, removeAttribute() {}, focus() {}, reportValidity() { return true; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    fire(type, event) { return listeners.get(type)?.(event); }
  };
}

/** 去掉样式依赖后运行原面板及真实事件回调，定向检查存档与当前布局的接线。 */
function setup(t, snapshots, overrides = {}) {
  const el = node();
  const footer = node();
  const form = el.querySelector('.growth-save-form');
  form.elements = { label: node(), semester: { value: 'Y1-F' } };
  const store = createStore({ ...createInitialState(planner), snapshots: clone(snapshots), ...overrides });
  const alerts = [];
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  const source = readFileSync(new URL('./panels/ep04Growth.js', import.meta.url), 'utf8')
    .replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '');
  const panel = vm.runInNewContext(`${source}\n({ mount, unmount })`, {
    esc, clone, migrateLayout, createSnapshotThumb, isSnapshotThumb,
    sparkline: entries => JSON.stringify(entries),
    document: { activeElement: null },
    crypto: { randomUUID },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const ctx = { store, footer, scene: null, alert: (text, level) => alerts.push({ text, level }),
    planner: { ...planner, planMoveIn(...args) { calls.push(args); return planner.planMoveIn(...args); } } };
  panel.mount(el, ctx);
  t.after(panel.unmount);
  return { el, footer, form, store, alerts, calls,
    choose(id) {
      el.querySelector('.growth-records').fire('click', { target: { closest: () => ({ dataset: { snapshot: id } }) } });
    },
    replay() { return el.querySelector('[data-growth-replay]').fire('click'); },
    tick() {
      const [id, fn] = timers.entries().next().value || [];
      assert.ok(fn, '回放应安排下一节点');
      timers.delete(id); fn();
    },
    save(label) { form.elements.label.value = label; return form.fire('submit', { preventDefault() {} }); }
  };
}

function placement(room, item, zoneId) {
  const zone = room.zones.find(entry => entry.id === zoneId);
  return { itemId: item.id, zoneId, box: { ...zone.box, ...item.size }, rot: 0, lying: false, layer: 0 };
}

function legacySnapshot(id = 'old-bed') {
  const room = planner.buildRoom();
  const items = [planner.makeItem('luggage-24', { id: 'luggage' }), planner.makeItem('cup', { id: 'cup' })];
  return { id, label: '旧床尾布局', semester: 'Y1-F', createdAt: '2026-09-01T10:00:00Z',
    roomParams: room.params, items,
    placements: { luggage: placement(room, items[0], 'A.bedFoot'), cup: placement(room, items[1], 'A.hutch') },
    sync: 97, focusMinutes: 321, thumb: 'data:image/jpeg;base64,YWJj' };
}

test('历史节点使用完整清单重建房间并重排旧床尾，保留合法原位及历史记录', t => {
  const snapshot = legacySnapshot();
  const { store, choose, calls, el } = setup(t, [snapshot], {
    movePlan: { steps: [{ toZoneId: 'A.bedFoot' }] }, stepIndex: 6, tdmPlan: { stale: true },
    focusSpec: { zoneId: 'B.desk', w: 90, d: 40 }
  });
  choose(snapshot.id);
  const state = store.get();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], snapshot.items);
  assert.deepEqual(calls[0][2].existing, snapshot.placements);
  assert.deepEqual(state.snapshots[0], snapshot);
  assert.deepEqual(state.items, snapshot.items);
  assert.deepEqual(state.placements.cup, snapshot.placements.cup);
  assert.notEqual(state.placements.luggage.zoneId, 'A.bedFoot');
  assert.deepEqual(state.sync, state.fitReport.sync);
  assert.deepEqual(state.itemStates, Object.fromEntries(Object.entries(state.fitReport.verdicts).map(([id, verdict]) => [id, verdict.status])));
  assert.equal(state.focusMinutes, 321);
  assert.equal(state.focusSpec.w, 90);
  assert.equal(state.focusSpec.zoneId, 'A.desk');
  assert.equal(state.movePlan, null);
  assert.equal(state.stepIndex, 0);
  assert.equal(state.tdmPlan, null);
  assert.match(state.syncHistory.at(-1).label, /复核/);
  assert.match(el.querySelector('.growth-current').innerHTML, /历史 97% · 当前复核/);
  assert.equal(el.querySelector('.growth-migration').hidden, false);
  assert.match(el.querySelector('.growth-migration').querySelector('ul').innerHTML, /重新安排|修复/);
  assert.match(el.querySelector('.growth-records').innerHTML, /data:image\/jpeg;base64,YWJj/);
});

test('快照锁区、安全与容量冲突逐件展示，物品与原锁定记录均不删除', t => {
  const snapshot = legacySnapshot();
  const danger = { ...planner.makeItem('cup', { id: 'unsafe', name: '待核实水杯' }),
    safety: { status: 'review', reason: '材质用途待人工确认' } };
  snapshot.items.push(danger);
  snapshot.lockedZones = ['A.bedFoot'];
  const { store, choose, el, alerts } = setup(t, [snapshot], { lockedZones: ['B.desk'] });
  choose(snapshot.id);
  const state = store.get();
  assert.equal(state.items.length, 3);
  assert.deepEqual(state.lockedZones, snapshot.lockedZones);
  assert.equal(state.fitReport.verdicts.luggage.status, 'overflow');
  assert.equal(state.fitReport.verdicts.unsafe.status, 'banned');
  for (const id of ['luggage', 'unsafe']) assert.ok(state.fitReport.overflowIds.includes(id));
  const details = el.querySelector('.growth-migration').querySelector('ul').innerHTML;
  assert.match(details, /行李箱[^]*锁定/);
  assert.match(details, /待核实水杯[^]*材质用途待人工确认/);
  assert.equal(alerts.at(-1).level, 'warning');

  const full = legacySnapshot('full');
  full.items = [full.items[0]];
  full.placements = { luggage: full.placements.luggage };
  full.lockedZones = planner.buildRoom().zones.filter(zone => !['bed', 'bedFoot'].includes(zone.slot)).map(zone => zone.id);
  store.set({ snapshots: [...state.snapshots, full] });
  choose(full.id);
  assert.equal(store.get().items.length, 1);
  assert.equal(store.get().placements.luggage, undefined);
  assert.match(el.querySelector('.growth-migration').querySelector('ul').innerHTML, /放不下|空位/);
});

test('旧南区D归属快照重建ABC与通高柜区，保持D物品并明确要求核对', t => {
  const snapshot = legacySnapshot();
  snapshot.owner = 'D';
  snapshot.roomParams = { ...planner.buildRoom({ templateId: 'nanqu1' }).params, occupants: ['A', 'B', 'C', 'D'] };
  snapshot.items = [planner.makeItem('cup', { id: 'old-d', owner: 'D' })];
  snapshot.placements = { 'old-d': { ...snapshot.placements.cup, itemId: 'old-d', zoneId: 'D.desk' } };
  const { store, choose, el } = setup(t, [snapshot], { lockedZones: ['D.desk'] });
  choose(snapshot.id);
  const state = store.get();
  assert.deepEqual(state.roomParams.occupants, ['A', 'B', 'C']);
  assert.ok(state.room.fixtures.some(fixture => fixture.id === 'pub.cabinetBank#fx'));
  assert.ok(!state.room.zones.some(zone => zone.owner === 'D'));
  assert.equal(state.items[0].owner, 'D');
  assert.equal(state.items[0].id, 'old-d');
  assert.equal(state.owner, 'A');
  assert.deepEqual(state.lockedZones, ['D.desk']);
  assert.match(el.querySelector('.growth-migration').querySelector('ul').innerHTML, /仍保留 D 归属/);
  assert.match(el.querySelector('.growth-migration').querySelector('ul').innerHTML, /请核对/);
  assert.deepEqual(state.snapshots[0], snapshot);
});

test('每次回放均重新调用入住复核，不复用旧终点和缓存计划', t => {
  const snapshots = [legacySnapshot('first'), legacySnapshot('second')];
  snapshots[1].focusMinutes = 654;
  const { store, replay, tick, calls } = setup(t, snapshots, {
    movePlan: { steps: [{ toZoneId: 'A.bedFoot' }] }, tdmPlan: { byMonth: { 12: { stale: true } } }
  });
  replay();
  assert.equal(calls.length, 1);
  assert.notEqual(store.get().placements.luggage.zoneId, 'A.bedFoot');
  tick();
  assert.equal(calls.length, 2);
  assert.equal(store.get().focusMinutes, 654);
  assert.notEqual(store.get().placements.luggage.zoneId, 'A.bedFoot');
  assert.equal(store.get().movePlan, null);
  assert.equal(store.get().tdmPlan, null);
  tick();
  replay();
  assert.equal(calls.length, 3);
  assert.deepEqual(store.get().snapshots, snapshots);
});

test('保存前复核当前旧布局，不把违规床位另存为新快照或改写旧档案', async t => {
  const snapshot = legacySnapshot();
  const { store, save, calls, alerts } = setup(t, [snapshot], {
    roomParams: snapshot.roomParams, items: clone(snapshot.items), placements: clone(snapshot.placements), focusMinutes: 700,
    movePlan: { steps: [{ toZoneId: 'A.bedFoot' }] }
  });
  await save('复核后的新快照');
  const state = store.get();
  assert.equal(calls.length, 1);
  assert.equal(state.snapshots.length, 2);
  assert.deepEqual(state.snapshots[0], snapshot);
  const saved = state.snapshots[1];
  assert.equal(saved.label, '复核后的新快照');
  assert.notEqual(saved.placements.luggage.zoneId, 'A.bedFoot');
  assert.deepEqual(saved.placements.cup, snapshot.placements.cup);
  assert.deepEqual(saved.items, snapshot.items);
  assert.equal(saved.focusMinutes, 700);
  assert.equal(saved.sync, state.sync.total);
  assert.equal(saved.thumb, undefined);
  assert.equal(state.movePlan, null);
  assert.equal(alerts.at(-1).level, 'warning');
});

test('未解决的原锁区不能另存为丢失来源的新快照，原历史和全部物品保留', async t => {
  const snapshot = { ...legacySnapshot(), lockedZones: ['A.bedFoot'] };
  const { store, choose, save, alerts } = setup(t, [snapshot]);
  choose(snapshot.id);
  assert.equal(store.get().placements.luggage, undefined);
  await save('未完成复核');
  assert.equal(store.get().snapshots.length, 1);
  assert.deepEqual(store.get().snapshots[0], snapshot);
  assert.deepEqual(store.get().items, snapshot.items);
  assert.equal(store.get().placements.luggage, undefined);
  assert.ok(store.get().migrationPending.luggage);
  assert.match(alerts.at(-1).text, /暂不另存/);
  assert.equal(alerts.at(-1).level, 'warning');
});
