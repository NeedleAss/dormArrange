// 演示预设（docs/07 §4）。收集到真实数据后替换，替换后要满足 B2/B3 测试里的断言。

import { buildRoom } from './roomTemplates.js';
import { makeItem } from './itemLibrary.js';

/** 新生清单：直接喂给 parseItemsText / aiParseItems。
 *  来自 assets/item-lists/freshman.txt 的"演示精简版"（队友参考常见"宿舍必备"清单整理） */
const freshman = '24寸行李箱，28寸行李箱，冬被，夏凉被，枕头，羽绒服，外套3件，衣服3叠，鞋2双，拖鞋，大号收纳箱，折叠收纳箱，27寸显示器，笔记本电脑，护眼灯，插线板，书20本，桌面收纳盒，洗浴手提篮，折叠洗脸盆，桶，衣架，台式小风扇，吹风机，1500W电热水壶，一个尺寸不确定的收纳箱，大容量水杯，吉他';

export const PRESETS = {
  freshman,
  messyDesk: buildMessyDesk(),
  // B4 时补齐：4 个 Snapshot
  growth: []
};

/**
 * 老生 A 的乱桌（docs/07 §4）：
 * - 力场（75×35，前沿居中）内 6 件冲突：快递盒、零食箱、压在零食箱上的耳机、两摞书（叠放）、水杯
 * - 桌面两侧的空位都被台灯、笔筒、护肤品、小风扇切碎，书摞放不下；书架约六成满、桌下有 24 寸箱、
 *   桌下靠墙堆满旧教材 → 书摞第一次"放不下 → 级联"：把行李箱挪到床尾，再把书放进桌下
 * - 27 寸显示器靠墙居中，不在力场内
 * 坐标用 A.desk 等分区的局部矩形 (u0, v0, a, b) 描述，再换算成世界盒子（front 为 '+x'）。
 */
function buildMessyDesk() {
  const room = buildRoom();
  const zone = (id) => room.zones.find((z) => z.id === id);
  const items = [];
  const placements = {};
  let n = 0;
  const put = (libId, zoneId, u0, v0, a, b, base = 0, extra = {}) => {
    const z = zone(zoneId);
    const it = makeItem(libId, { id: `md-${String(++n).padStart(3, '0')}`, ...extra });
    const lib = it.size;
    const h = extra.h ?? lib.h;
    if (extra.h) it.size = { ...it.size, h };
    const bx = z.box;
    const box = { x: bx.x + bx.w - (v0 + b), y: bx.y + base, z: bx.z + u0, w: b, d: a, h };
    items.push(it);
    placements[it.id] = { itemId: it.id, zoneId, box, rot: Math.abs(box.w - lib.w) < 0.01 ? 0 : 90,
      lying: false, layer: extra.layer ?? 0, compressed: false };
    return it;
  };
  // ── A.desk：桌面（U = 130 沿 z，V = 60 沿 x；力场 u ∈ [27.5, 102.5]、v ∈ [0, 35]）──
  put('monitor-27', 'A.desk', 34.5, 40, 61, 20);                      // 靠墙居中
  put('parcel', 'A.desk', 28, 5, 35, 25, 0, { name: '快递盒' });       // 力场内
  put('snack-box', 'A.desk', 64, 2, 20, 30);                           // 力场内
  put('headphones', 'A.desk', 65, 7, 18, 20, 20, { layer: 1 });         // 压在零食箱上
  put('books-10', 'A.desk', 85, 4, 19, 26, 0, { name: '专业课教材' });  // 力场内
  put('books-10', 'A.desk', 85, 4, 19, 26, 25, { name: '习题册', layer: 1 });   // 叠在教材上
  put('cup', 'A.desk', 37, 31, 8, 8);                                  // 力场内（靠后一角）
  put('box-desk', 'A.desk', 0, 18, 25, 15);                            // 左侧空位
  put('lamp', 'A.desk', 5, 42, 15, 15);
  put('skincare', 'A.desk', 106, 18, 20, 12);                          // 右侧空位
  put('fan-desk', 'A.desk', 104, 36, 25, 20);
  // ── A.hutch：书架（U = 130，V = 25，净高 38）约六成满 ──
  for (let k = 0; k < 3; k++) {
    put('books-10', 'A.hutch', 26 * k, 0, 26, 19, 0, { name: `旧教材#${k + 1}` });
    put('books-10', 'A.hutch', 26 * k, 0, 26, 19, 25, { name: `旧笔记#${k + 1}`, h: 12.5, layer: 1 });
  }
  for (let k = 0; k < 4; k++) put('folder', 'A.hutch', 78, 0, 31, 24, 4 * k, { name: `讲义#${k + 1}`, layer: k });
  put('noodle-box', 'A.hutch', 110, 0, 15, 15, 0);
  put('noodle-box', 'A.hutch', 110, 0, 15, 15, 10, { layer: 1 });
  // ── A.underDesk：桌下立着一个 24 寸箱 ──
  put('luggage-24', 'A.underDesk', 0, 18, 26, 42);
  // ── A.underDeskBack：桌下靠墙两层旧教材 ──
  for (let k = 0; k < 3; k++) {
    put('books-10', 'A.underDeskBack', 26 * k, 0, 26, 19, 0, { name: `大一教材#${k * 2 + 1}` });
    put('books-10', 'A.underDeskBack', 26 * k, 0, 26, 19, 25, { name: `大一教材#${k * 2 + 2}`, layer: 1 });
  }
  return { items, placements };
}
