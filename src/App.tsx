import { useRef, useState } from 'react';
import type { CatalogItem } from './types';
import { usePersistent } from './lib/storage';
import { mergeCatalog } from './lib/normalize';
import ImportPanel from './components/ImportPanel';
import CatalogPanel from './components/CatalogPanel';
import GeneratorPanel from './components/GeneratorPanel';

type Tab = 'import' | 'catalog' | 'generate';

export default function App() {
  const [catalog, setCatalog] = usePersistent<CatalogItem[]>('catalog', []);
  const [tab, setTab] = useState<Tab>(catalog.length ? 'generate' : 'import');
  const latest = useRef(catalog);
  latest.current = catalog;

  // latest garde le catalogue le plus récent même si plusieurs fichiers sont importés avant un nouveau rendu
  const onImport = (items: CatalogItem[]) => {
    const r = mergeCatalog(latest.current, items);
    latest.current = r.catalog;
    setCatalog(r.catalog);
    return { added: r.added, updated: r.updated };
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'import', label: '① Importer des PL' },
    { id: 'catalog', label: `② Base articles (${catalog.length})` },
    { id: 'generate', label: '③ Générer une PL' },
  ];

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand">
          <span className="logo">📦</span>
          <div>
            <h1>PL Generator</h1>
            <small>Génération de Packing Lists à partir de vos PL existantes</small>
          </div>
        </div>
        <nav>
          {tabs.map((t) => (
            <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'import' && <ImportPanel onImport={onImport} />}
        {tab === 'catalog' && <CatalogPanel catalog={catalog} setCatalog={setCatalog} />}
        {tab === 'generate' && <GeneratorPanel catalog={catalog} />}
      </main>
    </div>
  );
}
