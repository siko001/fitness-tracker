import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foodAssistant, findFoods, resolveProposal } from '../../server/food-assistant.mjs';
import { assistantHttp } from '../../server/assistant-http.mjs';

const food = { id: 'panina', name: 'Tuna ftira', brand: 'Panina', group: 'Other', preparation: 'Ready to eat', custom: true, source: 'Reviewed estimate', estimated: true, per100: { kcal: 250, protein: 12, carbs: 30, fat: 9, fibre: 2 } };
const item = { ref: 'food:panina', name: food.name, brand: 'Panina', preparation: 'Ready to eat', grams: 180, per100: { ...food.per100, kcal: 999 }, portionLabel: 'Half ftira', notes: 'Half', sourceUrls: [] };
test('canonical saved nutrition wins; wrong brand and fabricated references cannot be imported', () => {
  const registry = new Map([['food:panina', { food }]]);
  const result = resolveProposal({ reply: 'Half a Panina ftira.', items: [item] }, registry, [food]);
  assert.equal(result.items[0].food.per100.kcal, 250); assert.equal(result.items[0].existing, true);
  for (const bad of [{ ...item, brand: 'Other restaurant' }, { ...item, ref: 'invented' }]) {
    const rejected = resolveProposal({ reply: 'Proposal', items: [bad] }, registry, [food]);
    assert.equal(rejected.items.length, 0); assert.equal(rejected.warnings.length, 1);
  }
  assert.equal(findFoods([food, { ...food, id: 'wrong', brand: 'Panina Express' }], 'tuna', 'Panina').length, 1);
});
test('new AI food is always marked estimated and cannot invent source links', () => {
  const result = resolveProposal({ reply: 'An estimate.', items: [{ ...item, ref: null, sourceUrls: ['https://fake.invalid/nutrition'] }] }, new Map(), []);
  assert.equal(result.items[0].food.estimated, true); assert.equal(result.items[0].food.source, 'AI estimate · Groq');
  assert.equal(result.items[0].food.sourceUrl, undefined); assert.equal(result.items[0].food.researchUrls, undefined);
});
test('conversational follow-up uses saved match and strict output without mixing browser tools', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(options.body); requests.push(body);
    const message = requests.length === 1 ? { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find_food', arguments: JSON.stringify({ query: 'tuna ftira', brand: 'Panina', source: 'saved' }) } }] }
      : requests.length === 2 ? { content: 'I found your Panina item.' }
      : { content: JSON.stringify({ reply: 'Half uses 180 g. Check it below.', items: [item] }) };
    return Response.json({ choices: [{ message, finish_reason: 'stop' }] });
  };
  const response = await foodAssistant({ apiKey: 'not-a-real-key-for-test', foods: [food], recipes: [], draft: [], webSearch: false, messages: [{ role: 'user', content: 'Panina tuna ftira' }, { role: 'assistant', content: 'Whole or half?' }, { role: 'user', content: 'Half please, 180g' }] }, { fetcher });
  assert.equal(response.items[0].grams, 180); assert.equal(response.items[0].food.per100.kcal, 250);
  assert.equal(requests.at(-1).response_format.json_schema.strict, true); assert.equal(requests.at(-1).tools, undefined);
  assert(requests[1].messages.some(m => m.role === 'tool' && m.content.includes('Panina')));
  assert(requests.at(-1).messages.every(m => m.role !== 'tool' && !m.tool_calls && !m.tool_call_id));
  assert(requests.at(-1).messages.some(m => m.content.includes('Food lookup result') && m.content.includes('food:panina')));
  assert(requests[0].tools.every(t => t.function.name !== 'research_menu'));
  const schema = JSON.stringify(requests.at(-1).response_format.json_schema.schema);
  assert(!/"(?:format|minLength|maxLength|minimum|exclusiveMinimum|maximum|maxItems)"/.test(schema));
});
test('unauthenticated callers cannot spend a configured server key or learn it', async () => {
  const req = { method: 'POST', headers: { 'content-type': 'application/json', host: 'example.com' }, body: { messages: [{ role: 'user', content: 'hello' }], foods: [], recipes: [] } };
  const res = { setHeader() {}, end(body) { this.body = body; } };
  await assistantHttp(req, res, { env: { GROQ_API_KEY: 'private-server-key-do-not-leak' } });
  assert.equal(res.statusCode, 401); assert(!res.body.includes('private-server-key'));
});
test('provider failure bodies and credentials never reach the client', async () => {
  const reports = [];
  await assert.rejects(() => foodAssistant({ foods: [], recipes: [], draft: [], messages: [{ role: 'user', content: 'a ftira' }] }, { apiKey: 'private-key', report: d => reports.push(d), fetcher: async () => new Response('echo private-key', { status: 401 }) }), error => error.message === 'Groq did not accept this API key.');
  assert.deepEqual(reports, [{ provider: 'groq', status: 401, stage: 'lookup', category: 'request_failed' }]);
});

const basicRequest = { apiKey: 'not-a-real-key-for-test', foods: [], recipes: [], messages: [{ role: 'user', content: 'A tuna ftira from Panina' }] };
test('schema rejection falls back once to JSON mode with full server validation', async () => {
  for (const invalid of [false, true]) {
    const requests = [], reports = [];
    const execute = () => foodAssistant(basicRequest, { report: d => reports.push(d), fetcher: async (_, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      if (requests.length === 1) return Response.json({ choices: [{ message: { content: 'What size?' }, finish_reason: 'stop' }] });
      if (body.response_format.type === 'json_schema') return Response.json({ error: { code: 'invalid_request_error', message: 'response_format schema unsupported. secret-key-and-food-text', failed_generation: 'private-key' } }, { status: 400 });
      assert.equal(body.response_format.type, 'json_object');
      assert(body.messages.at(-1).content.includes('JSON object'));
      return Response.json({ choices: [{ message: { content: JSON.stringify(invalid ? { reply: 'Bad portion', items: [{ ...item, grams: -1 }] } : { reply: 'Whole or half?', items: [] }) }, finish_reason: 'stop' }] });
    } });
    if (invalid) await assert.rejects(execute);
    else assert.equal((await execute()).reply, 'Whole or half?');
    assert.equal(requests.length, 3);
    assert.deepEqual(reports, [{ provider: 'groq', status: 400, stage: 'proposal', category: 'schema_rejected' }]);
  }
});
test('malformed generated tool calls retry once; auth and quota failures do not retry', async () => {
  for (const status of [400, 401, 429]) {
    let calls = 0;
    const execute = () => foodAssistant(basicRequest, { report() {}, fetcher: async () => {
      calls++;
      if (calls === 1) return Response.json({ error: { code: 'tool_use_failed', message: 'do not echo this', failed_generation: 'do not execute this' } }, { status });
      return Response.json({ choices: [{ message: { content: calls === 2 ? 'What size?' : JSON.stringify({ reply: 'Whole or half?', items: [] }) }, finish_reason: 'stop' }] });
    } });
    if (status === 400) { assert.equal((await execute()).items.length, 0); assert.equal(calls, 3); }
    else { await assert.rejects(execute); assert.equal(calls, 1); }
  }
});
test('json_validate_failed recovers once even when the provider message never mentions a schema', async () => {
  for (const fallback of ['valid', 'invalid', 'provider-error']) {
    const requests = [], reports = [];
    const execute = () => foodAssistant({ ...basicRequest, foods: [food] }, { report: d => reports.push(d), fetcher: async (_, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      if (requests.length === 1) return Response.json({ choices: [{ message: { content: 'Review this portion.' }, finish_reason: 'stop' }] });
      if (body.response_format.type === 'json_schema' || fallback === 'provider-error') return Response.json({ error: { code: 'json_validate_failed', message: 'Failed to generate JSON. Please adjust your prompt.', failed_generation: 'secret-provider-output' } }, { status: 400 });
      assert.equal(body.response_format.type, 'json_object');
      assert(!JSON.stringify(body).includes('secret-provider-output'));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: 'Review your portion.', items: [{ ...item, grams: fallback === 'invalid' ? -180 : 180 }] }) }, finish_reason: 'stop' }] });
    } });
    if (fallback === 'valid') {
      const result = await execute();
      assert.equal(result.items[0].grams, 180);
      assert.equal(result.items[0].food.per100.kcal, 250);
    } else await assert.rejects(execute);
    assert.equal(requests.length, 3, 'There is at most one recovery request');
    assert(reports.every(d => d.category === 'json_validate_failed' && d.stage === 'proposal'));
  }
});
test('proposal auth, quota, and unrelated request errors never trigger JSON recovery', async () => {
  for (const status of [400, 401, 429, 500]) {
    let calls = 0;
    await assert.rejects(() => foodAssistant(basicRequest, { report() {}, fetcher: async () => {
      if (++calls === 1) return Response.json({ choices: [{ message: { content: 'What size?' }, finish_reason: 'stop' }] });
      return Response.json({ error: { code: status === 400 ? 'invalid_request_error' : 'json_validate_failed', message: 'Request failed' } }, { status });
    } }));
    assert.equal(calls, 2);
  }
});
test('unknown provider errors expose only a fixed category, stage and status', async () => {
  const reports = [];
  await assert.rejects(() => foodAssistant(basicRequest, { report: d => reports.push(d), fetcher: async () => Response.json({ error: { code: 'private-key', message: 'private meal', failed_generation: 'private-key' } }, { status: 400 }) }), error => error.message === 'Groq rejected the food lookup (400 · request_failed). Your draft is safe.');
  assert.deepEqual(reports, [{ provider: 'groq', status: 400, stage: 'lookup', category: 'request_failed' }]);
});
test('packaged follow-ups restore source nutrition rather than trusting the previous draft', async () => {
  const draft = { ...item, ref: 'off:3017620422003', brand: 'Test Brand', name: 'Test tuna', grams: 50 };
  let calls = 0;
  const response = await foodAssistant({ apiKey: 'not-a-real-key-for-test', foods: [], recipes: [], draft: [draft], messages: [{ role: 'user', content: 'Half of that tuna please.' }] }, {
    search: async params => {
      assert.equal(params.get('code'), '3017620422003');
      return { status: 200, body: { product: { code: '3017620422003', product_name: 'Test tuna', brands: 'Test Brand', nutriments: { 'energy-kcal_100g': 150, proteins_100g: 25, carbohydrates_100g: 0, fat_100g: 5, fiber_100g: 0 } } } };
    },
    fetcher: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: ++calls === 1 ? 'Half is 50 g.' : JSON.stringify({ reply: 'Half is 50 g.', items: [draft] }) } }] }),
  });
  assert.equal(response.items[0].grams, 50);
  assert.equal(response.items[0].food.per100.kcal, 150);
  assert.equal(response.draft[0].per100.kcal, 150);
});
