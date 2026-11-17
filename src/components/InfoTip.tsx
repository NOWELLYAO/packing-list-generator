import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GLOSSARY, type GlossaryKey } from '../lib/glossary';

/**
 * Petit bouton « i » : un toucher / clic affiche l'explication du terme.
 * La bulle se ferme en touchant ailleurs, avec Échap ou avec le bouton ✕.
 */
export default function InfoTip({ k, light }: { k: GlossaryKey; light?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const entry = GLOSSARY[k];

  // Position de la bulle : sous le bouton (ou au-dessus s'il n'y a pas la place), dans l'écran
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const w = Math.min(320, window.innerWidth - 24);
      const h = pop.current?.offsetHeight ?? 160;
      const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
      const above = r.bottom + h + 12 > window.innerHeight && r.top - h - 12 > 0;
      setPos({ left, top: above ? r.top - h - 8 : r.bottom + 8, above });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`info-btn ${light ? 'light' : ''} ${open ? 'on' : ''}`}
        aria-label={`Explication : ${entry.title}`}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        i
      </button>
      {open && (
        <div
          ref={pop}
          role="dialog"
          aria-label={entry.title}
          className="info-pop"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: Math.min(320, window.innerWidth - 24) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="info-head">
            <b>{entry.title}</b>
            <button type="button" className="info-close" aria-label="Fermer" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <p>{entry.text}</p>
          {'example' in entry && entry.example && (
            <p className="info-example">
              <span>Exemple</span> {entry.example}
            </p>
          )}
        </div>
      )}
    </>
  );
}
