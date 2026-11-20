import { useMemo, useState } from 'react';
import type { CatalogItem, HistoryEntry } from '../types';
import type { AccuracyRecord } from '../lib/realCheck';
import { dashboardData, type Period } from '../lib/dashboard';

interface Props {
  history: HistoryEntry[];
  catalog: CatalogItem[];
  accuracy: AccuracyRecord[];
  accent: string;
}

const nf = (n: number, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const MODE_LABEL = { sea: 'Maritime', road: 'Routier', air: 'Aérien' } as const;
const PERIODS: { id: Period; label: string }[] = [
  { id: '3m', label: '3 mois' },
  { id: '12m', label: '12 mois' },
  { id: 'all', label: 'Tout' },
];

/** Barres verticales, une seule série : hauteur = valeur, info-bulle au survol */
function Bars({ data, unit, accent, digits = 0 }: { data: { label: string; value: number; note?: string }[]; unit: string; accent: string; digits?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 190;
  const padL = 44;
  const padB = 26;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const bw = (W - padL) / data.length;
  const y = (v: number) => H - padB - (v / top) * (H - padB - 10);
  const every = Math.ceil(data.length / 12);
  return (
    <div className="dash-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Graphique en barres, ${unit}`}>
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.35 : 0.1} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity={0.6}>
              {nf(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(0, H - padB - y(d.value));
          const x = padL + i * bw + bw * 0.18;
          const w = Math.max(2, bw * 0.64);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}>
              {/* zone de survol plus large que la barre */}
              <rect x={padL + i * bw} y={0} width={bw} height={H - padB} fill="transparent" />
              {h > 0 && <path d={roundedTop(x, y(d.value), w, h, Math.min(4, w / 2, h))} fill={accent} opacity={hover === null || hover === i ? 1 : 0.45} />}
              {i % every === 0 && (
                <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor" opacity={0.7}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="dash-tip" style={{ left: `${((padL + (hover + 0.5) * bw) / W) * 100}%` }}>
          <b>{data[hover].label}</b>
          <span>
            {nf(data[hover].value, digits)} {unit}
          </span>
          {data[hover].note && <small>{data[hover].note}</small>}
        </div>
      )}
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
/** barre à coins supérieurs arrondis, posée sur la ligne de base */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Courbe de précision (score sur 100, une PL réelle = un point) */
function ScoreLine({ data, accent }: { data: { label: string; score: number; date: string }[]; accent: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 170;
  const padL = 34;
  const padB = 20;
  const x = (i: number) => padL + (data.length === 1 ? (W - padL) / 2 : (i / (data.length - 1)) * (W - padL - 10));
  const y = (v: number) => H - padB - (v / 100) * (H - padB - 10);
  const d = data.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.score)}`).join('');
  return (
    <div className="dash-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Précision sur les PL réelles, score sur 100">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.35 : 0.1} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity={0.6}>
              {v}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke={accent} strokeWidth={2} />
        {data.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}>
            <circle cx={x(i)} cy={y(p.score)} r={12} fill="transparent" />
            <circle cx={x(i)} cy={y(p.score)} r={hover === i ? 5 : 4} fill={accent} stroke="var(--card, #fff)" strokeWidth={2} />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="dash-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{data[hover].label}</b>
          <span>{data[hover].score} / 100</span>
          <small>{new Date(data[hover].date).toLocaleDateString('fr-FR')}</small>
        </div>
      )}
    </div>
  );
}

/** Tableau de bord : activité d'expédition, articles les plus envoyés, modes de transport, précision */
export default function DashboardPanel({ history, catalog, accuracy, accent }: Props) {
  const [period, setPeriod] = useState<Period>('12m');
  const [measure, setMeasure] = useState<'gross' | 'volume' | 'count'>('gross');
  const d = useMemo(() => dashboardData(history, catalog, accuracy, period), [history, catalog, accuracy, period]);
  const unit = measure === 'gross' ? 'kg' : measure === 'volume' ? 'm³' : 'PL';
  return (
    <div className="page dashboard">
      <div className="page-head">
        <h2 className="section-title">Tableau de bord</h2>
        <div className="segmented" role="group" aria-label="Période">
          {PERIODS.map((p) => (
            <button key={p.id} className={period === p.id ? 'on' : ''} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {!d.count ? (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <p>
            <b>Pas encore d’expédition sur cette période.</b>
            <br />
            Chaque PL exportée (PDF, Excel, partage) alimente le tableau de bord.
          </p>
        </div>
      ) : (
        <>
          <div className="totals-strip">
            <div>
              <small>PL expédiées</small>
              <b>{nf(d.count)}</b>
            </div>
            <div>
              <small>Poids brut</small>
              <b>{d.gross >= 10000 ? `${nf(d.gross / 1000, 1)} t` : `${nf(d.gross)} kg`}</b>
            </div>
            <div>
              <small>Volume</small>
              <b>{nf(d.volume, 1)} m³</b>
            </div>
            <div>
              <small>Colis</small>
              <b>{nf(d.packages)}</b>
            </div>
            <div>
              <small>Poids moyen par PL</small>
              <b>{nf(d.gross / d.count)} kg</b>
            </div>
          </div>

          <section className="dash-card">
            <div className="dash-card-head">
              <h3>Activité par mois</h3>
              <div className="segmented small" role="group" aria-label="Mesure">
                {(
                  [
                    ['gross', 'Poids'],
                    ['volume', 'Volume'],
                    ['count', 'Nombre de PL'],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} className={measure === k ? 'on' : ''} onClick={() => setMeasure(k)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <Bars
              accent={accent}
              unit={unit}
              digits={measure === 'volume' ? 2 : 0}
              data={d.months.map((m) => ({ label: m.label, value: m[measure], note: `${m.count} PL · ${nf(m.gross)} kg · ${nf(m.volume, 2)} m³` }))}
            />
          </section>

          <div className="dash-grid">
            <section className="dash-card">
              <h3>Articles les plus expédiés</h3>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Articles les plus expédiés">
                <table className="pl-table compact">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th className="num">PL</th>
                      <th className="num">Quantité</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.top.map((t) => (
                      <tr key={t.code}>
                        <td>
                          <span className="mono">{t.code}</span> {t.description}
                        </td>
                        <td className="num">{t.pls}</td>
                        <td className="num">{nf(t.quantity, t.quantity % 1 ? 2 : 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="dash-card">
              <h3>Modes de transport</h3>
              <div className="dash-modes">
                {d.modes.map((m) => (
                  <div key={m.mode}>
                    <div className="dash-mode-row">
                      <span>{MODE_LABEL[m.mode]}</span>
                      <span>
                        {m.count} PL · {nf(m.gross)} kg
                      </span>
                    </div>
                    <div className="dash-meter" aria-hidden>
                      <span style={{ width: `${(m.count / d.count) * 100}%`, background: accent }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      <section className="dash-card">
        <h3>Précision de l’application sur vos PL réelles</h3>
        {d.accuracy.length ? (
          <>
            <p className="hint small">
              Chaque point est une PL Grundfos importée : l’application a d’abord proposé son colisage à l’aveugle, puis a appris de la PL réelle. Moyenne :{' '}
              <b>{Math.round(d.accuracy.reduce((s, a) => s + a.score, 0) / d.accuracy.length)} / 100</b>.
            </p>
            <ScoreLine data={d.accuracy} accent={accent} />
          </>
        ) : (
          <p className="hint">Importez les PL Grundfos que vous recevez (onglet Importer) : leur précision s’affichera ici.</p>
        )}
      </section>
    </div>
  );
}
