import { useMemo, useRef, useState } from 'react';
import type { CatalogItem, DimUnit, FieldKey, ImportDraft, WeightBasis } from '../types';
import { detectHeaderRow, detectMapping, FIELD_LABELS, FIELD_ORDER } from '../lib/detect';
import { readAnyFile } from '../lib/readFiles';
import { bestObservations, sapToCatalog } from '../lib/sapPackingList';
import { normalizeRows } from '../lib/normalize';

interface Props {
  onImport: (items: CatalogItem[], fileName: string) => { added: number; updated: number };
}

function makeDraft(fileName: string, tables: ImportDraft['tables'], tableIndex = 0): ImportDraft {
  const rows = tables[tableIndex]?.rows ?? [];
  const headerRow = detectHeaderRow(rows);
  return {
    fileName,
    tables,
    tableIndex,
    headerRow,
    mapping: detectMapping(rows[headerRow] ?? [], rows[headerRow + 1] ?? []),
    options: { weightBasis: 'line', dimUnit: 'auto' },
  };
}

/** Choisit la feuille contenant le plus d'en-têtes reconnues */
function bestTable(tables: ImportDraft['tables']) {
  let best = 0;
  let bestScore = -1;
  tables.forEach((t, i) => {
    const hr = detectHeaderRow(t.rows);
    const score = Object.keys(detectMapping(t.rows[hr] ?? [])).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

export default function ImportPanel({ onImport }: Props) {
  const queueRef = useRef<File[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [busy, setBusy] = useState<string | false>(false);
  const [log, setLog] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const openFile = async (file: File) => {
    setBusy(`Lecture de ${file.name}…`);
    try {
      const res = await readAnyFile(file, (m) => setBusy(`${file.name} : ${m}`));
      // Format SAP / Grundfos reconnu : import direct
      if (res.sap && res.sap.hus.some((h) => h.positions.length)) {
        const sap = res.sap;
        const items = bestObservations(sapToCatalog(sap, file.name));
        const r = onImport(items, file.name);
        const nPos = sap.hus.reduce((s, h) => s + h.positions.length, 0);
        setLog((l) => [
          `✅ ${file.name}${sap.number ? ` (PL ${sap.number})` : ''}${res.ocr ? ' [scan lu par OCR]' : ''} : ${sap.hus.length} colis, ${nPos} lignes → ${r.added} nouveaux articles, ${r.updated} mis à jour${sap.warnings.length ? ` ⚠️ ${sap.warnings.join(' ; ')}` : ''}`,
          ...l,
        ]);
        setBusy(false);
        next();
        return;
      }
      const tables = res.tables.filter((t) => t.rows.length > 0);
      if (!tables.length) throw new Error(res.ocr ? 'scan illisible' : 'aucune donnée lisible');
      setDraft(makeDraft(file.name, tables, bestTable(tables)));
    } catch (e) {
      setLog((l) => [`❌ ${file.name} : lecture impossible (${(e as Error).message})`, ...l]);
      next();
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    const f = queueRef.current.shift();
    setQueueCount(queueRef.current.length);
    if (f) void openFile(f);
    else setDraft(null);
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    queueRef.current.push(...files);
    if (!draft && !busy) next();
    else setQueueCount(queueRef.current.length);
  };

  const rows = draft ? draft.tables[draft.tableIndex].rows : [];
  const preview = useMemo(
    () => (draft ? normalizeRows(rows, draft.headerRow, draft.mapping, draft.options, draft.fileName) : null),
    [draft, rows],
  );
  const maxCols = Math.max(0, ...rows.slice(0, 60).map((r) => r.length));
  const header = draft ? rows[draft.headerRow] ?? [] : [];
  const colLabel = (i: number) => `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''} – ${header[i] || '(vide)'}`;

  const setMap = (f: FieldKey, v: string) => {
    if (!draft) return;
    const mapping = { ...draft.mapping };
    if (v === '') delete mapping[f];
    else mapping[f] = Number(v);
    setDraft({ ...draft, mapping });
  };

  const confirm = () => {
    if (!draft || !preview) return;
    const res = onImport(preview.items, draft.fileName);
    setLog((l) => [
      `✅ ${draft.fileName} : ${preview.items.length} lignes lues → ${res.added} nouveaux articles, ${res.updated} mis à jour`,
      ...l,
    ]);
    next();
  };

  const missing = draft && !(draft.mapping.code !== undefined || draft.mapping.pn !== undefined);
  const noQty = draft && draft.mapping.quantity === undefined;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Importer des Packing Lists</h2>
        </div>
      </div>
      <p className="hint">
        Formats acceptés : Excel (.xlsx, .xls), CSV et PDF (y compris scannés, lus par OCR). Les PL au format SAP
        (Grundfos : « Hand. unit / Material / Gross wt. ») sont importées directement. Pour les autres, les colonnes
        sont détectées automatiquement et vous pouvez corriger l'association avant d'ajouter à la base.{' '}
        <a href="/exemple_packing_list.xlsx" download>
          Télécharger un PL d'exemple
        </a>
      </p>

      <label
        className={`dropzone ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          multiple
          accept=".xlsx,.xls,.xlsm,.csv,.pdf"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="drop-icon">⤓</span>
        <strong>Déposez vos PL ici</strong>
        <span>ou touchez pour choisir — plusieurs fichiers possibles</span>
      </label>

      {busy && <p className="busy">⏳ {busy}</p>}
      {queueCount > 0 && <p className="muted">{queueCount} fichier(s) en attente</p>}

      {draft && preview && (
        <div className="card">
          <div className="row between">
            <h3>📄 {draft.fileName}</h3>
            <div className="row">
              <button className="btn ghost" onClick={() => next()}>
                Ignorer ce fichier
              </button>
              <button className="btn primary" disabled={!preview.items.length} onClick={confirm}>
                Ajouter {preview.items.length} article(s) à la base
              </button>
            </div>
          </div>

          <div className="grid4">
            {draft.tables.length > 1 && (
              <label>
                Feuille
                <select
                  value={draft.tableIndex}
                  onChange={(e) => setDraft({ ...makeDraft(draft.fileName, draft.tables, Number(e.target.value)), options: draft.options })}
                >
                  {draft.tables.map((t, i) => (
                    <option key={i} value={i}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Ligne d'en-tête
              <select
                value={draft.headerRow}
                onChange={(e) => {
                  const hr = Number(e.target.value);
                  setDraft({ ...draft, headerRow: hr, mapping: detectMapping(rows[hr] ?? [], rows[hr + 1] ?? []) });
                }}
              >
                {rows.slice(0, 40).map((r, i) => (
                  <option key={i} value={i}>
                    Ligne {i + 1} : {r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 60)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Les poids indiqués sont
              <select
                value={draft.options.weightBasis}
                onChange={(e) => setDraft({ ...draft, options: { ...draft.options, weightBasis: e.target.value as WeightBasis } })}
              >
                <option value="line">Totaux par ligne</option>
                <option value="unit">Par unité</option>
                <option value="package">Par colis</option>
              </select>
            </label>
            <label>
              Unité des dimensions
              <select
                value={draft.options.dimUnit}
                onChange={(e) => setDraft({ ...draft, options: { ...draft.options, dimUnit: e.target.value as DimUnit } })}
              >
                <option value="auto">Détection auto</option>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="m">m</option>
              </select>
            </label>
          </div>

          <h4>Association des colonnes</h4>
          <div className="mapping">
            {FIELD_ORDER.map((f) => (
              <label key={f} className={draft.mapping[f] !== undefined ? 'mapped' : ''}>
                {FIELD_LABELS[f]}
                <select value={draft.mapping[f] ?? ''} onChange={(e) => setMap(f, e.target.value)}>
                  <option value="">— non utilisé —</option>
                  {Array.from({ length: maxCols }, (_, i) => (
                    <option key={i} value={i}>
                      {colLabel(i)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {missing && <p className="warn">⚠️ Associez au moins une colonne « Code article » ou « PN ».</p>}
          {noQty && <p className="warn">⚠️ Associez la colonne « Quantité » (nécessaire pour calculer les valeurs unitaires).</p>}

          <h4>
            Aperçu des articles extraits ({preview.items.length}
            {preview.skipped ? `, ${preview.skipped} ligne(s) ignorée(s)` : ''})
          </h4>
          <div className="table-wrap small">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>PN</th>
                  <th>Désignation</th>
                  <th>Qté/colis</th>
                  <th>Emballage</th>
                  <th>Dim. colis (cm)</th>
                  <th>Net/u (kg)</th>
                  <th>Brut/u (kg)</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.slice(0, 15).map((it) => (
                  <tr key={it.id}>
                    <td>{it.code}</td>
                    <td>{it.pn}</td>
                    <td>{it.description}</td>
                    <td className="num">{it.qtyPerPackage}</td>
                    <td>{it.packageType}</td>
                    <td className={it.length ? '' : 'miss'}>
                      {it.length ? `${it.length} × ${it.width} × ${it.height}` : it.volumePerPackage ? `${it.volumePerPackage} m³` : '—'}
                    </td>
                    <td className={`num ${it.netWeightPerUnit ? '' : 'miss'}`}>{it.netWeightPerUnit}</td>
                    <td className={`num ${it.grossWeightPerUnit ? '' : 'miss'}`}>{it.grossWeightPerUnit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.items.length > 15 && <p className="muted">… et {preview.items.length - 15} autres.</p>}

          <details>
            <summary>Voir le fichier brut</summary>
            <div className="table-wrap small">
              <table>
                <tbody>
                  {rows.slice(0, 80).map((r, i) => (
                    <tr key={i} className={i === draft.headerRow ? 'hdr' : ''}>
                      <td className="muted">{i + 1}</td>
                      {Array.from({ length: maxCols }, (_, c) => (
                        <td key={c}>{r[c]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {log.length > 0 && (
        <ul className="log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
