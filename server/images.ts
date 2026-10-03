import type { ImagePayload } from '../shared/api.ts';
import { MAX_IMAGE_BYTES } from '../shared/pricing.ts';
import { HttpError, isRecord } from './http.ts';

export type ImageType = 'image/jpeg' | 'image/png';

export interface DecodedImage {
  bytes: Uint8Array;
  contentType: ImageType;
  width: number;
  height: number;
}

/** Image type from magic bytes. The declared MIME type of a data URL is not trusted. */
export function sniffType(b: Uint8Array): ImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Pixel size from the PNG IHDR chunk or the first JPEG SOFn marker. */
export function imageSize(b: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (type === 'image/png') {
    if (b.length < 24) return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = view.getUint16(i + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/** Decode and check a browser image. Throws HttpError(400/413) with user-facing copy. */
export function decodeImage(payload: unknown): DecodedImage {
  if (!isRecord(payload) || typeof payload.dataUrl !== 'string') throw new HttpError(400, 'bad-image', 'No image was sent.');
  const p = payload as unknown as ImagePayload;
  const m = /^data:([a-z/+.-]+);base64,/i.exec(p.dataUrl);
  if (!m) throw new HttpError(400, 'bad-image', 'The image must be a base64 data URL.');
  const b64 = p.dataUrl.slice(m[0].length);
  if (b64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) throw new HttpError(413, 'exceed_max_filesize', 'The photo is larger than 10 MB.', 'Use a photo under 10 MB.');
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  if (bytes.byteLength === 0) throw new HttpError(400, 'bad-image', 'The image is empty.');
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'exceed_max_filesize', 'The photo is larger than 10 MB.', 'Use a photo under 10 MB.');
  const contentType = sniffType(bytes);
  if (!contentType) throw new HttpError(400, 'error_decode_image', 'Only JPG and PNG photos are accepted.', 'Use a JPG or PNG photo.');
  const size = imageSize(bytes, contentType);
  if (!size || size.width < 1 || size.height < 1) throw new HttpError(400, 'error_decode_image', 'The photo could not be read.', 'Use a JPG or PNG photo.');
  return { bytes, contentType, ...size };
}

export function toDataUrl(bytes: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}
