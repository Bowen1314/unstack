import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONSENT_VERSION, type ConsentPurpose, type ConsentResponse } from '../shared/api.ts';
import { HttpError, isRecord } from './http.ts';

/**
 * Consent receipts. A receipt records that someone agreed to a consent text
 * version for some purposes, and when. It holds no personal data: no name,
 * IP address, user agent or photo reference. The id is random and lives only
 * in the browser that agreed and in this file.
 *
 * Every error code contains "consent" so the web app can recognise them.
 */

export const PURPOSES: readonly ConsentPurpose[] = ['skin-analysis', 'sun-profile'];

export interface ConsentReceipt {
  consentId: string;
  version: string;
  purposes: ConsentPurpose[];
  grantedAt: string;
  withdrawnAt: string | null;
}

export class ConsentStore {
  private readonly receipts: ConsentReceipt[];

  constructor(
    private readonly path: string | null,
    private readonly now: () => Date = () => new Date(),
    readonly currentVersion: string = CONSENT_VERSION,
  ) {
    this.receipts = path && existsSync(path) ? ((JSON.parse(readFileSync(path, 'utf8')) as { receipts?: ConsentReceipt[] }).receipts ?? []) : [];
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, receipts: this.receipts }, null, 2) + '\n');
    renameSync(tmp, this.path);
  }

  grant(body: unknown): ConsentResponse {
    if (!isRecord(body)) throw new HttpError(400, 'consent-invalid', 'The consent request is malformed.');
    if (body.version !== this.currentVersion) {
      throw new HttpError(409, 'consent-version-mismatch', 'The consent text has changed since this page loaded.', 'Reload the page and review the consent text again.');
    }
    if (body.adult !== true) throw new HttpError(400, 'consent-adult-required', 'Scans are for adults only.', 'Confirm that you are 18 or older.');
    const purposes = Array.isArray(body.purposes) ? [...new Set(body.purposes)] : [];
    if (purposes.length === 0 || !purposes.every((p): p is ConsentPurpose => (PURPOSES as readonly unknown[]).includes(p))) {
      throw new HttpError(400, 'consent-purposes-invalid', 'Unknown or missing consent purposes.');
    }
    const receipt: ConsentReceipt = { consentId: randomUUID(), version: this.currentVersion, purposes, grantedAt: this.now().toISOString(), withdrawnAt: null };
    this.receipts.push(receipt);
    this.save();
    return { consentId: receipt.consentId, version: receipt.version, purposes: receipt.purposes, grantedAt: receipt.grantedAt };
  }

  withdraw(consentId: string): void {
    const r = this.receipts.find((x) => x.consentId === consentId);
    if (!r) throw new HttpError(404, 'consent-not-found', 'No such consent receipt.');
    if (!r.withdrawnAt) {
      r.withdrawnAt = this.now().toISOString();
      this.save();
    }
  }

  /** Throws HttpError 403 unless the receipt exists, is current, not withdrawn, and covers `purpose`. */
  require(consentId: unknown, purpose: ConsentPurpose): ConsentReceipt {
    const r = typeof consentId === 'string' ? this.receipts.find((x) => x.consentId === consentId) : undefined;
    if (!r) throw new HttpError(403, 'consent-required', 'Photo consent is needed before a scan.', 'Review and accept the photo consent on the Scan screen.');
    if (r.withdrawnAt) throw new HttpError(403, 'consent-withdrawn', 'Photo consent was withdrawn.', 'Accept the photo consent again to scan.');
    if (r.version !== this.currentVersion) throw new HttpError(403, 'consent-outdated', 'The consent text has changed.', 'Review the updated photo consent on the Scan screen.');
    if (!r.purposes.includes(purpose)) throw new HttpError(403, 'consent-purpose-missing', `Consent does not cover ${purpose}.`, 'Accept the photo consent again.');
    return r;
  }

  list(): readonly ConsentReceipt[] {
    return this.receipts;
  }
}
