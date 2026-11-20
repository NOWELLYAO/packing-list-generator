import type { CatalogItem, HistoryEntry } from '../types';
import type { AccuracyRecord } from './realCheck';

export type Period = '3m' | '12m' | 'all';

export interface DashboardData {
  count: number;
  gross: number;
  volume: number;
  packages: number;
  months: { key: string; label: string; gross: number; volume: number; count: number }[];
  top: { code: string; description: string; quantity: number; pls: number }[];
  modes: { mode: 'sea' | 'road' | 'air'; count: number; gross: number }[];
  accuracy: { date: string; label: string; score: number }[];
}

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Indicateurs d'activité tirés de l'historique des PL (une PL exportée = une expédition) */
export function dashboardData(history: HistoryEntry[], catalog: CatalogItem[], accuracy: AccuracyRecord[], period: Period, now = new Date()): DashboardData {
  const from = period === 'all' ? new Date(0) : new Date(now.getFullYear(), now.getMonth() - (period === '3m' ? 2 : 11), 1);
  // une même PL exportée plusieurs fois (PDF puis Excel) ne compte qu'une fois : même contenu le même jour
  const seen = new Set<string>();
  const list = [...history]
    .filter((h) => new Date(h.createdAt) >= from)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .filter((h) => {
      const k = `${h.createdAt.slice(0, 10)}|${h.requests.map((r) => `${r.code}:${r.quantity}`).sort().join(',')}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  // mois de la période (au moins les 3 derniers, même vides)
  const months: DashboardData['months'] = [];
  const first = list.length ? new Date(Math.min(from.getTime() || Infinity, new Date(list[0].createdAt).getTime())) : from;
  const start = period === 'all' ? new Date(first.getFullYear(), first.getMonth(), 1) : from;
  for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push({ key: monthKey(d), label: `${MONTHS_FR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, gross: 0, volume: 0, count: 0 });
  }
  const byMonth = new Map(months.map((m) => [m.key, m] as const));
  const desc = new Map(catalog.map((i) => [i.code, i.description] as const));
  const top = new Map<string, { code: string; description: string; quantity: number; pls: number }>();
  const modes = new Map<'sea' | 'road' | 'air', { mode: 'sea' | 'road' | 'air'; count: number; gross: number }>();
  let gross = 0;
  let volume = 0;
  let packages = 0;
  for (const h of list) {
    gross += h.totals.grossWeight;
    volume += h.totals.volume;
    packages += h.totals.packages;
    const m = byMonth.get(monthKey(new Date(h.createdAt)));
    if (m) {
      m.gross += h.totals.grossWeight;
      m.volume += h.totals.volume;
      m.count += 1;
    }
    const mode = h.transportMode ?? 'sea';
    const e = modes.get(mode) ?? { mode, count: 0, gross: 0 };
    e.count += 1;
    e.gross += h.totals.grossWeight;
    modes.set(mode, e);
    const inPl = new Set<string>();
    for (const r of h.requests) {
      const k = r.code || r.pn;
      const t = top.get(k) ?? { code: k, description: desc.get(r.code) ?? '', quantity: 0, pls: 0 };
      t.quantity += r.quantity;
      if (!inPl.has(k)) t.pls += 1;
      inPl.add(k);
      top.set(k, t);
    }
  }
  const acc = [...accuracy]
    .filter((a) => new Date(a.date) >= from)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((a) => ({ date: a.date, label: a.plNumber || a.fileName, score: Math.max(a.grundfos.score, a.smart.score) }));
  return {
    count: list.length,
    gross,
    volume,
    packages,
    months,
    top: [...top.values()].sort((a, b) => b.pls - a.pls || b.quantity - a.quantity).slice(0, 10),
    modes: [...modes.values()].sort((a, b) => b.count - a.count),
    accuracy: acc,
  };
}
