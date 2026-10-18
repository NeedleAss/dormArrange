import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const isolatedFlag = '--fangcun-proxy-isolated';

if (!process.argv.includes(isolatedFlag)) {
  test('代理在隔离环境中通过安全集成测试', async () => {
    // Vite 内部会复制环境，因此先以明确的空白环境启动子进程。
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), isolatedFlag], {
        env: { NODE_ENV: 'test', DEBUG: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, output }));
    });
    // 失败时只输出用例名称和计数，不显示代理错误对象或内联模块源码。
    const diagnostic = result.output.split('\n')
      .filter((line) => /^[✔✖ℹ]/u.test(line.trimStart())).join('\n');
    assert.equal(result.code, 0, diagnostic);
  });
} else {
  const { createServer } = await import('vite');
  const source = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');
  const syntheticCredential = 'synthetic-proxy-credential';
  let configSequence = 0;

  /** 仅替换服务端配置入口，不调用真实 loadEnv 或读取任何环境文件。 */
  async function makeConfig(env) {
    const importLine = "import { defineConfig, loadEnv } from 'vite';";
    assert.equal(source.startsWith(importLine), true, '配置入口变更时必须重新确认隔离方式');
    const safeSource = source.replace(importLine,
      `const defineConfig = (value) => value; const loadEnv = () => (${JSON.stringify(env)});`);
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(safeSource).toString('base64')}#${++configSequence}`;
    const configModule = await import(moduleUrl);
    return configModule.default({ mode: 'test' });
  }

  /** 在临时空目录运行 Vite，并关闭文件监听与环境文件加载。 */
  async function startVite(t, env = {}) {
    const config = await makeConfig(env);
    const root = await mkdtemp(join(tmpdir(), 'fangcun-ai-proxy-'));
    const logs = [];
    const logger = {
      hasWarned: false,
      info: () => {}, warn: (message) => logs.push(String(message)),
      warnOnce: (message) => logs.push(String(message)),
      error: (message) => logs.push(String(message)),
      clearScreen: () => {}, hasErrorLogged: () => false,
    };
    let server;
    t.after(async () => {
      if (server) await server.close();
      await rm(root, { recursive: true, force: true });
    });
    server = await createServer({
      ...config,
      root,
      configFile: false,
      envFile: false,
      cacheDir: join(root, 'cache'),
      customLogger: logger,
      clearScreen: false,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        ...config.server,
        host: '127.0.0.1', port: 0, strictPort: true,
        watch: null, hmr: false,
        fs: { strict: true, allow: [root] },
      },
    });
    // Vite 6 的 listen 会把 port:0 回退到 5173；直接绑定底层 HTTP 服务，
    // 让系统分配临时端口，避免开发服务器或并行副本抢占测试端口。
    await new Promise((resolve, reject) => {
      server.httpServer.once('error', reject);
      server.httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = server.httpServer.address();
    assert.equal(typeof address, 'object');
    return { config, logs, port: address.port };
  }

  /** 本地模拟上游只使用合成凭据，断言时不输出请求头。 */
  async function startUpstream(t, handler = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  }) {
    const requests = [];
    const server = createHttpServer((req, res) => {
      requests.push(req);
      req.resume();
      handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return { port: server.address().port, requests };
  }

  function call(port, path, { method = 'GET', headers = {}, body = '' } = {}) {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.once('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('本地代理测试超时')));
      req.end(body);
    });
  }

  const enabledEnv = (port) => ({
    AI_BASE_URL: `http://127.0.0.1:${port}/custom/v1/`,
    AI_API_KEY: syntheticCredential,
    AI_MODEL: 'synthetic-model',
    AI_WIRE_API: 'chat',
    AI_VISION: 'true',
  });

  test('未配置时仅返回四个安全配置字段，并禁用代理', async (t) => {
    const { config, port } = await startVite(t);
    assert.deepEqual(config.server.proxy, {});
    assert.deepEqual(config.preview?.proxy, {});
    const response = await call(port, '/ai/__config');
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.text), { enabled: false, model: '', wire: 'chat', vision: false });
    assert.equal(response.headers['cache-control'], 'no-store');
    const disabled = await call(port, '/ai/v1/chat/completions', { method: 'POST' });
    assert.equal(disabled.status, 503);
    assert.deepEqual(JSON.parse(disabled.text), { code: 'DISABLED' });
  });

  test('两种协议都正确重写基础路径，凭据仅发送给上游', async (t) => {
    const upstream = await startUpstream(t);
    const { port, config } = await startVite(t, enabledEnv(upstream.port));
    // preview 默认会继承 server.proxy，必须明确清空，避免绕过开发中间件。
    assert.deepEqual(config.preview?.proxy, {});
    const configResponse = await call(port, '/ai/__config');
    assert.deepEqual(JSON.parse(configResponse.text), {
      enabled: true, model: 'synthetic-model', wire: 'chat', vision: true,
    });
    assert.equal(configResponse.text.includes(syntheticCredential), false);
    for (const endpoint of ['chat/completions', 'responses']) {
      const result = await call(port, `/ai/v1/${endpoint}`, {
        method: 'POST', headers: { cookie: 'synthetic-session=private', 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal(result.status, 200);
      assert.deepEqual(JSON.parse(result.text), { ok: true });
      assert.equal(result.text.includes(syntheticCredential), false);
      assert.equal(JSON.stringify(result.headers).includes(syntheticCredential), false);
    }
    assert.deepEqual(upstream.requests.map((req) => req.url), ['/custom/v1/chat/completions', '/custom/v1/responses']);
    assert.equal(upstream.requests.every((req) => req.headers.authorization === `Bearer ${syntheticCredential}`), true);
    assert.equal(upstream.requests.every((req) => req.headers.cookie === undefined), true);
  });

  test('responses 配置仍只暴露四个安全字段', async (t) => {
    const upstream = await startUpstream(t);
    const { port } = await startVite(t, { ...enabledEnv(upstream.port), AI_WIRE_API: 'responses' });
    const result = await call(port, '/ai/__config');
    assert.deepEqual(JSON.parse(result.text), {
      enabled: true, model: 'synthetic-model', wire: 'responses', vision: true,
    });
  });

  for (const status of [401, 429, 500, 503]) {
    test(`上游 ${status} 的正文和响应头不会到达浏览器`, async (t) => {
      const upstream = await startUpstream(t, (_req, res) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Set-Cookie': `private=${syntheticCredential}`,
          'X-Upstream-Debug': syntheticCredential,
        });
        res.end(JSON.stringify({ error: { message: syntheticCredential } }));
      });
      const { port, logs } = await startVite(t, enabledEnv(upstream.port));
      const response = await call(port, '/ai/v1/chat/completions', { method: 'POST' });
      assert.equal(response.status, status < 500 ? status : 502);
      assert.deepEqual(JSON.parse(response.text), { code: status < 500 ? 'HTTP_4XX' : 'HTTP_5XX' });
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.headers['x-upstream-debug'], undefined);
      assert.equal(response.text.includes(syntheticCredential), false);
      assert.equal(logs.some((entry) => entry.includes(syntheticCredential)), false);
    });
  }

  test('成功响应也不转发上游调试头和 cookie', async (t) => {
    const upstream = await startUpstream(t, (_req, res) => {
      res.writeHead(200, { 'Set-Cookie': `private=${syntheticCredential}`, 'X-Upstream-Debug': syntheticCredential });
      res.end('{"ok":true}');
    });
    const { port } = await startVite(t, enabledEnv(upstream.port));
    const result = await call(port, '/ai/v1/responses', { method: 'POST' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(result.headers['x-upstream-debug'], undefined);
  });

  test('上游忽略 identity 仍返回 gzip 时，浏览器能正确解压 JSON', async (t) => {
    const upstream = await startUpstream(t, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
      res.end(gzipSync('{"ok":true}'));
    });
    const { port } = await startVite(t, enabledEnv(upstream.port));
    const response = await fetch(`http://127.0.0.1:${port}/ai/v1/responses`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0].headers['accept-encoding'] === 'identity', true);
  });

  test('连接失败只返回固定错误且日志不含合成凭据', async (t) => {
    const reservation = createHttpServer();
    await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const unavailablePort = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const { port, logs } = await startVite(t, enabledEnv(unavailablePort));
    const response = await call(port, '/ai/v1/chat/completions', { method: 'POST' });
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.text), { code: 'HTTP_5XX' });
    assert.equal(response.text.includes(syntheticCredential), false);
    assert.equal(logs.some((entry) => entry.includes(syntheticCredential)), false);
    assert.equal(logs.every((entry) => !entry.includes('ECONNREFUSED')), true);
  });

  test('非法端点、错误方法和外部来源均不能触发上游请求', async (t) => {
    const upstream = await startUpstream(t);
    const { port } = await startVite(t, enabledEnv(upstream.port));
    for (const path of ['/ai/v1/models', '/ai/v1/chat/completions/extra', '/ai/v1/responses-extra']) {
      const result = await call(port, path, { method: 'POST' });
      assert.equal(result.status, 404);
      assert.deepEqual(JSON.parse(result.text), { code: 'HTTP_4XX' });
    }
    assert.equal((await call(port, '/ai/v1/chat/completions')).status, 404);
    assert.equal((await call(port, '/ai/v1/responses', { method: 'POST', headers: { origin: 'https://external.invalid' } })).status, 403);
    assert.equal((await call(port, '/ai/__config', { headers: { origin: 'null' } })).status, 403);
    assert.equal(upstream.requests.length, 0);
    const sameOrigin = await call(port, '/ai/v1/responses', {
      method: 'POST', headers: { origin: `http://127.0.0.1:${port}` },
    });
    assert.equal(sameOrigin.status, 200);
    assert.equal(upstream.requests.length, 1);
  });
}
