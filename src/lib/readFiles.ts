import * as XLSX from 'xlsx';
import type { ParsedTable } from '../types';
import { looksLikeSapPackingList, parseSapPackingList, type SapDocument } from './sapPackingList';

export interface ReadResult {
  tables: ParsedTable[];
  /** PL au format SAP (Grundfos…) reconnue : import direct sans association de colonnes */
  sap?: SapDocument;
  ocr?: boolean;
}

export type Progress = (msg: string) => void;

function cleanRows(rows: unknown[][]): string[][] {
  return rows.map((r) => (r ?? []).map((c) => (c === null || c === undefined ? '' : String(c).trim())));
}

/** Lit un fichier Excel / CSV en tableaux (une table par feuille) */
export async function readSpreadsheet(file: File): Promise<ParsedTable[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    // Les cellules fusionnées (caisse commune à plusieurs articles) restent vides sur les lignes suivantes :
    // la normalisation répartit ensuite poids et colis du groupe entre ses articles.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
    return { name, rows: cleanRows(rows) };
  });
}

type PdfDoc = Awaited<ReturnType<typeof import('pdfjs-dist').getDocument>['promise']>;

async function openPdf(file: File): Promise<PdfDoc> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const base = new URL('/pdfjs/', window.location.origin).href; // copiés par scripts/copy-ocr-assets.mjs
  return pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
  }).promise;
}

/** Texte du PDF, ligne par ligne, cellules séparées par les grands espaces horizontaux */
async function pdfTextRows(doc: PdfDoc): Promise<string[][]> {
  const allRows: string[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    type T = { str: string; x: number; y: number; w: number };
    const items: T[] = [];
    for (const it of content.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
      if (!it.str || !it.str.trim() || !it.transform) continue;
      items.push({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width ?? 0 });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: T[][] = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l[0].y - it.y) < 3);
      if (line) line.push(it);
      else lines.push([it]);
    }
    lines.sort((a, b) => b[0].y - a[0].y);
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let cur = '';
      let lastEnd = -Infinity;
      for (const it of line) {
        if (cur && it.x - lastEnd > 8) {
          cells.push(cur);
          cur = it.str;
        } else cur = cur ? `${cur} ${it.str}` : it.str;
        lastEnd = it.x + it.w;
      }
      if (cur) cells.push(cur);
      allRows.push(cells);
    }
  }
  return allRows;
}

/** OCR des pages d'un PDF scanné (Tesseract, dans le navigateur) */
async function pdfOcrLines(doc: PdfDoc, progress?: Progress): Promise<string[]> {
  const Tesseract = await import('tesseract.js');
  progress?.('Chargement du moteur OCR…');
  const base = new URL('/tesseract/', window.location.origin).href; // fichiers copiés par scripts/copy-ocr-assets.mjs
  const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    gzip: true,
  });
  await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, preserve_interword_spaces: '0' });
  const lines: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      progress?.(`OCR page ${p} / ${doc.numPages}…`);
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 300 / 72 }); // ~300 dpi
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const { data } = await worker.recognize(canvas);
      lines.push(...data.text.split('\n'));
      canvas.width = canvas.height = 0;
    }
  } finally {
    await worker.terminate();
  }
  return lines;
}

export async function readPdf(file: File, progress?: Progress): Promise<ReadResult> {
  const doc = await openPdf(file);
  let rows = await pdfTextRows(doc);
  let ocr = false;
  let lines = rows.map((r) => r.join('  '));
  const textLen = lines.join('').replace(/\s/g, '').length;
  if (textLen < 50 * doc.numPages) {
    // PDF scanné : pas de texte exploitable -> OCR
    lines = await pdfOcrLines(doc, progress);
    rows = lines.map((l) => l.split(/\s{2,}/));
    ocr = true;
  }
  const text = lines.join('\n');
  if (looksLikeSapPackingList(text)) {
    return { tables: [{ name: 'PDF', rows }], sap: parseSapPackingList(lines), ocr };
  }
  return { tables: [{ name: 'PDF', rows }], ocr };
}

export async function readAnyFile(file: File, progress?: Progress): Promise<ReadResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return readPdf(file, progress);
  return { tables: await readSpreadsheet(file) };
}
