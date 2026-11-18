import { useState } from 'react';
import type { CatalogItem } from '../types';
import { applyVariant, preferredVariant, variantsOf } from '../lib/variants';
import BoxIcon from './BoxIcon';
import { readUserNumber } from '../lib/validate';
import { itemIssues } from '../lib/quality';
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

const NUM_FIELDS: Field[] = PACK.filter((f) => f.num);

export default function ItemEditor({ item, isNew, onSave, onDelete, onClose }: Props) {
  const [draft, setDrafted] = useState<CatalogItem>(item);
  // texte saisi dans les champs numériques (lu seulement à l'enregistrement : "1 234,5" ou "12," restent intacts)
  const rawFrom = (d: CatalogItem) => Object.fromEntries(NUM_FIELDS.map((f) => [f.key, String(d[f.key] ?? '')])) as Record<string, string>;
  const [raw, setRaw] = useState<Record<string, string>>(() => rawFrom(item));
  const setDraft = (d: CatalogItem) => {
    setDrafted(d);
    setRaw(rawFrom(d));
  };
  const [packChanged, setPackChanged] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const variants = variantsOf(item);
  const lang = useLang();

  const set = (f: Field, v: string) => {
    if (f.num) setRaw({ ...raw, [f.key]: v });
    else setDrafted({ ...draft, [f.key]: v });
    if (PACK.includes(f)) setPackChanged(true);
    if (fieldErrors[f.key]) setFieldErrors({ ...fieldErrors, [f.key]: '' });
  };
  const input = (f: Field) => (
    <label key={f.key} className={`${f.wide ? 'wide' : ''} ${fieldErrors[f.key] ? 'has-error' : ''}`}>
      <span>{f.label}</span>
      <input
        className={f.mono ? 'mono' : ''}
        inputMode={f.num ? 'decimal' : undefined}
        value={f.num ? raw[f.key] ?? '' : String(draft[f.key] ?? '')}
        onChange={(e) => set(f, e.target.value)}
      />
      {fieldErrors[f.key] && <small className="field-error">{fieldErrors[f.key]}</small>}
    </label>
  );

  const save = () => {
    if (!draft.code.trim() && !draft.pn.trim()) return setError('Renseignez un code article ou un PN.');
    // lecture et contrôle des nombres
    const errs: Record<string, string> = {};
    const vals: Record<string, number> = {};
    for (const f of NUM_FIELDS) {
      const txt = (raw[f.key] ?? '').trim();
      const n = txt === '' ? 0 : readUserNumber(txt);
      if (!Number.isFinite(n)) errs[f.key] = 'Nombre invalide';
      else if (n < 0) errs[f.key] = 'Doit être positif';
      else vals[f.key] = n;
    }
    for (const k of ['length', 'width', 'height']) if (vals[k] > 1500) errs[k] = 'Max 1500 cm';
    if (!errs.qtyPerPackage && !(vals.qtyPerPackage > 0)) errs.qtyPerPackage = 'Doit être supérieur à 0';
    if (!errs.grossWeightPerUnit && !errs.netWeightPerUnit && vals.grossWeightPerUnit < vals.netWeightPerUnit)
      errs.grossWeightPerUnit = 'Le brut doit être ≥ au net';
    const dims = [vals.length, vals.width, vals.height];
    if (dims.some((x) => x > 0) && dims.some((x) => !(x > 0))) for (const k of ['length', 'width', 'height']) if (!(vals[k] > 0)) errs[k] = 'Renseignez les 3 dimensions';
    setFieldErrors(errs);
    if (Object.values(errs).some(Boolean)) return setError('Corrigez les champs signalés en rouge.');
    onSave({ ...draft, ...vals, manual: draft.manual || packChanged, updatedAt: new Date().toISOString() });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal aria-labelledby="item-editor-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="row">
            <BoxIcon l={draft.length} w={draft.width} h={draft.height} size={40} />
            <div>
              <h2 id="item-editor-title">{isNew ? 'Nouvel article' : draft.description || draft.code}</h2>
              {!isNew && <span className="hint mono">{draft.code}</span>}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="modal-body">
          {itemIssues(item).length > 0 && !item.manual && (
            <div className={`quality ${itemIssues(item).some((i) => i.severity === 'error') ? 'error' : ''}`}>
              <b>Contrôle qualité</b>
              <ul>
                {itemIssues(item).map((i) => (
                  <li key={i.code}>
                    {i.severity === 'error' ? '⛔' : '⚠️'} {i.message}
                  </li>
                ))}
              </ul>
              <span className="hint">
                Corrigez les valeurs ci-dessous avec les mesures réelles : la fiche passera en « corrigée à la main » et sera prioritaire.
              </span>
            </div>
          )}
          <h3 className="card-title">Identification</h3>
          <div className="form-grid">{IDENT.map(input)}</div>

          <h3 className="card-title">
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
          </h3>
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
              <h3 className="card-title">
                Emballages observés dans vos PL ({variants.length}) <InfoTip k="variants" />
              </h3>
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
