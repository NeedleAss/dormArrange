import { esc } from '../helpers.js';
import '../../styles/monitor.css';

const voteLabels = [['time', '时', 'TIME'], ['space', '空', 'SPACE'], ['mind', '心', 'MIND']];
const zoneLabels = { empty: '空白', designing: '设计中', done: '已完成' };
const clock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
});

/**
 * 仅绘制真实历史记录；固定 0—100 纵轴，避免分数变化被视觉夸大。
 * @param {{t?: string, total: number, label?: string}[]} history
 * @returns {string} 可直接插入界面的 SVG。
 */
export function sparkline(history = []) {
  const points = history.filter(entry => Number.isFinite(entry?.total)).slice(-60);
  const grid = [8, 30, 52].map(y => `<line x1="6" y1="${y}" x2="258" y2="${y}"/>`).join('');
  if (!points.length) {
    return `<svg class="monitor-sparkline" viewBox="0 0 264 60" role="img" aria-label="尚无同步率历史"><g class="monitor-chart-grid">${grid}</g><text x="132" y="34" text-anchor="middle">等待首条评估记录</text></svg>`;
  }
  const coords = points.map((entry, i) => ({
    x: points.length === 1 ? 132 : 6 + i * 252 / (points.length - 1),
    y: 52 - Math.max(0, Math.min(100, entry.total)) * .44,
    entry
  }));
  const path = coords.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const last = coords.at(-1);
  const label = `${points.length} 次评估，最新同步率 ${Math.round(last.entry.total)}%`;
  return `<svg class="monitor-sparkline" viewBox="0 0 264 60" role="img" aria-label="${esc(label)}"><g class="monitor-chart-grid">${grid}</g><path class="monitor-chart-line" d="${path}"/>${coords.map(({ x, y, entry }) => `<circle class="monitor-chart-point" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${entry === last.entry ? 3 : 1.5}"><title>${esc(entry.label || '空间评估')} · ${Math.round(entry.total)}%</title></circle>`).join('')}</svg>`;
}

/**
 * 常驻监视器；每块只订阅自己需要的状态，场景联动统一交给 sceneBinder。
 * @param {HTMLElement} el
 * @param {{store: {get: Function, set: Function, subscribe: Function}, planner?: object|null}} ctx
 * @returns {() => void} 取消订阅并停止数字动画。
 */
export function mountMonitor(el, { store, planner }) {
  el.innerHTML = `
    <section class="panel monitor-sync"><div class="panel-head">SYNC RATIO <b>同步率</b></div><div class="panel-body">
      <div class="monitor-gauge" data-tone="standby"><span class="monitor-sync-value">—</span><span class="monitor-sync-unit">%</span><span class="monitor-sync-caption">待评估</span></div>
      <div class="monitor-history"></div><div class="monitor-chart-caption"><span>HISTORY / 0—100</span><span class="monitor-history-count">0 RECORDS</span></div>
    </div></section>
    <section class="panel monitor-tribunal"><div class="panel-head">TRIBUNAL <b>三审决议</b></div><div class="panel-body" data-tribunal></div></section>
    <section class="panel monitor-zones"><div class="panel-head">ZONE STATUS <b>分区状态</b></div><div class="monitor-zone-summary"></div><div class="monitor-zone-list" aria-label="分区状态列表"></div></section>
    <section class="panel monitor-alerts"><div class="panel-head">ALERT STREAM <b>警报流</b></div><ol class="monitor-alert-list" aria-live="polite" aria-relevant="additions text"></ol></section>`;

  const gauge = el.querySelector('.monitor-gauge');
  const value = el.querySelector('.monitor-sync-value');
  const caption = el.querySelector('.monitor-sync-caption');
  const history = el.querySelector('.monitor-history');
  const historyCount = el.querySelector('.monitor-history-count');
  const tribunal = el.querySelector('[data-tribunal]');
  const zoneList = el.querySelector('.monitor-zone-list');
  const zoneSummary = el.querySelector('.monitor-zone-summary');
  const alertList = el.querySelector('.monitor-alert-list');
  const seenAlerts = new Set();
  let frame = 0;
  let displayed = null;
  let lastTotal = null;

  function renderSync(s) {
    const total = s.sync && Number.isFinite(s.sync.total) ? Math.max(0, Math.min(100, s.sync.total)) : null;
    if (total === lastTotal && total !== null) return;
    cancelAnimationFrame(frame);
    lastTotal = total;
    if (total === null) {
      displayed = null;
      gauge.dataset.tone = 'standby';
      value.textContent = '—';
      gauge.setAttribute('aria-label', '同步率待评估');
      caption.textContent = '待评估';
      return;
    }
    gauge.dataset.tone = total >= 80 ? 'good' : total >= 60 ? 'watch' : 'alert';
    gauge.setAttribute('aria-label', `同步率 ${Math.round(total)}%`);
    caption.textContent = total >= 80 ? '空间协同良好' : total >= 60 ? '仍有优化余地' : '需要调整布局';
    const from = displayed ?? 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayed = total;
      value.textContent = String(Math.round(total));
      return;
    }
    const started = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - started) / 600);
      displayed = from + (total - from) * progress;
      value.textContent = String(Math.round(displayed));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  function renderHistory(s) {
    const records = (s.syncHistory || []).filter(entry => Number.isFinite(entry?.total));
    history.innerHTML = sparkline(records);
    historyCount.textContent = `${records.length} RECORD${records.length === 1 ? '' : 'S'}`;
  }

  function renderTribunal(s) {
    const sync = s.sync;
    const assessed = !!sync?.votes && Number.isFinite(sync.total);
    const notes = Array.isArray(sync?.notes) ? sync.notes : [];
    const allApproved = assessed && voteLabels.every(([key]) => sync.votes[key] === true);
    tribunal.innerHTML = `<div class="monitor-votes">${voteLabels.map(([key, zh, en]) => {
      const vote = assessed ? sync.votes[key] : undefined;
      const status = vote === true ? 'approved' : vote === false ? 'denied' : 'pending';
      const text = vote === true ? '承认' : vote === false ? '否决' : '待审';
      const note = notes.length ? notes.join('\n') : assessed ? '本次评估未报告待解决事项。' : '完成首次规划后生成评估。';
      return `<div class="monitor-vote ${status}" tabindex="0" title="${esc(note)}" aria-label="${zh} ${en}：${text}。${esc(note)}"><span>${zh} <small>${en}</small></span><strong>${text}</strong></div>`;
    }).join('')}</div><div class="monitor-verdict ${allApproved ? 'approved' : assessed ? 'denied' : 'pending'}">${allApproved ? '全员承认 · 执行' : assessed ? '审议未通过' : '等待首次规划'}</div>${notes.length ? `<p class="monitor-vote-notes">${esc(notes.join(' / '))}</p>` : ''}`;
  }

  function renderZones(s) {
    const zones = (s.room?.zones || []).filter(zone => zone.owner === s.owner || zone.owner === 'pub');
    let fills = {};
    if (planner?.zoneFill && s.room) {
      try { fills = planner.zoneFill(s.room, s.items, s.placements) || {}; } catch { /* 模块未就绪时显示未知占用率，不编造评估。 */ }
    }
    const occupied = new Set(Object.values(s.placements || {}).map(placement => placement.zoneId));
    const locked = new Set(s.lockedZones || []);
    zoneSummary.textContent = `${s.owner} / 公共空间 · ${zones.length} 个分区`;
    const scrollTop = zoneList.scrollTop;
    zoneList.innerHTML = zones.length ? zones.map(zone => {
      const status = s.zoneStatus?.[zone.id] || (locked.has(zone.id) ? 'done' : occupied.has(zone.id) ? 'designing' : 'empty');
      const fill = fills[zone.id];
      const known = Number.isFinite(fill);
      const percent = known ? Math.round(Math.max(0, fill) * 100) : null;
      const tone = known && fill >= .75 ? 'full' : known && fill >= .5 ? 'watch' : 'good';
      return `<button class="monitor-zone ${status}${s.selection === zone.id ? ' selected' : ''}" data-zone="${esc(zone.id)}" aria-pressed="${s.selection === zone.id}" title="${esc(zone.label)} · ${zoneLabels[status] || zoneLabels.empty}${known ? ` · 占用率 ${percent}%` : ' · 占用率待评估'}">
        <span class="monitor-zone-title"><span><i class="status-dot ${status}"></i>${esc(zone.label)}</span><span class="monitor-zone-fill">${known ? `${percent}%` : '—'}</span></span>
        <span class="monitor-zone-meta"><span>${zone.kind === 'keepClear' ? '保持畅通 / ' : ''}${zoneLabels[status] || zoneLabels.empty}</span><span>${esc(zone.id)}</span></span>
        <span class="monitor-fill-track ${tone}"${known ? ` role="meter" aria-label="${esc(zone.label)}占用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, percent)}" aria-valuetext="${percent}%"` : ''}><i style="width:${known ? Math.min(100, percent) : 0}%"></i></span>
      </button>`;
    }).join('') : '<div class="empty">宿舍模板加载中</div>';
    zoneList.scrollTop = scrollTop;
  }

  function renderAlerts(s) {
    const records = [...(s.alerts || [])].sort((a, b) => (Date.parse(b.t) || 0) - (Date.parse(a.t) || 0)).slice(0, 6);
    alertList.innerHTML = records.length ? records.map(alert => {
      const level = ['info', 'warning', 'error', 'success'].includes(alert.level) ? alert.level : 'info';
      const key = alert.id ?? `${alert.t}:${alert.text}`;
      const fresh = !seenAlerts.has(key);
      seenAlerts.add(key);
      const time = Date.parse(alert.t);
      return `<li class="monitor-alert ${level}${fresh && level === 'error' ? ' fresh' : ''}"><time${Number.isFinite(time) ? ` datetime="${esc(alert.t)}"` : ''}>${Number.isFinite(time) ? clock.format(new Date(time)) : '—:—:—'}</time><i aria-label="${({ info: '信息', warning: '警告', error: '紧急', success: '完成' })[level]}"></i><span>${esc(alert.text)}</span></li>`;
    }).join('') : '<li class="monitor-alert-empty">暂无警报 · 等待行动</li>';
  }

  const chooseZone = event => {
    const button = event.target.closest('[data-zone]');
    if (button && zoneList.contains(button)) store.set({ selection: button.dataset.zone });
  };
  zoneList.addEventListener('click', chooseZone);
  const unsubscribers = [
    store.subscribe(renderSync, ['sync']),
    store.subscribe(renderHistory, ['syncHistory']),
    store.subscribe(renderTribunal, ['sync']),
    store.subscribe(renderZones, ['room', 'owner', 'items', 'placements', 'zoneStatus', 'lockedZones', 'selection']),
    store.subscribe(renderAlerts, ['alerts'])
  ];
  const state = store.get();
  renderSync(state);
  renderHistory(state);
  renderTribunal(state);
  renderZones(state);
  renderAlerts(state);
  return () => {
    unsubscribers.forEach(unsubscribe => unsubscribe());
    cancelAnimationFrame(frame);
    zoneList.removeEventListener('click', chooseZone);
    el.replaceChildren();
  };
}
