// 演示预设（docs/07 §4）。收集到真实数据后替换，替换后要满足 B2/B3 测试里的断言。

/** 新生清单：直接喂给 parseItemsText / aiParseItems。
 *  来自 assets/item-lists/freshman.txt 的"演示精简版"（队友参考常见"宿舍必备"清单整理） */
const freshman = '24寸行李箱，28寸行李箱，冬被，夏凉被，枕头，羽绒服，外套3件，衣服3叠，鞋2双，拖鞋，大号收纳箱，折叠收纳箱，27寸显示器，笔记本电脑，护眼灯，插线板，书20本，桌面收纳盒，洗浴手提篮，折叠洗脸盆，桶，衣架，台式小风扇，吹风机，1500W电热水壶，一个尺寸不确定的收纳箱，大容量水杯，吉他';

export const PRESETS = {
  freshman,
  // B3 时补齐：老生 A 的乱桌（items + placements）
  messyDesk: { items: [], placements: {} },
  // B4 时补齐：4 个 Snapshot
  growth: []
};
