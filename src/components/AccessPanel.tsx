import { useEffect, useState } from 'react';
import {
  AccessContext,
  AccessError,
  ALL_PERMS,
  deleteUser,
  disableAccess,
  listUsers,
  login,
  PERM_LABEL,
  PRESETS,
  presetOf,
  saveUser,
  type AccessUser,
  type Perm,
  type Role,
} from '../lib/access';
import { useContext } from 'react';
import { useSafety } from '../lib/safety';
import { createInvite, orgKnownLocked, setOrgLock } from '../lib/access';
import QRCode from 'qrcode';

const errText = (e: unknown) => {
  const c = e instanceof AccessError ? e.code : '';
  return c === 'bad_pin' ? 'Code invalide : 4 à 8 chiffres.' : c === 'last_admin' ? 'Il faut garder au moins un administrateur actif.' : c === 'offline' ? 'Pas de connexion internet.' : c === 'forbidden' ? 'Réservé à l’administrateur.' : 'Opération impossible, réessayez.';
};

/** Réglages → Accès : protection par code, utilisateurs et droits (profils pré-configurés) */
export default function AccessPanel({ space, toast }: { space?: string; toast: (m: string) => void }) {
  const access = useContext(AccessContext);
  const { ask } = useSafety();
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [edit, setEdit] = useState<(Partial<AccessUser> & { pin?: string }) | null>(null);
  const [setup, setSetup] = useState({ name: '', pin: '', pin2: '' });
  const [err, setErr] = useState('');
  const isAdmin = !!access.session?.user.perms.includes('users');
  const [invite, setInvite] = useState<{ code: string; link: string; qr: string } | null>(null);
  const [orgLocked, setOrgLockedState] = useState(orgKnownLocked);
  const makeInvite = async () => {
    try {
      const code = await createInvite(space!);
      const link = `${window.location.origin}/#invite=${code}`;
      const qr = await QRCode.toDataURL(link, { margin: 1, width: 220 });
      setInvite({ code: `${code.slice(0, 3)}-${code.slice(3)}`, link, qr });
    } catch (e) {
      setErr(errText(e));
    }
  };

  useEffect(() => {
    if (space && access.enabled && isAdmin) listUsers(space).then(setUsers).catch((e) => setErr(errText(e)));
  }, [space, access.enabled, isAdmin]);

  if (!space)
    return (
      <div className="card">
        <h3 className="card-title">Accès et utilisateurs</h3>
        <p className="hint">Activez d'abord la sauvegarde en ligne ci-dessus : les accès sont partagés par tous les appareils de l'espace.</p>
      </div>
    );

  if (!access.enabled)
    return (
      <div className="card">
        <h3 className="card-title">Accès et utilisateurs</h3>
        <p className="hint">
          Protégez l'application par un code : chaque personne a son nom et son code, et des droits selon son profil (administrateur, responsable
          base, préparateur, consultation). Vous devenez l'administrateur.
        </p>
        <div className="form-grid">
          <label>
            <span>Votre nom</span>
            <input value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} />
          </label>
          <label>
            <span>Votre code (4 à 8 chiffres)</span>
            <input type="password" inputMode="numeric" value={setup.pin} onChange={(e) => setSetup({ ...setup, pin: e.target.value.replace(/\D/g, '') })} maxLength={8} />
          </label>
          <label>
            <span>Confirmez le code</span>
            <input type="password" inputMode="numeric" value={setup.pin2} onChange={(e) => setSetup({ ...setup, pin2: e.target.value.replace(/\D/g, '') })} maxLength={8} />
          </label>
        </div>
        {err && <div className="form-error">{err}</div>}
        <button
          className="btn primary"
          onClick={async () => {
            if (!setup.name.trim()) return setErr('Indiquez votre nom.');
            if (!/^\d{4,8}$/.test(setup.pin)) return setErr('Code : 4 à 8 chiffres.');
            if (setup.pin !== setup.pin2) return setErr('Les deux codes ne correspondent pas.');
            try {
              const s = await login(space, { action: 'setup', name: setup.name.trim(), pin: setup.pin });
              access.setSession(s);
              setErr('');
              toast('Protection activée : vous êtes administrateur');
            } catch (e) {
              setErr(errText(e));
            }
          }}
        >
          Activer la protection par code
        </button>
      </div>
    );

  return (
    <div className="card">
      <h3 className="card-title">Accès et utilisateurs</h3>
      {access.session && (
        <div className="row wrap access-me">
          <span>
            Connecté : <b>{access.session.user.name}</b> · {presetOf(access.session.user.role, access.session.user.perms)}
          </span>
          <button className="btn small" onClick={() => access.logout()}>
            Se déconnecter
          </button>
        </div>
      )}
      {!isAdmin && <p className="hint">Les comptes et les droits sont gérés par l'administrateur.</p>}
      {isAdmin && (
        <>
          <ul className="user-list">
            {(users ?? []).map((u) => (
              <li key={u.id} className={u.disabled ? 'off' : ''}>
                <span>
                  <b>{u.name}</b> · {presetOf(u.role, u.perms)}
                  {u.disabled ? ' · désactivé' : ''}
                </span>
                <button className="btn small ghost" onClick={() => setEdit({ ...u })}>
                  Modifier
                </button>
              </li>
            ))}
          </ul>
          <button className="btn" onClick={() => setEdit({ name: '', role: 'user', perms: PRESETS[2].perms })}>
            + Ajouter un utilisateur
          </button>
          {edit && (
            <div className="card access-edit">
              <div className="form-grid">
                <label>
                  <span>Nom</span>
                  <input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                </label>
                <label>
                  <span>Profil</span>
                  <select
                    value={PRESETS.find((p) => p.label === presetOf((edit.role ?? 'user') as Role, (edit.perms ?? []) as Perm[]))?.id ?? 'custom'}
                    onChange={(e) => {
                      const p = PRESETS.find((x) => x.id === e.target.value);
                      if (p) setEdit({ ...edit, role: p.role, perms: p.perms });
                    }}
                  >
                    {PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    <option value="custom" disabled>
                      Personnalisé
                    </option>
                  </select>
                  <small className="hint">{PRESETS.find((p) => p.label === presetOf((edit.role ?? 'user') as Role, (edit.perms ?? []) as Perm[]))?.hint ?? 'Droits choisis un par un ci-dessous'}</small>
                </label>
                <label>
                  <span>{edit.id ? 'Nouveau code (laisser vide pour garder)' : 'Code (4 à 8 chiffres)'}</span>
                  <input type="password" inputMode="numeric" maxLength={8} value={edit.pin ?? ''} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '') })} />
                </label>
              </div>
              {edit.role !== 'admin' && (
                <div className="perm-list">
                  {ALL_PERMS.filter((p) => p !== 'users').map((p) => (
                    <label key={p} className="check">
                      <input
                        type="checkbox"
                        checked={!!edit.perms?.includes(p)}
                        onChange={(e) => {
                          const perms = e.target.checked ? [...(edit.perms ?? []), p] : (edit.perms ?? []).filter((x) => x !== p);
                          setEdit({ ...edit, perms, role: perms.length <= 2 && !perms.includes('generate') ? 'viewer' : 'user' });
                        }}
                      />
                      {PERM_LABEL[p]}
                    </label>
                  ))}
                </div>
              )}
              {edit.id && (
                <label className="check">
                  <input type="checkbox" checked={!!edit.disabled} onChange={(e) => setEdit({ ...edit, disabled: e.target.checked })} />
                  Compte désactivé (ne peut plus se connecter)
                </label>
              )}
              {err && <div className="form-error">{err}</div>}
              <div className="row wrap">
                <button
                  className="btn primary"
                  onClick={async () => {
                    try {
                      setUsers(await saveUser(space, edit));
                      setEdit(null);
                      setErr('');
                      toast('Utilisateur enregistré');
                    } catch (e) {
                      setErr(errText(e));
                    }
                  }}
                >
                  Enregistrer
                </button>
                <button className="btn ghost" onClick={() => (setEdit(null), setErr(''))}>
                  Annuler
                </button>
                {edit.id && edit.id !== access.session?.user.id && (
                  <button
                    className="btn ghost danger"
                    onClick={async () => {
                      if (!(await ask({ title: `Supprimer ${edit.name} ?`, message: 'Cette personne ne pourra plus se connecter.', confirmLabel: 'Supprimer' }))) return;
                      try {
                        setUsers(await deleteUser(space, edit.id!));
                        setEdit(null);
                      } catch (e) {
                        setErr(errText(e));
                      }
                    }}
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="invite-box">
            <h4>Ajouter un appareil</h4>
            <p className="hint">Un code court, valable 24 h, au lieu du long code de l'espace. Sur le nouvel appareil : ouvrir le lien, scanner le QR code, ou saisir le code.</p>
            {!invite ? (
              <button className="btn" onClick={() => void makeInvite()}>
                Créer une invitation
              </button>
            ) : (
              <div className="invite">
                <img src={invite.qr} alt="QR code d'invitation" width={150} height={150} />
                <div>
                  <div className="invite-code mono">{invite.code}</div>
                  <small className="hint">valable 24 h</small>
                  <div className="row wrap">
                    <button
                      className="btn small primary"
                      onClick={async () => {
                        const text = `Packing List : ouvrez ce lien pour rejoindre l'espace de l'entreprise ${invite.link} (ou saisissez le code ${invite.code})`;
                        try {
                          if (navigator.share) await navigator.share({ title: 'Invitation Packing List', text });
                          else {
                            await navigator.clipboard.writeText(text);
                            toast('Invitation copiée');
                          }
                        } catch {
                          /* partage annulé */
                        }
                      }}
                    >
                      Partager le lien
                    </button>
                    <button className="btn small ghost" onClick={() => void makeInvite()}>
                      Nouveau code
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <label className="check org-lock">
            <input
              type="checkbox"
              checked={orgLocked}
              onChange={async (e) => {
                const want = e.target.checked;
                if (want && !(await ask({ title: 'Réserver l’application à cet espace ?', message: "Plus personne ne pourra créer un autre espace ni utiliser l'application en dehors de celui-ci : chaque nouvel appareil devra être invité.", confirmLabel: 'Réserver' })))
                  return;
                try {
                  setOrgLockedState(await setOrgLock(space, want));
                  toast(want ? 'Application réservée à cet espace' : 'Réservation levée');
                } catch (er) {
                  setErr(errText(er));
                }
              }}
            />
            <span>
              <b>Réserver l'application à cet espace</b>
              <br />
              <small className="hint">Personne ne peut créer son propre espace (et s'y déclarer administrateur) : tout nouvel appareil doit être invité.</small>
            </span>
          </label>
          <button
            className="btn ghost danger small"
            onClick={async () => {
              if (!(await ask({ title: 'Désactiver la protection ?', message: "Tout le monde aura à nouveau accès à tout, sans code. Les comptes seront supprimés.", confirmLabel: 'Désactiver' })))
                return;
              try {
                await disableAccess(space);
                access.logout();
                await access.refresh();
                toast('Protection désactivée');
              } catch (e) {
                setErr(errText(e));
              }
            }}
          >
            Désactiver la protection par code
          </button>
        </>
      )}
    </div>
  );
}
