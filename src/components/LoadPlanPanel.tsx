import { useMemo, useState } from 'react';
import type { PackingList } from '../types';
import { loadPlanDrawing, planLoad, VEHICLES } from '../lib/loadPlan';
import { useLang } from '../lib/i18n';
import Drawing from './Drawing';
import InfoTip from './InfoTip';

const fmt = (n: number, d = 1) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Plan de chargement vue de dessus, recalculé en direct */
export default function LoadPlanPanel({ pl, accent }: { pl: PackingList; accent: string }) {
  const lang = useLang();
  const [mode, setMode] = useState<string>('auto');
  const plan = useMemo(() => planLoad(pl.packages, mode), [pl.packages, mode]);
  if (!plan) return null;
  const vName = lang === 'fr' ? plan.vehicle.name : plan.vehicle.nameEn;

  return (
    <section>
      <h3 className="section-title">
        Plan de chargement <InfoTip k="loadPlan" />
      </h3>
      <div className="segmented vehicle-select">
        <button className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>
          Automatique
        </button>
        {VEHICLES.map((v) => {
          const alt = plan.alternatives.find((a) => a.vehicle.id === v.id);
          return (
            <button
              key={v.id}
              className={mode === v.id ? 'on' : ''}
              disabled={alt && !alt.feasible && alt.count === 0}
              title={alt?.reason}
              onClick={() => setMode(v.id)}
            >
              {v.name}
            </button>
          );
        })}
      </div>

      <div className="plan-facts">
        <div>
          <small>
            Transport {mode === 'auto' ? 'proposé' : 'choisi'} <InfoTip k="vehicle" />
          </small>
          <b>
            {plan.bins.length} × {vName}
          </b>
        </div>
        <div>
          <small>Longueur utilisée</small>
          <b>{plan.bins.map((b) => `${fmt(b.usedLength / 100, 2)} m`).join(' + ')}</b>
        </div>
        <div>
          <small>
            Plancher occupé <InfoTip k="floorUsed" />
          </small>
          <b>{plan.bins.map((b) => `${fmt(b.floorPct)} %`).join(' + ')}</b>
        </div>
        <div>
          <small>
            Mètres de plancher (LDM) <InfoTip k="ldm" />
          </small>
          <b>{fmt(plan.ldm, 2)}</b>
        </div>
      </div>

      {plan.bins.map((b, i) => (
        <div key={i} className="plan-card">
          {plan.bins.length > 1 && (
            <div className="plan-title">
              {vName} n° {i + 1} · {fmt(b.weight, 0)} kg · {b.placements.length} colis
            </div>
          )}
          <Drawing pic={loadPlanDrawing(plan.vehicle, b, accent, lang, 640)} className="plan-svg" title="Plan de chargement" />
        </div>
      ))}

      {plan.unplaced.length > 0 && (
        <div className="banner warn">
          Colis {plan.unplaced.join(', ')} : trop grand(s) pour ce véhicule.
        </div>
      )}
      {plan.warnings.length > 0 && (
        <ul className="alerts">
          {plan.warnings.map((w, i) => (
            <li key={i}>⚠️ {w}</li>
          ))}
        </ul>
      )}
      <p className="hint">
        Vue de dessus, colis posés au sol sans gerbage (hypothèse prudente). Les colis lourds sont placés vers le fond ; le
        point rouge indique le centre de gravité <InfoTip k="cog" />. Le plan figure aussi dans le PDF.
      </p>
    </section>
  );
}
