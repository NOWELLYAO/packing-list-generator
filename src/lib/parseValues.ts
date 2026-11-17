/** Convertit "1 234,56", "1,234.56", "12kg", "3.5" en nombre. NaN si vide/illisible. */
export function parseNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim();
  if (!s) return NaN;
  s = s.replace(/[^\d.,\-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // le dernier séparateur est le séparateur décimal
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const parts = s.split(',');
    // "1,234" (milliers) vs "1,5" (décimal)
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0'))
      s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (lastDot > -1 && s.split('.').length > 2) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

export type Dims = { l: number; w: number; h: number; unit: 'mm' | 'cm' | 'm' | null };

/** Lit "120x80x100", "120 X 80 X 100 cm", "1.2*0.8*1.0 m", "120/80/100" */
export function parseDimensions(v: unknown): Dims | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s) return null;
  const nums = s.match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length < 3) return null;
  if (!/[x×*\/]|\s/.test(s)) return null;
  const [l, w, h] = nums.slice(0, 3).map((n) => parseFloat(n.replace(',', '.')));
  let unit: Dims['unit'] = null;
  if (/mm/.test(s)) unit = 'mm';
  else if (/cm/.test(s)) unit = 'cm';
  else if (/\bm\b|\dm$/.test(s)) unit = 'm';
  return { l, w, h, unit };
}

/** Convertit en cm. Si unité inconnue : heuristique sur la taille des valeurs. */
export function toCm(value: number, unit: 'mm' | 'cm' | 'm' | null, sample: number[] = [value]): number {
  if (!Number.isFinite(value)) return 0;
  let u = unit;
  if (!u) {
    const max = Math.max(...sample.filter(Number.isFinite));
    if (max <= 6 && sample.some((x) => x % 1 !== 0)) u = 'm'; // 1.2 x 0.8 x 1.0
    else if (max >= 400) u = 'mm'; // 1200 x 800 x 1000
    else u = 'cm';
  }
  if (u === 'mm') return value / 10;
  if (u === 'm') return value * 100;
  return value;
}

export const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
};
