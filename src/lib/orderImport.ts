import type { CatalogItem } from '../types';
import { detectHeaderRow, detectMapping } from './detect';
import { parseNumber } from './parseValues';
import { modelKey } from './generate';

/**
 * Bon de commande client (Excel, PDF, photo) → lignes article + quantité.
 * Les articles sont reconnus par leur code ou leur PN dans la base, à défaut par leur désignation.
 */
export interface OrderLine {
  code: string;
  pn: string;
  quantity: number;
  description: string;
  /** comment l'article a été reconnu */
  match: 'code' | 'designation' | 'inconnu';
  /** texte de la ligne d'origine, pour vérifier */
  raw: string;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const UNIT_RE = /^(PCS?|PCE|PC\.|EA|EACH|UN|UNIT[EÉ]?S?|U|ST|STK|PI[EÈ]CES?|PZ|NOS?|SET|KIT)\.?$/i;
// code produit Grundfos plausible : 8 chiffres, ou 2-4 chiffres + lettres + chiffres (05001K21, 14A21912)
const LOOKS_CODE = /^(\d{8}|\d{2,4}[A-Z]{1,2}\d{2,4}[A-Z0-9]?)$/;

function asNumber(tok: string): number | null {
  const t = tok.trim();
  if (!/^\d{1,6}([.,]\d{1,3})?$/.test(t) && !/^\d{1,3}([ ., ]\d{3})+([.,]\d{1,3})?$/.test(t)) return null;
  return qtyNumber(t);
}

/** « 6,000 » ou « 6.000 » dans une colonne de quantités : 6 pièces (format SAP), pas 6 000 */
function qtyNumber(t: string): number | null {
  const s = t.trim();
  const m = s.match(/^(\d{1,5})[.,]000$/);
  if (m) return Number(m[1]);
  const n = parseNumber(s);
  return Number.isFinite(n) ? n : null;
}

/** quantité d'une ligne sans colonne « Quantité » reconnue */
function guessQuantity(tokens: string[], codeIdx: number): number | null {
  const after = tokens.slice(codeIdx + 1);
  // 1) nombre suivi d'une unité (6 PCS, 2 PCE…)
  for (let i = 0; i < after.length - 1; i++) {
    const n = asNumber(after[i]);
    if (n !== null && n > 0 && UNIT_RE.test(after[i + 1])) return n;
  }
  // 1 bis) collé à l'unité (6PCS)
  for (const t of after) {
    const m = t.match(/^(\d{1,5})(PCS?|PCE|EA|UN|U)$/i);
    if (m) return Number(m[1]);
  }
  // 2) premier nombre après la désignation (dernier mot contenant une lettre) : les suivants sont les prix
  let lastAlpha = -1;
  after.forEach((t, i) => {
    if (/[A-Za-zÀ-ÿ]/.test(t) && asNumber(t) === null) lastAlpha = i;
  });
  for (const t of after.slice(lastAlpha + 1)) {
    const n = asNumber(t);
    if (n !== null && n > 0 && n < 100000) return n;
  }
  // 3) nombre avant le code (colonne Qté en premier, mais pas un n° de poste 10, 20, 0010…)
  for (const t of tokens.slice(0, codeIdx).reverse()) {
    const n = asNumber(t);
    if (n !== null && n > 0 && !/^0\d/.test(t) && !(n % 10 === 0 && codeIdx > 1)) return n;
  }
  return null;
}

export function extractOrder(tables: string[][][], catalog: CatalogItem[]): OrderLine[] {
  const byKey = new Map<string, CatalogItem>();
  for (const it of catalog) {
    for (const k of [it.code, it.pn]) {
      const n = norm(k ?? '');
      if (n.length >= 5 && !byKey.has(n)) byKey.set(n, it);
    }
  }
  // désignations : modèle (2 premiers mots) unique dans la base, ex. « CR10-6 A-FJ-A-E-HQQE »
  const byModel = new Map<string, CatalogItem | null>();
  for (const it of catalog) {
    const k = norm(modelKey(it.description ?? ''));
    if (k.length >= 6) byModel.set(k, byModel.has(k) ? null : it);
  }

  const out: OrderLine[] = [];
  for (const rows0 of tables) {
    const rows = rows0.filter((r) => r.some((c) => c.trim()));
    if (!rows.length) continue;
    const hr = detectHeaderRow(rows);
    const m = detectMapping(rows[hr] ?? [], rows[hr + 1] ?? []);
    // vraie ligne d'en-tête : plusieurs cellules, des mots, aucun article
    const head = rows[hr] ?? [];
    const isHeader =
      head.filter((c) => c.trim()).length >= 2 &&
      head.filter((c) => /[A-Za-zÀ-ÿ]{2}/.test(c) && !/\d{3}/.test(c)).length >= 2 &&
      !head.some((c) => c.split(/\s+/).some((t) => byKey.has(norm(t))));
    const hasQtyCol = isHeader && m.quantity !== undefined;
    for (let ri = 0; ri < rows.length; ri++) {
      if (hasQtyCol && ri <= hr) continue;
      const row = rows[ri];
      const raw = row.filter(Boolean).join('  ').trim();
      if (!raw) continue;
      // tokens avec leur cellule d'origine
      const tokens: string[] = [];
      for (const c of row) tokens.push(...c.split(/\s+/).filter(Boolean));
      // 1) code ou PN connu
      let codeIdx = tokens.findIndex((t) => byKey.has(norm(t)));
      let item = codeIdx >= 0 ? byKey.get(norm(tokens[codeIdx]))! : undefined;
      let match: OrderLine['match'] = 'code';
      // 2) désignation connue
      if (!item) {
        for (let i = 0; i < tokens.length - 1 && !item; i++) {
          const k = norm(tokens[i] + tokens[i + 1]);
          const hit = byModel.get(k);
          if (hit) {
            item = hit;
            codeIdx = i + 1;
            match = 'designation';
          }
        }
      }
      // 3) code d'apparence Grundfos, absent de la base
      let unknown = '';
      if (!item) {
        codeIdx = tokens.findIndex((t) => LOOKS_CODE.test(t.toUpperCase()) && !/^\d{1,4}$/.test(t));
        if (codeIdx < 0) continue;
        unknown = tokens[codeIdx];
        match = 'inconnu';
      }
      let qty: number | null = null;
      if (hasQtyCol) {
        const n = qtyNumber(row[m.quantity!] ?? '');
        qty = n !== null && n > 0 ? n : null;
      }
      if (qty === null) qty = guessQuantity(tokens, codeIdx);
      if (qty === null || qty <= 0) {
        if (match === 'inconnu') continue;
        qty = 1;
      }
      out.push({
        code: item ? item.code : unknown,
        pn: item ? item.pn : '',
        quantity: qty,
        description: item ? item.description : row.filter(Boolean).slice(1, 3).join(' '),
        match,
        raw,
      });
    }
  }
  // même article commandé sur plusieurs lignes : quantités additionnées
  const merged = new Map<string, OrderLine>();
  for (const l of out) {
    const k = `${l.code}|${l.pn}`;
    const prev = merged.get(k);
    if (prev) prev.quantity += l.quantity;
    else merged.set(k, { ...l });
  }
  return [...merged.values()];
}

/** Photo d'un bon de commande → lignes de texte (OCR dans le navigateur) */
export async function ocrImage(file: File, progress?: (m: string) => void): Promise<string[][]> {
  const Tesseract = await import('tesseract.js');
  progress?.('Chargement du moteur de lecture…');
  const base = new URL('/tesseract/', window.location.origin).href;
  const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    gzip: true,
  });
  try {
    progress?.('Lecture de la photo…');
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO, preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(file);
    return data.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(/\s{2,}/));
  } finally {
    await worker.terminate();
  }
}

/** Lit un bon de commande, quel que soit son format */
export async function readOrderFile(file: File, progress?: (m: string) => void): Promise<string[][][]> {
  const name = file.name.toLowerCase();
  if (/\.(png|jpe?g|webp|heic|bmp|gif)$/.test(name) || file.type.startsWith('image/')) return [await ocrImage(file, progress)];
  const { readAnyFile } = await import('./readFiles');
  const res = await readAnyFile(file, progress);
  return res.tables.map((t) => t.rows);
}
