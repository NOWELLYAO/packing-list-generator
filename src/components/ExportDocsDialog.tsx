import { useMemo, useState } from 'react';
import type { CatalogItem, PackingList, Settings } from '../types';
import { suggestHs } from '../lib/hsCodes';
import type { ExportLine } from '../lib/exportDocs';
import { isChunkLoadError, reloadForUpdate } from '../lib/updates';

interface Props {
  pl: PackingList;
  catalog: CatalogItem[];
  settings: Settings;
  setSettings: (s: Settings) => void;
  /** enregistre codes SH et origines dans la base (proposition à l'administrateur si besoin) */
  saveToCatalog?: (c: CatalogItem[]) => void;
  toast: (m: string) => void;
  onClose: () => void;
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const CURRENCIES = ['EUR', 'USD', 'XOF', 'XAF', 'GHS', 'MAD', 'GBP'];

/** Dossier export : facture proforma, récapitulatif douanier, déclaration d'origine */
export default function ExportDocsDialog({ pl, catalog, settings, setSettings, saveToCatalog, toast, onClose }: Props) {
  const ed = settings.exportDoc;
  const [head, setHead] = useState({
    number: pl.reference || `PF-${pl.date.replace(/-/g, '')}`,
    seller: ed?.seller || settings.companyName || '',
    buyer: ed?.buyer || '',
    incoterm: ed?.incoterm || 'EXW',
    currency: ed?.currency || 'EUR',
    payment: ed?.payment || '',
  });
  const initial = useMemo(
    () =>
      pl.lines
        .filter((l) => l.found && l.quantity > 0)
        .map((l) => {
          const sug = l.hsCode ? null : suggestHs(l.description);
          return {
            code: l.code,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            hsCode: l.hsCode || sug?.code || '',
            hsSuggested: !!sug,
            origin: l.origin || '',
            unitPrice: ed?.prices?.[l.code] ?? 0,
            netWeight: l.netWeight,
            grossWeight: l.grossWeight,
          };
        }),
    [pl, ed],
  );
  const [lines, setLines] = useState(initial);
  const [saveBase, setSaveBase] = useState(true);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch, ...('hsCode' in patch ? { hsSuggested: false } : {}) } : l)));
  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const missing = { price: lines.filter((l) => !l.unitPrice).length, hs: lines.filter((l) => !l.hsCode).length, origin: lines.filter((l) => !l.origin).length };

  const go = async () => {
    setBusy(true);
    try {
      // mémorise vendeur, conditions et prix pour la prochaine fois
      const prices = { ...(ed?.prices ?? {}) };
      for (const l of lines) if (l.unitPrice > 0) prices[l.code] = l.unitPrice;
      setSettings({ ...settings, exportDoc: { seller: head.seller, buyer: head.buyer, incoterm: head.incoterm, currency: head.currency, payment: head.payment, prices } });
      if (saveBase && saveToCatalog) {
        const byCode = new Map(lines.map((l) => [l.code, l] as const));
        let changed = 0;
        const next = catalog.map((it) => {
          const l = byCode.get(it.code);
          if (!l || (l.hsCode === (it.hsCode || '') && l.origin.toUpperCase() === (it.origin || '').toUpperCase())) return it;
          if (!l.hsCode && !l.origin) return it;
          changed++;
          return { ...it, hsCode: l.hsCode || it.hsCode, origin: (l.origin || it.origin).toUpperCase(), updatedAt: new Date().toISOString() };
        });
        if (changed) saveToCatalog(next);
      }
      const { exportDossierPdf } = await import('../lib/exportDocs');
      const out: ExportLine[] = lines.map(({ hsSuggested: _h, ...l }) => ({ ...l, origin: l.origin.toUpperCase() }));
      await exportDossierPdf(pl, { ...head, date: pl.date, lines: out }, settings);
      onClose();
    } catch (e) {
      if (isChunkLoadError(e)) return reloadForUpdate();
      toast('Le dossier n’a pas pu être généré');
    } finally {
      setBusy(false);
    }
  };

  const money = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal export-docs" role="dialog" aria-modal aria-labelledby="export-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h3 id="export-title">Dossier export</h3>
            <span className="hint">Facture proforma, récapitulatif douanier et déclaration d’origine, en un seul PDF.</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <div className="export-head">
            <label>
              <span>N° de facture proforma</span>
              <input value={head.number} onChange={(e) => setHead({ ...head, number: e.target.value })} />
            </label>
            <label>
              <span>Incoterm</span>
              <select value={head.incoterm} onChange={(e) => setHead({ ...head, incoterm: e.target.value })}>
                {INCOTERMS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Devise</span>
              <select value={head.currency} onChange={(e) => setHead({ ...head, currency: e.target.value })}>
                {CURRENCIES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Conditions de paiement</span>
              <input value={head.payment} placeholder="ex. 30 % à la commande, solde à l’expédition" onChange={(e) => setHead({ ...head, payment: e.target.value })} />
            </label>
            <label className="wide">
              <span>Vendeur / expéditeur</span>
              <textarea rows={3} value={head.seller} placeholder="Raison sociale, adresse, n° d’identification fiscale" onChange={(e) => setHead({ ...head, seller: e.target.value })} />
            </label>
            <label className="wide">
              <span>Acheteur / destinataire</span>
              <textarea rows={3} value={head.buyer} placeholder="Raison sociale, adresse, pays" onChange={(e) => setHead({ ...head, buyer: e.target.value })} />
            </label>
          </div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Articles du dossier export">
            <table className="pl-table compact">
              <thead>
                <tr>
                  <th>Article</th>
                  <th className="num">Qté</th>
                  <th>Code SH</th>
                  <th>Origine</th>
                  <th className="num">Prix unit.</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.code}>
                    <td>
                      <span className="mono">{l.code}</span> {l.description}
                    </td>
                    <td className="num">{l.quantity}</td>
                    <td>
                      <input
                        className={`hs-input ${l.hsSuggested ? 'suggested' : ''}`}
                        value={l.hsCode}
                        placeholder="0000.00"
                        title={l.hsSuggested ? 'Code proposé d’après la désignation : à valider' : undefined}
                        onChange={(e) => upd(i, { hsCode: e.target.value.replace(/[^\d.]/g, '') })}
                      />
                    </td>
                    <td>
                      <input className="origin-input" value={l.origin} maxLength={3} placeholder="HU" onChange={(e) => upd(i, { origin: e.target.value.toUpperCase() })} />
                    </td>
                    <td className="num">
                      <input
                        className="price-input"
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        value={l.unitPrice || ''}
                        onChange={(e) => upd(i, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </td>
                    <td className="num">{l.unitPrice ? money(l.quantity * l.unitPrice) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>
                    <b>Total {head.currency}</b>
                  </td>
                  <td className="num">
                    <b>{money(total)}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="hint small">
            Codes SH en orange : proposés d’après la désignation, à valider par votre transitaire. Origine : code pays à 2 lettres (HU, DK, CN…).
            {(missing.price || missing.hs || missing.origin) > 0 &&
              ` À compléter : ${[missing.price && `${missing.price} prix`, missing.hs && `${missing.hs} code(s) SH`, missing.origin && `${missing.origin} origine(s)`].filter(Boolean).join(', ')}.`}
          </p>
          {saveToCatalog && (
            <label className="check">
              <input type="checkbox" checked={saveBase} onChange={(e) => setSaveBase(e.target.checked)} /> Enregistrer les codes SH et origines dans la base
              d’articles
            </label>
          )}
        </div>
        <footer className="modal-foot row wrap">
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy || !lines.length} onClick={() => void go()}>
            {busy ? 'Génération…' : 'Générer le dossier (PDF)'}
          </button>
        </footer>
      </div>
    </div>
  );
}
