import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../server/http.ts';
import { decodeImage, imageSize, sniffType, toDataUrl } from '../server/images.ts';
import { dataUrl, FIXTURES, HAS_MASKS, jpegBytes, pngBytes } from './support.ts';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e.code;
    throw e;
  }
  return 'no error';
}

describe('image checks', () => {
  it('sniffs type and size from bytes', () => {
    expect(sniffType(pngBytes(1200, 1600))).toBe('image/png');
    expect(imageSize(pngBytes(1200, 1600), 'image/png')).toEqual({ width: 1200, height: 1600 });
    expect(sniffType(jpegBytes(1080, 1437))).toBe('image/jpeg');
    expect(imageSize(jpegBytes(1080, 1437), 'image/jpeg')).toEqual({ width: 1080, height: 1437 });
    expect(sniffType(new TextEncoder().encode('GIF89a......'))).toBeNull();
  });

  it.skipIf(!HAS_MASKS)('reads a real YouCam mask: same pixel size as the sample photo', () => {
    const mask = new Uint8Array(readFileSync(resolve(FIXTURES, 'masks/yc-skin-01/pore.png')));
    expect(imageSize(mask, 'image/png')).toEqual({ width: 1200, height: 1600 });
  });

  it('decodes a data URL, trusting the bytes over the declared MIME type', () => {
    const img = decodeImage({ dataUrl: dataUrl(jpegBytes(800, 1000), 'image/png'), width: 1, height: 1 });
    expect(img.contentType).toBe('image/jpeg');
    expect([img.width, img.height]).toEqual([800, 1000]);
    expect(toDataUrl(img.bytes, img.contentType).startsWith('data:image/jpeg;base64,/9j/')).toBe(true);
  });

  it('rejects anything that is not a JPG or PNG under 10 MB', () => {
    expect(codeOf(() => decodeImage(undefined))).toBe('bad-image');
    expect(codeOf(() => decodeImage({ dataUrl: 'https://example.com/a.jpg' }))).toBe('bad-image');
    expect(codeOf(() => decodeImage({ dataUrl: dataUrl(new TextEncoder().encode('GIF89a-not-allowed'), 'image/gif') }))).toBe('error_decode_image');
    const big = new Uint8Array(10 * 1024 * 1024 + 10);
    big.set(pngBytes(4000, 3000));
    expect(codeOf(() => decodeImage({ dataUrl: dataUrl(big, 'image/png') }))).toBe('exceed_max_filesize');
  });
});
