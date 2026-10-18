import test from 'node:test';
import assert from 'node:assert/strict';

let moduleSequence = 0;

const messages = [
  { role: 'system', content: '只输出测试 JSON。' },
  { role: 'user', content: '一本测试书' },
];

/** 为每个用例隔离配置缓存、文本缓存和请求队列。 */
async function mockClient(t, handler, overrides = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const config = { enabled: true, model: 'test-model', wire: 'chat', vision: false, ...overrides };

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const request = { url, init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(request);
    if (url === '/ai/__config') return jsonResponse(config);
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
