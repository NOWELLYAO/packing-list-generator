import type { PackingList } from '../types';
import BoxIcon from './BoxIcon';

const fmt = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Aperçu du colisage et des articles (mis à jour en direct) */
export default function PackingListView({ pl }: { pl: PackingList }) {
  return (
    <div className="pl-view">
      <section>
        <h3 className="section-title">
          Colisage <span className="count">{pl.packages.length}</span>
        </h3>
        <div className="pkg-grid">
          {pl.packages.map((p) => (
            <article key={p.no} className={`pkg-card ${p.basis}`}>
              <div className="pkg-head">
                <BoxIcon l={p.length} w={p.width} h={p.height} />
                <div>
                  <div className="pkg-no">Colis {p.no}</div>
                  <div className="pkg-type">
                    {p.type}
                    {p.basis === 'grouped' && <span className="chip chip-accent">groupé</span>}
                    {p.basis === 'partial' && <span className="chip chip-warn">incomplet</span>}
                  </div>
                </div>
              </div>
              <div className="pkg-dims">{p.length ? `${p.length} × ${p.width} × ${p.height} cm` : 'Dimensions inconnues'}</div>
              <div className="pkg-stats">
                <span>
                  <small>Brut</small>
                  {fmt(p.grossWeight)} kg
                </span>
                <span>
                  <small>Net</small>
                  {fmt(p.netWeight)} kg
                </span>
                <span>
                  <small>Volume</small>
                  {fmt(p.volume, 3)} m³
                </span>
              </div>
              <div className="pkg-contents">
                {p.contents.map((c, i) => (
                  <span key={i} className="chip">
                    {c.code} × {c.quantity}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h3 className="section-title">Articles</h3>
        <div className="table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Code / PN</th>
                <th>Désignation</th>
                <th className="num">Qté</th>
                <th>Colis</th>
                <th className="num">Net (kg)</th>
                <th className="num">Brut (kg)</th>
                <th>Orig.</th>
              </tr>
            </thead>
            <tbody>
              {pl.lines.map((l) => (
                <tr key={l.lineNo} className={!l.found ? 'row-miss' : l.warning ? 'row-warn' : ''}>
                  <td>{l.lineNo}</td>
                  <td className="mono">{l.code === l.pn || !l.pn ? l.code : `${l.code} / ${l.pn}`}</td>
                  <td>{l.description}</td>
                  <td className="num">{l.quantity}</td>
                  <td>{l.cases}</td>
                  <td className="num">{fmt(l.netWeight)}</td>
                  <td className="num">{fmt(l.grossWeight)}</td>
                  <td>{l.origin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Le poids brut par article comprend son emballage d'origine ; la tare des cartons et palettes de regroupement
          n'apparaît que dans le colisage.
        </p>
      </section>
    </div>
  );
}
