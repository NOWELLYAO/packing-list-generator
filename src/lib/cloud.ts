import { LOCK_EVENT, tokenFor } from './access';
import type { CatalogItem, HistoryEntry, Settings } from '../types';
import type { AccuracyRecord } from './realCheck';
import { itemKey } from './normalize';

/**
 * Sauvegarde en ligne : la base, l'historique et les mesures de précision sont copiés sur le serveur
 * dans un « espace » identifié par un code secret. Si le navigateur efface ses données (iPhone après
 * 7 jours sans visite, autre adresse, autre navigateur…), tout revient automatiquement.
 * Le même code sur un autre appareil (ou chez un collègue) donne la même base.
 */

export interface CloudDoc {
  updatedAt: number;
  catalog: CatalogItem[];
  history: HistoryEntry[];
  accuracy: AccuracyRecord[];
  settings?: Settings;
  device?: string;
}

export interface CloudState {
  code: string;
  /** date (ms) du document serveur connu lors de la dernière synchronisation réussie */
  lastSync: number;
}

const KEY = 'plgen:cloud';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I : se recopie sans erreur

export function loadCloud(): CloudState | null {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as CloudState) : null;
    return s && typeof s.code === 'string' && s.code ? s : null;
  } catch {
    return null;
  }
}
export function saveCloud(s: CloudState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** Code d'espace : PL-XXXX-XXXX-XXXX-XXXX (≈ 80 bits d'aléa) */
export function newSpaceCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `PL-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}
/** Normalise un code saisi à la main (espaces, minuscules, tirets oubliés) */
export function normalizeCode(input: string): string {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = c.startsWith('PL') ? c.slice(2) : c;
  if (body.length !== 16) return input.trim().toUpperCase();
  return `PL-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}
export const isValidCode = (c: string) => /^PL(-[A-Z0-9]{4}){4}$/.test(c);

export type CloudError = 'not_configured' | 'offline' | 'bad_code' | 'server' | 'login';
export class CloudFailure extends Error {
  kind: CloudError;
  constructor(kind: CloudError, msg?: string) {
    super(msg ?? kind);
    this.kind = kind;
  }
}

async function call(method: 'GET' | 'PUT', code: string, query = '', body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  let r: Response;
  try {
    r = await fetch(`/api/base${query}`, {
      method,
      headers: { 'x-plgen-space': code, ...(tokenFor(code) ? { 'x-plgen-token': tokenFor(code)! } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new CloudFailure('offline');
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await r.json()) as Record<string, unknown>;
  } catch {
    /* réponse vide */
  }
  if (r.status === 503) throw new CloudFailure('not_configured');
  if (r.status === 401) {
    // protection par code d'accès : session absente ou expirée
    window.dispatchEvent(new Event(LOCK_EVENT));
    throw new CloudFailure('login');
  }
  if (r.status === 403) throw new CloudFailure('server', 'droits insuffisants');
  if (r.status === 400) throw new CloudFailure('bad_code');
  if (r.status >= 500 || r.status === 405) throw new CloudFailure('server', String(data.detail ?? data.error ?? r.status));
  return { status: r.status, data };
}

export async function pullDoc(code: string): Promise<CloudDoc | null> {
  const r = await call('GET', code);
  if (r.status === 404) return null;
  return r.data.doc as CloudDoc;
}

export type PushResult = { ok: true; updatedAt: number } | { ok: false; reason: 'conflict' | 'empty'; remote: CloudDoc };
export async function pushDoc(code: string, doc: CloudDoc, base: number, force = false): Promise<PushResult> {
  const r = await call('PUT', code, '', { doc, base, force });
  if (r.status === 409) return { ok: false, reason: r.data.error === 'empty' ? 'empty' : 'conflict', remote: r.data.doc as CloudDoc };
  return { ok: true, updatedAt: Number(r.data.updatedAt) || doc.updatedAt };
}

export async function listVersions(code: string): Promise<{ index: number; updatedAt: number; articles: number; device: string }[]> {
  const r = await call('GET', code, '?versions=1');
  return (r.data.versions as { index: number; updatedAt: number; articles: number; device: string }[]) ?? [];
}
export async function getVersion(code: string, index: number): Promise<CloudDoc | null> {
  const r = await call('GET', code, `?version=${index}`);
  return r.status === 404 ? null : (r.data.doc as CloudDoc);
}

/* ------------------------------------------------------------------ */
/* Fusion (deux appareils ont travaillé en parallèle)                  */
/* ------------------------------------------------------------------ */

const newer = (a?: string, b?: string) => (a ?? '') >= (b ?? '');

/**
 * Fusionne deux bases : on garde tous les articles, et pour un même article la fiche la plus récente.
 * Historique et mesures : union, sans doublon.
 */
export function mergeDocs(local: Omit<CloudDoc, 'updatedAt'>, remote: CloudDoc): Omit<CloudDoc, 'updatedAt'> {
  const byKey = new Map<string, CatalogItem>();
  for (const it of remote.catalog ?? []) byKey.set(itemKey(it.code, it.pn), it);
  for (const it of local.catalog ?? []) {
    const k = itemKey(it.code, it.pn);
    const other = byKey.get(k);
    if (!other || newer(it.updatedAt, other.updatedAt)) byKey.set(k, it);
  }
  const union = <T extends { id: string }>(a: T[] = [], b: T[] = []) => {
    const m = new Map<string, T>();
    for (const x of [...b, ...a]) m.set(x.id, x);
    return [...m.values()];
  };
  const history = union(local.history, remote.history)
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    .slice(0, 200);
  const accuracy = union(local.accuracy, remote.accuracy)
    .sort((x, y) => y.date.localeCompare(x.date))
    .slice(0, 300);
  // réglages : ceux de cet appareil, sauf s'il n'en a pas encore (navigateur vidé) → ceux de l'espace
  const configured = (s?: Settings) => !!s && !!(s.logo || s.companyName);
  return { catalog: [...byKey.values()], history, accuracy, settings: configured(local.settings) ? local.settings : (remote.settings ?? local.settings) };
}

/** Empreinte rapide d'un contenu (pour ne pas renvoyer au serveur ce qu'il a déjà) */
export function fingerprint(d: Omit<CloudDoc, 'updatedAt'>): string {
  const s = JSON.stringify([d.catalog?.length, d.history?.length, d.accuracy?.length, d.catalog?.map((c) => c.updatedAt).join(','), d.history?.[0]?.id, d.accuracy?.[0]?.id, d.settings]);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Appareil';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ? ' (app)' : '';
  return os + standalone;
}
