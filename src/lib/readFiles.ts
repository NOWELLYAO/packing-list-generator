import * as XLSX from 'xlsx';
import type { ParsedTable } from '../types';

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

/** Extraction basique d'un tableau depuis un PDF texte (pas de scan/OCR). */
export async function readPdf(file: File): Promise<ParsedTable[]> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
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
    // Regrouper par ligne (tolérance verticale)
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: T[][] = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l[0].y - it.y) < 3);
      if (line) line.push(it);
      else lines.push([it]);
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      // Découper en cellules quand l'écart horizontal est important
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
  return [{ name: 'PDF', rows: alignPdfRows(allRows) }];
}

/**
 * Les lignes PDF n'ont pas toutes le même nombre de cellules.
 * On garde l'ordre ; l'utilisateur peut ajuster le mapping des colonnes.
 */
function alignPdfRows(rows: string[][]): string[][] {
  return rows;
}

export async function readAnyFile(file: File): Promise<ParsedTable[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return readPdf(file);
  return readSpreadsheet(file);
}
