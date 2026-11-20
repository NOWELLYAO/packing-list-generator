import { useEffect, useState } from 'react';
import { AccessError, authStatus, login, type SessionInfo } from '../lib/access';

/** Écran de connexion : choix du nom puis code d'accès (4 à 8 chiffres) */
export default function LoginScreen({ space, logo, onLogged }: { space: string; logo?: string; onLogged: (s: SessionInfo) => void }) {
  const [users, setUsers] = useState<{ id: string; name: string }[] | null>(null);
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authStatus(space)
      .then((s) => {
        setUsers(s.users);
        const last = localStorage.getItem('plgen:lastUser');
        setUserId(s.users.find((u) => u.id === last)?.id ?? s.users[0]?.id ?? '');
      })
      .catch((e) => setErr(e instanceof AccessError && e.code === 'offline' ? 'Pas de connexion internet : la connexion à l’application est impossible pour le moment.' : 'Service indisponible, réessayez.'));
  }, [space]);

  const submit = async () => {
    if (!userId || !/^\d{4,8}$/.test(pin)) return setErr('Saisissez votre code (4 à 8 chiffres).');
    setBusy(true);
    setErr('');
    try {
      const s = await login(space, { action: 'login', userId, pin });
      try {
        localStorage.setItem('plgen:lastUser', userId);
      } catch {
        /* */
      }
      onLogged(s);
    } catch (e) {
      const c = e instanceof AccessError ? e.code : '';
      setErr(
        c === 'locked'
          ? 'Trop d’essais : ce compte est bloqué 15 minutes.'
          : c === 'bad_pin'
            ? `Code incorrect${e instanceof AccessError && e.left !== undefined ? ` (${e.left} essai${e.left > 1 ? 's' : ''} restant${e.left > 1 ? 's' : ''})` : ''}.`
            : c === 'offline'
              ? 'Pas de connexion internet.'
              : 'Connexion impossible, réessayez.',
      );
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {logo ? <img src={logo} alt="" className="login-logo" /> : <img src="/favicon.svg" alt="" className="brand-mark-img" />}
        <h1>Packing List</h1>
        <p className="hint">Accès réservé. Choisissez votre nom et saisissez votre code.</p>
        {users === null && !err && <p className="hint">Chargement…</p>}
        {users && (
          <>
            <label>
              <span>Utilisateur</span>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username">
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Code d'accès</span>
              <input
                type="password"
                inputMode="numeric"
                pattern="\d*"
                autoComplete="current-password"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
            </label>
            <button className="btn primary" disabled={busy} type="submit">
              {busy ? 'Connexion…' : 'Se connecter'}
            </button>
          </>
        )}
        {err && (
          <div className="form-error" role="alert">
            {err}
          </div>
        )}
        <p className="hint small">Code oublié ? Demandez à l’administrateur de le réinitialiser.</p>
      </form>
    </div>
  );
}
