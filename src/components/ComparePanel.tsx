import type { PackingList } from '../types';
import { comparePL } from '../lib/compare';
import { useLang } from '../lib/i18n';
import InfoTip from './InfoTip';

export type Proposal = 'grundfos' | 'smart';

interface Props {
  g: PackingList;
  s: PackingList;
  selected: Proposal;
  onSelect: (p: Proposal) => void;
  onExportComparison: () => void;
  busy: boolean;
}

const nf = (n: number, d: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Les deux propositions côte à côte, avec les écarts et ce qui change */
export default function ComparePanel({ g, s, selected, onSelect, onExportComparison, busy }: Props) {
  const lang = useLang();
  const c = comparePL(g, s, lang);
  const identical = c.rows.every((r) => Math.abs(r.g - r.s) < 1e-6) && c.changes.length === 0;

  return (
    <section className="compare">
      <div className="compare-head">
        <h3 className="section-title">
          Deux propositions <InfoTip k="proposals" />
        </h3>
        <button className="btn small ghost" onClick={onExportComparison} disabled={busy}>
          PDF comparatif
        </button>
      </div>

      <div className="proposal-cards">
        {(
          [
            ['grundfos', 'Selon Grundfos', 'Emballages réellement utilisés par Grundfos, sans recalcul ni regroupement', g],
            ['smart', 'Optimisée', 'Meilleur emballage, palettes incomplètes recalculées, petits articles regroupés', s],
          ] as const
        ).map(([key, title, sub, pl]) => (
          <button key={key} className={`proposal-card ${selected === key ? 'on' : ''}`} onClick={() => onSelect(key)}>
            <span className="pc-top">
              <span className="pc-radio" aria-hidden />
              <b>{title}</b>
              {selected === key && <span className="chip chip-accent">affichée</span>}
            </span>
            <span className="pc-sub">{sub}</span>
            <span className="pc-kpis">
              <span>
                <small>Colis</small>
                {pl.totals.packages}
              </span>
              <span>
                <small>Volume</small>
                {nf(pl.totals.volume, 3)} m³
              </span>
              <span>
                <small>Brut</small>
                {nf(pl.totals.grossWeight, 0)} kg
              </span>
            </span>
          </button>
        ))}
      </div>

      {identical ? (
        <p className="hint">Les deux propositions sont identiques pour ces articles : tout correspond à des envois Grundfos réels.</p>
      ) : (
        <>
          <div className="table-wrap compare-table">
            <table>
              <thead>
                <tr>
                  <th />
                  <th className="num">Selon Grundfos</th>
                  <th className="num">Optimisée</th>
                  <th className="num col-delta">Écart</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r) => {
                  const d = r.s - r.g;
                  const pct = r.g ? (d / r.g) * 100 : 0;
                  const same = Math.abs(d) < Math.pow(10, -r.decimals) / 2;
                  const good = r.lowerIsBetter ? d < 0 : d > 0;
                  return (
                    <tr key={r.key}>
                      <td>
                        <span className="lbl-long">{r.label}</span>
                        <span className="lbl-short">{r.short}</span>
                      </td>
                      <td className="num">
                        {nf(r.g, r.decimals)} {r.unit}
                      </td>
                      <td className="num">
                        {nf(r.s, r.decimals)} {r.unit}
                        {!same && (
                          <span className={`delta-inline ${good ? 'good' : 'bad'}`}>
                            {d > 0 ? '+' : '−'}
                            {nf(Math.abs(d), r.decimals)}
                            {r.g ? ` (${pct > 0 ? '+' : '−'}${nf(Math.abs(pct), 0)} %)` : ''}
                          </span>
                        )}
                      </td>
                      <td className={`num delta col-delta ${same ? '' : good ? 'good' : 'bad'}`}>
                        {same ? '=' : `${d > 0 ? '+' : '−'}${nf(Math.abs(d), r.decimals)}${r.unit ? ' ' + r.unit : ''}`}
                        {!same && r.g ? <small> ({pct > 0 ? '+' : '−'}{nf(Math.abs(pct), 0)} %)</small> : null}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>
                    <span className="lbl-long">Transport proposé</span>
                    <span className="lbl-short">Transport</span>
                  </td>
                  <td className="num">{c.transportG}</td>
                  <td className="num">{c.transportS}</td>
                  <td className="num delta col-delta">{c.transportG === c.transportS ? '=' : '≠'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {c.changes.length > 0 && (
            <div className="changes">
              <b>Ce qui change dans la proposition optimisée</b>
              <ul>
                {c.changes.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="hint">
            En vert : l'optimisée fait mieux ; en rouge : elle fait moins bien (par exemple un peu plus de poids brut à cause
            de la palette de regroupement). Choisissez la proposition à afficher et à exporter en touchant sa carte.
          </p>
        </>
      )}
    </section>
  );
}
