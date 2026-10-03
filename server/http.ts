import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiErrorBody } from '../shared/api.ts';

/** An error that maps straight to an ApiErrorBody response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly advice?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  body(): ApiErrorBody {
    return this.advice ? { error: this.message, code: this.code, advice: this.advice } : { error: this.message, code: this.code };
  }
}

const API_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, API_HEADERS);
  res.end();
}

export function sendError(res: ServerResponse, err: HttpError): void {
  sendJson(res, err.status, err.body());
}

/** Read a JSON body with a hard size limit. Only application/json is accepted (see checkRequestOrigin). */
export async function readJson(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > limitBytes) throw tooLarge(limitBytes);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limitBytes) throw tooLarge(limitBytes);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new HttpError(400, 'bad-json', 'The request body is empty.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'bad-json', 'The request body is not valid JSON.');
  }
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, 'too-large', `The request is larger than ${Math.round(limit / 1024 / 1024)} MB.`, 'Use a photo under 10 MB.');
}

/**
 * The server listens on loopback only, but a web page in the same browser can
 * still send requests to it. Paid endpoints must not be reachable that way:
 * - Host must be a loopback name (blocks DNS rebinding);
 * - Origin, when the browser sends one, must be this server;
 * - writes must be application/json, which forces a CORS preflight that this
 *   server never answers, so cross-site "simple" requests can't get through.
 */
export function checkRequestOrigin(req: IncomingMessage, port: number): void {
  const host = (req.headers.host ?? '').toLowerCase();
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (!allowedHosts.includes(host)) throw new HttpError(403, 'bad-host', 'Requests must use a loopback address.');
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) throw new HttpError(403, 'cross-origin', 'Cross-origin requests are not allowed.');
  if (req.method === 'POST') {
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json') throw new HttpError(415, 'json-required', 'Send the request as application/json.');
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
