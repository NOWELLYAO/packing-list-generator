import { useMemo, useRef, useState } from 'react';
import type { CatalogItem } from '../types';
import { norm } from '../lib/detect';
import { exportCatalogXlsx } from '../lib/exporters';
import { mergeCatalog, uid } from '../lib/normalize';

interface Props {
  catalog: CatalogItem[];
  setCatalog: (c: CatalogItem[]) => void;
}

type Col = { key: keyof CatalogItem; label: string; num?: boolean; w?: number };
const COLS: Col[] = [
  { key: 'code', label: 'Code article', w: 120 },
  { key: 'pn', label: 'PN', w: 120 },
  { key: 'description', label: 'Désignation', w: 220 },
  { key: 'unit', label: 'Unité', w: 60 },
  { key: 'qtyPerPackage', label: 'Qté/colis', num: true, w: 75 },
  { key: 'packageType', label: 'Emballage', w: 90 },
  { key: 'length', label: 'L (cm)', num: true, w: 65 },
  { key: 'width', label: 'l (cm)', num: true, w: 65 },
  { key: 'height', label: 'H (cm)', num: true, w: 65 },
  { key: 'netWeightPerUnit', label: 'Net/u (kg)', num: true, w: 80 },
  { key: 'grossWeightPerUnit', label: 'Brut/u (kg)', num: true, w: 80 },
  { key: 'hsCode', label: 'Code SH', w: 90 },
  { key: 'origin', label: 'Origine', w: 70 },
];

const PAGE = 100;

export default function CatalogPanel({ catalog, setCatalog }: Props) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const backupRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const n = norm(q);
    if (!n) return catalog;
    return catalog.filter((c) => norm(`${c.code} ${c.pn} ${c.description} ${c.source}`).includes(n));
  }, [catalog, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const incomplete = catalog.filter((c) => !(c.length || c.volumePerPackage) || !c.grossWeightPerUnit).length;

  const update = (id: string, key: keyof CatalogItem, value: string) => {
    const col = COLS.find((c) => c.key === key);
    setCatalog(
      catalog.map((c) =>
        c.id === id
          ? { ...c, [key]: col?.num ? Number(value.replace(',', '.')) || 0 : value, updatedAt: new Date().toISOString() }
          : c,
      ),
    );
  };

  const addEmpty = () => {
    setQ('');
    setPage(0);
    setCatalog([
      {
        id: uid(), code: '', pn: '', description: '', unit: 'PCS', qtyPerPackage: 1, packageType: 'Carton',
        length: 0, width: 0, height: 0, volumePerPackage: 0, netWeightPerUnit: 0, grossWeightPerUnit: 0,
        hsCode: '', origin: '', source: 'Saisie manuelle', updatedAt: new Date().toISOString(),
      },
      ...catalog,
    ]);
  };

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sauvegarde_catalogue_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const restoreBackup = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data)) throw new Error();
      if (!catalog.length) return setCatalog(data);
      if (confirm(`Fusionner ${data.length} articles avec la base actuelle (${catalog.length}) ?\nOK = fusionner, Annuler = remplacer`))
        setCatalog(mergeCatalog(catalog, data).catalog);
      else if (confirm('Remplacer toute la base actuelle ?')) setCatalog(data);
    } catch {
      alert('Fichier de sauvegarde invalide.');
    }
  };

  return (
    <div className="panel">
      <div className="row between wrap">
        <h2>2. Base d'articles ({catalog.length})</h2>
        <div className="row wrap">
          <button onClick={addEmpty}>+ Article</button>
          <button onClick={() => exportCatalogXlsx(catalog)} disabled={!catalog.length}>
            Exporter Excel
          </button>
          <button onClick={downloadBackup} disabled={!catalog.length}>
            Sauvegarde JSON
          </button>
          <button onClick={() => backupRef.current?.click()}>Charger une base JSON</button>
          <input ref={backupRef} type="file" accept=".json" hidden onChange={(e) => restoreBackup(e.target.files?.[0])} />
          <button
            className="danger"
            disabled={!catalog.length}
            onClick={() => confirm('Vider complètement la base d’articles ?') && setCatalog([])}
          >
            Vider
          </button>
        </div>
      </div>
      <p className="muted">
        Les valeurs sont ramenées à l'unité (poids) et au colis (dimensions, quantité par colis). Toutes les cellules
        sont modifiables. Les données sont stockées dans votre navigateur.
        {incomplete > 0 && <span className="warn"> {incomplete} article(s) sans dimensions ou poids (surlignés).</span>}
      </p>
      <input
        className="search"
        placeholder="Rechercher par code, PN, désignation, fichier…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
      />
      {catalog.length === 0 ? (
        <p className="empty">Aucun article. Commencez par charger des Packing Lists dans l'onglet « Importer ».</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="editable">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} style={{ minWidth: c.w }}>
                      {c.label}
                    </th>
                  ))}
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((it) => (
                  <tr key={it.id}>
                    {COLS.map((c) => {
                      const v = it[c.key];
                      const miss =
                        (['length', 'width', 'height'].includes(c.key) && !it.length && !it.volumePerPackage) ||
                        (c.key === 'grossWeightPerUnit' && !it.grossWeightPerUnit);
                      return (
                        <td key={c.key} className={miss ? 'miss' : ''}>
                          <input
                            className={c.num ? 'num' : ''}
                            defaultValue={String(v ?? '')}
                            onBlur={(e) => e.target.value !== String(v ?? '') && update(it.id, c.key, e.target.value)}
                          />
                        </td>
                      );
                    })}
                    <td className="muted src" title={it.mixed ? 'Valeurs estimées : colis partagé avec d’autres articles. ' + it.source : it.source}>
                      {it.mixed && '⚠️ '}
                      {it.source}
                    </td>
                    <td>
                      <button
                        className="icon"
                        title="Supprimer"
                        onClick={() => setCatalog(catalog.filter((c) => c.id !== it.id))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="row center">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                ←
              </button>
              <span>
                Page {page + 1} / {pages}
              </span>
              <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
