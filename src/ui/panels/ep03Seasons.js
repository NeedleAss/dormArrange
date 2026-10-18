import { esc, syncPatch } from '../helpers.js';
import '../../styles/seasons.css';

const MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
let cleanup = () => {};
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
const volume = box => box.w * box.d * box.h / 1000;

/** 换季只写契约中的状态；sceneBinder 统一把月度放置同步到场景。 */
export function mount(el, ctx) {
  cleanup();
  cleanup = () => {};
  const { store, planner, footer } = ctx;
  if (!planner?.planSeasons || !planner?.diffMonths) {
    el.innerHTML = '<p class="empty">换季规划模块加载中</p>';
    return;
  }
  let active = true;
  let busy = false;
  let calculation = null;
  let playback = null;
  let playing = false;
  let revision = 0;
  let steps = [];
  let appliedMonthPlan = null;
  let appliedPlan = null;
  let appliedMonth = null;
  let transition = '';
  let error = '';

  el.innerHTML = `<div class="season-intro"><span class="micro">TIME-DIVISION STORAGE</span><p>当季取用，过季收起。让同一寸空间，在不同月份承担不同的任务。</p></div>
    <div class="season-empty"><button class="btn full" data-season-example>载入换季示例</button><p class="hint">从新生清单生成季节物品。已有清单会直接沿用。</p></div>
    <label class="season-tdm"><span><b>时分复用</b><small>TIME-DIVISION MULTIPLEXING</small></span><input type="checkbox" data-season-tdm></label>
    <div class="season-status" role="status" aria-live="polite"></div>
    <div class="season-month-card"><div><span class="micro">CURRENT MONTH</span><strong class="season-month-number">09<small>月</small></strong></div><p class="season-month-state"></p></div>
    <button class="btn full" data-season-play>自动播放一年 / 每月 0.8 秒</button>
    <div class="section-title">SPACE-TIME SPECTRUM <span>时空占用谱</span></div>
    <div class="season-heat-legend"><span class="good">低于 50%</span><span class="watch">50—75%</span><span class="full">75% 以上</span></div>
    <div class="season-spectrum-viewport"></div><p class="hint">点击色格切换月份并定位分区；白框标示当前月份。</p>
    <div class="section-title">STORAGE COMPARISON <span>全年对照</span></div><div class="season-comparison"></div>
    <div class="season-detail-metrics"></div>
    <div class="section-title">SEASONAL ORDERS <span class="season-transition"></span></div><div class="season-orders"></div>`;
  footer.innerHTML = `<div class="season-month-control"><div><span class="micro">MONTH</span><output class="season-month-output mono">09 月</output><span class="season-year-label">本学年</span></div><input class="season-month-slider" type="range" min="0" max="11" step="1" value="0" aria-label="换季月份：九月至次年八月"><div class="season-slider-labels"><span>9 月</span><span>次年 8 月</span></div></div>`;
  const toggle = el.querySelector('[data-season-tdm]');
  const playButton = el.querySelector('[data-season-play]');
  const slider = footer.querySelector('.season-month-slider');
  const spectrum = el.querySelector('.season-spectrum-viewport');
  const orders = el.querySelector('.season-orders');

  function stopPlayback() {
    clearInterval(playback);
    playback = null;
    playing = false;
  }

  function zoneLabel(id, state) {
    if (id.endsWith('.inside')) return `${state.items.find(item => item.id === id.slice(0, -7))?.name || '行李箱'}内`;
    return state.room?.zones.find(zone => zone.id === id)?.label || id;
  }

  /** 从真实前后月计划生成清单与同步率，滑块拖动不重跑全年规划。 */
  function applyMonth(month, { manual = true, zoneId = null } = {}) {
    if (!active || busy) return;
    const state = store.get();
    const plan = state.tdmPlan;
    const next = plan?.byMonth[month];
    if (!next) return;
    if (manual) stopPlayback();
    if (plan === appliedPlan && month === appliedMonth) {
      if (zoneId) store.set({ selection: zoneId });
      render(store.get());
      return;
    }
    const previous = appliedMonthPlan || { placements: state.placements, active: [], stored: [] };
    try {
      const nextSteps = planner.diffMonths(previous, next, state.items, state.room);
      const stored = new Set(next.stored);
      const overflow = new Set(next.overflow);
      const itemStates = Object.fromEntries(state.items.map(item => [item.id,
        overflow.has(item.id) ? 'overflow' : stored.has(item.id) ? 'stored' : next.placements[item.id] ? 'fits' : planner.checkRules?.(item).banned ? 'banned' : 'overflow']));
      const sync = planner.computeSync ? syncPatch(ctx, next.placements, `${month} 月换季`, { owner: state.owner, swaps: nextSteps.length }) : { sync: null };
      transition = appliedMonth !== null ? `${appliedMonth} → ${month} 月` : `${month} 月 · 当前布局`;
      steps = nextSteps;
      appliedMonthPlan = next;
      appliedMonth = month;
      appliedPlan = plan;
      store.set({ month, placements: next.placements, itemStates, movePlan: null, stepIndex: 0, fitReport: null,
        ...(zoneId ? { selection: zoneId } : {}), ...sync });
      render(store.get());
    } catch {
      stopPlayback();
      error = '月度布局暂时无法载入，请重新计算。';
      ctx.alert?.(error, 'error');
      render(store.get());
    }
  }

  /** 延后计算以先绘制“计算中”；每次输入变化只产生一份全年计划。 */
  function scheduleCalculation(_state, changed = []) {
    if (!active) return;
    stopPlayback();
    clearTimeout(calculation);
    if (changed.some(key => ['room', 'items', 'owner'].includes(key))) {
      appliedMonthPlan = null;
      appliedPlan = null;
      appliedMonth = null;
      steps = [];
      transition = '';
    }
    const token = ++revision;
    error = '';
    busy = !!store.get().items.length && !!store.get().room;
    store.set({ tdmPlan: null });
    render(store.get());
    if (!busy) return;
    calculation = setTimeout(() => {
      calculation = null;
      if (!active || token !== revision) return;
      const state = store.get();
      try {
        const plan = planner.planSeasons(state.room, state.items, { owner: state.owner, tdm: state.tdm, months: MONTHS, compare: true });
        if (!active || token !== revision) return;
        store.set({ tdmPlan: plan });
        busy = false;
        applyMonth(plan.byMonth[state.month] ? state.month : MONTHS[0], { manual: false });
      } catch {
        busy = false;
        error = '换季规划未完成，已保留当前布局。请检查物品尺寸后重试。';
        ctx.alert?.(error, 'error');
        render(store.get());
      }
    }, 32);
  }

  function renderHeatmap(state) {
    const plan = state.tdmPlan;
    if (!plan) {
      spectrum.innerHTML = `<p class="empty">${busy ? '正在计算 12 个月的空间安排…' : '加入物品后生成时空占用谱'}</p>`;
      return;
    }
    const { zoneIds, months, fill } = plan.matrix;
    const scrollLeft = spectrum.scrollLeft;
    const scrollTop = spectrum.scrollTop;
    spectrum.innerHTML = zoneIds.length ? `<table class="season-spectrum"><caption class="season-sr-only">各分区每月占用率</caption><thead><tr><th scope="col">分区 / 月</th>${months.map(month => `<th scope="col" class="${state.month === month ? 'current' : ''}">${month}</th>`).join('')}</tr></thead><tbody>${zoneIds.map((id, row) => `<tr><th scope="row" title="${esc(zoneLabel(id, state))}">${esc(zoneLabel(id, state))}</th>${months.map((month, column) => {
      const rate = fill[row][column];
      const tone = rate < .5 ? 'good' : rate < .75 ? 'watch' : 'full';
      const label = `${zoneLabel(id, state)}，${month} 月，占用 ${percent(rate)}`;
      return `<td><button class="season-heat-cell ${tone}${rate > 1 ? ' overflow' : ''}${state.month === month ? ' current' : ''}${state.selection === id ? ' selected' : ''}" data-season-month="${month}" data-season-zone="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}"></button></td>`;
    }).join('')}</tr>`).join('')}</tbody></table>` : '<p class="empty">当前清单没有占用收纳分区</p>';
    spectrum.scrollLeft = scrollLeft;
    spectrum.scrollTop = scrollTop;
  }

  function renderComparison(state) {
    const host = el.querySelector('.season-comparison');
    const plan = state.tdmPlan;
    const comparison = plan?.compare;
    host.innerHTML = comparison ? `<div class="season-compare-grid">${[['on', '开启复用'], ['off', '关闭复用']].map(([key, label]) => `<div class="season-compare-card ${key}${state.tdm === (key === 'on') ? ' current' : ''}"><span>${label}</span><b>${percent(comparison[key].maxFill)}</b><small>全年浅层分区最高占用</small><p><strong class="mono">${comparison[key].overflowMonths}</strong> 个月有物品放不下</p></div>`).join('')}</div>${comparison.on.maxFill === comparison.off.maxFill ? '<p class="hint">全年固定物品也计入峰值，当前两组峰值相同。复用效果可查看下方本月箱内收纳。</p>' : ''}` : '<p class="hint">计算后显示真实的全年开启 / 关闭对照。</p>';
    const monthly = plan?.byMonth[state.month];
    const detail = el.querySelector('.season-detail-metrics');
    if (!monthly) { detail.innerHTML = ''; return; }
    const seasonal = new Set(state.items.filter(item => Array.isArray(item.months) && item.months.length > 0 && item.months.length < 12).map(item => item.id));
    const shallowZones = new Set((state.room?.zones || []).filter(zone => zone.kind !== 'keepClear' && zone.tier <= 1).map(zone => zone.id));
    const shallowVolume = Object.values(monthly.placements).filter(placement => seasonal.has(placement.itemId) && shallowZones.has(placement.zoneId)).reduce((sum, placement) => sum + volume(placement.box), 0);
    const inside = Object.values(monthly.placements).filter(placement => placement.zoneId.endsWith('.inside'));
    const insideVolume = inside.reduce((sum, placement) => sum + volume(placement.box), 0);
    detail.innerHTML = `<div class="season-live-volume"><span>本月季节物品浅层占用 <b class="mono">${shallowVolume.toFixed(1)} L</b></span><span>本月箱内复用 <b class="mono">${insideVolume.toFixed(1)} L / ${inside.length} 件</b></span></div><p class="hint">浅层为手边与起身可及分区；箱内复用按实际放置体积统计。</p>`;
  }

  function render(state) {
    if (!active) return;
    const plan = state.tdmPlan;
    const monthly = plan?.byMonth[state.month];
    const hasItems = !!state.items.length;
    toggle.checked = state.tdm;
    toggle.disabled = !state.room;
    el.querySelector('.season-empty').hidden = hasItems;
    el.querySelector('.season-status').textContent = error || (busy ? '计算中 / 正在安排全年收纳…' : !state.room ? '宿舍模板加载中' : !hasItems ? '请先载入示例，或在第一话添加物品。' : `${state.items.length} 件物品 · ${state.tdm ? '时分复用已开启' : '时分复用已关闭'}`);
    el.querySelector('.season-status').classList.toggle('error', !!error);
    el.querySelector('.season-month-number').innerHTML = `${String(state.month).padStart(2, '0')}<small>月</small>`;
    el.querySelector('.season-month-state').innerHTML = monthly ? `<span>当季 <b>${monthly.active.length}</b> 件</span><span>非当季 <b>${monthly.stored.length}</b> 件</span><span class="${monthly.overflow.length ? 'red' : ''}">滞留 <b>${monthly.overflow.length}</b> 件</span>` : '<span>等待月度计划</span>';
    playButton.disabled = busy || !plan;
    playButton.textContent = playing ? '停止播放 / 一年巡览中' : '自动播放一年 / 每月 0.8 秒';
    slider.disabled = busy || !plan;
    slider.value = Math.max(0, MONTHS.indexOf(state.month));
    footer.querySelector('.season-month-output').value = `${String(state.month).padStart(2, '0')} 月`;
    footer.querySelector('.season-year-label').textContent = state.month >= 9 ? '本年' : '次年';
    el.querySelector('.season-transition').textContent = transition;
    orders.innerHTML = busy ? '<p class="hint">正在生成换季指令…</p>' : steps.length ? `<ol class="season-order-list">${steps.map(step => `<li class="${step.kind}"><button data-season-item="${esc(step.itemId)}"><span class="mono">${String(step.idx + 1).padStart(2, '0')}</span><span>${esc(step.text)}</span></button></li>`).join('')}</ol>` : `<p class="hint">${monthly ? '本次切换无需挪动物品。' : '月度布局就绪后显示换季清单。'}</p>`;
    renderHeatmap(state);
    renderComparison(state);
  }

  el.querySelector('[data-season-example]').onclick = () => {
    if (store.get().items.length) return;
    try {
      const items = planner.parseItemsText(planner.PRESETS.freshman, { owner: store.get().owner, idPrefix: 'season' });
      if (!items.length) throw new Error('empty');
      store.set({ items, placements: {}, itemStates: {}, fitReport: null, movePlan: null, tdmPlan: null, sync: null, selection: null });
      ctx.alert?.(`换季示例已载入：${items.length} 件物品。`);
    } catch { ctx.alert?.('换季示例暂不可用，请在第一话录入物品。', 'warning'); }
  };
  toggle.onchange = () => store.set({ tdm: toggle.checked });
  slider.oninput = () => applyMonth(MONTHS[Number(slider.value)]);
  spectrum.onclick = event => {
    const cell = event.target.closest('[data-season-month]');
    if (cell) applyMonth(Number(cell.dataset.seasonMonth), { zoneId: cell.dataset.seasonZone });
  };
  orders.onclick = event => {
    const button = event.target.closest('[data-season-item]');
    if (button) store.set({ selection: button.dataset.seasonItem });
  };
  playButton.onclick = () => {
    if (playing) { stopPlayback(); render(store.get()); return; }
    if (!store.get().tdmPlan || busy) return;
    playing = true;
    let index = 0;
    applyMonth(MONTHS[0], { manual: false });
    if (!playing) return;
    playback = setInterval(() => {
      if (!active || ++index >= MONTHS.length) { stopPlayback(); render(store.get()); return; }
      applyMonth(MONTHS[index], { manual: false });
    }, 800);
    render(store.get());
  };

  const unsubscribeInput = store.subscribe(scheduleCalculation, ['room', 'items', 'owner', 'lockedZones', 'tdm']);
  const unsubscribeRender = store.subscribe(render, ['tdmPlan', 'month', 'selection']);
  ctx.setSeasonMonth = applyMonth;
  cleanup = () => {
    active = false;
    revision++;
    clearTimeout(calculation);
    stopPlayback();
    unsubscribeInput();
    unsubscribeRender();
    if (ctx.setSeasonMonth === applyMonth) delete ctx.setSeasonMonth;
    slider.oninput = null;
  };
  const state = store.get();
  render(state);
  if (state.tdmPlan?.tdm === state.tdm && state.items.length && state.room) {
    applyMonth(state.tdmPlan.byMonth[state.month] ? state.month : MONTHS[0], { manual: false });
  } else scheduleCalculation();
}

export function unmount() { cleanup(); cleanup = () => {}; }
