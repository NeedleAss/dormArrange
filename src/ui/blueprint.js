import { esc } from './helpers.js';

/** 场景车道缺席时的二维参数蓝图；投影只使用真实盒子，不承担 three.js 场景实现。 */
export function renderBlueprint(state) {
  const room = state.room;
  if (!room) return '';
  const bounds = room.bounds;
  const project = (x, y, z) => [x * .9 - z * .5, x * .27 + z * .39 - y * .82];
  const points = [];
  for (const x of [0, bounds.w]) for (const y of [0, bounds.h]) for (const z of [0, bounds.d]) points.push(project(x,y,z));
  const xs = points.map(p => p[0]); const ys = points.map(p => p[1]);
  const minX = Math.min(...xs) - 55; const minY = Math.min(...ys) - 35;
  const width = Math.max(...xs) - minX + 55; const height = Math.max(...ys) - minY + 65;
  const point = values => values.map(n => n.toFixed(1)).join(',');
  const line = (a,b,cls='') => `<path class="${cls}" d="M${point(a)}L${point(b)}"/>`;
  const edges = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
  function box(box, cls, label = '') {
    const vertices = [];
    for (const y of [box.y, box.y + box.h]) for (const z of [box.z,box.z+box.d]) for (const x of [box.x,box.x+box.w]) vertices.push(project(x,y,z));
    const top = [4,5,7,6].map(i => point(vertices[i])).join(' ');
    return `<g class="blueprint-box ${cls}">${label ? `<title>${esc(label)}</title>` : ''}<polygon class="blueprint-face" points="${top}"/>${edges.map(([a,b]) => line(vertices[a],vertices[b])).join('')}</g>`;
  }
  let grid = '';
  for (let x = 0; x <= bounds.w; x += 60) grid += line(project(x,0,0),project(x,0,bounds.d),'blueprint-grid');
  for (let z = 0; z <= bounds.d; z += 60) grid += line(project(0,0,z),project(bounds.w,0,z),'blueprint-grid');
  const fixtureColor = { loftBed:'amber', bedRail:'amber', wardrobe:'violet', desk:'cyan', hutch:'cyan', ladder:'lime', chair:'violet', sink:'cyan', dryingRod:'lime' };
  const fixtures = [...room.fixtures].sort((a,b) => (b.box.x+b.box.z)-(a.box.x+a.box.z));
  const labels = room.fixtures.filter(f => f.type === 'loftBed').map(f => {
    const p = project(f.box.x+f.box.w*.5,f.box.y+f.box.h+15,f.box.z+f.box.d*.5);
    return `<text class="blueprint-owner" x="${p[0]}" y="${p[1]}">${esc(f.owner)}</text>`;
  }).join('');
  const field = state.episode === 'EP02' && state.movePlan ? box(state.movePlan.focusBox, `field ${state.stepIndex >= state.movePlan.steps.length && state.sync?.parts.focus === 1 ? 'lime' : 'red'}`, '专注力场') : '';
  const dimension = (a,b,text) => `${line(a,b,'blueprint-dimension')}<text class="blueprint-dimension-label" x="${(a[0]+b[0])/2}" y="${(a[1]+b[1])/2+16}">${esc(text)}</text>`;
  return `<svg class="blueprint-wireframe" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="根据当前尺寸生成的宿舍参数蓝图">${grid}<path class="blueprint-boundary" d="M${point(project(0,0,0))}L${point(project(bounds.w,0,0))}L${point(project(bounds.w,0,bounds.d))}L${point(project(0,0,bounds.d))}Z"/>${fixtures.map(f=>box(f.box,fixtureColor[f.type]||'amber',f.label)).join('')}${Object.values(state.placements).map(p=>box(p.box,`${state.itemStates[p.itemId] || 'fits'} item`,state.items.find(i=>i.id===p.itemId)?.name)).join('')}${room.openings.map(o=>box(o.box,'cyan opening')).join('')}${field}${labels}${dimension(project(0,0,-35),project(bounds.w,0,-35),`${room.params?.room.w || bounds.w} cm`)}${dimension(project(-35,0,0),project(-35,0,bounds.d),`${bounds.d} cm`)}</svg>`;
}
