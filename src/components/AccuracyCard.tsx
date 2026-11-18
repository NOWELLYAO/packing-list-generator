import { useState } from 'react';
import type { AccuracyRecord, ProposalScore } from '../lib/realCheck';
import InfoTip from './InfoTip';

const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

/** Pastille de score : vert ≥ 85, orange ≥ 65, rouge en dessous */
export function ScoreBadge({ score, label }: { score: number; label?: string }) {
  const tone = score >= 85 ? 'good' : score >= 65 ? 'mid' : 'low';
  return (
    <span className={`score-badge ${tone}`} title={label ? `${label} : ${score}/100` : `${score}/100`}>
      {label && <small>{label}</small>}
      <b>{score}</b>
    </span>
  );
}

function Detail({ s }: { s: ProposalScore }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Tableau (défilement horizontal)">
      <table className="pl-table compact">
        <thead>
          <tr>
            <th>Article</th>
            <th className="num">Qté</th>
            <th>Proposé</th>
            <th>Réel (Grundfos)</th>
            <th aria-label="Identique" />
          </tr>
        </thead>
        <tbody>
          {s.articles.map((a) => (
            <tr key={a.code} className={a.ok ? '' : 'row-warn'}>
              <td>
                <span className="mono">{a.code}</span> {a.description}
              </td>
              <td className="num">{a.quantity}</td>
              <td>{a.proposed}</td>
              <td>{a.real}</td>
              <td aria-label={a.ok ? 'identique' : 'différent'}>{a.ok ? '✓' : '≠'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Résultat d'un test à l'aveugle : proposition de l'application contre la PL réelle */
export default function AccuracyCard({ r, compact }: { r: AccuracyRecord; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState<'grundfos' | 'smart'>('grundfos');
  const g = r.grundfos;
  return (
    <div className={`accuracy-card ${compact ? 'compact' : ''}`}>
      <div className="accuracy-head">
        <div className="accuracy-title">
          <b>PL {r.plNumber || r.fileName}</b>
          <span className="hint">
            {new Date(r.date).toLocaleDateString('fr-FR')} · {r.known} article{r.known > 1 ? 's' : ''} connu{r.known > 1 ? 's' : ''}
            {r.unknown > 0 && ` · ${r.unknown} non testé${r.unknown > 1 ? 's' : ''} (nouveaux : appris)`}
          </span>
        </div>
        <div className="row">
          <ScoreBadge score={g.score} label="Grundfos" />
          <ScoreBadge score={r.smart.score} label="Optimisée" />
        </div>
      </div>
      <div className="accuracy-facts">
        <span>
          <small>Colis identiques</small>
          {g.exactPackages} / {r.real.packages}
        </span>
        <span>
          <small>Nombre de colis</small>
          {g.packages} proposé{g.packages > 1 ? 's' : ''} · {r.real.packages} réel{r.real.packages > 1 ? 's' : ''}
        </span>
        <span>
          <small>Écart volume</small>
          {pct(g.volumeErrPct)}
        </span>
        <span>
          <small>Écart poids brut</small>
          {pct(g.grossErrPct)}
        </span>
      </div>
      <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Masquer le détail' : 'Voir le détail article par article'}
      </button>
      {open && (
        <>
          <div className="segmented small">
            <button className={which === 'grundfos' ? 'on' : ''} onClick={() => setWhich('grundfos')}>
              Selon Grundfos
            </button>
            <button className={which === 'smart' ? 'on' : ''} onClick={() => setWhich('smart')}>
              Optimisée
            </button>
          </div>
          <Detail s={which === 'grundfos' ? g : r.smart} />
        </>
      )}
    </div>
  );
}

export function AccuracyInfo() {
  return <InfoTip k="accuracy" />;
}
