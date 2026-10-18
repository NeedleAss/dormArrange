import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotThumb, isSnapshotThumb, MAX_THUMB_LENGTH } from './snapshotThumb.js';

const png = 'data:image/png;base64,AAAA';
const jpeg = 'data:image/jpeg;base64,/9j/2Q==';

function environment(options = {}) {
  const calls = [];
  let image;
  const context = { drawImage(...args) { calls.push(['draw', ...args.slice(1)]); if (options.drawError) throw new Error('无法绘制'); } };
  const canvas = {
    getContext(kind) { calls.push(['context', kind]); return options.noContext ? null : context; },
    toDataURL(type, quality) {
      calls.push(['encode', this.width, this.height, type, quality]);
      if (options.encodeError) throw new Error('无法编码');
      return options.result ?? jpeg;
    }
  };
  class TestImage {
    constructor() { image = this; this.naturalWidth = options.width ?? 1600; this.naturalHeight = options.height ?? 1000; }
    set src(value) {
      calls.push(['source', value]);
      if (options.pending) return;
      queueMicrotask(() => options.imageError ? this.onerror?.() : this.onload?.());
    }
  }
  return { Image: TestImage, document: { createElement: () => canvas }, timeoutMs: 100,
    calls, get image() { return image; } };
}

test('截图异步解码后保持比例缩成240px宽，使用JPEG质量0.7', async () => {
  const env = environment();
  const pending = createSnapshotThumb(png, env);
  assert.equal(env.calls.filter(call => call[0] === 'encode').length, 0);
  assert.equal(await pending, jpeg);
  assert.deepEqual(env.calls.find(call => call[0] === 'draw'), ['draw', 0, 0, 240, 150]);
  assert.deepEqual(env.calls.find(call => call[0] === 'encode'), ['encode', 240, 150, 'image/jpeg', .7]);
  assert.equal(env.image.onload, null);
  assert.equal(env.image.onerror, null);
});

test('不读取外部URL，空截图或缺失场景的结果直接省略', async () => {
  for (const source of [null, undefined, '', 'https://example.test/scene.png', 'data:text/plain;base64,AAAA']) {
    const env = environment();
    assert.equal(await createSnapshotThumb(source, env), null);
    assert.equal(env.calls.length, 0);
  }
});

for (const [name, options] of [
  ['图片解码失败', { imageError: true }],
  ['画布上下文不可用', { noContext: true }],
  ['绘制失败', { drawError: true }],
  ['编码失败', { encodeError: true }],
  ['浏览器返回了非JPEG', { result: png }],
  ['宽度为零', { width: 0 }],
  ['高度无效', { height: NaN }],
  ['结果超过30KB', { result: `data:image/jpeg;base64,${'A'.repeat(MAX_THUMB_LENGTH)}` }]
]) {
  test(`${name}只省略缩略图，不抛出异常`, async () => {
    assert.equal(await createSnapshotThumb(png, environment(options)), null);
  });
}

test('图片构造失败也安全返回空缩略图', async () => {
  class UnavailableImage { constructor() { throw new Error('图片不可用'); } }
  assert.equal(await createSnapshotThumb(png, { Image: UnavailableImage }), null);
});

test('解码超时后释放回调，迟来的onload不再编码', async () => {
  const env = environment({ pending: true });
  env.timeoutMs = 5;
  const pending = createSnapshotThumb(png, env);
  const lateLoad = env.image.onload;
  assert.equal(await pending, null);
  assert.equal(env.image.onload, null);
  lateLoad();
  assert.equal(env.calls.filter(call => call[0] === 'encode').length, 0);
});

test('渲染只接受预算内的JPEG dataURL', () => {
  assert.equal(isSnapshotThumb(jpeg), true);
  for (const value of [null, png, 'https://example.test/a.jpeg', 'data:image/jpegx;base64,AAAA', 'data:image/jpeg;base64,AAAA" onerror="x', `data:image/jpeg;base64,${'A'.repeat(MAX_THUMB_LENGTH)}`]) {
    assert.equal(isSnapshotThumb(value), false);
  }
});
