const MESSAGES = {
  error: '界面操作暂时未完成，请重试。',
  unhandledrejection: '后台操作暂时未完成，请重试。',
  startup: '启动失败，按 F5 重试'
};

const LOG_MESSAGES = {
  error: '界面发生异常，已提供恢复提示。',
  unhandledrejection: '后台操作发生异常，已提供恢复提示。',
  startup: '界面启动失败，已提供重试提示。'
};

/**
 * 原始异常可能包含请求内容，只按错误类别显示固定提示，不读取或输出异常正文。
 * @param {HTMLElement|null} root 已有界面根节点，启动失败时仍保留其内容。
 * @param {{window?: Window, document?: Document, console?: Pick<Console, 'error'>}} [environment] 测试可注入浏览器对象。
 * @returns {{connectAlert: (fn: Function) => void, failStartup: (error?: unknown) => void, dispose: () => void}}
 */
export function installErrorBoundary(root, environment = {}) {
  const targetWindow = environment.window ?? globalThis.window;
  const targetDocument = environment.document ?? root?.ownerDocument ?? globalThis.document;
  const logger = environment.console ?? globalThis.console;
  const seen = new Set();
  const pending = new Set();
  const registrations = [];
  let alert = null;
  let delivering = false;
  let disposed = false;
  let alertFailureLogged = false;
  let startupBanner = null;

  function log(message) {
    try { logger?.error?.(message); } catch { /* 日志失效不影响恢复提示。 */ }
  }

  function flush() {
    if (disposed || delivering || typeof alert !== 'function') return;
    delivering = true;
    try {
      // 回调触发另一类错误时先入队，避免从警报渲染再次递归进入警报渲染。
      while (pending.size && !disposed && typeof alert === 'function') {
        const kind = pending.values().next().value;
        pending.delete(kind);
        try { alert(MESSAGES[kind], 'error'); }
        catch {
          pending.add(kind);
          if (!alertFailureLogged) {
            alertFailureLogged = true;
            log('恢复提示暂时无法写入警报区。');
          }
          break;
        }
      }
    } finally { delivering = false; }
  }

  function report(kind) {
    if (disposed || seen.has(kind)) return;
    seen.add(kind);
    pending.add(kind);
    log(LOG_MESSAGES[kind]);
    flush();
  }

  function handleEvent(kind, event) {
    // 先取消浏览器默认输出；重复错误也不能将原始正文再次写入控制台。
    try { event.preventDefault(); } catch { /* 非标准事件仍走固定提示。 */ }
    report(kind);
  }

  for (const kind of ['error', 'unhandledrejection']) {
    const listener = event => handleEvent(kind, event);
    const capture = kind === 'error';
    try {
      targetWindow?.addEventListener(kind, listener, capture);
      registrations.push({ kind, listener, capture });
    } catch { /* 受限环境仍保留手动启动失败提示。 */ }
  }

  return {
    connectAlert(fn) {
      if (disposed) return;
      alert = typeof fn === 'function' ? fn : null;
      flush();
    },
    failStartup(_error) {
      if (disposed) return;
      if (!startupBanner) {
        try {
          const banner = targetDocument.createElement('div');
          banner.className = 'startup-error-banner';
          banner.setAttribute('role', 'alert');
          banner.setAttribute('aria-atomic', 'true');
          banner.textContent = MESSAGES.startup;
          // 固定提示放在应用外，不替换文字面板，也不增加应用网格的布局单元。
          (targetDocument.body || root)?.appendChild(banner);
          startupBanner = banner;
        } catch { /* DOM 尚不可用时，警报在连接后补发。 */ }
      }
      report('startup');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { kind, listener, capture } of registrations) {
        try { targetWindow?.removeEventListener(kind, listener, capture); } catch { /* 清理彼此独立。 */ }
      }
      try { startupBanner?.remove(); } catch { /* 根面板始终保留。 */ }
      startupBanner = null;
      alert = null;
      pending.clear();
      seen.clear();
    }
  };
}
