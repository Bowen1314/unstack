import { useId, useState } from 'react';
import type { SampleImage } from '../../../../shared/api.ts';
import { IconCamera, IconImage, IconTick, IconUpload } from '../../components/icons.tsx';
import { Banner, Spinner } from '../../components/ui.tsx';
import { checkPhotoFile, preparePhoto, readFileAsDataUrl } from '../../image.ts';
import { qualityLabel } from '../../format.ts';
import { CameraKitCapture } from './CameraKitCapture.tsx';
import { PHOTO_TIPS, photoQuality, photoSize, photoSrc, type PhotoChoice } from './photo.ts';

type Source = 'sample' | 'upload' | 'camera';

export interface SamplesState {
  list: SampleImage[] | null;
  error: string | null;
}

function Tips() {
  return (
    <ul className="tips" aria-label="Photo tips">
      {PHOTO_TIPS.map((t) => (
        <li key={t}>
          <IconTick />
          {t}
        </li>
      ))}
    </ul>
  );
}

export function PhotoSource({ photo, onChange, samples }: { photo: PhotoChoice | null; onChange: (p: PhotoChoice | null) => void; samples: SamplesState }) {
  const uid = useId();
  const [source, setSource] = useState<Source>(photo?.kind ?? 'sample');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = (s: Source) => {
    setSource(s);
    setProblem(null);
    if (s !== 'camera') setCameraOpen(false);
  };

  const onFile = async (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    const bad = checkPhotoFile(file);
    if (bad) {
      setProblem(bad);
      return;
    }
    setBusy(true);
    try {
      const raw = await readFileAsDataUrl(file);
      const prepared = await preparePhoto(raw);
      const choice: PhotoChoice = { kind: 'upload', ...prepared, name: file.name };
      if (!photoQuality(choice)) {
        setProblem(`This photo is ${prepared.width} × ${prepared.height} px. YouCam needs at least 480 px on the short side (1080 px for HD).`);
        return;
      }
      onChange(choice);
    } catch {
      setProblem('We couldn’t read that image. Try a different JPG or PNG.');
    } finally {
      setBusy(false);
    }
  };

  const quality = photo ? photoQuality(photo) : null;
  const size = photo ? photoSize(photo) : null;

  return (
    <div className="stack">
      <div className="seg" role="radiogroup" aria-label="Photo source">
        {(
          [
            ['sample', 'YouCam samples', IconImage],
            ['upload', 'Upload', IconUpload],
            ['camera', 'Camera guide', IconCamera],
          ] as const
        ).map(([id, label, Icon]) => (
          <label key={id}>
            <input type="radio" name={`${uid}-src`} value={id} checked={source === id} onChange={() => pick(id)} />
            <Icon width={15} height={15} />
            {label}
          </label>
        ))}
      </div>

      {source === 'sample' ? (
        <div className="stack-sm">
          <p className="small muted">Sample faces from YouCam’s own documentation. Good for trying Unstack without using your own photo.</p>
          {samples.error ? (
            <Banner tone="warn" title="Samples unavailable">
              <span>{samples.error}</span>
            </Banner>
          ) : !samples.list ? (
            <Spinner label="Loading samples…" />
          ) : samples.list.length === 0 ? (
            <p className="small muted">No sample images on this server.</p>
          ) : (
            <>
              <div className="sample-grid">
                {samples.list.map((s) => {
                  const selected = photo?.kind === 'sample' && photo.sample.id === s.id;
                  return (
                    <button key={s.id} type="button" className="sample" aria-pressed={selected} onClick={() => onChange({ kind: 'sample', sample: s })}>
                      <img src={s.url} alt={s.label} loading="lazy" width={s.width} height={s.height} />
                      <span className="sample-label">{s.label}</span>
                      {selected ? (
                        <span className="sample-check" aria-hidden="true">
                          <IconTick />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="xs subtle">{[...new Set(samples.list.map((s) => s.credit))].join(' · ')}</p>
            </>
          )}
        </div>
      ) : null}

      {source === 'upload' ? (
        <div className="stack">
          <label className="dropzone" htmlFor={`${uid}-file`}>
            <IconUpload />
            <strong>{busy ? 'Reading photo…' : 'Choose a face photo'}</strong>
            <span className="small muted">JPG or PNG, under 10 MB, at least 480 px on the short side (1080 px for HD).</span>
            <input
              id={`${uid}-file`}
              type="file"
              accept="image/jpeg,image/png"
              disabled={busy}
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <Tips />
        </div>
      ) : null}

      {source === 'camera' ? (
        cameraOpen ? (
          <CameraKitCapture
            onCapture={(shot) => {
              setCameraOpen(false);
              const choice: PhotoChoice = { kind: 'camera', ...shot };
              if (!photoQuality(choice)) {
                setProblem(`The camera captured ${shot.width} × ${shot.height} px, below YouCam’s 480 px minimum. Try uploading a photo instead.`);
                return;
              }
              onChange(choice);
            }}
            onCancel={(reason) => {
              setCameraOpen(false);
              if (reason) {
                setProblem(reason);
                setSource('upload');
              }
            }}
          />
        ) : (
          <div className="stack">
            <p className="small muted">
              The YouCam Camera Kit checks distance, pose and light live, then captures automatically. Use it for experiment check-ins so every photo is taken
              the same way. It loads from YouCam only when you press the button.
            </p>
            <div>
              <button type="button" className="btn btn--primary" onClick={() => setCameraOpen(true)}>
                <IconCamera />
                Use camera guide
              </button>
            </div>
            <Tips />
          </div>
        )
      ) : null}

      {problem ? (
        <Banner tone="warn" title="Can’t use that photo" role="alert">
          <span>{problem}</span>
        </Banner>
      ) : null}

      {photo && size ? (
        <div className="photo-chosen card card--sunk card--tight">
          <img src={photoSrc(photo)} alt="The photo you chose" />
          <div className="stack-sm">
            <strong>{photo.kind === 'sample' ? photo.sample.label : photo.kind === 'camera' ? 'Captured with the camera guide' : photo.name}</strong>
            <span className="small muted num">
              {size.width} × {size.height} px
            </span>
            <span className="row">
              {quality === 'hd' ? (
                <span className="tag tag--ok">HD-capable</span>
              ) : quality === 'sd' ? (
                <span className="tag tag--info">SD only · short side under 1080 px</span>
              ) : (
                <span className="tag tag--high">Too small</span>
              )}
              <span className="xs subtle">Best quality: {quality ? qualityLabel(quality) : '—'}</span>
            </span>
            <div>
              <button type="button" className="link-btn small" onClick={() => onChange(null)}>
                Clear photo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
