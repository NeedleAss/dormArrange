import { showTitleCard } from './titleCard.js';

/** 自检文案只显示实际加载情况，等待模块不伪装为在线。 */
export async function boot({ planner, scene, ai }) {
  const overlay = document.createElement('div');
  overlay.className = 'boot-screen';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '方寸系统启动');
  overlay.innerHTML = '<span class="micro">FANGCUN / INITIALIZATION SEQUENCE</span><h2>空间，待命。</h2><pre aria-live="polite"></pre><div class="boot-progress"><i></i></div><button class="btn compact">点击任意处跳过 / SKIP</button>';
  document.body.append(overlay);
  const lines = [
    'FANGCUN SYSTEM BOOT ................ START',
    `DORM TEMPLATE ..................... ${planner ? 'LOADED' : 'STANDBY'}`,
    'FIXED FURNITURE .................... LOCKED',
    'DIMENSION UNIT .................... CM / Y+',
    `PLANNER PUBLIC API ................ ${planner ? 'LINKED' : 'STANDBY'}`,
    `SPATIAL RENDERER .................. ${scene ? 'LINKED' : 'STANDBY'}`,
    `IMPORT CHANNEL .................... ${ai ? 'LINKED' : 'LOCAL'}`,
    'SYNC RATIO ........................ AWAITING PLAN',
    'ONE ROOM. MORE POSSIBILITIES. ...... READY'
  ];
  await new Promise(resolve => {
    let i = 0;
    let timer;
    const done = () => { clearInterval(timer); overlay.remove(); document.removeEventListener('keydown', done); resolve(); };
    overlay.onclick = done; document.addEventListener('keydown', done, { once: true });
    timer = setInterval(() => {
      if (i < lines.length) { overlay.querySelector('pre').textContent += `${lines[i]}\n`; overlay.querySelector('i').style.width = `${++i / lines.length * 100}%`; }
      else done();
    }, 250);
  });
  await showTitleCard({ no: '序', title: '方寸', en: 'FANGCUN // DORM SPACE-TIME OPS' });
}
