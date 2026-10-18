import { EPISODES, esc } from './helpers.js';

/** 固定三栏工作台；画布节点不会随面板切换而重建。 */
export function mountShell(root, store) {
  root.innerHTML = `
    <header class="topbar"><a class="brand" href="#" aria-label="方寸首页"><span class="brand-mark">方</span><strong>方寸</strong><span class="brand-en">FANGCUN </span></a>
      <span class="system-label">宿舍时空作战系统 <b> / </b> <span id="current-ep">EP00</span></span>
      <div class="top-status"><span id="ai-status" class="muted">● 本地</span><time id="clock"></time><button class="btn compact" id="start-demo">待机演示</button><button class="btn compact monitor-toggle" id="monitor-toggle" aria-expanded="false">监视器 ☷</button></div></header>
    <main class="workspace spatial-console"><aside class="left-rail depth-module depth-module-control"><div class="rail-label"><span>行动序列</span><span>00—04</span></div>
      <nav class="episode-nav" aria-label="话导航">${EPISODES.map((ep, i) => `<button data-episode="${ep.id}" aria-label="${ep.no} ${ep.title}"><span>0${i}</span><b>${ep.title}</b></button>`).join('')}</nav>
      <div id="panel" class="panel-host"></div></aside>
    <section class="viewport depth-module depth-module-scene" aria-label="宿舍三维视图"><div id="scene" class="scene"></div>
      <div class="viewport-top"><span><i class="live-dot"></i> 空间预览</span><span id="room-code"></span></div>
      <div class="viewport-title"><span class="micro" id="hero-kicker">EP00 / RECLAIM YOUR SPACE</span><h1 id="hero-title"><em>空间</em><span>重新定义</span></h1></div>
      <div id="scene-placeholder" class="scene-placeholder"><div id="blueprint-host"></div><div class="blueprint-caption"><i></i><b>空间预览</b></div></div>
      <div class="viewport-bottom"><div class="legend"><span style="--c:var(--green)">能放下</span><span style="--c:var(--amber)">需换位置</span><span style="--c:var(--cyan)">尺寸待定</span><span style="--c:var(--red)">冲突 / 滞留</span></div><span class="micro" id="scene-count">0 ITEMS / 0 ZONES</span></div></section>
    <aside class="right-rail depth-module depth-module-monitor" id="monitor" aria-label="系统监视器"><div class="rail-label"><span>状态监视</span></div><div id="monitor-content"></div></aside></main>
    <footer class="bottom-bar"><div class="bottom-code"><strong id="footer-ep">EP00 / MODELING</strong></div><div id="episode-footer" class="episode-footer"></div><div class="camera-controls" aria-label="场景视角与效果">${[['orbit', '斜视'], ['top', '俯视'], ['seat', '座位']].map(([mode, label]) => `<button class="btn compact" data-camera="${mode}">${label}</button>`).join('')}<button type="button" class="btn compact" id="bloom-toggle" aria-pressed="false" aria-keyshortcuts="B" title="帧率不足时自动关闭">发光</button></div></footer>`;
  const update = s => {
    const ep = EPISODES.find(e => e.id === s.episode);
    const hero = { EP00:['空间','重新定义'], EP01:['入住','一切各就各位'], EP02:['专注','即刻展开'], EP03:['时间','也是空间'], EP04:['生长','留有余地'] }[s.episode];
    root.dataset.episode = s.episode;
    root.querySelector('#hero-title').innerHTML = `<em>${hero[0]}</em><span>${hero[1]}</span>`;
    root.querySelector('#hero-kicker').textContent = `${ep.id} / ${ep.en}`;
    root.querySelector('#current-ep').textContent = `${ep.id} ${ep.title}`;
    root.querySelector('#footer-ep').textContent = `${ep.id} / ${ep.en}`;
    root.querySelectorAll('[data-episode]').forEach(b => { b.classList.toggle('active', b.dataset.episode === s.episode); b.setAttribute('aria-current', b.dataset.episode === s.episode ? 'step' : 'false'); });
    root.querySelectorAll('[data-camera]').forEach(b => b.classList.toggle('active', b.dataset.camera === s.camera));
    const bloomButton = root.querySelector('#bloom-toggle');
    bloomButton.classList.toggle('active', !!s.bloom);
    bloomButton.setAttribute('aria-pressed', String(!!s.bloom));
    root.querySelector('#scene-count').textContent = `${s.items.length} 件 / ${s.room?.zones.length || 0} 分区`;
    const params = s.room?.params || s.roomParams;
    const occupants = params?.occupants?.length || 0;
    const roomLabel = occupants ? `${({ 1: '单', 2: '双', 3: '三', 4: '四' })[occupants] || occupants}人间` : '宿舍';
    root.querySelector('#room-code').textContent = `${roomLabel}${params?.templateId === 'nanqu1' && occupants === 3 ? ' · 三床 + 柜区' : ''}`;
    root.querySelector('#ai-status').textContent = s.ai.busy ? '● 解析中' : s.ai.available ? '● AI 在线' : '● 本地';
    root.querySelector('#ai-status').className = s.ai.available ? 'green' : 'muted';
  };
  store.subscribe(update, ['episode', 'camera', 'bloom', 'items', 'room', 'roomParams', 'ai']);
  update(store.get());
  root.querySelectorAll('[data-camera]').forEach(button => button.onclick = () => store.set({ camera: button.dataset.camera }));
  root.querySelector('#bloom-toggle').onclick = () => store.set({ bloom: !store.get().bloom });
  const toggle = root.querySelector('#monitor-toggle');
  toggle.onclick = () => { const open = root.querySelector('#monitor').classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); };
  const tick = () => { root.querySelector('#clock').textContent = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()); };
  tick(); setInterval(tick, 1000);
  return { panel: root.querySelector('#panel'), scene: root.querySelector('#scene'), sceneFallback: root.querySelector('#blueprint-host'), monitor: root.querySelector('#monitor-content'), footer: root.querySelector('#episode-footer') };
}

export function panelHeading(ep) {
  return `<div class="mission-heading"><span class="micro">${ep.id}</span><div><span>${esc(ep.no)}</span><h2>${esc(ep.title)}</h2></div></div>`;
}
