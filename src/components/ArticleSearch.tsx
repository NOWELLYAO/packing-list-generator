import { useMemo, useRef, useState } from 'react';
import type { CatalogItem } from '../types';
import { norm } from '../lib/detect';

interface Props {
  catalog: CatalogItem[];
  onPick: (item: CatalogItem) => void;
  /** ajout d'un code absent de la base */
  onPickUnknown: (code: string) => void;
}

const compact = (s: string) => norm(s).replace(/\s/g, '');

/**
 * La désignation commence-t-elle par la saisie (espaces et tirets ignorés),
 * en s'arrêtant à une frontière de mot ? "sp9" ok pour "SP9-23", pas pour "SP92".
 */
function boundaryPrefix(textNorm: string, cq: string): 'exact' | 'prefix' | false {
  if (!cq) return false;
  let i = 0;
  for (const ch of cq) {
    while (textNorm[i] === ' ') i++;
    if (textNorm[i] !== ch) return false;
    i++;
  }
  const rest = textNorm.slice(i);
  if (!rest.trim()) return 'exact';
  if (rest[0] === ' ') return 'prefix';
  const last = cq[cq.length - 1];
  const sameKind = (/\d/.test(last) && /\d/.test(rest[0])) || (/[a-z]/.test(last) && /[a-z]/.test(rest[0]));
  return sameKind ? false : 'prefix';
}

/** Score de pertinence : code/PN exact > début de code/PN > tous les mots trouvés */
function score(item: CatalogItem, q: string, tokens: string[]): number {
  const code = compact(item.code);
  const pn = compact(item.pn);
  const cq = compact(q);
  if (cq && (code === cq || pn === cq)) return 100;
  if (cq && (code.startsWith(cq) || pn.startsWith(cq))) return 80;
  // désignation : "CR10-10" doit trouver "CR10-10 A-A-A-E" avant "CR10-8 …" ou "CR10-100"
  const p = boundaryPrefix(norm(item.description), cq);
  if (p === 'exact') return 75;
  if (p === 'prefix') return 70 - Math.min(10, item.description.length / 4);
  const hay = `${norm(item.code)} ${norm(item.pn)} ${norm(item.description)}`;
  const hayCompact = hay.replace(/\s/g, '');
  const words = hay.split(' ');
  // chaque mot tapé doit commencer un mot de la fiche (ou apparaître dans le code collé)
  const wordHit = (t: string) => words.some((w) => w.startsWith(t)) || hayCompact.includes(t) && t.length >= 4;
  if (tokens.every(wordHit)) return 50 - Math.min(20, hay.length / 10);
  if (cq.length >= 3 && hayCompact.includes(cq)) return 30;
  return 0;
}

/** Articles les plus pertinents pour une saisie (8 max) */
export function searchCatalog(catalog: CatalogItem[], q: string, limit = 8): CatalogItem[] {
  const tokens = norm(q).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return catalog
    .map((it) => ({ it, s: score(it, q, tokens) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.it);
}

export default function ArticleSearch({ catalog, onPick, onPickUnknown }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchCatalog(catalog, q), [catalog, q]);

  const pick = (it: CatalogItem | null) => {
    if (it) onPick(it);
    else if (q.trim()) onPickUnknown(q.trim());
    setQ('');
    setActive(0);
    inputRef.current?.focus();
  };

  return (
    <div className="search-box">
      <span className="search-icon" aria-hidden>
        ⌕
      </span>
      <input
        ref={inputRef}
        value={q}
        placeholder="Ajouter un article : code, PN ou désignation…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(results[active] ?? null);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {q && (
        <button className="search-clear" onClick={() => setQ('')} aria-label="Effacer">
          ×
        </button>
      )}
      {open && q.trim() && (
        <ul className="search-results">
          {results.map((it, i) => (
            <li
              key={it.id}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <div className="sr-main">
                <b>{it.description || it.code}</b>
                <span className="sr-code">
                  {it.code}
                  {it.pn && it.pn !== it.code ? ` · ${it.pn}` : ''}
                </span>
              </div>
              <span className="sr-pack">
                {it.qtyPerPackage} / {it.packageType}
                {(it.variants?.length ?? 0) > 1 && <em> +{(it.variants?.length ?? 1) - 1}</em>}
              </span>
            </li>
          ))}
          <li
            className={`sr-unknown ${active === results.length ? 'active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(null);
            }}
          >
            {results.length ? 'Aucun ne correspond ? ' : 'Introuvable dans la base. '}Ajouter « {q.trim()} » quand même
          </li>
        </ul>
      )}
    </div>
  );
}
