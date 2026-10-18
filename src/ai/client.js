/** @typedef {{enabled:boolean, model:string, wire:'chat'|'responses', vision:boolean}} AIConfig */
const OFFLINE = Object.freeze({ enabled: false, model: '', wire: 'chat', vision: false });
const MESSAGES = {
  TIMEOUT: 'AI 请求超时', HTTP_4XX: 'AI 请求未获接受', HTTP_5XX: 'AI 服务暂时不可用',
  BAD_JSON: 'AI 返回格式无效', DISABLED: 'AI 未启用',
};
let configPromise;
let queue = Promise.resolve();
const cache = new Map();
const pending = new Map();

/** 错误只包含固定文案；不拼接响应正文、地址、请求头或原始异常。 */
function failure(code) {
  return Object.assign(new Error(MESSAGES[code]), { code });
}

/** 配置只请求一次，失败时缓存离线状态；修改环境后刷新页面即可重试。 */
export function getConfig() {
  if (!configPromise) configPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch('/ai/__config', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) return OFFLINE;
      const value = await response.json();
      return Object.freeze({ enabled: value?.enabled === true, model: typeof value?.model === 'string' ? value.model : '',
        wire: value?.wire === 'responses' ? 'responses' : 'chat', vision: value?.vision === true });
    } catch { return OFFLINE; }
    finally { clearTimeout(timer); }
  })();
  return configPromise;
}

/** FNV-1a 文本哈希；同时比较原文以避免哈希碰撞命中错误结果。 */
function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16);
}

/** 两种协议共享消息输入，图片只附到最后一条用户消息。 */
function makeBody(messages, config, json, images) {
  const lastUser = messages.findLastIndex((message) => message.role === 'user');
  const converted = messages.map((message, index) => {
    // Responses 的 few-shot 助手历史使用简化文本消息，不能标成 input_text。
    if (config.wire === 'responses' && message.role === 'assistant') {
      return { role: 'assistant', content: String(message.content ?? '') };
    }
    const parts = [{ type: config.wire === 'chat' ? 'text' : 'input_text', text: String(message.content ?? '') }];
    if (index === lastUser) for (const image of images) {
      parts.push(config.wire === 'chat' ? { type: 'image_url', image_url: { url: image } }
        : { type: 'input_image', image_url: image });
    }
    return { role: message.role, content: config.wire === 'responses' || parts.length > 1 ? parts : parts[0].text };
  });
  if (config.wire === 'responses') return { model: config.model, input: converted,
    ...(json ? { text: { format: { type: 'json_object' } } } : {}) };
  return { model: config.model, temperature: 0, messages: converted,
    ...(json ? { response_format: { type: 'json_object' } } : {}) };
}

/** 串行队列中的一次请求；重试与读取响应正文共享同一个截止时间。 */
async function request(messages, { json, timeoutMs, images }) {
  const config = await getConfig();
  if (!config.enabled) throw failure('DISABLED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = makeBody(messages, config, json, images);
    const send = () => fetch(`/ai/v1/${config.wire === 'chat' ? 'chat/completions' : 'responses'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    let response = await send();
    // 部分兼容接口不支持 response_format；不把上游错误文案发给用户。
    if (config.wire === 'chat' && json && [400, 422].includes(response.status)) {
      await response.body?.cancel();
      delete body.response_format;
      response = await send();
    }
    if (!response.ok) throw failure(response.status >= 400 && response.status < 500 ? 'HTTP_4XX' : 'HTTP_5XX');
    let data;
    try { data = await response.json(); }
    catch { throw failure(controller.signal.aborted ? 'TIMEOUT' : 'BAD_JSON'); }
    const result = config.wire === 'chat' ? data?.choices?.[0]?.message?.content
      : typeof data?.output_text === 'string' ? data.output_text
        : (Array.isArray(data?.output) ? data.output : []).flatMap((entry) => Array.isArray(entry?.content) ? entry.content : [])
          .filter((part) => part?.type === 'output_text' && typeof part.text === 'string').map((part) => part.text).join('');
    if (typeof result !== 'string' || !result.trim()) throw failure('BAD_JSON');
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw failure('TIMEOUT');
    if (Object.hasOwn(MESSAGES, error?.code)) throw failure(error.code);
    throw failure('HTTP_5XX');
  } finally { clearTimeout(timer); }
}

/**
 * 上层校验发现模型文本不可用时，仅清除此请求的缓存，不影响其他成功结果。
 * @param {{role:string, content:string}[]} messages
 * @param {{json?:boolean}} [options]
 */
export function forgetChat(messages, { json = true } = {}) {
  const identity = JSON.stringify({ messages, json });
  const key = hash(identity);
  if (cache.get(key)?.identity === identity) cache.delete(key);
}

/**
 * 返回模型纯文本。仅内存缓存文字请求；照片既不缓存也不写入日志。
 * @param {{role:string, content:string}[]} messages
 * @param {{json?:boolean, timeoutMs?:number, images?:string[]}} [options]
 * @returns {Promise<string>}
 */
export function chat(messages, { json = true, timeoutMs = 20000, images = [] } = {}) {
  const identity = JSON.stringify({ messages, json });
  const key = hash(identity);
  const useCache = images.length === 0;
  if (useCache && cache.get(key)?.identity === identity) return Promise.resolve(cache.get(key).text);
  if (useCache && pending.get(key)?.identity === identity) return pending.get(key).promise;
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000;
  const promise = queue.then(() => request(messages, { json, timeoutMs: duration, images }));
  queue = promise.catch(() => {});
  if (useCache) {
    pending.set(key, { identity, promise });
    promise.then((text) => {
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, { identity, text });
    }, () => {}).finally(() => {
      if (pending.get(key)?.promise === promise) pending.delete(key);
    });
  }
  return promise;
}
