import { EPISODES, esc } from './helpers.js';

/** 固定三栏工作台；画布节点不会随面板切换而重建。 */
export function mountShell(root, store) {
  root.innerHTML = `
    <header class="topbar"><a class="brand" href="#" aria-label="方寸首页"><span class="brand-mark">方</span><strong>方寸</strong><span class="brand-en">FANGCUN <small>DORM SPACE-TIME OPS</small></span></a>
      <span class="system-label">宿舍时空作战系统 <b> / </b> <span id="current-ep">EP00</span></span>
      <div class="top-status"><span id="ai-status" class="muted">● LOCAL MODE</span><time id="clock"></time><button class="btn compact monitor-toggle" id="monitor-toggle" aria-expanded="false">监视器 ☷</button></div></header>
    <main class="workspace"><aside class="left-rail"><div class="rail-label"><span>MISSION CONTROL</span><span>行动序列 / 00—04</span></div>
      <nav class="episode-nav" aria-label="话导航">${EPISODES.map((ep, i) => `<button data-episode="${ep.id}" aria-label="${ep.no} ${ep.title}"><span>0${i}</span><b>${ep.title}</b></button>`).join('')}</nav>
      <div id="panel" class="panel-host"></div><div class="rail-foot">固定家具不动 · 疏散通道不占 <span>CM / Y↑</span></div></aside>
    <section class="viewport" aria-label="宿舍三维视图"><div id="scene" class="scene"></div>
      <div class="viewport-top"><span><i class="live-dot"></i> SPATIAL OPERATIONS <b>/ LIVE VIEW</b></span><span id="room-code">THU—4P—LOFT</span></div>
      <div class="viewport-title"><span class="micro">SPACE IS LIMITED. POSSIBILITIES ARE NOT.</span><h1>方寸之间<span>自有天地</span></h1><p>不换宿舍，不动家具。找回属于你的空间。</p></div>
      <div id="scene-placeholder" class="scene-placeholder"><div class="crosshair">＋</div><b>3D 模块加载中</b><span>SCENE LINK / STANDBY</span><p>建模参数与任务面板已就绪</p></div>
      <div class="viewport-bottom"><div class="legend"><span style="--c:var(--green)">能放下</span><span style="--c:var(--amber)">需换位置</span><span style="--c:var(--cyan)">尺寸待定</span><span style="--c:var(--red)">冲突 / 滞留</span></div><span class="micro" id="scene-count">0 ITEMS / 0 ZONES</span></div></section>
    <aside class="right-rail" id="monitor" aria-label="系统监视器"><div class="rail-label"><span>SYSTEM MONITOR</span><span>状态监视</span></div><div id="monitor-content"></div><div class="monitor-sign"><span>寸</span><p>向内整理<br>向前生长</p><small>FANGCUN PROJECT / 2026</small></div></aside></main>
    <footer class="bottom-bar"><div class="bottom-code"><span>OPERATION LOG</span><strong id="footer-ep">EP00 / MODELING</strong></div><div id="episode-footer" class="episode-footer"><span class="muted">从丈量一间宿舍开始。</span></div><div class="camera-controls" aria-label="场景视角">${[['orbit', '斜视'], ['top', '俯视'], ['seat', '座位']].map(([mode, label]) => `<button class="btn compact" data-camera="${mode}">${mode.toUpperCase()} <small>${label}</small></button>`).join('')}</div></footer>`;
  const update = s => {
    const ep = EPISODES.find(e => e.id === s.episode);
    root.querySelector('#current-ep').textContent = `${ep.id} ${ep.title}`;
    root.querySelector('#footer-ep').textContent = `${ep.id} / ${ep.en}`;
    root.querySelectorAll('[data-episode]').forEach(b => { b.classList.toggle('active', b.dataset.episode === s.episode); b.setAttribute('aria-current', b.dataset.episode === s.episode ? 'step' : 'false'); });
    root.querySelectorAll('[data-camera]').forEach(b => b.classList.toggle('active', b.dataset.camera === s.camera));
    root.querySelector('#scene-count').textContent = `${s.items.length} ITEMS / ${s.room?.zones.length || 0} ZONES`;
    root.querySelector('#ai-status').textContent = s.ai.busy ? '● PARSING' : s.ai.available ? '● AI ONLINE' : '● LOCAL MODE';
    root.querySelector('#ai-status').className = s.ai.available ? 'green' : 'muted';
  };
  store.subscribe(update, ['episode', 'camera', 'items', 'room', 'ai']);
  update(store.get());
  root.querySelectorAll('[data-camera]').forEach(button => button.onclick = () => store.set({ camera: button.dataset.camera }));
  const toggle = root.querySelector('#monitor-toggle');
  toggle.onclick = () => { const open = root.querySelector('#monitor').classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); };
  const tick = () => { root.querySelector('#clock').textContent = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()); };
  tick(); setInterval(tick, 1000);
  return { panel: root.querySelector('#panel'), scene: root.querySelector('#scene'), monitor: root.querySelector('#monitor-content'), footer: root.querySelector('#episode-footer') };
}

export function panelHeading(ep) {
  return `<div class="mission-heading"><span class="micro">${ep.id} / ${ep.en}</span><div><span>${ep.no}</span><h2>${ep.title}</h2></div><p>${esc(ep.desc)}</p></div>`;
}
