import { AVATAR_OUTPUT_QUALITY, AVATAR_OUTPUT_SIZE } from "./constants";
import type { SourceCropRect } from "./cropGeometry";

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export function releaseDecodedImage(image: DecodedImage | null | undefined) {
  const source = image?.source;
  if (source && typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }
}

export async function decodeImageFile(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // cai no Image()
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Recorta, redimensiona e re-renderiza (remove EXIF). Prefere WEBP; cai para JPEG se o browser
 * não souber emitir webp. Tamanho médio esperado: 30–80 KB em 512×512.
 */
export async function renderAvatarBlob(
  image: DecodedImage,
  crop: SourceCropRect,
  opts?: { size?: number; quality?: number },
): Promise<{ blob: Blob; mime: "image/webp" | "image/jpeg" }> {
  const size = opts?.size ?? AVATAR_OUTPUT_SIZE;
  const quality = opts?.quality ?? AVATAR_OUTPUT_QUALITY;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("decode");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image.source, crop.sx, crop.sy, crop.s, crop.s, 0, 0, size, size);

  try {
    const webp = await canvasToBlob(canvas, "image/webp", quality);
    if (webp && webp.size > 0) return { blob: webp, mime: "image/webp" };
    const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
    if (jpeg && jpeg.size > 0) return { blob: jpeg, mime: "image/jpeg" };
    throw new Error("decode");
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    releaseDecodedImage(image);
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}
