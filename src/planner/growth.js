// EP04 成长：演示快照 PRESETS.growth（docs/07 §4）。
// 快照里的 placements 需要用规划器算出来，而 data/ 不能反向 import planner/，所以放在这里构建，
// 由 planner/index.js 合并进对外导出的 PRESETS。全部确定性计算，导入时约 20ms。

import { DEFAULT_PARAMS, buildRoom } from '../data/roomTemplates.js';
import { PRESETS as DATA_PRESETS } from '../data/demoPresets.js';
import { parseItemsText } from './parseText.js';
import { planMoveIn } from './moveIn.js';
import { planFocusField } from './focusField.js';
import { computeSync } from './sync.js';
import { scatterOnDesk } from './scatter.js';

/**
 * 4 个快照：大一上 · 入住 → 大一下（桌上开始堆东西）→ 大二上 · 满桌 → 大二上 · 腾桌后。
 * sync 是用 computeSync 对快照自身 placements 算出的真实值（不是手填的数），恢复快照后重算结果一致。
 * @returns {import('../core/types.js').Snapshot[]}
 */
export function buildGrowthSnapshots() {
  const room = buildRoom();
  const params = structuredClone(DEFAULT_PARAMS);

  // ① 大一上 · 入住：新生清单按 EP01 规划
  const items1 = parseItemsText(DATA_PRESETS.freshman, { idPrefix: 'it' });
  const r1 = planMoveIn(room, items1);
  // ② 大一下：新添的东西随手堆在桌上
  const extra = parseItemsText('书10本，零食箱，快递盒2个，耳机，水杯，讲义', { idPrefix: 'y1s' });
  const scattered = scatterOnDesk(room, extra, { owner: 'A', existing: r1.placements, existingItems: items1 });
  const items2 = [...items1, ...extra];
  const pl2 = { ...r1.placements, ...scattered };
  // ③ ④ 大二上：老生乱桌与腾桌结果
  const { items: items3, placements: pl3 } = DATA_PRESETS.messyDesk;
  const plan = planFocusField(room, items3, pl3);

  const snap = (id, label, semester, createdAt, items, placements, focusMinutes) => ({
    id, label, semester, createdAt, roomParams: params,
    items: structuredClone(items), placements: structuredClone(placements),
    sync: computeSync(room, items, placements).total, focusMinutes
  });
  return [
    snap('snap-1', '大一上 · 入住', 'Y1-F', '2025-09-01T10:00:00+08:00', items1, r1.placements, 0),
    snap('snap-2', '大一下', 'Y1-S', '2026-03-15T21:00:00+08:00', items2, pl2, 1260),
    snap('snap-3', '大二上 · 满桌', 'Y2-F', '2026-10-18T14:00:00+08:00', items3, pl3, 2380),
    snap('snap-4', '大二上 · 腾桌后', 'Y2-F', '2026-10-18T14:10:00+08:00', items3, plan.placementsAfter, 2380)
  ];
}
