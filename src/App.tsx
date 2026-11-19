import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogItem, HistoryEntry, RequestLine, Settings } from './types';
import { requestPersistence, save, STORAGE_ERROR_EVENT, usePersistent } from './lib/storage';
import { backupReminderDue, downloadCatalogBackup, snoozeBackupReminder } from './lib/backup';
import { mergeCatalog } from './lib/normalize';
import { useCloudSync, type SyncStatus } from './lib/useCloudSync';
import { listSnapshots } from './lib/safety';
import type { AccuracyRecord } from './lib/realCheck';
import { DEFAULT_ACCENT } from './lib/exporters';
import { LangContext } from './lib/i18n';
import { SafetyContext, type ConfirmOptions, type Safety } from './lib/safety';
import ConfirmDialog from './components/ConfirmDialog';
import { installUpdateHandlers, updateNow } from './lib/updates';
import { sanitizeCatalog } from './lib/validate';
import SafeBoundary from './components/SafeBoundary';
import ImportPanel from './components/ImportPanel';
import CatalogPanel from './components/CatalogPanel';
import GeneratorPanel from './components/GeneratorPanel';
import HistoryPanel from './components/HistoryPanel';
import SettingsPanel from './components/SettingsPanel';

type Tab = 'generate' | 'catalog' | 'import' | 'history' | 'settings';

const ICONS: Record<Tab, string> = {
  generate: 'M9 5h10M9 12h10M9 19h10M4.5 5h.01M4.5 12h.01M4.5 19h.01',
  catalog: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  import: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
  history: 'M12 7v5l3 2M3 12a9 9 0 103-6.7M3 4v4h4',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4',
};

const DEFAULT_SETTINGS: Settings = { companyName: '', logo: '', accent: DEFAULT_ACCENT };

const CLOUD_LABEL: Record<SyncStatus, string> = {
  off: '',
  syncing: 'synchronisation…',
  synced: 'sauvegardée en ligne',
  offline: 'hors ligne',
  not_configured: 'sauvegarde en ligne inactive',
  error: 'erreur de sauvegarde',
};

export default function App() {
  const [catalog, setCatalogRaw] = usePersistent<CatalogItem[]>('catalog', []);
  const latest = useRef(catalog);
  latest.current = catalog;
  /**
   * Garde-fou : une base remplie n'est jamais remplacée par une base vide, sauf demande explicite
   * (« Vider la base »). Protège contre toute fausse manœuvre ou anomalie.
   */
  const setCatalog = useCallback(
    (c: CatalogItem[], o?: { allowEmpty?: boolean }) => {
      if (!c.length && latest.current.length && !o?.allowEmpty) {
        console.warn('Écriture d’une base vide refusée (garde-fou)');
        return;
      }
      latest.current = c;
      setCatalogRaw(c);
    },
    [setCatalogRaw],
  );
  // nettoyage au démarrage : fiches corrompues (ancien import, fichier invalide) écartées — jamais au point de tout vider
  useEffect(() => {
    if (!Array.isArray(catalog)) return;
    const { items, rejected } = sanitizeCatalog(catalog);
    if ((rejected || items.length !== catalog.length) && items.length) setCatalog(items);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [settings, setSettings] = usePersistent<Settings>('settings', DEFAULT_SETTINGS);
  const [history, setHistory] = usePersistent<HistoryEntry[]>('history', []);
  const [accuracy, setAccuracy] = usePersistent<AccuracyRecord[]>('accuracy', []);
  const [lines, setLines] = usePersistent<RequestLine[]>('requests', []);
  const [consolidate, setConsolidate] = usePersistent<boolean>('consolidate', true);
  const [tab, setTab] = useState<Tab>(catalog.length ? 'generate' : 'import');
  const [toastMsg, setToastMsg] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const [confirmState, setConfirmState] = useState<{ o: ConfirmOptions; resolve: (b: boolean) => void } | null>(null);
  const notify = useCallback((msg: string, undo?: () => void) => {
    setToastMsg({ msg, undo });
    window.clearTimeout(toastTimer.current);
    // plus de temps quand une annulation est possible
    toastTimer.current = window.setTimeout(() => setToastMsg(null), undo ? 10000 : 2600);
  }, []);
  const toast = (msg: string) => notify(msg);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ o, resolve })), []);
  const safety = useMemo<Safety>(() => ({ ask, notify }), [ask, notify]);
  const answer = useCallback(
    (ok: boolean) => {
      confirmState?.resolve(ok);
      setConfirmState(null);
    },
    [confirmState],
  );

  // Sauvegarde en ligne (restauration automatique si le navigateur efface ses données)
  const cloud = useCloudSync(
    { catalog, history, accuracy, settings },
    { setCatalog: (c) => { latest.current = c; setCatalogRaw(c); }, setHistory, setAccuracy, setSettings, notify },
  );
  // base vide mais copie de secours locale disponible (et pas de sauvegarde en ligne)
  const [rescue, setRescue] = useState(() => (catalog.length ? null : listSnapshots().find((x) => x.catalog.length > 0) ?? null));

  const [updateReady, setUpdateReady] = useState(false);
  // Sauvegardes locales : alerte si elles échouent, stockage protégé, rappel de sauvegarde de la base
  const [storageError, setStorageError] = useState(false);
  const [showBackup, setShowBackup] = useState(() => backupReminderDue(catalog.length));
  useEffect(() => {
    void requestPersistence();
    const onErr = () => setStorageError(true);
    window.addEventListener(STORAGE_ERROR_EVENT, onErr);
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, onErr);
  }, []);
  const [updating, setUpdating] = useState(false);
  useEffect(() => installUpdateHandlers(() => setUpdateReady(true)), []);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accent || DEFAULT_ACCENT);
  }, [settings.accent]);

  // latest garde le catalogue le plus récent même si plusieurs fichiers sont importés avant un nouveau rendu
  const onImport = (items: CatalogItem[]) => {
    const r = mergeCatalog(latest.current, items);
    setCatalog(r.catalog);
    return { added: r.added, updated: r.updated };
  };

  const onSaved = (e: HistoryEntry) => {
    // pas de doublon si on exporte plusieurs fois la même PL
    const key = (h: HistoryEntry) => JSON.stringify(h.requests.map((r) => [r.code, r.pn, r.quantity]));
    const same = history[0] && key(history[0]) === key(e);
    setHistory([e, ...(same ? history.slice(1) : history)].slice(0, 200));
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'generate', label: 'Nouvelle PL', badge: lines.length || undefined },
    { id: 'catalog', label: 'Articles' },
    { id: 'import', label: 'Importer' },
    { id: 'history', label: 'Historique' },
    { id: 'settings', label: 'Réglages' },
  ];

  return (
    <LangContext.Provider value={settings.lang ?? 'fr'}>
    <SafetyContext.Provider value={safety}>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {settings.logo ? <img src={settings.logo} alt="" className="brand-logo" /> : <span className="brand-mark">PL</span>}
          <div>
            <h1>Packing List</h1>
            <small>
              {catalog.length} articles en base
              {cloud.status !== 'off' && (
                <span className={`cloud-dot ${cloud.status}`} title={CLOUD_LABEL[cloud.status]}>
                  {' · '}☁ {CLOUD_LABEL[cloud.status]}
                </span>
              )}
            </small>
          </div>
        </div>
        <nav className="nav">
          {tabs.map((t) => (
            <button key={t.id} className={tab === t.id ? 'nav-btn active' : 'nav-btn'} onClick={() => setTab(t.id)}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d={ICONS[t.id]} />
              </svg>
              <span>{t.label}</span>
              {t.badge ? <em className="badge">{t.badge}</em> : null}
            </button>
          ))}
        </nav>
      </header>

      {storageError && (
        <div className="update-banner danger-banner" role="alert">
          <span>
            ⛔ Le navigateur refuse d'enregistrer les dernières modifications (stockage plein ou navigation privée). Sauvegardez la
            base maintenant pour ne rien perdre.
          </span>
          <button className="btn small primary" onClick={() => downloadCatalogBackup(catalog)}>
            Sauvegarder la base
          </button>
        </div>
      )}
      {rescue && !catalog.length && cloud.status === 'off' && (
        <div className="update-banner danger-banner" role="alert">
          <span>
            Votre base est vide, mais une copie de secours du {new Date(rescue.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} existe ({rescue.catalog.length} articles).
          </span>
          <button
            className="btn small primary"
            onClick={() => {
              setCatalog(rescue.catalog);
              setRescue(null);
              toast(`Base restaurée (${rescue.catalog.length} articles)`);
            }}
          >
            Restaurer
          </button>
          <button className="btn small ghost" onClick={() => setRescue(null)}>
            Ignorer
          </button>
        </div>
      )}
      {showBackup && !storageError && cloud.status === 'off' && catalog.length > 0 && (
        <div className="update-banner" role="region" aria-label="Information">
          <span>
            Votre base n'existe que dans ce navigateur, qui peut l'effacer (iPhone : après 7 jours sans visite). Activez la sauvegarde en ligne
            pour ne plus jamais la perdre.
          </span>
          <button
            className="btn small primary"
            onClick={() => {
              setShowBackup(false);
              setTab('settings');
            }}
          >
            Activer
          </button>
          <button
            className="btn small ghost"
            onClick={() => {
              snoozeBackupReminder();
              setShowBackup(false);
            }}
          >
            Plus tard
          </button>
        </div>
      )}
      {updateReady && (
        <div className="update-banner" role="region" aria-label="Information">
          <span>Une nouvelle version est disponible.</span>
          <button
            className="btn small primary"
            disabled={updating}
            onClick={() => {
              setUpdating(true);
              void updateNow();
            }}
          >
            {updating ? 'Mise à jour…' : 'Mettre à jour'}
          </button>
        </div>
      )}

      <main>
        <SafeBoundary key={tab} label="Cet écran">
        {tab === 'generate' && (
          <GeneratorPanel
            catalog={catalog}
            setCatalog={setCatalog}
            settings={settings}
            setSettings={setSettings}
            lines={lines}
            setLines={setLines}
            consolidate={consolidate}
            setConsolidate={setConsolidate}
            onSaved={onSaved}
            toast={toast}
          />
        )}
        {tab === 'catalog' && <CatalogPanel catalog={catalog} setCatalog={setCatalog} toast={toast} />}
        {tab === 'import' && (
          <ImportPanel onImport={onImport} getCatalog={() => latest.current} onAccuracy={(r) => setAccuracy((a) => [r, ...a].slice(0, 300))} />
        )}
        {tab === 'history' && (
          <HistoryPanel
            accuracy={accuracy}
            setAccuracy={setAccuracy}
            history={history}
            setHistory={setHistory}
            onOpen={(h) => {
              setLines(h.requests.map((r) => ({ ...r })));
              // mêmes réglages qu'à l'export : proposition, langue, mode de transport
              if (h.proposal) save('proposal', h.proposal);
              setSettings({ ...settings, lang: h.lang ?? settings.lang, transportMode: h.transportMode ?? settings.transportMode });
              setTab('generate');
              toast('PL rouverte avec ses réglages d’origine');
            }}
          />
        )}
        {tab === 'settings' && <SettingsPanel settings={settings} setSettings={setSettings} toast={toast} cloud={cloud} />}
        </SafeBoundary>
      </main>

      {toastMsg && (
        <div className="toast">
          <span>{toastMsg.msg}</span>
          {toastMsg.undo && (
            <button
              className="toast-undo"
              onClick={() => {
                toastMsg.undo?.();
                setToastMsg(null);
                notify('Action annulée');
              }}
            >
              Annuler
            </button>
          )}
        </div>
      )}
      {confirmState && <ConfirmDialog options={confirmState.o} onAnswer={answer} />}
    </div>
    </SafetyContext.Provider>
    </LangContext.Provider>
  );
}
