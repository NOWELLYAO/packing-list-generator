import type { CatalogItem } from '../types';
import { uid } from './normalize';

/**
 * Lecture d'un nombre saisi à la main, au format français ou anglais :
 * "1 234,5", "1234.5", "1,5", " 12 " → nombre ; texte vide ou illisible → NaN.
 */
export function readUserNumber(raw: string | number): number {
  if (typeof raw === 'number') return raw;
  const s = String(raw ?? '')
    .replace(/[\s  ']/g, '') // espaces (y compris insécables) et apostrophes de milliers
    .trim();
  if (!s) return NaN;
  if (!/^-?[\d.,]+$/.test(s)) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let t = s;
  if (lastComma > -1 && lastDot > -1) {
    // le dernier séparateur est le séparateur décimal
    t = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    t = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (s.split('.').length > 2) {
    t = s.replace(/\./g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Unités comptées à la pièce : la quantité doit être un nombre entier */
export const isPieceUnit = (unit: string | undefined) => /^(pcs?|pc|pieces?|pièces?|set|sets|ea|each|u|un|unit[ée]?s?|st|stk)$/i.test((unit ?? 'PCS').trim());

const num = (v: unknown, def = 0) => {
  const n = typeof v === 'number' ? v : readUserNumber(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/**
 * Nettoie une liste d'articles venant d'un fichier ou du stockage :
 * élimine les fiches sans code ni PN, complète les champs manquants, corrige les types.
 */
export function sanitizeCatalog(data: unknown): { items: CatalogItem[]; rejected: number } {
  if (!Array.isArray(data)) return { items: [], rejected: 0 };
  const items: CatalogItem[] = [];
  let rejected = 0;
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') {
      rejected++;
      continue;
    }
    const r = raw as Record<string, unknown>;
    const code = str(r.code).trim();
    const pn = str(r.pn).trim();
    if (!code && !pn) {
      rejected++;
      continue;
    }
    const net = num(r.netWeightPerUnit);
    const gross = Math.max(num(r.grossWeightPerUnit), net);
    items.push({
      ...(r as unknown as CatalogItem),
      id: str(r.id) || uid(),
      code: code || pn,
      pn: pn || code,
      description: str(r.description),
      unit: str(r.unit) || 'PCS',
      qtyPerPackage: num(r.qtyPerPackage, 1) || 1,
      packageType: str(r.packageType) || 'Colis',
      length: num(r.length),
      width: num(r.width),
      height: num(r.height),
      volumePerPackage: num(r.volumePerPackage),
      netWeightPerUnit: net,
      grossWeightPerUnit: gross,
      hsCode: str(r.hsCode),
      origin: str(r.origin),
      source: str(r.source) || 'Fichier importé',
      updatedAt: str(r.updatedAt) || new Date().toISOString(),
      variants: Array.isArray(r.variants) ? (r.variants as CatalogItem['variants']) : undefined,
      coPacked: Array.isArray(r.coPacked) ? (r.coPacked as unknown[]).map(str).filter(Boolean) : undefined,
    });
  }
  return { items, rejected };
}
