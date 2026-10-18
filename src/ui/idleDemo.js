import '../styles/idleDemo.css';

const PERSISTED = new Set(['roomParams', 'snapshots', 'focusMinutes']);
const MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
const INPUTS = ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup', 'wheel', 'touchstart', 'click', 'input'];

/**
 * 展会待机循环：保留用户宿舍，只暂借易失状态；首次操作结束演示并吞掉该次操作。
 * @param {{store: object, planner: object, scene?: object|null, alert?: Function, navigate: Function, refreshPanel: Function, dismissTitleCard?: Function}} ctx
 * @param {{idleMs?: number}} options
 * @returns {{start: () => boolean, stop: () => boolean, dispose: () => void}}
 */
export function createIdleDemo(ctx, { idleMs = 60000 } = {}) {
  const { store, planner } = ctx;
  const idleDelay = Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 60000;
  let disposed = false;
  let running = false;
  let serial = 0;
  let saved = null;
  let idleTimer = null;
  let animation = null;
  let lastInput = Date.now();
  let swallowUntil = 0;
  const waits = new Map();
  const existingLauncher = document.querySelector('#start-demo');
  const launcher = existingLauncher || document.createElement('button');
  if (!existingLauncher) {
    launcher.type = 'button';
    launcher.className = 'btn compact idle-demo-launcher';
    launcher.textContent = '待机演示 / DEMO';
    launcher.setAttribute('aria-label', '启动待机演示');
    document.body.append(launcher);
  }
  const banner = document.createElement('div');
  banner.className = 'idle-demo-banner';
  banner.hidden = true;
  banner.setAttribute('role', 'status');
  banner.innerHTML = '<span class="idle-demo-kicker">FANGCUN / EXHIBITION MODE</span><strong>待机演示 · 任意操作返回</strong><small class="idle-demo-stage">准备演示</small>';
  document.body.append(banner);
  const stage = banner.querySelector('.idle-demo-stage');
  const valid = token => running && !disposed && token === serial;

  function available() {
    const state = store.get();
    return !state.timer?.running && !state.ai?.busy && !document.hidden
      && !document.querySelector('.title-card,.boot-screen,.focus-limit')
      && !!state.room && typeof ctx.navigate === 'function' && typeof ctx.refreshPanel === 'function'
      && ['parseItemsText', 'planMoveIn', 'planFocusField', 'planSeasons', 'computeSync', 'scatterOnDesk', 'diffMonths', 'applySteps'].every(key => typeof planner?.[key] === 'function');
  }

  function arm(delay = Math.max(1, idleDelay - (Date.now() - lastInput))) {
    clearTimeout(idleTimer);
    if (!disposed && !running) idleTimer = setTimeout(checkIdle, delay);
  }

  function checkIdle() {
    idleTimer = null;
    if (disposed || running) return;
    if (Date.now() - lastInput < idleDelay) { arm(); return; }
    if (!available()) { arm(1000); return; }
    start();
  }

  /** 所有驻留和分步等待登记在此，退出时逐一取消并唤醒异步循环。 */
  function wait(ms, token) {
    if (!valid(token)) return Promise.resolve(false);
    return new Promise(resolve => {
      const id = setTimeout(() => { waits.delete(id); resolve(valid(token)); }, ms);
      waits.set(id, resolve);
    });
  }

  function write(token, patch) {
    if (!valid(token)) return false;
    // 防止后续扩展演示步骤时误写本地档案、真实时长或房间参数。
    store.set(Object.fromEntries(Object.entries(patch).filter(([key]) => !PERSISTED.has(key))));
    return true;
  }

  function syncState(room, items, placements, label, extra = {}) {
    const sync = planner.computeSync(room, items, placements, extra);
    return { sync, syncHistory: [...store.get().syncHistory, { t: new Date().toISOString(), total: sync.total, label }].slice(-60) };
  }

  function itemStates(items, placements) {
    return Object.fromEntries(items.map(item => [item.id, placements[item.id] ? 'fits' : planner.checkRules?.(item)?.banned ? 'banned' : 'overflow']));
  }

  async function go(episode, label, token) {
    if (!valid(token)) return false;
    stage.textContent = label;
    await ctx.navigate(episode, { isCurrent: () => valid(token) });
    return valid(token);
  }

  /** 每份预览都在当前房间重新放置；预设只提供物品和文案，不复用默认房间坐标。 */
  function buildData(room, owner, focusMinutes) {
    const own = items => structuredClone(items).map(item => ({ ...item, owner: item.owner === 'pub' ? 'pub' : owner }));
    const freshman = planner.parseItemsText(planner.PRESETS.freshman, { owner, idPrefix: 'idle' });
    const fit = planner.planMoveIn(room, freshman, { owner });
    const messyItems = own(planner.PRESETS.messyDesk?.items || freshman);
    const messy = planner.scatterOnDesk(room, messyItems, { owner });
    const desk = room.zones.find(zone => zone.id === `${owner}.desk`);
    const frontX = desk.front.endsWith('x');
    const spec = { zoneId: desk.id, w: Math.min(75, frontX ? desk.box.d : desk.box.w), d: Math.min(35, frontX ? desk.box.w : desk.box.d) };
    const focus = planner.planFocusField(room, messyItems, messy, spec);
    const seasons = planner.planSeasons(room, freshman, { owner, tdm: true, months: MONTHS, compare: true });
    const presets = planner.PRESETS.growth || [];
    const firstItems = own(presets[0]?.items || freshman);
    const first = planner.planMoveIn(room, firstItems, { owner }).placements;
    const secondItems = presets[1]?.items ? own(presets[1].items) : [...firstItems, ...planner.parseItemsText('书10本，零食箱，快递盒，水杯', { owner, idPrefix: 'idle-extra' })];
    const firstIds = new Set(firstItems.map(item => item.id));
    const extra = secondItems.filter(item => !firstIds.has(item.id));
    const second = { ...first, ...planner.scatterOnDesk(room, extra, { owner, existing: first, existingItems: firstItems }) };
    const rooms = store.get().roomParams || room.params;
    // 成长预览没有 movePlan；移除本次真实 dispose 的物品，避免快递盒在滞留区重新出现。
    const disposedIds = new Set(focus.steps.filter(step => step.kind === 'dispose').map(step => step.itemId));
    const clearedItems = messyItems.filter(item => !disposedIds.has(item.id));
    const states = [[firstItems, first], [secondItems, second], [messyItems, messy], [clearedItems, focus.placementsAfter]];
    const labels = ['大一上 · 入住', '大一下 · 添置', '大二上 · 满桌', '大二上 · 腾桌后'];
    const semesters = ['Y1-F', 'Y1-S', 'Y2-F', 'Y2-F'];
    const snapshots = states.map(([items, placements], index) => ({
      id: `idle-preview-${index}`, label: presets[index]?.label || labels[index], semester: presets[index]?.semester || semesters[index],
      createdAt: presets[index]?.createdAt || new Date().toISOString(), roomParams: structuredClone(rooms),
      items: structuredClone(items), placements: structuredClone(placements), sync: planner.computeSync(room, items, placements, { owner }).total,
      focusMinutes: Number.isFinite(presets[index]?.focusMinutes) ? presets[index].focusMinutes : focusMinutes
    }));
    return { freshman, fit, messyItems, messy, spec, focus, seasons, snapshots };
  }

  async function showFocus(data, room, owner, token) {
    const { messyItems: items, messy: placements, focus: plan } = data;
    const states = itemStates(items, placements);
    plan.conflicts.forEach(id => { states[id] = 'conflict'; });
    write(token, { movePlan: plan, stepIndex: 0, itemStates: states,
      ...syncState(room, items, placements, '演示 · 力场展开', { owner, focusBox: plan.focusBox }) });
    if (!await wait(1400, token)) return false;
    const stepMs = Math.max(200, Math.min(650, 5400 / Math.max(1, plan.steps.length)));
    let animated = false;
    const scene = ctx.scene;
    if (scene?.playSteps && plan.steps.length) {
      try {
        animation = scene.playSteps(plan.steps, { stepMs, onStep: index => write(token, { stepIndex: index }), onDone: () => {} });
        animated = true;
      } catch { animation = null; }
    }
    if (animated) {
      if (!await wait(plan.steps.length * stepMs + 150, token)) return false;
      try { animation?.stop?.(); } catch { /* 动画清理失败也继续用最终规划校准仓库。 */ }
      animation = null;
    } else {
      for (let index = 0; index < plan.steps.length; index++) {
        if (!await wait(stepMs, token)) return false;
        write(token, { placements: planner.applySteps(placements, plan.steps, index + 1), stepIndex: index + 1 });
      }
    }
    const finalStates = itemStates(items, plan.placementsAfter);
    plan.steps.forEach(step => { finalStates[step.itemId] = step.kind === 'dispose' ? 'stored' : 'moved'; });
    write(token, { placements: plan.placementsAfter, itemStates: finalStates, stepIndex: plan.steps.length,
      ...syncState(room, items, plan.placementsAfter, '演示 · 腾桌完成', { owner, focusBox: plan.focusBox, moves: plan.steps.length }) });
    return wait(2200, token);
  }

  async function run(token, room, owner, originalFocusMinutes) {
    if (!await wait(0, token)) return;
    const data = buildData(room, owner, originalFocusMinutes);
    while (valid(token)) {
      write(token, { items: [], placements: {}, itemStates: {}, owner, lockedZones: [], fitReport: null, movePlan: null, stepIndex: 0,
        tdmPlan: null, sync: null, selection: null, camera: 'orbit', focusSpec: data.spec });
      if (!await go('EP00', '第零话 / 以当前宿舍展示空间结构', token)) return;
      if (!await wait(3000, token)) return;
      write(token, { camera: 'top' });
      if (!await wait(3000, token)) return;

      write(token, { items: data.freshman, placements: data.fit.placements, itemStates: Object.fromEntries(Object.entries(data.fit.verdicts).map(([id, verdict]) => [id, verdict.status])),
        fitReport: data.fit, camera: 'orbit', ...syncState(room, data.freshman, data.fit.placements, '演示 · 入住', { owner }) });
      if (!await go('EP01', '第一话 / 新生清单的真实空间适配', token)) return;
      if (!await wait(6000, token)) return;

      write(token, { items: data.messyItems, placements: data.messy, itemStates: itemStates(data.messyItems, data.messy), fitReport: null,
        movePlan: null, stepIndex: 0, focusSpec: data.spec, selection: `${owner}.desk`,
        ...syncState(room, data.messyItems, data.messy, '演示 · 乱桌', { owner }) });
      if (!await go('EP02', '第二话 / 以最少移动恢复专注区', token)) return;
      if (!await showFocus(data, room, owner, token)) return;

      const september = data.seasons.byMonth[9];
      write(token, { items: data.freshman, placements: september.placements, itemStates: itemStates(data.freshman, september.placements), fitReport: null,
        movePlan: null, stepIndex: 0, tdm: true, tdmPlan: data.seasons, month: 9, selection: null,
        ...syncState(room, data.freshman, september.placements, '演示 · 九月', { owner }) });
      if (!await go('EP03', '第三话 / 一年十二月，空间轮换使用', token)) return;
      let previous = september;
      for (const month of MONTHS) {
        const next = data.seasons.byMonth[month];
        const changes = planner.diffMonths(previous, next, data.freshman, room);
        const stored = new Set(next.stored);
        const states = itemStates(data.freshman, next.placements);
        stored.forEach(id => { states[id] = 'stored'; });
        if (typeof ctx.setSeasonMonth === 'function') {
          // 复用已挂载面板的换月入口，使局部的 diff 清单和月份标题一起更新。
          ctx.setSeasonMonth(month, { manual: false });
        } else {
          write(token, { month, placements: next.placements, itemStates: states,
            ...syncState(room, data.freshman, next.placements, `演示 · ${month} 月`, { owner, swaps: changes.length }) });
        }
        previous = next;
        if (!await wait(800, token)) return;
      }

      ctx.previewSnapshots = data.snapshots;
      ctx.previewSnapshotId = data.snapshots[0].id;
      // 先离开换季再更新成长物品，避免旧换季面板为这些物品启动全年重算。
      if (!await go('EP04', '第四话 / 当前宿舍中的四段真实布局', token)) return;
      for (const snapshot of data.snapshots) {
        if (!valid(token)) return;
        ctx.previewSnapshotId = snapshot.id;
        write(token, { items: snapshot.items, placements: snapshot.placements, itemStates: itemStates(snapshot.items, snapshot.placements),
          movePlan: null, tdmPlan: null, fitReport: null, selection: null, stepIndex: 0,
          ...syncState(room, snapshot.items, snapshot.placements, `演示 · ${snapshot.label}`, { owner }) });
        ctx.refreshPanel();
        if (!await wait(1500, token)) return;
      }
      delete ctx.previewSnapshots;
      delete ctx.previewSnapshotId;
    }
  }

  function start() {
    if (disposed || running || !available()) return false;
    const state = store.get();
    const owner = state.room.zones.some(zone => zone.id === `${state.owner}.desk`) ? state.owner
      : state.room.zones.find(zone => zone.slot === 'desk' && zone.owner !== 'pub')?.owner;
    if (!owner) return false;
    try {
      const snapshot = structuredClone(state);
      saved = Object.fromEntries(Object.entries(snapshot).filter(([key]) => !PERSISTED.has(key)));
      // 腾桌面板以只读 MovePlan 的对象身份保存回放基准；演示替换该字段，不修改原计划。
      if (Object.hasOwn(state, 'movePlan')) saved.movePlan = state.movePlan;
    } catch { return false; }
    clearTimeout(idleTimer);
    running = true;
    ctx.demoRunning = true;
    const token = ++serial;
    launcher.hidden = true;
    banner.hidden = false;
    run(token, state.room, owner, state.focusMinutes).catch(() => {
      if (!valid(token)) return;
      stop();
      ctx.alert?.('待机演示暂时无法继续，已回到你的布局。', 'warning');
    });
    return true;
  }

  function stop() {
    if (!running) return false;
    running = false;
    serial++;
    ctx.demoRunning = false;
    try { animation?.stop?.(); } catch { /* 场景模块清理失败不应阻止恢复用户数据。 */ }
    animation = null;
    for (const [id, resolve] of waits) { clearTimeout(id); resolve(false); }
    waits.clear();
    ctx.dismissTitleCard?.();
    delete ctx.previewSnapshots;
    delete ctx.previewSnapshotId;
    const original = saved;
    saved = null;
    if (original) store.set(original);
    ctx.refreshPanel();
    banner.hidden = true;
    launcher.hidden = false;
    lastInput = Date.now();
    arm();
    return true;
  }

  function onInput(event) {
    // 脚本触发的点击和状态刷新不是观众操作，不影响真实无操作计时。
    if (!event.isTrusted || disposed) return;
    const now = Date.now();
    lastInput = now;
    if (running || now < swallowUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (running) {
        // 同一次手势的 pointerup/click 也吞掉，避免退出后误触保存或导航。
        swallowUntil = now + 750;
        stop();
      } else arm();
      return;
    }
    arm();
  }

  function onVisibility() {
    if (!document.hidden) { lastInput = Date.now(); arm(); }
  }

  launcher.addEventListener('click', start);
  INPUTS.forEach(type => window.addEventListener(type, onInput, { capture: true, passive: false }));
  document.addEventListener('visibilitychange', onVisibility);
  arm();
  return {
    start,
    stop,
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      clearTimeout(idleTimer);
      INPUTS.forEach(type => window.removeEventListener(type, onInput, true));
      document.removeEventListener('visibilitychange', onVisibility);
      launcher.removeEventListener('click', start);
      if (!existingLauncher) launcher.remove();
      banner.remove();
      delete ctx.demoRunning;
    }
  };
}
