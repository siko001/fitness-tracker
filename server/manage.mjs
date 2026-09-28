import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open, access, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = resolve(process.env.STEADY_DATA_DIR || join(root, '.steady-data'));
const recordFile = join(dataDir, 'service.json');
const action = process.argv[2];
await mkdir(dataDir, { recursive: true, mode: 0o700 });
async function saved() {
  try { return JSON.parse(await readFile(recordFile, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function inspect(record) {
  if (!record) return false;
  try {
    const key = (await readFile(join(dataDir, 'pairing-key'), 'utf8')).trim();
    const response = await fetch(`${record.url}/api/status`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(1500) });
    const status = await response.json();
    return response.ok && status.app === 'steady' && status.pid === record.pid;
  } catch { return false; }
}
const previous = await saved();
if (action === 'start') {
  if (await inspect(previous)) { console.log(`Steady is already running at ${previous.url}.`); process.exit(0); }
  await access(join(root, 'dist', 'index.html')).catch(() => { throw new Error('Build first with npm run build.'); });
  const log = await open(join(dataDir, 'server.log'), 'a', 0o600);
  const child = spawn(process.execPath, [join(root, 'server/local.mjs')], { cwd: root, env: process.env, detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref(); await log.close();
  const host = process.env.STEADY_HOST || '127.0.0.1';
  const displayHost = ['0.0.0.0', '127.0.0.1', '::', '::1'].includes(host) ? 'localhost' : host;
  const record = { pid: child.pid, url: `${process.env.STEADY_TLS_CERT ? 'https' : 'http'}://${displayHost}:${process.env.PORT || 4173}` };
  // Record immediately so a failed health check still leaves the child identifiable.
  await writeFile(recordFile, JSON.stringify(record), { mode: 0o600 });
  let ready = false;
  for (let i = 0; i < 20 && !ready; i++) { await delay(150); ready = await inspect(record); }
  if (!ready) throw new Error(`Could not verify startup. See ${join(dataDir, 'server.log')}. For HTTPS, trust the certificate with NODE_EXTRA_CA_CERTS.`);
  console.log(`Steady is running at ${record.url}. You can close this terminal.\nPairing key: ${(await readFile(join(dataDir, 'pairing-key'), 'utf8')).trim()}\nStop with npm run local:stop. Restart after reboot with npm run local:start.`);
} else if (action === 'stop') {
  if (!(await inspect(previous))) throw new Error('Could not verify the Steady process, so no process was stopped. Check local:status and the server log.');
  // Authenticated identity check prevents a stale PID file from killing an unrelated process.
  process.kill(previous.pid, 'SIGTERM');
  await unlink(recordFile);
  console.log('Steady local server stopped. Your saved diary is unchanged.');
} else if (action === 'status') {
  console.log(await inspect(previous) ? `Steady is running at ${previous.url}.` : 'No verified Steady background server. Start it with npm run local:start.');
} else throw new Error('Use start, stop or status.');
