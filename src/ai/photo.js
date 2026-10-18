const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/** 不向前端透传文件名、图像内容或浏览器原始异常。 */
function badImage() {
  return Object.assign(new Error('图片无法读取，请选择20MB以内的JPEG、PNG、WebP或GIF图片'), { code: 'BAD_IMAGE' });
}

/**
 * 照片仅在调用时在内存解码、缩小并导出，不保存、不记录、不缓存。
 * @param {File} file
 * @returns {Promise<string>} 长边不超过1024的JPEG data URL。
 */
export async function compressPhoto(file) {
  let objectURL;
  let image;
  let timer;
  try {
    if (!file || !PHOTO_TYPES.has(file.type) || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_PHOTO_BYTES) throw badImage();
    objectURL = URL.createObjectURL(file);
    image = new Image();
    await new Promise((resolve, reject) => {
      // 解码损坏图片或浏览器未回调时及时退出；资源统一在finally释放。
      timer = setTimeout(() => reject(badImage()), 10000);
      image.onload = resolve;
      image.onerror = () => reject(badImage());
      image.src = objectURL;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw badImage();
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw badImage();
    // 透明PNG转JPEG时使用白底，避免透明区域变成黑色。
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', 0.8);
    if (typeof result !== 'string' || !result.startsWith('data:image/jpeg;base64,')) throw badImage();
    return result;
  } catch {
    throw badImage();
  } finally {
    clearTimeout(timer);
    if (image) {
      image.onload = null;
      image.onerror = null;
    }
    if (objectURL) {
      try { URL.revokeObjectURL(objectURL); } catch { /* 释放失败不覆盖固定的解析结果。 */ }
    }
  }
}
