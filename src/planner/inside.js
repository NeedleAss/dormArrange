// 容器内部净空几何：规划器内部共享，保持相同厘米坐标与放倒映射。
const INSIDE_ACCEPTS = ['clothes', 'bedding', 'storage', 'misc', 'sport', 'appliance'];

/**
 * 由行李箱的 placement 生成 inside 分区（docs/05 §2.7）：按 container 尺寸居中内缩，放倒时按放倒后的方向对应。
 */
export function insideZoneFor(item, pl, parentZone) {
  const c = item.flags.container;
  const s = item.size, b = pl.box;
  const near = (x, y) => Math.abs(x - y) < 0.05;
  // 世界 y 对应物品的哪一维
  let ky = 'h';
  if (pl.lying) ky = near(b.h, s.d) && !near(b.h, s.w) ? 'd' : near(b.h, s.w) ? 'w' : 'd';
  const rest = ['w', 'd', 'h'].filter((k) => k !== ky);
  // 世界 x 对应剩下两维中与 b.w 相等的那一维
  const kx = near(b.w, s[rest[0]]) ? rest[0] : rest[1];
  const kz = rest[0] === kx ? rest[1] : rest[0];
  const cx = Math.min(c[kx], b.w), cz = Math.min(c[kz], b.d), cy = Math.min(c[ky], b.h);
  return {
    id: `${item.id}.inside`, slot: 'inside', label: `${item.name}里`, owner: item.owner, kind: 'inside',
    box: { x: b.x + (b.w - cx) / 2, y: b.y + (b.h - cy) / 2, z: b.z + (b.d - cz) / 2, w: cx, d: cz, h: cy },
    front: parentZone?.front ?? '+x', tier: 2, accepts: [...INSIDE_ACCEPTS], stackable: true, parentItemId: item.id
  };
}
