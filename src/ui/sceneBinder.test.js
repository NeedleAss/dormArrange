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

for (const method of ['setRoom', 'setZoneStatus', 'setItems', 'setItemStates', 'setCamera', 'setBloom', 'showFocusField', 'setFocusFieldState', 'showTolerance', 'focusOn']) {
  test(`运行中 ${method} 失败后退出场景且后续面板仍收到广播`, t => {
    const errors = t.mock.method(console, 'error', () => {});
    const store = createStore(createInitialState(planner));
    let throwing = false, failures = 0, notified = 0;
    const scene = new Proxy({}, { get: (_, key) => () => { if (throwing && key === method) throw new Error('x'); } });
    bindScene(store, scene, fallback(), { onFailure: () => failures++ });
    store.subscribe(() => { notified++; }, ['selection']);
    throwing = true;
    const s = store.get();
    assert.doesNotThrow(() => store.set({ room: { ...s.room }, items: [...s.items], placements: {}, itemStates: {}, camera: 'top', bloom: true, episode: 'EP02', selection: 'A.desk' }));
    assert.equal(failures, 1);
    assert.equal(notified, 1);
    assert.equal(errors.mock.callCount(), 1);
    store.set({ selection: 'A.shelf' });
    assert.equal(notified, 2);
    assert.equal(errors.mock.callCount(), 1);
  });
}

test('发光只由状态变化同步，初始关闭且解绑后不再调用场景', () => {
  const store = createStore(createInitialState(planner));
  const calls = [];
  const unsubscribe = bindScene(store, { setBloom: on => calls.push(on) });
  assert.deepEqual(calls, [false]);
  store.set({ bloom: true });
  store.set({ bloom: true });
  store.set({ camera: 'top' });
  assert.deepEqual(calls, [false, true]);
  store.set({ bloom: false });
  assert.deepEqual(calls, [false, true, false]);
  unsubscribe();
  store.set({ bloom: true });
  assert.deepEqual(calls, [false, true, false]);
});

test('场景缺席或没有发光接口时仍可更新开关', () => {
  for (const scene of [null, {}]) {
    const store = createStore(createInitialState(planner));
    const unsubscribe = bindScene(store, scene);
    assert.doesNotThrow(() => store.set({ bloom: true }));
    assert.equal(store.get().bloom, true);
    unsubscribe();
  }
});

test('发光为临时偏好，忽略旧存储中的开关且不写入持久化数据', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let saved = JSON.stringify({ bloom: true, focusMinutes: 10 });
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => saved,
    setItem: (_key, value) => { saved = value; writes++; }
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  const store = createStore(createInitialState(planner));
  assert.equal(store.get().bloom, false);
  store.set({ bloom: true });
  assert.equal(writes, 0);
  store.set({ focusMinutes: 25 });
  assert.equal(writes, 1);
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['focusMinutes', 'roomParams', 'snapshots']);
  const reloaded = createStore(createInitialState(planner));
  assert.equal(reloaded.get().bloom, false);
  assert.equal(reloaded.get().focusMinutes, 25);
});
