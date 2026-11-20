import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogItem, HistoryEntry, PendingChange, Settings } from '../types';
import type { AccuracyRecord } from './realCheck';
import {
  CloudFailure,
  deviceName,
  fingerprint,
  getVersion,
  listVersions,
  loadCloud,
  mergeDocs,
  newSpaceCode,
  pullDoc,
  pushDoc,
  saveCloud,
  type CloudDoc,
  type CloudState,
} from './cloud';

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'offline' | 'not_configured' | 'error' | 'locked' | 'org_locked';

interface Data {
  catalog: CatalogItem[];
  history: HistoryEntry[];
  accuracy: AccuracyRecord[];
  settings: Settings;
  pending: PendingChange[];
  pendingDone: string[];
}
interface Setters {
  /** écriture directe (sans garde-fou « base vide ») : réservé aux restaurations */
  setCatalog: (c: CatalogItem[]) => void;
  setHistory: (h: HistoryEntry[]) => void;
  setAccuracy: (a: AccuracyRecord[]) => void;
  setSettings: (s: Settings) => void;
  setPending: (p: PendingChange[]) => void;
  setPendingDone: (d: string[]) => void;
  notify: (msg: string) => void;
}

type Body = Omit<CloudDoc, 'updatedAt'>;
const DEBOUNCE_MS = 4000;

/**
 * Synchronisation automatique avec la sauvegarde en ligne :
 * - à l'ouverture, au retour sur l'onglet, au retour du réseau, et 4 s après chaque modification ;
 * - base locale vide mais base en ligne remplie (navigateur vidé) → restauration automatique ;
 * - deux appareils ont modifié la base → fusion (fiche la plus récente pour chaque article).
 */
export function useCloudSync(data: Data, set: Setters) {
  const [cloud, setCloud] = useState<CloudState | null>(() => loadCloud());
  const [status, setStatus] = useState<SyncStatus>(cloud ? 'syncing' : 'off');
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [detail, setDetail] = useState('');
  const ref = useRef({ data, set });
  ref.current = { data, set };
  const busy = useRef(false);
  const again = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const local = (): Body => {
    const d = ref.current.data;
    return { catalog: d.catalog, history: d.history, accuracy: d.accuracy, settings: d.settings, pending: d.pending, pendingDone: d.pendingDone };
  };
  const apply = (b: Body) => {
    const s = ref.current.set;
    s.setCatalog(b.catalog ?? []);
    s.setHistory(b.history ?? []);
    s.setAccuracy(b.accuracy ?? []);
    if (b.settings) s.setSettings({ ...ref.current.data.settings, ...b.settings });
    s.setPendingDone(b.pendingDone ?? []);
    s.setPending((b.pending ?? []).filter((p) => !(b.pendingDone ?? []).includes(p.id)));
  };

  const sync = useCallback(async (): Promise<void> => {
    const state = loadCloud();
    if (!state) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    setStatus('syncing');
    try {
      const mine = local();
      const remote = await pullDoc(state.code);
      let base = state.lastSync;
      let toPush: Body | null = null;
      if (!remote) {
        if (mine.catalog.length || mine.history.length) toPush = mine;
      } else if (!mine.catalog.length && remote.catalog.length) {
        // le navigateur a perdu la base : on la remet sans rien demander
        apply(remote);
        ref.current.set.notify(`Base restaurée depuis la sauvegarde en ligne (${remote.catalog.length} articles)`);
        base = remote.updatedAt;
      } else if (remote.updatedAt > state.lastSync) {
        // un autre appareil a enregistré depuis : fusion
        const merged = mergeDocs(mine, remote);
        if (fingerprint(merged) !== fingerprint(mine)) apply(merged);
        base = remote.updatedAt;
        if (fingerprint(merged) !== fingerprint(remote)) toPush = merged;
      } else if (fingerprint(mine) !== fingerprint(remote)) {
        toPush = mine;
        base = remote.updatedAt;
      }
      if (toPush) {
        const doc = (b: Body): CloudDoc => ({ ...b, updatedAt: Date.now(), device: deviceName() });
        let r = await pushDoc(state.code, doc(toPush), base);
        if (!r.ok && r.reason === 'conflict') {
          const merged = mergeDocs(toPush, r.remote);
          apply(merged);
          r = await pushDoc(state.code, doc(merged), r.remote.updatedAt);
        }
        if (!r.ok && r.reason === 'empty') {
          apply(r.remote);
          ref.current.set.notify(`Base restaurée depuis la sauvegarde en ligne (${r.remote.catalog.length} articles)`);
          base = r.remote.updatedAt;
        } else if (r.ok) base = r.updatedAt;
        else base = r.remote.updatedAt;
      }
      const next = { code: state.code, lastSync: base };
      saveCloud(next);
      setCloud(next);
      setStatus('synced');
      setDetail('');
      setLastAt(Date.now());
    } catch (e) {
      const kind = e instanceof CloudFailure ? e.kind : 'server';
      setStatus(kind === 'offline' ? 'offline' : kind === 'not_configured' ? 'not_configured' : kind === 'login' ? 'locked' : kind === 'org_locked' ? 'org_locked' : 'error');
      setDetail(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        window.setTimeout(() => void sync(), 300);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // à l'ouverture, au retour sur l'appli, au retour du réseau
  useEffect(() => {
    if (!cloud) return;
    void sync();
    const onVis = () => document.visibilityState === 'visible' && void sync();
    const onOnline = () => void sync();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
  }, [cloud?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  // après chaque modification (regroupées)
  useEffect(() => {
    if (!loadCloud()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void sync(), DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
  }, [data.catalog, data.history, data.accuracy, data.settings, data.pending, data.pendingDone]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    cloud,
    status,
    detail,
    lastAt,
    syncNow: sync,
    /** crée un nouvel espace et y envoie la base de cet appareil */
    enable: async () => {
      const s = { code: newSpaceCode(), lastSync: 0 };
      saveCloud(s);
      setCloud(s);
      await sync();
    },
    /** rejoint un espace existant (autre appareil, collègue) : les deux bases sont fusionnées */
    join: async (code: string) => {
      const s = { code, lastSync: 0 };
      saveCloud(s);
      setCloud(s);
      await sync();
    },
    disconnect: () => {
      saveCloud(null);
      setCloud(null);
      setStatus('off');
    },
    versions: () => (cloud ? listVersions(cloud.code) : Promise.resolve([])),
    restoreVersion: async (index: number) => {
      if (!cloud) return;
      const doc = await getVersion(cloud.code, index);
      if (!doc) return;
      apply(doc);
      const cur = await pullDoc(cloud.code);
      const r = await pushDoc(cloud.code, { ...doc, updatedAt: Date.now(), device: deviceName() }, cur?.updatedAt ?? 0, true);
      const next = { code: cloud.code, lastSync: r.ok ? r.updatedAt : cloud.lastSync };
      saveCloud(next);
      setCloud(next);
      ref.current.set.notify(`Version du ${new Date(doc.updatedAt).toLocaleString('fr-FR')} restaurée (${doc.catalog.length} articles)`);
    },
  };
}
