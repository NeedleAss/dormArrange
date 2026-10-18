import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as planner from '../planner/index.js';
import { createInitialState, createStore } from '../core/store.js';
import { mount, unmount } from './panels/ep02Focus.js';

function setup(t, state) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const node = () => ({ value: '', innerHTML: '', disabled: false, classList: { toggle() {} } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, createElement: node
  } });
  const nodes = new Map();
  const el = { innerHTML: '', prepended: [],
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    querySelectorAll() { return []; }, prepend(value) { this.prepended.push(value); } };
  const footer = { innerHTML: '', querySelector: selector => el.querySelector(`footer:${selector}`) };
  const store = createStore({ ...createInitialState(planner), ...state });
  const played = [];
  mount(el, { store, planner, footer, alert() {}, scene: { playSteps(steps) { played.push(steps); return { stop() {} }; } } });
  t.after(() => { unmount(); descriptor ? Object.defineProperty(globalThis, 'document', descriptor) : delete globalThis.document; });
  return { el, store, played };
}

test('腾桌恢复旧计划时重新生成所有步骤，单步和播放均不使用旧床尾终点', t => {
  const room = planner.buildRoom();
  const { items, placements } = structuredClone(planner.PRESETS.messyDesk);
  const stale = planner.planFocusField(room, items, placements);
  const boxStep = stale.steps.find(step => step.itemName.includes('24寸'));
  boxStep.toZoneId = 'A.bedFoot';
  boxStep.to = { ...room.zones.find(zone => zone.id === 'A.bedFoot').box, w: 42, d: 27, h: 65 };
  const { store, el, played } = setup(t, { episode: 'EP02', room, roomParams: room.params,
    items, placements, movePlan: stale, stepIndex: stale.steps.length });
  const fresh = store.get().movePlan;
  assert.notEqual(fresh, stale);
  assert.equal(store.get().stepIndex, 0);
  assert.ok(fresh.steps.every(step => !/\.(bed|bedFoot)$/.test(step.toZoneId || '')
    || items.find(item => item.id === step.itemId)?.category === 'bedding'));
  el.querySelector('#orders').onclick({ target: { closest: selector => selector === '#step-order' ? {} : null } });
  assert.equal(store.get().stepIndex, 1);
  assert.notEqual(store.get().placements[boxStep.itemId]?.zoneId, 'A.bedFoot');
  el.querySelector('#orders').onclick({ target: { closest: selector => selector === '#reset-orders' ? {} : null } });
  el.querySelector('#orders').onclick({ target: { closest: selector => selector === '#play-orders' ? {} : null } });
  assert.equal(played.length, 1);
  assert.deepEqual(played[0], fresh.steps);
  // 模拟迁移替换了正在播放的状态，旧动画取消时不得再写回其位置。
  const replacement = {};
  store.set({ movePlan: null, placements: replacement });
  assert.equal(store.get().placements, replacement);
});

test('腾桌页保留并显示旧床锁区、容量与D归属问题，不把未放物品涂成已安置', t => {
  const room = planner.buildRoom({ templateId: 'nanqu1' });
  const item = planner.makeItem('luggage-24', { id: 'locked-box', owner: 'A' });
  const orphan = planner.makeItem('cup', { id: 'orphan', owner: 'D' });
  const old = { itemId: item.id, zoneId: 'A.bedFoot', box: { ...room.zones.find(zone => zone.id === 'A.bedFoot').box,
    ...item.size }, rot: 0, lying: false, layer: 0 };
  const { store, el } = setup(t, { episode: 'EP02', room, roomParams: room.params,
    items: [item, orphan], placements: { [item.id]: old }, lockedZones: ['A.bedFoot'] });
  assert.equal(store.get().items.length, 2);
  assert.equal(store.get().items.find(item => item.id === 'orphan').owner, 'D');
  assert.equal(store.get().placements['locked-box'], undefined);
  assert.equal(store.get().itemStates['locked-box'], 'overflow');
  assert.match(el.prepended.map(node => node.innerHTML).join(' '), /锁定/);
  assert.match(el.prepended.map(node => node.innerHTML).join(' '), /仍保留 D 归属/);
});
