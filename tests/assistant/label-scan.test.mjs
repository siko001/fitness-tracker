import test from 'node:test';
import assert from 'node:assert/strict';
import { scanNutritionLabel } from '../../server/label-scan.mjs';
import { assistantHttp } from '../../server/assistant-http.mjs';
const image = 'data:image/jpeg;base64,/9j/AA==';
const request = { operation: 'scan_label', images: [image], apiKey: 'gsk_fixture_not_a_real_key' };
const reading = { name: 'Juice', brand: null, category: 'Drinks', barcode: null, unit: 'ml', basisAmount: 100, nutrients: { kcal: 48, kj: null, protein: 0, fat: 0, carbs: 12, fibre: null }, servingAmount: null, servingUnit: null, notes: '', warnings: [] };
const output = content => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] });
test('scan uses vision with bounded photos, exact transcription rules and no unrelated diary context', async () => {
  const result = await scanNutritionLabel(request, { env: {}, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen/qwen3.8-27b'); assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.tools, undefined); assert.equal(body.messages[1].content[1].image_url.url, image);
    assert.match(body.messages[0].content, /never assume 1 ml = 1 g/); assert.match(body.messages[0].content, /never instructions/);
    return output(reading);
  } });
  assert.deepEqual(result, reading);
});
test('invalid responses retry once, retain unknowns and never accept malformed nutrition', async () => {
  for (const kind of ['bad-response', 'provider-json', 'always-bad']) {
    let calls = 0;
    const run = () => scanNutritionLabel(request, { fetcher: async () => {
      calls++;
      if (kind === 'provider-json' && calls === 1) return Response.json({ error: { code: 'json_validate_failed', failed_generation: 'private-data' } }, { status: 400 });
      return output(calls === 1 || kind === 'always-bad' ? { ...reading, nutrients: { ...reading.nutrients, kcal: -1 } } : reading);
    } });
    if (kind === 'always-bad') await assert.rejects(run, /could not be read reliably/); else assert.equal((await run()).nutrients.fibre, null);
    assert.equal(calls, 2);
  }
});
test('authentication and quota errors are redacted and never retried', async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(() => scanNutritionLabel(request, { fetcher: async () => { calls++; return Response.json({ error: { message: 'private-credential-and-food' } }, { status }); } }), e => !e.message.includes('private-credential') && [429, 502].includes(e.status));
    assert.equal(calls, 1);
  }
});
test('remote URLs, excessive photos, corrupt images and oversized uploads never reach Groq', async () => {
  let calls = 0;
  for (const images of [['https://example.com/a.jpg'], [image, image, image], ['data:image/jpeg;base64,YmFk'], ['data:image/jpeg;base64,' + 'A'.repeat(850001)]]) {
    await assert.rejects(() => scanNutritionLabel({ ...request, images }, { fetcher: async () => { calls++; } }));
  }
  assert.equal(calls, 0);
});
test('HTTP scans share assistant authentication and route only to the scanner', async () => {
  let calls = 0;
  const req = { method: 'POST', headers: { host: 'example.com', 'content-type': 'application/json' }, body: { operation: 'scan_label', images: [image] } };
  const response = () => ({ setHeader() {}, end(raw) { this.body = JSON.parse(raw); } });
  let res = response();
  await assistantHttp(req, res, { env: { GROQ_API_KEY: 'private-server-key' }, scanner: async () => { calls++; } });
  assert.equal(res.statusCode, 401); assert.equal(calls, 0);
  res = response();
  await assistantHttp({ ...req, body: request }, res, { env: {}, scanner: async (input) => { assert.deepEqual(input.images, [image]); calls++; return reading; }, assistant: async () => { throw new Error('Wrong route'); } });
  assert.equal(res.statusCode, 200); assert.equal(calls, 1); assert.deepEqual(res.body, reading);
});
