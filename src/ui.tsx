import { createContext, useContext, useEffect, useLayoutEffect, useState, useRef, useId, cloneElement, isValidElement, type ReactNode, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, Leaf, ArrowUpRight } from 'lucide-react';
import { fmt, type Macros } from './model';

export function Logo({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'small' : ''}`}><img src="/icon.svg" alt="" /><span>steady<span className="brand-dot">.</span></span></span>;
}
const ModalFooterContext = createContext<HTMLDivElement | null>(null);
export function Modal({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const d = ref.current!; d.showModal();
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; d.close(); };
  }, []);
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }} aria-labelledby="modal-title">
    <header className="modal-header"><div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></header><ModalFooterContext.Provider value={footer}><div className="modal-body">{children}</div></ModalFooterContext.Provider><div className="modal-footer" ref={setFooter} />
  </dialog>;
}
export function ModalActions({ children, className = 'form-actions' }: { children: ReactNode; className?: string }) {
  const footer = useContext(ModalFooterContext);
  const actions = <div className={className}>{children}</div>;
  return footer ? createPortal(actions, footer) : actions;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>{isValidElement<{id?: string; 'aria-describedby'?: string}>(children) ? cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined }) : children}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function MacroStrip({ macros }: { macros: Macros }) {
  return <div className="macro-strip"><span><i className="dot protein" />{fmt(macros.protein, 1)} g <small>protein</small></span><span><i className="dot carbs" />{fmt(macros.carbs, 1)} g <small>carbs</small></span><span><i className="dot fat" />{fmt(macros.fat, 1)} g <small>fat</small></span></div>;
}
export function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-symbol"><Leaf size={25} strokeWidth={1.5} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
export function SectionHeading({ title, aside }: { title: string; aside?: ReactNode }) { return <div className="section-heading"><h2>{title}</h2>{aside}</div>; }
export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-button" onClick={onClick}>{children}<ArrowUpRight size={15} /></button>; }
export function FormActions({ busy, label = 'Save', onClose }: { busy: boolean; label?: string; onClose: () => void }) {
  const marker = useRef<HTMLSpanElement>(null), generatedId = useId();
  const [formId, setFormId] = useState<string>();
  useLayoutEffect(() => {
    const form = marker.current?.closest('form');
    if (form) { if (!form.id) form.id = `steady-form-${generatedId}`; setFormId(form.id); }
  }, [generatedId]);
  return <><span ref={marker} hidden /><ModalActions><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" type="submit" form={formId} disabled={busy}>{busy ? 'Saving…' : label}</button></ModalActions></>;
}
export function formValues(e: FormEvent<HTMLFormElement>) { e.preventDefault(); return new FormData(e.currentTarget); }
export function numeric(data: FormData, key: string): number { const raw = data.get(key); return raw === null || raw === '' ? NaN : Number(raw); }
export function optionalNumeric(data: FormData, key: string): number | null { return data.get(key) === '' ? null : numeric(data, key); }
