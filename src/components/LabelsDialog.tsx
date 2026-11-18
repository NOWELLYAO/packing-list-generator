import { useState } from 'react';
import type { PackingList, Settings } from '../types';
import type { LabelOptions } from '../lib/labels';

interface Props {
  pl: PackingList;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onClose: () => void;
}

const DEFAULTS: LabelOptions = { format: 'a6', marking: '', reference: '', fragile: false, noStack: false };

/** Réglages des étiquettes de colis, puis génération du PDF */
export default function LabelsDialog({ pl, settings, setSettings, onClose }: Props) {
  // seuls le format et les pictogrammes sont mémorisés ; destinataire et référence repartent vides à chaque fois
  const remembered = settings.labels ?? DEFAULTS;
  const [o, setO] = useState<LabelOptions>({ ...DEFAULTS, format: remembered.format, fragile: remembered.fragile, noStack: remembered.noStack });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const n = pl.packages.length;
  const sheets = o.format === 'a6' ? Math.ceil(n / 4) : n;

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      setSettings({ ...settings, labels: { ...o, marking: '', reference: '' } });
      const { exportLabelsPdf } = await import('../lib/labels');
      await exportLabelsPdf(pl, settings, o);
      onClose();
    } catch (e) {
      console.error(e);
      setError("Les étiquettes n'ont pas pu être générées. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal labels" role="dialog" aria-modal aria-labelledby="labels-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="labels-title">Étiquettes de colis</h2>
            <span className="hint">
              {n} étiquette{n > 1 ? 's' : ''} · {sheets} page{sheets > 1 ? 's' : ''} à imprimer
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="modal-body labels-form">
          <fieldset className="field">
            <legend>Format</legend>
            <div className="segmented">
              <button className={o.format === 'a6' ? 'on' : ''} onClick={() => setO({ ...o, format: 'a6' })}>
                A4 · 4 étiquettes A6
              </button>
              <button className={o.format === '100x150' ? 'on' : ''} onClick={() => setO({ ...o, format: '100x150' })}>
                100 × 150 mm (thermique)
              </button>
            </div>
          </fieldset>
          <label className="field">
            <span>Destinataire (facultatif)</span>
            <textarea
              rows={3}
              value={o.marking}
              placeholder="Saisissez le nom du destinataire si besoin — laissé vide, l'étiquette n'en comporte pas"
              onChange={(e) => setO({ ...o, marking: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Référence d'expédition (facultatif)</span>
            <input value={o.reference} placeholder="N° de commande, de dossier…" onChange={(e) => setO({ ...o, reference: e.target.value })} />
          </label>
          <fieldset className="field">
            <legend>Pictogrammes</legend>
            <label className="check">
              <input type="checkbox" checked disabled /> Haut (toujours imprimé)
            </label>
            <label className="check">
              <input type="checkbox" checked={o.fragile} onChange={(e) => setO({ ...o, fragile: e.target.checked })} /> Fragile
            </label>
            <label className="check">
              <input type="checkbox" checked={o.noStack} onChange={(e) => setO({ ...o, noStack: e.target.checked })} /> Ne pas gerber
            </label>
          </fieldset>
          <p className="hint">
            Chaque étiquette porte le n° du colis sur le total, ses dimensions et poids, son contenu et un QR code qui reprend ces informations
            (lisible avec l'appareil photo d'un téléphone). Langue : {(settings.lang ?? 'fr') === 'fr' ? 'français' : 'anglais'}, comme la PL.
          </p>
          {error && <div className="banner danger">{error}</div>}
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy} onClick={generate}>
            {busy ? 'Génération…' : 'Générer le PDF'}
          </button>
        </footer>
      </div>
    </div>
  );
}
