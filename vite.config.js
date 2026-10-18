import { defineConfig, loadEnv } from 'vite';

/** 代理错误只返回固定文案，避免上游错误或请求头泄漏凭据。 */
function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export default defineConfig(({ mode }) => {
  // AI_* 仅在服务端读取；不得用 define 或 VITE_ 前缀传给浏览器。
  const env = loadEnv(mode, process.cwd(), '');
  const { AI_BASE_URL = '', AI_API_KEY = '', AI_MODEL = '' } = env;
  let upstream;
  try {
    const candidate = new URL(AI_BASE_URL);
    if (['https:', 'http:'].includes(candidate.protocol) && !candidate.username && !candidate.password
      && !candidate.search && !candidate.hash) upstream = candidate;
  } catch { /* 未配置或地址无效时正常启动，前端自动走本地规则。 */ }
  const config = {
    enabled: Boolean(upstream && AI_API_KEY),
    model: AI_MODEL,
    wire: env.AI_WIRE_API === 'responses' ? 'responses' : 'chat',
    vision: env.AI_VISION === 'true',
  };
  const basePath = upstream?.pathname.replace(/\/+$/, '') ?? '';

  return {
    plugins: [{
      name: 'fangcun-ai-config',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = (req.url ?? '').split('?')[0];
          if (!path.startsWith('/ai/')) return next();
          // 仅接受当前页面来源；开发代理不能成为公开的任意转发服务。
          if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
            return reply(res, 403, { code: 'HTTP_4XX' });
          }
          if (path === '/ai/__config' && req.method === 'GET') return reply(res, 200, config);
          if (!config.enabled) return reply(res, 503, { code: 'DISABLED' });
          if (!['/ai/v1/chat/completions', '/ai/v1/responses'].includes(path) || req.method !== 'POST') {
            return reply(res, 404, { code: 'HTTP_4XX' });
          }
          next();
        });
      },
    }],
    server: {
      host: 'localhost',
      proxy: config.enabled ? {
        '/ai/v1': {
          target: upstream.origin,
          changeOrigin: true,
          rewrite: (path) => basePath + path.replace(/^\/ai\/v1/, ''),
          timeout: 20000,
          proxyTimeout: 20000,
          selfHandleResponse: true,
          configure(proxy) {
            proxy.on('proxyReq', (req) => {
              req.setHeader('Authorization', `Bearer ${AI_API_KEY}`);
              req.removeHeader('cookie');
            });
            proxy.on('proxyRes', (upstreamRes, _req, res) => {
              const status = upstreamRes.statusCode ?? 502;
              // 不转发上游错误正文、cookies 或调试头。
              if (status < 200 || status >= 300) {
                upstreamRes.resume();
                return reply(res, status >= 400 && status < 500 ? status : 502,
                  { code: status >= 400 && status < 500 ? 'HTTP_4XX' : 'HTTP_5XX' });
              }
              res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
              upstreamRes.on('error', () => res.destroy());
              upstreamRes.pipe(res);
            });
            // Vite 自带日志仅接触这个固定错误，绝不记录上游错误对象。
            proxy.prependListener('error', (error, _req, res) => {
              error.message = 'AI upstream unavailable';
              error.stack = 'AI upstream unavailable';
              if (res && !res.headersSent && !res.destroyed) reply(res, 502, { code: 'HTTP_5XX' });
            });
          },
        },
      } : {},
    },
  };
});
