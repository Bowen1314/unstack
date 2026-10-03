import type { SampleImage } from '../shared/api.ts';

/**
 * Perfect Corp. sample faces served from YouCam's own CDN (plugins-media.makeupar.com).
 * No license is stated for them, so they are only hotlinked, never copied into
 * this repository, and neither are the masks YouCam produced from them (see README).
 */
export const SAMPLES: SampleImage[] = [
  {
    id: 'yc-skin-01',
    label: 'Sample A',
    url: 'https://plugins-media.makeupar.com/strapi/assets/skin_analysis_01_5b5defd339.png',
    width: 1200,
    height: 1600,
    credit: 'YouCam API documentation sample image (Perfect Corp.)',
  },
  {
    id: 'yc-sample-1',
    label: 'Sample B',
    url: 'https://plugins-media.makeupar.com/strapi/assets/sample_Image_1_202b6bf6e6.jpg',
    width: 1080,
    height: 1437,
    credit: 'YouCam API documentation sample image (Perfect Corp.)',
  },
  {
    id: 'yc-sample-7',
    label: 'Sample C',
    url: 'https://plugins-media.makeupar.com/strapi/assets/sample_Image_7_fa28b2618a.jpg',
    width: 1080,
    height: 1437,
    credit: 'YouCam API documentation sample image (Perfect Corp.)',
  },
];

export function findSample(id: string | undefined): SampleImage | undefined {
  return id ? SAMPLES.find((s) => s.id === id) : undefined;
}
