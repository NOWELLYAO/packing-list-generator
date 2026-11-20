import { useState } from 'react';
import type { useCloudSync } from '../lib/useCloudSync';
import { isValidCode, normalizeCode } from '../lib/cloud';
import { asInvite, AccessError, orgKnownLocked, redeemInvite } from '../lib/access';
import { useSafety } from '../lib/safety';
import InfoTip from './InfoTip';

type Cloud = ReturnType<typeof useCloudSync>;

const STATUS: Record<string, { label: string; tone: string }> = {
  off: { label: 'Désactivée', tone: 'muted' },
  syncing: { label: 'Synchronisation…', tone: 'mid' },
  synced: { label: 'À jour', tone: 'good' },
  offline: { label: 'Hors ligne : envoi au retour du réseau', tone: 'mid' },
  not_configured: { label: 'Stockage en ligne pas encore activé sur le serveur', tone: 'low' },
  error: { label: 'Erreur', tone: 'low' },
  locked: { label: 'Connexion requise', tone: 'mid' },
  org_locked: { label: "Cet espace n'est pas celui de l'entreprise : rejoignez-le avec une invitation", tone: 'low' },
};

/** Réglages → Sauvegarde en ligne */
export default function CloudPanel({ cloud, toast }: { cloud: Cloud; toast: (m: string) => void }) {
  const { ask } = useSafety();
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [versions, setVersions] = useState<Awaited<ReturnType<Cloud['versions']>> | null>(null);
  const st = STATUS[cloud.status] ?? STATUS.off;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cloud.cloud!.code);
      toast('Code copié');
    } catch {
      toast('Copie impossible : recopiez le code à la main');
    }
  };

  return (
    <div className="card cloud-card">
      <h3 className="card-title">
        Sauvegarde en ligne <InfoTip k="cloud" />
      </h3>
      <p className="hint">
        Votre base, l'historique et les mesures de précision sont copiés sur le serveur. Si le navigateur efface ses données (iPhone après 7 jours
        sans visite, autre adresse, autre navigateur), tout revient automatiquement. Le même code sur un autre appareil — ou chez un collègue — donne
        la même base.
      </p>

      <div className={`cloud-status ${st.tone}`} role="status">
        <span className="dot" aria-hidden /> {st.label}
        {cloud.lastAt && cloud.status === 'synced' && <span className="hint"> · {new Date(cloud.lastAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>

      {cloud.status === 'not_configured' && (
        <div className="banner warn">
          Le stockage en ligne doit être activé une fois dans Vercel : projet → <b>Storage</b> → <b>Create Database</b> → <b>Upstash for Redis</b>{' '}
          (gratuit) → <b>Connect</b> au projet, puis <b>Redeploy</b>. Votre code est déjà prêt : la sauvegarde démarrera toute seule ensuite.
        </div>
      )}
      {cloud.status === 'error' && cloud.detail && <p className="hint">Détail : {cloud.detail}</p>}

      {!cloud.cloud ? (
        joining ? (
          <div className="cloud-join">
            <label>
              <span>Code d'invitation (6 caractères) ou code de l'espace</span>
              <input
                value={code}
                placeholder="ABC-DEF ou PL-XXXX-XXXX-XXXX-XXXX"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <div className="row wrap">
              <button
                className="btn primary"
                disabled={!isValidCode(normalizeCode(code)) && !asInvite(code)}
                onClick={async () => {
                  let space = normalizeCode(code);
                  if (!isValidCode(space)) {
                    try {
                      space = await redeemInvite(asInvite(code)!);
                    } catch (e) {
                      toast(e instanceof AccessError && e.code === 'offline' ? 'Pas de connexion internet' : 'Invitation inconnue ou expirée (24 h) : demandez-en une nouvelle');
                      return;
                    }
                  }
                  await cloud.join(space);
                  setJoining(false);
                  toast('Espace rejoint');
                }}
              >
                Rejoindre
              </button>
              <button className="btn ghost" onClick={() => setJoining(false)}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div className="row wrap">
            {!orgKnownLocked() && (
            <button
              className="btn primary"
              onClick={async () => {
                await cloud.enable();
                toast('Sauvegarde en ligne activée : notez votre code');
              }}
            >
              Activer la sauvegarde en ligne
            </button>
            )}
            <button className="btn" onClick={() => setJoining(true)}>
              J'ai déjà un code
            </button>
          </div>
        )
      ) : (
        <>
          <div className="cloud-code">
            <small>Code de votre espace — notez-le précieusement</small>
            <div className="row wrap">
              <b className="mono">{cloud.cloud.code}</b>
              <button className="btn small" onClick={() => void copy()}>
                Copier
              </button>
            </div>
            <p className="hint">
              Sur un autre appareil : Réglages → Sauvegarde en ligne → « J'ai déjà un code ». Ne le communiquez qu'aux personnes qui doivent partager
              cette base.
            </p>
          </div>
          <div className="row wrap">
            <button className="btn" onClick={() => void cloud.syncNow()}>
              Synchroniser maintenant
            </button>
            <button
              className="btn"
              onClick={async () => {
                try {
                  setVersions(await cloud.versions());
                } catch {
                  toast('Versions indisponibles pour le moment');
                }
              }}
            >
              Versions précédentes
            </button>
            <button
              className="btn ghost danger"
              onClick={async () => {
                const ok = await ask({
                  title: 'Déconnecter cet appareil ?',
                  message: "La base reste sur cet appareil et en ligne, mais cet appareil ne sera plus sauvegardé. Gardez le code pour vous reconnecter.",
                  confirmLabel: 'Déconnecter',
                });
                if (ok) cloud.disconnect();
              }}
            >
              Déconnecter cet appareil
            </button>
          </div>
          {versions && (
            <div className="cloud-versions">
              {versions.length === 0 ? (
                <p className="hint">Aucune version précédente pour l'instant (une version est gardée à chaque enregistrement, jusqu'à 10).</p>
              ) : (
                versions.map((v) => (
                  <div key={v.index} className="cloud-version">
                    <span>
                      <b>{new Date(v.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</b> · {v.articles} articles
                      {v.device && <span className="hint"> · {v.device}</span>}
                    </span>
                    <button
                      className="btn small"
                      onClick={async () => {
                        const ok = await ask({
                          title: 'Restaurer cette version ?',
                          message: `La base sera remplacée par celle du ${new Date(v.updatedAt).toLocaleString('fr-FR')} (${v.articles} articles), sur cet appareil et en ligne. La version actuelle reste dans la liste.`,
                          confirmLabel: 'Restaurer',
                        });
                        if (ok) {
                          await cloud.restoreVersion(v.index);
                          setVersions(null);
                        }
                      }}
                    >
                      Restaurer
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
