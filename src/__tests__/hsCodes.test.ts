import { describe, expect, it } from 'vitest';
import { suggestHs } from '../lib/hsCodes';
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
  it('aucune proposition plutôt qu’une fausse : réservoir GT', () => expect(suggestHs('GT-U+ 200 PN10 R1 1/4 V')).toBeNull());
});
