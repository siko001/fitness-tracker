// Run after `vercel build --prod`: checks the packaged function in isolation,
// including its offline food catalog. Groq is stubbed; no key or quota is used.
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'steady-function-check-'));
const originalFetch = globalThis.fetch;
try {
  await cp('.vercel/output/functions/api/food-assistant.func', directory, { recursive: true, dereference: true });
  const { default: handler } = await import(pathToFileURL(`${directory}/api/food-assistant.mjs`).href);
  const response = () => ({ setHeader() {}, end(body) { this.body = JSON.parse(body); } });
  const status = response(); await handler({ method: 'GET', headers: { host: 'localhost' } }, status);
  assert.equal(status.statusCode, 200);
  let calls = 0, match;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(options.body);
    const results = body.messages.find(m => m.role === 'tool');
    if (results) { match = JSON.parse(results.content)[0]; assert.ok(match?.ref.startsWith('usda:')); }
    let message;
    if (++calls === 1) message = { content: null, tool_calls: [{ id: 'lookup', type: 'function', function: { name: 'find_food', arguments: JSON.stringify({ query: 'carrots raw', brand: '', source: 'general' }) } }] };
    else if (calls === 2) message = { content: 'Found the food.' };
    else message = { content: JSON.stringify({ reply: 'Review this portion.', items: [{ ref: match.ref, name: match.name, brand: null, preparation: match.preparation, grams: 100, per100: null, portionLabel: null, notes: '', sourceUrls: [] }] }) };
    return Response.json({ choices: [{ message, finish_reason: 'stop' }] });
  };
  const result = response();
  await handler({ method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, body: { apiKey: 'test-key-no-provider-request', foods: [], recipes: [], messages: [{ role: 'user', content: '100 g raw carrots' }] } }, result);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.items[0].grams, 100);
  assert.ok(result.body.items[0].food.per100.kcal > 0);
  console.log('Packaged Vercel function: startup, catalog lookup and proposal passed.');
} finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
