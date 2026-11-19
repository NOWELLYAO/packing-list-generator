import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Contrôle d'accès de l'application (lié à l'espace de sauvegarde en ligne).
 * Les droits sont vérifiés par le serveur (jeton signé) ; l'interface masque ce qui n'est pas permis.
 */

export type Perm = 'generate' | 'export' | 'history' | 'catalogView' | 'catalogEdit' | 'import' | 'settings' | 'users';
export type Role = 'admin' | 'user' | 'viewer';
export const ALL_PERMS: Perm[] = ['generate', 'export', 'history', 'catalogView', 'catalogEdit', 'import', 'settings', 'users'];

export const PERM_LABEL: Record<Perm, string> = {
  generate: 'Créer des packing lists',
  export: 'Exporter PDF, Excel et étiquettes',
  history: "Voir l'historique",
  catalogView: 'Consulter la base d’articles',
  catalogEdit: 'Modifier la base (ajout, correction, suppression)',
  import: 'Importer des PL et fiches SAP',
  settings: 'Réglages (logo, couleurs, sauvegarde)',
  users: 'Gérer les accès (administrateur)',
};

/** profils pré-configurés */
export const PRESETS: { id: string; label: string; role: Role; perms: Perm[]; hint: string }[] = [
  { id: 'admin', label: 'Administrateur', role: 'admin', perms: ALL_PERMS, hint: 'Tout, y compris les accès' },
  { id: 'manager', label: 'Responsable base', role: 'user', perms: ['generate', 'export', 'history', 'catalogView', 'catalogEdit', 'import'], hint: 'PL + tenue de la base et imports' },
  { id: 'prep', label: 'Préparateur', role: 'user', perms: ['generate', 'export', 'history', 'catalogView'], hint: 'Crée et exporte des PL, consulte la base' },
  { id: 'viewer', label: 'Consultation', role: 'viewer', perms: ['history', 'catalogView'], hint: 'Lecture seule' },
];
export const presetOf = (role: Role, perms: Perm[]) =>
  PRESETS.find((p) => p.role === role && p.perms.length === perms.length && p.perms.every((x) => perms.includes(x)))?.label ?? 'Personnalisé';

export interface AccessUser {
  id: string;
  name: string;
  role: Role;
  perms: Perm[];
  disabled?: boolean;
}
export interface SessionInfo {
  code: string;
  token: string;
  user: AccessUser;
  exp: number;
}

const SESSION_KEY = 'plgen:session';
const ON_KEY = 'plgen:authOn';
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* stockage indisponible */
    }
  },
};

export function loadSession(code?: string): SessionInfo | null {
  try {
    const s = JSON.parse(ls.get(SESSION_KEY) ?? 'null') as SessionInfo | null;
    if (!s || s.exp < Date.now() || (code && s.code !== code)) return null;
    return s;
  } catch {
    return null;
  }
}
export const saveSession = (s: SessionInfo | null) => ls.set(SESSION_KEY, s ? JSON.stringify(s) : null);
/** jeton à joindre aux appels de sauvegarde pour cet espace */
export const tokenFor = (code: string) => loadSession(code)?.token;
export const authKnownOn = (code: string) => ls.get(ON_KEY) === code;
export const setAuthKnown = (code: string | null) => ls.set(ON_KEY, code);
export const LOCK_EVENT = 'plgen:locked';

export class AccessError extends Error {
  code: string;
  left?: number;
  constructor(code: string, left?: number) {
    super(code);
    this.code = code;
    this.left = left;
  }
}

async function post<T>(space: string, body: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    const tok = tokenFor(space);
    r = await fetch('/api/base', {
      method: 'POST',
      headers: { 'x-plgen-space': space, 'Content-Type': 'application/json', ...(tok ? { 'x-plgen-token': tok } : {}) },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new AccessError('offline');
  }
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new AccessError(String(data.error ?? r.status), data.left as number | undefined);
  return data as T;
}

export const authStatus = (space: string) => post<{ enabled: boolean; users: { id: string; name: string }[] }>(space, { action: 'status' });
export async function login(space: string, body: { action: 'login'; userId: string; pin: string } | { action: 'setup'; name: string; pin: string }) {
  const r = await post<{ token: string; user: AccessUser }>(space, body);
  const s: SessionInfo = { code: space, token: r.token, user: r.user, exp: Date.now() + 12 * 3600 * 1000 - 60000 };
  saveSession(s);
  setAuthKnown(space);
  return s;
}
export const listUsers = (space: string) => post<{ users: AccessUser[] }>(space, { action: 'users' }).then((r) => r.users);
export const saveUser = (space: string, user: Partial<AccessUser> & { pin?: string }) => post<{ users: AccessUser[] }>(space, { action: 'saveUser', user }).then((r) => r.users);
export const deleteUser = (space: string, id: string) => post<{ users: AccessUser[] }>(space, { action: 'deleteUser', id }).then((r) => r.users);
export async function disableAccess(space: string) {
  await post(space, { action: 'disable' });
  setAuthKnown(null);
  saveSession(null);
}

export interface Access {
  /** protection active sur l'espace de cet appareil */
  enabled: boolean;
  /** état encore inconnu (vérification en cours) */
  checking: boolean;
  session: SessionInfo | null;
  can: (p: Perm) => boolean;
  refresh: () => Promise<void>;
  setSession: (s: SessionInfo | null) => void;
  logout: () => void;
}

export function useAccess(space: string | undefined): Access {
  const [enabled, setEnabled] = useState(() => !!space && authKnownOn(space));
  const [checking, setChecking] = useState(!!space);
  const [session, setSessionState] = useState<SessionInfo | null>(() => loadSession(space));
  const refresh = useCallback(async () => {
    if (!space) {
      setEnabled(false);
      setChecking(false);
      return;
    }
    try {
      const st = await authStatus(space);
      setEnabled(st.enabled);
      setAuthKnown(st.enabled ? space : null);
    } catch {
      /* hors ligne : on garde l'état connu */
    } finally {
      setChecking(false);
    }
  }, [space]);
  useEffect(() => {
    setSessionState(loadSession(space));
    setEnabled(!!space && authKnownOn(space));
    void refresh();
  }, [space, refresh]);
  // jeton refusé par le serveur (expiré, compte désactivé) → retour à l'écran de connexion
  useEffect(() => {
    const onLock = () => {
      saveSession(null);
      setSessionState(null);
      void refresh();
    };
    window.addEventListener(LOCK_EVENT, onLock);
    return () => window.removeEventListener(LOCK_EVENT, onLock);
  }, [refresh]);
  // fin de session (12 h)
  useEffect(() => {
    if (!session) return;
    const t = window.setTimeout(() => setSessionState(null), Math.max(0, session.exp - Date.now()));
    return () => window.clearTimeout(t);
  }, [session]);
  const can = useCallback((p: Perm) => !enabled || !!session?.user.perms.includes(p), [enabled, session]);
  return {
    enabled,
    checking,
    session,
    can,
    refresh,
    setSession: (s) => {
      saveSession(s);
      setSessionState(s);
      if (s) setEnabled(true);
    },
    logout: () => {
      saveSession(null);
      setSessionState(null);
    },
  };
}

export const AccessContext = createContext<Access>({
  enabled: false,
  checking: false,
  session: null,
  can: () => true,
  refresh: async () => {},
  setSession: () => {},
  logout: () => {},
});
export const useCan = () => useContext(AccessContext).can;
