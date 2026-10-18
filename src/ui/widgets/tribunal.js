import { esc } from '../helpers.js';

const MINT = '#8fffe2';
const ORANGE = '#ff9a1f';
const RED = '#ff3c32';
const DISPLAY = "'Yu Mincho','Hiragino Mincho ProN','Noto Serif SC','Songti SC','SimSun',serif";
const LABEL = "'Noto Serif SC','Yu Mincho','Songti SC','SimSun',serif";

// 三块共用中央切角菱形的边，避免形成彼此分离的普通卡片。
const NETWORK = [
  'M130 16H390V164L330 220H190L130 164Z',
  'M18 280H140L240 360V478H18Z',
  'M380 280H502V478H280V360Z',
  'M190 220L140 280M330 220L380 280M240 360H280M240 380H280'
].join(' ');

/**
 * 三审板只呈现已有评估；空数据保留待审，不把默认值解释为承认。
 * @param {{total?: number, votes?: {time?: boolean, space?: boolean, mind?: boolean}, notes?: string[]}|null} sync
 * @returns {string} 无样式表依赖、按本征比例缩放的 SVG。
 */
export function renderTribunalBoard(sync) {
  const assessed = Number.isFinite(sync?.total) && sync.total >= 0 && sync.total <= 100;
  const notes = Array.isArray(sync?.notes) ? sync.notes.filter(note => typeof note === 'string') : [];
  const definitions = [
    { key: 'space', zh: '空', en: 'SPACE:02', labelX: 260, labelY: 52, x: 178, y: 88, w: 164, h: 88 },
    { key: 'mind', zh: '心', en: 'MIND:03', labelX: 126, labelY: 449, x: 42, y: 334, w: 154, h: 78 },
    { key: 'time', zh: '时', en: 'TIME:01', labelX: 394, labelY: 449, x: 324, y: 334, w: 154, h: 78 }
  ];
  const votes = definitions.map(definition => {
    const value = assessed ? sync?.votes?.[definition.key] : undefined;
    const status = value === true ? '承认' : value === false ? '否决' : '待审';
    const color = value === true ? MINT : value === false ? RED : ORANGE;
    const ownNotes = notes.filter(note => note.trim().startsWith(`${definition.zh}：`) || note.trim().startsWith(`${definition.zh}:`));
    const detail = ownNotes.length ? ownNotes.join('；') : value === undefined ? '尚未进行本项评估。' : value ? '本项评估已通过。' : notes.join('；') || '本项评估未通过。';
    return { ...definition, status, color, detail };
  });
  const label = `三审决议：${votes.map(vote => `${vote.zh}${vote.status}`).join('，')}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" class="tribunal-board" viewBox="0 0 520 496" width="100%" height="auto" preserveAspectRatio="xMidYMid meet" role="group" aria-label="${esc(label)}" focusable="false">
    <title>${esc(label)}</title>
    <defs><filter id="tribunal-frame-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="halo"/><feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <rect x="0" y="0" width="520" height="496" fill="#000000"/>
    <g fill="none" stroke="${MINT}" stroke-linejoin="miter" stroke-linecap="square" aria-hidden="true">
      <path d="${NETWORK}" stroke-width="13" stroke-opacity="0.055"/>
      <path d="${NETWORK}" stroke-width="7" stroke-opacity="0.17"/>
      <path d="${NETWORK}" stroke-width="5" stroke-opacity="1" filter="url(#tribunal-frame-glow)"/>
    </g>
    <text class="tribunal-center" x="260" y="284" text-anchor="middle" dominant-baseline="central" font-family="${esc(DISPLAY)}" font-size="38" font-weight="900" letter-spacing="2" fill="${MINT}" stroke="${MINT}" stroke-width="0.6" stroke-opacity="0.2" paint-order="stroke fill" aria-hidden="true">三审</text>
    ${votes.map(vote => {
      const description = `${vote.zh} ${vote.en}：${vote.status}。${vote.detail}`;
      return `<g role="img" aria-label="${esc(description)}" tabindex="0">
        <title>${esc(description)}</title>
        <text class="tribunal-label" x="${vote.labelX}" y="${vote.labelY}" text-anchor="middle" dominant-baseline="central" fill="${ORANGE}" font-size="22" font-family="${esc(LABEL)}" font-weight="700" letter-spacing="0.7"><tspan font-family="${esc(DISPLAY)}" font-size="21" font-weight="900">${vote.zh}</tspan><tspan dx="9">${vote.en}</tspan></text>
        <rect x="${vote.x}" y="${vote.y}" width="${vote.w}" height="${vote.h}" rx="5" fill="none" stroke="${vote.color}" stroke-width="8" stroke-opacity="0.07" aria-hidden="true"/>
        <rect x="${vote.x}" y="${vote.y}" width="${vote.w}" height="${vote.h}" rx="5" fill="#000000" stroke="${vote.color}" stroke-width="2.2" aria-hidden="true"/>
        <text class="tribunal-status" x="${vote.x + vote.w / 2}" y="${vote.y + vote.h / 2 - 1}" text-anchor="middle" dominant-baseline="central" font-family="${esc(DISPLAY)}" font-size="58" font-weight="900" letter-spacing="-2" fill="${vote.color}" stroke="${vote.color}" stroke-width="1.7" stroke-opacity="0.14" paint-order="stroke fill">${vote.status}</text>
      </g>`;
    }).join('')}
  </svg>`;
}
