import { useState } from 'react';
import type { CatalogItem } from '../types';
import { uid } from '../lib/normalize';
import InfoTip from './InfoTip';

interface Props {
  /** fiche existante (article connu mais incertain) ou null pour un code introuvable */
  item: CatalogItem | null;
  code: string;
  pn: string;
  onSave: (item: CatalogItem) => void;
  onClose: () => void;
}

const PACK_TYPES = ['Carton', 'Caisse', 'Palette', 'Sans emballage'];

type Field = 'description' | 'length' | 'width' | 'height' | 'net' | 'gross' | 'packageType';

/** Nombre saisi au clavier français ou anglais : "12,5" ou "12.5" */
const num = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

/**
 * Saisie rapide des dimensions et poids d'UNE unité emballée.
 * Chaque unité devient un colis ; les petites unités sont regroupées automatiquement.
 */
export default function QuickItemForm({ item, code, pn, onSave, onClose }: Props) {
  const unitKnown = item && item.qtyPerPackage === 1 && item.length > 0;
  const [f, setF] = useState<Record<Field, string>>({
    description: item?.description ?? '',
    length: unitKnown ? String(item!.length) : '',
    width: unitKnown ? String(item!.width) : '',
    height: unitKnown ? String(item!.height) : '',
    net: unitKnown || (item && item.netWeightPerUnit) ? String(item!.netWeightPerUnit || '') : '',
    gross: unitKnown || (item && item.grossWeightPerUnit) ? String(item!.grossWeightPerUnit || '') : '',
    packageType: unitKnown && PACK_TYPES.includes(item!.packageType) ? item!.packageType : 'Carton',
  });
  const [touched, setTouched] = useState(false);
  const set = (k: Field, v: string) => setF({ ...f, [k]: v });

  const L = num(f.length);
  const W = num(f.width);
  const H = num(f.height);
  const net = num(f.net);
  const gross = num(f.gross);

  const errors: Partial<Record<Field, string>> = {};
  for (const [k, v] of [['length', L], ['width', W], ['height', H]] as const) {
    if (!(v > 0)) errors[k] = 'Obligatoire';
    else if (v > 1500) errors[k] = 'Max 1500 cm';
  }
  if (!(net > 0)) errors.net = 'Obligatoire';
  if (f.gross && !(gross > 0)) errors.gross = 'Nombre invalide';
  if (gross > 0 && net > 0 && gross < net) errors.gross = 'Le brut doit être ≥ au net';
  const valid = Object.keys(errors).length === 0;
  const grossFinal = gross > 0 ? gross : net; // brut non saisi = net (sans emballage connu)
  const volume = valid ? (L * W * H) / 1e6 : 0;

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const now = new Date().toISOString();
    const base: CatalogItem = item ?? {
      id: uid(),
      code: code || pn,
      pn: pn || code,
      description: '',
      unit: 'PCS',
      qtyPerPackage: 1,
      packageType: 'Carton',
      length: 0,
      width: 0,
      height: 0,
      volumePerPackage: 0,
      netWeightPerUnit: 0,
      grossWeightPerUnit: 0,
      hsCode: '',
      origin: '',
      source: 'Saisie manuelle',
      updatedAt: now,
    };
    onSave({
      ...base,
      description: f.description.trim() || base.description || base.code,
      qtyPerPackage: 1,
      packageType: f.packageType,
      length: L,
      width: W,
      height: H,
      volumePerPackage: 0,
      netWeightPerUnit: net,
      grossWeightPerUnit: grossFinal,
      mixed: false,
      // la saisie manuelle prime sur les emballages déduits des PL (ceux-ci restent visibles dans la fiche)
      manual: true,
      source: item ? base.source : 'Saisie manuelle',
      updatedAt: now,
    });
  };

  const input = (k: Field, label: string, unit: string, mode: 'decimal' | 'text' = 'decimal') => (
    <label className={touched && errors[k] ? 'has-error' : ''}>
      <span>{label}</span>
      <div className="with-unit">
        <input inputMode={mode} value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder="0" />
        {unit && <em>{unit}</em>}
      </div>
      {touched && errors[k] && <small className="field-error">{errors[k]}</small>}
    </label>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal quick" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Dimensions de l'article</h2>
            <span className="hint mono">{code || pn}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <p className="hint">
            Indiquez les mesures d'<b>une unité emballée</b> <InfoTip k="unitPacked" />, telle qu'elle part chez le client. Chaque unité devient un colis ;
            les petites unités sont regroupées sur un carton ou une palette.
          </p>
          <label className="wide">
            <span>Désignation</span>
            <input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Ex. : Pompe CR 15-3" />
          </label>

          <h4>Dimensions d'une unité</h4>
          <div className="dims-grid">
            {input('length', 'Longueur', 'cm')}
            {input('width', 'Largeur', 'cm')}
            {input('height', 'Hauteur', 'cm')}
          </div>

          <h4>
            Poids d'une unité <InfoTip k="netGross" />
          </h4>
          <div className="dims-grid two">
            {input('net', 'Poids net', 'kg')}
            {input('gross', 'Poids brut', 'kg')}
          </div>
          <p className="hint">Brut = article + son emballage. Laissé vide, il est pris égal au net.</p>

          <h4>Emballage</h4>
          <div className="segmented">
            {PACK_TYPES.map((t) => (
              <button key={t} className={f.packageType === t ? 'on' : ''} onClick={() => set('packageType', t)}>
                {t}
              </button>
            ))}
          </div>

          {valid && (
            <div className="quick-preview">
              <span>
                1 colis = <b>{L} × {W} × {H} cm</b>
              </span>
              <span>
                {volume.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} m³ · {grossFinal.toLocaleString('fr-FR')} kg brut
              </span>
            </div>
          )}
        </div>
        <footer className="modal-foot">
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
