import '@fontsource/noto-serif-sc/900.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/share-tech-mono/400.css';
import './styles/tokens.css';
import './styles/eva.css';
import { createStore, createInitialState } from './core/store.js';
import { mountShell, panelHeading } from './ui/shell.js';
import { bindScene } from './ui/sceneBinder.js';
import { EPISODES } from './ui/helpers.js';

// glob 只收集已存在的公开入口，缺席车道不会触发浏览器 404 或构建失败。
const loaders = import.meta.glob(['./planner/index.js', './scene/index.js', './ai/index.js']);
async function load(path) { try { return await loaders[path]?.(); } catch { return null; } }
async function main() {
const planner = await load('./planner/index.js');
const store = createStore(createInitialState(planner));
try { if (planner && store.get().roomParams) store.set({ room: planner.buildRoom(store.get().roomParams) }); } catch { /* 无效持久化参数回到初始模板。 */ store.set(createInitialState(planner)); }
const shell = mountShell(document.querySelector('#app'), store);
const alert = (text, level = 'info') => store.set({ alerts: [{ id: crypto.randomUUID(), level, text, t: new Date().toISOString() }, ...store.get().alerts].slice(0, 6) });
let scene = null;
const sceneModule = await load('./scene/index.js');
try {
  if (sceneModule?.createScene) {
    scene = sceneModule.createScene(shell.scene, { onSelect: id => store.set({ selection: id }) });
    document.querySelector('#scene-placeholder').hidden = true;
  }
} catch { document.querySelector('#scene-placeholder b').textContent = '需要支持 WebGL 的浏览器'; alert('三维视图暂不可用，仍可编辑清单与尺寸。', 'warning'); }
bindScene(store, scene);
const ai = await load('./ai/index.js');
if (ai?.aiAvailable) ai.aiAvailable().then(available => store.set({ ai: { ...store.get().ai, available } })).catch(() => {});
const ctx = { store, scene, planner, ai, alert, footer: shell.footer };
function render() {
  const ep = EPISODES.find(e => e.id === store.get().episode);
  shell.panel.innerHTML = panelHeading(ep) + '<div class="panel"><div class="panel-head">SYSTEM READY <b>任务准备</b></div><div class="panel-body"><p>空间蓝图已载入。</p><p class="hint">正在接入本话操作面板。</p></div></div>';
}
document.querySelectorAll('[data-episode]').forEach(b => b.onclick = () => store.set({ episode: b.dataset.episode }));
store.subscribe(render, ['episode']); render();
shell.monitor.innerHTML = '<section class="panel"><div class="panel-head">SYNC RATIO <b>同步率</b></div><div class="panel-body"><span class="mono" style="font-size:64px;color:var(--muted)">—</span><p class="hint">完成规划后，生成真实空间评估。</p></div></section><section class="panel"><div class="panel-head">TRIBUNAL <b>三审决议</b></div><div class="panel-body muted">时 / 空 / 心 · 等待首次规划</div></section>';
alert(planner ? '宿舍模板已载入，尺寸单位 cm。' : '规划模块加载中。');
}
main();
