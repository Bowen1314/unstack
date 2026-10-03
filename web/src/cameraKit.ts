/**
 * YouCam JS Camera Kit (v2.5) loader and types, from the "JS Camera Kit"
 * section of docs.perfectcorp.com/reference/ai_skin_analysis. The script is
 * loaded lazily: only after consent, and only when the user clicks
 * "Use camera guide". Nothing is fetched from plugins-media.makeupar.com before that.
 */

export const CAMERA_KIT_SRC = 'https://plugins-media.makeupar.com/v2.5-camera-kit/sdk.js';

export interface FaceQuality {
  hasFace: boolean;
  position: 'good' | 'notgood' | 'toosmall' | 'outofboundary';
  frontal: 'good' | 'notgood';
  lighting: 'good' | 'ok' | 'notgood';
}

export interface CapturedImage {
  phase: number;
  image: string | Blob;
  width: number;
  height: number;
}

export interface FaceCaptured {
  mode: string;
  images: CapturedImage[];
}

export interface YmkInitOptions {
  faceDetectionMode: 'skincare' | 'hdskincare' | 'makeup';
  imageFormat: 'base64' | 'blob';
  language: 'enu';
  qualityLevel: 'relaxed' | 'moderate' | 'strict';
  width?: number;
  height?: number;
  videoQuality?: '720p' | '1080p' | '1920p';
  countingDuration?: number;
}

export interface YmkEventMap {
  faceQualityChanged: FaceQuality;
  faceDetectionCaptured: FaceCaptured;
  cameraFailed: string;
  closed: undefined;
  loaded: undefined;
  cameraOpened: undefined;
}

export interface Ymk {
  init(opts: YmkInitOptions): void;
  openCameraKit(): void;
  close(): void;
  addEventListener<K extends keyof YmkEventMap>(event: K, cb: (payload: YmkEventMap[K]) => void): unknown;
  removeEventListener(id: unknown): void;
  isLoaded?(): boolean;
}

declare global {
  interface Window {
    YMK?: Ymk;
    YMKAsyncInit?: () => void;
  }
}

let loading: Promise<Ymk> | null = null;

export function loadCameraKit(timeoutMs = 20_000): Promise<Ymk> {
  if (window.YMK) return Promise.resolve(window.YMK);
  if (loading) return loading;
  loading = new Promise<Ymk>((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('The YouCam Camera Kit took too long to load.')), timeoutMs);
    function fail(err: Error) {
      clearTimeout(timer);
      loading = null;
      reject(err);
    }
    // Must exist before the script runs (documented requirement).
    window.YMKAsyncInit = () => {
      clearTimeout(timer);
      if (window.YMK) resolve(window.YMK);
      else fail(new Error('The YouCam Camera Kit loaded without its API.'));
    };
    const script = document.createElement('script');
    script.src = CAMERA_KIT_SRC;
    script.async = true;
    script.onerror = () => {
      script.remove();
      fail(new Error('Could not download the YouCam Camera Kit. Check your connection, or upload a photo instead.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * The kit needs a <div id="YMK-module">. We create it once and move the same
 * element in and out of the page, so the kit always talks to the node it was
 * initialised with, however often the camera panel is opened.
 */
let mountNode: HTMLDivElement | null = null;
export function cameraMountNode(): HTMLDivElement {
  if (!mountNode) {
    mountNode = document.createElement('div');
    mountNode.id = 'YMK-module';
  }
  return mountNode;
}

let initialised = false;
export function ensureInit(ymk: Ymk, width: number): void {
  if (initialised) return;
  ymk.init({
    faceDetectionMode: 'skincare',
    imageFormat: 'base64',
    language: 'enu',
    qualityLevel: 'moderate',
    width,
    height: Math.round((width * 4) / 3),
  });
  initialised = true;
}

const CAMERA_FAILURES: Record<string, string> = {
  error_permission_denied: 'Camera permission was denied. Allow camera access in your browser, or upload a photo instead.',
  error_access_failed: 'The camera could not be opened. It may be in use by another app, or this browser blocks it.',
  error_resolution_unsupported: 'Your camera’s resolution isn’t supported by the camera guide. Upload a photo instead.',
};

export function cameraFailureMessage(code: unknown): string {
  return (typeof code === 'string' && CAMERA_FAILURES[code]) || 'The camera guide could not start here. Upload a photo instead.';
}

export const QUALITY_COPY = {
  position: {
    good: { level: 'good', text: 'Framed well' },
    notgood: { level: 'bad', text: 'Centre your face' },
    toosmall: { level: 'bad', text: 'Move closer' },
    outofboundary: { level: 'bad', text: 'Keep your whole face in frame' },
  },
  frontal: {
    good: { level: 'good', text: 'Facing the camera' },
    notgood: { level: 'bad', text: 'Look straight ahead' },
  },
  lighting: {
    good: { level: 'good', text: 'Even light' },
    ok: { level: 'ok', text: 'Light is OK; brighter is better' },
    notgood: { level: 'bad', text: 'Too dark; face a window' },
  },
} as const;
