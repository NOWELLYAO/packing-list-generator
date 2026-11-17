import * as XLSX from 'xlsx';
import type { CatalogItem, PackingList } from '../types';

const dims = (l: { length: number; width: number; height: number }) =>
  l.length && l.width && l.height ? `${l.length} x ${l.width} x ${l.height}` : '';
const cases = (l: { caseFrom: number; caseTo: number }) =>
  !l.caseFrom ? '' : l.caseFrom === l.caseTo ? `${l.caseFrom}` : `${l.caseFrom} - ${l.caseTo}`;

const fileSafe = (s: string) => s.replace(/[^\w\-]+/g, '_') || 'packing_list';

export const PL_COLUMNS = [
  'N°', 'Colis N°', 'Code article', 'PN', 'Désignation', 'Qté', 'Unité', 'Nb colis', 'Emballage',
  'Dimensions (cm)', 'Poids net (kg)', 'Poids brut (kg)', 'Volume (m³)', 'Code SH', 'Origine',
];

function plRows(pl: PackingList) {
  return pl.lines.map((l) => [
    l.lineNo, cases(l), l.code, l.pn, l.description, l.quantity, l.unit, l.packages, l.packageType,
    dims(l), l.netWeight, l.grossWeight, l.volume, l.hsCode, l.origin,
  ]);
}

export function exportPackingListXlsx(pl: PackingList) {
  const h = pl.header;
  const aoa: (string | number)[][] = [
    ['PACKING LIST'],
    [],
    ['N° Packing List', h.plNumber, '', 'Date', h.date],
    ['N° Facture', h.invoiceNumber, '', 'Transport', h.transport],
    ['Expéditeur', h.shipper, '', 'Port de chargement', h.portLoading],
    ['Destinataire', h.consignee, '', 'Port de déchargement', h.portDischarge],
    ['Notify', h.notify, '', 'Marquage', h.marks],
    [],
    PL_COLUMNS,
    ...plRows(pl),
    [],
    ['', '', '', '', 'TOTAL', pl.totals.quantity, '', pl.totals.packages, '', '', pl.totals.netWeight, pl.totals.grossWeight, pl.totals.volume],
  ];
  if (h.remarks) aoa.push([], ['Remarques', h.remarks]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [6, 10, 16, 16, 40, 8, 7, 9, 12, 18, 13, 13, 12, 12, 10].map((wch) => ({ wch }));
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Packing List');
  XLSX.writeFile(wb, `${fileSafe(h.plNumber || 'packing_list')}.xlsx`);
}

export async function exportPackingListPdf(pl: PackingList) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const h = pl.header;
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('PACKING LIST', W / 2, 14, { align: 'center' });
  doc.setFontSize(9);

  const info: [string, string][] = [
    ['N° PL', h.plNumber], ['Date', h.date], ['N° Facture', h.invoiceNumber], ['Transport', h.transport],
    ['Port de chargement', h.portLoading], ['Port de déchargement', h.portDischarge], ['Marquage', h.marks],
  ];
  let y = 22;
  doc.setFont('helvetica', 'bold');
  doc.text('Expéditeur', 14, y);
  doc.text('Destinataire', 90, y);
  doc.text('Notify', 166, y);
  doc.setFont('helvetica', 'normal');
  const wrap = (t: string, x: number) => doc.text(doc.splitTextToSize(t || '-', 70), x, y + 5);
  wrap(h.shipper, 14);
  wrap(h.consignee, 90);
  wrap(h.notify, 166);
  let iy = 22;
  for (const [k, v] of info) {
    if (!v) continue;
    doc.setFont('helvetica', 'bold');
    doc.text(`${k} :`, 232, iy);
    doc.setFont('helvetica', 'normal');
    doc.text(String(v), 283, iy, { align: 'right' });
    iy += 4.5;
  }
  y = Math.max(48, iy + 2);

  autoTable(doc, {
    startY: y,
    head: [PL_COLUMNS],
    body: plRows(pl).map((r) => r.map((c) => String(c ?? ''))),
    foot: [[
      '', '', '', '', 'TOTAL', String(pl.totals.quantity), '', String(pl.totals.packages), '', '',
      pl.totals.netWeight.toFixed(2), pl.totals.grossWeight.toFixed(2), pl.totals.volume.toFixed(3), '', '',
    ]],
    styles: { fontSize: 7, cellPadding: 1.2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    footStyles: { fillColor: [230, 236, 245], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 4: { cellWidth: 50 } },
    margin: { left: 8, right: 8 },
  });
  // @ts-expect-error propriété ajoutée par jspdf-autotable
  const endY: number = doc.lastAutoTable?.finalY ?? y;
  doc.setFontSize(9);
  const summary = `Total : ${pl.totals.packages} colis — Poids net ${pl.totals.netWeight.toFixed(2)} kg — Poids brut ${pl.totals.grossWeight.toFixed(2)} kg — Volume ${pl.totals.volume.toFixed(3)} m³`;
  doc.text(summary, 8, endY + 8);
  if (h.remarks) doc.text(doc.splitTextToSize(`Remarques : ${h.remarks}`, W - 16), 8, endY + 14);
  doc.save(`${fileSafe(h.plNumber || 'packing_list')}.pdf`);
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
