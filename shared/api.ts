/** HTTP contract between the web app and the Unstack server. */
import type { CaptureMethod, Concern, ScanQuality, ScanResult, SunProfile } from './types.ts';

export const CONSENT_VERSION = '2026-10-02';

export interface StatusResponse {
  mode: 'mock' | 'live';
  units: {
    cap: number;
    used: number;
    reserved: number;
    available: number;
    ledger: 'mock' | 'live';
  };
  /** Remaining units on the YouCam account (live mode only; null if unknown). */
  youcamBalance: number | null;
  prices: { source: 'docs' | 'docs+live'; fitzpatrick: number };
  llm: {
    enabled: boolean;
    model: string | null;
    spentUsd: number;
    capUsd: number;
    /** Published per-token price used for the spend ledger (USD per 1M tokens). */
    price?: { inputPer1M: number; outputPer1M: number; source: string } | null;
  };
  consentVersion: string;
}

export type ConsentPurpose = 'skin-analysis' | 'sun-profile';

export interface ConsentRequest {
  version: string;
  adult: boolean;
  purposes: ConsentPurpose[];
}

export interface ConsentResponse {
  consentId: string;
  version: string;
  purposes: ConsentPurpose[];
  grantedAt: string;
}

/** An image sent by the browser. Kept in server memory only for the length of the job. */
export interface ImagePayload {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ScanRequest {
  consentId: string;
  image?: ImagePayload;
  sampleId?: string;
  concerns: Concern[];
  quality: ScanQuality;
  captureMethod: CaptureMethod;
}

export interface SunProfileRequest {
  consentId: string;
  image?: ImagePayload;
  sampleId?: string;
}

export interface JobCreated {
  jobId: string;
  unitsReserved: number;
}

export type JobStage = 'queued' | 'uploading' | 'analysing' | 'copying-results' | 'deleting' | 'done' | 'error';

export interface JobError {
  code: string;
  title: string;
  advice: string;
  retake: boolean;
}

export interface JobStatus {
  id: string;
  kind: 'scan' | 'sun-profile';
  stage: JobStage;
  message: string;
  startedAt: string;
  result?: ScanResult | SunProfile;
  error?: JobError;
  unitsReserved: number;
  unitsCharged: number;
}

export interface LabelReadRequest {
  image: ImagePayload;
}

export interface LabelReadResponse {
  text: string;
  model: string;
  costUsd: number;
  mock: boolean;
}

export interface SampleImage {
  id: string;
  label: string;
  url: string;
  width: number;
  height: number;
  credit: string;
}

export interface ApiErrorBody {
  error: string;
  code: string;
  advice?: string;
}
