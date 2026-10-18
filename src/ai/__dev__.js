import { aiAvailable, aiParseItems } from './index.js';

const form = document.querySelector('#parse-form');
const input = document.querySelector('#items-text');
const button = document.querySelector('#parse-button');
const available = document.querySelector('#available');
const source = document.querySelector('#source');
const status = document.querySelector('#status');
const warnings = document.querySelector('#warnings');
const rows = document.querySelector('#items-body');
const count = document.querySelector('#item-count');

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
    available.textContent = String(await aiAvailable());
  } catch {
    available.textContent = 'false';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
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
    button.disabled = false;
    button.textContent = '解析';
    await checkAvailable();
  }
});

void checkAvailable();
