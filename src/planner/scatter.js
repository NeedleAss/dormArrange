// 乱桌生成器（docs/05 §5.8，加分）：把物品"像真实生活一样"堆在某人桌面的前沿中间，
// 生成结果可直接作为 planFocusField 的输入（观众互动：说出你桌上的东西 → 现场腾桌）。
// 复杂度 O(已有位置数 × 分区数 + 物品数 × 候选分区数 × findSpot)。

import { buildEngines, commitSpot } from './engines.js';
import { localExtents, volume } from './geometry.js';
import { hardOk } from './rank.js';
import { checkRules } from './checkRules.js';
import { placementViolation } from './placementPolicy.js';

/**
 * @param {import('../core/types.js').Room} room
 * @param {import('../core/types.js').Item[]} items
 * @param {{ owner?: string, existing?: Record<string, any>, existingItems?: any[] }} [opts]
 *   existing：桌上已有的东西（作为障碍物，不会出现在返回值里）
 * @returns {Record<string, import('../core/types.js').Placement>}
 * @throws {RangeError} 已有布局违反床面限制时，须先用 planMoveIn 的 existing 选项修复并展示报告。
 */
export function scatterOnDesk(room, items, opts = {}) {
  const owner = opts.owner ?? 'A';
  const existing = opts.existing ?? {};
  const allItems = [...(opts.existingItems ?? []), ...items];
  const byId = Object.fromEntries(allItems.map((it) => [it.id, it]));
  for (const [id, p] of Object.entries(existing).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const issue = placementViolation(room, byId[id], p, existing, allItems);
    // 本函数只返回新增落点，不能静默删除或搬动旧位置；先明确要求调用者走入住修复与报告。
    if (issue) throw new RangeError(`已有位置「${byId[id]?.name ?? id}」无效：${issue}；请先用 planMoveIn 的 existing 选项修复旧布局`);
  }
  const engines = buildEngines(room, existing, { items: allItems });
  const desk = room.zones.find((z) => z.id === `${owner}.desk`);
  if (!desk) return {};
  const { U, V } = localExtents(desk);
  const origin = { u: U / 2, v: V * 0.35 };     // 偏前、居中：乱桌的东西总堆在人面前
  const fallback = [`${owner}.hutch`, `${owner}.underDesk`].map((id) => room.zones.find((z) => z.id === id)).filter(Boolean);
  const out = {};
  const order = [...items].sort((a, b) => volume(b.size) - volume(a.size) || (a.id < b.id ? -1 : 1));
  for (const it of order) {
    // 互动乱桌也经过安全检查，不能绕过入住规则把禁用物品放上桌。
    if (existing[it.id] || checkRules(it).banned) continue;
    const ownIt = { ...it, owner };   // 观众说的东西一律算在这张桌子主人名下
    for (const z of [desk, ...fallback]) {
      const eng = engines[z.id];
      if (!eng || !hardOk(ownIt, z)) continue;
      const spot = eng.findSpot(ownIt, z.id === desk.id ? { mode: 'near', origin } : { mode: 'store' });
      if (!spot) continue;
      const trial = commitSpot(eng.clone(), ownIt, spot);
      if (placementViolation(room, ownIt, trial, { ...existing, ...out }, allItems)) continue;
      out[it.id] = commitSpot(eng, ownIt, spot);
      break;
    }
  }
  return out;
}
