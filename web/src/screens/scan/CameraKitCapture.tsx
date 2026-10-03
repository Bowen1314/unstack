import { useEffect, useRef, useState } from 'react';
import { cameraFailureMessage, cameraMountNode, ensureInit, loadCameraKit, QUALITY_COPY, type FaceQuality, type Ymk } from '../../cameraKit.ts';
import { Banner, Spinner } from '../../components/ui.tsx';
import { asDataUrl } from '../../image.ts';

export interface CameraShot {
  dataUrl: string;
  width: number;
  height: number;
}

type Level = 'good' | 'ok' | 'bad';

function Hint({ label, level, text }: { label: string; level: Level; text: string }) {
  return (
    <li className={`quality-hint quality-hint--${level}`}>
      <span className="subtle">{label}</span>
      <strong>{text}</strong>
    </li>
  );
}

/**
 * YouCam JS Camera Kit, mounted only after consent and only when the user asks
 * for it. It guides distance, pose and light, and auto-captures when they are
 * all good, which keeps experiment photos comparable week to week.
 */
export function CameraKitCapture({ onCapture, onCancel }: { onCapture: (shot: CameraShot) => void; onCancel: (reason?: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'loading' | 'live' | 'error'>('loading');
  const [quality, setQuality] = useState<FaceQuality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef(onCapture);
  const cancelRef = useRef(onCancel);
  captureRef.current = onCapture;
  cancelRef.current = onCancel;

  useEffect(() => {
    const node = cameraMountNode();
    host.current?.appendChild(node);
    let cancelled = false;
    let done = false;
    let ymk: Ymk | null = null;
    const ids: unknown[] = [];

    const fail = (msg: string) => {
      done = true;
      setError(msg);
      setPhase('error');
      try {
        ymk?.close();
      } catch {
        /* ignore */
      }
    };

    loadCameraKit()
      .then((k) => {
        if (cancelled) return;
        ymk = k;
        if (typeof k.addEventListener !== 'function' || typeof k.openCameraKit !== 'function') {
          fail('This version of the YouCam Camera Kit has an API we don’t recognise. Upload a photo instead.');
          return;
        }
        ids.push(k.addEventListener('faceQualityChanged', (q) => setQuality(q)));
        ids.push(
          k.addEventListener('faceDetectionCaptured', (res) => {
            const img = res?.images?.[0];
            if (!img || typeof img.image !== 'string') {
              fail('The camera guide returned an image we can’t use. Upload a photo instead.');
              return;
            }
            done = true;
            try {
              k.close();
            } catch {
              /* ignore */
            }
            captureRef.current({ dataUrl: asDataUrl(img.image), width: img.width, height: img.height });
          }),
        );
        ids.push(k.addEventListener('cameraFailed', (code) => fail(cameraFailureMessage(code))));
        ids.push(
          k.addEventListener('closed', () => {
            if (!done) cancelRef.current();
          }),
        );
        const width = Math.max(240, Math.min(480, host.current?.clientWidth ?? 360));
        ensureInit(k, width);
        k.openCameraKit();
        setPhase('live');
      })
      .catch((err: unknown) => {
        if (!cancelled) fail(err instanceof Error ? err.message : 'The camera guide could not load.');
      });

    return () => {
      cancelled = true;
      if (ymk) {
        for (const id of ids) {
          try {
            ymk.removeEventListener(id);
          } catch {
            /* ignore */
          }
        }
        if (!done) {
          try {
            ymk.close();
          } catch {
            /* ignore */
          }
        }
      }
      node.remove();
    };
  }, []);

  const pos = quality ? QUALITY_COPY.position[quality.position] : null;
  const front = quality ? QUALITY_COPY.frontal[quality.frontal] : null;
  const light = quality ? QUALITY_COPY.lighting[quality.lighting] : null;

  return (
    <div className="camera-stage">
      {phase === 'loading' ? <Spinner label="Loading the YouCam Camera Kit…" /> : null}
      <div ref={host} aria-label="YouCam camera guide" />
      {phase === 'live' ? (
        <div aria-live="polite" className="stack-sm">
          {quality && !quality.hasFace ? (
            <p className="small muted">Looking for your face…</p>
          ) : pos && front && light ? (
            <ul className="quality-hints" aria-label="Live capture hints">
              <Hint label="Position" level={pos.level} text={pos.text} />
              <Hint label="Pose" level={front.level} text={front.text} />
              <Hint label="Light" level={light.level} text={light.text} />
            </ul>
          ) : (
            <p className="small muted">Hold still; it captures automatically when position, pose and light are all good.</p>
          )}
        </div>
      ) : null}
      {phase === 'error' && error ? (
        <Banner tone="warn" title="Camera guide unavailable" role="alert">
          <span>{error}</span>
        </Banner>
      ) : null}
      <div className="row">
        <button type="button" className="btn" onClick={() => cancelRef.current(phase === 'error' ? (error ?? undefined) : undefined)}>
          {phase === 'error' ? 'Upload a photo instead' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
