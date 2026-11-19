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
  warnings: string[];
}

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
        qty: col('numerator', 'y', 'quantity', 'qty', 'quantite', 'umrez', 'counter'),
        aun: col('aun', 'alt unit', 'alternative unit', 'meinh', 'aun measure'),
      };
      if (c.mat < 0 || c.gross < 0 || c.len < 0 || c.wid < 0 || c.hei < 0) continue;
      const byCode = new Map<string, CatalogItem>();
      const skipped: string[] = [];
      const warnings: string[] = [];
      for (const r of t.rows.slice(hr + 1)) {
        const code = (r[c.mat] ?? '').trim();
        if (!/^[A-Z0-9-]{5,}$/i.test(code)) continue;
        const desc = c.desc >= 0 ? (r[c.desc] ?? '').trim() : '';
        const aun = c.aun >= 0 ? (r[c.aun] ?? '').trim().toUpperCase() : '';
        if (aun === 'PL' || /layer|couche/i.test(r.join(' '))) continue; // une couche de palette n'est pas un colis
        const du = c.dunit >= 0 ? (r[c.dunit] ?? '').trim().toUpperCase() : 'MM';
        const k = du === 'CM' ? 1 : du === 'M' ? 100 : 0.1;
        const [L, W, H] = [num(r[c.len]), num(r[c.wid]), num(r[c.hei])].map((x) => Math.round(x * k * 10) / 10);
        const wk = c.wunit >= 0 && /^G$/i.test((r[c.wunit] ?? '').trim()) ? 0.001 : 1;
        const gross = num(r[c.gross]) * wk;
        const net = (c.net >= 0 ? num(r[c.net]) : 0) * wk || gross;
        const qty = Math.max(1, Math.round(c.qty >= 0 ? num(r[c.qty]) : aun === 'PAL' ? 0 : 1) || 1);
        if (!(L > 0 && W > 0 && H > 0) || !(gross > 0)) {
          skipped.push(`${code} ${desc}`.trim());
          continue;
        }
        const pallet = qty > 1 && Math.max(L, W) >= 100 && Math.min(L, W) >= 60;
        const v: PackVariant = {
          qtyPerPackage: qty,
          packageType: pallet ? 'Palette' : 'Carton',
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
      // volume indiqué ≠ dimensions : on garde les dimensions, on le signale
      for (const r of t.rows.slice(hr + 1)) {
        const vc = h.findIndex((x) => x === 'volume');
        const code = (r[c.mat] ?? '').trim();
        const it = byCode.get(code);
        if (vc < 0 || !it || it.qtyPerPackage !== 1) continue;
        const vu = (r[h.findIndex((x) => x === 'volume unit')] ?? 'CDM').trim().toUpperCase();
        const vol = num(r[vc]) * (vu === 'M3' ? 1 : vu === 'CDM' || vu === 'DM3' || vu === 'L' ? 0.001 : 0.001);
        if (vol > 0 && Math.abs(vol - it.volumePerPackage) > it.volumePerPackage * 0.1)
          warnings.push(`${code} : volume SAP ${Math.round(vol * 1000 * 10) / 10} dm³ ≠ dimensions ${Math.round(it.volumePerPackage * 1000 * 10) / 10} dm³ (dimensions retenues)`);
      }
      if (byCode.size || skipped.length) return { items: [...byCode.values()], skipped, warnings };
    }
  }
  return null;
}
