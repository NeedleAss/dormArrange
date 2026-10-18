import '../../styles/focusTimer.css';

const SESSION_MS = 25 * 60 * 1000;
let timerSerial = 0;

/**
 * 全局番茄钟：面板切换不销毁；倍率和累计进度留在组件内，仓库只公开运行状态与截止时间。
 * @param {{store: {get: Function, set: Function, subscribe: Function}, alert: Function}} ctx
 * @returns {{start: () => boolean, stop: () => boolean, dispose: () => void}}
 */
export function createFocusTimer(ctx) {
  const { store } = ctx;
  const titleId = `focus-limit-title-${++timerSerial}`;
  let overlay = null;
  let digits = null;
  let progress = null;
  let speedInput = null;
  let previousFocus = null;
  let ticker = null;
  let running = false;
  let disposed = false;
  let accelerated = false;
  let elapsed = 0;
  let lastTick = 0;

  const rate = () => accelerated ? 60 : 1;
  const format = ms => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };

  // 用真实时间差补齐后台标签页被节流的间隔，切换倍率前先结算旧倍率。
  function settle() {
    const now = Date.now();
    elapsed = Math.min(SESSION_MS, elapsed + Math.max(0, now - lastTick) * rate());
    lastTick = now;
  }

  function publishDeadline(patch = {}) {
    store.set({ ...patch, timer: { running: true, endsAt: lastTick + (SESSION_MS - elapsed) / rate() } });
  }

  function render() {
    const remaining = SESSION_MS - elapsed;
    digits.textContent = format(remaining);
    overlay.classList.toggle('focus-limit-final', remaining <= 10000);
    overlay.classList.toggle('focus-limit-demo', accelerated);
    progress.textContent = accelerated
      ? `DEMO ×60 / 实际剩余 ${Math.ceil(remaining / 60000)} 秒 / 完整一轮累计 25 min`
      : '25 MIN SESSION / 为一件事，留出完整的时间';
  }

  function removeOverlay() {
    clearInterval(ticker);
    ticker = null;
    document.removeEventListener('visibilitychange', tick);
    window.removeEventListener('focus', tick);
    if (overlay) {
      overlay.removeEventListener('cancel', onCancel);
      overlay.removeEventListener('keydown', onKeydown);
      if (overlay.open) overlay.close();
      overlay.remove();
    }
    overlay = digits = progress = speedInput = null;
    // 切话后原按钮可能已被卸载，此时把焦点交回当前可用的主操作。
    const target = previousFocus?.isConnected ? previousFocus : document.querySelector('.episode-nav button.active');
    previousFocus = null;
    target?.focus?.({ preventScroll: true });
  }

  function finish() {
    if (!running) return;
    running = false;
    removeOverlay();
    const minutes = Number(store.get().focusMinutes) || 0;
    // 先取消本地运行标记，重复的计时/可见性事件不会再次累计。
    store.set({ timer: { running: false, endsAt: null }, focusMinutes: minutes + 25 });
    ctx.alert('专注完成 +25 min', 'success');
  }

  function tick() {
    if (!running) return;
    settle();
    if (elapsed >= SESSION_MS) finish();
    else render();
  }

  function stop() {
    if (!running) return false;
    running = false;
    removeOverlay();
    store.set({ timer: { running: false, endsAt: null } });
    return true;
  }

  function onCancel(event) {
    event.preventDefault();
    stop();
  }

  function onKeydown(event) {
    // 覆盖层中的数字键、空格等不应穿透到话导航或作战动画快捷键。
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      stop();
    }
  }

  function start() {
    if (disposed || running) return false;
    previousFocus = document.activeElement;
    elapsed = 0;
    lastTick = Date.now();
    running = true;
    overlay = document.createElement('dialog');
    overlay.className = 'focus-limit';
    overlay.setAttribute('aria-labelledby', titleId);
    overlay.innerHTML = `<div class="focus-limit-content"><p class="focus-limit-kicker">FANGCUN / SEAT VIEW / SESSION 25</p><h2 id="${titleId}"><span>FOCUS LIMIT</span>专注限界</h2><output class="focus-limit-digits" aria-label="专注剩余时间" role="timer" aria-live="off">25:00</output><p class="focus-limit-progress"></p><div class="focus-limit-controls"><button type="button" class="btn focus-limit-stop" autofocus>中止 <span>ESC</span></button><label class="focus-limit-speed"><input type="checkbox"> ×60 加速 <small>演示用 · 25 分钟 → 25 秒</small></label></div><p class="focus-limit-note">本轮完整结束后，累计专注时长 +25 min</p></div>`;
    digits = overlay.querySelector('.focus-limit-digits');
    progress = overlay.querySelector('.focus-limit-progress');
    speedInput = overlay.querySelector('input');
    speedInput.checked = accelerated;
    overlay.querySelector('button').onclick = stop;
    speedInput.onchange = () => {
      settle();
      if (elapsed >= SESSION_MS) { finish(); return; }
      accelerated = speedInput.checked;
      publishDeadline();
      render();
    };
    overlay.addEventListener('cancel', onCancel);
    overlay.addEventListener('keydown', onKeydown);
    document.body.append(overlay);
    overlay.showModal();
    render();
    // 镜头同步只由 sceneBinder 响应 camera，不在组件直接操作场景。
    publishDeadline({ camera: 'seat' });
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    ticker = setInterval(tick, 100);
    return true;
  }

  const unsubscribe = store.subscribe(state => {
    if (running && !state.timer?.running) stop();
  }, ['timer']);

  return {
    start,
    stop,
    dispose() {
      if (disposed) return;
      stop();
      unsubscribe();
      disposed = true;
    }
  };
}
