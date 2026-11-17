import { useState } from 'react';
import type { CatalogItem } from '../types';
import { applyVariant, preferredVariant, variantsOf } from '../lib/variants';
import BoxIcon from './BoxIcon';
import InfoTip from './InfoTip';
import { packLabel, useLang } from '../lib/i18n';

interface Props {
  item: CatalogItem;
  isNew?: boolean;
  onSave: (item: CatalogItem) => void;
  onDelete: () => void;
  onClose: () => void;
}

type Field = { key: keyof CatalogItem; label: string; num?: boolean; mono?: boolean; wide?: boolean };
const IDENT: Field[] = [
  { key: 'code', label: 'Code article', mono: true },
  { key: 'pn', label: 'Part Number (PN)', mono: true },
  { key: 'description', label: 'Désignation', wide: true },
  { key: 'unit', label: 'Unité' },
  { key: 'hsCode', label: 'Code SH' },
  { key: 'origin', label: 'Origine' },
];
const PACK: Field[] = [
  { key: 'qtyPerPackage', label: 'Qté par colis', num: true },
  { key: 'packageType', label: 'Emballage' },
  { key: 'length', label: 'Longueur (cm)', num: true },
  { key: 'width', label: 'Largeur (cm)', num: true },
  { key: 'height', label: 'Hauteur (cm)', num: true },
  { key: 'netWeightPerUnit', label: 'Poids net / unité (kg)', num: true },
  { key: 'grossWeightPerUnit', label: 'Poids brut / unité (kg)', num: true },
];

export default function ItemEditor({ item, isNew, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState<CatalogItem>(item);
  const [packChanged, setPackChanged] = useState(false);
  const [error, setError] = useState('');
  const variants = variantsOf(item);
  const lang = useLang();

  const set = (f: Field, v: string) => {
    setDraft({ ...draft, [f.key]: f.num ? Number(v.replace(',', '.')) || 0 : v });
    if (PACK.includes(f)) setPackChanged(true);
  };
  const input = (f: Field) => (
    <label key={f.key} className={f.wide ? 'wide' : ''}>
      <span>{f.label}</span>
      <input
        className={f.mono ? 'mono' : ''}
        inputMode={f.num ? 'decimal' : undefined}
        value={String(draft[f.key] ?? '')}
        onChange={(e) => set(f, e.target.value)}
      />
    </label>
  );

  const save = () => {
    if (!draft.code.trim() && !draft.pn.trim()) return setError('Renseignez un code article ou un PN.');
    onSave({ ...draft, manual: draft.manual || packChanged, updatedAt: new Date().toISOString() });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="row">
            <BoxIcon l={draft.length} w={draft.width} h={draft.height} size={40} />
            <div>
              <h2>{isNew ? 'Nouvel article' : draft.description || draft.code}</h2>
              {!isNew && <span className="hint mono">{draft.code}</span>}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <h4>Identification</h4>
          <div className="form-grid">{IDENT.map(input)}</div>

          <h4>
            Emballage de référence
            {draft.manual && (
              <span className="chip-with-tip">
                <span className="chip chip-accent">corrigé à la main</span>
                <InfoTip k="manual" />
              </span>
            )}
            {draft.mixed && !draft.manual && (
              <span className="chip-with-tip">
                <span className="chip chip-warn">estimé (colis mixte)</span>
                <InfoTip k="mixed" />
              </span>
            )}
          </h4>
          <div className="form-grid">{PACK.map(input)}</div>
          {draft.manual && variants.length > 1 && (
            <button
              className="btn ghost small"
              onClick={() => {
                setDraft({ ...applyVariant(draft, preferredVariant(variants)), manual: false });
                setPackChanged(false);
              }}
            >
              Revenir au choix automatique
            </button>
          )}

          {variants.length > 1 && (
            <>
              <h4>
                Emballages observés dans vos PL ({variants.length}) <InfoTip k="variants" />
              </h4>
              <p className="hint">
                À la génération, l'application choisit automatiquement l'emballage le plus compact pour la quantité
                demandée{draft.manual ? ' — sauf si la fiche est corrigée à la main' : ''}.
              </p>
              <div className="variants">
                {variants.map((v, i) => (
                  <div key={i} className={`variant ${v.mixed ? 'mixed' : ''}`}>
                    <BoxIcon l={v.length} w={v.width} h={v.height} size={34} />
                    <div className="variant-info">
                      <b>
                        {v.qtyPerPackage} / {packLabel(v.packageType, lang)}
                      </b>
                      <span>
                        {v.length ? `${v.length}×${v.width}×${v.height} cm` : `${v.volumePerPackage} m³`} · brut{' '}
                        {v.grossWeightPerUnit} kg/u
                      </span>
                      <span className="hint">
                        code « {v.packageType} » · vu {v.count}× {v.mixed ? '· colis mixte' : ''} · {v.source}
                      </span>
                    </div>
                    <button
                      className="btn ghost small"
                      onClick={() => {
                        setDraft({ ...applyVariant(draft, v), manual: true });
                        setPackChanged(true);
                      }}
                    >
                      Utiliser
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}
        <footer className="modal-foot">
          {!isNew && (
            <button className="btn ghost danger" onClick={onDelete}>
              Supprimer
            </button>
          )}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" onClick={save}>
            Enregistrer
          </button>
        </footer>
      </div>
    </div>
  );
}
