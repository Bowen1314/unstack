import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../server/http.ts';
import { cleanTranscript, LabelReader, NEBIUS_PRICES } from '../server/labelReader.ts';
import { dataUrl, jpegBytes, tempDir } from './support.ts';

const image = { dataUrl: dataUrl(jpegBytes(1200, 900), 'image/jpeg') };

function reader(reply: unknown, opts: { capUsd?: number; ledgerPath?: string | null; status?: number } = {}) {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return Response.json(reply, { status: opts.status ?? 200 });
  };
  const r = new LabelReader({ apiKey: 'k', model: 'openbmb/MiniCPM-V-4_5', capUsd: opts.capUsd ?? 1, ledgerPath: opts.ledgerPath ?? null, fetchImpl });
  return { r, calls: () => calls };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e.code;
    throw e;
  }
  return 'no error';
}

describe('label reader', () => {
  it('has the published Nebius price for the configured model', () => {
    expect(NEBIUS_PRICES['openbmb/MiniCPM-V-4_5']).toMatchObject({ inputPer1M: 0.658, outputPer1M: 1.11 });
  });

  it('cleans model output', () => {
    expect(cleanTranscript('<think>hmm</think>\n```\nIngredients: Aqua, Glycerin\n```')).toBe('Aqua, Glycerin');
    expect(cleanTranscript('INCI： Aqua')).toBe('Aqua');
  });

  it('books every call in a USD spend ledger on disk', async () => {
    const path = join(tempDir(), 'llm-spend.json');
    const { r } = reader({ choices: [{ message: { content: 'Aqua, Retinol' } }], usage: { prompt_tokens: 1000, completion_tokens: 10 } }, { ledgerPath: path });
    const res = await r.read(image);
    expect(res.costUsd).toBeCloseTo(0.0006691, 7);
    const file = JSON.parse(readFileSync(path, 'utf8')) as { price: { inputPer1M: number }; entries: unknown[] };
    expect(file.price.inputPer1M).toBe(0.658);
    expect(file.entries).toHaveLength(1);
    expect(new LabelReader({ apiKey: 'k', model: 'openbmb/MiniCPM-V-4_5', capUsd: 1, ledgerPath: path }).spentUsd).toBeCloseTo(0.0006691, 7);
  });

  it('charges the worst case when the provider sends no usage', async () => {
    const { r } = reader({ choices: [{ message: { content: 'Aqua' } }] });
    const res = await r.read(image);
    expect(res.costUsd).toBe(r.worstCaseUsd);
  });

  it('says so when no list is legible', async () => {
    const { r } = reader({ choices: [{ message: { content: 'NONE' } }], usage: { prompt_tokens: 900, completion_tokens: 1 } });
    expect(await codeOf(r.read(image))).toBe('label-unreadable');
  });

  it('refuses up front when a call could cross the cap', async () => {
    const { r, calls } = reader({}, { capUsd: 0.001 });
    expect(await codeOf(r.read(image))).toBe('llm-cap-reached');
    expect(calls()).toBe(0);
  });

  it('is off without a key, and reports provider errors without details', async () => {
    const off = new LabelReader({ apiKey: null, model: 'openbmb/MiniCPM-V-4_5', capUsd: 1, ledgerPath: null });
    expect(off.enabled).toBe(false);
    expect(await codeOf(off.read(image))).toBe('llm-disabled');
    const { r } = reader({ error: 'bad' }, { status: 500 });
    expect(await codeOf(r.read(image))).toBe('llm-error');
    const broke = reader({ detail: 'Payment Required' }, { status: 402 });
    expect(await codeOf(broke.r.read(image))).toBe('llm-no-credit');
    expect(broke.r.spentUsd).toBe(0);
    expect(await codeOf(r.read({ dataUrl: 'data:text/plain;base64,aGk=' }))).toBe('error_decode_image');
  });
});
