import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fmt } from './model';

export function paginate<T>(items: T[], requestedPage: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.max(1, Math.min(requestedPage, pages));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pages, start: items.length ? start + 1 : 0, end: Math.min(start + pageSize, items.length), total: items.length };
}

export function matchesSearch(text: string, query: string) {
  const normalise = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const haystack = normalise(text);
  return normalise(query).trim().split(/\s+/).every(word => haystack.includes(word));
}

export default function Pagination({ page, pages, start, end, total, onChange, label, pageSize, onPageSize }: {
  page: number; pages: number; start: number; end: number; total: number;
  onChange: (page: number) => void; label: string; pageSize?: number; onPageSize?: (size: number) => void;
}) {
  return <nav className="pagination" aria-label={label}>
    <span className="result-count" role="status">{fmt(start)}–{fmt(end)} of {fmt(total)}</span>
    <div className="pagination-controls">
      {onPageSize && <select aria-label="Items per page" value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>
        {[10, 20, 50].map(size => <option key={size} value={size}>{size} per page</option>)}
      </select>}
      {pages > 1 && <>
        <button type="button" className="icon-button" aria-label="Previous page" disabled={page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={18} /></button>
        <select aria-label="Page" value={page} onChange={e => onChange(Number(e.target.value))}>
          {Array.from({ length: pages }, (_, index) => <option key={index} value={index + 1}>{index + 1} / {pages}</option>)}
        </select>
        <button type="button" className="icon-button" aria-label="Next page" disabled={page === pages} onClick={() => onChange(page + 1)}><ChevronRight size={18} /></button>
      </>}
    </div>
  </nav>;
}
