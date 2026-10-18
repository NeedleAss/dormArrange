import { esc } from '../helpers.js';
import { renderTribunalBoard } from './tribunal.js';
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
    <div class="monitor-overview" aria-label="空间状态总览">
    <section class="panel monitor-sync"><div class="panel-head"><b>同步率</b><span>SYNC</span></div><div class="panel-body">
      <div class="monitor-gauge" data-tone="standby"><svg class="monitor-sync-orbit" viewBox="0 0 288 162" aria-hidden="true"><path class="monitor-sync-orbit-guide" d="M7 131 A117 117 0 0 1 240 78"/><path class="monitor-sync-orbit-track" d="M21 130 A103 103 0 0 1 226 81"/><path class="monitor-sync-orbit-fill" pathLength="100" d="M21 130 A103 103 0 0 1 226 81"/><path class="monitor-sync-orbit-cut" d="M241 75 L254 63 L276 63 M251 124 L275 100"/></svg><div class="monitor-sync-readout"><span class="monitor-sync-value">—</span><span class="monitor-sync-unit">%</span></div><span class="monitor-sync-caption">等待规划</span></div>
      <div class="monitor-history"></div><div class="monitor-chart-caption"><span>0—100%</span><span class="monitor-history-count">0 次记录</span></div>
    </div></section>
    <section class="panel monitor-tribunal"><div class="panel-head"><b>三审决议</b><span>03</span></div><div class="panel-body" data-tribunal></div></section>
    </div><div class="monitor-inspectors">
    <details class="panel monitor-zones monitor-fold" name="monitor-inspector"><summary class="panel-head"><b>分区状态</b><span class="monitor-zone-count">00</span></summary><div class="monitor-zone-summary"></div><div class="monitor-zone-list" aria-label="分区状态列表"></div></details>
    <details class="panel monitor-alerts monitor-fold" name="monitor-inspector"><summary class="panel-head"><b>警报</b><span class="monitor-alert-count">00</span></summary><ol class="monitor-alert-list" aria-live="polite" aria-relevant="additions text"></ol></details></div>`;

  const gauge = el.querySelector('.monitor-gauge');
  const value = el.querySelector('.monitor-sync-value');
  const caption = el.querySelector('.monitor-sync-caption');
  const history = el.querySelector('.monitor-history');
  const historyCount = el.querySelector('.monitor-history-count');
  const tribunal = el.querySelector('[data-tribunal]');
  const zoneList = el.querySelector('.monitor-zone-list');
  const zoneSummary = el.querySelector('.monitor-zone-summary');
  const zoneCount = el.querySelector('.monitor-zone-count');
  const alertList = el.querySelector('.monitor-alert-list');
  const alertCount = el.querySelector('.monitor-alert-count');
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
      gauge.style.setProperty('--sync-fill', 0);
      value.textContent = '—';
      gauge.setAttribute('aria-label', '同步率待评估');
      caption.textContent = '等待规划';
      return;
    }
    gauge.dataset.tone = total >= 80 ? 'good' : total >= 60 ? 'watch' : 'alert';
    // 弧线只映射真实同步率；未评估时只有静态导线，不显示虚构读数。
    gauge.style.setProperty('--sync-fill', total);
    gauge.setAttribute('aria-label', `同步率 ${Math.round(total)}%`);
    caption.textContent = total >= 80 ? '协同良好' : total >= 60 ? '等待优化' : '需要调整';
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
    historyCount.textContent = `${records.length} 次记录`;
  }

  function renderTribunal(s) {
    const sync = s.sync;
    const assessed = !!sync?.votes && Number.isFinite(sync.total);
    const notes = Array.isArray(sync?.notes) ? [...sync.notes] : [];
    const occupants = s.room?.params?.occupants || [];
    for (const item of s.items || []) {
      const verdict = s.fitReport?.verdicts?.[item.id];
      if (verdict && ['overflow', 'banned'].includes(verdict.status)) {
        notes.push(`${item.name}：${[...(verdict.reasons || []), ...(verdict.suggestions || [])].join('；')}`);
      }
      if (occupants.length && item.owner !== 'pub' && !occupants.includes(item.owner)) {
        notes.push(`${item.name}：仍保留 ${item.owner} 归属；当前房型没有该床位，请核对。`);
      }
    }
    const allApproved = assessed && voteLabels.every(([key]) => sync.votes[key] === true);
    const approvals = assessed ? voteLabels.filter(([key]) => sync.votes[key] === true).length : null;
    tribunal.innerHTML = `${renderTribunalBoard(sync)}<div class="monitor-verdict ${allApproved ? 'approved' : assessed ? 'denied' : 'pending'}"><span>${allApproved ? '三审通过' : assessed ? '审议未通过' : '等待规划'}</span><b>${approvals === null ? '—' : approvals}<small>/3</small></b></div>${notes.length ? `<details class="monitor-note"><summary>审议依据</summary><p class="monitor-vote-notes">${esc(notes.join(' / '))}</p></details>` : ''}`;
  }

  function renderZones(s) {
    const zones = (s.room?.zones || []).filter(zone => zone.owner === s.owner || zone.owner === 'pub');
    let fills = {};
    if (planner?.zoneFill && s.room) {
      try { fills = planner.zoneFill(s.room, s.items, s.placements) || {}; } catch { /* 模块未就绪时显示未知占用率，不编造评估。 */ }
    }
    const occupied = new Set(Object.values(s.placements || {}).map(placement => placement.zoneId));
    const locked = new Set(s.lockedZones || []);
    zoneSummary.textContent = `${s.owner} 号 / 含公共空间`;
    zoneCount.textContent = String(zones.length).padStart(2, '0');
    const scrollTop = zoneList.scrollTop;
    zoneList.innerHTML = zones.length ? zones.map(zone => {
      const status = s.zoneStatus?.[zone.id] || (locked.has(zone.id) ? 'done' : occupied.has(zone.id) ? 'designing' : 'empty');
      const fill = fills[zone.id];
      const known = Number.isFinite(fill);
      const percent = known ? Math.round(Math.max(0, fill) * 100) : null;
      const tone = known && fill >= .75 ? 'full' : known && fill >= .5 ? 'watch' : 'good';
      return `<button class="monitor-zone ${status}${s.selection === zone.id ? ' selected' : ''}" data-zone="${esc(zone.id)}" aria-pressed="${s.selection === zone.id}" title="${esc(zone.label)} · ${zoneLabels[status] || zoneLabels.empty}${known ? ` · 占用率 ${percent}%` : ' · 占用率待评估'}">
        <span class="monitor-zone-title"><span><i class="status-dot ${status}"></i>${esc(zone.label)}</span><span class="monitor-zone-fill">${known ? `${percent}%` : '—'}</span></span>
        <span class="monitor-zone-meta"><span>${zone.kind === 'keepClear' ? '保持畅通 / ' : ''}${zoneLabels[status] || zoneLabels.empty}</span><span>${zone.kind === 'keepClear' ? '通道' : ['手边', '起身可及', '深层收纳'][zone.tier] || ''}</span></span>
        <span class="monitor-fill-track ${tone}"${known ? ` role="meter" aria-label="${esc(zone.label)}占用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, percent)}" aria-valuetext="${percent}%"` : ''}><i style="width:${known ? Math.min(100, percent) : 0}%"></i></span>
      </button>`;
    }).join('') : '<div class="empty">宿舍模板加载中</div>';
    zoneList.scrollTop = scrollTop;
  }

  function renderAlerts(s) {
    const records = [...(s.alerts || [])].sort((a, b) => (Date.parse(b.t) || 0) - (Date.parse(a.t) || 0)).slice(0, 6);
    alertCount.textContent = String(records.length).padStart(2, '0');
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
    store.subscribe(renderTribunal, ['sync', 'fitReport', 'items', 'room']),
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
