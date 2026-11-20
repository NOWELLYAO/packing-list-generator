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
