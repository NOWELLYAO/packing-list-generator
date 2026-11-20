import { describe, expect, it } from 'vitest';
import { extractOrder } from '../lib/orderImport';
import type { CatalogItem } from '../types';

const mk = (code: string, description: string): CatalogItem =>
  ({ id: code, code, pn: code, description, unit: 'PCS', qtyPerPackage: 1, packageType: 'Carton', length: 10, width: 10, height: 10, volumePerPackage: 0.001, netWeightPerUnit: 1, grossWeightPerUnit: 1, hsCode: '', origin: '', updatedAt: '' }) as CatalogItem;
const cat = [mk('96500968', 'CR10-6 A-FJ-A-E-HQQE 3x230/400 50HZ'), mk('96625360', 'CU 200 control unit cpl.'), mk('05001K21', 'SP5A-21 Rp1½ 4"')];

describe('bon de commande → lignes', () => {
  it('Excel avec colonne Quantité', () => {
    const r = extractOrder([[['Pos', 'Article', 'Désignation', 'Qté', 'Prix'], ['10', '96500968', 'Pompe CR', '6', '1 234,00'], ['20', '96625360', 'Coffret', '2,000', '150,00']]], cat);
    expect(r.map((l) => [l.code, l.quantity])).toEqual([['96500968', 6], ['96625360', 2]]);
  });
  it('PDF ou photo sans colonnes : quantité suivie de l’unité, ou après la désignation', () => {
    const r = extractOrder([[['0010 96500968 CR10-6 pump 4 PCS 1 234,00 4 936,00'], ['0020 96625360 CU 200 control unit 3 150.00 450.00'], ['05001K21 SP5A-21 2PCS']]], cat);
    expect(r.map((l) => [l.code, l.quantity])).toEqual([['96500968', 4], ['96625360', 3], ['05001K21', 2]]);
  });
  it('reconnaît une désignation sans code, et signale un code inconnu', () => {
    const r = extractOrder([[['Pompe CR10-6 A-FJ-A-E-HQQE quantité 5 u'], ['99999999 Article nouveau 7 PCS']]], cat);
    expect(r[0]).toMatchObject({ code: '96500968', quantity: 5, match: 'designation' });
    expect(r[1]).toMatchObject({ code: '99999999', quantity: 7, match: 'inconnu' });
  });
  it('additionne un article commandé sur deux lignes', () => {
    const r = extractOrder([[['96500968 1 PCS'], ['96500968 2 PCS']]], cat);
    expect(r).toHaveLength(1);
    expect(r[0].quantity).toBe(3);
  });
});

describe('bon de commande avec prix', () => {
  it('« code désignation prix qté total » : la quantité est celle qui donne le total', () => {
    const cat2 = [mk('92799796', 'CU 202 cpl PARK'), mk('92959992', 'MS4000ZBCJ4 3x380-415/50 7.50kW 2.5P'), mk('99091874', 'Bulk, valve DN8 PVC/V/C, 10 pcs')];
    const r = extractOrder(
      [[['P/N', 'Désignation', 'P.U. (€)', 'Qté', 'Total (€)'], ['92799796 CU 202 cpl', '472.55', '10 4,725.50'], ['92959992 MS4000ZBCJ4 3x380-415/50', '5.50kW 2.5P', '1,063.20', '4 4,252.80'], ['99091874 Bulk, valve DN8 PVC/V/C, 10 pcs', '105.95', '10 1,059.50']]],
      cat2,
    );
    expect(r.map((l) => [l.code, l.quantity])).toEqual([['92799796', 10], ['92959992', 4], ['99091874', 10]]);
  });
});

describe('photo d’un bon de commande', () => {
  it('mots lus colonne par colonne → lignes reconstituées ; quantité absente (chiffre isolé non lu) retrouvée par total ÷ prix ; code lu à un chiffre près', async () => {
    const { wordsToRows } = await import('../lib/orderImport');
    const W = (t: string, x: number, y: number) => ({ t, x0: x, x1: x + t.length * 10, y0: y, y1: y + 20 });
    const words = [W('92059941', 0, 100), W('MS4000ZBCJ4', 120, 102), W('691.20', 600, 101), W('1,382.40', 800, 99), W('92799796', 0, 140), W('CU', 120, 141), W('202', 150, 141), W('472.55', 600, 139), W('10', 700, 140), W('4,725.50', 800, 140)];
    const rows = wordsToRows(words);
    expect(rows).toHaveLength(2);
    const cat2 = [mk('92959941', 'MS4000ZBCJ4 3x380-415/50 5.50kW'), mk('92799796', 'CU 202 cpl PARK')];
    const r = extractOrder([rows], cat2);
    expect(r.map((l) => [l.code, l.quantity, l.match])).toEqual([['92959941', 2, 'approx'], ['92799796', 10, 'code']]);
  });
});
