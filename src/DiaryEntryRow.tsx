import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, ArrowRightLeft, GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { entryMacros, fmt, meals, portionUnit, type Entry } from './model';
import type { DiaryActions } from './Dashboard';

export default function DiaryEntryRow({ entry, actions, onDragStart, onDragEnd }: {
  entry: Entry; actions: DiaryActions;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void; onDragEnd: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [opensUp, setOpensUp] = useState(false), [moving, setMoving] = useState(false);
  function positionMenu() {
    if (!menu.current?.open) return;
    const anchor = menu.current.getBoundingClientRect(), panel = menu.current.querySelector<HTMLDivElement>('.entry-actions-menu');
    const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
    const bottom = nav?.height ? nav.top : window.innerHeight;
    setOpensUp(bottom - anchor.bottom - 8 < (panel?.offsetHeight || 200) && anchor.top > bottom - anchor.bottom);
  }
  useEffect(positionMenu, [moving]);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (menu.current && !menu.current.contains(e.target as Node)) menu.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  function choose(action: () => void) { if (menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } action(); }
  return <div className="diary-entry" draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
    <span className="entry-drag-handle" aria-hidden="true" title="Drag to another meal"><GripVertical size={15} /></span>
    <div><strong>{entry.name}</strong><small>{entry.time && <><time dateTime={`${entry.date}T${entry.time}`}>{entry.time}</time> · </>}{fmt(entry.grams, 1)} {portionUnit(entry)} · {entry.preparation}{entry.estimated && ' · Estimate'}</small></div>
    <b>{fmt(entryMacros(entry).kcal)}<small> kcal</small></b>
    <details className="entry-actions" ref={menu} onToggle={e => {
      if (!e.currentTarget.open) { setMoving(false); return; }
      positionMenu();
    }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (moving) setMoving(false); else choose(() => {}); } }}>
      <summary className="icon-button" aria-label={`Actions for ${entry.name}`} title="Item actions"><MoreHorizontal size={17} /></summary>
      <div className={`entry-actions-menu ${opensUp ? 'opens-up' : ''}`} role="group" aria-label={`Actions for ${entry.name}`}>
        {moving ? <><button type="button" onClick={() => setMoving(false)}><ArrowLeft size={16} />Back</button><span>Move to which meal?</span>{meals.map(meal => <button type="button" key={meal} disabled={meal === entry.meal} onClick={() => choose(() => actions.move(entry, meal))}>{meal}{meal === entry.meal ? ' · current' : ''}</button>)}</> : <>
          <button type="button" onClick={() => setMoving(true)}><ArrowRightLeft size={16} />Move</button>
          <button type="button" onClick={() => choose(() => actions.edit(entry))}><Pencil size={16} />Edit</button>
          <button className="entry-delete-action" type="button" onClick={() => choose(() => actions.remove(entry))}><Trash2 size={16} />Delete</button>
        </>}
      </div>
    </details>
  </div>;
}
