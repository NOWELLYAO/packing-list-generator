import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { CatalogItem, PackingList, RequestLine } from '../types';
import { findItem, generatePackingList, parsePastedRequests } from '../lib/generate';
import { exportPackingListPdf, exportPackingListXlsx, exportRequestTemplate } from '../lib/exporters';
import { uid } from '../lib/normalize';
import { usePersistent } from '../lib/storage';
import { detectHeaderRow, detectMapping } from '../lib/detect';
import { parseNumber } from '../lib/parseValues';
import PackingListView from './PackingListView';

const newLine = (): RequestLine => ({ id: uid(), code: '', pn: '', quantity: 1 });

export default function GeneratorPanel({ catalog }: { catalog: CatalogItem[] }) {
  const [consolidate, setConsolidate] = usePersistent<boolean>('consolidate', true);
  const [lines, setLines] = usePersistent<RequestLine[]>('requests', [newLine()]);
  const [paste, setPaste] = useState('');
  const [result, setResult] = useState<PackingList | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const codes = useMemo(() => [...new Set(catalog.map((c) => c.code).filter(Boolean))], [catalog]);
  const pns = useMemo(() => [...new Set(catalog.map((c) => c.pn).filter(Boolean))], [catalog]);

  const setLine = (id: string, patch: Partial<RequestLine>) =>
    setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  /** Remplit automatiquement l'autre identifiant (code <-> PN) quand l'article est trouvé */
  const autoComplete = (l: RequestLine) => {
    const it = findItem(catalog, l.code, l.pn);
    if (it) setLine(l.id, { code: l.code || it.code, pn: l.pn || it.pn });
  };

  const addPasted = () => {
    const parsed = parsePastedRequests(paste);
    if (!parsed.length) return alert('Aucune ligne reconnue. Format attendu : Code [tab] PN [tab] Quantité');
    const kept = lines.filter((l) => l.code || l.pn);
    setLines([
      ...kept,
      ...parsed.map((p) => {
        const it = findItem(catalog, p.code, p.pn);
        return { ...p, code: it ? it.code : p.code, pn: it ? it.pn : p.pn, id: uid() };
      }),
    ]);
    setPaste('');
  };

  const importRequestFile = async (f: File | undefined) => {
    if (!f) return;
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
      .map((r) => r.map((c) => String(c ?? '').trim()));
    const hr = detectHeaderRow(rows);
    const m = detectMapping(rows[hr] ?? []);
    if (m.quantity === undefined || (m.code === undefined && m.pn === undefined)) {
      return alert('Colonnes non reconnues. Utilisez le modèle : Code article | PN | Quantité');
    }
    const parsed: RequestLine[] = [];
    for (const r of rows.slice(hr + 1)) {
      const code = m.code !== undefined ? r[m.code] ?? '' : '';
      const pn = m.pn !== undefined ? r[m.pn] ?? '' : '';
      const qty = parseNumber(r[m.quantity]);
      if ((code || pn) && qty > 0) parsed.push({ id: uid(), code, pn, quantity: qty });
    }
    const kept = lines.filter((l) => l.code || l.pn);
    setLines([...kept, ...parsed]);
  };

  const generate = () => {
    const pl = generatePackingList(catalog, lines, { consolidate });
    if (!pl.lines.length) return alert('Saisissez au moins un article avec une quantité.');
    setResult(pl);
    setTimeout(() => document.getElementById('pl-result')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <div className="panel">
      <h2>3. Générer une Packing List</h2>
      {catalog.length === 0 && (
        <p className="warn">⚠️ La base d'articles est vide : importez d'abord vos Packing Lists existantes.</p>
      )}

      <div className="card">
        <div className="row between wrap">
          <h3>Articles à expédier</h3>
          <div className="row wrap">
            <button onClick={() => fileRef.current?.click()}>Importer Excel</button>
            <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => {
              void importRequestFile(e.target.files?.[0]);
              e.target.value = '';
            }} />
            <button className="ghost" onClick={exportRequestTemplate}>
              Modèle Excel
            </button>
            <button className="ghost" onClick={() => confirm('Effacer toutes les lignes ?') && setLines([newLine()])}>
              Tout effacer
            </button>
          </div>
        </div>

        <datalist id="codes">
          {codes.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="pns">
          {pns.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <div className="table-wrap">
          <table className="editable">
            <thead>
              <tr>
                <th>#</th>
                <th>Code article</th>
                <th>PN</th>
                <th>Quantité</th>
                <th>Article trouvé</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const it = l.code || l.pn ? findItem(catalog, l.code, l.pn) : undefined;
                return (
                  <tr key={l.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <input list="codes" value={l.code} onChange={(e) => setLine(l.id, { code: e.target.value })} onBlur={() => autoComplete(l)} />
                    </td>
                    <td>
                      <input list="pns" value={l.pn} onChange={(e) => setLine(l.id, { pn: e.target.value })} onBlur={() => autoComplete(l)} />
                    </td>
                    <td>
                      <input
                        className="num"
                        type="number"
                        min={0}
                        step="any"
                        value={l.quantity}
                        onChange={(e) => setLine(l.id, { quantity: Number(e.target.value) })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && i === lines.length - 1) setLines([...lines, newLine()]);
                        }}
                      />
                    </td>
                    <td className={l.code || l.pn ? (it ? 'ok' : 'miss') : 'muted'}>
                      {l.code || l.pn ? (it ? `✓ ${it.description || it.code}` : '✗ introuvable') : ''}
                    </td>
                    <td>
                      <button className="icon" title="Supprimer" onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.id !== l.id) : [newLine()])}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={() => setLines([...lines, newLine()])}>+ Ligne</button>

        <details className="paste">
          <summary>Coller une liste depuis Excel</summary>
          <p className="muted">Une ligne par article : Code [tab] PN [tab] Quantité — ou Code ; Quantité.</p>
          <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'ART-001\tPN-123\t10\nART-002\t\t4'} />
          <button onClick={addPasted} disabled={!paste.trim()}>
            Ajouter ces lignes
          </button>
        </details>
      </div>

      <label className="option">
        <input type="checkbox" checked={consolidate} onChange={(e) => setConsolidate(e.target.checked)} />
        <span>
          <b>Regrouper les petits articles</b> sur un carton ou une palette commune (colis de moins de 0,15 m³ et 60 kg).
          Les palettes incomplètes sont toujours recalculées (hauteur et poids selon la quantité).
        </span>
      </label>

      <div className="row center">
        <button className="primary big" onClick={generate}>
          Générer la Packing List
        </button>
      </div>

      {result && (
        <div id="pl-result" className="card">
          <div className="row between wrap no-print">
            <h3>Résultat</h3>
            <div className="row wrap">
              <button onClick={() => exportPackingListXlsx(result)}>⬇ Excel</button>
              <button onClick={() => void exportPackingListPdf(result)}>⬇ PDF</button>
              <button onClick={() => window.print()}>🖨 Imprimer</button>
            </div>
          </div>
          <PackingListView pl={result} />
        </div>
      )}
    </div>
  );
}
