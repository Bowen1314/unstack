/**
 * Unstack server: plain node:http, no framework.
 *
 *   npm run dev     API + the web app through Vite middleware (one port)
 *   npm start       API + the built web app from dist/web (run `npm run build` first)
 *
 * Listens on 127.0.0.1:8796 by default (UNSTACK_HOST / UNSTACK_PORT).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler, createServices, warmUp } from './app.ts';
import { isLive, loadConfig } from './config.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const config = loadConfig(rootDir);
const services = createServices(config);
const api = createApiHandler(services);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve dist/web with an SPA fallback to index.html. */
function staticHandler(dir: string): (req: IncomingMessage, res: ServerResponse) => void {
  const index = resolve(dir, 'index.html');
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let file = resolve(dir, `.${path}`);
    if (file !== dir && !file.startsWith(dir + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) file = index;
    const hashed = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  };
}

async function main(): Promise<void> {
  const server = createServer();
  let web: (req: IncomingMessage, res: ServerResponse) => void;

  if (dev) {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({
      configFile: resolve(rootDir, 'vite.config.ts'),
      root: resolve(rootDir, 'web'),
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server } },
    });
    web = (req, res) =>
      vite.middlewares(req, res, () => {
        res.writeHead(404).end();
      });
  } else {
    const dist = resolve(rootDir, 'dist/web');
    if (!existsSync(resolve(dist, 'index.html'))) {
      console.error('dist/web is missing. Run `npm run build` first, or use `npm run dev`.');
      process.exit(1);
    }
    web = staticHandler(dist);
  }

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    api(req, res)
      .then((handled) => {
        if (!handled) web(req, res);
      })
      .catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
  });

  server.listen(config.port, config.host, () => {
    const mode = services.mode === 'live' ? 'LIVE (real YouCam API, spends units)' : config.youcamApiKey && config.forceMock ? 'demo (UNSTACK_FORCE_MOCK=1)' : 'demo (no YouCam key)';
    const snap = services.ledger.snapshot();
    console.log(`Unstack ${dev ? 'dev' : 'production'} server on http://${config.host}:${config.port}`);
    console.log(`  YouCam: ${mode}`);
    console.log(`  Unit ledger: ${snap.used} used of a ${snap.cap}-unit cap${services.mode === 'live' ? ' (data/unit-ledger.json)' : ' (in memory)'}`);
    console.log(`  Label reader: ${services.labels.enabled ? `${services.labels.model}, $${services.labels.spentUsd.toFixed(4)} of $${services.labels.capUsd.toFixed(2)} cap` : 'off (no UNSTACK_NEBIUS_API_KEY)'}`);
  });
  if (isLive(config)) void warmUp(services);

  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

void main();
