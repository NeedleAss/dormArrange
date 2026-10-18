// 乱桌生成器（docs/05 §5.8，加分）：把物品"像真实生活一样"堆在某人桌面的前沿中间，
// 生成结果可直接作为 planFocusField 的输入（观众互动：说出你桌上的东西 → 现场腾桌）。
// 复杂度 O(物品数 × findSpot)。

import { buildEngines, commitSpot } from './engines.js';
import { localExtents, volume } from './geometry.js';
import { hardOk } from './rank.js';

/**
 * @param {import('../core/types.js').Room} room
 * @param {import('../core/types.js').Item[]} items
 * @param {{ owner?: string, existing?: Record<string, any>, existingItems?: any[] }} [opts]
 *   existing：桌上已有的东西（作为障碍物，不会出现在返回值里）
 * @returns {Record<string, import('../core/types.js').Placement>}
 */
export function scatterOnDesk(room, items, opts = {}) {
  const owner = opts.owner ?? 'A';
  const existing = opts.existing ?? {};
  const engines = buildEngines(room, existing, { items: [...(opts.existingItems ?? []), ...items] });
  const desk = room.zones.find((z) => z.id === `${owner}.desk`);
  if (!desk) return {};
  const { U, V } = localExtents(desk);
  const origin = { u: U / 2, v: V * 0.35 };     // 偏前、居中：乱桌的东西总堆在人面前
  const fallback = [`${owner}.hutch`, `${owner}.underDesk`].map((id) => room.zones.find((z) => z.id === id)).filter(Boolean);
  const out = {};
  const order = [...items].sort((a, b) => volume(b.size) - volume(a.size) || (a.id < b.id ? -1 : 1));
  for (const it of order) {
    if (existing[it.id]) continue;
    const ownIt = { ...it, owner };   // 观众说的东西一律算在这张桌子主人名下
    let spot = engines[desk.id].findSpot(ownIt, { mode: 'near', origin });   // 不加专注区惩罚
    let eng = engines[desk.id];
    if (!spot) {
      for (const z of fallback) {
        if (!hardOk(ownIt, z) || !engines[z.id]) continue;
        spot = engines[z.id].findSpot(ownIt, { mode: 'store' });
        if (spot) { eng = engines[z.id]; break; }
      }
    }
    if (spot) out[it.id] = commitSpot(eng, it, spot);
  }
  return out;
}
