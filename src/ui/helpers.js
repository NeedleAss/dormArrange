/** 所有外部文本进入 HTML 前转义，避免清单和 AI 返回值插入标记。 */
export const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const clone = value => structuredClone(value);
export const pct = value => `${Math.round((value || 0) * 100)}%`;
export const EPISODES = [
  { id: 'EP00', no: '第零话', title: '建模', en: 'MODELING', desc: '先丈量，再安放。' },
  { id: 'EP01', no: '第一话', title: '入住', en: 'MOVE-IN', desc: '把期待，放进方寸之间。' },
  { id: 'EP02', no: '第二话', title: '腾桌', en: 'FOCUS FIELD', desc: '挪动几件事，留一片专注。' },
  { id: 'EP03', no: '第三话', title: '换季', en: 'TIME-DIVISION', desc: '让时间，为空间留白。' },
  { id: 'EP04', no: '第四话', title: '成长', en: 'GROWTH', desc: '每一寸变化，都有迹可循。' }
];

export function syncPatch(ctx, placements, label, extra = {}, items = ctx.store.get().items) {
  const s = ctx.store.get();
  const sync = ctx.planner.computeSync(s.room, items, placements, { owner: s.owner, ...extra });
  return { sync, syncHistory: [...s.syncHistory, { t: new Date().toISOString(), total: sync.total, label }].slice(-60) };
}
