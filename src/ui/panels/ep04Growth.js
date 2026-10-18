import { esc, clone } from '../helpers.js';
import { sparkline } from '../widgets/monitor.js';
import '../../styles/growth.css';

let cleanup = () => {};
const semesters = Array.from({ length: 8 }, (_, index) => ({
  code: `Y${Math.floor(index / 2) + 1}-${index % 2 ? 'S' : 'F'}`,
  label: `大${['一', '二', '三', '四'][Math.floor(index / 2)]}${index % 2 ? '下' : '上'}`
}));
const semesterLabel = code => semesters.find(semester => semester.code === code)?.label || code;

/** 成长面板只读写快照数据；场景补间统一由 store → sceneBinder 完成。 */
export function mount(el, ctx) {
  cleanup();
  cleanup = () => {};
  const { store, planner, footer } = ctx;
  if (!planner?.buildRoom || !planner?.computeSync) {
    el.innerHTML = '<p class="empty">成长模块加载中</p>';
    return;
  }
  let active = true;
  let selectedId = null;
  let playing = false;
  let playbackTimer = null;
  let replayIds = [];
  let replayIndex = 0;
  const presets = Array.isArray(planner.PRESETS?.growth) ? planner.PRESETS.growth : [];
  const presetIds = new Set(presets.map(snapshot => snapshot.id));

  el.innerHTML = `<div class="growth-summary" aria-label="当前布局统计"><div><span>FOCUS / 累计专注</span><strong class="growth-minutes mono">0<small>min</small></strong></div><div><span>ITEMS / 当前物品</span><strong class="growth-items mono">0<small>件</small></strong></div></div>
    <div class="section-title">LAYOUT ARCHIVE <span>保存这一刻</span></div>
    <form class="growth-save-form"><label>快照名称<input name="label" type="text" maxlength="48" required placeholder="例如：大一上 · 入住" autocomplete="off"></label><label>学期<select name="semester">${semesters.map(semester => `<option value="${semester.code}">${semester.label}</option>`).join('')}</select></label><button class="btn btn-primary full" type="submit">保存当前快照</button></form>
    <p class="hint">快照记录此刻的布局、同步率和专注时长。点击历史节点，会载入当时的数据。</p>
    <div class="button-row"><button class="btn compact" type="button" data-growth-preset>载入成长示例</button><button class="btn compact" type="button" data-growth-replay>回放</button></div>
    <div class="growth-current" aria-live="polite"><span class="micro">LIVE LAYOUT</span><strong>当前布局</strong><small>保存每次调整，留下空间变化的轨迹。</small></div>
    <div class="section-title">SYNC HISTORY <span>同步率变化</span></div><div class="growth-chart"></div><div class="growth-chart-caption"><span>0—100%</span><span class="growth-record-count">0 个快照</span></div>
    <div class="section-title">SAVED MOMENTS <span>历史快照</span></div><div class="growth-records"></div>
    <div class="section-title">NEXT SEMESTER <span>成长预测</span></div><button class="btn full" type="button" data-growth-forecast>查看未来收纳需求</button><p class="hint growth-forecast">根据物品库中的增长速度，估算后续学期的收纳压力。</p>`;
  footer.innerHTML = '<span class="micro growth-footer-label">LAYOUT<br>ARCHIVE</span><div class="growth-timeline" aria-label="布局快照时间轴"></div>';
  const form = el.querySelector('.growth-save-form');
  const nameInput = form.elements.label;
  const semesterInput = form.elements.semester;
  const saveButton = form.querySelector('button');
  const presetButton = el.querySelector('[data-growth-preset]');
  const replayButton = el.querySelector('[data-growth-replay]');
  const forecastButton = el.querySelector('[data-growth-forecast]');
  const forecast = el.querySelector('.growth-forecast');
  const current = el.querySelector('.growth-current');
  const records = el.querySelector('.growth-records');
  const timeline = footer.querySelector('.growth-timeline');
  const minutes = el.querySelector('.growth-minutes');
  const itemCount = el.querySelector('.growth-items');
  const chart = el.querySelector('.growth-chart');
  const recordCount = el.querySelector('.growth-record-count');
  const latest = store.get().snapshots?.at(-1);
  if (semesters.some(semester => semester.code === latest?.semester)) semesterInput.value = latest.semester;

  function stopPlayback(render = true) {
    clearTimeout(playbackTimer);
    playbackTimer = null;
    playing = false;
    replayIds = [];
    replayIndex = 0;
    if (render && active) renderRecords(store.get());
  }

  function snapshotPatch(snapshot) {
    const state = store.get();
    const roomParams = clone(snapshot.roomParams);
    const room = planner.buildRoom(roomParams);
    const items = clone(snapshot.items);
    const placements = clone(snapshot.placements);
    // 快照契约没有 owner；唯一的非公共物品归属可还原使用者，多归属或空快照沿用当前使用者。
    const owners = new Set(items.map(item => item.owner).filter(owner => ['A', 'B', 'C', 'D'].includes(owner)));
    const owner = presetIds.has(snapshot.id) ? 'A' : owners.size === 1 ? [...owners][0] : state.owner;
    const sync = planner.computeSync(room, items, placements, { owner });
    if (!Number.isFinite(sync?.total) || !Number.isFinite(snapshot.focusMinutes)) throw new Error('invalid snapshot');
    return {
      roomParams, room, items, placements, owner, sync,
      focusMinutes: snapshot.focusMinutes,
      syncHistory: [...state.syncHistory, { t: new Date().toISOString(), total: sync.total, label: snapshot.label }].slice(-60),
      itemStates: Object.fromEntries(items.map(item => [item.id, placements[item.id] ? 'fits' : 'overflow'])),
      focusSpec: { ...state.focusSpec, zoneId: `${owner}.desk` },
      lockedZones: state.lockedZones.filter(id => room.zones.some(zone => zone.id === id)),
      fitReport: null, movePlan: null, stepIndex: 0, tdmPlan: null, selection: null
    };
  }

  function loadSnapshot(id, notify = false) {
    const snapshot = store.get().snapshots.find(entry => entry.id === id);
    if (!snapshot) return false;
    try {
      const patch = snapshotPatch(snapshot);
      selectedId = id;
      store.set(patch);
      if (notify) ctx.alert(`已载入「${snapshot.label}」。`);
      return true;
    } catch {
      ctx.alert('这份快照暂时无法载入，当前布局已保留。', 'warning');
      return false;
    }
  }

  function saveSnapshot(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const label = nameInput.value.trim();
    if (!label) { nameInput.focus(); return; }
    const state = store.get();
    if (!state.room || !state.roomParams) { ctx.alert('先完成宿舍建模，再保存快照。', 'warning'); return; }
    try {
      const sync = planner.computeSync(state.room, state.items, state.placements, { owner: state.owner });
      if (!Number.isFinite(sync?.total)) throw new Error('invalid sync');
      const snapshot = clone({
        id: crypto.randomUUID(), label, semester: semesterInput.value,
        createdAt: new Date().toISOString(), roomParams: state.roomParams,
        items: state.items, placements: state.placements, sync: sync.total, focusMinutes: state.focusMinutes
      });
      stopPlayback(false);
      selectedId = snapshot.id;
      // 保存只追加档案；后续专注完成触发渲染时，绝不把档案中的旧时长重新写回。
      store.set({ snapshots: [...state.snapshots, snapshot], sync });
      nameInput.value = '';
      ctx.alert(`已保存「${label}」：同步率 ${sync.total}%。`, 'success');
    } catch { ctx.alert('快照保存失败，请检查当前布局数据。', 'error'); }
  }

  function loadPreset() {
    if (!presets.length) { ctx.alert('成长示例正在准备，可以先保存自己的快照。', 'warning'); return; }
    stopPlayback(false);
    // 再次载入示例只替换同 ID 的示例记录，保留用户自己保存的快照。
    const snapshots = [...store.get().snapshots.filter(snapshot => !presetIds.has(snapshot.id)), ...clone(presets)];
    store.set({ snapshots });
    if (loadSnapshot(presets[0].id)) ctx.alert(`已载入 ${presets.length} 个成长快照，点击底栏节点查看变化。`, 'success');
  }

  function replayNext() {
    if (!active || !playing) return;
    if (replayIndex >= replayIds.length) {
      stopPlayback();
      ctx.alert('成长回放完成。', 'success');
      return;
    }
    if (!loadSnapshot(replayIds[replayIndex++])) { stopPlayback(); return; }
    playbackTimer = setTimeout(replayNext, 1200);
  }

  function replay() {
    if (playing) { stopPlayback(); return; }
    const snapshots = store.get().snapshots;
    if (snapshots.length < 2) return;
    replayIds = snapshots.map(snapshot => snapshot.id);
    replayIndex = 0;
    playing = true;
    replayNext();
  }

  function chooseSnapshot(event) {
    const button = event.target.closest('[data-snapshot]');
    if (!button) return;
    stopPlayback(false);
    loadSnapshot(button.dataset.snapshot, true);
  }

  function showForecast() {
    const state = store.get();
    if (!planner.predictGrowth || !state.room || !state.items.length) return;
    try {
      const prediction = planner.predictGrowth(state.items, state.room, { owner: state.owner });
      forecast.textContent = prediction.text;
      forecast.classList.toggle('growth-warning', !!prediction.firstOverflow);
    } catch { ctx.alert('成长预测暂不可用，已保存的快照仍可查看。', 'warning'); }
  }

  function renderStats(state) {
    const duration = Math.max(0, Number(state.focusMinutes) || 0);
    minutes.innerHTML = `${duration.toLocaleString('zh-CN')}<small>min</small>`;
    itemCount.innerHTML = `${state.items.length}<small>件</small>`;
    saveButton.disabled = !state.room || !!state.timer?.running;
    forecastButton.disabled = !planner.predictGrowth || !state.room || !state.items.length;
  }

  function renderRecords(state) {
    const snapshots = state.snapshots || [];
    const selected = snapshots.find(snapshot => snapshot.id === selectedId);
    const focused = document.activeElement;
    const focusHost = records.contains(focused) ? records : timeline.contains(focused) ? timeline : null;
    const focusId = focusHost ? focused?.closest('[data-snapshot]')?.dataset.snapshot : null;
    chart.innerHTML = sparkline(snapshots.map(snapshot => ({ t: snapshot.createdAt, total: snapshot.sync, label: snapshot.label })));
    recordCount.textContent = `${snapshots.length} 个快照`;
    presetButton.disabled = !presets.length || !!state.timer?.running;
    replayButton.disabled = snapshots.length < 2 || !!state.timer?.running;
    replayButton.textContent = playing ? '停止回放' : '回放';
    records.innerHTML = snapshots.length ? snapshots.map(snapshot => `<button class="growth-record${snapshot.id === selectedId ? ' active' : ''}" type="button" data-snapshot="${esc(snapshot.id)}" aria-pressed="${snapshot.id === selectedId}"${state.timer?.running ? ' disabled' : ''}><span class="growth-record-label"><strong>${esc(snapshot.label)}</strong><small>${esc(semesterLabel(snapshot.semester))} · ${snapshot.items.length} 件物品 · ${snapshot.focusMinutes} min</small></span><span class="growth-record-sync mono">${snapshot.sync}<small>%</small></span></button>`).join('') : '<p class="empty">还没有快照。保存此刻的布局，或载入成长示例。</p>';
    timeline.innerHTML = snapshots.length ? snapshots.map(snapshot => `<button class="growth-node${snapshot.id === selectedId ? ' active' : ''}" type="button" data-snapshot="${esc(snapshot.id)}" title="${esc(snapshot.label)}" aria-label="${esc(snapshot.label)}，同步率 ${snapshot.sync}%，${esc(semesterLabel(snapshot.semester))}" aria-pressed="${snapshot.id === selectedId}"${state.timer?.running ? ' disabled' : ''}><span class="growth-node-sync mono">${snapshot.sync}%</span><i aria-hidden="true"></i><span class="growth-node-semester">${esc(semesterLabel(snapshot.semester))}</span></button>`).join('') : '<span class="hint growth-timeline-empty">尚无档案节点</span>';
    current.classList.toggle('playing', playing);
    current.innerHTML = selected ? `<span class="micro">${playing ? 'REPLAY / ' : 'ARCHIVE / '}${esc(semesterLabel(selected.semester))}</span><strong>${esc(selected.label)}</strong><small>${selected.items.length} 件物品 · 快照同步率 ${selected.sync}%</small>` : '<span class="micro">LIVE LAYOUT</span><strong>当前布局</strong><small>保存每次调整，留下空间变化的轨迹。</small>';
    if (focusId) [...focusHost.querySelectorAll('[data-snapshot]')].find(button => button.dataset.snapshot === focusId)?.focus({ preventScroll: true });
  }

  const unsubscribe = store.subscribe((state, changed) => {
    renderStats(state);
    if (changed.some(key => ['snapshots', 'items', 'room', 'focusMinutes', 'timer'].includes(key))) renderRecords(state);
    if (changed.some(key => ['items', 'room', 'owner'].includes(key))) {
      forecast.textContent = '布局已变化，可重新查看未来学期的收纳需求。';
      forecast.classList.remove('growth-warning');
    }
    if (state.timer?.running && playing) stopPlayback();
  }, ['snapshots', 'items', 'room', 'focusMinutes', 'timer', 'owner']);
  form.addEventListener('submit', saveSnapshot);
  presetButton.addEventListener('click', loadPreset);
  replayButton.addEventListener('click', replay);
  forecastButton.addEventListener('click', showForecast);
  records.addEventListener('click', chooseSnapshot);
  timeline.addEventListener('click', chooseSnapshot);
  renderStats(store.get());
  renderRecords(store.get());
  cleanup = () => {
    active = false;
    stopPlayback(false);
    unsubscribe();
    form.removeEventListener('submit', saveSnapshot);
    presetButton.removeEventListener('click', loadPreset);
    replayButton.removeEventListener('click', replay);
    forecastButton.removeEventListener('click', showForecast);
    records.removeEventListener('click', chooseSnapshot);
    timeline.removeEventListener('click', chooseSnapshot);
  };
}

export function unmount() {
  cleanup();
  cleanup = () => {};
}
