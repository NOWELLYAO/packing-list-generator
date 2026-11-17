import type { PackingList } from '../types';
import { freightInfo } from '../lib/freight';

const fmt = (n: number, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function FreightPanel({ pl }: { pl: PackingList }) {
  const f = freightInfo(pl);
  return (
    <section>
      <h3 className="section-title">Transport</h3>
      <div className="freight">
        <div className="freight-card">
          <small>Aérien – poids taxable</small>
          <b>{fmt(f.airChargeableKg)} kg</b>
          <span className="hint">max(brut ; volume × 167)</span>
        </div>
        <div className="freight-card">
          <small>Routier / express – poids taxable</small>
          <b>{fmt(f.roadChargeableKg)} kg</b>
          <span className="hint">max(brut ; volume × 333)</span>
        </div>
        <div className="freight-card">
          <small>Maritime groupage – unités payantes</small>
          <b>{fmt(f.seaRevenueTon, 2)} UP</b>
          <span className="hint">max(tonnes ; m³)</span>
        </div>
      </div>
      <div className="containers">
        {f.containers.map((c) => {
          const pct = Math.max(c.volumePct, c.weightPct, c.floorPct);
          return (
            <div key={c.name} className="container-row">
              <span className="c-name">{c.name}</span>
              <div className="bar">
                <div className={`bar-fill ${pct > 100 ? 'over' : pct > 85 ? 'tight' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <span className="c-pct">{pct > 100 ? 'insuffisant' : `${fmt(pct)} %`}</span>
            </div>
          );
        })}
        <p className="hint">
          Occupation estimée = le plus contraignant entre volume, charge utile et surface au sol (colis non gerbés). Facteurs
          usuels à confirmer avec votre transitaire.
        </p>
      </div>
      {f.alerts.length > 0 && (
        <ul className="alerts">
          {f.alerts.map((a, i) => (
            <li key={i}>⚠️ {a}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
