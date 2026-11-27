import { describe, expect, it } from 'vitest';
import { suggestHs, suggestPackaging } from '../lib/hsCodes';
describe('codes SH proposés', () => {
  it.each([
    ['SP14-27 Rp2 4"3X380-415/50 7.5kW', '8413.70'],
    ['CR10-6 A-FJ-A-E-HQQE', '8413.70'],
    ['DDA 7.5-16 AR-C-PVC/V/C-F-31U2U2', '8413.50'],
    ['MS4000 7.50kW c', '8501.52'],
    ['Spare, Motor cable MS6000 4G6mm2', '8544.49'],
    ['Array wire kit (MC4)', '8544.42'],
    ['Kit, Impeller 96572021 Fr 70', '8413.91'],
    ['Kit, S Fr 66/70 Cable inlet gasket', '8413.91'],
    ['Float switch MS1, 10m cable', '8536.50'],
    ['CUE 3x380-500V IP55 11kW', '8504.40'],
    ['CU 200 control unit cpl.', '8537.10'],
    ['MP 204 motor protector', '8536.30'],
  ])('%s → %s', (d, code) => expect(suggestHs(d)?.code).toBe(code));
  it('aucune proposition plutôt qu’une fausse : produit inconnu', () => expect(suggestHs('DUMMY PLUG (1/4')).toBeNull());
});

describe('codes SH ajoutés', () => {
  it.each([
    ['GT-U+ 200 PN10 R1 1/4 V', '7311.00'],
    ['GT-H-24 PN10 G1 V', '7311.00'],
    ['GT-D-130 PN10 G', '7311.00'],
    ['CUE 3x380-500V IP55 11kW', '8504.40'],
    ['Motorcable MS4000 C, 4G 1.5mm2, 1.7m 1p', '8544.49'],
    ['CP 1x32A DOL 3x415 DPC 1-3 PRO', '8537.10'],
    ['Lift. chain 320kg 10m SS cert. cpl.', '7315.82'],
    ['Flow sleeve cpl. d180(D200)x1000 4" R', '8413.91'],
  ])('%s → %s', (d, code) => expect(suggestHs(d)?.code).toBe(code));
});

describe('emballage proposé', () => {
  it.each([
    ['SP14-27 Rp2 4"', 86, 'Caisse'],
    ['SP3A-18 Rp1¼ 4"', 17, 'Carton'],
    ['CR45-4 A-F-A-E-HQQE', 212, 'Palette étroite'],
    ['CR5-10 A-A-A-E-HQQE', 38, 'Carton'],
    ['Hydro Multi-E 2 CRE 15-4 U2', 310, 'Carton sur palette'],
    ['Motor cable MS4000 C', 1, 'Carton'],
    ['TPED 100-110/4', 238, 'Palette'],
    ['NBE 100-200', 145, 'Caisse'],
  ])('%s (%s kg) → %s', (d, kg, t) => expect(suggestPackaging(d as string, kg as number).type).toBe(t));
});
