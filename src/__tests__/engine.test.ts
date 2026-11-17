import { describe, expect, it } from 'vitest';
import { chooseVariant, generatePackingList, parsePastedRequests } from '../lib/generate';
import { CATALOG, PUMP, req } from './fixtures';

const gen = (lines: ReturnType<typeof req>[], strategy: 'smart' | 'grundfos' = 'smart') =>
  generatePackingList(CATALOG, lines, { consolidate: true, strategy });

describe('choix de l’emballage', () => {
  it('reprend un envoi réel quand la quantité a déjà été expédiée telle quelle', () => {
    const r = chooseVariant(PUMP, 4);
    expect(r.item.qtyPerPackage).toBe(4);
    expect(r.item.height).toBe(85);
    expect(r.confidence).toBe('observed');
  });

  it('remplit les palettes avant d’en commencer une autre (7 = 6 + 1)', () => {
    const pl = gen([req('P-100', 7)]);
    expect(pl.packages.map((p) => p.contents[0].quantity)).toEqual([6, 1]);
    expect(pl.packages[0].height).toBe(117);
  });

  it('palette incomplète : interpolation entre deux envois réels et poids de palette entier', () => {
    const pl = gen([req('P-100', 5)]);
    expect(pl.packages).toHaveLength(1);
    expect(pl.packages[0].height).toBeGreaterThan(85);
    expect(pl.packages[0].height).toBeLessThan(117);
    // brut = 5 × 74,5 + 25 kg de palette
    expect(pl.packages[0].grossWeight).toBeCloseTo(5 * 74.5 + 25, 1);
  });
});

describe('lignes en double (audit, point 1)', () => {
  it('additionne un même article saisi sur deux lignes, par code puis par PN', () => {
    const pl = generatePackingList(CATALOG, [req('P-100', 3, 'a'), { id: 'b', code: '', pn: 'P-100', quantity: 3 }], { consolidate: true });
    expect(pl.lines).toHaveLength(1);
    expect(pl.lines[0].quantity).toBe(6);
    expect(pl.packages).toHaveLength(1);
    expect(pl.packages[0].height).toBe(117);
  });

  it('additionne aussi les codes inconnus, sans tenir compte de la casse', () => {
    const pl = gen([req('XYZ', 1, 'a'), req('xyz', 2, 'b')]);
    expect(pl.lines).toHaveLength(1);
    expect(pl.lines[0].quantity).toBe(3);
    expect(pl.lines[0].found).toBe(false);
  });
});

describe('regroupements', () => {
  it('optimisée : regroupe les petits colis dans un carton', () => {
    const pl = gen([req('A-1', 2), req('B-1', 2)]);
    expect(pl.packages).toHaveLength(1);
    expect(pl.packages[0].basis).toBe('grouped');
  });

  it('selon Grundfos : reproduit un regroupement déjà vu chez le fournisseur', () => {
    const pl = gen([req('A-1', 2), req('B-1', 2)], 'grundfos');
    expect(pl.packages.some((p) => p.groupSource === 'history')).toBe(true);
  });

  it('une palette pleine d’un article reste seule', () => {
    const pl = gen([req('P-100', 6), req('A-1', 1), req('B-1', 1)], 'grundfos');
    const full = pl.packages.find((p) => p.contents.some((c) => c.code === 'P-100'));
    expect(full?.contents).toHaveLength(1);
    expect(full?.height).toBe(117);
  });

  it('la palette de regroupement est au moins aussi longue que le plus long colis', () => {
    const pl = gen([req('L-1', 1), req('A-1', 1), req('B-1', 1)]);
    const g = pl.packages.find((p) => p.basis === 'grouped');
    if (g) expect(Math.max(g.length, g.width)).toBeGreaterThanOrEqual(160);
  });
});

describe('cohérence générale', () => {
  it('jamais de brut inférieur au net, ni de valeur non numérique', () => {
    for (const strategy of ['smart', 'grundfos'] as const)
      for (const q of [1, 2, 5, 13])
        for (const it of CATALOG) {
          const pl = gen([req(it.code, q)], strategy);
          for (const p of pl.packages) {
            expect(Number.isFinite(p.volume)).toBe(true);
            expect(p.grossWeight).toBeGreaterThanOrEqual(p.netWeight - 1e-6);
          }
        }
  });

  it('lit un collage Excel : code ⇥ PN ⇥ quantité', () => {
    expect(parsePastedRequests('P-100\t\t6\nA-1;3')).toEqual([
      { code: 'P-100', pn: '', quantity: 6 },
      { code: 'A-1', pn: '', quantity: 3 },
    ]);
  });
});
