import { useMemo, useState } from 'react';
import type { FreightRates, PackingList } from '../types';
import { DEFAULT_RATES, freightOptions } from '../lib/freight';
import { VEHICLES } from '../lib/loadPlan';

interface Props {
  pl: PackingList;
  rates?: FreightRates;
  setRates: (r: FreightRates) => void;
  onPickMode: (m: 'sea' | 'road' | 'air') => void;
}

const money = (n: number, cur: string) => {
  try {
    return n.toLocaleString('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: 0 });
  } catch {
    return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${cur}`;
  }
};

/** Coût estimé de l'envoi selon le mode de transport, à partir des tarifs de l'utilisateur */
export default function FreightCost({ pl, rates, setRates, onPickMode }: Props) {
  const r = rates ?? DEFAULT_RATES;
  const opts = useMemo(() => freightOptions(pl, r), [pl, r]);
  const [edit, setEdit] = useState(false);
  const best = opts.find((o) => !o.impossible);
  const num = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);
  const set = (patch: Partial<FreightRates>) => setRates({ ...r, ...patch, custom: true });
  const field = (label: string, value: number, on: (n: number) => void) => (
    <label className="rate-field" key={label}>
      <span>{label}</span>
      <input type="number" min={0} step="any" inputMode="decimal" value={value} onChange={(e) => on(num(e.target.value))} />
    </label>
  );
  return (
    <div className="freight-cost">
      <h4 className="sub-title">Coût estimé du transport</h4>
      {!r.custom && <p className="hint small">Tarifs indicatifs : saisissez ceux de votre transitaire pour un chiffrage fiable.</p>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Coûts par mode de transport">
        <table className="pl-table compact">
          <tbody>
            {opts.map((o) => (
              <tr key={o.id} className={o.impossible ? 'row-muted' : o === best ? 'row-best' : ''}>
                <td>
                  <button className="link-btn" onClick={() => onPickMode(o.mode)} title="Afficher ce mode">
                    {o.label}
                  </button>
                  {o === best && <span className="chip chip-ok">le moins cher</span>}
                  <div className="hint small">{o.impossible ? `Impossible : ${o.impossible}` : o.detail}</div>
                </td>
                <td className="num">
                  <b>{money(o.cost, r.currency)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn small ghost" onClick={() => setEdit((e) => !e)}>
        {edit ? 'Fermer les tarifs' : 'Modifier les tarifs'}
      </button>
      {edit && (
        <div className="rates-form">
          <label className="rate-field">
            <span>Devise</span>
            <select value={r.currency} onChange={(e) => set({ currency: e.target.value })}>
              {['EUR', 'USD', 'XOF', 'XAF', 'GHS', 'MAD', 'GBP'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Aérien</legend>
            {field('Prix / kg taxable', r.airPerKg, (n) => set({ airPerKg: n }))}
            {field('Minimum', r.airMin, (n) => set({ airMin: n }))}
          </fieldset>
          <fieldset>
            <legend>Maritime</legend>
            {field('Groupage : prix / UP (t ou m³)', r.lclPerUp, (n) => set({ lclPerUp: n }))}
            {field('Groupage : minimum', r.lclMin, (n) => set({ lclMin: n }))}
            {VEHICLES.filter((v) => v.family === 'sea').map((v) =>
              field(v.name, r.container[v.id] ?? 0, (n) => set({ container: { ...r.container, [v.id]: n } })),
            )}
          </fieldset>
          <fieldset>
            <legend>Routier</legend>
            {field('Messagerie : prix / kg taxable', r.courierPerKg, (n) => set({ courierPerKg: n }))}
            {field('Messagerie : minimum', r.courierMin, (n) => set({ courierMin: n }))}
            {VEHICLES.filter((v) => v.family === 'road').map((v) =>
              field(v.name, r.truck[v.id] ?? 0, (n) => set({ truck: { ...r.truck, [v.id]: n } })),
            )}
          </fieldset>
          <button className="btn small ghost" onClick={() => setRates({ ...DEFAULT_RATES })}>
            Revenir aux tarifs indicatifs
          </button>
        </div>
      )}
    </div>
  );
}
