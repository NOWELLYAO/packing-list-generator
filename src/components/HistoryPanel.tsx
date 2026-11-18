import { useState } from 'react';
import type { HistoryEntry } from '../types';
import { useSafety } from '../lib/safety';
import { accuracySummary, type AccuracyRecord } from '../lib/realCheck';
import AccuracyCard, { ScoreBadge } from './AccuracyCard';
import InfoTip from './InfoTip';

interface Props {
  accuracy: AccuracyRecord[];
  setAccuracy: (a: AccuracyRecord[]) => void;
  history: HistoryEntry[];
  setHistory: (h: HistoryEntry[]) => void;
  onOpen: (e: HistoryEntry) => void;
}

const fmt = (n: number, d = 1) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Précision de l'application mesurée sur les PL réelles importées */
function AccuracyPanel({ accuracy, setAccuracy }: Pick<Props, 'accuracy' | 'setAccuracy'>) {
  const [all, setAll] = useState(false);
  const { notify } = useSafety();
  const sum = accuracySummary(accuracy);
  return (
    <section className="accuracy-panel">
      <div className="page-head">
        <div>
          <h3 className="section-title">
            Précision sur vos PL réelles <InfoTip k="accuracy" />
          </h3>
          <p className="hint">
            {sum
              ? `Mesurée à l'aveugle sur ${sum.count} PL Grundfos importée${sum.count > 1 ? 's' : ''}.`
              : "Importez une PL Grundfos reçue (onglet Importer) : l'application compare d'abord sa propre proposition à la réalité, puis apprend de la PL."}
          </p>
        </div>
        {accuracy.length > 0 && (
          <button
            className="btn ghost small"
            onClick={() => {
              const before = accuracy;
              setAccuracy([]);
              notify('Mesures de précision effacées', () => setAccuracy(before));
            }}
          >
            Réinitialiser
          </button>
        )}
      </div>
      {sum && (
        <>
          <div className="accuracy-summary">
            <div className="big-score">
              <ScoreBadge score={sum.average} />
              <span>
                <b>Précision moyenne</b>
                <small>meilleure des deux propositions</small>
              </span>
            </div>
            <div>
              <small>Colis identiques</small>
              <b>{sum.exactRate} %</b>
            </div>
            <div>
              <small>Écart volume (médian)</small>
              <b>{sum.volumeErr.toLocaleString('fr-FR')} %</b>
            </div>
            <div>
              <small>Écart poids (médian)</small>
              <b>{sum.grossErr.toLocaleString('fr-FR')} %</b>
            </div>
            <div>
              <small>Selon Grundfos / Optimisée</small>
              <b>
                {sum.grundfos} / {sum.smart}
              </b>
            </div>
            {sum.trend !== null && (
              <div>
                <small>Progression</small>
                <b className={sum.trend > 0 ? 'up' : sum.trend < 0 ? 'down' : ''}>
                  {sum.trend > 0 ? '▲ +' : sum.trend < 0 ? '▼ ' : '= '}
                  {sum.trend} pts
                </b>
              </div>
            )}
          </div>
          <div className="accuracy-list">
            {(all ? accuracy : accuracy.slice(0, 3)).map((r) => (
              <AccuracyCard key={r.id} r={r} />
            ))}
          </div>
          {accuracy.length > 3 && (
            <button className="link-btn" onClick={() => setAll(!all)}>
              {all ? 'Afficher moins' : `Afficher les ${accuracy.length} mesures`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default function HistoryPanel({ accuracy, setAccuracy, history, setHistory, onOpen }: Props) {
  const { ask, notify } = useSafety();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Historique</h2>
          <p className="hint">Chaque PL exportée ou partagée est conservée ici ({history.length}).</p>
        </div>
        {history.length > 0 && (
          <button
            className="btn ghost danger"
            onClick={async () => {
              const ok = await ask({
                title: "Effacer tout l'historique ?",
                message: `Les ${history.length} PL enregistrées seront effacées de cet appareil.`,
                confirmLabel: 'Effacer',
                typeToConfirm: history.length > 5 ? 'EFFACER' : undefined,
              });
              if (!ok) return;
              const before = history;
              setHistory([]);
              notify('Historique effacé', () => setHistory(before));
            }}
          >
            Tout effacer
          </button>
        )}
      </div>
      <AccuracyPanel accuracy={accuracy} setAccuracy={setAccuracy} />
      <h3 className="section-title">PL générées</h3>
      {history.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🕘</div>
          <p>
            <b>Aucune PL pour l'instant.</b>
            <br />
            Elles apparaîtront ici dès votre premier export.
          </p>
        </div>
      ) : (
        <div className="item-list">
          {history.map((h) => {
            const d = new Date(h.createdAt);
            return (
              <div key={h.id} className="item-row static">
                <div className="date-badge">
                  <b>{d.getDate()}</b>
                  <span>{d.toLocaleDateString('fr-FR', { month: 'short' })}</span>
                </div>
                <div className="item-main">
                  <b>
                    {h.requests.length} article{h.requests.length > 1 ? 's' : ''} · {h.totals.packages} colis
                  </b>
                  <span className="hint">
                    {h.proposal && `${h.proposal === 'grundfos' ? 'Selon Grundfos' : 'Optimisée'} · ${(h.lang ?? 'fr').toUpperCase()} · ${{ sea: 'Maritime', road: 'Routier', air: 'Aérien' }[h.transportMode ?? 'sea']} — `}
                    {h.requests
                      .slice(0, 4)
                      .map((r) => `${r.code || r.pn} ×${r.quantity}`)
                      .join(', ')}
                    {h.requests.length > 4 ? '…' : ''}
                  </span>
                </div>
                <div className="item-pack">
                  <span>{fmt(h.totals.grossWeight)} kg</span>
                  <span className="hint">{fmt(h.totals.volume, 2)} m³ · {d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="row">
                  <button className="btn small" onClick={() => onOpen(h)}>
                    Rouvrir
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="Supprimer"
                    onClick={() => {
                      const before = history;
                      setHistory(history.filter((x) => x.id !== h.id));
                      notify('PL retirée de l’historique', () => setHistory(before));
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
