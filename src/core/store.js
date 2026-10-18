/** 轻量发布订阅仓库；只持久化契约中允许的三个字段。 */
export function createStore(initialState = {}) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('fangcun.v1') || '{}') || {}; } catch { /* 存储受限时仍可使用。 */ }
  let state = Object.freeze({ ...initialState,
    roomParams: saved.roomParams || initialState.roomParams,
    snapshots: Array.isArray(saved.snapshots) ? saved.snapshots : initialState.snapshots,
    focusMinutes: Number.isFinite(saved.focusMinutes) ? saved.focusMinutes : initialState.focusMinutes });
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const changed = Object.keys(patch).filter(key => !Object.is(state[key], patch[key]));
      if (!changed.length) return;
      state = Object.freeze({ ...state, ...patch });
      if (changed.some(key => ['roomParams', 'snapshots', 'focusMinutes'].includes(key))) {
        try { localStorage.setItem('fangcun.v1', JSON.stringify({ roomParams: state.roomParams, snapshots: state.snapshots, focusMinutes: state.focusMinutes })); } catch { /* 配额不足不阻塞操作。 */ }
      }
      for (const entry of [...listeners]) {
        // 话切换可能在同一轮广播中卸载旧面板，不再调用已取消的订阅。
        if (!listeners.has(entry)) continue;
        if (!entry.keys || entry.keys.some(key => changed.includes(key))) {
          try { entry.fn(state, changed); }
          catch (error) { console.error('状态订阅处理失败，已继续通知其他模块。', error); }
        }
      }
    },
    subscribe(fn, keys) {
      const entry = { fn, keys };
      listeners.add(entry);
      return () => listeners.delete(entry);
    }
  };
}

/** 初始化数据来自 B 车道公开接口，模块缺失时只提供空状态。 */
export function createInitialState(planner) {
  const roomParams = planner?.DEFAULT_PARAMS ? structuredClone(planner.DEFAULT_PARAMS) : null;
  return {
    episode: 'EP00', owner: 'A', roomParams, room: planner?.buildRoom?.(roomParams) || null,
    items: [], placements: {}, itemStates: {}, lockedZones: [], zoneStatus: {}, fitReport: null,
    focusSpec: { zoneId: 'A.desk', w: 75, d: 35 }, movePlan: null, stepIndex: 0,
    month: 9, tdm: true, tdmPlan: null, snapshots: [], focusMinutes: 0,
    timer: { running: false }, sync: null, syncHistory: [], selection: null,
    camera: 'orbit', bloom: false, alerts: [], ai: { available: false, busy: false, lastSource: null }
  };
}
