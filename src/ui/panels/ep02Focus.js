import { esc, clone, syncPatch } from '../helpers.js';
let cleanup = () => {};
const starts = new WeakMap();

/** 腾桌只编排公开 API，移动中的几何交给场景；跳步交给 planner.applySteps。 */
export function mount(el, ctx) {
  const { store, planner, scene } = ctx;
  if (!planner) { el.innerHTML = '<p class="empty">规划模块加载中</p>'; return; }
  let controller = null;
  let playing = false;
  let paused = false;
  let active = true;
  let fallbackTimer = null;
  const spec = store.get().focusSpec;
  el.innerHTML = `<button id="messy" class="btn full">载入乱桌示例</button><div class="section-title">FOCUS GEOMETRY <span>专注区尺寸</span></div><div class="focus-presets">${[[35,25,'仅笔记本'],[75,35,'书 + 笔记本'],[90,40,'双开书 + 笔记本']].map(([w,d,label]) => `<button class="btn compact" data-focus-size="${w},${d}"><span>${label}</span><b class="mono">${w}×${d} cm</b></button>`).join('')}</div><div class="field-grid focus-custom"><label>宽度 cm<input id="focus-w" type="number" min="1" max="200" value="${spec.w}" step="1"></label><label>深度 cm<input id="focus-d" type="number" min="1" max="150" value="${spec.d}" step="1"></label><label>面积 ㎡<output id="focus-area" class="tile-result mono"></output></label></div><p class="hint">专注区位于桌前沿居中；固定家具、室友物品和锁定分区保持原位。</p><button class="btn btn-primary full" id="deploy">展开专注力场</button><div id="orders"></div><button class="btn full" id="start-focus" disabled>开始专注 / 25:00</button><p class="hint">先执行作战指令，净空后进入专注限界。</p>`;
  function stopPlayback() {
    controller?.stop?.(); controller = null;
    clearTimeout(fallbackTimer); fallbackTimer = null;
    playing = false; paused = false;
  }
  function settlePlayback() {
    const s = store.get(); const plan = s.movePlan;
    const wasPlaying = playing;
    stopPlayback();
    if (wasPlaying && plan) store.set({ placements: planner.applySteps(starts.get(plan) || s.placements, plan.steps, s.stepIndex) });
  }
  function seek(index) {
    const s = store.get(); const plan = s.movePlan; if (!plan) return;
    stopPlayback();
    const upto = Math.max(0, Math.min(Number(index), plan.steps.length));
    const placements = planner.applySteps(starts.get(plan) || s.placements, plan.steps, upto);
    const itemStates = Object.fromEntries(s.items.map(item => [item.id, plan.conflicts.includes(item.id) ? 'conflict' : 'fits']));
    plan.steps.slice(0,upto).forEach(step => { itemStates[step.itemId] = step.kind === 'dispose' ? 'stored' : 'moved'; });
    if (upto === plan.steps.length) {
      store.set({ placements: plan.placementsAfter, stepIndex: upto, itemStates,
        ...syncPatch(ctx, plan.placementsAfter, '腾桌完成', { focusBox: plan.focusBox, moves: plan.steps.length }) });
    } else store.set({ placements, stepIndex: upto, itemStates });
  }
  function finish(plan) {
    if (!active || store.get().movePlan !== plan) return;
    stopPlayback();
    seek(plan.steps.length);
    ctx.alert(plan.unresolved.length ? `已执行可行步骤，仍有 ${plan.unresolved.length} 件待处理。` : '专注力场已净空，可以开始专注。', plan.unresolved.length ? 'warning' : 'success');
  }
  function togglePlayback() {
    const s = store.get(); const plan = s.movePlan; if (!plan?.steps.length) return;
    if (playing && !paused) { controller?.pause?.(); clearTimeout(fallbackTimer); paused = true; render(store.get()); return; }
    if (playing && paused && controller) { controller.resume?.(); paused = false; render(store.get()); return; }
    let start = s.stepIndex;
    if (start >= plan.steps.length) { seek(0); start = 0; }
    playing = true; paused = false;
    if (scene?.playSteps) {
      try {
        controller = scene.playSteps(plan.steps.slice(start), {
          stepMs: 900,
          onStep: i => { if (active) store.set({ stepIndex: start + i }); },
          onDone: () => finish(plan)
        });
      } catch { stopPlayback(); ctx.alert('移动动画暂不可用，请使用单步或进度条。', 'warning'); }
    } else {
      // 场景模块缺席时仍能逐步审阅真实的规划结果。
      let index = start;
      const tick = () => {
        if (!active || paused) return;
        index++;
        store.set({ placements: planner.applySteps(starts.get(plan) || s.placements, plan.steps, index), stepIndex: index });
        if (index >= plan.steps.length) finish(plan);
        else fallbackTimer = setTimeout(tick, 900);
      };
      fallbackTimer = setTimeout(tick, 900);
    }
    render(store.get());
  }
  function updateSpec(w, d) {
    if (!(w > 0 && d > 0 && w <= 200 && d <= 150)) { ctx.alert('请填写有效的专注区宽深。', 'warning'); return; }
    settlePlayback();
    el.querySelector('#focus-w').value = w; el.querySelector('#focus-d').value = d;
    store.set({ focusSpec: { zoneId: `${store.get().owner}.desk`, w, d }, movePlan: null, stepIndex: 0, itemStates: {} });
    render(store.get());
  }
  el.querySelectorAll('[data-focus-size]').forEach(button => button.onclick = () => updateSpec(...button.dataset.focusSize.split(',').map(Number)));
  const changeSpec = () => updateSpec(Number(el.querySelector('#focus-w').value), Number(el.querySelector('#focus-d').value));
  el.querySelector('#focus-w').onchange = changeSpec; el.querySelector('#focus-d').onchange = changeSpec;
  el.querySelector('#messy').onclick = () => {
    const preset = planner.PRESETS.messyDesk;
    if (!preset?.items.length) { ctx.alert('乱桌示例正在准备，暂可沿用入住结果。', 'warning'); return; }
    stopPlayback();
    const items = clone(preset.items); const placements = clone(preset.placements);
    // 演示预设属于 A；切换 owner 避免在别人的桌面执行指令。
    store.set({ owner: 'A', focusSpec: { ...store.get().focusSpec, zoneId: 'A.desk' }, items, placements, itemStates: {}, fitReport: null, movePlan: null, stepIndex: 0, tdmPlan: null, selection: 'A.desk' });
    store.set(syncPatch(ctx, placements, '乱桌载入'));
    ctx.alert(`乱桌已载入：${items.length} 件物品，先展开力场定位冲突。`);
  };
  el.querySelector('#deploy').onclick = () => {
    try {
      settlePlayback();
      const s = store.get();
      const plan = planner.planFocusField(s.room, s.items, s.placements, s.focusSpec, { lockedZones: s.lockedZones });
      starts.set(plan, clone(s.placements));
      const itemStates = Object.fromEntries(s.items.map(item => [item.id, plan.conflicts.includes(item.id) ? 'conflict' : 'fits']));
      store.set({ movePlan: plan, stepIndex: 0, itemStates, ...syncPatch(ctx, plan.placementsAfter, '腾桌预判', { focusBox: plan.focusBox, moves: plan.steps.length }) });
      ctx.alert(plan.conflicts.length ? `专注区检测到 ${plan.conflicts.length} 件冲突物品，生成 ${plan.steps.length} 步指令。` : '专注区已经净空。', plan.conflicts.length ? 'warning' : 'success');
    } catch { ctx.alert('暂时无法生成作战指令，请检查桌面尺寸。', 'error'); }
  };
  el.querySelector('#orders').onclick = event => {
    if (event.target.closest('#play-orders')) togglePlayback();
    if (event.target.closest('#step-order')) seek(store.get().stepIndex + 1);
    if (event.target.closest('#reset-orders')) seek(0);
    const step = event.target.closest('[data-step]'); if (step) seek(Number(step.dataset.step));
  };
  ctx.footer.innerHTML = '<span class="micro">ORDERS</span><input id="step-slider" type="range" min="0" max="0" value="0" aria-label="作战步骤进度"><span id="step-count" class="mono">0 / 0</span>';
  ctx.footer.querySelector('#step-slider').oninput = event => seek(event.target.value);
  el.querySelector('#start-focus').onclick = () => ctx.startFocus?.();
  function render(s) {
    const plan = s.movePlan;
    el.querySelector('#focus-area').value = (s.focusSpec.w * s.focusSpec.d / 10000).toFixed(2);
    el.querySelectorAll('[data-focus-size]').forEach(button => button.classList.toggle('active', button.dataset.focusSize === `${s.focusSpec.w},${s.focusSpec.d}`));
    el.querySelector('#deploy').disabled = !s.items.length || !Object.keys(s.placements).length;
    el.querySelector('#start-focus').disabled = !plan || s.stepIndex < plan.steps.length || plan.unresolved.length > 0;
    el.querySelector('#orders').innerHTML = plan ? `<div class="section-title">OPERATION ORDERS <span>${plan.steps.length} 步</span></div><div class="plan-metrics"><span><b>${plan.metrics.moves}</b> 件移动</span><span>约 <b>${Math.round(plan.metrics.estSeconds)}</b> 秒</span><span><b>${(plan.metrics.clearedArea / 10000).toFixed(2)}</b> ㎡</span></div>${plan.steps.length ? `<ol class="order-list">${plan.steps.map((step,i) => `<li class="${i < s.stepIndex ? 'done' : i === s.stepIndex ? 'current' : ''}"><button data-step="${i+1}"><span class="mono">${String(i+1).padStart(2,'0')}</span>${esc(step.text)}</button></li>`).join('')}</ol><div class="button-row"><button class="btn compact btn-primary" id="play-orders">${playing && !paused ? '暂停' : paused ? '继续' : s.stepIndex === plan.steps.length ? '重放' : '执行指令'}</button><button class="btn compact" id="step-order" ${s.stepIndex >= plan.steps.length ? 'disabled' : ''}>单步</button><button class="btn compact" id="reset-orders">复位</button></div>` : '<p class="green hint">专注区已经净空。</p>'}${plan.unresolved.map(entry => `<div class="unresolved"><b>${esc(s.items.find(i => i.id === entry.itemId)?.name || '待处理物品')}</b><p>${esc(entry.reason)}</p><p>${esc(entry.suggestion)}</p></div>`).join('')}` : '<p class="empty">展开力场，生成最少移动指令。</p>';
    const slider = ctx.footer.querySelector('#step-slider');
    if (slider) { slider.max = plan?.steps.length || 0; slider.value = s.stepIndex; slider.disabled = !plan?.steps.length; ctx.footer.querySelector('#step-count').textContent = `${s.stepIndex} / ${plan?.steps.length || 0}`; }
  }
  const onShortcut = event => {
    if (event.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('.title-card,.focus-limit,.boot-screen')) return;
    if (event.key.toLowerCase() === 'f') el.querySelector('#deploy').click();
    if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
  };
  document.addEventListener('keydown', onShortcut);
  const unsubscribe = store.subscribe(render, ['movePlan', 'stepIndex', 'items', 'focusSpec', 'placements']);
  render(store.get());
  cleanup = () => {
    active = false;
    // 场景播放中离开本话时，落到最后已完成步骤，避免视图与仓库分离。
    unsubscribe(); document.removeEventListener('keydown', onShortcut);
    settlePlayback();
  };
}
export function unmount() { cleanup(); }
