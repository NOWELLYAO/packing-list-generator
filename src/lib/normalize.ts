import type { CatalogItem, ImportOptions, Mapping } from '../types';
import { norm, unitFromHeader } from './detect';
import { parseDimensions, parseNumber, round, toCm } from './parseValues';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const itemKey = (code: string, pn: string) => `${norm(code)}|${norm(pn)}`;

interface RawLine {
  code: string;
  pn: string;
  description: string;
  qty: number;
  unit: string;
  pkgs: number;
  packageType: string;
  dims: { l: number; w: number; h: number } | null;
  net: number;
  gross: number;
  volume: number;
  hsCode: string;
  origin: string;
}

/** Ligne de "total" / "sous-total" / pied de page */
function isTotalRow(row: string[]): boolean {
  return row.some((c) => /^(sub)?\s*-?\s*total|^totaux?\b|^grand total|^sous-total/i.test(c.trim()));
}

export interface NormalizeResult {
  items: CatalogItem[];
  skipped: number;
}

/**
 * Transforme les lignes d'un PL en articles de catalogue (valeurs ramenées à l'unité / au colis).
 */
export function normalizeRows(
  rows: string[][],
  headerRow: number,
  mapping: Mapping,
  options: ImportOptions,
  source: string,
): NormalizeResult {
  const header = rows[headerRow] ?? [];
  const sub = rows[headerRow + 1] ?? [];
  const subIsHeader = sub.length > 0 && !sub.some((c) => /\d/.test(c)) && sub.some((c) => c.trim());
  const start = headerRow + (subIsHeader ? 2 : 1);

  const get = (row: string[], f: keyof Mapping) => {
    const idx = mapping[f];
    return idx === undefined ? '' : (row[idx] ?? '').trim();
  };
  const headerOf = (f: keyof Mapping) => {
    const idx = mapping[f];
    return idx === undefined ? '' : `${header[idx] ?? ''} ${subIsHeader ? sub[idx] ?? '' : ''}`;
  };

  // Unité des dimensions
  const dimHeaderUnit =
    options.dimUnit !== 'auto'
      ? options.dimUnit
      : unitFromHeader(headerOf('dimensions')) ?? unitFromHeader(headerOf('length')) ?? null;

  // Poids en tonnes ou grammes ?
  const weightFactor = (f: 'netWeight' | 'grossWeight') => {
    const h = headerOf(f).toLowerCase();
    if (/\bt\b|tonne|\bmt\b/.test(h)) return 1000;
    if (/\bg\b|gramme|grams?\b/.test(h) && !/kg/.test(h)) return 0.001;
    return 1;
  };
  const netF = weightFactor('netWeight');
  const grossF = weightFactor('grossWeight');

  const raw: RawLine[] = [];
  let skipped = 0;
  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;
    if (isTotalRow(row)) {
      skipped++;
      continue;
    }
    const code = get(row, 'code');
    const pn = get(row, 'pn');
    const description = get(row, 'description');
    const qty = parseNumber(get(row, 'quantity'));
    if ((!code && !pn) || !Number.isFinite(qty) || qty <= 0) {
      // Peut être une ligne de continuation de dimensions/poids : ignorée
      if (code || pn || description) skipped++;
      continue;
    }
    let dims: RawLine['dims'] = null;
    const dimStr = get(row, 'dimensions');
    if (dimStr) {
      const d = parseDimensions(dimStr);
      if (d) {
        const u = d.unit ?? dimHeaderUnit;
        const sample = [d.l, d.w, d.h];
        dims = { l: toCm(d.l, u, sample), w: toCm(d.w, u, sample), h: toCm(d.h, u, sample) };
      }
    }
    if (!dims && (mapping.length !== undefined || mapping.width !== undefined || mapping.height !== undefined)) {
      const l = parseNumber(get(row, 'length'));
      const w = parseNumber(get(row, 'width'));
      const h = parseNumber(get(row, 'height'));
      if ([l, w, h].every(Number.isFinite)) {
        const sample = [l, w, h];
        dims = { l: toCm(l, dimHeaderUnit, sample), w: toCm(w, dimHeaderUnit, sample), h: toCm(h, dimHeaderUnit, sample) };
      }
    }
    raw.push({
      code,
      pn,
      description,
      qty,
      unit: get(row, 'unit') || 'PCS',
      pkgs: parseNumber(get(row, 'packages')),
      packageType: get(row, 'packageType'),
      dims,
      net: parseNumber(get(row, 'netWeight')) * netF,
      gross: parseNumber(get(row, 'grossWeight')) * grossF,
      volume: parseNumber(get(row, 'volume')),
      hsCode: get(row, 'hsCode'),
      origin: get(row, 'origin'),
    });
  }

  // Groupes : une ligne avec colis/poids brut ouvre un groupe ; les lignes suivantes vides
  // (cellules fusionnées = même caisse) s'y rattachent.
  const canGroup = options.weightBasis === 'line' && (mapping.packages !== undefined || mapping.grossWeight !== undefined);
  const groups: RawLine[][] = [];
  for (const line of raw) {
    const opens = Number.isFinite(line.pkgs) || Number.isFinite(line.gross) || line.dims !== null || groups.length === 0;
    if (opens || !canGroup) groups.push([line]);
    else groups[groups.length - 1].push(line);
  }

  const now = new Date().toISOString();
  const items: CatalogItem[] = [];
  for (const g of groups) {
    const head = g[0];
    const groupQty = g.reduce((s, l) => s + l.qty, 0);
    const groupPkgs = Number.isFinite(head.pkgs) && head.pkgs > 0 ? head.pkgs : 1;
    const dims = head.dims;
    const groupVolume = head.volume;

    for (const l of g) {
      const share = g.length === 1 ? 1 : l.qty / groupQty;
      const linePkgs = g.length === 1 ? groupPkgs : Math.max(1, groupPkgs * share);
      let netPerUnit = NaN;
      let grossPerUnit = NaN;

      switch (options.weightBasis) {
        case 'unit':
          netPerUnit = l.net;
          grossPerUnit = l.gross;
          break;
        case 'package': {
          const perPkgQty = l.qty / (Number.isFinite(l.pkgs) && l.pkgs > 0 ? l.pkgs : 1);
          netPerUnit = l.net / perPkgQty;
          grossPerUnit = l.gross / perPkgQty;
          break;
        }
        default: {
          // Valeurs = total de la ligne (ou du groupe, réparti au prorata des quantités)
          const allHaveNet = g.every((x) => Number.isFinite(x.net));
          const netLine = allHaveNet ? l.net : Number.isFinite(head.net) ? head.net * share : NaN;
          const grossLine = Number.isFinite(head.gross) ? head.gross * share : NaN;
          netPerUnit = netLine / l.qty;
          grossPerUnit = grossLine / l.qty;
        }
      }
      if (!Number.isFinite(netPerUnit) && Number.isFinite(grossPerUnit)) netPerUnit = grossPerUnit;
      if (!Number.isFinite(grossPerUnit) && Number.isFinite(netPerUnit)) grossPerUnit = netPerUnit;

      const volumePerPackage =
        !dims && Number.isFinite(groupVolume) && groupVolume > 0 ? groupVolume / groupPkgs : 0;

      items.push({
        id: uid(),
        code: l.code,
        pn: l.pn,
        description: l.description,
        unit: l.unit,
        qtyPerPackage: round(l.qty / linePkgs, 4),
        packageType: l.packageType || head.packageType || 'Colis',
        length: round(dims?.l ?? 0, 1),
        width: round(dims?.w ?? 0, 1),
        height: round(dims?.h ?? 0, 1),
        volumePerPackage: round(volumePerPackage, 4),
        netWeightPerUnit: round(Number.isFinite(netPerUnit) ? netPerUnit : 0, 4),
        grossWeightPerUnit: round(Number.isFinite(grossPerUnit) ? grossPerUnit : 0, 4),
        hsCode: l.hsCode || head.hsCode,
        origin: l.origin || head.origin,
        source,
        updatedAt: now,
      });
    }
  }
  return { items, skipped };
}

/** Fusionne dans le catalogue : un même (code, PN) est mis à jour par l'import le plus récent. */
export function mergeCatalog(catalog: CatalogItem[], incoming: CatalogItem[]) {
  const map = new Map(catalog.map((c) => [itemKey(c.code, c.pn), c]));
  let added = 0;
  let updated = 0;
  for (const it of incoming) {
    const k = itemKey(it.code, it.pn);
    const prev = map.get(k);
    if (prev) {
      // une fiche issue d'un colis dédié n'est pas écrasée par une estimation en colis mixte
      if (it.mixed && !prev.mixed) continue;
      updated++;
      // garder les valeurs existantes si le nouvel import ne les fournit pas
      map.set(k, {
        ...prev,
        ...Object.fromEntries(
          Object.entries(it).filter(([key, v]) => key !== 'id' && v !== '' && v !== 0),
        ),
        mixed: it.mixed ?? false,
        id: prev.id,
      } as CatalogItem);
    } else {
      added++;
      map.set(k, it);
    }
  }
  return { catalog: [...map.values()], added, updated };
}
