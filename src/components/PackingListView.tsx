import type { PackingList } from '../types';
import { packLabel, useLang } from '../lib/i18n';
import { formatNos, groupIdentical, packageDrawing, refScale, scaleStrip, type LogoInfo } from '../lib/drawing';
import Drawing from './Drawing';
import InfoTip from './InfoTip';

const fmt = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Aperçu du colisage et des articles (mis à jour en direct) */
export default function PackingListView({ pl, accent, logo }: { pl: PackingList; accent: string; logo?: LogoInfo }) {
  const descOf = new Map(pl.lines.map((l) => [l.code, l.description] as const));
  const lang = useLang();
  const labels = { cm: 'cm', kg: 'kg', packageWord: lang === 'fr' ? 'Colis' : 'Package', locale: lang === 'fr' ? 'fr-FR' : 'en-GB' };
  const refK = refScale(pl.packages);
  const strip = scaleStrip(pl.packages, accent, labels, 640);
  return (
    <div className="pl-view">
      <section>
        <h3 className="section-title">
          Colisage <span className="count">{pl.packages.length}</span>
        </h3>
        {strip.shapes.length > 0 && pl.packages.length > 1 && (
          <div className="scale-strip">
            <Drawing pic={strip} className="strip-svg" title="Vue à l'échelle" />
            <span className="hint">
              Vue de face à la même échelle (repère : silhouette de 1,80 m) <InfoTip k="scaleView" />
            </span>
          </div>
        )}
        <div className="pkg-grid">
          {groupIdentical(pl.packages).map(({ first: p, nos }) => (
            <article key={p.no} className={`pkg-card ${p.basis}${p.dimCheck ? ' dimcheck' : ''}`}>
              <div className="pkg-head">
                <div>
                  <div className="pkg-no">
                    Colis {nos.length > 1 ? formatNos(nos) : p.no}
                    {nos.length > 1 && <span className="chip chip-accent">{nos.length} colis identiques</span>}
                  </div>
                  <div className="pkg-type">
                    {packLabel(p.type, lang)}
                    {p.basis === 'grouped' && p.groupSource === 'history' && (
                      <span className="chip-with-tip">
                        <span className="chip chip-ok">comme Grundfos</span>
                        <InfoTip k="groupedHistory" />
                      </span>
                    )}
                    {p.basis === 'grouped' && p.groupSource !== 'history' && (
                      <span className="chip-with-tip">
                        <span className="chip chip-accent">groupé</span>
                        <InfoTip k="grouped" />
                      </span>
                    )}
                    {p.dimCheck && (
                      <span className="chip-with-tip">
                        <span className="chip chip-check">≈ dimensions à vérifier</span>
                        <InfoTip k="dimCheck" />
                      </span>
                    )}
                    {p.basis === 'partial' && (
                      <span className="chip-with-tip">
                        <span className="chip chip-warn">incomplet</span>
                        <InfoTip k="partial" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {p.length > 0 ? (
                <Drawing
                  pic={packageDrawing(p, accent, labels, nos.length > 1 ? (lang === 'fr' ? 'Chaque colis' : 'Each package') : undefined, refK, logo)}
                  className="pkg-svg"
                  title={`Colis ${p.no}`}
                />
              ) : (
                <div className="pkg-dims">Dimensions inconnues</div>
              )}
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
                  <span key={i} className="chip content-chip">
                    <b>
                      {c.code} × {c.quantity}
                    </b>
                    {descOf.get(c.code) && <span className="content-desc">{descOf.get(c.code)}</span>}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h3 className="section-title">Articles</h3>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tableau (défilement horizontal)">
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
