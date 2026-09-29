import http from 'node:http';
import https from 'node:https';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateSchema } from '../src/model.ts';
import { foodSearch } from './food-search.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = resolve(process.env.STEADY_DATA_DIR || join(root, '.steady-data'));
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const tokenFile = join(dataDir, 'pairing-key');
let token;
try { token = (await readFile(tokenFile, 'utf8')).trim(); }
catch (error) { if (error.code !== 'ENOENT') throw error; token = randomBytes(24).toString('base64url'); await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' }); }
const snapshotFile = join(dataDir, 'diary.json');
let snapshot = { revision: 0, payload: null };
try { snapshot = JSON.parse(await readFile(snapshotFile, 'utf8')); stateSchema.parse(snapshot.payload); if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) throw new Error('Invalid saved revision'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const host = process.env.STEADY_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const tls = process.env.STEADY_TLS_CERT && process.env.STEADY_TLS_KEY ? { cert: await readFile(process.env.STEADY_TLS_CERT), key: await readFile(process.env.STEADY_TLS_KEY) } : null;
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !tls) throw new Error('LAN access needs HTTPS. Set STEADY_TLS_CERT and STEADY_TLS_KEY; see README. For USB/desktop use the default localhost server.');
const allowedOrigins = new Set(['http://localhost', 'https://localhost', 'capacitor://localhost', ...(process.env.STEADY_ALLOWED_ORIGINS || '').split(',').filter(Boolean)]);
let writing = Promise.resolve();
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); }
function authorized(req) {
  const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(token); return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 20_000_000) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function handler(req, res) {
  try {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      const origin = req.headers.origin;
      const sameOrigin = `${tls ? 'https' : 'http'}://${req.headers.host}`;
      if (origin && origin !== sameOrigin && !allowedOrigins.has(origin)) return json(res, 403, { error: 'Origin not allowed' });
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type'); res.writeHead(204); return res.end(); }
      if (path === '/api/food-search' && req.method === 'GET') { const result = await foodSearch(new URL(req.url, 'http://localhost').searchParams); return json(res, result.status, result.body); }
      if (!authorized(req)) return json(res, 401, { error: 'Pairing key required' });
      if (path === '/api/status' && req.method === 'GET') return json(res, 200, { pid: process.pid, app: 'steady' });
      if (path === '/api/diary' && req.method === 'GET') return json(res, 200, snapshot);
      if (path === '/api/diary' && req.method === 'POST') {
        const input = await body(req);
        const parsed = stateSchema.safeParse(input.payload);
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !parsed.success) return json(res, 400, { error: 'Invalid diary' });
        const commit = async () => {
          if (input.expectedRevision !== snapshot.revision) return json(res, 409, { error: 'Revision changed' });
          const next = { revision: snapshot.revision + 1, payload: parsed.data };
          const temporary = `${snapshotFile}.tmp`;
          await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
          await rename(temporary, snapshotFile); snapshot = next;
          json(res, 200, { revision: next.revision });
        };
        writing = writing.then(commit, commit); return await writing;
      }
      return json(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    const relative = decodeURIComponent(path).replace(/^\/+/, '') || 'index.html';
    const dist = join(root, 'dist'), file = resolve(dist, relative);
    if (!file.startsWith(dist + '/')) return json(res, 403, { error: 'Not allowed' });
    if (!(await stat(file)).isFile()) return json(res, 404, { error: 'Not found' });
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch (error) { if (!res.headersSent) json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? 'Build the app first: npm run build' : 'Request could not be processed' }); else res.end(); }
}
const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
server.listen(port, host, () => {
  console.log(`\nSteady local dashboard: ${tls ? 'https' : 'http'}://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
  console.log(`Pairing key: ${token}\nEnter this key in Settings → Local sync on each device.\nData stays in ${dataDir}\n`);
});
