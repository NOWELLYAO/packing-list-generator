import { describe, expect, it } from 'vitest';
import { isPieceUnit, readUserNumber, sanitizeCatalog } from '../lib/validate';
import { planLoad } from '../lib/loadPlan';
import { familyOf } from '../lib/drawing';
import { accuracySummary, blindTest } from '../lib/realCheck';
import { labelQrText } from '../lib/labels';
import { variantsOf } from '../lib/variants';
import { generatePackingList, isLongItem } from '../lib/generate';
import { formatNos, groupIdentical, scaleStrip } from '../lib/drawing';
import { packLabel } from '../lib/i18n';
import { parseSapPackingList, sapToCatalog } from '../lib/sapPackingList';
import { CATALOG, PUMP, req } from './fixtures';

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
    expect(p.dimCheck).toBe('inferred');
    expect(planLoad(pl.packages, 'auto', 'road')!.bins[0].placements).toHaveLength(1);
  });
});

describe('petit reliquat d’une grosse palette', () => {
  const item = {
    ...CATALOG[0],
    code: 'F-1',
    pn: 'F-1',
    description: 'Float switch test',
    variants: [{ qtyPerPackage: 50, packageType: 'Pallet', length: 120, width: 80, height: 54, volumePerPackage: 0.5184, netWeightPerUnit: 1.55, grossWeightPerUnit: 2.4, mixed: false, source: 'a', count: 1 }],
  };
  for (const strategy of ['smart', 'grundfos'] as const) {
    it(`${strategy} : 1 pièce part en carton, pas sur une palette de 50`, () => {
      const pl = generatePackingList([item], [req('F-1', 1)], { consolidate: true, strategy });
      expect(pl.packages).toHaveLength(1);
      expect(pl.packages[0].type).toBe('Carton');
      expect(pl.packages[0].grossWeight).toBeLessThan(5);
    });
  }
});

describe('contrôle des schémas (audit tailles)', () => {
  it('un « EURO PAL » de 48 × 36 cm est dessiné comme un carton', () => {
    expect(familyOf('EURO PAL', { length: 48, width: 36, height: 55 })).toBe('carton');
    expect(familyOf('PALPLATE', { length: 120, width: 80, height: 60 })).toBe('pallet');
    expect(familyOf('GIN', { length: 38, width: 36, height: 18 })).toBe('carton');
  });
  it('un relevé aberrant (2026 pièces par colis, sans dimensions) est écarté', () => {
    const item = {
      ...CATALOG[0],
      variants: [
        { qtyPerPackage: 25, packageType: 'Carton', length: 48, width: 36, height: 32, volumePerPackage: 0.055, netWeightPerUnit: 0.3, grossWeightPerUnit: 0.32, mixed: false, source: 'a', count: 2 },
        { qtyPerPackage: 2026, packageType: '300x200x', length: 0, width: 0, height: 0, volumePerPackage: 0, netWeightPerUnit: 0.0007, grossWeightPerUnit: 0.001, mixed: false, source: 'b', count: 1 },
      ],
    };
    expect(variantsOf(item).map((v) => v.qtyPerPackage)).toEqual([25]);
  });
  it('un colis élancé hors palette voyage couché', () => {
    const item = { ...CATALOG[0], code: 'T-1', pn: 'T-1', description: 'Tube test', variants: [{ qtyPerPackage: 1, packageType: 'Carton', length: 14, width: 12, height: 143, volumePerPackage: 0.024, netWeightPerUnit: 8, grossWeightPerUnit: 9, mixed: false, source: 'a', count: 1 }] };
    const p = generatePackingList([item], [req('T-1', 1)], { consolidate: true }).packages[0];
    expect([p.length, p.width, p.height]).toEqual([143, 14, 12]);
  });
});

describe('lecture SAP : n° de commande client en texte après la quantité', () => {
  const text = `Packing list 99999998
Hand. unit: Delivery: Pack.: Gross wt. KG. Nett. wt. KG: Vol.M3: Dimens. CM:
Pos: Material: Description: Cust. mat. no.: Quantity: Cust. order no.: Sales order:
657086010001 2024010906 PALLET 15,000 12,000 0,167 120X80X30
0020 11112222 Article test 7 N ° HY 0010 CN 2026 14701745
Total HU/Weight/Volume: 1 15,000 KG`;
  it('la quantité est 7, pas 2026', () => {
    const doc = parseSapPackingList(text.split('\n'));
    expect(doc.hus[0].positions[0].qty).toBe(7);
  });
});

describe('apprentissage : test à l’aveugle sur une PL réelle', () => {
  // PL réelle fictive : 6 pompes P-100 sur une palette identique à la base + 1 article inconnu
  const doc = {
    number: '90000001',
    globalOrigin: 'DK',
    warnings: [],
    hus: [
      { hu: '1', packType: 'PALPLATE', gross: 0, net: 0, volume: 0, dims: null, positions: [] },
      { hu: '2', packType: 'Carton', gross: 3, net: 2, volume: 0.02, dims: { l: 30, w: 20, h: 20 }, positions: [{ pos: '20', material: 'NEW-1', description: 'Nouveau', custMat: '', qty: 1, origin: '' }] },
    ],
  };
  const pump = CATALOG.find((c) => c.code === 'P-100')!;
  const pl6 = generatePackingList(CATALOG, [req('P-100', 6)], { consolidate: true, strategy: 'grundfos' });
  const p = pl6.packages[0];
  doc.hus[0] = { hu: '1', packType: 'PALPLATE', gross: p.grossWeight, net: p.netWeight, volume: p.volume, dims: { l: p.length, w: p.width, h: p.height }, positions: [{ pos: '10', material: 'P-100', description: pump.description, custMat: '', qty: 6, origin: 'DK' }] };
  it('prédiction identique à la réalité : 100/100, article inconnu exclu du test', () => {
    const r = blindTest(doc, CATALOG, 'test.pdf')!;
    expect(r.known).toBe(1);
    expect(r.unknown).toBe(1);
    expect(r.grundfos.exactPackages).toBe(1);
    expect(r.grundfos.score).toBe(100);
    expect(accuracySummary([r])!.average).toBe(100);
  });
  it('aucun article connu : pas de test (la base apprend simplement)', () => {
    expect(blindTest({ ...doc, hus: [doc.hus[1]] }, CATALOG, 'x.pdf')).toBeNull();
  });
});

describe('étiquettes de colis', () => {
  it('le QR code ne contient que des caractères lisibles par tous les lecteurs', () => {
    const pl = generatePackingList(CATALOG, [req('P-100', 7)], { consolidate: true });
    const t = labelQrText(pl, pl.packages[1], { reference: 'Réf. éàç' }, 'fr');
    expect(t).toMatch(/^COLIS 2\/2/);
    expect(/^[\x20-\x7e\n]*$/.test(t)).toBe(true);
  });
});

describe('cohérence physique (une fois pour toutes)', () => {
  const v = (o: Partial<import('../types').PackVariant>) => ({ qtyPerPackage: 1, packageType: 'CRATE', length: 240, width: 24, height: 32, volumePerPackage: 0.18, netWeightPerUnit: 40, grossWeightPerUnit: 70, mixed: false, source: 'a', count: 5, ...o });
  it('un relevé impossible (zéro perdu : 24 × 24 × 32 pour 67 kg) est écarté', () => {
    const item = { ...CATALOG[0], code: 'S-1', pn: 'S-1', description: 'SP test', variants: [v({}), v({ length: 24, count: 2, grossWeightPerUnit: 67 })] };
    const pl = generatePackingList([item], [req('S-1', 2)], { consolidate: true });
    expect(pl.packages.every((p) => p.length === 240)).toBe(true);
  });
  it('un relevé au poids aberrant (1 kg au lieu de 254 kg) est écarté', () => {
    const item = { ...CATALOG[0], code: 'H-1', pn: 'H-1', description: 'Booster test', variants: [v({ packageType: 'Pre-Pack', length: 109, width: 99, height: 123, netWeightPerUnit: 254, grossWeightPerUnit: 254 }), v({ packageType: 'Pre-Pack', length: 105, width: 80, height: 12, netWeightPerUnit: 1, grossWeightPerUnit: 1, count: 1 })] };
    expect(variantsOf(item)).toHaveLength(1);
  });
  it('article vu seulement en palette partagée : emballage repris d’un article du même modèle', () => {
    const shared = { ...CATALOG[0], code: 'Q-1', pn: 'Q-1', description: 'SQF 2.5-2 Rp 1', mixed: true, variants: [v({ packageType: 'PALPLATE', length: 0, width: 0, height: 0, volumePerPackage: 0.626, qtyPerPackage: 2, netWeightPerUnit: 5.15, grossWeightPerUnit: 7.08, mixed: true, packShare: 0.15 })] };
    const twin = { ...CATALOG[0], id: 'twin', code: 'Q-2', pn: 'Q-2', description: 'SQF 2.5-2 Rp 1 PARK', variants: [v({ packageType: 'Carton', length: 143, width: 14, height: 12, netWeightPerUnit: 8.9, grossWeightPerUnit: 9 })] };
    const p = generatePackingList([shared, twin], [req('Q-1', 1)], { consolidate: true }).packages[0];
    expect([p.length, p.width, p.height]).toEqual([143, 14, 12]);
    expect(p.grossWeight).toBeLessThan(10);
    expect(p.dimCheck).toBe('estimated');
  });
  it('une palette pèse toujours au moins le poids d’une palette vide', () => {
    const item = { ...CATALOG[0], code: 'L-9', pn: 'L-9', description: 'Coffret test', variants: [v({ packageType: 'Palette', length: 120, width: 80, height: 54, qtyPerPackage: 2, netWeightPerUnit: 27, grossWeightPerUnit: 30 })] };
    const p = generatePackingList([item], [req('L-9', 2)], { consolidate: true }).packages[0];
    expect(p.grossWeight - p.netWeight).toBeGreaterThanOrEqual(15);
  });
});

describe('palette dont seul le volume est connu', () => {
  it('une seule pompe (0,207 m³) : demi-palette 80 × 60 × 43, pas une 120 × 80 de 22 cm', () => {
    const item = { ...CATALOG[0], code: 'SL-1', pn: 'SL-1', description: 'Pompe test SL', variants: [{ qtyPerPackage: 1, packageType: 'PALLET', length: 0, width: 0, height: 0, volumePerPackage: 0.207, netWeightPerUnit: 96, grossWeightPerUnit: 116, mixed: false, source: 'a', count: 1 }] };
    const p = generatePackingList([item], [req('SL-1', 1)], { consolidate: true }).packages[0];
    expect([p.length, p.width, p.height]).toEqual([80, 60, 43]);
    expect(p.dimCheck).toBe('inferred');
  });
  it('un carton de réemballage reste signalé « à vérifier »', () => {
    const item = { ...CATALOG[0], code: 'F-2', pn: 'F-2', description: 'Flotteur test', variants: [{ qtyPerPackage: 50, packageType: 'Pallet', length: 120, width: 80, height: 54, volumePerPackage: 0.5184, netWeightPerUnit: 1.55, grossWeightPerUnit: 2.4, mixed: false, source: 'a', count: 1 }] };
    const p = generatePackingList([item], [req('F-2', 1)], { consolidate: true }).packages[0];
    expect(p.type).toBe('Carton');
    expect(p.dimCheck).toBe('estimated');
  });
});

describe('articles longs (pompes immergées)', () => {
  it('SQ, SQE, SQF, SP, MS sont reconnus comme longs', () => {
    for (const d of ['SQF 3A-10Rp 1', 'SQ 5-70 1.85kW', 'SQE 2-55', 'SP3A-25 Rp1¼', 'MS402 3x380']) expect(isLongItem({ ...CATALOG[0], description: d, variants: [] })).toBe(true);
    expect(isLongItem({ ...CATALOG[0], description: 'CR10-10 A-A-A-E', variants: [] })).toBe(false);
  });
  it('1 SQF d’une palette de 5 : carton long, pas un carton 60 × 40 × 40', () => {
    const item = { ...CATALOG[0], code: 'SQF-1', pn: 'SQF-1', description: 'SQF 3A-10Rp 1', variants: [{ qtyPerPackage: 5, packageType: 'Pallet', length: 122, width: 80, height: 32, volumePerPackage: 0.312, netWeightPerUnit: 10.9, grossWeightPerUnit: 15.4, mixed: false, source: 'a', count: 2 }] };
    const p = generatePackingList([item], [req('SQF-1', 1)], { consolidate: true }).packages[0];
    expect(p.type).toBe('Carton');
    expect(p.length).toBeGreaterThanOrEqual(110);
    expect(p.width).toBeLessThan(30);
    expect(p.dimCheck).toBe('estimated');
  });
});

describe('article vu seulement dans un carton mixte', () => {
  const src = 'test.pdf (PL 1) – colis mixte';
  const base = { unit: 'PCS', hsCode: '', origin: '', updatedAt: '', packageType: '600x400x', length: 60, width: 40, height: 63, volumePerPackage: 0.1512, mixed: true } as const;
  // carton 18 kg : 20 kits (0,4 kg chacun, connus par ailleurs) + 2 coffrets → part réelle des coffrets ≈ 5 kg chacun, pas 0,75
  const kitMixed = { ...base, qtyPerPackage: 20, netWeightPerUnit: 0.7188, grossWeightPerUnit: 0.75, packShare: 20 / 22, source: src, count: 1 };
  const kitOwn = { ...base, mixed: false, packageType: '300x200x', length: 30, width: 20, height: 27, volumePerPackage: 0.0162, qtyPerPackage: 5, netWeightPerUnit: 0.3, grossWeightPerUnit: 0.4, source: 'x', count: 2 };
  const boxMixed = { ...base, qtyPerPackage: 2, netWeightPerUnit: 0.7188, grossWeightPerUnit: 0.75, packShare: 2 / 22, source: src, count: 1 };
  const KIT = { ...kitOwn, id: 'k', code: 'KIT-1', pn: 'KIT-1', description: 'Kit test', coPacked: ['BOX-1'], variants: [kitOwn, kitMixed] };
  const BOX = { ...boxMixed, id: 'b', code: 'BOX-1', pn: 'BOX-1', description: 'Coffret test', coPacked: ['KIT-1'], variants: [boxMixed] };
  it('le poids des autres articles connus est retiré, et le coffret part dans un carton à sa taille', () => {
    const pl = generatePackingList([KIT, BOX], [req('BOX-1', 1)], { consolidate: true });
    const p = pl.packages[0];
    expect(p.grossWeight).toBeGreaterThan(4);
    expect(p.netWeight).toBeLessThanOrEqual(p.grossWeight);
    expect(p.length * p.width * p.height).toBeLessThan(60 * 40 * 63);
    expect(p.type).toBe('Carton');
  });
});

describe('base importée avec une ancienne version (part du colis mixte absente)', () => {
  const src = 'old.pdf (PL 2) – colis mixte';
  const base = { unit: 'PCS', hsCode: '', origin: '', updatedAt: '', packageType: '600x400x', length: 60, width: 40, height: 63, volumePerPackage: 0.1512, mixed: false } as const;
  const kitMixed = { ...base, qtyPerPackage: 20, netWeightPerUnit: 0.7188, grossWeightPerUnit: 0.75, source: src, count: 1 };
  const kitOwn = { ...base, packageType: '300x200x', length: 30, width: 20, height: 27, volumePerPackage: 0.0162, qtyPerPackage: 5, netWeightPerUnit: 0.3, grossWeightPerUnit: 0.4, source: 'x', count: 2 };
  const boxMixed = { ...base, qtyPerPackage: 2, netWeightPerUnit: 0.7188, grossWeightPerUnit: 0.75, source: src, count: 1 };
  // ni « part du colis », ni liste des articles du même colis : seule la source les relie
  const KIT = { ...kitOwn, id: 'k', code: 'KIT-2', pn: 'KIT-2', description: 'Kit test', variants: [kitOwn, kitMixed] };
  const BOX = { ...boxMixed, id: 'b', code: 'BOX-2', pn: 'BOX-2', description: 'Coffret test', variants: [boxMixed] };
  it('la part est reconstituée : pas un demi-carton mixte de 0,78 kg', () => {
    const p = generatePackingList([KIT, BOX], [req('BOX-2', 1)], { consolidate: true }).packages[0];
    expect(p.type).toBe('Carton');
    expect(p.grossWeight).toBeGreaterThan(4);
    expect(p.height).toBeLessThan(63);
  });
});

describe('emballages saisis depuis la fiche article (SAP)', () => {
  const S = 'Fiche article fabricant (saisie)';
  const pc = { qtyPerPackage: 1, packageType: 'Carton', length: 50.4, width: 35.2, height: 31.1, volumePerPackage: 0.0552, netWeightPerUnit: 19.52, grossWeightPerUnit: 21.18, mixed: false, source: S, count: 10 };
  const pal = { qtyPerPackage: 12, packageType: 'Palette', length: 120, width: 80, height: 107.7, volumePerPackage: 1.0339, netWeightPerUnit: 19.52, grossWeightPerUnit: 23.0117, mixed: false, source: S, count: 10 };
  const M = { ...pc, id: 'm', code: 'MAG-1', pn: 'MAG-1', description: 'Circulateur test', unit: 'PCS', hsCode: '', origin: '', updatedAt: '', variants: [pc, pal] };
  const gen = (q: number) => generatePackingList([M], [req('MAG-1', q)], { consolidate: true }).packages;
  it('1 → son carton ; 12 → la palette SAP', () => {
    expect(gen(1)[0]).toMatchObject({ length: 50.4, width: 35.2, height: 31.1, grossWeight: 21.18 });
    expect(gen(12)).toHaveLength(1);
    expect(gen(12)[0].grossWeight).toBeCloseTo(276.14, 1);
  });
  it('13 → palette de 12 + 1 carton individuel (pas un carton de réemballage)', () => {
    const p = gen(13);
    expect(p).toHaveLength(2);
    expect(p[1]).toMatchObject({ length: 50.4, grossWeight: 21.18 });
  });
  it('4 → une couche sur palette (base + 1 carton de haut)', () => {
    const p = gen(4);
    expect(p).toHaveLength(1);
    expect(p[0].height).toBeLessThanOrEqual(47);
  });
});

describe('fiche corrigée à la main incohérente', () => {
  const base = { unit: 'PCS', hsCode: '', origin: '', updatedAt: '', source: 'x', manual: true, mixed: false } as const;
  it('quantité par colis lue comme une date (2026) avec les dimensions d’une unité → 1 par colis', () => {
    const A = { ...base, id: 'a', code: 'AG-1', pn: 'AG-1', description: 'Agitateur', qtyPerPackage: 2026, packageType: 'PALPLATE', length: 140, width: 30, height: 30, volumePerPackage: 0.682, netWeightPerUnit: 17, grossWeightPerUnit: 19 };
    const p = generatePackingList([A], [req('AG-1', 1)], { consolidate: true }).packages[0];
    expect(p.grossWeight).toBeLessThan(25);
    expect(p.height).toBe(30);
  });
  it('volume seul (pas de dimensions) → jamais 0 × 0 × 0', () => {
    const B = { ...base, id: 'b', code: 'VO-1', pn: 'VO-1', description: 'Pompe', qtyPerPackage: 4, packageType: 'PALPLATE', length: 0, width: 0, height: 0, volumePerPackage: 0.48, netWeightPerUnit: 29, grossWeightPerUnit: 31.6 };
    const p = generatePackingList([B], [req('VO-1', 4)], { consolidate: true }).packages[0];
    expect(p.length * p.width * p.height).toBeGreaterThan(0);
  });
});

describe('fichier de corrections chargé dans la base', () => {
  it('une fiche corrigée plus récente remplace une fiche corrigée à la main ; resetManual la remet en automatique', async () => {
    const { mergeCatalog } = await import('../lib/normalize');
    const old = { ...PUMP, manual: true, qtyPerPackage: 2026, updatedAt: '2026-01-01' };
    const fix = { ...PUMP, manual: true, qtyPerPackage: 1, updatedAt: '2026-02-01' };
    expect(mergeCatalog([old], [fix]).catalog[0].qtyPerPackage).toBe(1);
    const reset = { ...PUMP, manual: false, resetManual: true, updatedAt: '2026-03-01' };
    expect(mergeCatalog([old], [reset]).catalog[0].manual).toBe(false);
  });
});

describe('import d’une extraction de fiches article SAP (Excel)', () => {
  it('lit Material / poids / L × l × H en mm, ignore les lignes sans dimensions, signale un volume incohérent', async () => {
    const { parseSapMaster } = await import('../lib/sapMaster');
    const rows = [
      ['Material', 'Description', 'Gross Weight', 'Net Weight', 'Unit of Weight', 'Volume', 'Volume Unit', 'Length', 'Width', 'Height', 'Unit'],
      ['10000001', 'Pompe test', '17.750', '14.750', 'KG', '34.761', 'CDM', '660.000', '260.000', '280.000', 'MM'],
      ['10000002', 'Pompe longue', '10.000', '8.200', 'KG', '24.156', 'CDM', '1,426.000', '121.000', '140.000', 'MM'],
      ['10000003', 'Kit sans cotes', '0.840', '0.840', 'KG', '0', '', '0', '0', '0', ''],
      ['10000004', 'Flotteur', '1.5', '1.38', 'KG', '5.178', 'CDM', '28.2', '17', '10.8', 'CM'],
    ];
    const r = parseSapMaster([{ name: 'Sheet1', rows }])!;
    expect(r.items.map((i) => [i.code, i.length, i.width, i.height])).toEqual([
      ['10000001', 66, 26, 28],
      ['10000002', 142.6, 12.1, 14],
      ['10000004', 28.2, 17, 10.8],
    ]);
    expect(r.items[0].grossWeightPerUnit).toBe(17.75);
    expect(r.skipped[0]).toContain('10000003');
    expect(r.warnings[0]).toContain('10000001');
  });
});
