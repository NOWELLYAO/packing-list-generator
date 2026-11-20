import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { PackingList, Settings } from '../types';
import { AccessError, createShareLink } from '../lib/access';

interface Props {
  pl: PackingList;
  settings: Settings;
  space: string;
  onClose: () => void;
}

/** Lien de suivi pour le client : PL, plan de chargement 3D et PDF, en lecture seule */
export default function ShareLinkDialog({ pl, settings, space, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  // un seul lien par ouverture de la fenêtre
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const logo = settings.logo && settings.logo.length < 350_000 ? settings.logo : '';
    createShareLink(space, {
      v: 1,
      createdAt: new Date().toISOString(),
      pl,
      company: settings.companyName,
      logo,
      accent: settings.accent,
      lang: settings.lang ?? 'fr',
      transportMode: settings.transportMode ?? 'sea',
    })
      .then(async (u) => {
        setUrl(u);
        setQr(await QRCode.toDataURL(u, { margin: 1, width: 220 }));
      })
      .catch((e) =>
        setErr(
          e instanceof AccessError && e.code === 'offline'
            ? 'Pas de connexion au serveur : réessayez.'
            : e instanceof AccessError && e.code === 'forbidden'
              ? 'Votre compte n’a pas le droit d’exporter.'
              : e instanceof AccessError && e.code === 'too_large'
                ? 'Packing List trop volumineuse pour un lien.'
                : 'Le lien n’a pas pu être créé.',
        ),
      );
  }, [pl, settings, space]);
  const text = `Packing List ${pl.reference || ''} : ${url}`.trim();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-link" role="dialog" aria-modal aria-labelledby="share-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h3 id="share-title">Lien pour le client</h3>
            <span className="hint">Votre client voit la PL, le plan de chargement en 3D et télécharge le PDF, sans compte. Lien valable 90 jours.</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="modal-body share-body">
          {err ? (
            <div className="form-error">{err}</div>
          ) : !url ? (
            <p className="hint">Création du lien…</p>
          ) : (
            <>
              {qr && <img src={qr} alt="QR code du lien" className="share-qr" />}
              <input className="share-url" readOnly value={url} onFocus={(e) => e.target.select()} />
              <div className="row wrap">
                <button
                  className="btn primary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      setCopied(true);
                    } catch {
                      /* sélection manuelle */
                    }
                  }}
                >
                  {copied ? 'Lien copié ✓' : 'Copier le lien'}
                </button>
                <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
                <a className="btn" href={`mailto:?subject=${encodeURIComponent(`Packing List ${pl.reference || ''}`.trim())}&body=${encodeURIComponent(text)}`}>
                  E-mail
                </a>
                <a className="btn ghost" href={url} target="_blank" rel="noreferrer">
                  Aperçu
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
