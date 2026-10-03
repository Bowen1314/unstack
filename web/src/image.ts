/**
 * Image helpers. The size math is pure (unit-tested); the canvas helpers run
 * only in the browser.
 */
import { MAX_IMAGE_BYTES } from '../../shared/pricing.ts';

export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;
/** YouCam auto-resizes anything above this, so we never send more. */
export const SCAN_MAX_LONG_SIDE = 2560;
export const LABEL_MAX_LONG_SIDE = 1600;
export const THUMB_MAX_LONG_SIDE = 480;

export interface Size {
  width: number;
  height: number;
}

/** Scale (w, h) down so the long side is at most maxLong. Never upscales. */
export function fitWithin(width: number, height: number, maxLong: number): Size & { scale: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, scale: 0 };
  const long = Math.max(width, height);
  if (long <= maxLong) return { width, height, scale: 1 };
  const scale = maxLong / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/** Decoded byte size of a base64 data URL (approximate within a couple of bytes). */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export function dataUrlMime(dataUrl: string): string | null {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return m ? m[1]! : null;
}

/** Validate a picked file before reading it. Returns a user-facing message or null. */
export function checkPhotoFile(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return 'Use a JPG or PNG photo. YouCam skin analysis accepts only those two formats.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `This photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. YouCam accepts photos under 10 MB.`;
  }
  return null;
}

/** Normalise a Camera Kit image (data URL or bare base64) to a data URL. */
export function asDataUrl(image: string, mime = 'image/jpeg'): string {
  return image.startsWith('data:') ? image : `data:${mime};base64,${image}`;
}

// ---------- Browser-only helpers ----------

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string, crossOrigin?: 'anonymous'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the image'));
    img.src = src;
  });
}

/** Re-encode as JPEG, downscaled so the long side ≤ maxLong. */
export async function toJpeg(src: string, maxLong: number, quality = 0.9): Promise<{ dataUrl: string } & Size> {
  const img = await loadImage(src);
  const size = fitWithin(img.naturalWidth, img.naturalHeight, maxLong);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser');
  // JPEG has no alpha: paint white first so transparent PNGs don't turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(img, 0, 0, size.width, size.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: size.width, height: size.height };
}

/**
 * Prepare a user photo for the skin-analysis request: keep the original bytes
 * when they are already within YouCam's limits, otherwise downscale to 2560 px.
 */
export async function preparePhoto(dataUrl: string): Promise<{ dataUrl: string } & Size> {
  const img = await loadImage(dataUrl);
  const { naturalWidth: width, naturalHeight: height } = img;
  if (Math.max(width, height) <= SCAN_MAX_LONG_SIDE && dataUrlBytes(dataUrl) <= MAX_IMAGE_BYTES) {
    return { dataUrl, width, height };
  }
  return toJpeg(dataUrl, SCAN_MAX_LONG_SIDE, 0.92);
}
