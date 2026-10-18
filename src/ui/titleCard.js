import { esc } from './helpers.js';
import '../styles/cinematics.css';

let dismissCurrent = null;

/** 由待机演示或导航取消调用；关闭会同步清掉所有监听与计时器。 */
export function dismissTitleCard() { dismissCurrent?.(); }

/**
 * 黑白标题卡以错位巨字构成 L 形；逐字硬显只描述章节进入，不模拟遥测数据。
 * @param {{no: string, title: string, en: string}} chapter
 * @returns {Promise<void>} 1400ms 后结束，也可由点击、任意键或 dismissTitleCard 立即结束。
 */
export function showTitleCard({ no, title, en }) {
  dismissCurrent?.();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'title-card cinematic-title';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', `${no} ${title}`);
    overlay.setAttribute('aria-modal', 'true');
    const code = String(en).match(/EPISODE\s+(\d+)/i)?.[1] || 'FC';
    overlay.innerHTML = `<div class="title-frame" aria-hidden="true"></div>
      <span class="title-system">FANGCUN / CHAPTER ENTRY</span><div class="title-no">${esc(no)}</div>
      <div class="title-code" aria-hidden="true">${esc(code)}</div>
      <div class="title-word" aria-hidden="true">${Array.from(String(title)).map((character, index) => `<span style="--character:${index}">${esc(character)}</span>`).join('')}</div>
      <div class="title-en"><span>方寸之间</span><strong>${esc(en)}</strong></div>
      <span class="title-skip">点击或按任意键跳过 <i aria-hidden="true">↘</i></span><div class="title-frame-cut" aria-hidden="true"></div>`;
    let timer;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      overlay.removeEventListener('click', skip);
      document.removeEventListener('keydown', skip, true);
      overlay.remove();
      if (dismissCurrent === done) dismissCurrent = null;
      resolve();
    };
    const skip = event => {
      event.preventDefault();
      event.stopPropagation();
      done();
    };
    dismissCurrent = done;
    overlay.addEventListener('click', skip);
    document.addEventListener('keydown', skip, true);
    document.body.append(overlay);
    timer = setTimeout(done, 1400);
  });
}
