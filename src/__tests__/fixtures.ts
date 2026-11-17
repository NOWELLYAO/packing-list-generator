import type { CatalogItem, PackVariant } from '../types';

/** Données fictives pour les tests (aucune donnée client dans le dépôt) */
const base = {
  unit: 'PCS',
  hsCode: '',
  origin: 'XX',
  source: 'test',
  updatedAt: '2026-01-01T00:00:00.000Z',
  volumePerPackage: 0,
};

const variant = (v: Partial<PackVariant> & Pick<PackVariant, 'qtyPerPackage' | 'length' | 'width' | 'height'>): PackVariant => ({
  packageType: 'PALPLATE',
  volumePerPackage: 0,
  netWeightPerUnit: 70,
  grossWeightPerUnit: 70,
  mixed: false,
  source: 'test',
  count: 1,
  ...v,
});

/** Pompe : 6 par palette 120×80×117 (vue 2×), 4 par palette 120×80×85 ; palette vide 25 kg */
export const PUMP: CatalogItem = {
  ...base,
  id: 'pump',
  code: 'P-100',
  pn: 'P-100',
  description: 'Pompe test P-100',
  qtyPerPackage: 6,
  packageType: 'PALPLATE',
  length: 120,
  width: 80,
  height: 117,
  netWeightPerUnit: 74.5,
  grossWeightPerUnit: 74.5 + 25 / 6,
  variants: [
    variant({ qtyPerPackage: 6, length: 120, width: 80, height: 117, netWeightPerUnit: 74.5, grossWeightPerUnit: 74.5 + 25 / 6, count: 2 }),
    variant({ qtyPerPackage: 4, length: 120, width: 80, height: 85, netWeightPerUnit: 74.5, grossWeightPerUnit: 74.5 + 25 / 4 }),
  ],
};

/** Petit accessoire en carton (1 par carton 30×20×15, 2 kg) */
export const PART_A: CatalogItem = {
  ...base,
  id: 'a',
  code: 'A-1',
  pn: 'A-1',
  description: 'Accessoire A',
  qtyPerPackage: 1,
  packageType: 'Carton',
  length: 30,
  width: 20,
  height: 15,
  netWeightPerUnit: 1.8,
  grossWeightPerUnit: 2,
  coPacked: ['B-1'],
};

export const PART_B: CatalogItem = { ...PART_A, id: 'b', code: 'B-1', pn: 'B-1', description: 'Accessoire B', coPacked: ['A-1'] };

/** Article long (160 cm) livré seul */
export const LONG: CatalogItem = {
  ...base,
  id: 'long',
  code: 'L-1',
  pn: 'L-1',
  description: 'Pompe forage longue',
  qtyPerPackage: 1,
  packageType: 'Pallet',
  length: 160,
  width: 12,
  height: 12,
  netWeightPerUnit: 21,
  grossWeightPerUnit: 22,
};

/** Grosse caisse 120×260×225, 1 648 kg */
export const CRATE: CatalogItem = {
  ...base,
  id: 'crate',
  code: 'C-1',
  pn: 'C-1',
  description: 'Groupe de surpression',
  qtyPerPackage: 1,
  packageType: 'CRATE',
  length: 120,
  width: 260,
  height: 225,
  netWeightPerUnit: 1608,
  grossWeightPerUnit: 1648,
};

export const CATALOG: CatalogItem[] = [PUMP, PART_A, PART_B, LONG, CRATE];

export const req = (code: string, quantity: number, id = code + quantity) => ({ id, code, pn: '', quantity });
