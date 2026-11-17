import type { PackingList, PLPackage } from '../types';

const fmt = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

const BASIS: Record<PLPackage['basis'], string> = {
  reference: '',
  partial: 'Colis incomplet : hauteur/poids réduits',
  grouped: 'Petits articles regroupés',
};

export default function PackingListView({ pl }: { pl: PackingList }) {
  const problems = pl.lines.filter((l) => l.warning);
  return (
    <div className="pl-doc printable">
      <h1>PACKING LIST</h1>
      <p className="pl-date">Date : {new Date(pl.date).toLocaleDateString('fr-FR')}</p>

      <div className="totals">
        <div>
          <span>Colis</span>
          <b>{pl.totals.packages}</b>
        </div>
        <div>
          <span>Poids net</span>
          <b>{fmt(pl.totals.netWeight)} kg</b>
        </div>
        <div>
          <span>Poids brut</span>
          <b>{fmt(pl.totals.grossWeight)} kg</b>
        </div>
        <div>
          <span>Volume</span>
          <b>{fmt(pl.totals.volume, 3)} m³</b>
        </div>
      </div>

      {problems.length > 0 && (
        <div className="warn no-print">
          ⚠️ {problems.length} ligne(s) à vérifier :{' '}
          {problems.map((p) => `#${p.lineNo} ${p.code || p.pn} (${p.warning})`).join(' · ')}
        </div>
      )}

      <h3>Colisage</h3>
      <div className="table-wrap">
        <table className="pl-table">
          <thead>
            <tr>
              <th>Colis N°</th>
              <th>Emballage</th>
              <th>Dimensions L×l×H (cm)</th>
              <th>Volume (m³)</th>
              <th>Net (kg)</th>
              <th>Brut (kg)</th>
              <th>Contenu</th>
            </tr>
          </thead>
          <tbody>
            {pl.packages.map((p) => (
              <tr key={p.no} className={p.basis !== 'reference' ? 'row-calc' : ''}>
                <td>{p.no}</td>
                <td>{p.type}</td>
                <td title={BASIS[p.basis]}>
                  {p.length ? `${p.length} × ${p.width} × ${p.height}` : '—'}
                  {p.basis !== 'reference' && <span className="tag">{p.basis === 'grouped' ? 'groupé' : 'incomplet'}</span>}
                </td>
                <td className="num">{fmt(p.volume, 3)}</td>
                <td className="num">{fmt(p.netWeight)}</td>
                <td className="num">{fmt(p.grossWeight)}</td>
                <td className="contents">{p.contents.map((c) => `${c.code} × ${c.quantity}`).join(', ')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>TOTAL : {pl.totals.packages} colis</td>
              <td className="num">{fmt(pl.totals.volume, 3)}</td>
              <td className="num">{fmt(pl.totals.netWeight)}</td>
              <td className="num">{fmt(pl.totals.grossWeight)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <h3>Articles</h3>
      <div className="table-wrap">
        <table className="pl-table">
          <thead>
            <tr>
              <th>N°</th>
              <th>Code / PN</th>
              <th>Désignation</th>
              <th>Qté</th>
              <th>Colis N°</th>
              <th>Net (kg)</th>
              <th>Brut (kg)*</th>
              <th>Origine</th>
            </tr>
          </thead>
          <tbody>
            {pl.lines.map((l) => (
              <tr key={l.lineNo} className={!l.found ? 'row-miss' : l.warning ? 'row-warn' : ''}>
                <td>{l.lineNo}</td>
                <td>{l.code === l.pn || !l.pn ? l.code : `${l.code} / ${l.pn}`}</td>
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
      <p className="muted small-note">
        * Brut par article = marchandise + son emballage d'origine ; la tare des palettes/cartons groupés n'est comptée
        que dans le colisage.
      </p>
    </div>
  );
}
