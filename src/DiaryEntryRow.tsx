import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChefHat, GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { entryMacros, fmt, meals, type Entry } from './model';
import type { DiaryActions } from './Dashboard';

export default function DiaryEntryRow({ entry, actions, recipeSaved, onDragStart, onDragEnd }: {
  entry: Entry; actions: DiaryActions; recipeSaved: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void; onDragEnd: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [opensUp, setOpensUp] = useState(false);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (menu.current && !menu.current.contains(e.target as Node)) menu.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  function choose(action: () => void) { if (menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } action(); }
  return <div className="diary-entry" draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
    <span className="entry-drag-handle" aria-hidden="true" title="Drag to another meal"><GripVertical size={15} /></span>
    <div><strong>{entry.name}</strong><small>{entry.time && <><time dateTime={`${entry.date}T${entry.time}`}>{entry.time}</time> · </>}{fmt(entry.grams, 1)} g · {entry.preparation}{entry.estimated && ' · Estimate'}</small></div>
    <b>{fmt(entryMacros(entry).kcal)}<small> kcal</small></b>
    <button className="icon-button" onClick={() => actions.edit(entry)} aria-label={`Edit ${entry.name}`}><Pencil size={15} /></button>
    <details className="entry-actions" ref={menu} onToggle={e => {
      if (!e.currentTarget.open) return;
      const anchor = e.currentTarget.getBoundingClientRect(), panel = e.currentTarget.querySelector<HTMLDivElement>('.entry-actions-menu');
      const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
      const bottom = nav?.height ? nav.top : window.innerHeight;
      setOpensUp(bottom - anchor.bottom - 8 < (panel?.offsetHeight || 260) && anchor.top > bottom - anchor.bottom);
    }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); choose(() => {}); } }}>
      <summary className="icon-button" aria-label={`Actions for ${entry.name}`} title="Move or save as recipe"><MoreHorizontal size={17} /></summary>
      <div className={`entry-actions-menu ${opensUp ? 'opens-up' : ''}`} role="group" aria-label={`Actions for ${entry.name}`}>
        <span>Move to</span>{meals.map(meal => <button type="button" key={meal} disabled={meal === entry.meal} onClick={() => choose(() => actions.move(entry, meal))}>Move to {meal.toLowerCase()}</button>)}
        {!recipeSaved && <button className="entry-recipe-action" type="button" onClick={() => choose(() => actions.recipe(entry))}><ChefHat size={16} />Save as recipe</button>}
      </div>
    </details>
    <button className="icon-button delete" onClick={() => actions.remove(entry)} aria-label={`Delete ${entry.name}`}><Trash2 size={15} /></button>
  </div>;
}
