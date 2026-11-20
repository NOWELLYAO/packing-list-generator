import type { CatalogItem, PackVariant, ParsedTable } from '../types';
import { readUserNumber } from './validate';
import { SAP_SOURCE } from './variants';
import { uid } from './normalize';

/**
 * Extraction des données article SAP (MM03 « Unités de mesure », export MARM…) :
 * Material, Description, Gross Weight, Net Weight, Volume, Length, Width, Height, Unit (MM / CM / M).
 * Une ligne = un emballage (la pièce, ou la palette si une colonne de quantité est présente).
 */

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export interface SapMasterResult {
  items: CatalogItem[];
  skipped: string[];
  /** lignes aux valeurs impossibles (densité, poids, dimensions) */
  rejected: string[];
  warnings: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** facteur vers m³ */
const VOL_UNIT: Record<string, number> = { M3: 1, CDM: 0.001, DM3: 0.001, L: 0.001, CCM: 1e-6, CM3: 1e-6, MMQ: 1e-9, MM3: 1e-9, HL: 0.1, FT3: 0.0283168, GLL: 0.0037854, GAL: 0.0037854 };

function num(s: string | undefined): number {
  if (s === undefined || s.trim() === '') return 0;
  const n = readUserNumber(s.trim());
  return Number.isFinite(n) ? n : 0;
}

export function parseSapMaster(tables: ParsedTable[]): SapMasterResult | null {
  for (const t of tables) {
    for (let hr = 0; hr < Math.min(10, t.rows.length); hr++) {
      const h = t.rows[hr].map(norm);
      const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
      const c = {
        mat: col('material', 'material number', 'matnr', 'article', 'code article'),
        desc: col('description', 'material description', 'descr', 'designation'),
        gross: col('gross weight', 'poids brut', 'brgew'),
        net: col('net weight', 'poids net', 'ntgew'),
        wunit: col('unit of weight', 'weight unit', 'gewei'),
        len: col('length', 'longueur', 'laeng'),
        wid: col('width', 'largeur', 'breit'),
        hei: col('height', 'hauteur', 'hoehe'),
        dunit: col('unit', 'unit of dimension', 'meabm', 'unite'),
        vol: col('volume', 'volum'),
        vunit: col('volume unit', 'voleh'),
        qty: col('numerator', 'y', 'quantity', 'qty', 'quantite', 'umrez', 'counter'),
        aun: col('aun', 'alt unit', 'alternative unit', 'meinh', 'aun measure'),
      };
      if (c.mat < 0 || c.gross < 0 || c.len < 0 || c.wid < 0 || c.hei < 0) continue;
      const byCode = new Map<string, CatalogItem>();
      const skipped: string[] = [];
      const rejected: string[] = [];
      const warnings: string[] = [];
      for (const r of t.rows.slice(hr + 1)) {
        const code = (r[c.mat] ?? '').trim();
        if (!/^[A-Z0-9-]{5,}$/i.test(code)) continue;
        const desc = c.desc >= 0 ? (r[c.desc] ?? '').trim() : '';
        const aun = c.aun >= 0 ? (r[c.aun] ?? '').trim().toUpperCase() : '';
        if (aun === 'PL' || /layer|couche/i.test(r.join(' '))) continue; // une couche de palette n'est pas un colis
        const du = c.dunit >= 0 ? (r[c.dunit] ?? '').trim().toUpperCase() : 'MM';
        const k = du === 'CM' ? 1 : du === 'M' ? 100 : 0.1;
        let [L, W, H] = [num(r[c.len]), num(r[c.wid]), num(r[c.hei])].map((x) => x * k);
        // volume SAP (unité propre) : sert à repérer une unité de dimensions mal saisie (MM au lieu de CM…)
        const vs = c.vol >= 0 ? num(r[c.vol]) * (VOL_UNIT[(c.vunit >= 0 ? r[c.vunit] ?? '' : 'CDM').trim().toUpperCase()] ?? 0) : 0;
        const vd = (L * W * H) / 1e6;
        const close = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= b * 0.15;
        if (vs > 0 && vd > 0 && !close(vd, vs)) {
          const sc = [10, 0.1, 100, 0.01].find((f) => close(vd * f ** 3, vs) && Math.max(L, W, H) * f <= 1500 && Math.min(L, W, H) * f >= 0.5);
          if (sc) {
            [L, W, H] = [L, W, H].map((x) => x * sc);
            warnings.push(`${code} : dimensions converties (unité SAP probablement fausse, volume ${round1(vs * 1000)} dm³)`);
          } else warnings.push(`${code} : volume SAP ${round1(vs * 1000)} dm³ ≠ dimensions ${round1(vd * 1000)} dm³ (dimensions retenues)`);
        }
        [L, W, H] = [L, W, H].map((x) => Math.round(x * 10) / 10);
        const wu = c.wunit >= 0 ? (r[c.wunit] ?? '').trim().toUpperCase() : 'KG';
        const wk = wu === 'G' ? 0.001 : wu === 'LB' ? 0.4536 : wu === 'T' || wu === 'TO' ? 1000 : 1;
        const gross = num(r[c.gross]) * wk;
        const net = (c.net >= 0 ? num(r[c.net]) : 0) * wk || gross;
        const qty = Math.max(1, Math.round(c.qty >= 0 ? num(r[c.qty]) : aun === 'PAL' ? 0 : 1) || 1);
        if (!(L > 0 && W > 0 && H > 0) || !(gross > 0)) {
          skipped.push(`${code} ${desc}`.trim());
          continue;
        }
        // fiches SAP physiquement impossibles : écartées (la donnée actuelle de la base est conservée)
        const vol = (L * W * H) / 1e6;
        const dens = gross / vol;
        const why =
          Math.max(L, W, H) < 2 && gross > 1 ? 'dimensions de 1 mm'
          : dens > 3000 ? `${round1(gross)} kg dans ${round1(vol * 1000)} dm³`
          : vol > 0.03 && gross < (0.3 + vol * 8) * 0.5 ? `${gross} kg pour un colis de ${round1(vol * 1000)} dm³`
          : '';
        if (why) {
          rejected.push(`${code} ${desc} (${why})`.trim());
          continue;
        }
        const pallet = qty > 1 && Math.max(L, W) >= 100 && Math.min(L, W) >= 60;
        const v: PackVariant = {
          qtyPerPackage: qty,
          // pièce seule : empreinte de palette → palette ; lourde ou très longue (pompe immergée…) → caisse
          packageType:
            pallet || (qty === 1 && Math.max(L, W) >= 100 && Math.min(L, W) >= 60) ? 'Palette' : qty === 1 && gross >= 50 ? 'Caisse' : 'Carton',
          length: Math.max(L, W),
          width: Math.min(L, W),
          height: H,
          volumePerPackage: Math.round(((L * W * H) / 1e6) * 10000) / 10000,
          netWeightPerUnit: Math.round((Math.min(net, gross) / qty) * 10000) / 10000,
          grossWeightPerUnit: Math.round((gross / qty) * 10000) / 10000,
          mixed: false,
          source: SAP_SOURCE,
          count: 10,
        };
        const it = byCode.get(code);
        if (it) {
          it.variants = [...(it.variants ?? []).filter((x) => x.qtyPerPackage !== qty), v];
          continue;
        }
        byCode.set(code, {
          id: uid(),
          code,
          pn: code,
          description: desc,
          unit: 'PCS',
          ...v,
          hsCode: '',
          origin: '',
          updatedAt: new Date().toISOString(),
          variants: [v],
        } as CatalogItem);
      }
      if (byCode.size || skipped.length) return { items: [...byCode.values()], skipped, rejected, warnings };
    }
  }
  return null;
}
