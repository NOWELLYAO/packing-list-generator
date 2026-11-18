import { useState } from 'react';
import type { CatalogItem, PackVariant } from '../types';
import { applyVariant, preferredVariant, SAP_SOURCE, variantsOf } from '../lib/variants';
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
  const variants = variantsOf(draft);
  const [addOpen, setAddOpen] = useState(false);
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

          <AddPacking
            open={addOpen}
            setOpen={setAddOpen}
            onAdd={(v) => {
              // emballage de la fiche article du fabricant : fiable, il devient une variante (le choix par quantité reste automatique)
              const vs = [...(draft.variants?.length ? draft.variants : variantsOf(draft)).filter((x) => !(x.source === v.source && x.qtyPerPackage === v.qtyPerPackage)), v];
              setDraft({ ...applyVariant({ ...draft, variants: vs }, preferredVariant(vs)), variants: vs, manual: false, mixed: false });
              setPackChanged(false);
            }}
          />

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
                    {v.source === SAP_SOURCE && (
                      <button
                        className="btn ghost small danger"
                        onClick={() => {
                          const vs = (draft.variants ?? []).filter((x) => !(x.source === SAP_SOURCE && x.qtyPerPackage === v.qtyPerPackage));
                          setDraft(vs.length ? { ...applyVariant({ ...draft, variants: vs }, preferredVariant(vs)), variants: vs } : { ...draft, variants: undefined });
                        }}
                      >
                        Retirer
                      </button>
                    )}
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

const TYPES = ['Carton', 'Palette', 'Demi-palette', 'Caisse'];

/** Saisie d'un emballage depuis la fiche article du fabricant (SAP MM03 → Unités de mesure) : quantité, dimensions, poids du colis entier */
function AddPacking({ open, setOpen, onAdd }: { open: boolean; setOpen: (b: boolean) => void; onAdd: (v: PackVariant) => void }) {
  const [f, setF] = useState({ qty: '1', type: 'Carton', unit: 'mm', l: '', w: '', h: '', gross: '', net: '' });
  const [err, setErr] = useState('');
  if (!open)
    return (
      <button className="btn ghost small" onClick={() => setOpen(true)}>
        + Ajouter un emballage (fiche article SAP)
      </button>
    );
  const field = (k: keyof typeof f, label: string) => (
    <label key={k}>
      <span>{label}</span>
      <input inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  const add = () => {
    const n = (k: keyof typeof f) => readUserNumber(f[k].trim());
    const [qty, l, w, h, gross, net] = [n('qty'), n('l'), n('w'), n('h'), n('gross'), n('net')];
    if (![qty, l, w, h, gross].every((x) => Number.isFinite(x) && x > 0)) return setErr('Renseignez la quantité, les 3 dimensions et le poids brut.');
    const netOk = Number.isFinite(net) && net > 0 ? net : gross;
    if (netOk > gross) return setErr('Le poids net doit être ≤ au brut.');
    const k = f.unit === 'mm' ? 0.1 : 1;
    const [L, W, H] = [l, w, h].map((x) => Math.round(x * k * 10) / 10);
    if ([L, W, H].some((x) => x > 1500)) return setErr('Dimension trop grande : vérifiez l’unité (mm ou cm).');
    onAdd({
      qtyPerPackage: qty,
      packageType: f.type,
      length: Math.max(L, W),
      width: Math.min(L, W),
      height: H,
      volumePerPackage: Math.round(((L * W * H) / 1e6) * 10000) / 10000,
      netWeightPerUnit: Math.round((netOk / qty) * 10000) / 10000,
      grossWeightPerUnit: Math.round((gross / qty) * 10000) / 10000,
      mixed: false,
      source: SAP_SOURCE,
      count: 10,
    });
    setF({ ...f, qty: '', l: '', w: '', h: '', gross: '', net: '' });
    setErr('');
  };
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 className="card-title">Emballage de la fiche article (SAP)</h3>
      <p className="hint">
        Une ligne de « Unités de mesure » à la fois (ex. PC = 1 pièce, PAL = palette de 12). Poids du colis entier, tels qu'affichés.
        Après l'ajout, l'appli choisit l'emballage selon la quantité demandée.
      </p>
      <div className="form-grid">
        {field('qty', 'Quantité dans ce colis')}
        <label>
          <span>Emballage</span>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {field('l', 'Longueur')}
        {field('w', 'Largeur')}
        {field('h', 'Hauteur')}
        <label>
          <span>Unité des dimensions</span>
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            <option value="mm">mm</option>
            <option value="cm">cm</option>
          </select>
        </label>
        {field('gross', 'Poids brut du colis (kg)')}
        {field('net', 'Poids net du colis (kg)')}
      </div>
      {err && <div className="form-error">{err}</div>}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn primary small" onClick={add}>
          Ajouter
        </button>
        <button className="btn ghost small" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </div>
    </div>
  );
}
