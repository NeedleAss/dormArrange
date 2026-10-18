import test from 'node:test';
import assert from 'node:assert/strict';
import { makeItemMessages } from './prompts.js';

let moduleSequence = 0;

const messages = [
  { role: 'system', content: '只输出测试 JSON。' },
  { role: 'user', content: '一本测试书' },
];

/** 为每个用例隔离配置缓存、文本缓存和请求队列。 */
async function mockClient(t, handler, overrides = {}, configHandler) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const config = { enabled: true, model: 'test-model', wire: 'chat', vision: false, ...overrides };

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const request = { url, init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(request);
    if (url === '/ai/__config') return configHandler ? configHandler(request) : jsonResponse(config);
    return handler(request);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = await import(`./client.js?test=${++moduleSequence}`);
  return { client, calls, requests: () => calls.filter(({ url }) => url !== '/ai/__config') };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function chatResponse(text = '{"items":[]}') {
  return jsonResponse({ choices: [{ message: { content: text } }] });
}

test('未配置 AI 时读取安全配置，并且不会发送生成请求', async (t) => {
  const { client, calls, requests } = await mockClient(t, () => {
    assert.fail('禁用时不应请求 AI');
  }, { enabled: false, model: '' });

  const first = await client.getConfig();
  const second = await client.getConfig();
  assert.equal(first.enabled, false);
  assert.deepEqual(second, first);
  await assert.rejects(client.chat(messages), { code: 'DISABLED' });
  assert.equal(calls.filter(({ url }) => url === '/ai/__config').length, 1);
  assert.equal(requests().length, 0);
});

test('chat 协议发送 JSON 格式要求并提取纯文本', async (t) => {
  const answer = '{"items":[{"name":"书"}]}';
  const { client, requests } = await mockClient(t, () => chatResponse(answer));

  assert.equal(await client.chat(messages), answer);
  const request = requests()[0];
  assert.equal(request.url, '/ai/v1/chat/completions');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.body.model, 'test-model');
  assert.equal(request.body.temperature, 0);
  assert.deepEqual(request.body.messages, messages);
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert.equal(new Headers(request.init.headers).has('authorization'), false);
});

test('json=false 时 chat 不要求 JSON 输出', async (t) => {
  const { client, requests } = await mockClient(t, () => chatResponse('一句测试说明'));
  assert.equal(await client.chat(messages, { json: false }), '一句测试说明');
  assert.equal(requests()[0].body.response_format, undefined);
});

test('responses 协议使用 input_text 并优先读取 output_text', async (t) => {
  const { client, requests } = await mockClient(t, () => jsonResponse({
    output_text: '{"items":[]}',
    output: [{ content: [{ type: 'output_text', text: '不应选中此备选内容' }] }],
  }), { wire: 'responses' });

  assert.equal(await client.chat(messages), '{"items":[]}');
  const request = requests()[0];
  assert.equal(request.url, '/ai/v1/responses');
  assert.equal(request.body.model, 'test-model');
  assert.deepEqual(request.body.input, messages.map(({ role, content }) => ({
    role, content: [{ type: 'input_text', text: content }],
  })));
  assert.deepEqual(request.body.text, { format: { type: 'json_object' } });
});

test('responses 没有 output_text 时拼接输出文本片段', async (t) => {
  const { client } = await mockClient(t, () => jsonResponse({ output: [
    { content: [{ type: 'output_text', text: '{"items":' }, { type: 'reasoning', text: '忽略' }] },
    { content: [{ type: 'output_text', text: '[]}' }] },
  ] }), { wire: 'responses' });

  assert.equal(await client.chat(messages), '{"items":[]}');
});

test('responses 的 few-shot assistant 使用字符串，用户消息仍使用 input_text', async (t) => {
  const { client, requests } = await mockClient(t, () => jsonResponse({ output_text: '{"items":[]}' }), { wire: 'responses' });
  const prompt = makeItemMessages('测试书20本');
  await client.chat(prompt);
  const sent = requests()[0].body.input;
  const assistants = sent.filter(({ role }) => role === 'assistant');
  assert.ok(assistants.length >= 2);
  for (const message of assistants) {
    assert.equal(typeof message.content, 'string');
    assert.ok(Array.isArray(JSON.parse(message.content).items));
  }
  for (const message of sent.filter(({ role }) => role === 'user')) {
    assert.ok(Array.isArray(message.content));
    assert.equal(message.content[0].type, 'input_text');
    assert.equal(typeof message.content[0].text, 'string');
  }
  assert.equal(sent.at(-1).content[0].text, '测试书20本');
});

test('chat 被拒绝 response_format 后移除字段并仅重试一次', async (t) => {
  let count = 0;
  const { client, requests } = await mockClient(t, () => {
    count += 1;
    return count === 1
      ? jsonResponse({ error: { message: 'Unsupported parameter: response_format' } }, 400)
      : chatResponse('{"items":[]}');
  });

  assert.equal(await client.chat(messages), '{"items":[]}');
  assert.equal(requests().length, 2);
  assert.deepEqual(requests()[0].body.response_format, { type: 'json_object' });
  assert.equal(requests()[1].body.response_format, undefined);
});

test('chat 格式兼容重试失败后结束，不继续重试', async (t) => {
  const { client, requests } = await mockClient(t, () => jsonResponse({
    error: { message: 'Unsupported parameter: response_format' },
  }, 400));

  await assert.rejects(client.chat(messages), { code: 'HTTP_4XX' });
  assert.equal(requests().length, 2);
});

test('超时中止请求并返回统一错误码', async (t) => {
  const { client, requests } = await mockClient(t, ({ init }) => new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('测试请求已中止', 'AbortError'));
    if (init.signal.aborted) abort();
    else init.signal.addEventListener('abort', abort, { once: true });
  }));

  await assert.rejects(client.chat(messages, { timeoutMs: 10 }), { code: 'TIMEOUT' });
  assert.equal(requests().length, 1);
  assert.equal(requests()[0].init.signal.aborted, true);
});

for (const status of [401, 429, 500, 503]) {
  test(`HTTP ${status} 转为统一错误码且不泄露上游内容`, async (t) => {
    const upstreamDetail = 'private-upstream-detail';
    const { client, requests } = await mockClient(t, () => jsonResponse({
      error: { message: upstreamDetail },
    }, status));

    await assert.rejects(client.chat(messages), (error) => {
      assert.equal(error.code, status < 500 ? 'HTTP_4XX' : 'HTTP_5XX');
      assert.equal(error.message.includes(upstreamDetail), false);
      return true;
    });
    assert.equal(requests().length, 1);
  });
}

test('上游不是 JSON 时返回 BAD_JSON', async (t) => {
  const { client } = await mockClient(t, () => new Response('<html>测试错误页</html>', { status: 200 }));
  await assert.rejects(client.chat(messages), { code: 'BAD_JSON' });
});

test('成功响应缺少文本内容时返回 BAD_JSON', async (t) => {
  const { client } = await mockClient(t, () => jsonResponse({ choices: [] }));
  await assert.rejects(client.chat(messages), { code: 'BAD_JSON' });
});

test('相同文本请求复用内存缓存', async (t) => {
  const { client, calls, requests } = await mockClient(t, () => chatResponse('{"items":[]}'));
  const first = await client.chat(messages);
  const second = await client.chat(messages.map((message) => ({ ...message })));

  assert.equal(first, second);
  assert.equal(requests().length, 1);
  assert.equal(calls.filter(({ url }) => url === '/ai/__config').length, 1);
});

test('不同文本同时调用时，最多只有一个生成请求在途', async (t) => {
  let active = 0;
  let peakActive = 0;
  const { client, requests } = await mockClient(t, async () => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return chatResponse('{"items":[]}');
  });

  const another = messages.map((message) => ({ ...message }));
  another[1].content = '另一件测试物品';
  const results = await Promise.all([client.chat(messages), client.chat(another)]);
  assert.equal(results.length, 2);
  assert.equal(requests().length, 2);
  assert.equal(peakActive, 1);
});

for (const wire of ['chat', 'responses']) {
  test(`${wire} 图片仅附在最后一条用户消息，且照片请求不缓存`, async (t) => {
    const image = 'data:image/jpeg;base64,AA==';
    const photoMessages = [...messages, { role: 'user', content: '识别测试照片' }];
    const { client, requests } = await mockClient(t, () => wire === 'chat'
      ? chatResponse('{"items":[]}') : jsonResponse({ output_text: '{"items":[]}' }), { wire });

    await client.chat(photoMessages, { images: [image] });
    await client.chat(photoMessages, { images: [image] });
    assert.equal(requests().length, 2);
    const sent = wire === 'chat' ? requests()[0].body.messages : requests()[0].body.input;
    const expectedTextType = wire === 'chat' ? 'text' : 'input_text';
    assert.deepEqual(sent[2].content, [
      { type: expectedTextType, text: '识别测试照片' },
      wire === 'chat'
        ? { type: 'image_url', image_url: { url: image } }
        : { type: 'input_image', image_url: image },
    ]);
    assert.equal(JSON.stringify(sent.slice(0, 2)).includes(image), false);
  });
}

for (const [reason, configHandler] of [
  ['网络不可达', () => { throw new Error('测试网络异常'); }],
  ['状态非成功', () => jsonResponse({}, 503)],
  ['非 JSON', () => new Response('测试错误页')],
]) {
  test(`配置${reason}时安全返回离线状态`, async (t) => {
    const { client, calls, requests } = await mockClient(t, () => {
      assert.fail('配置加载失败时不应请求 AI');
    }, {}, configHandler);

    assert.equal((await client.getConfig()).enabled, false);
    await assert.rejects(client.chat(messages), { code: 'DISABLED' });
    assert.equal(calls.length, 1);
    assert.equal(requests().length, 0);
  });
}

test('配置只保留公开字段并规范无效值', async (t) => {
  const { client } = await mockClient(t, () => chatResponse(), {
    enabled: 1, model: null, wire: 'invalid-wire', vision: 'true', extra: '不应透传',
  });
  assert.deepEqual(await client.getConfig(), { enabled: false, model: '', wire: 'chat', vision: false });
});

for (const output of [{}, 'invalid-output', [null, { content: 'invalid-content' }]]) {
  test(`responses 异常 output 结构 ${JSON.stringify(output)} 返回 BAD_JSON`, async (t) => {
    const { client } = await mockClient(t, () => jsonResponse({ output }), { wire: 'responses' });
    await assert.rejects(client.chat(messages), { code: 'BAD_JSON' });
  });
}

test('读取响应正文阶段仍受请求截止时间限制', async (t) => {
  const { client } = await mockClient(t, ({ init }) => {
    const stream = new ReadableStream({
      start(controller) {
        init.signal.addEventListener('abort', () => {
          controller.error(new DOMException('测试正文读取已中止', 'AbortError'));
        }, { once: true });
      },
    });
    return new Response(stream);
  });
  await assert.rejects(client.chat(messages, { timeoutMs: 10 }), { code: 'TIMEOUT' });
});

test('失败不缓存且不会阻塞后续请求', async (t) => {
  let count = 0;
  const { client, requests } = await mockClient(t, () => {
    count += 1;
    return count === 1 ? jsonResponse({}, 503) : chatResponse('{"items":[]}');
  });
  await assert.rejects(client.chat(messages), { code: 'HTTP_5XX' });
  assert.equal(await client.chat(messages), '{"items":[]}');
  assert.equal(requests().length, 2);
});

test('同一文本同时调用时复用同一个在途请求', async (t) => {
  const { client, requests } = await mockClient(t, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return chatResponse('{"items":[]}');
  });
  const results = await Promise.all([client.chat(messages), client.chat(messages)]);
  assert.deepEqual(results, ['{"items":[]}', '{"items":[]}']);
  assert.equal(requests().length, 1);
});
