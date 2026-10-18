import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installErrorBoundary } from './errorBoundary.js';

class TestElement {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this.textContent = '';
    this.parentNode = null;
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
}

function setup() {
  const document = { createElement() { return new TestElement(document); } };
  document.body = new TestElement(document);
  const root = document.createElement('main');
  const panel = document.createElement('section');
  panel.textContent = '已有文字面板';
  root.appendChild(panel);
  document.body.appendChild(root);
  const listeners = new Map();
  const removals = [];
  const window = {
    addEventListener(kind, listener, capture) { listeners.set(kind, { listener, capture }); },
    removeEventListener(kind, listener, capture) {
      removals.push({ kind, listener, capture });
      const registered = listeners.get(kind);
      if (registered?.listener === listener && registered.capture === capture) listeners.delete(kind);
    }
  };
  const logs = [];
  const boundary = installErrorBoundary(root, { window, document, console: { error: (...args) => logs.push(args) } });
  function dispatch(kind, fields = {}) {
    const event = { ...fields, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    listeners.get(kind)?.listener(event);
    return event;
  }
  return { boundary, dispatch, root, panel, document, listeners, removals, logs };
}

test('两类全局异常取消默认输出，并在警报连接后补发固定中文', () => {
  const { boundary, dispatch, logs } = setup();
  const privateText = '上游内部信息与原始异常正文';
  assert.equal(dispatch('error', { error: new Error(privateText), message: privateText }).defaultPrevented, true);
  assert.equal(dispatch('unhandledrejection', { reason: new Error(privateText) }).defaultPrevented, true);
  const alerts = [];
  boundary.connectAlert((...args) => alerts.push(args));
  assert.deepEqual(alerts, [
    ['界面操作暂时未完成，请重试。', 'error'],
    ['后台操作暂时未完成，请重试。', 'error']
  ]);
  assert.deepEqual(logs, [
    ['界面发生异常，已提供恢复提示。'],
    ['后台操作发生异常，已提供恢复提示。']
  ]);
  assert.equal(JSON.stringify({ alerts, logs }).includes(privateText), false);
  boundary.dispose();
});

test('已连接警报立即通知，同类重复异常也取消默认行为但不重复通知', () => {
  const { boundary, dispatch, logs } = setup();
  const alerts = [];
  boundary.connectAlert((...args) => alerts.push(args));
  for (const kind of ['error', 'unhandledrejection']) {
    assert.equal(dispatch(kind).defaultPrevented, true);
    assert.equal(dispatch(kind).defaultPrevented, true);
  }
  assert.equal(alerts.length, 2);
  assert.equal(logs.length, 2);
  boundary.connectAlert((...args) => alerts.push(args));
  assert.equal(alerts.length, 2);
  boundary.dispose();
});

test('启动失败保留已有面板，固定提示位于应用外，重复调用不叠加', () => {
  const { boundary, root, panel, document, logs } = setup();
  const originalChildren = [...root.children];
  const privateText = '不应显示的启动异常正文';
  boundary.failStartup(new Error(privateText));
  boundary.failStartup(new Error(privateText));
  assert.deepEqual(root.children, originalChildren);
  assert.equal(root.children[0], panel);
  assert.equal(panel.textContent, '已有文字面板');
  assert.equal(document.body.children.length, 2);
  const banner = document.body.children[1];
  assert.equal(banner.className, 'startup-error-banner');
  assert.equal(banner.attributes.role, 'alert');
  assert.equal(banner.textContent, '启动失败，按 F5 重试');
  assert.equal(logs.length, 1);
  const alerts = [];
  boundary.connectAlert((...args) => alerts.push(args));
  assert.deepEqual(alerts, [['启动失败，按 F5 重试', 'error']]);
  assert.equal(JSON.stringify({ logs, alerts, bannerText: banner.textContent }).includes(privateText), false);
  boundary.dispose();
  assert.deepEqual(document.body.children, [root]);
  assert.deepEqual(root.children, originalChildren);
});

test('警报回调抛错不外泄，重新连接后可补发，失败日志仍为固定中文', () => {
  const { boundary, dispatch, logs } = setup();
  const privateText = '警报渲染内部异常正文';
  boundary.connectAlert(() => { throw new Error(privateText); });
  assert.doesNotThrow(() => dispatch('error'));
  assert.doesNotThrow(() => dispatch('unhandledrejection'));
  assert.equal(logs.filter(args => args[0] === '恢复提示暂时无法写入警报区。').length, 1);
  assert.equal(JSON.stringify(logs).includes(privateText), false);
  const alerts = [];
  boundary.connectAlert((...args) => alerts.push(args));
  assert.equal(alerts.length, 2);
  boundary.dispose();
});

test('警报回调触发另一类异常时排队处理，不递归渲染', () => {
  const { boundary, dispatch } = setup();
  let depth = 0;
  let maxDepth = 0;
  const alerts = [];
  boundary.connectAlert(message => {
    depth++;
    maxDepth = Math.max(maxDepth, depth);
    alerts.push(message);
    dispatch('error');
    dispatch('unhandledrejection');
    depth--;
  });
  dispatch('error');
  assert.equal(maxDepth, 1);
  assert.equal(alerts.length, 2);
  boundary.dispose();
});

test('兜底完全不读取事件里的异常、消息或拒绝原因', () => {
  const { boundary, listeners, logs } = setup();
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  for (const key of ['error', 'message', 'reason']) {
    Object.defineProperty(event, key, { get() { throw new Error('不得读取异常内容'); } });
  }
  assert.doesNotThrow(() => listeners.get('error').listener(event));
  assert.doesNotThrow(() => listeners.get('unhandledrejection').listener(event));
  assert.equal(prevented, 2);
  assert.equal(logs.length, 2);
  boundary.dispose();
});

test('清理解绑两类事件且可重复调用，后续调用不再通知或写入提示', () => {
  const { boundary, dispatch, listeners, removals, document, root, logs } = setup();
  const alerts = [];
  boundary.connectAlert((...args) => alerts.push(args));
  boundary.failStartup();
  boundary.dispose();
  boundary.dispose();
  assert.equal(listeners.size, 0);
  assert.deepEqual(removals.map(({ kind, capture }) => [kind, capture]), [['error', true], ['unhandledrejection', false]]);
  assert.equal(dispatch('error').defaultPrevented, false);
  assert.equal(dispatch('unhandledrejection').defaultPrevented, false);
  boundary.failStartup(new Error('清理后的异常正文'));
  boundary.connectAlert(() => { throw new Error('不应再调用'); });
  assert.equal(alerts.length, 1);
  assert.equal(logs.length, 1);
  assert.deepEqual(document.body.children, [root]);
});
