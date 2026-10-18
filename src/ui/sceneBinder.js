/** store → scene 唯一接线点；面板不调用场景的 set* 方法。 */
export function bindScene(store, scene) {
  function update(s, keys) {
    const has = (...names) => names.some(name => keys.includes(name));
    if (has('room') && s.room) scene?.setRoom?.(s.room);
    if (has('room', 'placements', 'lockedZones')) {
      const occupied = new Set(Object.values(s.placements).map(p => p.zoneId));
      const zoneStatus = Object.fromEntries((s.room?.zones || []).map(z => [z.id,
        s.lockedZones.includes(z.id) ? 'done' : occupied.has(z.id) ? 'designing' : 'empty']));
      store.set({ zoneStatus });
    }
    if (has('zoneStatus')) scene?.setZoneStatus?.(s.zoneStatus);
    if (has('items', 'placements', 'fitReport')) {
      // 丢弃步骤已完成的物品不再进入滞留区；回退步骤时可重新显示。
      const disposed = new Set((s.movePlan?.steps || []).slice(0, s.stepIndex).filter(step => step.kind === 'dispose').map(step => step.itemId));
      scene?.setItems?.(s.items.filter(item => !disposed.has(item.id)), s.placements, { animate: true, overflowIds: s.fitReport?.overflowIds || [] });
    }
    if (has('itemStates')) scene?.setItemStates?.(s.itemStates);
    if (has('camera', 'owner', 'room')) scene?.setCamera?.(s.camera, { owner: s.owner });
    if (has('movePlan', 'stepIndex', 'episode')) {
      const plan = s.episode === 'EP02' ? s.movePlan : null;
      scene?.showFocusField?.(plan?.focusBox || null);
      scene?.setFocusFieldState?.(plan && s.stepIndex >= plan.steps.length && !plan.unresolved.length ? 'clear' : 'conflict');
    }
    if (has('selection')) {
      const verdict = s.fitReport?.verdicts[s.selection];
      const tolerance = verdict?.tolerance;
      const zone = s.room?.zones.find(z => z.id === tolerance?.zoneId);
      scene?.showTolerance?.(s.selection, tolerance && zone ? { ...zone.box, w: tolerance.maxW, d: tolerance.maxD, h: tolerance.maxH } : null);
      if (s.selection) scene?.focusOn?.(s.selection);
    }
  }
  const unsubscribe = store.subscribe(update);
  update(store.get(), Object.keys(store.get()));
  return unsubscribe;
}
