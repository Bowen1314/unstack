import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION } from '../shared/api.ts';
import { ConsentStore } from '../server/consent.ts';
import { HttpError } from '../server/http.ts';
import { tempDir } from './support.ts';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e.code;
    throw e;
  }
  throw new Error('expected an error');
}

const ok = { version: CONSENT_VERSION, adult: true, purposes: ['skin-analysis', 'sun-profile'] };

describe('consent receipts', () => {
  it('uses the 2026-10-02 consent text version (the web app falls back to the same constant)', () => {
    expect(CONSENT_VERSION).toBe('2026-10-02');
  });

  it('grants a receipt for the current version', () => {
    const s = new ConsentStore(null);
    const r = s.grant(ok);
    expect(r.version).toBe('2026-10-02');
    expect(r.purposes).toEqual(['skin-analysis', 'sun-profile']);
    expect(r.consentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.require(r.consentId, 'skin-analysis').consentId).toBe(r.consentId);
  });

  it('rejects bad requests, and every code contains "consent"', () => {
    const s = new ConsentStore(null);
    const codes = [
      codeOf(() => s.grant({ ...ok, version: '2025-01-01' })),
      codeOf(() => s.grant({ ...ok, adult: false })),
      codeOf(() => s.grant({ ...ok, purposes: [] })),
      codeOf(() => s.grant({ ...ok, purposes: ['marketing'] })),
      codeOf(() => s.grant('nope')),
      codeOf(() => s.require(undefined, 'skin-analysis')),
      codeOf(() => s.require('not-a-receipt', 'skin-analysis')),
      codeOf(() => s.withdraw('00000000-0000-0000-0000-000000000000')),
    ];
    expect(codes).toEqual([
      'consent-version-mismatch',
      'consent-adult-required',
      'consent-purposes-invalid',
      'consent-purposes-invalid',
      'consent-invalid',
      'consent-required',
      'consent-required',
      'consent-not-found',
    ]);
    for (const c of codes) expect(c).toMatch(/consent/i);
  });

  it('withdrawn, outdated and narrower receipts are refused', () => {
    const path = join(tempDir(), 'consent-receipts.json');
    const s = new ConsentStore(path);
    const full = s.grant(ok);
    const scanOnly = s.grant({ ...ok, purposes: ['skin-analysis'] });
    expect(codeOf(() => s.require(scanOnly.consentId, 'sun-profile'))).toBe('consent-purpose-missing');
    s.withdraw(full.consentId);
    expect(codeOf(() => s.require(full.consentId, 'skin-analysis'))).toBe('consent-withdrawn');
    const later = new ConsentStore(path, () => new Date(), '2027-01-01');
    expect(codeOf(() => later.require(scanOnly.consentId, 'skin-analysis'))).toBe('consent-outdated');
  });

  it('a receipt file holds no personal data', () => {
    const path = join(tempDir(), 'consent-receipts.json');
    const s = new ConsentStore(path);
    s.withdraw(s.grant(ok).consentId);
    const file = JSON.parse(readFileSync(path, 'utf8')) as { receipts: Record<string, unknown>[] };
    expect(Object.keys(file.receipts[0]!).sort()).toEqual(['consentId', 'grantedAt', 'purposes', 'version', 'withdrawnAt']);
    expect(new ConsentStore(path).list()).toHaveLength(1);
  });
});
