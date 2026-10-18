import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as planner from '../planner/index.js';
import { createInitialState, createStore } from '../core/store.js';

let serial = 0;
async function browserModule(path) {
  // Node 不加载样式；只移除 CSS 引用，运行真实面板及迁移实现。
  const url = new URL(path, import.meta.url);
  const source = readFileSync(url, 'utf8').replace(/^import ['"][^'"]+\.css['"];?\r?\n/gm, '')
    .replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, relative) => `from ${quote}${new URL(relative, url).href}${quote}`);
  return import(`data:text/javascript;base64,${Buffer.from(`${source}\n// 测试实例 ${++serial}`).toString('base64')}`);
}

function node() {
  const children = new Map();
  return { innerHTML: '', textContent: '', value: '', disabled: false, hidden: false, scrollLeft: 0, scrollTop: 0,
    classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {},
    querySelector(selector) { if (!children.has(selector)) children.set(selector, node()); return children.get(selector); } };
}

function timers(t) {
  let next = 0;
  const pending = new Map();
  t.mock.method(globalThis, 'setTimeout', callback => { pending.set(++next, callback); return next; });
  t.mock.method(globalThis, 'clearTimeout', id => pending.delete(id));
  return { flush() { const calls = [...pending.values()]; pending.clear(); calls.forEach(callback => callback()); } };
}

function placement(room, item, zoneId) {
  return { itemId: item.id, zoneId, box: { ...room.zones.find(zone => zone.id === zoneId).box, ...item.size },
    rot: 0, lying: false, layer: 0 };
}

async function seasonPanel(t, source, overrides = {}) {
  const module = await browserModule('./panels/ep03Seasons.js');
  const clock = timers(t);
  const store = createStore({ ...createInitialState(planner), ...source });
  const el = node();
  const footer = node();
  const alerts = [];
  module.mount(el, { store, planner: { ...planner, ...overrides }, footer, alert: text => alerts.push(text) });
  t.after(module.unmount);
  clock.flush();
  return { store, el, footer, clock, alerts };
}

test('换季入口无条件迁移完整旧布局并重算12月，丢弃缓存床尾终点', async t => {
  const room = planner.buildRoom();
  const items = [planner.makeItem('luggage-24', { id: 'old-box' }), planner.makeItem('cup', { id: 'keep-cup' })];
  const old = { [items[0].id]: placement(room, items[0], 'A.bedFoot'), [items[1].id]: placement(room, items[1], 'A.hutch') };
  const calls = [];
  const { store, footer } = await seasonPanel(t, { room, roomParams: room.params, items, placements: old,
    tdmPlan: { tdm: true, byMonth: { 9: { placements: old, active: [], stored: [], overflow: [] } } }, movePlan: { steps: [{ toZoneId: 'A.bedFoot' }] } }, {
    planSeasons(...args) { calls.push(args); return planner.planSeasons(...args); }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].length, items.length);
  assert.deepEqual(calls[0][2].lockedZones, []);
  assert.equal(store.get().movePlan, null);
  assert.equal(store.get().stepIndex, 0);
  assert.deepEqual(store.get().items, items);
  assert.equal(store.get().tdmPlan.months.length, 12);
  for (const month of store.get().tdmPlan.months) {
    for (const item of items) assert.doesNotMatch(store.get().tdmPlan.byMonth[month].placements[item.id]?.zoneId || '', /\.bed(?:Foot)?$/);
  }
  footer.querySelector('.season-month-slider').value = 3;
  footer.querySelector('.season-month-slider').oninput();
  assert.equal(store.get().month, 12);
  assert.notEqual(store.get().placements[items[0].id]?.zoneId, 'A.bedFoot');
});

test('旧违规锁区的溢出原因不会被月计划抹掉，也不会自动解锁继续播放', async t => {
  const room = planner.buildRoom();
  const item = planner.makeItem('luggage-24', { id: 'locked-box' });
  const { store, el, clock } = await seasonPanel(t, { room, roomParams: room.params, items: [item],
    placements: { [item.id]: placement(room, item, 'A.bedFoot') }, lockedZones: ['A.bedFoot'] });
  assert.deepEqual(store.get().placements, {});
  assert.equal(store.get().fitReport.verdicts[item.id].status, 'overflow');
  assert.match(store.get().fitReport.verdicts[item.id].reasons.join(' '), /锁定/);
  assert.match(el.querySelector('.season-migration-notices').innerHTML, /锁定/);
  assert.equal(el.querySelector('[data-season-play]').disabled, true);
  assert.deepEqual(store.get().lockedZones, ['A.bedFoot']);
  el.querySelector('[data-season-tdm]').checked = false;
  el.querySelector('[data-season-tdm]').onchange();
  clock.flush();
  assert.deepEqual(store.get().placements, {});
  assert.equal(store.get().fitReport.verdicts[item.id].status, 'overflow');
  assert.equal(el.querySelector('[data-season-play]').disabled, true);
});

test('合法锁区原位也不得因全年接口缺少existing而被移走', async t => {
  const room = planner.buildRoom();
  const item = planner.makeItem('cup', { id: 'cup' });
  const old = placement(room, item, 'A.hutch');
  const { store, el } = await seasonPanel(t, { room, roomParams: room.params, items: [item],
    placements: { [item.id]: old }, lockedZones: ['A.hutch'] });
  assert.deepEqual(store.get().placements[item.id], old);
  assert.equal(el.querySelector('[data-season-play]').disabled, true);
  assert.match(el.querySelector('.season-migration-notices').innerHTML, /改变已锁区内的原位置/);
});

test('三床旧D物品与安全拦截保留记录，月份渲染明确列出名称及原因', async t => {
  const room = planner.buildRoom({ templateId: 'nanqu1' });
  const oldD = planner.makeItem('cup', { id: 'old-d', owner: 'D' });
  const danger = { ...planner.makeItem('cup', { id: 'review-cup' }), safety: { status: 'review', reason: '成分尚待核实' } };
  const items = [oldD, danger];
  const { store, el } = await seasonPanel(t, { room, roomParams: { ...room.params, occupants: ['A', 'B', 'C', 'D'] }, owner: 'D', items });
  assert.deepEqual(store.get().room.params.occupants, ['A', 'B', 'C']);
  assert.equal(store.get().items.length, 2);
  assert.equal(store.get().items[0].owner, 'D');
  assert.equal(store.get().items[0].id, 'old-d');
  assert.equal(store.get().itemStates[danger.id], 'banned');
  assert.equal(store.get().placements[danger.id], undefined);
  assert.equal(store.get().fitReport, null);
  const html = el.querySelector('.season-migration-notices').innerHTML;
  assert.match(html, /仍保留 D 归属/);
  assert.match(html, /成分尚待核实/);
  assert.match(html, /水杯/);
  assert.equal(el.querySelector('[data-season-play]').disabled, false);
});

function containerLayout(room) {
  const box = planner.makeItem('luggage-28', { id: 'box' });
  const cup = planner.makeItem('bed-basket', { id: 'inside-cup' });
  const parent = planner.planMoveIn(room, [box]).placements[box.id];
  const child = { itemId: cup.id, zoneId: `${box.id}.inside`, box: { x: 10, y: 2, z: 8, ...cup.size }, rot: 0, lying: false, layer: 0 };
  return { box, cup, placements: { [box.id]: parent, [cup.id]: child } };
}

test('箱内物品继承祖先锁，不能在全年规划中被另行取出或挪位', async t => {
  const room = planner.buildRoom();
  const { box, cup, placements } = containerLayout(room);
  const lockedZones = [placements[box.id].zoneId];
  const baseline = planner.planMoveIn(room, [box, cup], { existing: placements, lockedZones });
  assert.deepEqual(baseline.placements[cup.id], placements[cup.id]);
  const { store, el } = await seasonPanel(t, { room, roomParams: room.params, items: [box, cup], placements, lockedZones });
  assert.deepEqual(store.get().placements, placements);
  assert.equal(el.querySelector('[data-season-play]').disabled, true);
  assert.match(el.querySelector('.season-migration-notices').innerHTML, /床边收纳筐：全年方案会改变已锁区内的原位置/);
});

test('安全拦截容器内的关联物品保持待人工确认，不被月计划重新安置', async t => {
  const room = planner.buildRoom();
  const { box, cup, placements } = containerLayout(room);
  box.safety = { status: 'review', reason: '箱内内容待人工核实' };
  const { store, el } = await seasonPanel(t, { room, roomParams: room.params, items: [box, cup], placements });
  assert.equal(store.get().placements[box.id], undefined);
  assert.equal(store.get().placements[cup.id], undefined);
  assert.equal(store.get().fitReport.verdicts[box.id].status, 'banned');
  assert.equal(store.get().fitReport.verdicts[cup.id].status, 'overflow');
  assert.equal(el.querySelector('[data-season-play]').disabled, true);
  assert.match(el.querySelector('.season-migration-notices').innerHTML, /原容器或支撑物已被安全拦截/);
});

test('容量不足仍允许计算真实全年方案，每月明确展示未放物名称与原因', async t => {
  const room = planner.buildRoom();
  const giant = { ...planner.makeItem('cup', { id: 'giant', name: '超大收纳桶' }), size: { w: 1000, d: 1000, h: 1000 } };
  const { store, el } = await seasonPanel(t, { room, roomParams: room.params, items: [giant] });
  assert.equal(store.get().fitReport, null);
  assert.equal(store.get().placements[giant.id], undefined);
  assert.equal(store.get().itemStates[giant.id], 'overflow');
  assert.equal(el.querySelector('[data-season-play]').disabled, false);
  assert.match(el.querySelector('.season-migration-notices').innerHTML, /超大收纳桶：本月没有可用的合法位置/);
});

async function idleDemo(t, source, overrides = {}) {
  const { createIdleDemo } = await browserModule('./idleDemo.js');
  timers(t);
  const launcher = node();
  const document = { hidden: false, body: { append() {} }, createElement: node,
    querySelector(selector) { return selector === '#start-demo' ? launcher : null; },
    addEventListener() {}, removeEventListener() {} };
  const restoreGlobals = [];
  for (const [key, value] of Object.entries({ document, window: { addEventListener() {}, removeEventListener() {} } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restoreGlobals.push(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  const store = createStore({ ...createInitialState(planner), ...source });
  const alerts = [];
  const demo = createIdleDemo({ store, planner: { ...planner, ...overrides }, navigate() {}, refreshPanel() {}, alert: text => alerts.push(text) });
  t.after(() => { demo.dispose(); restoreGlobals.forEach(restore => restore()); });
  return { store, demo, alerts };
}

test('待机退出恢复完整用户清单和合法位置，旧腾桌/换季计划不回灌且不重写持久档案', async t => {
  const room = planner.buildRoom();
  const items = [planner.makeItem('luggage-24', { id: 'old-box' }), planner.makeItem('cup', { id: 'keep-cup' })];
  const old = { [items[0].id]: placement(room, items[0], 'A.bedFoot'), [items[1].id]: placement(room, items[1], 'A.hutch') };
  const snapshots = [{ id: 'history', items, placements: old }];
  const source = { room, roomParams: room.params, items, placements: old, snapshots, focusMinutes: 128,
    movePlan: { steps: [{ toZoneId: 'A.bedFoot' }] }, tdmPlan: { stale: true }, stepIndex: 7 };
  const before = structuredClone(source);
  const { demo, store, alerts } = await idleDemo(t, source);
  assert.equal(demo.start(), true);
  store.set({ items: [], placements: {}, episode: 'EP04' });
  assert.equal(demo.stop(), true);
  const state = store.get();
  assert.deepEqual(state.items, items);
  assert.deepEqual(state.placements[items[1].id], old[items[1].id]);
  assert.notEqual(state.placements[items[0].id]?.zoneId, 'A.bedFoot');
  assert.equal(state.movePlan, null);
  assert.equal(state.tdmPlan, null);
  assert.equal(state.stepIndex, 0);
  assert.equal(state.fitReport.verdicts[items[0].id].status, state.itemStates[items[0].id]);
  assert.deepEqual(state.sync, state.fitReport.sync);
  assert.equal(state.snapshots, snapshots);
  assert.equal(state.focusMinutes, 128);
  assert.equal(state.roomParams, room.params);
  assert.deepEqual(source, before);
  assert.match(alerts.join(' '), /重新安排/);
});

test('待机退出重建三床拓扑但不改旧D物品归属，锁区、安全与容量问题均保留', async t => {
  const room = planner.buildRoom({ templateId: 'nanqu1' });
  const oldD = planner.makeItem('cup', { id: 'old-d', owner: 'D' });
  const locked = planner.makeItem('luggage-24', { id: 'locked' });
  const danger = { ...planner.makeItem('cup', { id: 'unsafe' }), safety: { status: 'review', reason: '安全待人工核实' } };
  const source = { room, roomParams: { ...room.params, occupants: ['A', 'B', 'C', 'D'] }, owner: 'D',
    items: [oldD, locked, danger], lockedZones: ['A.bedFoot'], placements: { [locked.id]: placement(room, locked, 'A.bedFoot') } };
  const { demo, store, alerts } = await idleDemo(t, source);
  assert.equal(demo.start(), true);
  assert.equal(demo.stop(), true);
  assert.deepEqual(store.get().room.params.occupants, ['A', 'B', 'C']);
  assert.equal(store.get().owner, 'A');
  assert.equal(store.get().items.length, 3);
  assert.equal(store.get().items[0].owner, 'D');
  assert.deepEqual(store.get().lockedZones, ['A.bedFoot']);
  assert.equal(store.get().fitReport.verdicts[locked.id].status, 'overflow');
  assert.equal(store.get().fitReport.verdicts[danger.id].status, 'banned');
  assert.match(alerts.join(' '), /仍保留 D 归属/);
  assert.match(alerts.join(' '), /锁定/);
  assert.match(alerts.join(' '), /安全待人工核实/);
});

test('待机迁移失败仍保留所有物品记录，不恢复旧床面位置或旧动画', async t => {
  const room = planner.buildRoom();
  const item = planner.makeItem('cup', { id: 'cup' });
  const { demo, store, alerts } = await idleDemo(t, { room, roomParams: room.params, items: [item],
    placements: { [item.id]: placement(room, item, 'A.bedFoot') }, movePlan: { stale: true } }, {
    planMoveIn() { throw new Error('模拟复核故障'); }
  });
  assert.equal(demo.start(), true);
  assert.equal(demo.stop(), true);
  assert.deepEqual(store.get().items, [item]);
  assert.deepEqual(store.get().placements, {});
  assert.equal(store.get().room, null);
  assert.equal(store.get().movePlan, null);
  assert.equal(store.get().tdmPlan, null);
  assert.match(alerts.join(' '), /物品记录已保留/);
});
