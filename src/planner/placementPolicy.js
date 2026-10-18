// 床面规则在所有规划入口共用；仅为 planner 内部模块，不增加公开 API。
import { LIBRARY_BY_ID } from '../data/itemLibrary.js';
import { EPS, overlapArea2D } from './geometry.js';

/** 历史分区也按 id 识别，避免旧 accepts 或 slot 漏掉床尾。 */
export function isBedZone(zone) {
  return zone?.slot === 'bed' || zone?.slot === 'bedFoot' || /\.(?:bed|bedFoot)$/.test(zone?.id ?? '');
}

/** 床设施只精确放行床帘库条目；普通库物品不能靠覆盖 category 获得床位。 */
export function isBedding(item) {
  if (!item) return false;
  if (/床头柜|床边(?:收纳|挂)|收纳[箱盒袋筐篮]|储物|床上桌|清洁|清洗|除螨|消毒|洗涤|(?:床单|床帘|蚊帐|被角|被子|被套)夹|夹子|固定器|固定带|刷子?/.test(item.name ?? '')) return false;
  if (item.libId === 'bed-curtain') return true;
  const lib = LIBRARY_BY_ID[item.libId];
  if (lib) return lib.category === 'bedding';
  return item.category === 'bedding';
}

/** 直接分区或 inside 任一祖先被锁时返回该分区，循环/缺失留给位置校验报告。O(祖先层数 × 分区数)。 */
export function lockedPlacementZone(placement, placements, room, lockedZones = []) {
  let current = placement;
  const seen = new Set();
  while (current) {
    if (lockedZones.includes(current.zoneId)) return current.zoneId;
    if (seen.has(current.zoneId)) return '';
    seen.add(current.zoneId);
    const zone = (room.zones ?? []).find((z) => z.id === current.zoneId);
    const parentId = zone?.parentItemId ?? (current.zoneId?.endsWith('.inside') ? current.zoneId.slice(0, -7) : null);
    current = parentId ? placements[parentId] : null;
  }
  return '';
}

/** 物理坐标也不能借用别的 zoneId 跨到床上；床面以上的整列都受限制。 */
function onPhysicalBed(room, placement) {
  const b = placement?.box;
  if (!b) return false;
  return (room.zones ?? []).some((z) => isBedZone(z) && overlapArea2D(z.box, b) > EPS &&
    b.y + b.h > z.box.y + EPS);
}

/**
 * 校验床面以及箱内祖先链；返回空串表示该规则通过，否则返回中文原因。
 * 不替代危险品、归属、锁区、尺寸、碰撞和通道校验。复杂度 O(祖先层数 × (物品数 + 分区数))。
 */
export function placementViolation(room, item, placement, placements = {}, items = []) {
  if (!placement) return '';
  const zones = room.zones ?? [];
  const byId = Array.isArray(items) ? Object.fromEntries(items.map((it) => [it.id, it])) : items;
  let currentItem = item, current = placement;
  const seen = new Set();
  while (current) {
    const zone = zones.find((z) => z.id === current.zoneId);
    if (!isBedding(currentItem) && (isBedZone(zone ?? { id: current.zoneId }) || onPhysicalBed(room, current))) {
      return current === placement ? '床面和床尾仅允许床上用品，此物品必须移到床外' :
        '箱内物品的容器位于床上，必须先把容器移到床外';
    }
    const parentId = zone?.parentItemId ?? (current.zoneId?.endsWith('.inside') ? current.zoneId.slice(0, -7) : null);
    if (!parentId) return '';
    if (seen.has(parentId)) return '箱内收纳存在循环，需重新规划';
    seen.add(parentId);
    currentItem = byId?.[parentId];
    current = placements[parentId];
    if (!currentItem || !current) return '箱内位置的容器缺失，需重新规划';
  }
  return '';
}
