import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { CatalogItem, HistoryEntry, RequestLine, Settings } from '../types';
import { chooseVariant, findItem, generatePackingList, parsePastedRequests } from '../lib/generate';
import { exportComparisonPdf, exportPackingListPdf, exportPackingListXlsx, exportRequestTemplate, sharePackingListPdf } from '../lib/exporters';
import ComparePanel, { type Proposal } from './ComparePanel';
import { uid } from '../lib/normalize';
import { detectHeaderRow, detectMapping } from '../lib/detect';
import { parseNumber } from '../lib/parseValues';
import ArticleSearch from './ArticleSearch';
import PackingListView from './PackingListView';
import FreightPanel from './FreightPanel';
import QuickItemForm from './QuickItemForm';
import LoadPlanPanel from './LoadPlanPanel';
import InfoTip from './InfoTip';
import type { GlossaryKey } from '../lib/glossary';
import { DEFAULT_ACCENT } from '../lib/exporters';
import { packLabel } from '../lib/i18n';
import { useSafety } from '../lib/safety';
import { usePersistent } from '../lib/storage';
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

export default function GeneratorPanel({ catalog, setCatalog, settings, setSettings, lines, setLines, consolidate, setConsolidate, onSaved, toast }: Props) {
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ item: CatalogItem | null; code: string; pn: string } | null>(null);
  const lang = settings.lang ?? 'fr';
  const { ask, notify } = useSafety();
  const fileRef = useRef<HTMLInputElement>(null);
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

  const addItem = (code: string, pn: string, quantity = 1) => {
    const existing = lines.find((l) => (code && l.code === code) || (pn && l.pn === pn && l.pn));
    if (existing) {
      setLines(lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + quantity } : l)));
      toast(`Quantité augmentée : ${code || pn}`);
    } else setLines([...lines, { id: uid(), code, pn, quantity }]);
  };
  const setQty = (id: string, q: number) => setLines(lines.map((l) => (l.id === id ? { ...l, quantity: Math.max(0, q) } : l)));
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
        return { ...p, code: it ? it.code : p.code, pn: it ? it.pn : p.pn, id: uid() };
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
      if ((code || pn) && qty > 0) parsed.push({ id: uid(), code, pn, quantity: qty });
    }
    setLines([...lines, ...parsed]);
    toast(`${parsed.length} ligne(s) importée(s)`);
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (!pl) return;
    setBusy(label);
    try {
      await fn();
      onSaved({ id: uid(), createdAt: new Date().toISOString(), reference: '', requests: active, totals: pl.totals });
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
  const reliability = {
    observed: byConf('observed'),
    interpolated: byConf('interpolated'),
    estimated: byConf('estimated'),
    mixed: byConf('mixed'),
    manual: byConf('manual'),
  };

  return (
    <div className="page">
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
            const it = findItem(catalog, l.code, l.pn);
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
                      packing && (
                        <span className="chip">
                          {packing.qtyPerPackage} / {packLabel(packing.packageType, lang)}
                          {packing.length ? ` · ${packing.length}×${packing.width}×${packing.height}` : ''}
                        </span>
                      )
                    ) : (
                      <>
                        <span className="chip-with-tip">
                          <span className="chip chip-danger">introuvable dans la base</span>
                          <InfoTip k="unknown" />
                        </span>
                        <button className="link-btn" onClick={() => setQuick({ item: null, code: l.code, pn: l.pn })}>
                          Saisir dimensions et poids
                        </button>
                      </>
                    )}
                    {choice && l.quantity > 0 && <ConfidenceChip c={choice.confidence} />}
                    {it && choice && ['estimated', 'mixed', 'manual'].includes(choice.confidence) && (
                      <button className="link-btn" onClick={() => setQuick({ item: it, code: it.code, pn: it.pn })}>
                        {choice.confidence === 'manual' ? 'Modifier les dimensions' : 'Saisir les dimensions réelles'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="stepper">
                  <button onClick={() => setQty(l.id, l.quantity - 1)} aria-label="Moins">
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={l.quantity}
                    onChange={(e) => setQty(l.id, Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                  />
                  <button onClick={() => setQty(l.id, l.quantity + 1)} aria-label="Plus">
                    +
                  </button>
                </div>
                <button className="icon-btn" onClick={() => remove(l.id)} aria-label="Retirer" title="Retirer">
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
              <button className="btn primary" disabled={!!busy} onClick={() => run('pdf', () => exportPackingListPdf(pl, settings))}>
                {busy === 'pdf' ? '…' : 'PDF'}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => run('xlsx', () => exportPackingListXlsx(pl, settings))}>
                {busy === 'xlsx' ? '…' : 'Excel'}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => run('share', () => sharePackingListPdf(pl, settings))}>
                {busy === 'share' ? '…' : 'Partager'}
              </button>
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
              {unknown > 0 && <span><span className="chip-with-tip"><span className="chip chip-danger">introuvable</span><InfoTip k="unknown" /></span> <span>{unknown} article(s) sans données : ni poids ni colis</span></span>}
            </div>
          </div>

          <PackingListView pl={pl} accent={settings.accent || DEFAULT_ACCENT} />
          <LoadPlanPanel pl={pl} accent={settings.accent || DEFAULT_ACCENT} />
          <FreightPanel pl={pl} />
        </>
      )}

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
