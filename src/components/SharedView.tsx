import { useEffect, useMemo, useState } from 'react';
import { fetchShared, type SharedSnapshot } from '../lib/access';
import { LangContext, dimsText } from '../lib/i18n';
import { planLoad } from '../lib/loadPlan';
import { useLogoInfo } from '../lib/useLogoInfo';
import PackingListView from './PackingListView';
import LoadAnimation from './LoadAnimation';
import SafeBoundary from './SafeBoundary';

const nf = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Page publique du lien de suivi : PL en lecture seule, plan de chargement 3D, PDF */
export default function SharedView({ id }: { id: string }) {
  const [snap, setSnap] = useState<SharedSnapshot | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetchShared(id)
      .then(setSnap)
      .catch((e) => setErr(String(e?.code ?? '') === 'share_expired' ? 'Ce lien a expiré ou n’existe pas. Demandez un nouveau lien à votre fournisseur.' : 'Impossible de charger la Packing List pour le moment. Réessayez dans un instant.'));
  }, [id]);
  const logo = useLogoInfo(snap?.logo || undefined);
  const plan = useMemo(() => (snap && snap.transportMode !== 'air' ? planLoad(snap.pl.packages, 'auto', snap.transportMode === 'road' ? 'road' : 'sea') : null), [snap]);
  const [busy, setBusy] = useState(false);
  if (err) return <div className="login-screen"><div className="login-card"><h1>Packing List</h1><div className="form-error">{err}</div></div></div>;
  if (!snap) return <div className="login-screen"><div className="login-card" aria-busy="true"><h1>Packing List</h1><p className="hint">Chargement…</p></div></div>;
  const { pl } = snap;
  const settings = { companyName: snap.company, logo: snap.logo, accent: snap.accent, lang: snap.lang };
  const lang = snap.lang;
  return (
    <LangContext.Provider value={lang}>
      <div className="app shared-view">
        <header className="shared-head" style={{ borderTopColor: snap.accent }}>
          {snap.logo ? <img src={snap.logo} alt="" className="shared-logo" /> : <img src="/favicon.svg" alt="" className="shared-logo" />}
          <div>
            <h1>Packing List {pl.reference}</h1>
            <p className="hint">
              {snap.company && `${snap.company} · `}
              {new Date(pl.date).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')}
            </p>
          </div>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { exportPackingListPdf } = await import('../lib/exporters');
                await exportPackingListPdf(pl, settings as never);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '…' : lang === 'fr' ? 'Télécharger le PDF' : 'Download PDF'}
          </button>
        </header>
        <main className="page">
          <div className="totals-strip">
            <div><small>{lang === 'fr' ? 'Colis' : 'Packages'}</small><b>{pl.totals.packages}</b></div>
            <div><small>{lang === 'fr' ? 'Poids brut' : 'Gross weight'}</small><b>{nf(pl.totals.grossWeight)} kg</b></div>
            <div><small>{lang === 'fr' ? 'Poids net' : 'Net weight'}</small><b>{nf(pl.totals.netWeight)} kg</b></div>
            <div><small>Volume</small><b>{nf(pl.totals.volume, 3)} m³</b></div>
          </div>
          <PackingListView pl={pl} accent={snap.accent} logo={logo} />
          {plan && plan.bins.length > 0 && (
            <section>
              <h3 className="section-title">{lang === 'fr' ? 'Plan de chargement' : 'Loading plan'} : {lang === 'fr' ? plan.summary : plan.summaryEn}</h3>
              {plan.bins.slice(0, 3).map((b, i) => (
                <div key={i} className="plan-card">
                  <div className="plan-title">
                    {lang === 'fr' ? b.vehicle.name : b.vehicle.nameEn} · {nf(b.weight, 0)} kg · {b.placements.length} {lang === 'fr' ? 'colis' : 'packages'}
                  </div>
                  <SafeBoundary label="La vue 3D">
                    <LoadAnimation bin={b} lang={lang} logo={logo} />
                  </SafeBoundary>
                </div>
              ))}
            </section>
          )}
          <p className="hint small shared-foot">
            {lang === 'fr'
              ? `Document partagé en lecture seule le ${new Date(snap.createdAt).toLocaleDateString('fr-FR')}. Colis le plus grand : ${pl.packages.length ? dimsText(Math.max(...pl.packages.map((p) => p.length)), Math.max(...pl.packages.map((p) => p.width)), Math.max(...pl.packages.map((p) => p.height)), 'fr') : '—'} cm.`
              : `Read-only document shared on ${new Date(snap.createdAt).toLocaleDateString('en-GB')}.`}
          </p>
        </main>
      </div>
    </LangContext.Provider>
  );
}
