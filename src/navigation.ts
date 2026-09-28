import { useEffect, useState } from 'react';

const routes = { Overview: 'overview', 'Food diary': 'diary', 'Food library': 'foods', Recipes: 'recipes', Progress: 'progress', Activity: 'activity', Settings: 'settings' } as const;
export type Page = keyof typeof routes;
function currentPage(): Page {
  return (Object.keys(routes) as Page[]).find(page => routes[page] === location.hash.slice(1)) ?? 'Overview';
}

export function usePage() {
  const [page, setPage] = useState<Page>(currentPage);
  useEffect(() => {
    const change = () => { setPage(currentPage()); window.scrollTo({ top: 0, behavior: 'instant' }); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return [page, (next: Page) => { location.hash = routes[next]; setPage(next); }] as const;
}
