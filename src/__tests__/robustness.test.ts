import { describe, expect, it } from 'vitest';
import { isPieceUnit, readUserNumber, sanitizeCatalog } from '../lib/validate';
import { planLoad } from '../lib/loadPlan';
import { generatePackingList } from '../lib/generate';
import { formatNos, groupIdentical, scaleStrip } from '../lib/drawing';
import { packLabel } from '../lib/i18n';
import { parseSapPackingList, sapToCatalog } from '../lib/sapPackingList';
import { CATALOG, req } from './fixtures';

describe('saisie des nombres (audit, point 2)', () => {
  it.each([
    ['1 234,5', 1234.5],
    ['1 234,5', 1234.5],
    ['1234.5', 1234.5],
    ['1,234.5', 1234.5],
    ['12,', 12],
    ['0,75', 0.75],
  ])('« %s » → %s', (s, n) => expect(readUserNumber(s)).toBeCloseTo(n));
  it('texte illisible → NaN (jamais 0 en silence)', () => {
    expect(readUserNumber('abc')).toBeNaN();
    expect(readUserNumber('12 kg')).toBeNaN();
  });
});

describe('fichier de base JSON (audit, point 3)', () => {
  it('rejette les éléments sans code ni PN et complète les champs', () => {
    const r = sanitizeCatalog([{ foo: 1 }, null, { code: 'X1', netWeightPerUnit: '2,5', grossWeightPerUnit: 1 }]);
    expect(r.rejected).toBe(2);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].netWeightPerUnit).toBe(2.5);
    expect(r.items[0].grossWeightPerUnit).toBe(2.5); // brut ramené au moins au net
    expect(r.items[0].description).toBe('');
  });
  it('un fichier qui n’est pas une liste ne donne aucun article', () => {
    expect(sanitizeCatalog({ a: 1 }).items).toHaveLength(0);
  });
});

describe('quantités à la pièce (audit, point 11)', () => {
  it('reconnaît les unités comptées à la pièce', () => {
    expect(isPieceUnit('PCS')).toBe(true);
    expect(isPieceUnit('set')).toBe(true);
    expect(isPieceUnit('M')).toBe(false);
    expect(isPieceUnit('KG')).toBe(false);
  });
});

describe('plan de chargement (audit, point 6)', () => {
  const pl = generatePackingList(CATALOG, [req('C-1', 2), req('P-100', 30), req('A-1', 4)], { consolidate: true });
  for (const family of ['sea', 'road'] as const) {
    const plan = planLoad(pl.packages, 'auto', family)!;
    it(`${family} : uniquement des véhicules de la bonne famille`, () => {
      expect(plan.bins.every((b) => b.vehicle.family === family)).toBe(true);
    });
    it(`${family} : aucun colis oublié, aucun chevauchement, aucun dépassement`, () => {
      expect(plan.unplaced).toHaveLength(0);
      const placed = plan.bins.flatMap((b) => b.placements);
      expect(placed).toHaveLength(pl.packages.filter((p) => p.length > 0).length);
      for (const b of plan.bins) {
        expect(b.weight).toBeLessThanOrEqual(b.vehicle.payload);
        for (const [i, a] of b.placements.entries()) {
          expect(a.x + a.l).toBeLessThanOrEqual(b.vehicle.length + 0.01);
          expect(a.y + a.w).toBeLessThanOrEqual(b.vehicle.width + 0.01);
          for (const c of b.placements.slice(i + 1)) {
            const overlap = a.x < c.x + c.l - 0.01 && c.x < a.x + a.l - 0.01 && a.y < c.y + c.w - 0.01 && c.y < a.y + a.w - 0.01;
            expect(overlap).toBe(false);
          }
        }
      }
    });
  }
  it('maritime : complète avec un 20′ plutôt qu’un 40′ de trop', () => {
    const many = generatePackingList(CATALOG, [req('P-100', 6 * 28)], { consolidate: true }); // 28 palettes : plus qu'un 40′
    const plan = planLoad(many.packages, 'auto', 'sea')!;
    expect(plan.summary).toMatch(/40'/);
    expect(plan.summary).toMatch(/20'/);
  });
});

describe('grosses PL (audit, point 7)', () => {
  const big = generatePackingList(CATALOG, [req('P-100', 6 * 40), req('A-1', 3), req('L-1', 2)], { consolidate: true });
  it('les colis identiques sont regroupés pour l’affichage', () => {
    const groups = groupIdentical(big.packages);
    expect(groups.length).toBeLessThan(big.packages.length);
    expect(groups[0].nos.length).toBe(40);
  });
  it('la vue à l’échelle reste valide avec beaucoup de colis', () => {
    const pic = scaleStrip(big.packages, '#0B4F8A', { cm: 'cm', kg: 'kg', packageWord: 'Colis', locale: 'fr-FR' });
    for (const s of pic.shapes) if (s.kind === 'circle') expect(s.r).toBeGreaterThan(0);
  });
  it('numérotation compacte', () => expect(formatNos([1, 2, 3, 5, 7, 8])).toBe('1 à 3, 5, 7, 8'));
});

describe('traductions des emballages', () => {
  it.each([
    ['PALPLATE', 'Palette à plateau', 'Pallet with top plate'],
    ['CRATE', 'Caisse', 'Crate'],
    ['480 x 38', 'Carton', 'Carton'],
    ['Woode', 'Caisse bois', 'Wooden case'],
  ])('%s', (raw, fr, en) => {
    expect(packLabel(raw, 'fr')).toBe(fr);
    expect(packLabel(raw, 'en')).toBe(en);
  });
});

describe('lecture des PL au format SAP', () => {
  const text = `Packing list 99999999
Hand. unit: Delivery: Pack.: Gross wt. KG. Nett. wt. KG: Vol.M3: Dimens. CM:
Pos: Material: Description: Cust. mat. no.: Quantity: Cust. order no.: Sales order:
657086010004 2024356374 CRATE 1.648,000 1.608,000 7,020 120X260X225
0010 99843986 Groupe test 0,500 PO-1 14701353
Country of Origin: IT - Italy
657086010004 2024356375 PALLET 81,000 61,000 0,168 1X0X1
0020 12345678 Pompe test 1 PO-1 14701353
Total HU/Weight/Volume: 2 1.729,000 KG`;
  const doc = parseSapPackingList(text.split('\n'));
  it('lit colis, poids au format européen, dimensions et quantité fractionnaire', () => {
    expect(doc.number).toBe('99999999');
    expect(doc.hus).toHaveLength(2);
    expect(doc.hus[0].gross).toBe(1648);
    expect(doc.hus[0].dims).toEqual({ l: 120, w: 260, h: 225 });
    expect(doc.hus[0].positions[0].qty).toBe(0.5);
    expect(doc.hus[0].positions[0].origin).toBe('IT');
  });
  it('ignore des dimensions « 1X0X1 » non renseignées et garde le volume', () => {
    expect(doc.hus[1].dims).toBeNull();
    const items = sapToCatalog(doc, 'test.pdf');
    expect(items[1].item.volumePerPackage).toBeCloseTo(0.168);
  });
});

describe('contrôle qualité des données (point 9)', () => {
  it('signale une densité impossible et un emballage non pesé, pas un article normal', async () => {
    const { itemIssues, hasError } = await import('../lib/quality');
    const { PUMP, PART_A } = await import('./fixtures');
    const dense = { ...PART_A, id: 'd', length: 15, width: 20, height: 13, netWeightPerUnit: 80, grossWeightPerUnit: 81 };
    expect(hasError(dense)).toBe(true);
    expect(itemIssues(dense).some((i) => i.code === 'density')).toBe(true);
    const noTare = { ...PUMP, id: 't', qtyPerPackage: 1, packageType: 'Pallet', netWeightPerUnit: 900, grossWeightPerUnit: 900, variants: undefined };
    expect(itemIssues(noTare).some((i) => i.code === 'tare')).toBe(true);
    expect(hasError(PUMP)).toBe(false);
    expect(hasError(PART_A)).toBe(false);
  });
});

describe('export des schémas en image (point 13)', () => {
  it('produit un SVG autonome et valide', async () => {
    const { pictureToSvg, packageDrawing } = await import('../lib/drawing');
    const { PUMP } = await import('./fixtures');
    const svg = pictureToSvg(packageDrawing({ no: 1, type: 'PALPLATE', length: 120, width: 80, height: 117, grossWeight: 474 }, '#0B4F8A', { cm: 'cm', kg: 'kg', packageWord: 'Colis', locale: 'fr-FR' }));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('120 cm');
    expect(svg).not.toMatch(/NaN|undefined/);
    expect(PUMP.code).toBe('P-100');
  });
});

describe('configuration dont seul le volume est connu', () => {
  const base = CATALOG[0];
  const item = {
    ...base,
    code: 'V-1',
    pn: 'V-1',
    description: 'Pompe test',
    variants: [
      { qtyPerPackage: 6, packageType: 'PALPLATE', length: 120, width: 80, height: 110, volumePerPackage: 1.056, netWeightPerUnit: 36, grossWeightPerUnit: 40, mixed: false, source: 'a', count: 2 },
      { qtyPerPackage: 4, packageType: 'PALPLATE', length: 0, width: 0, height: 0, volumePerPackage: 0.768, netWeightPerUnit: 36, grossWeightPerUnit: 42.5, mixed: false, source: 'b', count: 1 },
    ],
  };
  it('reconstitue L × l × H à partir du volume et de l’empreinte connue', () => {
    const pl = generatePackingList([item], [req('V-1', 4)], { consolidate: true });
    const p = pl.packages[0];
    expect([p.length, p.width, p.height]).toEqual([120, 80, 80]);
    expect(planLoad(pl.packages, 'auto', 'road')!.bins[0].placements).toHaveLength(1);
  });
});
