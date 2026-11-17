import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogItem, HistoryEntry, RequestLine, Settings } from './types';
import { usePersistent } from './lib/storage';
import { mergeCatalog } from './lib/normalize';
import { DEFAULT_ACCENT } from './lib/exporters';
import { LangContext } from './lib/i18n';
import { SafetyContext, type ConfirmOptions, type Safety } from './lib/safety';
import ConfirmDialog from './components/ConfirmDialog';
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

export default function App() {
  const [catalog, setCatalog] = usePersistent<CatalogItem[]>('catalog', []);
  const [settings, setSettings] = usePersistent<Settings>('settings', DEFAULT_SETTINGS);
  const [history, setHistory] = usePersistent<HistoryEntry[]>('history', []);
  const [lines, setLines] = usePersistent<RequestLine[]>('requests', []);
  const [consolidate, setConsolidate] = usePersistent<boolean>('consolidate', true);
  const [tab, setTab] = useState<Tab>(catalog.length ? 'generate' : 'import');
  const [toastMsg, setToastMsg] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const [confirmState, setConfirmState] = useState<{ o: ConfirmOptions; resolve: (b: boolean) => void } | null>(null);
  const latest = useRef(catalog);
  latest.current = catalog;

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

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accent || DEFAULT_ACCENT);
  }, [settings.accent]);

  // latest garde le catalogue le plus récent même si plusieurs fichiers sont importés avant un nouveau rendu
  const onImport = (items: CatalogItem[]) => {
    const r = mergeCatalog(latest.current, items);
    latest.current = r.catalog;
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
            <small>{catalog.length} articles en base</small>
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

      <main>
        {tab === 'generate' && (
          <GeneratorPanel
            catalog={catalog}
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
        {tab === 'import' && <ImportPanel onImport={onImport} />}
        {tab === 'history' && (
          <HistoryPanel
            history={history}
            setHistory={setHistory}
            onOpen={(h) => {
              setLines(h.requests.map((r) => ({ ...r })));
              setTab('generate');
              toast('PL rouverte');
            }}
          />
        )}
        {tab === 'settings' && <SettingsPanel settings={settings} setSettings={setSettings} toast={toast} />}
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
