import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createInitialState } from '../core/store.js';
import { bindScene } from './sceneBinder.js';
import * as planner from '../planner/index.js';

function fallback() {
  const placeholder = { hidden: true };
  const canvas = { hidden: false, setAttribute() { this.hidden = true; } };
  return { innerHTML: '', placeholder, canvas, closest(selector) {
    return selector === '.scene-placeholder' ? placeholder : { querySelector: () => canvas };
  } };
}

test('一个订阅者抛错不阻断后续订阅和状态提交', t => {
  const errors = t.mock.method(console, 'error', () => {});
  const store = createStore({ counter: 0 });
  let observed = 0;
  store.subscribe(() => { throw new Error('订阅失败'); });
  store.subscribe(s => { observed = s.counter; });
  assert.doesNotThrow(() => store.set({ counter: 1 }));
  assert.equal(observed, 1);
  assert.equal(store.get().counter, 1);
  assert.equal(errors.mock.callCount(), 1);
});

test('初次绑定失败只警报一次，平面预览继续随状态更新', t => {
  const errors = t.mock.method(console, 'error', () => {});
  const store = createStore(createInitialState(planner));
  const preview = fallback();
  let failures = 0;
  const scene = new Proxy({}, { get: (_, key) => key === 'setItemStates' ? () => { throw new Error('x'); } : () => {} });
  assert.doesNotThrow(() => bindScene(store, scene, preview, { onFailure: () => failures++ }));
  assert.equal(failures, 1);
  assert.equal(preview.placeholder.hidden, false);
  assert.equal(preview.canvas.hidden, true);
  assert.match(preview.innerHTML, /<svg/);
  preview.innerHTML = '';
  let notified = false;
  store.subscribe(() => { notified = true; }, ['placements']);
  store.set({ placements: {} });
  assert.equal(notified, true);
  assert.match(preview.innerHTML, /<svg/);
  assert.equal(store.get().alerts.filter(a => a.id === 'scene-fallback').length, 1);
  assert.equal(errors.mock.callCount(), 1);
});

for (const method of ['setRoom', 'setZoneStatus', 'setItems', 'setItemStates', 'setCamera', 'showFocusField', 'setFocusFieldState', 'showTolerance', 'focusOn']) {
  test(`运行中 ${method} 失败后退出场景且后续面板仍收到广播`, t => {
    const errors = t.mock.method(console, 'error', () => {});
    const store = createStore(createInitialState(planner));
    let throwing = false, failures = 0, notified = 0;
    const scene = new Proxy({}, { get: (_, key) => () => { if (throwing && key === method) throw new Error('x'); } });
    bindScene(store, scene, fallback(), { onFailure: () => failures++ });
    store.subscribe(() => { notified++; }, ['selection']);
    throwing = true;
    const s = store.get();
    assert.doesNotThrow(() => store.set({ room: { ...s.room }, items: [...s.items], placements: {}, itemStates: {}, camera: 'top', episode: 'EP02', selection: 'A.desk' }));
    assert.equal(failures, 1);
    assert.equal(notified, 1);
    assert.equal(errors.mock.callCount(), 1);
    store.set({ selection: 'A.shelf' });
    assert.equal(notified, 2);
    assert.equal(errors.mock.callCount(), 1);
  });
}
