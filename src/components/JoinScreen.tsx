import { useState } from 'react';
import { AccessError, asInvite, redeemInvite } from '../lib/access';
import { isValidCode, normalizeCode } from '../lib/cloud';

/** Application réservée à l'entreprise : un appareil hors de son espace doit d'abord le rejoindre (invitation) */
export default function JoinScreen({ logo, onJoin, wrongSpace }: { logo?: string; onJoin: (space: string) => Promise<void>; wrongSpace?: boolean }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      let space = normalizeCode(code);
      if (!isValidCode(space)) {
        const inv = asInvite(code);
        if (!inv) throw new AccessError('bad_invite');
        space = await redeemInvite(inv);
      }
      await onJoin(space);
    } catch (e) {
      const c = e instanceof AccessError ? e.code : '';
      setErr(c === 'offline' ? 'Pas de connexion internet.' : c === 'bad_invite' ? 'Saisissez le code d’invitation (6 caractères, ex. K7M-2QP).' : 'Invitation inconnue ou expirée (valable 24 h) : demandez-en une nouvelle à l’administrateur.');
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
          void go();
        }}
      >
        {logo ? <img src={logo} alt="" className="login-logo" /> : <span className="brand-mark">PL</span>}
        <h1>Packing List</h1>
        <p className="hint">
          {wrongSpace
            ? 'Cet appareil est relié à un autre espace que celui de l’entreprise. '
            : ''}
          Application réservée à votre entreprise. Saisissez le code d'invitation donné par l'administrateur (ou ouvrez le lien qu'il vous a envoyé).
        </p>
        <label>
          <span>Code d'invitation</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABC-DEF" autoCapitalize="characters" autoComplete="off" spellCheck={false} autoFocus />
        </label>
        <button className="btn primary" disabled={busy || (!asInvite(code) && !isValidCode(normalizeCode(code)))} type="submit">
          {busy ? 'Connexion…' : 'Rejoindre'}
        </button>
        {err && (
          <div className="form-error" role="alert">
            {err}
          </div>
        )}
      </form>
    </div>
  );
}
