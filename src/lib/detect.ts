import type { FieldKey, Mapping } from '../types';

export const FIELD_LABELS: Record<FieldKey, string> = {
  code: 'Code article',
  pn: 'Part Number (PN)',
  description: 'Désignation',
  quantity: 'Quantité',
  unit: 'Unité',
  packages: 'Nb colis',
  packageType: "Type d'emballage",
  dimensions: 'Dimensions (LxlxH)',
  length: 'Longueur',
  width: 'Largeur',
  height: 'Hauteur',
  netWeight: 'Poids net',
  grossWeight: 'Poids brut',
  volume: 'Volume',
  hsCode: 'Code SH / HS',
  origin: 'Origine',
};

export const FIELD_ORDER: FieldKey[] = [
  'code',
  'pn',
  'description',
  'quantity',
  'unit',
  'packages',
  'packageType',
  'dimensions',
  'length',
  'width',
  'height',
  'netWeight',
  'grossWeight',
  'volume',
  'hsCode',
  'origin',
];

/** Synonymes (normalisés : minuscules, sans accents ni ponctuation) */
const SYNONYMS: Record<FieldKey, string[]> = {
  code: [
    'code article', 'code', 'article', 'item code', 'item no', 'item number', 'item', 'ref',
    'reference', 'ref article', 'sku', 'material', 'material no', 'material number', 'article no',
    'code produit', 'product code', 'art no', 'matnr', 'codigo',
  ],
  pn: [
    'pn', 'p n', 'part number', 'part no', 'part n', 'partnumber', 'part', 'numero de piece',
    'n piece', 'ref fabricant', 'manufacturer part', 'mpn', 'p no',
  ],
  description: [
    'description', 'designation', 'libelle', 'desc', 'description of goods', 'goods description',
    'product', 'produit', 'item description', 'nature', 'denomination',
  ],
  quantity: ['quantite', 'qty', 'qte', 'quantity', 'qte livree', 'qty shipped', 'pcs', 'nombre', 'q ty'],
  unit: ['unite', 'unit', 'uom', 'u m', 'um', 'unit of measure'],
  packages: [
    'colis', 'nb colis', 'nombre de colis', 'packages', 'no of packages', 'pkgs', 'pkg', 'cartons',
    'ctns', 'nb cartons', 'number of packages', 'qty of packages', 'cases', 'nb caisses', 'palettes',
  ],
  packageType: ['emballage', 'type emballage', 'package type', 'packing', 'type of package', 'packaging', 'kind of package'],
  dimensions: [
    'dimensions', 'dimension', 'dim', 'dims', 'l x l x h', 'lxlxh', 'lxwxh', 'l x w x h', 'size',
    'measurement', 'measurements', 'taille', 'dimensions cm', 'dimensions mm',
  ],
  length: ['longueur', 'length', 'long', 'l cm', 'l mm', 'len'],
  width: ['largeur', 'width', 'larg', 'w cm', 'w mm', 'wid'],
  height: ['hauteur', 'height', 'haut', 'h cm', 'h mm', 'ht'],
  netWeight: ['poids net', 'net weight', 'n w', 'nw', 'net wt', 'pds net', 'net kg', 'poids net kg', 'net'],
  grossWeight: [
    'poids brut', 'gross weight', 'g w', 'gw', 'gross wt', 'pds brut', 'gross kg', 'poids brut kg',
    'gross', 'poids', 'weight', 'brut',
  ],
  volume: ['volume', 'cbm', 'm3', 'vol', 'cubage', 'volume m3'],
  hsCode: ['hs code', 'hs', 'code sh', 'sh', 'nomenclature', 'tariff code', 'code douanier', 'customs code'],
  origin: ['origine', 'origin', 'country of origin', 'pays origine', 'coo', 'made in'],
};

export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Score d'une cellule d'en-tête pour un champ (0 = aucun) */
function scoreCell(cell: string, field: FieldKey): number {
  const c = norm(cell);
  if (!c) return 0;
  let best = 0;
  for (const syn of SYNONYMS[field]) {
    if (c === syn) best = Math.max(best, 100 + syn.length);
    else if (syn.length >= 3 && (c.startsWith(syn + ' ') || c.endsWith(' ' + syn) || c.includes(' ' + syn + ' ')))
      best = Math.max(best, 50 + syn.length);
    else if (syn.length >= 5 && c.includes(syn)) best = Math.max(best, 30 + syn.length);
  }
  return best;
}

/** Trouve la ligne d'en-tête la plus probable dans les 40 premières lignes */
export function detectHeaderRow(rows: string[][]): number {
  let bestRow = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 40);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    let score = 0;
    const hit = new Set<FieldKey>();
    for (const cell of row) {
      for (const f of FIELD_ORDER) {
        if (!hit.has(f) && scoreCell(cell, f) > 0) {
          hit.add(f);
          score += 1;
          break;
        }
      }
    }
    // une en-tête combinée sur 2 lignes est fréquente : on ajoute un bonus pour la ligne suivante
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow;
}

/** Associe chaque champ à la meilleure colonne (affectation gloutonne par score) */
export function detectMapping(headerCells: string[], nextRowCells: string[] = []): Mapping {
  const headers = headerCells.map((h, i) => {
    const sub = nextRowCells[i] ?? '';
    // si la ligne suivante est une sous-en-tête (pas de chiffres), on la combine
    return /\d/.test(sub) ? h : `${h} ${sub}`.trim();
  });
  const candidates: { field: FieldKey; col: number; score: number }[] = [];
  headers.forEach((h, col) => {
    for (const field of FIELD_ORDER) {
      const s = scoreCell(h, field);
      if (s > 0) candidates.push({ field, col, score: s });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  const mapping: Mapping = {};
  const usedCols = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] !== undefined || usedCols.has(c.col)) continue;
    mapping[c.field] = c.col;
    usedCols.add(c.col);
  }
  // Si seuls "net" et "poids" génériques : laisser tel quel. Si aucun brut mais un net -> ok.
  return mapping;
}

/** Devine l'unité des dimensions à partir du libellé de colonne */
export function unitFromHeader(header: string): 'mm' | 'cm' | 'm' | null {
  const h = String(header).toLowerCase();
  if (/\bmm\b/.test(h)) return 'mm';
  if (/\bcm\b/.test(h)) return 'cm';
  if (/\(m\)|\bm\b|metre|meter/.test(h) && !/m3|cbm/.test(h)) return 'm';
  return null;
}
