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

const SEM_LABEL = { F: '上', S: '下' };
const YEAR_LABEL = ['一', '二', '三', '四', '五', '六'];

/** 'Y2-F' → '大二上' */
export function semesterLabel(code) {
  const m = /^Y(\d)-(F|S)$/.exec(code);
  return m ? `大${YEAR_LABEL[+m[1] - 1] ?? m[1]}${SEM_LABEL[m[2]]}` : code;
}

/**
 * 成长预测（docs/05 §9，加分）：对 growthPerSemester > 0 的物品（书）逐学期累加，
 * 每学期用 EP01 的放置流程重放一遍，找出第一个"增长物品放不进首选分区"的学期。
 * 复杂度 O(学期数 × planMoveIn)，8 学期约 50ms。
 * @param {import('../core/types.js').Item[]} items
 * @param {import('../core/types.js').Room} room
 * @param {{ owner?: string, semesters?: number }} [opts]
 * @returns {import('../core/types.js').GrowthForecast}
 */
export function predictGrowth(items, room, opts = {}) {
  const owner = opts.owner ?? 'A';
  const n = Math.max(1, opts.semesters ?? 8);
  const semesters = [];
  for (let k = 0; k < n; k++) semesters.push(`Y${Math.floor(k / 2) + 1}-${k % 2 ? 'S' : 'F'}`);
  const growers = items.filter((it) => (it.growthPerSemester ?? 0) > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
  // 增长速度按物品种类（libId）计：库里"书"是每学期 +0.5 摞，与现在有几摞无关
  const perKind = new Map();
  for (const it of growers) {
    const key = it.libId ?? it.id;
    perKind.set(key, Math.max(perKind.get(key) ?? 0, it.growthPerSemester));
  }
  const rate = [...perKind.values()].reduce((s, v) => s + v, 0);
  const watchSlot = growers[0]?.preferred?.[0] ?? 'hutch';
  const watchZoneId = `${owner}.${watchSlot}`;
  const fill = {};
  let firstOverflow = null;
  for (let k = 0; k < n; k++) {
    // 第 k 学期新增的件数（向下取整：半摞书不算一摞）
    const extraN = growers.length ? Math.floor(rate * k + 1e-9) : 0;
    const extras = [];
    for (let e = 0; e < extraN; e++) {
      const src = growers[e % growers.length];
      extras.push({ ...structuredClone(src), id: `${src.id}~g${String(e + 1).padStart(2, '0')}`, name: `${src.name}（新增）` });
    }
    const all = [...items, ...extras];
    const rep = planMoveIn(room, all, { owner });
    const zf = rep.zoneFill;
    const zones = new Set([watchZoneId, `${owner}.desk`]);
    for (const it of [...growers, ...extras]) if (rep.placements[it.id]) zones.add(rep.placements[it.id].zoneId);
    for (const id of zones) {
      if (!fill[id]) fill[id] = new Array(k).fill(0);
    }
    for (const id of Object.keys(fill)) fill[id].push(zf[id] ?? 0);
    if (!firstOverflow) {
      const spilled = [...growers, ...extras].some((it) => {
        const p = rep.placements[it.id];
        return !p || p.zoneId !== watchZoneId;
      });
      if (spilled && k > 0) firstOverflow = { zoneId: watchZoneId, semester: semesters[k] };
    }
  }
  const perSem = Math.round(rate * 10);
  const what = growers[0]?.category === 'books' ? `${perSem} 本书` : `${Math.round(rate * 10) / 10} 件`;
  const text = !growers.length ? '没有会随学期增长的物品'
    : firstOverflow
      ? `按每学期 +${what}的速度，${semesterLabel(firstOverflow.semester)}书架会满。建议届时把旧教材收进床尾箱`
      : `按每学期 +${what}的速度，${n} 个学期内书架都放得下`;
  return { semesters, fill, firstOverflow, text };
}
