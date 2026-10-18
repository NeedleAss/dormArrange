import { esc, clone } from '../helpers.js';
let cleanup = () => {};
let draft = '';
const manifests = new WeakMap();
const labels = { fits: '能放下', relocate: '需换位置', uncertain: '尺寸待定', overflow: '放不下', banned: '禁止携带' };
const sources = { measured: '实测', product: '商品参数', estimated: '估计', unknown: '未知' };
let filter = null;

export function mount(el, ctx) {
  const { store, planner, ai } = ctx;
  if (!planner) { el.innerHTML = '<p class="empty">规划模块加载中</p>'; return; }
  let active = true;
  // 只记录真正解析成功的文本；切话、换使用者或外部替换物品不能被误判为已解析。
  if (!manifests.has(store)) manifests.set(store, { parsedDraft: null, owner: null, items: null, origins: new Map() });
  const manifest = manifests.get(store);
  el.innerHTML = `<div class="section-title">入住清单</div><textarea id="items-text" rows="5" aria-label="物品清单" placeholder="24寸行李箱、书20本、笔记本电脑…">${esc(draft)}</textarea><div class="button-row"><button class="btn compact" id="freshman">载入新生示例</button><button class="btn compact" id="parse">解析清单</button></div><div class="library-add"><select id="library" aria-label="物品库"><option value="">从物品库添加…</option>${planner.LIBRARY.map(i => `<option value="${esc(i.libId)}">${esc(i.name)}</option>`).join('')}</select><button class="btn compact" id="add">＋</button></div><p class="hint" id="parse-source" hidden></p><div id="item-editor"></div><button id="plan" class="btn btn-primary full">开始规划</button><div id="results"></div>`;
  const text = el.querySelector('#items-text');
  const identity = item => `${item.owner}|${item.category}|${item.libId || item.name.trim().toLowerCase()}`;
  function fixedBaseline(state) {
    const locked = new Set(state.lockedZones);
    const items = state.items.filter(item => item.owner !== state.owner || locked.has(state.placements[item.id]?.zoneId));
    const ids = new Set(items.map(item => item.id));
    return { items, placements: Object.fromEntries(Object.entries(state.placements).filter(([id]) => ids.has(id))) };
  }
  function invalidate(items) {
    const state = store.get();
    const fixed = fixedBaseline(state);
    // 固定物品既保留原位置也保留原对象，避免解析、增删或编辑把锁区/室友的东西清空。
    const merged = new Map(items.map(item => [item.id, item]));
    fixed.items.forEach(item => merged.set(item.id, item));
    const nextItems = [...merged.values()];
    manifest.items = nextItems;
    const nextIds = new Set(nextItems.map(item => item.id));
    for (const id of manifest.origins.keys()) if (!nextIds.has(id)) manifest.origins.delete(id);
    store.set({ items: nextItems, placements: fixed.placements,
      itemStates: Object.fromEntries(fixed.items.map(item => [item.id, state.itemStates[item.id] || 'fits'])),
      fitReport: null, movePlan: null, tdmPlan: null, sync: null, selection: null });
  }
  function fixedReason(itemId) {
    const state = store.get();
    const item = state.items.find(entry => entry.id === itemId);
    if (item?.owner !== state.owner) return '这是其他使用者的物品，请先切换到对应使用者再编辑。';
    if (state.lockedZones.includes(state.placements[itemId]?.zoneId)) return '物品所在分区已锁定，请先解锁再编辑或移除。';
    return null;
  }
  function restoreEditor(openIds) {
    render(store.get());
    el.querySelectorAll('details').forEach(detail => { if (openIds.includes(detail.dataset.item || 'list')) detail.open = true; });
  }
  const updateButton = () => { el.querySelector('#plan').disabled = store.get().ai.busy || (!store.get().items.length && !text.value.trim()); };
  text.oninput = () => { draft = text.value; updateButton(); };
  function acceptParsedItems(items, requestedText, owner) {
    const state = store.get();
    const fixed = fixedBaseline(state);
    const manualItems = state.items.filter(item => item.id.startsWith('manual-'));
    const fixedByIdentity = new Map();
    for (const item of fixed.items) {
      const key = manifest.origins.get(item.id) || identity(item);
      const entries = fixedByIdentity.get(key) || [];
      entries.push(item);
      fixedByIdentity.set(key, entries);
    }
    const prefix = `parsed-${crypto.randomUUID()}`;
    const parsedItems = [];
    items.forEach((item, index) => {
      const key = identity(item);
      // 按件消耗已固定的同类物品；同清单重解析不会再添一份，数量增加时只补新增件数。
      if (fixedByIdentity.get(key)?.shift()) return;
      const next = { ...clone(item), id: `${prefix}-${index + 1}` };
      manifest.origins.set(next.id, key);
      parsedItems.push(next);
    });
    invalidate([...parsedItems, ...fixed.items, ...manualItems]);
    manifest.parsedDraft = requestedText;
    manifest.owner = owner;
  }
  async function parse() {
    if (!text.value.trim()) return false;
    const requestedText = text.value;
    draft = requestedText;
    store.set({ ai: { ...store.get().ai, busy: true } });
    try {
      const owner = store.get().owner;
      let result;
      try { result = ai?.aiParseItems ? await ai.aiParseItems(requestedText, { owner }) : { items: planner.parseItemsText(requestedText, { owner }), source: 'rules', warnings: [] }; }
      catch { result = { items: planner.parseItemsText(requestedText, { owner }), source: 'rules', warnings: [] }; }
      if (!active) return false;
      if (text.value !== requestedText) { ctx.alert('清单已更改，请重新解析最新内容。', 'warning'); return false; }
      if (store.get().owner !== owner) { ctx.alert('使用者已更改，请重新解析清单。', 'warning'); return false; }
      if (!result.items?.length) { ctx.alert('没有识别到物品，请换一种写法或从物品库添加。', 'warning'); return false; }
      acceptParsedItems(result.items, requestedText, owner);
      store.set({ ai: { ...store.get().ai, lastSource: result.source, available: result.source === 'ai', busy: false } });
      ctx.alert(result.source === 'ai' ? `AI 解析完成：${result.items.length} 件物品。` : 'AI 离线，已使用本地解析', result.source === 'ai' ? 'info' : 'warning');
      return true;
    } catch { ctx.alert('解析未完成，已保留上次清单。', 'error'); return false; }
    finally { store.set({ ai: { ...store.get().ai, busy: false } }); }
  }
  el.querySelector('#parse').onclick = parse;
  el.querySelector('#freshman').onclick = () => {
    if (store.get().ai.busy) return;
    text.value = planner.PRESETS.freshman;
    draft = text.value;
    try {
      const owner = store.get().owner;
      // 固定示例使用确定的本地解析，现场载入不依赖 AI 请求或网络超时。
      const items = planner.parseItemsText(planner.PRESETS.freshman, { owner });
      if (!items.length) { ctx.alert('新生示例暂未解析出物品，请从物品库添加。', 'warning'); return; }
      acceptParsedItems(items, text.value, owner);
      // 本次没有探测 AI，保留已有在线状态，只更新清单来源与界面。
      store.set({ ai: { ...store.get().ai, lastSource: 'rules', busy: false } });
      ctx.alert(`新生示例已载入：${items.length} 件物品（本地解析）。`);
    } catch { ctx.alert('示例未能载入，已保留上次清单。', 'error'); }
  };
  el.querySelector('#add').onclick = () => {
    const libId = el.querySelector('#library').value; if (!libId) return;
    const item = planner.makeItem(libId, { id: `manual-${crypto.randomUUID()}`, owner: store.get().owner });
    invalidate([...store.get().items, item]);
  };
  el.querySelector('#plan').onclick = async () => {
    if (store.get().ai.busy) return;
    const current = store.get();
    if (text.value.trim() && (manifest.parsedDraft !== text.value || manifest.owner !== current.owner || manifest.items !== current.items) && !await parse()) return;
    const s = store.get(); if (!s.items.length) return;
    try {
      const report = planner.planMoveIn(s.room, s.items, { owner: s.owner, lockedZones: s.lockedZones, existing: fixedBaseline(s).placements });
      store.set({ placements: report.placements, itemStates: Object.fromEntries(Object.entries(report.verdicts).map(([id,v]) => [id,v.status])), fitReport: report, sync: report.sync,
        syncHistory: [...s.syncHistory, { t: new Date().toISOString(), total: report.sync.total, label: '入住' }].slice(-60), movePlan: null, tdmPlan: null });
      ctx.alert(report.summary.overflow ? `规划完成，${report.summary.overflow} 件物品需要重新安排。` : '规划完成，没有放不下的物品。', report.summary.overflow ? 'warning' : 'success');
    } catch { ctx.alert('规划暂未完成，请检查尺寸后重试；上次结果已保留。', 'error'); }
  };
  function render(s) {
    if (!active) return;
    el.querySelector('#parse-source').hidden = !s.ai.busy && !s.ai.lastSource;
    el.querySelector('#parse-source').textContent = s.ai.busy ? '解析中…' : s.ai.lastSource ? `${s.ai.lastSource === 'ai' ? 'AI' : '本地'}解析 · ${s.items.length} 件` : '';
    el.querySelector('#parse').disabled = s.ai.busy; el.querySelector('#freshman').disabled = s.ai.busy;
    el.querySelector('#add').disabled = s.ai.busy;
    el.querySelector('#item-editor').innerHTML = s.items.length ? `<details class="item-list"><summary>物品 / ${s.items.length} 件</summary>${s.items.map(i => `<details class="item-edit" data-item="${esc(i.id)}"><summary>${esc(i.name)} <span class="mono muted">${i.size.w}×${i.size.d}×${i.size.h}</span></summary><label>名称<input value="${esc(i.name)}" data-edit="name" aria-label="${esc(i.name)} 名称"></label><div class="field-grid">${['w','d','h'].map((key,n) => `<label>${['宽','深','高'][n]} cm<input type="number" min="0.1" step="1" value="${i.size[key]}" data-size="${key}" aria-label="${esc(i.name)} ${['宽','深','高'][n]}"></label>`).join('')}</div><div class="button-row"><select data-edit="sizeSource" aria-label="${esc(i.name)} 尺寸来源">${Object.entries(sources).map(([value,label]) => `<option value="${value}" ${i.sizeSource === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button class="btn compact btn-danger" data-remove="${esc(i.id)}">移除</button></div><label>使用频率<select data-edit="freq">${[['daily','每日'],['weekly','每周'],['monthly','每月'],['seasonal','换季'],['rare','很少']].map(([value,label]) => `<option value="${value}" ${i.freq === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="hint">月份（逗号分隔，留空为全年）<input data-edit="months" value="${esc(i.months?.join(',') || '')}" placeholder="11,12,1,2,3"></label></details>`).join('')}</details>` : '<p class="hint">解析清单或添加物品。</p>';
    updateButton(); renderResults(s);
  }
  function renderResults(s) {
    const report = s.fitReport; const host = el.querySelector('#results');
    if (!report) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="section-title">适配结果</div><div class="verdict-badges">${Object.entries(labels).map(([status,label]) => `<button data-filter="${status}" class="verdict-badge ${status} ${filter === status ? 'selected' : ''}"><b>${report.summary[status]}</b>${label}</button>`).join('')}</div>${Object.entries(labels).filter(([status]) => !filter || status === filter).map(([status,label]) => `<section class="verdict-group ${status}"><h3>${label} <span class="mono">${report.summary[status]}</span></h3>${s.items.filter(i => report.verdicts[i.id]?.status === status).map(item => {
      const v = report.verdicts[item.id]; const zone = s.room.zones.find(z => z.id === v.zoneId); const selected = s.selection === item.id;
      const details = [...new Set([...v.reasons, v.tolerance?.text, v.need?.text, ...v.suggestions])].filter(text => text && text !== v.reasons[0]);
      return `<div class="verdict-item"><button data-result="${esc(item.id)}" aria-expanded="${selected}"><strong>${esc(item.name)}</strong><span>${esc(zone?.label || (status === 'banned' ? '禁止携带' : '等待安排'))}</span><small>${esc(v.reasons[0] || '')}</small></button>${selected ? `<div class="verdict-detail"><p class="mono">${item.size.w}×${item.size.d}×${item.size.h} cm / ${sources[item.sizeSource]}</p>${details.map(text => `<p${text === v.tolerance?.text ? ' class="cyan"' : ''}>${esc(text)}</p>`).join('')}</div>` : ''}</div>`;
    }).join('') || '<p class="hint">暂无物品</p>'}</section>`).join('')}<button id="export-tolerance" class="btn full compact">复制尺寸核对清单</button>`;
  }
  el.querySelector('#item-editor').onchange = event => {
    const row = event.target.closest('[data-item]'); if (!row) return;
    const openIds = [...el.querySelectorAll('details[open]')].map(detail => detail.dataset.item || 'list');
    const reason = fixedReason(row.dataset.item);
    if (reason) { ctx.alert(reason, 'warning'); restoreEditor(openIds); return; }
    const item = clone(store.get().items.find(i => i.id === row.dataset.item));
    if (event.target.dataset.size) {
      if (!event.target.checkValidity()) { event.target.reportValidity(); return; }
      item.size[event.target.dataset.size] = Number(event.target.value);
      item.sizeSource = 'measured'; delete item.sizeRange;
    } else if (event.target.dataset.edit === 'months') {
      const months = event.target.value.trim() ? event.target.value.split(/[,，\s]+/).map(Number) : undefined;
      if (months?.some(m => !Number.isInteger(m) || m < 1 || m > 12)) { ctx.alert('月份只能填写 1–12。', 'warning'); return; }
      item.months = months;
    } else if (event.target.dataset.edit) {
      item[event.target.dataset.edit] = event.target.value;
      if (event.target.dataset.edit === 'sizeSource') {
        if (['unknown','estimated'].includes(item.sizeSource)) { const factor = item.sizeSource === 'unknown' ? [.5,2] : [.8,1.25]; item.sizeRange = { min: Object.fromEntries(Object.entries(item.size).map(([k,v]) => [k,v*factor[0]])), max: Object.fromEntries(Object.entries(item.size).map(([k,v]) => [k,v*factor[1]])) }; }
        else delete item.sizeRange;
      }
    }
    // 保留原生 details 的展开状态，让连续量尺寸无需反复展开。
    invalidate(store.get().items.map(i => i.id === item.id ? item : i));
    el.querySelectorAll('details').forEach(d => { if (openIds.includes(d.dataset.item || 'list')) d.open = true; });
  };
  el.querySelector('#item-editor').onclick = event => {
    const remove = event.target.closest('[data-remove]');
    if (!remove) return;
    const reason = fixedReason(remove.dataset.remove);
    if (reason) { ctx.alert(reason, 'warning'); return; }
    invalidate(store.get().items.filter(item => item.id !== remove.dataset.remove));
  };
  el.querySelector('#results').onclick = async event => {
    const badge = event.target.closest('[data-filter]'); if (badge) { filter = filter === badge.dataset.filter ? null : badge.dataset.filter; renderResults(store.get()); }
    const result = event.target.closest('[data-result]'); if (result) store.set({ selection: store.get().selection === result.dataset.result ? null : result.dataset.result });
    if (event.target.closest('#export-tolerance')) {
      const lines = Object.values(store.get().fitReport.verdicts).filter(v => v.tolerance).map(v => v.tolerance.text).join('\n');
      try { await navigator.clipboard.writeText(lines || '当前没有尺寸待定物品。'); ctx.alert('购物前核对清单已复制。', 'success'); }
      catch { ctx.alert('剪贴板不可用，请在结果中选中容差句复制。', 'warning'); }
    }
  };
  const unsubscribe = store.subscribe((s, keys) => keys.length === 1 && keys[0] === 'selection' ? renderResults(s) : render(s), ['items', 'fitReport', 'selection', 'ai']);
  render(store.get());
  cleanup = () => { active = false; unsubscribe(); };
}
export function unmount() { cleanup(); }
