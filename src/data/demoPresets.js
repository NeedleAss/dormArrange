// 演示预设（docs/07 §4）。收集到真实数据后替换，替换后要满足 B2/B3 测试里的断言。

/** 新生清单：直接喂给 parseItemsText / aiParseItems */
const freshman = '24寸行李箱，28寸行李箱，冬被，夏凉被，枕头，羽绒服，外套3件，衣服3叠，鞋2双，大号收纳箱，27寸显示器，笔记本电脑，台灯，插线板，书20本，洗漱篮，盆，桶，衣架，台式小风扇，吹风机，1500W电热水壶，一个尺寸不确定的收纳箱，吉他';

export const PRESETS = {
  freshman,
  // B3 时补齐：老生 A 的乱桌（items + placements）
  messyDesk: { items: [], placements: {} },
  // B4 时补齐：4 个 Snapshot
  growth: []
};
