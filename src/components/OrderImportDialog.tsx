import { useState } from 'react';
import type { OrderLine } from '../lib/orderImport';

interface Props {
  fileName: string;
  lines: OrderLine[];
  onAdd: (lines: OrderLine[]) => void;
  onClose: () => void;
}

const MATCH: Record<OrderLine['match'], [string, string]> = {
  code: ['code reconnu', 'chip-ok'],
  approx: ['code lu à 1 chiffre près : vérifiez', 'chip-warn'],
  designation: ['reconnu par la désignation', 'chip-warn'],
  inconnu: ['absent de la base', 'chip-danger'],
};

/** Vérification des lignes lues dans le bon de commande avant de les ajouter à la PL */
export default function OrderImportDialog({ fileName, lines, onAdd, onClose }: Props) {
  const [rows, setRows] = useState(() => lines.map((l) => ({ ...l, keep: l.match !== 'inconnu' })));
  const kept = rows.filter((r) => r.keep && r.quantity > 0);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal order-import" role="dialog" aria-modal aria-labelledby="order-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h3 id="order-title">Commande client</h3>
            <span className="hint">
              {fileName} : {lines.length} article{lines.length > 1 ? 's' : ''} trouvé{lines.length > 1 ? 's' : ''}. Vérifiez les quantités avant d’ajouter.
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="modal-body">
          {!rows.length ? (
            <p className="hint">
              Aucun article reconnu dans ce document. Les codes article ou les désignations de votre base doivent y figurer. Pour une photo, prenez le
              document bien à plat, en pleine lumière.
            </p>
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Lignes de la commande">
              <table className="pl-table compact">
                <thead>
                  <tr>
                    <th aria-label="Ajouter" />
                    <th>Article</th>
                    <th className="num">Quantité</th>
                    <th>Lecture</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.code}-${i}`} className={r.keep ? '' : 'row-muted'}>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.keep}
                          aria-label={`Ajouter ${r.code}`}
                          onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))}
                        />
                      </td>
                      <td>
                        <span className="mono">{r.code}</span> {r.description}
                        <div className="hint small" title="Ligne lue dans le document">
                          « {r.raw.length > 90 ? `${r.raw.slice(0, 90)}…` : r.raw} »
                        </div>
                      </td>
                      <td className="num">
                        <input
                          className="qty-input"
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          value={r.quantity}
                          aria-label={`Quantité ${r.code}`}
                          onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) || 0 } : x)))}
                        />
                      </td>
                      <td>
                        <span className={`chip ${MATCH[r.match][1]}`}>{MATCH[r.match][0]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <footer className="modal-foot row wrap">
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={!kept.length} onClick={() => onAdd(kept)}>
            Ajouter {kept.length} ligne{kept.length > 1 ? 's' : ''} à la PL
          </button>
        </footer>
      </div>
    </div>
  );
}
