import type { PackingList } from '../types';

const fmt = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function PackingListView({ pl }: { pl: PackingList }) {
  const h = pl.header;
  const problems = pl.lines.filter((l) => l.warning);
  return (
    <div className="pl-doc printable">
      <h1>PACKING LIST</h1>
      <div className="pl-head">
        <div>
          <b>Expéditeur</b>
          <pre>{h.shipper || '-'}</pre>
        </div>
        <div>
          <b>Destinataire</b>
          <pre>{h.consignee || '-'}</pre>
        </div>
        <div>
          <b>Notify</b>
          <pre>{h.notify || '-'}</pre>
        </div>
        <div className="kv">
          <span>N° PL</span>
          <b>{h.plNumber}</b>
          <span>Date</span>
          <b>{h.date}</b>
          {h.invoiceNumber && (
            <>
              <span>N° Facture</span>
              <b>{h.invoiceNumber}</b>
            </>
          )}
          {h.transport && (
            <>
              <span>Transport</span>
              <b>{h.transport}</b>
            </>
          )}
          {h.portLoading && (
            <>
              <span>Chargement</span>
              <b>{h.portLoading}</b>
            </>
          )}
          {h.portDischarge && (
            <>
              <span>Déchargement</span>
              <b>{h.portDischarge}</b>
            </>
          )}
          {h.marks && (
            <>
              <span>Marquage</span>
              <b>{h.marks}</b>
            </>
          )}
        </div>
      </div>

      {problems.length > 0 && (
        <div className="warn no-print">
          ⚠️ {problems.length} ligne(s) à vérifier :{' '}
          {problems.map((p) => `#${p.lineNo} ${p.code || p.pn} (${p.warning})`).join(' · ')}
        </div>
      )}

      <div className="table-wrap">
        <table className="pl-table">
          <thead>
            <tr>
              <th>N°</th>
              <th>Colis N°</th>
              <th>Code</th>
              <th>PN</th>
              <th>Désignation</th>
              <th>Qté</th>
              <th>Unité</th>
              <th>Colis</th>
              <th>Emballage</th>
              <th>Dimensions (cm)</th>
              <th>Net (kg)</th>
              <th>Brut (kg)</th>
              <th>Vol. (m³)</th>
              <th>Code SH</th>
              <th>Origine</th>
            </tr>
          </thead>
          <tbody>
            {pl.lines.map((l) => (
              <tr key={l.lineNo} className={!l.found ? 'row-miss' : l.warning ? 'row-warn' : ''}>
                <td>{l.lineNo}</td>
                <td>{!l.caseFrom ? '' : l.caseFrom === l.caseTo ? l.caseFrom : `${l.caseFrom}–${l.caseTo}`}</td>
                <td>{l.code}</td>
                <td>{l.pn}</td>
                <td>{l.description}</td>
                <td className="num">{l.quantity}</td>
                <td>{l.unit}</td>
                <td className="num">{l.packages}</td>
                <td>{l.packageType}</td>
                <td>{l.length ? `${l.length} × ${l.width} × ${l.height}` : ''}</td>
                <td className="num">{fmt(l.netWeight)}</td>
                <td className="num">{fmt(l.grossWeight)}</td>
                <td className="num">{fmt(l.volume, 3)}</td>
                <td>{l.hsCode}</td>
                <td>{l.origin}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>TOTAL</td>
              <td className="num">{pl.totals.quantity}</td>
              <td />
              <td className="num">{pl.totals.packages}</td>
              <td colSpan={2} />
              <td className="num">{fmt(pl.totals.netWeight)}</td>
              <td className="num">{fmt(pl.totals.grossWeight)}</td>
              <td className="num">{fmt(pl.totals.volume, 3)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

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
      {h.remarks && <p className="remarks">Remarques : {h.remarks}</p>}
    </div>
  );
}
