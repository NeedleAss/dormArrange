import { esc } from './helpers.js';
let dismissCurrent = null;

/** 标题卡硬切显示；返回的 Promise 在退出或用户跳过后完成。 */
export function showTitleCard({ no, title, en }) {
  dismissCurrent?.();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'title-card';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', `${no} ${title}`);
    overlay.innerHTML = `<div class="title-no">${esc(no)}</div><div class="title-word">${esc(title)}</div><div class="title-en">${esc(en)}</div><span class="title-skip">点击或按任意键跳过</span>`;
    let timer;
    const done = () => {
      clearTimeout(timer); overlay.remove(); document.removeEventListener('keydown', done); dismissCurrent = null; resolve();
    };
    dismissCurrent = done;
    overlay.addEventListener('click', done, { once: true });
    document.addEventListener('keydown', done, { once: true });
    document.body.append(overlay);
    timer = setTimeout(done, 1400);
  });
}
