import { useMemo, useRef, useState } from 'react';
import type { CatalogItem } from '../types';
import { norm } from '../lib/detect';
import { exportCatalogXlsx } from '../lib/exporters';
import { mergeCatalog, uid } from '../lib/normalize';
import ItemEditor from './ItemEditor';
import BoxIcon from './BoxIcon';

interface Props {
  catalog: CatalogItem[];
  setCatalog: (c: CatalogItem[]) => void;
  toast: (msg: string) => void;
}

type Filter = 'all' | 'check' | 'variants';
const PAGE = 60;

const needsCheck = (c: CatalogItem) => !!c.mixed || !(c.length || c.volumePerPackage) || !c.grossWeightPerUnit;

export default function CatalogPanel({ catalog, setCatalog, toast }: Props) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<{ item: CatalogItem; isNew: boolean } | null>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const tokens = norm(q).split(' ').filter(Boolean);
    return catalog
      .filter((c) => (filter === 'check' ? needsCheck(c) : filter === 'variants' ? (c.variants?.length ?? 0) > 1 : true))
      .filter((c) => {
        if (!tokens.length) return true;
        const hay = norm(`${c.code} ${c.pn} ${c.description}`);
        return tokens.every((t) => hay.includes(t));
      })
      .sort((a, b) => (a.description || a.code).localeCompare(b.description || b.code));
  }, [catalog, q, filter]);
  const toCheck = useMemo(() => catalog.filter(needsCheck).length, [catalog]);
  const withVariants = useMemo(() => catalog.filter((c) => (c.variants?.length ?? 0) > 1).length, [catalog]);

  const save = (item: CatalogItem) => {
    const exists = catalog.some((c) => c.id === item.id);
    setCatalog(exists ? catalog.map((c) => (c.id === item.id ? item : c)) : [item, ...catalog]);
    setEditing(null);
    toast('Article enregistré');
  };

  const newItem = (): CatalogItem => ({
    id: uid(), code: '', pn: '', description: '', unit: 'PCS', qtyPerPackage: 1, packageType: 'Carton',
    length: 0, width: 0, height: 0, volumePerPackage: 0, netWeightPerUnit: 0, grossWeightPerUnit: 0,
    hsCode: '', origin: '', source: 'Saisie manuelle', updatedAt: new Date().toISOString(), manual: true,
  });

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(catalog)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `base_articles_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const restoreBackup = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data)) throw new Error();
      if (!catalog.length) {
        setCatalog(data);
        return toast(`${data.length} articles chargés`);
      }
      const r = mergeCatalog(catalog, data);
      setCatalog(r.catalog);
      toast(`${r.added} ajoutés, ${r.updated} complétés`);
    } catch {
      toast('Fichier de base invalide');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Base d'articles</h2>
          <p className="hint">
            {catalog.length} articles · {withVariants} avec plusieurs emballages · {toCheck} à vérifier
          </p>
        </div>
        <div className="row wrap">
          <button className="btn primary" onClick={() => setEditing({ item: newItem(), isNew: true })}>
            + Article
          </button>
          <button className="btn" onClick={() => backupRef.current?.click()}>
            Charger une base JSON
          </button>
          <input
            ref={backupRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void restoreBackup(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <details className="menu">
            <summary className="btn ghost">Plus…</summary>
            <div className="menu-list">
              <button onClick={downloadBackup} disabled={!catalog.length}>
                Sauvegarder la base (JSON)
              </button>
              <button onClick={() => exportCatalogXlsx(catalog)} disabled={!catalog.length}>
                Exporter en Excel
              </button>
              <button
                className="danger"
                disabled={!catalog.length}
                onClick={() => confirm('Vider complètement la base d’articles ?') && setCatalog([])}
              >
                Vider la base
              </button>
            </div>
          </details>
        </div>
      </div>

      <div className="filter-bar">
        <div className="search-box small">
          <span className="search-icon">⌕</span>
          <input
            placeholder="Rechercher…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
          />
        </div>
        <div className="segmented">
          {(
            [
              ['all', 'Tous'],
              ['check', `À vérifier (${toCheck})`],
              ['variants', `Multi-emballages (${withVariants})`],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              className={filter === k ? 'on' : ''}
              onClick={() => {
                setFilter(k);
                setLimit(PAGE);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {catalog.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🗂️</div>
          <p>
            <b>Aucun article.</b>
            <br />
            Importez vos Packing Lists ou chargez une base JSON.
          </p>
        </div>
      ) : (
        <div className="item-list">
          {filtered.slice(0, limit).map((c) => (
            <button key={c.id} className="item-row" onClick={() => setEditing({ item: c, isNew: false })}>
              <BoxIcon l={c.length} w={c.width} h={c.height} size={38} />
              <div className="item-main">
                <b>{c.description || '(sans désignation)'}</b>
                <span className="mono">
                  {c.code}
                  {c.pn && c.pn !== c.code ? ` · ${c.pn}` : ''}
                </span>
              </div>
              <div className="item-pack">
                <span>
                  {c.qtyPerPackage} / {c.packageType}
                </span>
                <span className="hint">
                  {c.length ? `${c.length}×${c.width}×${c.height}` : c.volumePerPackage ? `${c.volumePerPackage} m³` : '—'} ·{' '}
                  {c.grossWeightPerUnit} kg/u
                </span>
              </div>
              <div className="item-flags">
                {(c.variants?.length ?? 0) > 1 && <span className="chip">{c.variants!.length} emb.</span>}
                {c.manual && <span className="chip chip-accent">manuel</span>}
                {needsCheck(c) && <span className="chip chip-warn">à vérifier</span>}
              </div>
            </button>
          ))}
          {filtered.length > limit && (
            <button className="btn ghost" onClick={() => setLimit(limit + PAGE)}>
              Afficher plus ({filtered.length - limit} restants)
            </button>
          )}
          {filtered.length === 0 && <p className="hint center">Aucun article ne correspond.</p>}
        </div>
      )}

      {editing && (
        <ItemEditor
          item={editing.item}
          isNew={editing.isNew}
          onSave={save}
          onDelete={() => {
            setCatalog(catalog.filter((c) => c.id !== editing.item.id));
            setEditing(null);
            toast('Article supprimé');
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
