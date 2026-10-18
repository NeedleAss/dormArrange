import { createScene } from './index.js';
import { MOCK } from './__mock__.js';

// 测试台是唯一允许动态接入 planner 的场景文件；生产模块只依赖 three。
const $ = (id) => document.getElementById(id);
const copy = (value) => structuredClone(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const visualStates = ['fits', 'relocate', 'uncertain', 'overflow', 'banned', 'conflict', 'moved', 'stored'];
let room;
let items = [];
let placements = {};
let selected = null;
let scene;
let playback = null;
let activeSteps = [];
let toleranceId = null;
let stateOffset = 0;
let zoneOffset = 0;
let bloom = false;
let dataset = copy(MOCK);
let dataSource = 'MOCK';
let planner = null;

function report(message) { $('message').textContent = message; }
function recordError(error) {
  const message = error?.message || String(error);
  errors.push(message);
  $('errors').textContent = `错误：${errors.length}`;
  report(`错误：${message}`);
}
window.addEventListener('error', (event) => recordError(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => recordError(event.reason));

function makeScene() {
  scene = createScene($('scene'), {
    onSelect(id) { selected = id; $('selection').textContent = `选择：${id ?? '无'}`; },
    onHover(id) { $('hover').textContent = `悬停：${id ?? '无'}`; },
  });
}

/** 优先采用 B 车道公开接口；空预设及导入失败都回到文档示例。 */
async function readSource() {
  dataset = copy(MOCK);
  dataSource = 'MOCK · docs/04 §8';
  if ($('source').value === 'planner') {
    try {
      planner = await import('../planner/index.js');
      const actualRoom = planner.buildRoom();
      if (!actualRoom?.bounds || !Array.isArray(actualRoom.zones)) throw new Error('buildRoom 尚未返回 Room');
      dataset.room = actualRoom;
      dataSource = 'planner.buildRoom + 契约示例物品';
      const preset = planner.PRESETS?.messyDesk;
      if (preset?.items?.length && preset.placements) {
        dataset.items = copy(preset.items);
        dataset.placements = copy(preset.placements);
        dataSource = 'planner.buildRoom + PRESETS.messyDesk';
      }
    } catch (error) {
      dataSource = `MOCK 回退 · ${error.message}`;
    }
  }
  $('source-label').textContent = dataSource;
}

async function loadRoom() {
  playback?.stop();
  playback = null;
  await readSource();
  room = copy(dataset.room);
  scene.setRoom(room);
  report(`${dataSource} / ${room.fixtures.length} 家具 / ${room.zones.length} 分区`);
}

async function loadItems() {
  if (!room) await loadRoom();
  else await readSource();
  playback?.stop();
  items = copy(dataset.items);
  placements = copy(dataset.placements);
  scene.setItems(items, placements, { animate: true, overflowIds: items.filter((item) => !placements[item.id]).map((item) => item.id) });
  scene.setItemStates(Object.fromEntries(items.map((item) => [item.id, placements[item.id] ? 'fits' : 'overflow'])));
  report(`加载 ${items.length} 件物品；${items.filter((item) => !placements[item.id]).length} 件进入滞留区`);
}

function desk() { return room?.zones.find((zone) => zone.id === `${$('owner').value}.desk`) ?? room?.zones.find((zone) => zone.slot === 'desk'); }
function targetItem() { return items.find((item) => item.id === selected) ?? items[0]; }
function focusBox() {
  const zone = desk();
  return zone ? { ...zone.box, h: Math.min(45, zone.box.h) } : null;
}

function makeForty() {
  const base = MOCK.items[1];
  const bounds = room.bounds;
  items = Array.from({ length: 40 }, (_, i) => ({ ...copy(base), id: `stress-${i + 1}`, name: `压力测试 ${i + 1}`, category: ['books', 'food', 'electronics', 'storage'][i % 4], size: { w: 16, d: 18, h: 16 } }));
  placements = Object.fromEntries(items.slice(0, 36).map((item, i) => [item.id, { ...copy(MOCK.placements['it-002']), itemId: item.id, zoneId: desk()?.id ?? 'test', box: { x: bounds.x + 65 + (i % 6) * 32, y: 0, z: bounds.z + 20 + Math.floor(i / 6) * 38, w: 16, d: 18, h: 16 } }]));
  scene.setItems(items, placements, { overflowIds: items.slice(36).reverse().map((item) => item.id) });
  report('40 件物品已加载；末 4 件反序进入滞留区，可旋转 / 缩放检查流畅度');
}

function cycleStates() {
  const map = Object.fromEntries(items.map((item, i) => [item.id, visualStates[(i + stateOffset) % visualStates.length]]));
  scene.setItemStates(map);
  stateOffset++;
  report(`状态已轮换：${Object.entries(map).slice(0, 4).map(([id, state]) => `${id}=${state}`).join(' / ')}`);
}

function zoneStates() {
  const states = ['empty', 'designing', 'done'];
  scene.setZoneStatus(Object.fromEntries(room.zones.map((zone, i) => [zone.id, states[(i + zoneOffset) % 3]])));
  zoneOffset++;
  report('分区已显示：暗虚线 / 橙色闪烁 / 绿色 LOCKED；再次点击轮换');
}

function showTolerance() {
  const item = targetItem();
  if (!item) return report('请先加载物品');
  const box = placements[item.id]?.box ?? { x: room.bounds.x, y: 0, z: -100, ...item.size };
  if (toleranceId && toleranceId !== item.id) scene.showTolerance(toleranceId, null);
  toleranceId = item.id;
  scene.showTolerance(item.id, { ...box, w: box.w + 12, d: box.d + 12, h: box.h + 10 });
  report(`${item.name}：绿色虚线容差盒，W/D +12 cm，H +10 cm`);
}

function exampleSteps() {
  const entries = items.filter((item) => placements[item.id]).slice(0, 3);
  const destination = room.zones.find((zone) => zone.slot === 'underDesk')?.box ?? room.bounds;
  return entries.map((item, idx) => {
    const from = copy(placements[item.id].box);
    const to = idx === entries.length - 1 && entries.length > 1 ? null : { ...from, x: destination.x + idx * 5, y: destination.y, z: destination.z + idx * 10 };
    return { idx, itemId: item.id, itemName: item.name, kind: to ? 'move' : 'dispose', fromZoneId: placements[item.id].zoneId, toZoneId: to ? room.zones.find((zone) => zone.slot === 'underDesk')?.id ?? 'test' : null, from, to, distance: to ? Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) : 0, text: `${idx + 1}. ${item.name}${to ? '移到桌下' : '缩小淡出'}` };
  });
}

function playExample(stepMs = 900) {
  playback?.stop();
  scene.setItems(items, placements, { animate: false });
  activeSteps = exampleSteps();
  if (!activeSteps.length) return report('没有可播放物品，请先加载物品');
  scene.showFocusField(focusBox());
  scene.setFocusFieldState('conflict');
  scene.setItemStates(Object.fromEntries(activeSteps.map((step) => [step.itemId, 'conflict'])));
  $('step-index').max = String(activeSteps.length - 1);
  playback = scene.playSteps(activeSteps, { stepMs, onStep(i) { report(`步骤 ${i + 1}/${activeSteps.length}：${activeSteps[i].text}`); }, onDone() { scene.setFocusFieldState('clear'); report('全部步骤播放完成 / FIELD CLEAR'); } });
  return playback;
}

/** 可由浏览器控制台 / 自动化直接调用；验收只使用公开 API。 */
export async function runChecks() {
  const methods = ['setRoom', 'setZoneStatus', 'setItems', 'setItemStates', 'showTolerance', 'showFocusField', 'setFocusFieldState', 'playSteps', 'setCamera', 'focusOn', 'setBloom', 'snapshot', 'dispose'];
  const missing = methods.filter((name) => typeof scene[name] !== 'function');
  if (missing.length) throw new Error(`缺少 Scene API：${missing.join(', ')}`);
  const startErrors = errors.length;
  await loadRoom();
  await loadItems();
  cycleStates(); zoneStates();
  scene.showFocusField(focusBox()); scene.setFocusFieldState('conflict');
  showTolerance();
  for (const mode of ['orbit', 'top', 'seat']) { scene.setCamera(mode, { owner: $('owner').value }); await sleep(25); }
  if (items[0]) scene.focusOn(items[0].id);
  if (desk()) scene.focusOn(desk().id);
  const controller = playExample(30);
  if (controller) {
    for (const name of ['pause', 'resume', 'seek', 'stop']) if (typeof controller[name] !== 'function') throw new Error(`playSteps 缺少 ${name}`);
    controller.pause(); controller.resume(); controller.seek(0); controller.stop();
  }
  scene.setBloom(true); scene.setBloom(false);
  const capture = scene.snapshot();
  if (capture != null && typeof capture !== 'string') throw new Error('snapshot 必须返回 dataURL 或未实现的空值');
  scene.setFocusFieldState('clear'); await sleep(50);
  scene.showFocusField(null);
  if (toleranceId) scene.showTolerance(toleranceId, null);
  scene.setZoneStatus({});
  scene.setItems(items, placements, { animate: false });
  scene.setCamera('orbit', { owner: 'A' });
  if (errors.length !== startErrors) throw new Error('验收期间出现浏览器错误，见错误计数');
  const result = { ok: true, methods: methods.length, source: dataSource, items: items.length, fixtures: room.fixtures.length, zones: room.zones.length, errors: errors.length };
  report(`API 验收通过：${methods.length} 个方法 / ${items.length} 物品 / 浏览器错误 ${errors.length}。视觉验收仍需逐按钮检查。`);
  return result;
}

const actions = {
  room: loadRoom, items: loadItems, forty: makeForty, states: cycleStates, zones: zoneStates,
  zonesOff() { scene.setZoneStatus({}); report('分区状态已清除'); },
  move() {
    placements = Object.fromEntries(Object.entries(placements).map(([id, placement]) => [id, { ...placement, box: { ...placement.box, x: placement.box.x + 20, h: placement.box.h + 3 } }]));
    scene.setItems(items, placements, { animate: true }); report('已触发 600 ms 位置与尺寸补间');
  },
  remove() { const item = items.at(-1); items = items.slice(0, -1); if (item) delete placements[item.id]; scene.setItems(items, placements); report(`删除 ${item?.name ?? '无物品'}，检查淡出`); },
  field() { scene.showFocusField(focusBox()); scene.setFocusFieldState('conflict'); report('红橙专注力场已展开，检查六边形顶面与呼吸描边'); },
  clear() { scene.setFocusFieldState('clear'); report('力场净空：绿色 + FIELD CLEAR / 净空'); },
  fieldOff() { scene.showFocusField(null); report('力场已清除'); },
  tolerance: showTolerance, toleranceOff() { if (toleranceId) scene.showTolerance(toleranceId, null); report('容差盒已清除'); },
  play: () => playExample(), pause() { playback?.pause(); report('步骤已暂停'); }, resume() { playback?.resume(); report('步骤继续播放'); },
  seek() { const i = Math.max(0, Math.min(Number($('step-index').value) || 0, activeSteps.length - 1)); playback?.seek(i); report(`已跳到第 ${i + 1} 步完成后的状态`); },
  stop() { playback?.stop(); report('步骤播放已停止'); },
  orbit() { scene.setCamera('orbit', { owner: $('owner').value }); report('斜俯视 / 700 ms'); },
  top() { scene.setCamera('top', { owner: $('owner').value }); report('正交俯视蓝图 / 700 ms'); },
  seat() { scene.setCamera('seat', { owner: $('owner').value }); report(`${$('owner').value} 座位 / 眼高 115 cm / 桌前 45 cm`); },
  focus() { const item = targetItem(); if (item) scene.focusOn(item.id); report(`聚焦 ${item?.name ?? '无物品'}`); },
  focusZone() { const zone = desk(); if (zone) scene.focusOn(zone.id); report(`聚焦 ${zone?.label ?? '无书桌分区'}`); },
  bloom() { bloom = !bloom; scene.setBloom(bloom); report(`Bloom ${bloom ? '开启' : '关闭'}（加分项）`); },
  snapshot() {
    const data = scene.snapshot();
    if (!data) return report('snapshot 暂未实现（加分项）');
    $('snapshot-preview').querySelector('img').src = data; $('snapshot-preview').showModal(); report('截图已显示');
  },
  checks: runChecks,
  async recreate() { playback?.stop(); scene.dispose(); makeScene(); selected = null; toleranceId = null; $('selection').textContent = '选择：无'; await loadRoom(); await loadItems(); report('旧场景已释放，新场景已重建；检查画布 / 标签层数量不增长'); },
};

document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => { try { await actions[button.dataset.action](); } catch (error) { recordError(error); } }));
$('source').addEventListener('change', async () => { try { await loadRoom(); await loadItems(); } catch (error) { recordError(error); } });
window.__sceneDev = {
  get scene() { return scene; }, get room() { return room; }, get items() { return items; }, get placements() { return placements; },
  get errors() { return [...errors]; }, get steps() { return activeSteps; }, get playback() { return playback; }, get source() { return dataSource; },
  get planner() { return planner; }, actions, runChecks, MOCK,
};

try { makeScene(); await loadRoom(); await loadItems(); } catch (error) { recordError(error); }
