import { renderBlueprint } from './blueprint.js';

/** 容差上限沿物品的世界坐标展开，再与所在分区求三轴交集。 */
function toleranceBox(placement, tolerance, zone) {
  if (!placement || !tolerance || !zone || placement.zoneId !== zone.id) return null;
  const anchor = placement.box;
  const bounds = zone.box;
  const w = placement.rot === 90 ? tolerance.maxD : tolerance.maxW;
  const d = placement.rot === 90 ? tolerance.maxW : tolerance.maxD;
  const h = tolerance.maxH;
  if (!anchor || !bounds || ![anchor.x, anchor.y, anchor.z, bounds.x, bounds.y, bounds.z, bounds.w, bounds.d, bounds.h, w, d, h].every(Number.isFinite) || [bounds.w, bounds.d, bounds.h, w, d, h].some(size => size <= 0)) return null;
  const x = Math.max(anchor.x, bounds.x);
  const y = Math.max(anchor.y, bounds.y);
  const z = Math.max(anchor.z, bounds.z);
  const box = { x, y, z,
    w: Math.min(anchor.x + w, bounds.x + bounds.w) - x,
    d: Math.min(anchor.z + d, bounds.z + bounds.d) - z,
    h: Math.min(anchor.y + h, bounds.y + bounds.h) - y };
  return box.w > 0 && box.d > 0 && box.h > 0 ? box : null;
}

/** store → scene 唯一接线点；面板不调用场景的 set* 方法。 */
export function bindScene(store, scene, fallbackElement = null, { onFailure } = {}) {
  let activeScene = scene;
  let failed = false;
  function useBlueprint(error) {
    if (failed) return;
    failed = true;
    const brokenScene = activeScene;
    activeScene = null;
    console.error('三维视图出错，已切换为平面预览。', error);
    // 先切断后续场景调用，再释放渲染循环；清理失败不能阻断文字面板。
    try { onFailure?.(); } catch { /* 降级通知不影响后续订阅。 */ }
    try { brokenScene?.dispose?.(); } catch { /* 失效场景的清理只尽力执行。 */ }
    const placeholder = fallbackElement?.closest?.('.scene-placeholder');
    if (placeholder) placeholder.hidden = false;
    fallbackElement?.closest?.('.viewport')?.querySelector('.scene')?.setAttribute('hidden', '');
    const s = store.get();
    if (fallbackElement) fallbackElement.innerHTML = renderBlueprint(s);
    store.set({ alerts: [{ id: 'scene-fallback', level: 'warning', text: '三维视图出错，已切换为平面预览', t: new Date().toISOString() }, ...(s.alerts || [])].slice(0, 6) });
  }
  function call(method, ...args) {
    if (!activeScene) return;
    try { activeScene[method]?.(...args); }
    catch (error) { useBlueprint(error); }
  }
  function update(s, keys) {
    const has = (...names) => names.some(name => keys.includes(name));
    if (!activeScene && fallbackElement && has('room','items','placements','itemStates','episode','movePlan','stepIndex')) fallbackElement.innerHTML = renderBlueprint(s);
    if (has('room') && s.room) call('setRoom', s.room);
    if (has('room', 'placements', 'lockedZones')) {
      const occupied = new Set(Object.values(s.placements).map(p => p.zoneId));
      const zoneStatus = Object.fromEntries((s.room?.zones || []).map(z => [z.id,
        s.lockedZones.includes(z.id) ? 'done' : occupied.has(z.id) ? 'designing' : 'empty']));
      store.set({ zoneStatus });
    }
    if (has('zoneStatus')) call('setZoneStatus', store.get().zoneStatus);
    if (has('items', 'placements', 'fitReport')) {
      // 丢弃步骤已完成的物品不再进入滞留区；回退步骤时可重新显示。
      const disposed = new Set((s.movePlan?.steps || []).slice(0, s.stepIndex).filter(step => step.kind === 'dispose').map(step => step.itemId));
      call('setItems', s.items.filter(item => !disposed.has(item.id)), s.placements, { animate: true, overflowIds: s.fitReport?.overflowIds || [] });
    }
    if (has('itemStates')) call('setItemStates', s.itemStates);
    if (has('camera', 'owner', 'room')) call('setCamera', s.camera, { owner: s.owner });
    if (has('movePlan', 'stepIndex', 'episode', 'sync')) {
      const plan = s.episode === 'EP02' ? s.movePlan : null;
      call('showFocusField', plan?.focusBox || null);
      call('setFocusFieldState', plan && s.stepIndex >= plan.steps.length && !plan.unresolved.length && s.sync?.parts.focus === 1 ? 'clear' : 'conflict');
    }
    if (has('selection', 'fitReport', 'placements', 'room', 'items')) {
      const verdict = s.fitReport?.verdicts[s.selection];
      const tolerance = verdict?.tolerance;
      const zone = s.room?.zones.find(z => z.id === tolerance?.zoneId);
      call('showTolerance', s.selection, toleranceBox(s.placements[s.selection], tolerance, zone));
      if (has('selection') && s.selection) call('focusOn', s.selection);
    }
  }
  const unsubscribe = store.subscribe(update);
  update(store.get(), Object.keys(store.get()));
  return unsubscribe;
}
