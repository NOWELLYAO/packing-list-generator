import { useRef } from 'react';
import type { Settings } from '../types';
import { DEFAULT_ACCENT } from '../lib/exporters';

interface Props {
  settings: Settings;
  setSettings: (s: Settings) => void;
  toast: (msg: string) => void;
}

const PRESETS = ['#0B4F8A', '#1E3A5F', '#0F766E', '#7C3AED', '#B45309', '#BE123C', '#111827'];

/** Réduit le logo (max 600 px) pour qu'il reste léger dans le navigateur et les documents */
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('lecture impossible'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image illisible'));
      img.onload = () => {
        const k = Math.min(1, 600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function SettingsPanel({ settings, setSettings, toast }: Props) {
  const logoRef = useRef<HTMLInputElement>(null);
  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h2>Réglages</h2>
          <p className="hint">Mise en forme des PDF et fichiers Excel générés.</p>
        </div>
      </div>

      <div className="card">
        <h4>Logo</h4>
        <p className="hint">PNG ou JPEG. Utilisez le logo officiel fourni par votre société. Il apparaît sur le PDF et l'Excel.</p>
        <div className="logo-zone">
          {settings.logo ? (
            <img src={settings.logo} alt="Logo" />
          ) : (
            <div className="logo-placeholder">Aucun logo</div>
          )}
          <div className="row wrap">
            <button className="btn" onClick={() => logoRef.current?.click()}>
              {settings.logo ? 'Changer' : 'Choisir une image'}
            </button>
            {settings.logo && (
              <button className="btn ghost danger" onClick={() => setSettings({ ...settings, logo: '' })}>
                Retirer
              </button>
            )}
          </div>
          <input
            ref={logoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                setSettings({ ...settings, logo: await resizeImage(f) });
                toast('Logo enregistré');
              } catch (err) {
                toast(`Logo : ${(err as Error).message}`);
              }
            }}
          />
        </div>
      </div>

      <div className="card">
        <h4>Nom affiché (facultatif)</h4>
        <input
          value={settings.companyName}
          placeholder="Ex. : nom de votre société"
          onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
        />
      </div>

      <div className="card">
        <h4>Langue des documents</h4>
        <p className="hint">
          PDF, Excel et libellés d'emballage (PALPLATE → Palette à plateau / Pallet with top plate). Les désignations des
          articles restent celles du fournisseur.
        </p>
        <div className="segmented">
          {(
            [
              ['fr', 'Français'],
              ['en', 'English'],
            ] as const
          ).map(([l, label]) => (
            <button key={l} className={(settings.lang ?? 'fr') === l ? 'on' : ''} onClick={() => setSettings({ ...settings, lang: l })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h4>Couleur des documents</h4>
        <div className="swatches">
          {PRESETS.map((c) => (
            <button
              key={c}
              className={`swatch ${settings.accent.toLowerCase() === c.toLowerCase() ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => setSettings({ ...settings, accent: c })}
              aria-label={c}
            />
          ))}
          <label className="swatch custom" title="Couleur personnalisée">
            <input type="color" value={settings.accent || DEFAULT_ACCENT} onChange={(e) => setSettings({ ...settings, accent: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="card">
        <h4>Où sont mes données ?</h4>
        <p className="hint">
          Base d'articles, historique et réglages sont enregistrés dans ce navigateur, sur cet appareil. Pour les retrouver
          sur un autre appareil, sauvegardez la base (Articles → Plus… → Sauvegarder) puis chargez-la là-bas.
        </p>
      </div>
    </div>
  );
}
