import { useDeferredValue, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { CatalogItem, HistoryEntry, PackingList, RequestLine, Settings } from '../types';
import { chooseVariant, findItem, generatePackingList, parsePastedRequests } from '../lib/generate';
import { exportComparisonPdf, exportPackingListPdf, exportPackingListXlsx, exportRequestTemplate, sharePackingListPdf } from '../lib/exporters';
import ComparePanel, { type Proposal } from './ComparePanel';
import { uid } from '../lib/normalize';
import { detectHeaderRow, detectMapping } from '../lib/detect';
import { parseNumber } from '../lib/parseValues';
import ArticleSearch from './ArticleSearch';
import PackingListView from './PackingListView';
import QuickItemForm from './QuickItemForm';
import { useCan } from '../lib/access';
import TransportPanel from './TransportPanel';
import InfoTip from './InfoTip';
import LabelsDialog from './LabelsDialog';
import OrderImportDialog from './OrderImportDialog';
import ExportDocsDialog from './ExportDocsDialog';
import ShareLinkDialog from './ShareLinkDialog';
import type { OrderLine } from '../lib/orderImport';
import { useLogoInfo } from '../lib/useLogoInfo';
import type { GlossaryKey } from '../lib/glossary';
import { DEFAULT_ACCENT } from '../lib/exporters';
import { dimsText, packLabel } from '../lib/i18n';
import { useSafety } from '../lib/safety';
import { isStackable, stackKey } from '../lib/loadPlan';
import { usePersistent } from '../lib/storage';
import { isPieceUnit } from '../lib/validate';
import { hasError, itemIssues } from '../lib/quality';
import { isChunkLoadError, reloadForUpdate } from '../lib/updates';

interface Props {
  catalog: CatalogItem[];
  setCatalog: (c: CatalogItem[]) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  lines: RequestLine[];
  setLines: (l: RequestLine[]) => void;
  consolidate: boolean;
  setConsolidate: (b: boolean) => void;
  onSaved: (e: HistoryEntry) => void;
  toast: (msg: string) => void;
  /** espace de sauvegarde en ligne (nécessaire au lien client) */
  shareSpace?: string;
}

const fmt = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

const CONF: Record<string, [string, string, string]> = {
  observed: ['déjà expédié', 'chip-ok', 'Configuration identique à un envoi réel de vos PL'],
  interpolated: ['interpolé', 'chip-accent', 'Calculé entre deux envois réels de cet article'],
  estimated: ['estimé', 'chip-warn', "Extrapolé à partir d'un seul envoi réel"],
  mixed: ['colis mixte', 'chip-danger', 'Article vu seulement avec d’autres dans un même colis : poids et dimensions approximatifs'],
  manual: ['fiche manuelle', 'chip-accent', 'Valeurs saisies à la main dans la fiche article'],
};

function ConfidenceChip({ c }: { c: string }) {
  const [label, cls, title] = CONF[c] ?? CONF.estimated;
  return (
    <span className="chip-with-tip">
      <span className={`chip ${cls}`} title={title}>
        {label}
      </span>
      <InfoTip k={(c in CONF ? c : 'estimated') as GlossaryKey} />
    </span>
  );
}

/**
 * Emballage proposé pour la ligne, tel qu'il sortira sur la PL (ex. « 2 colis : Palette 120×80×117 + 120×80×33 »).
 * La configuration de référence de la base reste visible au survol.
 */
function PackingChip({ pl, code, packing, lang }: { pl: PackingList | null; code: string; packing: CatalogItem; lang: 'fr' | 'en' }) {
  const base = `${packing.qtyPerPackage} / ${packLabel(packing.packageType, lang)}${packing.length ? ` · ${dimsText(packing.length, packing.width, packing.height, lang, '×')}` : ''}`;
  const mine = pl ? pl.packages.filter((p) => p.contents.some((c) => c.code === code)) : [];
  if (!mine.length) return <span className={packing.dimsInferred ? 'chip chip-check' : 'chip'}>{base}</span>;
  const groups = new Map<string, { n: number; label: string }>();
  for (const p of mine) {
    const shared = p.contents.length > 1;
    const label = shared ? `${packLabel(p.type, lang)} n° ${p.no} (partagé)` : `${packLabel(p.type, lang)} ${p.dimCheck ? '≈ ' : ''}${dimsText(p.length, p.width, p.height, lang, '×')}`;
    const k = shared ? `s${p.no}` : label;
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { n: 1, label });
  }
  const text = [...groups.values()].map((g) => (g.n > 1 ? `${g.n} × ${g.label}` : g.label)).join(' + ');
  const doubt = mine.some((p) => p.dimCheck);
  return (
    <span className={doubt ? 'chip chip-check' : 'chip'} title={`Configuration de référence dans la base : ${base}`}>
      {mine.length} colis · {text}
    </span>
  );
}

export default function GeneratorPanel({ catalog, setCatalog, settings, setSettings, lines, setLines, consolidate, setConsolidate, onSaved, toast, shareSpace }: Props) {
  const can = useCan();
  const canEdit = can('catalogEdit');
  const canExport = can('export');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ item: CatalogItem | null; code: string; pn: string } | null>(null);
  const lang = settings.lang ?? 'fr';
  const { ask, notify } = useSafety();
  const fileRef = useRef<HTMLInputElement>(null);
  // bon de commande client (PDF, Excel, photo) → lignes de la PL
  const orderRef = useRef<HTMLInputElement>(null);
  const [order, setOrder] = useState<{ fileName: string; lines: OrderLine[] } | null>(null);
  const [orderBusy, setOrderBusy] = useState('');
  const readOrder = async (f: File | undefined) => {
    if (!f) return;
    setOrderBusy('Lecture de la commande…');
    try {
      const { readOrderFile, extractOrder } = await import('../lib/orderImport');
      const tables = await readOrderFile(f, setOrderBusy);
      setOrder({ fileName: f.name, lines: extractOrder(tables, catalog) });
    } catch (e) {
      if (isChunkLoadError(e)) return reloadForUpdate();
      toast('Ce document n’a pas pu être lu (format non pris en charge ou fichier protégé)');
    } finally {
      setOrderBusy('');
    }
  };
  const addOrder = (ol: OrderLine[]) => {
    setLines([...lines, ...ol.map((o) => ({ id: uid(), code: o.code, pn: o.pn, quantity: cleanQty(o.code, o.pn, o.quantity) }))]);
    setOrder(null);
    toast(`${ol.length} ligne${ol.length > 1 ? 's' : ''} de la commande ajoutée${ol.length > 1 ? 's' : ''}`);
  };
  const active = lines.filter((l) => (l.code || l.pn) && l.quantity > 0);

  // Calcul en direct à chaque modification
  // Deux propositions calculées en direct : « selon Grundfos » et « optimisée »
  const [proposal, setProposal] = usePersistent<Proposal>('proposal', 'smart');
  const plSmart = useMemo(
    () => (active.length ? generatePackingList(catalog, active, { consolidate, strategy: 'smart' }) : null),
    [catalog, active, consolidate],
  );
  const plGrundfos = useMemo(
    () => (active.length ? generatePackingList(catalog, active, { consolidate: false, strategy: 'grundfos' }) : null),
    [catalog, active],
  );
  const pl = proposal === 'grundfos' ? plGrundfos : plSmart;

  // Article de chaque ligne, résolu une seule fois (la recherche dans la base est coûteuse sur 60 lignes)
  const resolved = useMemo(() => {
    const items = new Map<string, CatalogItem | undefined>();
    const firstIdx = new Map<string, number>();
    const dupOf = new Map<string, number>();
    lines.forEach((l, i) => {
      const it = findItem(catalog, l.code, l.pn);
      items.set(l.id, it);
      const key = it ? `id:${it.id}` : `txt:${(l.code || l.pn).toLowerCase()}`;
      if (firstIdx.has(key)) dupOf.set(l.id, firstIdx.get(key)!);
      else firstIdx.set(key, i);
    });
    return { items, dupOf };
  }, [catalog, lines]);
  // les sections lourdes (schémas, plan) suivent avec un léger différé : la saisie reste fluide
  // colis gerbables : choix de l'utilisateur, colis par colis (sinon la règle automatique)
  const [stackOv, setStackOv] = usePersistent<Record<string, boolean>>('stackOverrides', {});
  const plStacked = useMemo(
    () => (pl ? { ...pl, packages: pl.packages.map((p) => (stackKey(p) in stackOv ? { ...p, stackable: stackOv[stackKey(p)] } : p)) } : pl),
    [pl, stackOv],
  );
  const deferredPl = useDeferredValue(plStacked);

  const addItem = (code: string, pn: string, quantity = 1) => {
    const existing = lines.find((l) => (code && l.code === code) || (pn && l.pn === pn && l.pn));
    if (existing) {
      setLines(lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + quantity } : l)));
      toast(`Quantité augmentée : ${code || pn}`);
    } else setLines([...lines, { id: uid(), code, pn, quantity }]);
  };
  /** pièces, jeux, unités : quantité entière ; autres unités (m, kg…) : décimales permises */
  const cleanQty = (code: string, pn: string, q: number) => {
    const n = Number.isFinite(q) ? Math.max(0, q) : 0;
    return isPieceUnit(findItem(catalog, code, pn)?.unit) ? Math.round(n) : Math.round(n * 1000) / 1000;
  };
  const setQty = (id: string, q: number) => setLines(lines.map((l) => (l.id === id ? { ...l, quantity: cleanQty(l.code, l.pn, q) } : l)));
  const remove = (id: string) => {
    const before = lines;
    setLines(lines.filter((l) => l.id !== id));
    notify('Article retiré', () => setLines(before));
  };

  const addPasted = () => {
    const parsed = parsePastedRequests(paste);
    if (!parsed.length) return toast('Aucune ligne reconnue (format : Code ⇥ PN ⇥ Quantité)');
    setLines([
      ...lines,
      ...parsed.map((p) => {
        const it = findItem(catalog, p.code, p.pn);
        return { ...p, quantity: cleanQty(p.code, p.pn, p.quantity), code: it ? it.code : p.code, pn: it ? it.pn : p.pn, id: uid() };
      }),
    ]);
    setPaste('');
    toast(`${parsed.length} ligne(s) ajoutée(s)`);
  };

  const importRequestFile = async (f: File | undefined) => {
    if (!f) return;
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
      .map((r) => r.map((c) => String(c ?? '').trim()));
    const hr = detectHeaderRow(rows);
    const m = detectMapping(rows[hr] ?? []);
    if (m.quantity === undefined || (m.code === undefined && m.pn === undefined)) {
      return toast('Colonnes non reconnues : utilisez le modèle Code article | PN | Quantité');
    }
    const parsed: RequestLine[] = [];
    for (const r of rows.slice(hr + 1)) {
      const code = m.code !== undefined ? r[m.code] ?? '' : '';
      const pn = m.pn !== undefined ? r[m.pn] ?? '' : '';
      const qty = parseNumber(r[m.quantity]);
      const q = cleanQty(code, pn, qty);
      if ((code || pn) && q > 0) parsed.push({ id: uid(), code, pn, quantity: q });
    }
    setLines([...lines, ...parsed]);
    toast(`${parsed.length} ligne(s) importée(s)`);
  };

  const [showLabels, setShowLabels] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const logoInfo = useLogoInfo(settings.logo);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (!pl) return;
    setBusy(label);
    try {
      await fn();
      onSaved({
        id: uid(),
        createdAt: new Date().toISOString(),
        reference: '',
        requests: active,
        totals: pl.totals,
        proposal,
        lang: settings.lang ?? 'fr',
        transportMode: settings.transportMode ?? 'sea',
      });
    } catch (e) {
      console.error(e);
      if (isChunkLoadError(e)) {
        // onglet ouvert sur une ancienne version : on recharge (la PL en cours est conservée)
        toast('Mise à jour de l’application… relancez l’export après le rechargement');
        if (!reloadForUpdate()) toast('Rechargez la page (nouvelle version en ligne), puis relancez l’export');
      } else toast(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const unknown = pl?.lines.filter((l) => !l.found).length ?? 0;
  const byConf = (c: string) => pl?.lines.filter((l) => l.found && l.confidence === c).length ?? 0;
  const suspicious = active.filter((l) => {
    const it = resolved.items.get(l.id);
    return it && hasError(it);
  }).length;
  const reliability = {
    observed: byConf('observed'),
    interpolated: byConf('interpolated'),
    estimated: byConf('estimated'),
    mixed: byConf('mixed'),
    manual: byConf('manual'),
  };

  return (
    <div className="page">
      <h2 className="sr-only">Nouvelle Packing List</h2>
      {catalog.length === 0 && (
        <div className="banner">
          La base d'articles est vide. Importez vos Packing Lists (onglet <b>Importer</b>) ou chargez une base JSON (onglet{' '}
          <b>Articles</b>).
        </div>
      )}

      <div className="sticky-search">
        <ArticleSearch
          catalog={catalog}
          onPick={(it) => addItem(it.code, it.pn)}
          onPickUnknown={(code) => addItem(code, '')}
        />
      </div>

      {/* hors de la barre collante : sinon le bouton reste affiché par-dessus la page au défilement */}
      <div className="order-import-row">
        {can('orderImport') && <button className="btn ghost order-btn" disabled={!!orderBusy} onClick={() => orderRef.current?.click()} title="PDF, Excel ou photo du bon de commande">
          {orderBusy || '📄 Importer une commande client'}
        </button>}
        <input
          ref={orderRef}
          type="file"
          hidden
          accept=".pdf,.xlsx,.xls,.csv,image/*"
          onChange={(e) => {
            void readOrder(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {lines.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📦</div>
          <p>
            <b>Aucun article pour l'instant.</b>
            <br />
            Tapez un code, un PN ou une désignation ci-dessus, ou collez une liste depuis Excel.
          </p>
        </div>
      ) : (
        <div className="lines">
          {lines.map((l) => {
            const it = resolved.items.get(l.id);
            const smartChoice = it ? chooseVariant(it, l.quantity || 1) : null;
            // en mode « selon Grundfos », la fiabilité affichée est celle de cette proposition
            const gLine = proposal === 'grundfos' ? plGrundfos?.lines.find((x) => x.code === it?.code) : undefined;
            const choice = smartChoice ? { ...smartChoice, confidence: gLine?.confidence ?? smartChoice.confidence } : null;
            const packing = proposal === 'grundfos' && it ? it : (choice?.item ?? null);
            return (
              <div key={l.id} className={`line-card ${it ? '' : 'unknown'}`}>
                <div className="line-info">
                  <div className="line-title">{it ? it.description || it.code : l.code || l.pn}</div>
                  <div className="line-sub">
                    <span className="mono">{it ? it.code : l.code}</span>
                    {it && it.pn && it.pn !== it.code && <span className="mono"> · {it.pn}</span>}
                    {it ? (
                      packing && <PackingChip pl={pl} code={it.code} packing={packing} lang={lang} />
                    ) : (
                      <>
                        <span className="chip-with-tip">
                          <span className="chip chip-danger">introuvable dans la base</span>
                          <InfoTip k="unknown" />
                        </span>
                        {canEdit && <button className="link-btn" onClick={() => setQuick({ item: null, code: l.code, pn: l.pn })}>
                          Saisir dimensions et poids
                        </button>}
                      </>
                    )}
                    {choice && l.quantity > 0 && <ConfidenceChip c={choice.confidence} />}
                    {it && hasError(it) && (
                      <span className="chip-with-tip">
                        <span className="chip chip-danger" title={itemIssues(it).filter((i) => i.severity === 'error').map((i) => i.message).join(' ; ')}>
                          données suspectes
                        </span>
                        {canEdit && <button className="link-btn" onClick={() => setQuick({ item: it, code: it.code, pn: it.pn })}>
                          Corriger
                        </button>}
                      </span>
                    )}
                    {resolved.dupOf.has(l.id) && (
                      <span className="chip chip-warn">doublon : additionné à la ligne {resolved.dupOf.get(l.id)! + 1}</span>
                    )}
                    {canEdit && it && choice && ['estimated', 'mixed', 'manual'].includes(choice.confidence) && (
                      <button className="link-btn" onClick={() => setQuick({ item: it, code: it.code, pn: it.pn })}>
                        {choice.confidence === 'manual' ? 'Modifier les dimensions' : 'Saisir les dimensions réelles'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="stepper">
                  <button onClick={() => setQty(l.id, l.quantity - 1)} aria-label={`Diminuer la quantité de ${it?.description || l.code}`}>
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={l.quantity}
                    aria-label={`Quantité de ${it?.description || l.code || l.pn}`}
                    onChange={(e) => setQty(l.id, Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                  />
                  <button onClick={() => setQty(l.id, l.quantity + 1)} aria-label={`Augmenter la quantité de ${it?.description || l.code}`}>
                    +
                  </button>
                </div>
                <button className="icon-btn" onClick={() => remove(l.id)} aria-label={`Retirer ${it?.description || l.code}`} title="Retirer">
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="tools-row">
        <details className="bulk">
          <summary>Ajout en masse</summary>
          <p className="hint">Collez depuis Excel : une ligne par article, « Code ⇥ PN ⇥ Quantité » ou « Code ; Quantité ».</p>
          <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'96500988\t\t6\n99463877\t\t3'} />
          <div className="row wrap">
            <button className="btn" onClick={addPasted} disabled={!paste.trim()}>
              Ajouter ces lignes
            </button>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>
              Importer un fichier Excel
            </button>
            <button className="btn ghost" onClick={exportRequestTemplate}>
              Télécharger le modèle
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              void importRequestFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </details>
        {lines.length > 0 && (
          <button
            className="btn ghost danger"
            onClick={async () => {
              const ok = await ask({
                title: 'Retirer tous les articles ?',
                message: `Les ${lines.length} lignes de la PL en cours seront retirées (la base d'articles n'est pas touchée).`,
                confirmLabel: 'Tout retirer',
              });
              if (!ok) return;
              const before = lines;
              setLines([]);
              notify('PL vidée', () => setLines(before));
            }}
          >
            Tout effacer
          </button>
        )}
      </div>

      <label className="switch-row">
        <input type="checkbox" checked={consolidate} onChange={(e) => setConsolidate(e.target.checked)} />
        <span className="switch" aria-hidden />
        <span>
          <b>
            Regrouper les petits articles <InfoTip k="consolidate" />
          </b>
          <small>Carton ou palette commune pour les colis de moins de 0,15 m³ et 60 kg (proposition optimisée)</small>
        </span>
      </label>

      {pl && (
        <>
          <div className="summary-bar">
            <div className="kpis">
              <div>
                <small>Colis</small>
                <b>{pl.totals.packages}</b>
              </div>
              <div>
                <small>
                  Brut <InfoTip k="netGross" light />
                </small>
                <b>{fmt(pl.totals.grossWeight, 1)} kg</b>
              </div>
              <div>
                <small>Net</small>
                <b>{fmt(pl.totals.netWeight, 1)} kg</b>
              </div>
              <div>
                <small>
                  Volume <InfoTip k="volume" light />
                </small>
                <b>{fmt(pl.totals.volume, 3)} m³</b>
              </div>
            </div>
            <div className="actions">
              <div className="lang-toggle" role="group" aria-label="Langue du document">
                {(['fr', 'en'] as const).map((l) => (
                  <button key={l} className={lang === l ? 'on' : ''} onClick={() => setSettings({ ...settings, lang: l })}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
              {canExport && (<>
              <button className="btn primary" disabled={!!busy} onClick={() => run('pdf', () => exportPackingListPdf(plStacked ?? pl, settings))}>
                {busy === 'pdf' ? '…' : 'PDF'}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => run('xlsx', () => exportPackingListXlsx(plStacked ?? pl, settings))}>
                {busy === 'xlsx' ? '…' : 'Excel'}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => run('share', () => sharePackingListPdf(plStacked ?? pl, settings))}>
                {busy === 'share' ? '…' : 'Partager'}
              </button>
              </>)}
              {can('labels') && (
              <button className="btn" disabled={!!busy} onClick={() => setShowLabels(true)} title="Étiquettes de colis à imprimer">
                Étiquettes
              </button>
              )}
              {can('exportDocs') && (
              <button className="btn" disabled={!!busy} onClick={() => setShowExport(true)} title="Facture proforma, récapitulatif douanier, déclaration d’origine">
                Dossier export
              </button>
              )}
              {can('shareLink') && (
              <button
                className="btn"
                disabled={!!busy || !shareSpace}
                onClick={() => setShowShare(true)}
                title={shareSpace ? 'Lien en lecture seule pour votre client (PL, plan 3D, PDF)' : 'Activez la sauvegarde en ligne (Réglages) pour créer un lien client'}
              >
                Lien client
              </button>
              )}
            </div>
          </div>

          {plGrundfos && plSmart && (
            <ComparePanel
              g={plGrundfos}
              s={plSmart}
              selected={proposal}
              onSelect={(p) => {
                setProposal(p);
                toast(p === 'grundfos' ? 'Proposition « Selon Grundfos » affichée' : 'Proposition optimisée affichée');
              }}
              busy={!!busy}
              mode={settings.transportMode ?? 'sea'}
              onExportComparison={() => void run('cmp', () => exportComparisonPdf(plGrundfos, plSmart, settings))}
            />
          )}

          <div className="reliability">
            <b>
              Fiabilité de la proposition <InfoTip k="reliability" />
            </b>
            <div className="rel-items">
              {reliability.observed > 0 && <span><ConfidenceChip c="observed" /> <span>{reliability.observed} ligne(s) identique(s) à des envois réels</span></span>}
              {reliability.interpolated > 0 && <span><ConfidenceChip c="interpolated" /> <span>{reliability.interpolated} calculée(s) entre deux envois réels</span></span>}
              {reliability.estimated > 0 && <span><ConfidenceChip c="estimated" /> <span>{reliability.estimated} extrapolée(s) d'un seul envoi : à vérifier</span></span>}
              {reliability.mixed > 0 && <span><ConfidenceChip c="mixed" /> <span>{reliability.mixed} vue(s) seulement en colis mixte : à vérifier</span></span>}
              {reliability.manual > 0 && <span><ConfidenceChip c="manual" /> <span>{reliability.manual} selon votre fiche corrigée</span></span>}
              {suspicious > 0 && (
                <span>
                  <span className="chip chip-danger">données suspectes</span>
                  <span>{suspicious} article(s) aux valeurs impossibles : poids ou dimensions à corriger avant envoi</span>
                </span>
              )}
              {unknown > 0 && <span><span className="chip-with-tip"><span className="chip chip-danger">introuvable</span><InfoTip k="unknown" /></span> <span>{unknown} article(s) sans données : ni poids ni colis</span></span>}
            </div>
          </div>

          {deferredPl && (
            <PackingListView
              pl={deferredPl}
              accent={settings.accent || DEFAULT_ACCENT}
              logo={logoInfo}
              stacking={settings.stacking !== false && !settings.labels?.noStack}
              onToggleStack={(p, b) => {
                const k = stackKey(p);
                const next = { ...stackOv };
                // revenir à la règle automatique : on n'enregistre rien
                if (b === isStackable({ type: p.type })) delete next[k];
                else next[k] = b;
                setStackOv(next);
              }}
            />
          )}
          <TransportPanel
            pl={deferredPl ?? plStacked ?? pl}
            accent={settings.accent || DEFAULT_ACCENT}
            logo={logoInfo}
            mode={settings.transportMode ?? 'sea'}
            setMode={(m) => setSettings({ ...settings, transportMode: m })}
            rates={settings.freightRates}
            setRates={(r) => setSettings({ ...settings, freightRates: r })}
            showCost={can('freight')}
            stacking={settings.stacking !== false && !settings.labels?.noStack}
            setStacking={(b) => setSettings({ ...settings, stacking: b })}
            canEditRates={can('freightRates')}
          />
        </>
      )}

      {showShare && pl && shareSpace && <ShareLinkDialog pl={plStacked ?? pl} settings={settings} space={shareSpace} onClose={() => setShowShare(false)} />}
      {showExport && pl && (
        <ExportDocsDialog
          pl={plStacked ?? pl}
          catalog={catalog}
          settings={settings}
          setSettings={setSettings}
          saveToCatalog={canEdit ? setCatalog : undefined}
          toast={toast}
          onClose={() => setShowExport(false)}
        />
      )}
      {order && <OrderImportDialog fileName={order.fileName} lines={order.lines} onAdd={addOrder} onClose={() => setOrder(null)} />}
      {showLabels && pl && <LabelsDialog pl={plStacked ?? pl} settings={settings} setSettings={setSettings} onClose={() => setShowLabels(false)} />}
      {quick && (
        <QuickItemForm
          item={quick.item}
          code={quick.code}
          pn={quick.pn}
          onClose={() => setQuick(null)}
          onSave={(saved) => {
            const before = catalog;
            const exists = catalog.some((c) => c.id === saved.id);
            setCatalog(exists ? catalog.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...catalog]);
            setQuick(null);
            notify(exists ? 'Dimensions enregistrées dans la fiche article' : 'Article ajouté à la base', () => setCatalog(before));
          }}
        />
      )}
    </div>
  );
}
