import * as XLSX from 'xlsx';
import type { CatalogItem, PackingList, PLPackage } from '../types';

const fileName = (pl: PackingList) => `packing_list_${pl.date.replace(/-/g, '')}`;
const frDate = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const dimsOf = (p: PLPackage) => (p.length ? `${p.length} x ${p.width} x ${p.height}` : '');
const contentsOf = (p: PLPackage) => p.contents.map((c) => `${c.code} x ${c.quantity}`).join(', ');

const PKG_COLS = ['Colis N°', 'Emballage', 'Dimensions L x l x H (cm)', 'Volume (m³)', 'Poids net (kg)', 'Poids brut (kg)', 'Contenu'];
const LINE_COLS = ['N°', 'Code article', 'PN', 'Désignation', 'Qté', 'Unité', 'Colis N°', 'Poids net (kg)', 'Poids brut (kg)', 'Origine'];

const pkgRows = (pl: PackingList) =>
  pl.packages.map((p) => [p.no, p.type, dimsOf(p), p.volume, p.netWeight, p.grossWeight, contentsOf(p)]);
const lineRows = (pl: PackingList) =>
  pl.lines.map((l) => [l.lineNo, l.code, l.pn, l.description, l.quantity, l.unit, l.cases, l.netWeight, l.grossWeight, l.origin]);

export function exportPackingListXlsx(pl: PackingList) {
  const t = pl.totals;
  const aoa: (string | number)[][] = [
    ['PACKING LIST'],
    ['Date', frDate(pl.date)],
    [],
    ['Nombre de colis', t.packages, '', 'Poids net (kg)', t.netWeight],
    ['Volume total (m³)', t.volume, '', 'Poids brut (kg)', t.grossWeight],
    [],
    ['COLISAGE'],
    PKG_COLS,
    ...pkgRows(pl),
    ['TOTAL', `${t.packages} colis`, '', t.volume, t.netWeight, t.grossWeight],
    [],
    ['ARTICLES'],
    LINE_COLS,
    ...lineRows(pl),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [10, 18, 24, 40, 14, 14, 40, 14, 14, 10].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Packing List');
  XLSX.writeFile(wb, `${fileName(pl)}.xlsx`);
}

export async function exportPackingListPdf(pl: PackingList) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const t = pl.totals;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('PACKING LIST', W / 2, 14, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date : ${frDate(pl.date)}`, W / 2, 20, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text(
    `${t.packages} colis  —  Poids net ${t.netWeight.toFixed(2)} kg  —  Poids brut ${t.grossWeight.toFixed(2)} kg  —  Volume ${t.volume.toFixed(3)} m3`,
    W / 2,
    27,
    { align: 'center' },
  );
  const head = { fillColor: [30, 58, 95] as [number, number, number], textColor: 255 };
  autoTable(doc, {
    startY: 33,
    head: [PKG_COLS.map((c) => c.replace('m³', 'm3'))],
    body: pkgRows(pl).map((r) => r.map(String)),
    foot: [['TOTAL', `${t.packages} colis`, '', t.volume.toFixed(3), t.netWeight.toFixed(2), t.grossWeight.toFixed(2), '']],
    styles: { fontSize: 8, cellPadding: 1.4 },
    headStyles: head,
    footStyles: { fillColor: [230, 236, 245], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 6: { cellWidth: 90 } },
    margin: { left: 10, right: 10 },
  });
  // @ts-expect-error propriété ajoutée par jspdf-autotable
  const y: number = doc.lastAutoTable?.finalY ?? 60;
  autoTable(doc, {
    startY: y + 8,
    head: [LINE_COLS],
    body: lineRows(pl).map((r) => r.map((c) => String(c ?? ''))),
    styles: { fontSize: 8, cellPadding: 1.4 },
    headStyles: head,
    columnStyles: { 3: { cellWidth: 60 } },
    margin: { left: 10, right: 10 },
  });
  doc.save(`${fileName(pl)}.pdf`);
}

export function exportCatalogXlsx(catalog: CatalogItem[]) {
  const rows = catalog.map((c) => ({
    'Code article': c.code,
    PN: c.pn,
    Désignation: c.description,
    Unité: c.unit,
    'Qté / colis': c.qtyPerPackage,
    Emballage: c.packageType,
    'Longueur (cm)': c.length,
    'Largeur (cm)': c.width,
    'Hauteur (cm)': c.height,
    'Volume colis (m³)': c.volumePerPackage,
    'Poids net / unité (kg)': c.netWeightPerUnit,
    'Poids brut / unité (kg)': c.grossWeightPerUnit,
    'Code SH': c.hsCode,
    Origine: c.origin,
    Source: c.source,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Catalogue');
  XLSX.writeFile(wb, 'catalogue_articles.xlsx');
}

/** Modèle Excel vierge pour saisir des articles à expédier */
export function exportRequestTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['Code article', 'PN', 'Quantité']]);
  ws['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Articles');
  XLSX.writeFile(wb, 'modele_saisie_articles.xlsx');
}
