import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Contrôle d'accès de l'application (lié à l'espace de sauvegarde en ligne).
 * Les droits sont vérifiés par le serveur (jeton signé) ; l'interface masque ce qui n'est pas permis.
 */

export type Perm =
  | 'generate'
  | 'orderImport'
  | 'freight'
  | 'freightRates'
  | 'export'
  | 'labels'
  | 'exportDocs'
  | 'shareLink'
  | 'history'
  | 'dashboard'
  | 'catalogView'
  | 'catalogExport'
  | 'catalogBackup'
  | 'catalogLoad'
  | 'catalogRestore'
  | 'catalogClear'
  | 'catalogEdit'
  | 'import'
  | 'settings'
  | 'users';
export type Role = 'admin' | 'user' | 'viewer';
export const ALL_PERMS: Perm[] = [
  'generate', 'orderImport', 'freight', 'freightRates',
  'export', 'labels', 'exportDocs', 'shareLink',
  'history', 'dashboard',
  'catalogView', 'catalogExport', 'catalogBackup', 'catalogEdit', 'catalogLoad', 'catalogRestore', 'catalogClear', 'import',
  'settings', 'users',
];
/** droits regroupés par thème (écran de l'administrateur) */
export const PERM_GROUPS: { title: string; perms: Perm[] }[] = [
  { title: 'Packing lists', perms: ['generate', 'orderImport'] },
  { title: 'Transport et fret', perms: ['freight', 'freightRates'] },
  { title: 'Documents', perms: ['export', 'labels', 'shareLink'] },
  { title: 'Dossier export', perms: ['exportDocs'] },
  { title: 'Suivi', perms: ['history', 'dashboard'] },
  { title: 'Base d’articles', perms: ['catalogView', 'catalogEdit', 'import'] },
  { title: 'Sauvegardes de la base', perms: ['catalogExport', 'catalogBackup', 'catalogLoad', 'catalogRestore', 'catalogClear'] },
  { title: 'Application', perms: ['settings'] },
];
/** droit qui n'a de sens qu'avec un autre (ex. modifier les tarifs → voir le coût) */
export const PERM_NEEDS: Partial<Record<Perm, Perm>> = {
  orderImport: 'generate',
  freight: 'generate',
  freightRates: 'freight',
  labels: 'generate',
  exportDocs: 'generate',
  shareLink: 'generate',
  export: 'generate',
  catalogExport: 'catalogView',
  catalogBackup: 'catalogView',
  catalogLoad: 'catalogView',
  catalogRestore: 'catalogView',
  catalogClear: 'catalogView',
  catalogEdit: 'catalogView',
};
const LEGACY_GRANTS: Partial<Record<Perm, Perm[]>> = {
  generate: ['orderImport', 'freight'],
  export: ['labels', 'exportDocs', 'shareLink', 'catalogExport', 'catalogBackup'],
  catalogEdit: ['catalogLoad', 'catalogRestore', 'catalogClear'],
  history: ['dashboard'],
  settings: ['freightRates'],
};
/** session ouverte avant l'arrivée des droits détaillés : mêmes déductions que le serveur */
export function effectivePerms(u: { role: Role; perms: Perm[]; pv?: number }): Perm[] {
  if (u.role === 'admin') return ALL_PERMS;
  if (u.pv === 2) return u.perms;
  return [...new Set([...u.perms, ...u.perms.flatMap((p) => LEGACY_GRANTS[p] ?? [])])];
}

export const PERM_LABEL: Record<Perm, string> = {
  generate: 'Créer des packing lists',
  orderImport: 'Importer une commande client (PDF, Excel, photo)',
  freight: 'Voir le coût estimé du transport',
  freightRates: 'Modifier les tarifs de fret',
  export: 'Exporter la PL en PDF et Excel, la partager',
  labels: 'Imprimer les étiquettes de colis',
  exportDocs: 'Créer le dossier export : facture proforma avec prix, récapitulatif douanier, déclaration d’origine',
  shareLink: 'Créer des liens de suivi pour les clients',
  dashboard: 'Voir le tableau de bord',
  catalogExport: 'Exporter la base en Excel',
  catalogBackup: 'Sauvegarder la base (fichier JSON)',
  catalogLoad: 'Charger une base JSON',
  catalogRestore: 'Restaurer une sauvegarde automatique',
  catalogClear: 'Vider la base',
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
  {
    id: 'manager',
    label: 'Responsable base',
    role: 'user',
    perms: ['generate', 'orderImport', 'freight', 'freightRates', 'export', 'labels', 'exportDocs', 'shareLink', 'history', 'dashboard', 'catalogView', 'catalogExport', 'catalogBackup', 'catalogEdit', 'catalogLoad', 'catalogRestore', 'import'],
    hint: 'Tout sauf les réglages et les accès',
  },
  {
    id: 'sales',
    label: 'Commercial',
    role: 'user',
    perms: ['generate', 'orderImport', 'freight', 'export', 'exportDocs', 'shareLink', 'history', 'dashboard', 'catalogView'],
    hint: 'PL depuis les commandes, coût du transport, dossier export, liens clients',
  },
  {
    id: 'prep',
    label: 'Préparateur',
    role: 'user',
    perms: ['generate', 'orderImport', 'export', 'labels', 'history', 'catalogView'],
    hint: 'Crée les PL, les exporte et imprime les étiquettes',
  },
  { id: 'store', label: 'Magasinier', role: 'user', perms: ['generate', 'labels', 'history', 'catalogView'], hint: 'Consulte les PL et imprime les étiquettes' },
  { id: 'viewer', label: 'Consultation', role: 'viewer', perms: ['history', 'dashboard', 'catalogView'], hint: 'Lecture seule' },
];
export const presetOf = (role: Role, perms: Perm[]) =>
  PRESETS.find((p) => p.role === role && p.perms.length === perms.length && p.perms.every((x) => perms.includes(x)))?.label ?? 'Personnalisé';

export interface AccessUser {
  id: string;
  name: string;
  role: Role;
  perms: Perm[];
  pv?: number;
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
    // nouvel espace (code d'invitation saisi) : protection inconnue tant que le serveur n'a pas répondu
    setChecking(!!space);
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
  const can = useCallback((p: Perm) => !enabled || (!!session && effectivePerms(session.user).includes(p)), [enabled, session]);
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

/* ---------- invitation courte et application réservée à l'entreprise ---------- */

export const ORG_EVENT = 'plgen:org-locked';
const ORG_KEY = 'plgen:orgLocked';
export const orgKnownLocked = () => ls.get(ORG_KEY) === '1';
export const setOrgKnown = (b: boolean) => ls.set(ORG_KEY, b ? '1' : null);

async function postNoSpace<T>(body: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    r = await fetch('/api/base', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new AccessError('offline');
  }
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new AccessError(String(data.error ?? r.status));
  return data as T;
}
export const orgStatus = () => postNoSpace<{ locked: boolean }>({ action: 'orgStatus' }).then((r) => (setOrgKnown(r.locked), r.locked));
/** code d'invitation (6 caractères, valable 24 h) → code complet de l'espace */
export const redeemInvite = (invite: string) => postNoSpace<{ space: string }>({ action: 'redeem', invite }).then((r) => r.space);
export const createInvite = (space: string) => post<{ invite: string }>(space, { action: 'invite' }).then((r) => r.invite);
export const setOrgLock = (space: string, lock: boolean) => post<{ locked: boolean }>(space, { action: lock ? 'orgLock' : 'orgUnlock' }).then((r) => (setOrgKnown(r.locked), r.locked));
/** « ABC-DEF » → « ABCDEF » si c'est bien un code d'invitation */
export const asInvite = (s: string) => {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 6 ? c : null;
};

/* ------------------------------------------------------------------ */
/* Lien de suivi client                                                */
/* ------------------------------------------------------------------ */
export interface SharedSnapshot {
  v: 1;
  createdAt: string;
  pl: import('../types').PackingList;
  company: string;
  logo: string;
  accent: string;
  lang: 'fr' | 'en';
  transportMode: 'sea' | 'road' | 'air';
}
/** publie un instantané de la PL (lecture seule) ; renvoie le lien à envoyer au client */
export async function createShareLink(space: string, snapshot: SharedSnapshot, days = 90): Promise<string> {
  const r = await post<{ id: string }>(space, { action: 'share', snapshot, days });
  return `${window.location.origin}/#s=${r.id}`;
}
export const fetchShared = (id: string) => postNoSpace<{ snapshot: SharedSnapshot }>({ action: 'shared', id }).then((r) => r.snapshot);
