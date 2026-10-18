import { aiAvailable, aiParseItems, aiParsePhoto } from './index.js';
import { getConfig } from './client.js';

const form = document.querySelector('#parse-form');
const input = document.querySelector('#items-text');
const button = document.querySelector('#parse-button');
const available = document.querySelector('#available');
const source = document.querySelector('#source');
const status = document.querySelector('#status');
const warnings = document.querySelector('#warnings');
const rows = document.querySelector('#items-body');
const count = document.querySelector('#item-count');
const photoForm = document.querySelector('#photo-form');
const photoInput = document.querySelector('#photo-input');
const photoButton = document.querySelector('#photo-button');
const photoHint = document.querySelector('#photo-hint');
let busy = false;
let photoAllowed = false;

/** 文字与照片共享忙碌状态，防止重复操作覆盖结果。 */
function updateButtons() {
  button.disabled = busy;
  photoInput.disabled = busy;
  photoButton.disabled = busy || !photoAllowed || !photoInput.files?.length;
}

/** 所有来自输入与解析器的内容只用文本节点显示，避免 HTML 注入。 */
function showWarnings(messages) {
  warnings.replaceChildren();
  for (const message of messages) {
    const item = document.createElement('li');
    item.textContent = String(message);
    warnings.append(item);
  }
}

/** @param {Array<import('../core/types.js').Item>} items */
function showItems(items) {
  rows.replaceChildren();
  count.textContent = `物品：${items.length} 件`;
  for (const item of items) {
    const row = document.createElement('tr');
    const size = item.size;
    const values = [
      item.name,
      item.category,
      size ? `${size.w} × ${size.d} × ${size.h}` : '未知',
      item.sizeSource,
      item.powerW ?? '未知',
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = String(value ?? '');
      row.append(cell);
    }
    rows.append(row);
  }
}

// 离线和配置端点不可用时也能继续使用本地规则解析。
async function checkAvailable() {
  try {
    const [enabled, config] = await Promise.all([aiAvailable(), getConfig()]);
    available.textContent = String(enabled);
    photoAllowed = config.enabled && config.vision;
  } catch {
    available.textContent = 'false';
    photoAllowed = false;
  }
  photoHint.textContent = photoAllowed
    ? '支持20MB以内的JPEG、PNG、WebP或GIF；点击识别后才发送，照片不保存。'
    : '当前模型不支持图片';
  updateButtons();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  updateButtons();
  button.textContent = '解析中…';
  status.textContent = '正在解析物品清单…';
  source.textContent = '等待结果';
  showWarnings([]);
  try {
    const result = await aiParseItems(input.value, { owner: 'A' });
    source.textContent = result.source;
    showWarnings(result.warnings ?? []);
    showItems(result.items);
    status.textContent = `解析完成，共 ${result.items.length} 件物品。`;
  } catch {
    source.textContent = '不可用';
    showItems([]);
    showWarnings(['解析暂不可用，请稍后重试。']);
    status.textContent = '解析未完成';
  } finally {
    busy = false;
    button.textContent = '解析';
    await checkAvailable();
  }
});

photoInput.addEventListener('change', updateButtons);
photoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !photoAllowed) return;
  const file = photoInput.files?.[0];
  if (!file) {
    showWarnings(['请先选择一张照片。']);
    return;
  }
  busy = true;
  updateButtons();
  photoButton.textContent = '识别中…';
  status.textContent = '正在识别照片中的物品…';
  source.textContent = '等待结果';
  showWarnings([]);
  try {
    const result = await aiParsePhoto(file, { owner: 'A' });
    source.textContent = result.source;
    showWarnings(result.warnings ?? []);
    showItems(result.items);
    status.textContent = `识别完成，共 ${result.items.length} 件物品。`;
  } catch {
    source.textContent = '不可用';
    showItems([]);
    showWarnings(['照片识别暂不可用，请改用文字导入。']);
    status.textContent = '照片识别未完成';
  } finally {
    busy = false;
    photoButton.textContent = '识别照片';
    await checkAvailable();
  }
});

void checkAvailable();
