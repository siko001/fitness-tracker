import { foodSearch } from '../server/food-search.mjs';

export default async function handler(req, res) {
  // Public food information only; no auth cookies or private data are used.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS'); return res.status(204).end(); }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const result = await foodSearch(new URL(req.url, 'https://localhost').searchParams);
  return res.status(result.status).json(result.body);
}
