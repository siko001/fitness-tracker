// A read-only proxy with fixed upstreams. No diary, account or health data is forwarded.
const cache = new Map();
let calls = [];
const headers = { 'User-Agent': 'Steady/1.0 (https://fitness-tracker-one-steel.vercel.app)', Accept: 'application/json' };
export async function foodSearch(params) {
  const code = params.get('code'), query = params.get('q')?.trim(), page = Number(params.get('page') || 1);
  if (code ? !/^\d{8,14}$/.test(code) : !query || query.length < 2 || query.length > 100 || !Number.isInteger(page) || page < 1 || page > 50) {
    return { status: 400, body: { error: 'Enter a food name (2–100 characters) or an 8–14 digit barcode.' } };
  }
  const key = code ? `code:${code}` : `${query.toLowerCase()}:${page}`;
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return { status: 200, body: cached.body };
  // A conservative shared budget for this personal deployment. Also bounds API costs.
  calls = calls.filter(t => t > Date.now() - 60000);
  if (calls.length >= 8) return { status: 429, body: { error: 'Food search is busy. Please wait a minute and try again.' } };
  calls.push(Date.now());
  const url = code ? new URL(`https://world.openfoodfacts.org/api/v3.6/product/${code}.json`) : new URL('https://search.openfoodfacts.org/search');
  if (code) url.searchParams.set('fields', 'code,product_name,product_name_en,brands,quantity,nutrition,nutriments,serving_size,serving_quantity,serving_quantity_unit,product_quantity_unit,nutrition_data_per,last_modified_t');
  else {
    // Treat user input as plain terms, not Search-a-licious/Lucene operators.
    const plain = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(word => word && !['AND', 'OR', 'NOT'].includes(word)).join(' ');
    if (!plain) return { status: 400, body: { error: 'Enter a food name.' } };
    url.search = new URLSearchParams({ q: plain, langs: 'en,it', page: String(page), page_size: '20', fields: 'code,product_name,product_name_en,brands,quantity' }).toString();
  }
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(18000), redirect: 'error' });
    if (!response.ok) return { status: response.status === 404 ? 404 : 503, body: { error: response.status === 404 ? 'No product found for that barcode.' : 'Open Food Facts is temporarily unavailable. Try again shortly.' } };
    if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('Response too large');
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw new Error('Response too large'); chunks.push(value); } }
    finally { await reader.cancel(); }
    const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (code && !raw.product) return { status: 404, body: { error: 'No product found for that barcode.' } };
    const body = code ? { product: raw.product } : { hits: Array.isArray(raw.hits) ? raw.hits.slice(0, 20) : [], page_count: Math.min(50, Number(raw.page_count) || 0) };
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { until: Date.now() + 300000, body });
    return { status: 200, body };
  } catch { return { status: 503, body: { error: 'Food search could not connect. Try again shortly, or use General foods.' } }; }
}
