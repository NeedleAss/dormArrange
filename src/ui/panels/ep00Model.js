import { esc, clone, pct } from '../helpers.js';
// 实测标记只跟随本次校准参数，不能带到另一个房型或重载的示例里。
const measurements = new WeakMap();
let cleanup = () => {};
const templates = [
  ['thu-4p-loft', '紫荆', '金属杆架 · 直梯'],
  ['nanqu', '南区', '木质高侧板 · 储物梯'],
  ['nanqu1', '南区新装修', '圆角侧板 · 白色直梯']
];
const groups = [
  ['房间', [['room.w', '净宽'], ['room.d', '进深'], ['room.h', '净高'], ['wallT', '墙厚']]],
  ['门与阳台', [['door.x', '门起点'], ['door.w', '门宽'], ['door.h', '门高'], ['balcony.d', '阳台进深'], ['balcony.doorX', '阳台门起点'], ['balcony.doorW', '阳台门宽']]],
  ['组合床单元', [['unit.len', '单元长'], ['unit.depth', '单元深'], ['unit.startZ', '离门距离'], ['unit.deskLen', '桌长'], ['unit.deskDepth', '桌深'], ['unit.deskH', '桌高'], ['unit.wardrobeLen', '柜长'], ['unit.wardrobeDepth', '柜深'], ['unit.wardrobeH', '柜高'], ['unit.rodY', '挂杆高'], ['unit.hutchDepth', '书架深'], ['unit.hutchY', '层板高'], ['unit.hutchH', '书架净高'], ['unit.bedY', '床面高'], ['unit.bedThick', '床板厚'], ['unit.bedLen', '床长'], ['unit.bedW', '床宽'], ['unit.bedFootLen', '床尾长'], ['unit.railH', '护栏高'], ['unit.underDeskSideLen', '桌侧净长'], ['unit.underDeskBackDepth', '桌后净深'], ['unit.underDeskH', '桌下净高'], ['unit.chairDepth', '座椅进深']]]
];
const valueAt = (obj, path) => path.split('.').reduce((o, key) => o?.[key], obj);
function writeAt(obj, path, value) { const keys = path.split('.'); const last = keys.pop(); keys.reduce((o, key) => o[key], obj)[last] = value; }
const occupantsOf = s => {
  const occupants = s.room?.params?.occupants || s.roomParams?.occupants;
  return Array.isArray(occupants) && occupants.length ? occupants : ['A', 'B', 'C', 'D'];
};

export function mount(el, ctx) {
  cleanup(); cleanup = () => {};
  const { store, planner } = ctx;
  const params = store.get().room?.params || store.get().roomParams;
  if (!planner || !params) { el.innerHTML = '<p class="empty">规划模块加载中</p>'; return; }
  const occupants = occupantsOf(store.get());
  if (!occupants.includes(store.get().owner)) {
    const owner = occupants[0];
    store.set({ owner, focusSpec: { ...store.get().focusSpec, zoneId: `${owner}.desk` }, movePlan: null, stepIndex: 0, selection: null });
  }
  const measured = measurements.get(store.get().roomParams) || new Set();
  el.innerHTML = `<div class="section-title">第一步 · 选择宿舍</div>
    <div class="focus-presets" role="group" aria-label="宿舍房型">${templates.map(([id, name, description]) => `<button type="button" class="btn" data-template="${id}" aria-pressed="${params.templateId === id}"><span>${name}</span><small>${description}</small></button>`).join('')}</div>
    <p class="hint" id="template-summary"></p><p class="hint">三种房型尺寸均为估计，请按实际宿舍校准。切换后保留物品清单，清除旧布局并重新规划。</p>
    <div class="section-title">第二步 · 校准尺寸</div>
    <label class="owner-select">我是谁 <select id="owner">${occupants.map(o => `<option ${o === store.get().owner ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
    ${groups.map(([title, fields], i) => `<details ${i === 0 ? 'open' : ''}><summary>${title}</summary><div class="field-grid">${fields.map(([path,label]) => `<label>${label}<span class="source" data-source="${path}">${measured.has(path) || params.sizeSource === 'measured' ? '实测' : '估'}</span><input type="number" min="${path.endsWith('.x') || path === 'unit.startZ' ? 0 : 1}" max="3000" step="1" value="${valueAt(params,path)}" data-param="${path}" aria-label="${label} cm"></label>`).join('')}</div>${i === 1 ? `<label class="hint"><input id="balcony" type="checkbox" ${params.balcony.enabled ? 'checked' : ''}> 有阳台</label>` : ''}</details>`).join('')}
    <details><summary>数地砖</summary><div class="field-grid"><label>块数<input id="tile-count" type="number" min="0.1" step="0.5" value="5.5"></label><label>砖长 cm<input id="tile-size" type="number" min="1" step="10" value="60" list="tile-sizes"></label><label>合计 cm<output id="tile-result" class="tile-result mono">330</output></label></div><datalist id="tile-sizes"><option value="60"><option value="80"></datalist><div class="button-row"><select id="tile-target" aria-label="填入尺寸"><option value="room.w">房间净宽</option><option value="room.d">房间进深</option><option value="balcony.d">阳台进深</option><option value="unit.deskLen">桌长</option></select><button class="btn compact" id="tile-apply">填入</button></div></details>
    <div class="section-title">分区状态</div><p class="hint">点名称定位；锁定后不再调整。</p><div id="zone-list"></div>`;
  function rebuild(path, value) {
    const next = clone(store.get().room?.params || store.get().roomParams);
    writeAt(next, path, value);
    try {
      const room = planner.buildRoom(next);
      if (room.zones.some(z => Object.values(z.box).some(n => !Number.isFinite(n)) || z.box.w < 0 || z.box.d < 0 || z.box.h < 0)) throw new Error('invalid');
      if (next.room.w < next.unit.depth * 2 + 70 || room.fixtures.some(f => f.box.x < 0 || f.box.z < 0 || f.box.y < 0 || f.box.x + f.box.w > room.bounds.w || f.box.z + f.box.d > room.bounds.d || f.box.y + f.box.h > room.bounds.h)) throw new Error('invalid');
      const roomParams = clone(room.params);
      const nextMeasurements = new Set(measurements.get(store.get().roomParams) || []);
      if (path !== 'balcony.enabled') nextMeasurements.add(path);
      measurements.set(roomParams, nextMeasurements);
      store.set({ roomParams, room, placements: {}, itemStates: {}, fitReport: null, movePlan: null, stepIndex: 0, tdmPlan: null, sync: null, selection: null });
    } catch { ctx.alert('这组尺寸无法组成有效宿舍，请检查净高、单元长度和房间尺寸。', 'error'); const input = el.querySelector(`[data-param="${path}"]`); if (input) input.value = valueAt(store.get().room?.params || store.get().roomParams, path); }
  }
  el.querySelectorAll('[data-template]').forEach(button => button.onclick = () => {
    if (button.dataset.template === (store.get().room?.params || store.get().roomParams)?.templateId) return;
    try {
      // 只传房型 id，让 B 的新基底提供全部尺寸，避免旧校准值覆盖新模板。
      const room = planner.buildRoom({ templateId: button.dataset.template });
      const nextOccupants = occupantsOf({ room });
      const owner = nextOccupants.includes(store.get().owner) ? store.get().owner : nextOccupants[0];
      store.set({ room, roomParams: clone(room.params), owner, placements: {}, itemStates: {}, fitReport: null,
        movePlan: null, tdmPlan: null, stepIndex: 0, selection: null, lockedZones: [], zoneStatus: {},
        sync: null, syncHistory: [], focusSpec: { zoneId: `${owner}.desk`, w: 75, d: 35 } });
      ctx.alert(`已切换为${templates.find(([id]) => id === room.params.templateId)[1]}，尺寸均为估计；请校准后重新规划。`);
    } catch { ctx.alert('房型暂时无法载入，请稍后重试。', 'error'); }
  });
  el.querySelectorAll('[data-param]').forEach(input => input.onchange = () => { if (input.checkValidity() && Number(input.value) > 0) rebuild(input.dataset.param, Number(input.value)); else if (input.checkValidity() && Number(input.value) === 0 && Number(input.min) === 0) rebuild(input.dataset.param, 0); else input.reportValidity(); });
  el.querySelector('#owner').onchange = event => {
    const currentOccupants = occupantsOf(store.get());
    const owner = currentOccupants.includes(event.target.value) ? event.target.value : currentOccupants[0];
    store.set({ owner, focusSpec: { ...store.get().focusSpec, zoneId: `${owner}.desk` }, movePlan: null });
  };
  el.querySelector('#balcony').onchange = event => rebuild('balcony.enabled', event.target.checked);
  const tileResult = () => { el.querySelector('#tile-result').value = Number(el.querySelector('#tile-count').value) * Number(el.querySelector('#tile-size').value); };
  el.querySelector('#tile-count').oninput = tileResult; el.querySelector('#tile-size').oninput = tileResult;
  el.querySelector('#tile-apply').onclick = () => {
    const path = el.querySelector('#tile-target').value;
    const value = Number(el.querySelector('#tile-result').value);
    if (!(value > 0 && value <= 3000)) { ctx.alert('请填写有效的地砖数量和砖长。', 'warning'); return; }
    rebuild(path, value); el.querySelector(`[data-param="${path}"]`).value = valueAt(store.get().room?.params || store.get().roomParams,path);
  };
  const updateZones = s => {
    const fill = planner.zoneFill(s.room, s.items, s.placements);
    el.querySelector('#zone-list').innerHTML = s.room.zones.filter(z => z.owner === s.owner || z.owner === 'pub').map(z => `<div class="zone-row"><button data-zone="${esc(z.id)}"><i class="status-dot ${s.zoneStatus[z.id] || 'empty'}"></i>${esc(z.label)}<small class="muted"> / ${z.kind === 'keepClear' ? '留空' : `T${z.tier}`}</small><small class="source">${({done:'已完成',designing:'设计中',empty:'空白'})[s.zoneStatus[z.id] || 'empty']}</small></button><span class="mono">${pct(fill[z.id])}</span>${z.kind !== 'keepClear' ? `<button class="lock-btn ${s.lockedZones.includes(z.id) ? 'green' : ''}" data-lock="${esc(z.id)}" aria-label="${s.lockedZones.includes(z.id) ? '解锁' : '锁定'} ${esc(z.label)}">${s.lockedZones.includes(z.id) ? '▣' : '□'}</button>` : '<span class="red">×</span>'}</div>`).join('');
  };
  el.querySelector('#zone-list').onclick = event => {
    const zone = event.target.closest('[data-zone]'); if (zone) store.set({ selection: zone.dataset.zone });
    const lock = event.target.closest('[data-lock]'); if (lock) { const s = store.get(); store.set({ lockedZones: s.lockedZones.includes(lock.dataset.lock) ? s.lockedZones.filter(id => id !== lock.dataset.lock) : [...s.lockedZones, lock.dataset.lock], movePlan: null }); }
  };
  const updateForm = s => {
    const current = s.room?.params || s.roomParams;
    if (!current) return;
    const currentOccupants = occupantsOf(s);
    if (!currentOccupants.includes(s.owner)) {
      const owner = currentOccupants[0];
      store.set({ owner, focusSpec: { ...s.focusSpec, zoneId: `${owner}.desk` }, movePlan: null, stepIndex: 0, selection: null });
      return;
    }
    const sources = measurements.get(s.roomParams) || new Set();
    el.querySelectorAll('[data-param]').forEach(input => { input.value = valueAt(current, input.dataset.param); });
    el.querySelectorAll('[data-source]').forEach(source => { source.textContent = sources.has(source.dataset.source) || current.sizeSource === 'measured' ? '实测' : '估'; });
    el.querySelectorAll('[data-template]').forEach(button => {
      const selected = button.dataset.template === current.templateId;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    });
    el.querySelector('#template-summary').textContent = `当前：${current.name}｜${current.room.w} × ${current.room.d} × ${current.room.h} cm${current.balcony.enabled ? `，阳台进深 ${current.balcony.d} cm` : '，无阳台'}`;
    el.querySelector('#balcony').checked = current.balcony.enabled;
    const ownerSelect = el.querySelector('#owner');
    if ([...ownerSelect.options].map(option => option.value).join(',') !== currentOccupants.join(',')) ownerSelect.innerHTML = currentOccupants.map(owner => `<option>${esc(owner)}</option>`).join('');
    ownerSelect.value = s.owner;
  };
  const unsubscribeForm = store.subscribe(updateForm, ['room', 'roomParams', 'owner']);
  const unsubscribeZones = store.subscribe(updateZones, ['room', 'owner', 'zoneStatus', 'placements']);
  cleanup = () => { unsubscribeForm(); unsubscribeZones(); };
  updateForm(store.get()); updateZones(store.get());
}
export function unmount() { cleanup(); cleanup = () => {}; }
