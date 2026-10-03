import type { ImagePayload, SampleImage } from '../../../../shared/api.ts';
import { qualityForImage } from '../../../../shared/pricing.ts';
import type { CaptureMethod, ScanQuality } from '../../../../shared/types.ts';

export type PhotoChoice =
  | { kind: 'sample'; sample: SampleImage }
  | { kind: 'upload'; dataUrl: string; width: number; height: number; name: string }
  | { kind: 'camera'; dataUrl: string; width: number; height: number };

export function photoSrc(p: PhotoChoice): string {
  return p.kind === 'sample' ? p.sample.url : p.dataUrl;
}

export function photoSize(p: PhotoChoice): { width: number; height: number } {
  return p.kind === 'sample' ? { width: p.sample.width, height: p.sample.height } : { width: p.width, height: p.height };
}

export function photoQuality(p: PhotoChoice): ScanQuality | null {
  const { width, height } = photoSize(p);
  return qualityForImage(width, height);
}

export function captureMethodOf(p: PhotoChoice): CaptureMethod {
  return p.kind === 'sample' ? 'sample' : p.kind === 'camera' ? 'camera-kit' : 'upload';
}

/** The part of a scan/sun-profile request that identifies the photo. */
export function photoPayload(p: PhotoChoice): { sampleId: string } | { image: ImagePayload } {
  return p.kind === 'sample' ? { sampleId: p.sample.id } : { image: { dataUrl: p.dataUrl, width: p.width, height: p.height } };
}

export const PHOTO_TIPS = [
  'Face fills more than 60% of the photo’s width',
  'Even light: face a window or a soft lamp',
  'No glasses, and hair off the forehead',
  'No makeup',
  'Look straight ahead, mouth closed',
  'Portrait orientation',
] as const;
