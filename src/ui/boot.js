import { showTitleCard } from './titleCard.js';
import { esc } from './helpers.js';
import '../styles/cinematics.css';

/**
 * 以五个实际检查节点呈现启动阶段；模块加载与联网可用性分开表达。
 * @param {{planner?: object|null, scene?: object|null, ai?: object|null}} modules
 * @returns {Promise<void>} 开机与序章标题卡结束后完成。
 */
export async function boot({ planner, scene, ai }) {
  const plannerReady = typeof planner?.planMoveIn === 'function';
  const sceneReady = typeof scene?.setRoom === 'function';
  const importReady = typeof ai?.aiParseItems === 'function' || typeof planner?.parseItemsText === 'function';
  const rows = [
    { code: 'PLAN', label: '规划接口', value: plannerReady ? 'LINKED' : 'STANDBY', ready: plannerReady },
    { code: 'SCENE', label: '空间场景', value: sceneReady ? 'LINKED' : 'STANDBY', ready: sceneReady },
    { code: 'INPUT', label: '清单导入', value: typeof ai?.aiParseItems === 'function' ? 'MODULE LINKED' : importReady ? 'LOCAL PARSER' : 'STANDBY', ready: importReady },
    { code: 'UNIT', label: '尺寸坐标', value: 'CM / Y+', ready: true, info: true },
    { code: 'SYNC', label: '空间评估', value: 'AWAITING PLAN', ready: false, info: true }
  ];
  const overlay = document.createElement('div');
  overlay.className = 'boot-screen cinematic-boot';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '方寸系统启动');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="boot-hero"><span class="boot-system">FANGCUN / DORM SPACE-TIME OPS</span><h2>方寸<span>空间，待命。</span></h2><div class="boot-motto">MAKE ROOM.<br><span>MAKE IT YOURS.</span></div><p>一间宿舍。<br>重新安排生活的余地。</p></div>
    <section class="boot-console" aria-label="模块启动检查"><div class="boot-console-head"><span>INITIALIZATION / MODULE LINKS</span><b>启动检查</b></div>
      <ol class="boot-check-list" aria-live="polite">${rows.map((row, index) => `<li data-boot-row="${index}" class="${row.info ? 'info' : row.ready ? 'linked' : 'standby'}"><span class="boot-check-index">${String(index + 1).padStart(2, '0')}</span><span class="boot-check-label">${row.code}<small>${row.label}</small></span><strong>${row.value}</strong></li>`).join('')}</ol>
      <div class="boot-module-map" aria-hidden="true"><svg viewBox="0 0 460 156"><path class="boot-map-axis" d="M20 24v108M20 78h420"/>${rows.slice(0, 3).map((row, index) => {
        const y = 28 + index * 49;
        return `<g class="boot-link ${row.ready ? 'linked' : 'standby'}" data-boot-link="${index}"><path class="boot-route" d="M20 ${y}h${88 + index * 25}l28 ${index === 1 ? 0 : index ? -18 : 18}h${132 - index * 25}l25 ${index === 1 ? 0 : index ? 18 : -18}h55"/><rect x="350" y="${y - 6}" width="12" height="12"/><text x="378" y="${y + 4}">${esc(row.code)}</text></g>`;
      }).join('')}</svg><span>模块连线图 / 启动阶段</span></div>
      <div class="boot-progress" role="progressbar" aria-label="启动检查进度" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0"><i></i></div><div class="boot-check-count">CHECKS <span>0 / 5</span></div>
      <p class="boot-module-note">连线表示模块已加载；联网导入能力进入界面后检测。</p>
    </section><div class="boot-bottom"><span>CM / Y↑ <i>空间有限，安排由你。</i></span><button class="btn compact">点击或按任意键跳过 <b>↗</b></button></div>`;
  document.body.append(overlay);
  await new Promise(resolve => {
    let checked = 0;
    let timer;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      overlay.removeEventListener('click', skip);
      document.removeEventListener('keydown', skip, true);
      overlay.remove();
      resolve();
    };
    const skip = event => { event.preventDefault(); event.stopPropagation(); done(); };
    const reveal = () => {
      if (finished) return;
      overlay.querySelector(`[data-boot-row="${checked}"]`).dataset.checked = 'true';
      const link = overlay.querySelector(`[data-boot-link="${checked}"]`);
      if (link) link.dataset.checked = 'true';
      checked++;
      overlay.querySelector('.boot-progress i').style.width = `${checked / rows.length * 100}%`;
      overlay.querySelector('.boot-progress').setAttribute('aria-valuenow', String(checked));
      overlay.querySelector('.boot-check-count span').textContent = `${checked} / ${rows.length}`;
    };
    overlay.addEventListener('click', skip);
    document.addEventListener('keydown', skip, true);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rows.forEach(reveal);
      timer = setTimeout(done, 350);
    } else {
      const next = () => {
        reveal();
        timer = setTimeout(checked < rows.length ? next : done, checked < rows.length ? 180 : 280);
      };
      next();
    }
  });
  await showTitleCard({ no: '序', title: '方寸', en: 'FANGCUN // DORM SPACE-TIME OPS' });
}
