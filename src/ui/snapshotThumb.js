// 限制整个 dataURL 的字符数，比仅限制 JPEG 文件字节数更保守，避免档案迅速占满存储。
export const MAX_THUMB_LENGTH = 30 * 1024;

/** 只向图片节点提供受限大小的 JPEG dataURL。 */
export function isSnapshotThumb(value) {
  return typeof value === 'string' && value.length <= MAX_THUMB_LENGTH
    && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/**
 * 原尺寸截图只参与本次解码，不进入 store；压缩失败时返回 null，不影响保存。
 * @param {string|null|undefined} source
 * @param {{Image?: typeof Image, document?: Document, timeoutMs?: number}} [environment]
 * @returns {Promise<string|null>}
 */
export function createSnapshotThumb(source, environment = {}) {
  if (typeof source !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(source)) return Promise.resolve(null);
  return new Promise(resolve => {
    let image = null;
    let timer = null;
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (image) { image.onload = null; image.onerror = null; }
      resolve(value);
    };
    try {
      const ImageClass = environment.Image ?? globalThis.Image;
      const document = environment.document ?? globalThis.document;
      image = new ImageClass();
      image.onload = () => {
        if (settled) return;
        try {
          const width = image.naturalWidth, height = image.naturalHeight;
          if (![width, height].every(value => Number.isFinite(value) && value > 0)) return finish(null);
          const canvas = document.createElement('canvas');
          canvas.width = 240;
          canvas.height = Math.max(1, Math.round(240 * height / width));
          const context = canvas.getContext('2d');
          if (!context) return finish(null);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const jpeg = canvas.toDataURL('image/jpeg', 0.7);
          finish(isSnapshotThumb(jpeg) ? jpeg : null);
        } catch { finish(null); }
      };
      image.onerror = () => finish(null);
      // 解码未完成也不能让保存按钮一直等待。
      timer = setTimeout(() => finish(null), environment.timeoutMs ?? 2000);
      image.src = source;
    } catch { finish(null); }
  });
}
