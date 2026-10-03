import { useEffect, useState } from 'react';
import type { JobStage } from '../../../../shared/api.ts';
import { IconAlert, IconTick } from '../../components/icons.tsx';
import { Banner } from '../../components/ui.tsx';
import { plural } from '../../format.ts';
import { useServerStatus } from '../../serverStatus.ts';
import type { ActiveJob } from './jobs.ts';

interface StepDef {
  stage: Exclude<JobStage, 'error'>;
  title: string;
  call: string;
}

const STAGE_INDEX: Record<Exclude<JobStage, 'error'>, number> = {
  queued: 0,
  uploading: 1,
  analysing: 2,
  'copying-results': 3,
  deleting: 4,
  done: 5,
};

export function jobSteps(kind: ActiveJob['kind'], sample: boolean, reserved: number): StepDef[] {
  return [
    { stage: 'queued', title: 'Reserve units', call: `Unit ledger holds ${plural(reserved, 'unit')} against its hard cap` },
    {
      stage: 'uploading',
      title: sample ? 'Point YouCam at the sample' : 'Upload the photo',
      call: sample ? 'src_file_url → YouCam’s public sample image' : 'POST /s2s/v2.0/file → PUT to the presigned URL (relayed from server memory)',
    },
    {
      stage: 'analysing',
      title: kind === 'scan' ? 'Skin analysis' : 'Fitzpatrick analysis',
      call:
        kind === 'scan'
          ? 'POST /s2s/v2.1/task/skin-analysis · polling GET …/skin-analysis/{task_id}'
          : 'POST /s2s/v2.0/task/fitzpatrick-scale-analyzer · polling GET …/{task_id}',
    },
    {
      stage: 'copying-results',
      title: kind === 'scan' ? 'Copy scores and masks' : 'Copy the result',
      call: kind === 'scan' ? 'Mask PNGs fetched before YouCam’s 2-hour URLs expire' : 'fitzpatrick_scale read from the task result',
    },
    { stage: 'deleting', title: 'Delete at YouCam', call: 'POST /s2s/v2.0/task/delete → task, input photo and outputs removed' },
    { stage: 'done', title: 'Done', call: 'Units are charged only when the task succeeds' },
  ];
}

export function JobProgress({ job, onRetake, onRetry, onDismiss }: { job: ActiveJob; onRetake: () => void; onRetry: () => void; onDismiss: () => void }) {
  const server = useServerStatus();
  const [now, setNow] = useState(() => Date.now());
  const failed = job.error !== null;
  const stage = job.status?.stage ?? 'queued';
  const finished = stage === 'done' && !failed;

  useEffect(() => {
    if (failed || finished) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [failed, finished]);

  const steps = jobSteps(job.kind, job.photo.kind === 'sample', job.unitsReserved);
  const current = failed ? STAGE_INDEX[job.lastStage === 'error' ? 'queued' : job.lastStage] : stage === 'error' ? 0 : STAGE_INDEX[stage];
  const elapsed = Math.max(0, Math.round((now - job.startedAt) / 1000));
  const mock = server.status?.mode === 'mock';

  return (
    <section className="card stack" aria-labelledby="job-h">
      <div className="row-between">
        <div>
          <div className="eyebrow">{job.kind === 'scan' ? 'YouCam skin analysis' : 'YouCam sun profile'}</div>
          <h2 id="job-h" style={{ marginTop: 4 }}>
            {failed ? 'The scan stopped' : finished ? 'Finished' : 'Analysing…'}
          </h2>
        </div>
        {!failed && !finished ? <span className="small muted num">{elapsed}s</span> : null}
      </div>
      {mock ? <p className="small muted">Demo mode: the server replays recorded YouCam responses through the same stages. No units are spent.</p> : null}

      <ol className="stepper" aria-label="Scan progress">
        {steps.map((s, i) => {
          const isError = failed && i === current;
          const state = isError ? 'is-error' : i < current || finished ? 'is-done' : i === current ? 'is-current' : 'is-pending';
          return (
            <li key={s.stage} className={`step ${state}`} aria-current={state === 'is-current' ? 'step' : undefined}>
              <span className="step-dot" aria-hidden="true">
                {state === 'is-done' ? <IconTick /> : isError ? <IconAlert /> : state === 'is-current' ? <span className="spinner" /> : i + 1}
              </span>
              <div className="step-body">
                <strong>
                  {s.title}
                  <span className="sr-only">{state === 'is-done' ? ' (done)' : state === 'is-current' ? ' (in progress)' : isError ? ' (failed)' : ''}</span>
                </strong>
                <span className="step-call">{s.call}</span>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="sr-only" aria-live="polite">
        {failed ? `Failed: ${job.error?.title}` : (steps[current]?.title ?? '')}
      </p>
      {job.status?.message && !failed ? <p className="small muted">{job.status.message}</p> : null}

      {failed && job.error ? (
        <div className="stack">
          <Banner tone="error" title={job.error.title} role="alert">
            <span>{job.error.advice}</span>
            <span className="xs subtle mono">{job.error.code}</span>
          </Banner>
          <div className="row">
            {job.error.retake ? (
              <button type="button" className="btn btn--primary" onClick={onRetake}>
                Retake photo
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={onRetry}>
                Try again
              </button>
            )}
            <button type="button" className="btn" onClick={onDismiss}>
              Back
            </button>
          </div>
          <p className="xs subtle">Failed YouCam tasks are not charged; the reserved units go back to the ledger.</p>
        </div>
      ) : null}
    </section>
  );
}
