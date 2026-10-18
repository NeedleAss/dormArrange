import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { compressPhoto } from './photo.js';
import { normalizeItems } from './normalize.js';

const SYNTHETIC_JPEG = 'data:image/jpeg;base64,AA==';

/** 图片像素和浏览器 API 都是合成数据，测试不会读取照片文件。 */
function installMockDOM(options = {}) {
  const width = options.width ?? 2048;
  const height = options.height ?? 1536;
  const saved = {
    Image: globalThis.Image, document: globalThis.document,
    createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL,
  };
  const observed = { objectURLs: [], revokedURLs: [], canvases: [], encodings: [], draws: [], fills: [], images: [] };
  URL.createObjectURL = () => { observed.objectURLs.push('blob:synthetic-photo'); return 'blob:synthetic-photo'; };
  URL.revokeObjectURL = (url) => { observed.revokedURLs.push(url); };
  globalThis.Image = class {
    constructor() {
      this.naturalWidth = width;
      this.naturalHeight = height;
      observed.images.push(this);
    }
    set src(value) {
      if (!value) return;
      queueMicrotask(() => options.decodeError
        ? this.onerror?.(new Error('private decoder detail')) : this.onload?.());
    }
  };
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error('不期望的 DOM 节点');
      const context = {
        fillStyle: '',
        fillRect(...args) { observed.fills.push({ color: this.fillStyle, args }); },
        drawImage(image, ...args) {
          if (options.drawError) throw new Error('private canvas detail');
          observed.draws.push(args);
        },
      };
      const canvas = {
        width: 0, height: 0,
        getContext: () => options.contextNull ? null : context,
        toDataURL(type, quality) {
          if (options.encodeError) throw new Error('private encoder detail');
          observed.encodings.push({ type, quality });
          return options.dataURL ?? 'data:image/jpeg;base64,AA==';
        },
      };
      observed.canvases.push(canvas);
      return canvas;
    },
  };
  return {
    observed,
    restore() {
      if (saved.Image === undefined) delete globalThis.Image;
      else globalThis.Image = saved.Image;
      if (saved.document === undefined) delete globalThis.document;
      else globalThis.document = saved.document;
      URL.createObjectURL = saved.createObjectURL;
      URL.revokeObjectURL = saved.revokeObjectURL;
    },
  };
}

function installForTest(t, options) {
  const fixture = installMockDOM(options);
  t.after(fixture.restore);
  return fixture.observed;
}

function syntheticFile(type = 'image/png') {
  return new Blob(['synthetic image payload'], { type });
}

for (const [width, height, expectedWidth, expectedHeight] of [
  [2048, 1536, 1024, 768], [600, 2400, 256, 1024], [600, 400, 600, 400],
]) {
  test(`照片 ${width}×${height} 压缩为 ${expectedWidth}×${expectedHeight} 的 JPEG`, async (t) => {
    const observed = installForTest(t, { width, height });
    assert.equal(await compressPhoto(syntheticFile()), SYNTHETIC_JPEG);
    assert.equal(observed.canvases[0].width, expectedWidth);
    assert.equal(observed.canvases[0].height, expectedHeight);
    assert.deepEqual(observed.encodings, [{ type: 'image/jpeg', quality: 0.8 }]);
    assert.deepEqual(observed.draws, [[0, 0, expectedWidth, expectedHeight]]);
    assert.deepEqual(observed.fills[0].args, [0, 0, expectedWidth, expectedHeight]);
    assert.ok(['#fff', '#ffffff', 'white'].includes(observed.fills[0].color));
    assert.deepEqual(observed.revokedURLs, observed.objectURLs);
    assert.equal(observed.images[0].onload, null);
    assert.equal(observed.images[0].onerror, null);
  });
}

for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
  test(`允许 ${type} 合成照片输入`, async (t) => {
    installForTest(t);
    assert.equal(await compressPhoto(syntheticFile(type)), SYNTHETIC_JPEG);
  });
}

for (const [label, file] of [
  ['空文件', new Blob([], { type: 'image/png' })],
  ['非图片', syntheticFile('text/plain')],
  ['SVG', syntheticFile('image/svg+xml')],
  ['超出20MB', { type: 'image/png', size: 20 * 1024 * 1024 + 1 }],
  ['未提供文件', null],
]) {
  test(`${label} 返回 BAD_IMAGE，且不启动图像解码`, async (t) => {
    const observed = installForTest(t);
    await assert.rejects(compressPhoto(file), { code: 'BAD_IMAGE' });
    assert.equal(observed.objectURLs.length, 0);
    assert.equal(observed.canvases.length, 0);
  });
}

for (const [label, options] of [
  ['解码失败', { decodeError: true }],
  ['宽度无效', { width: 0 }],
  ['高度无效', { height: Infinity }],
  ['canvas上下文缺失', { contextNull: true }],
  ['绘制失败', { drawError: true }],
  ['编码失败', { encodeError: true }],
  ['编码结果不是JPEG', { dataURL: 'data:image/png;base64,AA==' }],
]) {
  test(`${label} 固定返回 BAD_IMAGE 并释放临时资源`, async (t) => {
    const observed = installForTest(t, options);
    await assert.rejects(compressPhoto(syntheticFile()), (error) => {
      assert.equal(error.code, 'BAD_IMAGE');
      assert.equal(error.message.includes('private'), false);
      return true;
    });
    assert.deepEqual(observed.revokedURLs, ['blob:synthetic-photo']);
    assert.equal(observed.images[0].onload, null);
    assert.equal(observed.images[0].onerror, null);
  });
}

/** 单独进程隔离公开接口的配置缓存，所有 fetch 仍由测试模拟。 */
function runPhotoAPI(settings = {}) {
  const moduleURL = new URL('./index.js', import.meta.url).href;
  const source = `
    const settings = ${JSON.stringify(settings)};
    const installMockDOM = ${installMockDOM.toString()};
    const fixture = installMockDOM(settings.dom ?? {});
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      if (url === '/ai/__config') return new Response(JSON.stringify({
        enabled: settings.enabled ?? true, model: 'test-model', wire: settings.wire ?? 'chat', vision: settings.vision ?? true,
      }));
      requests.push({ url, body: JSON.parse(init.body) });
      if (settings.kind === 'http') return new Response('{}', { status: 503 });
      const raw = { items: [{
        name: '27寸显示器', qty: 1, category: 'electronics', size_cm: { w: 40, d: 12, h: 30 },
        size_confidence: 'product', freq: 'daily', months: [], power_w: null,
        hangable: false, stackable: false, compressible: false, note: '桌面物品',
        position_hint: { horizontal: 'left', depth: 'front' },
      }] };
      const text = settings.kind === 'bad-json' ? 'not-json'
        : settings.kind === 'empty' ? '{"items":[]}' : JSON.stringify(raw);
      return new Response(JSON.stringify(settings.wire === 'responses'
        ? { output_text: text } : { choices: [{ message: { content: text } }] }));
    };
    const file = settings.poisonFile ? new Proxy({}, { get() { throw new Error('不应读取文件'); } })
      : new Blob(['synthetic image payload'], { type: 'image/png' });
    const { aiParsePhoto } = await import(${JSON.stringify(moduleURL)});
    const result = await aiParsePhoto(file, { owner: 'B' });
    process.stdout.write(JSON.stringify({ result, requests, observed: fixture.observed }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  return JSON.parse(child.stdout);
}

for (const settings of [{ enabled: false, vision: true }, { enabled: true, vision: false }]) {
  test(`照片未启用 ${JSON.stringify(settings)} 时不读取文件、不发送图片请求`, () => {
    const { result, requests, observed } = runPhotoAPI({ ...settings, poisonFile: true });
    assert.equal(result.source, 'unavailable');
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.warnings, ['当前模型不支持图片']);
    assert.equal(requests.length, 0);
    assert.equal(observed.objectURLs.length, 0);
  });
}

for (const wire of ['chat', 'responses']) {
  test(`公开照片接口通过 ${wire} 发送 JPEG，物品来源为 estimated`, () => {
    const { result, requests, observed } = runPhotoAPI({ wire });
    assert.equal(result.source, 'ai');
    assert.equal(result.items.length, 1);
    const [item] = result.items;
    assert.equal(item.id, 'ai-001');
    assert.equal(item.owner, 'B');
    assert.equal(item.sizeSource, 'estimated');
    assert.deepEqual(item.size, { w: 40, d: 12, h: 30 });
    assert.equal(item.note, '照片位置：左侧、前方；桌面物品');
    assert.equal(item.position_hint, undefined);
    assert.equal(item.positionHint, undefined);
    assert.equal(requests.length, 1);
    const body = requests[0].body;
    const user = (wire === 'chat' ? body.messages : body.input).find(({ role }) => role === 'user');
    assert.deepEqual(user.content.at(-1), wire === 'chat'
      ? { type: 'image_url', image_url: { url: SYNTHETIC_JPEG } }
      : { type: 'input_image', image_url: SYNTHETIC_JPEG });
    assert.deepEqual(observed.revokedURLs, observed.objectURLs);
  });
}

for (const [kind, expectedCode] of [['bad-json', 'BAD_JSON'], ['http', 'HTTP_5XX']]) {
  test(`照片接口 ${kind} 时返回固定中文及 ${expectedCode}`, () => {
    const { result } = runPhotoAPI({ kind });
    assert.equal(result.source, 'unavailable');
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.warnings, ['照片解析暂不可用，请改用文字清单。', expectedCode]);
  });
}

test('照片解码错误时公开接口返回 unavailable 和 BAD_IMAGE，不请求模型', () => {
  const { result, requests } = runPhotoAPI({ dom: { decodeError: true } });
  assert.equal(result.source, 'unavailable');
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.warnings, ['照片解析暂不可用，请改用文字清单。', 'BAD_IMAGE']);
  assert.equal(requests.length, 0);
});

test('照片模型未识别出物品时返回换图或改用文字的提示', () => {
  const { result } = runPhotoAPI({ kind: 'empty' });
  assert.equal(result.source, 'unavailable');
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.warnings, ['没有识别到物品，请换一张清晰照片或输入文字。']);
});

test('照片位置提示只保留白名单并放入 note，不新增契约字段', () => {
  const raw = JSON.stringify({ items: [{
    name: '特殊照片物件', qty: 1, category: 'misc', size_cm: { w: 10, d: 10, h: 10 },
    size_confidence: 'product', position_hint: { horizontal: '__proto__', depth: 'constructor', x: 123 },
    note: '原说明',
  }] });
  const { items: [item] } = normalizeItems(raw, { photo: true });
  assert.equal(item.sizeSource, 'estimated');
  assert.equal(item.note, '原说明');
  assert.equal(item.position_hint, undefined);
  assert.equal(item.x, undefined);
});

test('位置提示中的非字符串值被忽略，不影响照片物品', () => {
  const raw = JSON.stringify({ items: [{
    name: '特殊照片物件', qty: 1, category: 'misc', size_cm: { w: 10, d: 10, h: 10 },
    size_confidence: 'estimated', position_hint: { horizontal: { toString: null }, depth: ['front'] },
    note: '原说明',
  }] });
  const { items: [item] } = normalizeItems(raw, { photo: true });
  assert.equal(item.note, '原说明');
});
