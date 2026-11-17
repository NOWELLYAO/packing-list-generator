import type { HistoryEntry } from '../types';
import { useSafety } from '../lib/safety';

interface Props {
  history: HistoryEntry[];
  setHistory: (h: HistoryEntry[]) => void;
  onOpen: (e: HistoryEntry) => void;
}

const fmt = (n: number, d = 1) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function HistoryPanel({ history, setHistory, onOpen }: Props) {
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
