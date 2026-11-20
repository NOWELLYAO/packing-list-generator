import { describe, expect, it } from 'vitest';
import { dashboardData } from '../lib/dashboard';
import type { HistoryEntry } from '../types';

const h = (date: string, code: string, q: number, gross: number, mode: 'sea' | 'road' = 'road'): HistoryEntry => ({
  id: date + code,
  createdAt: date,
  reference: '',
  requests: [{ id: 'x', code, pn: '', quantity: q }],
  totals: { quantity: q, packages: 1, netWeight: gross * 0.9, grossWeight: gross, volume: 1 },
  transportMode: mode,
});
describe('tableau de bord', () => {
  it('cumule par mois, compte une PL exportée deux fois une seule fois, classe les articles', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const d = dashboardData(
      [h('2026-11-02T08:00:00Z', 'A', 2, 100), h('2026-11-02T09:00:00Z', 'A', 2, 100), h('2026-10-05T08:00:00Z', 'B', 1, 50, 'sea'), h('2026-10-06T08:00:00Z', 'A', 1, 40), h('2025-01-01T08:00:00Z', 'C', 1, 999)],
      [],
      [],
      '12m',
      now,
    );
    expect(d.count).toBe(3);
    expect(d.gross).toBe(190);
    expect(d.months).toHaveLength(12);
    expect(d.months.at(-1)!.gross).toBe(100);
    expect(d.top[0]).toMatchObject({ code: 'A', pls: 2, quantity: 3 });
    expect(d.modes[0]).toMatchObject({ mode: 'road', count: 2 });
  });
});
