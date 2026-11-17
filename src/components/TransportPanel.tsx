import { useMemo, useState } from 'react';
import type { PackingList } from '../types';
import { loadPlanDrawing, planLoad, VEHICLES, type TransportMode } from '../lib/loadPlan';
import { freightInfo } from '../lib/freight';
import { useLang } from '../lib/i18n';
import Drawing from './Drawing';
import InfoTip from './InfoTip';

const fmt = (n: number, d = 1) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

const MODES: { id: TransportMode; label: string }[] = [
  { id: 'sea', label: 'Maritime' },
  { id: 'road', label: 'Routier' },
  { id: 'air', label: 'Aérien' },
];

interface Props {
  pl: PackingList;
  accent: string;
  mode: TransportMode;
  setMode: (m: TransportMode) => void;
}

/**
 * Transport : un seul mode choisi, et tous les indicateurs en découlent
 * (plan de chargement, nombre de conteneurs ou de camions, poids taxable).
 */
export default function TransportPanel({ pl, accent, mode, setMode }: Props) {
  const lang = useLang();
  const [vehicle, setVehicle] = useState<string>('auto');
  const family = mode === 'road' ? 'road' : 'sea';
  const plan = useMemo(() => (mode === 'air' ? null : planLoad(pl.packages, vehicle, family)), [pl.packages, vehicle, family, mode]);
  const f = freightInfo(pl);
  const fleet = VEHICLES.filter((v) => v.family === family);

  return (
    <section>
      <h3 className="section-title">
        Transport <InfoTip k="vehicle" />
      </h3>
      <div className="segmented transport-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={mode === m.id ? 'on' : ''}
            onClick={() => {
              setMode(m.id);
              setVehicle('auto');
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Indicateurs propres au mode choisi */}
      <div className="plan-facts">
        {mode === 'sea' && (
          <>
            <div>
              <small>
                Conteneurs <InfoTip k="loadPlan" />
              </small>
              <b>{plan ? (lang === 'fr' ? plan.summary : plan.summaryEn) : '—'}</b>
            </div>
            <div>
              <small>
                Groupage (LCL) : unités payantes <InfoTip k="revenueTon" />
              </small>
              <b>{fmt(f.seaRevenueTon, 2)} UP</b>
            </div>
          </>
        )}
        {mode === 'road' && (
          <>
            <div>
              <small>
                Camions <InfoTip k="loadPlan" />
              </small>
              <b>{plan ? (lang === 'fr' ? plan.summary : plan.summaryEn) : '—'}</b>
            </div>
            <div>
              <small>
                Mètres de plancher (LDM) <InfoTip k="ldm" />
              </small>
              <b>{plan ? fmt(plan.ldm, 2) : '—'}</b>
            </div>
            <div>
              <small>
                Poids taxable messagerie <InfoTip k="roadChargeable" />
              </small>
              <b>{fmt(f.roadChargeableKg, 0)} kg</b>
            </div>
          </>
        )}
        {mode === 'air' && (
          <>
            <div>
              <small>
                Poids taxable aérien <InfoTip k="airChargeable" />
              </small>
              <b>{fmt(f.airChargeableKg, 0)} kg</b>
            </div>
            <div>
              <small>Poids réel / volumétrique</small>
              <b>
                {fmt(pl.totals.grossWeight, 0)} / {fmt(pl.totals.volume * 167, 0)} kg
              </b>
            </div>
            <div>
              <small>Colis le plus haut</small>
              <b>{f.tallest} cm</b>
            </div>
          </>
        )}
        {plan && (
          <div>
            <small>
              Plancher occupé <InfoTip k="floorUsed" />
            </small>
            <b>{plan.bins.map((b) => `${fmt(b.floorPct)} %`).join(' + ')}</b>
          </div>
        )}
      </div>

      {plan && (
        <>
          <div className="segmented vehicle-select">
            <button className={vehicle === 'auto' ? 'on' : ''} onClick={() => setVehicle('auto')}>
              Automatique
            </button>
            {fleet.map((v) => {
              const alt = plan.alternatives.find((a) => a.vehicle.id === v.id);
              return (
                <button
                  key={v.id}
                  className={vehicle === v.id ? 'on' : ''}
                  disabled={alt && !alt.feasible && alt.count === 0}
                  title={alt?.reason}
                  onClick={() => setVehicle(v.id)}
                >
                  {v.name}
                </button>
              );
            })}
          </div>
          {plan.bins.map((b, i) => (
            <div key={i} className="plan-card">
              <div className="plan-title">
                {lang === 'fr' ? b.vehicle.name : b.vehicle.nameEn}
                {plan.bins.length > 1 ? ` n° ${i + 1}` : ''} · {fmt(b.weight, 0)} kg · {b.placements.length} colis · {fmt(b.usedLength / 100, 2)} m
                utilisés
              </div>
              <Drawing pic={loadPlanDrawing(b, accent, lang, 640)} className="plan-svg" title="Plan de chargement" />
            </div>
          ))}
          {plan.unplaced.length > 0 && <div className="banner warn">Colis {plan.unplaced.join(', ')} : trop grand(s) pour ce véhicule.</div>}
          <p className="hint">
            Vue de dessus, colis posés au sol sans gerbage (hypothèse prudente), les plus lourds vers le fond. Point rouge :
            centre de gravité <InfoTip k="cog" />.
            {mode === 'sea' && ' En dessous d’environ 15 m³, le groupage (LCL) est souvent plus économique qu’un conteneur complet.'}
          </p>
        </>
      )}

      {[...(plan?.warnings ?? []), ...f.alerts.filter((a) => mode === 'air' || !/avion/.test(a))].length > 0 && (
        <ul className="alerts">
          {[...(plan?.warnings ?? []), ...f.alerts.filter((a) => mode === 'air' || !/avion/.test(a))].map((w, i) => (
            <li key={i}>⚠️ {w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
