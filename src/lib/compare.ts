import type { PackingList, PLPackage } from '../types';
import { planLoad } from './loadPlan';
import { freightInfo } from './freight';
import { packLabel, type Lang } from './i18n';

/** Indicateurs comparés entre la proposition « selon Grundfos » et la proposition optimisée */
export interface CompareRow {
  key: string;
  label: string;
  /** libellé court pour les petits écrans */
  short: string;
  g: number;
  s: number;
  unit: string;
  decimals: number;
  /** une valeur plus basse est-elle meilleure ? */
  lowerIsBetter: boolean;
}

export interface Comparison {
  rows: CompareRow[];
  transportG: string;
  transportS: string;
  changes: string[];
}

const dims = (p: PLPackage) => (p.length ? `${p.length}×${p.width}×${p.height}` : `${p.volume} m³`);

export function comparePL(g: PackingList, s: PackingList, lang: Lang = 'fr'): Comparison {
  const planG = planLoad(g.packages);
  const planS = planLoad(s.packages);
  const fG = freightInfo(g);
  const fS = freightInfo(s);
  const vName = (p: ReturnType<typeof planLoad>) => (p ? `${p.bins.length} × ${lang === 'fr' ? p.vehicle.name : p.vehicle.nameEn}` : '—');
  const rows: CompareRow[] = [
    { key: 'packages', label: 'Colis', short: 'Colis', g: g.totals.packages, s: s.totals.packages, unit: '', decimals: 0, lowerIsBetter: true },
    { key: 'volume', label: 'Volume', short: 'Volume', g: g.totals.volume, s: s.totals.volume, unit: 'm³', decimals: 3, lowerIsBetter: true },
    { key: 'gross', label: 'Poids brut', short: 'Brut', g: g.totals.grossWeight, s: s.totals.grossWeight, unit: 'kg', decimals: 1, lowerIsBetter: true },
    { key: 'net', label: 'Poids net', short: 'Net', g: g.totals.netWeight, s: s.totals.netWeight, unit: 'kg', decimals: 1, lowerIsBetter: true },
    { key: 'ldm', label: 'Mètres de plancher (LDM)', short: 'LDM', g: planG?.ldm ?? 0, s: planS?.ldm ?? 0, unit: 'm', decimals: 2, lowerIsBetter: true },
    { key: 'air', label: 'Poids taxable aérien', short: 'Aérien taxable', g: fG.airChargeableKg, s: fS.airChargeableKg, unit: 'kg', decimals: 0, lowerIsBetter: true },
    { key: 'sea', label: 'Unités payantes maritimes', short: 'Maritime (UP)', g: fG.seaRevenueTon, s: fS.seaRevenueTon, unit: 'UP', decimals: 2, lowerIsBetter: true },
  ];

  // Ce qui change, article par article
  const changes: string[] = [];
  const byLine = (pl: PackingList, code: string) => pl.packages.filter((p) => p.contents.some((c) => c.code === code));
  for (const line of s.lines) {
    if (!line.found) continue;
    const pg = byLine(g, line.code);
    const ps = byLine(s, line.code);
    const grouped = ps.find((p) => p.basis === 'grouped');
    if (grouped && !pg.some((p) => p.basis === 'grouped')) continue; // traité plus bas
    const a = pg.map(dims).join(' + ');
    const b = ps.map(dims).join(' + ');
    if (a !== b) changes.push(`${line.description || line.code} × ${line.quantity} : ${a} → ${b}`);
  }
  for (const p of s.packages.filter((x) => x.basis === 'grouped')) {
    const codes = p.contents.map((c) => c.code);
    const before = g.packages.filter((x) => x.contents.some((c) => codes.includes(c.code)));
    changes.push(
      `${codes.length} petit(s) article(s) (${codes.join(', ')}) : ${before.length} colis séparés → 1 ${packLabel(p.type, lang).toLowerCase()} ${dims(p)}`,
    );
  }
  return { rows, transportG: vName(planG), transportS: vName(planS), changes };
}
