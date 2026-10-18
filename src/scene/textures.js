import * as THREE from 'three';

/** 所有纹理在本地 canvas 生成，不依赖网络图片。 */
export function warningTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#090909'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#ff5a00'; ctx.lineWidth = 22;
  for (let x = -256; x < 256; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 128, 128); ctx.stroke(); }
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace; texture.userData.shared = true; return texture;
}
