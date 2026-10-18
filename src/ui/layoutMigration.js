/** 被拒绝的原位置只用于后续复核，不送入场景；新合法位置优先。 */
export function layoutExisting(source) {
  const ids = new Set((source.items || []).map(item => item.id));
  const pending = Object.fromEntries(Object.entries(source.migrationPending || {}).filter(([id]) => ids.has(id)));
  return structuredClone({ ...pending, ...(source.placements || {}) });
}

/** 保留未解决物品的原位置依据，防止二次复核绕过锁区或危险容器依赖。 */
export function rejectedPlacements(items, existing, placements) {
  return structuredClone(Object.fromEntries(items.filter(item => existing[item.id] && !placements[item.id])
    .map(item => [item.id, existing[item.id]])));
}

/** 复核界面也沿箱内祖先查锁，不能因原位置已移出有效布局就允许编辑。 */
export function layoutLockedZone(source, itemId) {
  const existing = layoutExisting(source);
  const seen = new Set();
  let placement = existing[itemId];
  while (placement && !seen.has(placement.zoneId)) {
    seen.add(placement.zoneId);
    if (source.lockedZones?.includes(placement.zoneId)) return placement.zoneId;
    const zone = source.room?.zones.find(entry => entry.id === placement.zoneId);
    const parentId = zone?.parentItemId || (placement.zoneId.endsWith('.inside') ? placement.zoneId.slice(0, -7) : null);
    placement = parentId ? existing[parentId] : null;
  }
  return null;
}

/**
 * 所有旧布局都经当前模板和入住公开入口复核；不修改原存档、物品归属或锁区。
 * @param {object} planner B 车道公开入口
 * @param {object} source 待恢复的完整布局或快照
 * @param {{owner?: string, lockedZones?: string[]}} [options] 快照缺失的当前操作上下文
 * @returns {{patch: object, notices: string[]}} 可一次写入仓库的新布局及核对事项
 */
export function migrateLayout(planner, source, options = {}) {
  if (!planner?.buildRoom || !planner?.planMoveIn) throw new Error('布局复核模块尚未就绪');
  const room = planner.buildRoom(structuredClone(source.roomParams ?? source.room?.params));
  const items = structuredClone(source.items ?? []);
  if (!Array.isArray(items)) throw new Error('存档物品清单无效');
  const existing = layoutExisting(source);
  const lockedZones = [...new Set(source.lockedZones ?? options.lockedZones ?? [])];
  const occupants = room.params.occupants;
  const requestedOwner = source.owner ?? options.owner ?? occupants[0];
  const owner = occupants.includes(requestedOwner) ? requestedOwner : occupants[0];
  const report = planner.planMoveIn(room, items, { owner, existing, lockedZones });
  const notices = [];
  if (owner !== requestedOwner) notices.push(`当前房型没有 ${requestedOwner} 床位，已切换为查看 ${owner}；物品归属未改变。`);
  const orphaned = items.filter(item => item.owner !== 'pub' && !occupants.includes(item.owner));
  for (const missingOwner of new Set(orphaned.map(item => item.owner))) {
    notices.push(`当前房型没有 ${missingOwner} 床位，请核对归属；以下物品仍保留 ${missingOwner} 归属：${orphaned.filter(item => item.owner === missingOwner).map(item => item.name).join('、')}。`);
  }
  const removedLocks = lockedZones.filter(id => !room.zones.some(zone => zone.id === id) && !id.endsWith('.inside'));
  if (removedLocks.length) notices.push(`旧锁区已不在当前房型中，锁定记录仍保留，请核对：${removedLocks.join('、')}。`);
  const moved = items.filter(item => existing[item.id] && report.placements[item.id]
    && JSON.stringify(existing[item.id]) !== JSON.stringify(report.placements[item.id]));
  if (moved.length) notices.push(`已重新安排 ${moved.length} 件旧物品，其他合法位置已保留。`);
  for (const item of items) {
    const verdict = report.verdicts[item.id];
    if (!verdict) continue;
    if (verdict.status === 'overflow' || verdict.status === 'banned') {
      const reasons = [...new Set([...(verdict.reasons || []), ...(verdict.suggestions || [])])];
      notices.push(`${item.name}：${reasons.join('；') || '暂未安排位置，请核对。'}`);
    } else if (existing[item.id] && moved.includes(item)) {
      const reason = verdict.reasons?.find(text => text.startsWith('已修复旧位置'));
      if (reason) notices.push(`${item.name}：${reason}。`);
    }
  }
  const spec = source.focusSpec || { w: 75, d: 35 };
  return { notices, patch: {
    room, roomParams: structuredClone(room.params), owner, items, placements: report.placements,
    lockedZones, zoneStatus: {}, fitReport: items.length ? report : null,
    migrationPending: rejectedPlacements(items, existing, report.placements),
    itemStates: Object.fromEntries(Object.entries(report.verdicts).map(([id, verdict]) => [id, verdict.status])),
    sync: items.length ? report.sync : null,
    focusSpec: { ...spec, zoneId: `${owner}.desk` },
    movePlan: null, stepIndex: 0, tdmPlan: null, selection: null
  } };
}
