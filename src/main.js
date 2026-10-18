import '@fontsource/noto-serif-sc/900.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/share-tech-mono/400.css';
import './styles/tokens.css';
import './styles/eva.css';
import './styles/expressive.css';
import { createStore, createInitialState } from './core/store.js';
import { mountShell, panelHeading } from './ui/shell.js';
import { bindScene } from './ui/sceneBinder.js';
import { EPISODES } from './ui/helpers.js';
import { boot } from './ui/boot.js';
import { showTitleCard, dismissTitleCard } from './ui/titleCard.js';
import * as modelPanel from './ui/panels/ep00Model.js';
import * as moveInPanel from './ui/panels/ep01MoveIn.js';
import * as focusPanel from './ui/panels/ep02Focus.js';
import * as seasonsPanel from './ui/panels/ep03Seasons.js';
import * as growthPanel from './ui/panels/ep04Growth.js';
import { mountMonitor } from './ui/widgets/monitor.js';
import { createFocusTimer } from './ui/widgets/focusTimer.js';
import { createIdleDemo } from './ui/idleDemo.js';
import { installErrorBoundary } from './ui/errorBoundary.js';
import { migrateLayout } from './ui/layoutMigration.js';
import './styles/spatial.css';
import './styles/monitorDock.css';
import './styles/typography.css';
import './styles/errorBoundary.css';

// 在启动链开始前安装兜底，之后连接警报仓库；已有面板始终保留。
const boundary = installErrorBoundary(document.querySelector('#app'));

// glob 只收集已存在的公开入口，缺席车道不会触发浏览器 404 或构建失败。
const loaders = import.meta.glob(['./planner/index.js', './scene/index.js', './ai/index.js']);
async function load(path) { try { return await loaders[path]?.(); } catch { return null; } }
async function main() {
const planner = await load('./planner/index.js');
const store = createStore(createInitialState(planner));
let startupNotices = [];
try {
  if (planner && store.get().roomParams) {
    const { patch, notices } = migrateLayout(planner, store.get());
    startupNotices = notices;
    store.set({ ...patch, ...(patch.sync ? { syncHistory: [{ t: new Date().toISOString(), total: patch.sync.total, label: '存档复核' }] } : {}) });
  }
} catch {
  // 参数损坏时只重建可用外壳，原物品、锁区、时长和历史快照仍保留供人工核对。
  const room = planner?.buildRoom?.();
  store.set({ room, roomParams: room?.params || null, placements: {}, fitReport: null, sync: null,
    movePlan: null, stepIndex: 0, tdmPlan: null, selection: null });
  startupNotices = ['旧存档暂时无法完整复核，物品和历史快照已保留，请检查房型与尺寸后重新规划。'];
}
const shell = mountShell(document.querySelector('#app'), store);
const alert = (text, level = 'info') => store.set({ alerts: [{ id: crypto.randomUUID(), level, text, t: new Date().toISOString() }, ...store.get().alerts].slice(0, 6) });
boundary.connectAlert(alert);
if (startupNotices.length) alert(startupNotices.join('；'), 'warning');
let scene = null;
const sceneModule = await load('./scene/index.js');
try {
  if (sceneModule?.createScene) {
    scene = sceneModule.createScene(shell.scene, { onSelect: id => store.set({ selection: id }) });
    document.querySelector('#scene-placeholder').hidden = true;
  }
} catch { document.querySelector('#scene-placeholder b').textContent = '需要支持 WebGL 的浏览器'; alert('三维视图暂不可用，仍可编辑清单与尺寸。', 'warning'); }
let ctx = null;
bindScene(store, scene, shell.sceneFallback, { onFailure: () => { scene = null; if (ctx) ctx.scene = null; } });
const ai = await load('./ai/index.js');
if (ai?.aiAvailable) ai.aiAvailable().then(available => store.set({ ai: { ...store.get().ai, available } })).catch(() => {});
ctx = { store, scene, planner, ai, alert, footer: shell.footer, showTitleCard, dismissTitleCard };
const focusTimer = createFocusTimer(ctx);
ctx.startFocus = focusTimer.start;
let navigating = false;
async function navigate(id, { isCurrent = () => true } = {}) {
  if (navigating || id === store.get().episode) return;
  navigating = true;
  try {
    const ep = EPISODES.find(e => e.id === id);
    await showTitleCard({ ...ep, en: `EPISODE ${id.slice(-2)} // ${ep.en}` });
    if (isCurrent()) store.set({ episode: id });
  } finally { navigating = false; }
}
let activePanel = null;
const panels = { EP00: modelPanel, EP01: moveInPanel, EP02: focusPanel, EP03: seasonsPanel, EP04: growthPanel };
function render() {
  activePanel?.unmount();
  const ep = EPISODES.find(e => e.id === store.get().episode);
  shell.panel.innerHTML = panelHeading(ep) + '<div id="episode-panel" class="module-surface"></div>';
  shell.footer.innerHTML = '';
  activePanel = panels[ep.id];
  activePanel?.mount(shell.panel.querySelector('#episode-panel'), ctx);
  // 切话回到顶部，避免沿用上一话操作后留下的滚动位置。
  shell.panel.scrollTop = 0;
}
document.querySelectorAll('[data-episode]').forEach(b => b.onclick = () => navigate(b.dataset.episode));
document.addEventListener('keydown', event => {
  if (event.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('.title-card,.boot-screen,.focus-limit')) return;
  if (event.key.toLowerCase() === 'b' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    store.set({ bloom: !store.get().bloom });
  }
  if (/^[0-4]$/.test(event.key)) navigate(`EP0${event.key}`);
  if (event.key.toLowerCase() === 't') {
    const modes = ['orbit', 'top', 'seat'];
    store.set({ camera: modes[(modes.indexOf(store.get().camera) + 1) % modes.length] });
  }
  if (event.key.toLowerCase() === 'l') {
    const s = store.get(); const zone = s.room?.zones.find(z => z.id === s.selection);
    if (zone && zone.kind !== 'keepClear') store.set({ lockedZones: s.lockedZones.includes(zone.id) ? s.lockedZones.filter(id => id !== zone.id) : [...s.lockedZones, zone.id], movePlan: null });
  }
  if (event.code === 'Space' && !event.target.closest('button,summary,a') && ['EP03', 'EP04'].includes(store.get().episode)) {
    event.preventDefault();
    shell.panel.querySelector(store.get().episode === 'EP03' ? '[data-season-play]' : '[data-growth-replay]')?.click();
  }
});
store.subscribe(render, ['episode']); render();
mountMonitor(shell.monitor, ctx);
if (!planner) alert('规划模块加载中。');
await boot({ planner, scene, ai });
ctx.navigate = navigate;
ctx.refreshPanel = render;
createIdleDemo(ctx, { idleMs: 300000 });
}
main().catch(error => {
  // 启动动画失败时撤下临时遮罩，已挂载的文字面板仍可操作。
  document.querySelectorAll('.boot-screen,.title-card').forEach(el => el.remove());
  boundary.failStartup(error);
});
