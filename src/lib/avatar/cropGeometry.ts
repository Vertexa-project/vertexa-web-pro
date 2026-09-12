export interface CropView {
  imageWidth: number;
  imageHeight: number;
  viewport: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface SourceCropRect {
  sx: number;
  sy: number;
  s: number;
}

export function clampPan(value: number): number {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

export function clampZoom(value: number, min = 1, max = 3): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Recorte 1:1 em coordenadas da imagem-fonte (cover + zoom + pan).
 * O preview circular usa o mesmo retângulo; a saída é quadrada.
 */
export function sourceCropRect(view: CropView): SourceCropRect {
  const { imageWidth: w, imageHeight: h, viewport, zoom, panX, panY } = view;
  const z = Math.max(zoom, 1e-6);
  const cover = Math.max(viewport / w, viewport / h);
  const scale = cover * z;
  const drawW = w * scale;
  const drawH = h * scale;
  const maxX = Math.max(0, (drawW - viewport) / 2);
  const maxY = Math.max(0, (drawH - viewport) / 2);
  const drawX = (viewport - drawW) / 2 + clampPan(panX) * maxX;
  const drawY = (viewport - drawH) / 2 + clampPan(panY) * maxY;
  let sx = -drawX / scale;
  let sy = -drawY / scale;
  let s = viewport / scale;
  if (s > w) s = w;
  if (s > h) s = h;
  if (sx < 0) sx = 0;
  if (sy < 0) sy = 0;
  if (sx + s > w) sx = w - s;
  if (sy + s > h) sy = h - s;
  return { sx, sy, s };
}
