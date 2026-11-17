import type { CatalogItem, PackingList, PLHeader, PLLine, RequestLine } from '../types';
import { norm } from './detect';
import { round } from './parseValues';

/** Recherche d'un article : code + PN, sinon code, sinon PN (insensible à la casse/espaces) */
export function findItem(catalog: CatalogItem[], code: string, pn: string): CatalogItem | undefined {
  const c = norm(code).replace(/\s/g, '');
  const p = norm(pn).replace(/\s/g, '');
  const k = (s: string) => norm(s).replace(/\s/g, '');
  if (c && p) {
    const both = catalog.find((i) => k(i.code) === c && k(i.pn) === p);
    if (both) return both;
  }
  if (c) {
    const byCode = catalog.find((i) => k(i.code) === c) ?? catalog.find((i) => k(i.pn) === c);
    if (byCode) return byCode;
  }
  if (p) return catalog.find((i) => k(i.pn) === p) ?? catalog.find((i) => k(i.code) === p);
  return undefined;
}

export function generatePackingList(catalog: CatalogItem[], requests: RequestLine[], header: PLHeader): PackingList {
  const lines: PLLine[] = [];
  let caseNo = 1;
  let lineNo = 1;
  for (const req of requests) {
    if (!req.code.trim() && !req.pn.trim()) continue;
    const qty = Number(req.quantity) || 0;
    if (qty <= 0) continue;
    const item = findItem(catalog, req.code, req.pn);
    if (!item) {
      lines.push({
        lineNo: lineNo++,
        caseFrom: 0,
        caseTo: 0,
        code: req.code,
        pn: req.pn,
        description: '— Article introuvable dans la base —',
        quantity: qty,
        unit: '',
        packages: 0,
        packageType: '',
        length: 0,
        width: 0,
        height: 0,
        netWeight: 0,
        grossWeight: 0,
        volume: 0,
        hsCode: '',
        origin: '',
        found: false,
        warning: 'Introuvable',
      });
      continue;
    }
    const perPkg = item.qtyPerPackage > 0 ? item.qtyPerPackage : qty;
    const packages = Math.max(1, Math.ceil(round(qty / perPkg, 6)));
    const pkgVolume =
      item.length && item.width && item.height
        ? (item.length * item.width * item.height) / 1_000_000
        : item.volumePerPackage || 0;
    const warnings: string[] = [];
    if (!pkgVolume) warnings.push('Dimensions manquantes');
    if (!item.grossWeightPerUnit) warnings.push('Poids manquant');
    lines.push({
      lineNo: lineNo++,
      caseFrom: caseNo,
      caseTo: caseNo + packages - 1,
      code: item.code,
      pn: item.pn,
      description: item.description,
      quantity: qty,
      unit: item.unit,
      packages,
      packageType: item.packageType,
      length: item.length,
      width: item.width,
      height: item.height,
      netWeight: round(qty * item.netWeightPerUnit, 2),
      grossWeight: round(qty * item.grossWeightPerUnit, 2),
      volume: round(packages * pkgVolume, 3),
      hsCode: item.hsCode,
      origin: item.origin,
      found: true,
      warning: warnings.join(', ') || undefined,
    });
    caseNo += packages;
  }
  const totals = lines.reduce(
    (t, l) => ({
      quantity: t.quantity + l.quantity,
      packages: t.packages + l.packages,
      netWeight: t.netWeight + l.netWeight,
      grossWeight: t.grossWeight + l.grossWeight,
      volume: t.volume + l.volume,
    }),
    { quantity: 0, packages: 0, netWeight: 0, grossWeight: 0, volume: 0 },
  );
  return {
    header,
    lines,
    totals: {
      quantity: round(totals.quantity, 2),
      packages: totals.packages,
      netWeight: round(totals.netWeight, 2),
      grossWeight: round(totals.grossWeight, 2),
      volume: round(totals.volume, 3),
    },
  };
}

/**
 * Parse un collage depuis Excel : "CODE<TAB>PN<TAB>QTE" ou "CODE;QTE" ou "CODE QTE".
 * La dernière valeur numérique est la quantité.
 */
export function parsePastedRequests(text: string): Omit<RequestLine, 'id'>[] {
  const out: Omit<RequestLine, 'id'>[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let parts = line.split(/\t|;|\|/).map((s) => s.trim());
    if (parts.length === 1) parts = line.split(/,(?=\s*\d+(?:[.,]\d+)?\s*$)|\s+/).map((s) => s.trim());
    parts = parts.filter((p, i) => p !== '' || i === 1);
    if (parts.length < 2) continue;
    const qty = Number(parts[parts.length - 1].replace(',', '.'));
    if (!Number.isFinite(qty)) continue; // ligne d'en-tête
    const ids = parts.slice(0, -1);
    out.push({ code: ids[0] ?? '', pn: ids.length > 1 ? ids[1] : '', quantity: qty });
  }
  return out;
}
