import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createStore, createInitialState } from '../core/store.js';
import { EPISODES } from './helpers.js';
import { mountShell } from './shell.js';

function element(dataset = {}) {
  const classes = new Set();
  return { dataset, attributes: {}, classList: {
    toggle(name, force = !classes.has(name)) {
      if (force) classes.add(name); else classes.delete(name);
      return force;
    },
    contains: name => classes.has(name)
  }, setAttribute(name, value) { this.attributes[name] = value; } };
}

test('底栏发光按钮在视角旁，点击与外部状态更新都同步可访问状态', t => {
  t.mock.method(globalThis, 'setInterval', () => 0);
  const store = createStore(createInitialState());
  const nodes = new Map();
  const cameraButtons = ['orbit', 'top', 'seat'].map(camera => element({ camera }));
  const episodeButtons = EPISODES.map(({ id }) => element({ episode: id }));
  const root = {
    dataset: {},
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll(selector) { return selector === '[data-camera]' ? cameraButtons : episodeButtons; }
  };
  mountShell(root, store);
  assert.match(root.innerHTML, /data-camera="seat"[^]*id="bloom-toggle"[^]*title="帧率不足时自动关闭">发光<\/button>/);
  const button = root.querySelector('#bloom-toggle');
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.equal(button.classList.contains('active'), false);
  button.onclick();
  assert.equal(store.get().bloom, true);
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(button.classList.contains('active'), true);
  store.set({ bloom: false });
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.equal(button.classList.contains('active'), false);
  button.onclick();
  cameraButtons[1].onclick();
  assert.equal(store.get().camera, 'top');
  assert.equal(store.get().bloom, true);
});

function shortcut() {
  // 入口含字体和浏览器启动依赖，定向运行它注册的真实键盘回调。
  const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const marker = "document.addEventListener('keydown', event => {";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1);
  const end = source.indexOf('\n});', start);
  assert.ok(end > start);
  const store = createStore(createInitialState());
  let input = null;
  let overlay = null;
  const document = { querySelector: selector => overlay && selector.split(',').includes(overlay) ? {} : null };
  const target = { closest(selector) { return input && selector.split(',').includes(input) ? {} : null; } };
  const handler = vm.runInNewContext(`event => {${source.slice(start + marker.length, end)}\n}`, { document, store });
  function press(key, options = {}) {
    const event = { target, key, code: `Key${key.toUpperCase()}`, prevented: false,
      preventDefault() { this.prevented = true; }, ...options };
    handler(event);
    return event;
  }
  return { store, press, setInput: value => { input = value; }, setOverlay: value => { overlay = value; } };
}

test('B 键切换同一发光状态，长按重复和系统组合键不会反复切换', () => {
  const { store, press } = shortcut();
  assert.equal(press('b').prevented, true);
  assert.equal(store.get().bloom, true);
  press('b', { repeat: true });
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) press('b', { [modifier]: true });
  assert.equal(store.get().bloom, true);
  assert.equal(press('B').prevented, true);
  assert.equal(store.get().bloom, false);
});

test('输入区或标题卡、开机、专注覆盖层出现时 B 键不切换', () => {
  const { store, press, setInput, setOverlay } = shortcut();
  for (const selector of ['input', 'textarea', 'select', '[contenteditable]']) {
    setInput(selector);
    assert.equal(press('b').prevented, false);
    assert.equal(store.get().bloom, false);
  }
  setInput(null);
  for (const selector of ['.title-card', '.boot-screen', '.focus-limit']) {
    setOverlay(selector);
    assert.equal(press('B').prevented, false);
    assert.equal(store.get().bloom, false);
  }
  setOverlay(null);
  press('b');
  assert.equal(store.get().bloom, true);
});
