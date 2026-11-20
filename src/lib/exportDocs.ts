import type { PackingList, Settings } from '../types';
import { download, hexToRgb, imageSize, tint } from './exporters';

/** Une ligne du dossier export : article, code SH, origine, prix */
export interface ExportLine {
  code: string;
  description: string;
  quantity: number;
  unit: string;
  hsCode: string;
  origin: string;
  unitPrice: number;
  netWeight: number;
  grossWeight: number;
}

export interface ExportDossier {
  number: string;
  date: string;
  seller: string;
  buyer: string;
  incoterm: string;
  currency: string;
  payment: string;
  lines: ExportLine[];
}

const nf = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/[  ]/g, ' ');

/** Regroupement douanier : un total par code SH et pays d'origine */
export function customsSummary(lines: ExportLine[]) {
  const map = new Map<string, { hsCode: string; origin: string; quantity: number; net: number; gross: number; value: number; articles: number }>();
  for (const l of lines) {
    const k = `${l.hsCode || '—'}|${l.origin || '—'}`;
    const e = map.get(k) ?? { hsCode: l.hsCode || '—', origin: l.origin || '—', quantity: 0, net: 0, gross: 0, value: 0, articles: 0 };
    e.quantity += l.quantity;
    e.net += l.netWeight;
    e.gross += l.grossWeight;
    e.value += l.quantity * l.unitPrice;
    e.articles += 1;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => a.hsCode.localeCompare(b.hsCode) || a.origin.localeCompare(b.origin));
}

/**
 * Dossier export en un PDF : facture proforma, récapitulatif douanier par code SH / origine,
 * déclaration d'origine des marchandises. Poids et colis repris de la Packing List.
 */
export async function exportDossierPdf(pl: PackingList, d: ExportDossier, settings: Settings) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const accent = hexToRgb(settings.accent);
  const light = tint(accent, 0.9);
  const style = {
    theme: 'grid' as const,
    styles: { fontSize: 8, cellPadding: 1.6, lineColor: [225, 230, 236] as [number, number, number], lineWidth: 0.2, overflow: 'linebreak' as const },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] },
    margin: { left: M, right: M },
  };
  const logo = settings.logo ? await imageSize(settings.logo) : null;
  const header = (title: string) => {
    doc.setFillColor(...accent);
    doc.rect(0, 0, W, 5, 'F');
    if (settings.logo && logo?.w && logo.h) {
      const r = Math.min(40 / logo.w, 15 / logo.h);
      doc.addImage(settings.logo, settings.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', M, 10, logo.w * r, logo.h * r);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...accent);
    doc.text(title, W - M, 17, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90, 100, 115);
    doc.text(`N° ${d.number || '—'}  ·  Date : ${new Date(d.date).toLocaleDateString('fr-FR')}`, W - M, 23, { align: 'right' });
  };
  const parties = (y: number) => {
    const colW = (W - 2 * M - 6) / 2;
    const box = (x: number, label: string, text: string) => {
      doc.setFillColor(...light);
      doc.roundedRect(x, y, colW, 26, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...accent);
      doc.text(label, x + 3, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(30, 40, 55);
      doc.text(doc.splitTextToSize(text || '—', colW - 6).slice(0, 4), x + 3, y + 10);
    };
    box(M, 'VENDEUR / EXPÉDITEUR', d.seller);
    box(M + colW + 6, 'ACHETEUR / DESTINATAIRE', d.buyer);
    return y + 30;
  };
  const total = d.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const terms = `Incoterm : ${d.incoterm || '—'}   ·   Devise : ${d.currency}   ·   Paiement : ${d.payment || '—'}   ·   ${pl.totals.packages} colis, ${nf(pl.totals.grossWeight)} kg brut, ${nf(pl.totals.netWeight)} kg net, ${nf(pl.totals.volume, 3)} m³`;

  // 1) Facture proforma
  header('FACTURE PROFORMA');
  let y = parties(30);
  doc.setFontSize(8.5);
  doc.setTextColor(60, 70, 85);
  doc.text(doc.splitTextToSize(terms, W - 2 * M), M, y);
  autoTable(doc, {
    ...style,
    startY: y + 7,
    head: [['Code', 'Désignation', 'Code SH', 'Origine', 'Qté', `Prix unit. (${d.currency})`, `Total (${d.currency})`]],
    body: d.lines.map((l) => [l.code, l.description, l.hsCode || '—', l.origin || '—', `${nf(l.quantity, l.quantity % 1 ? 2 : 0)} ${l.unit || ''}`.trim(), l.unitPrice ? nf(l.unitPrice) : '—', l.unitPrice ? nf(l.quantity * l.unitPrice) : '—']),
    foot: [['', '', '', '', '', 'TOTAL', nf(total)]],
    footStyles: { fillColor: light, textColor: [20, 30, 45], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 20 }, 2: { cellWidth: 18 }, 3: { cellWidth: 14 }, 4: { halign: 'right', cellWidth: 16 }, 5: { halign: 'right', cellWidth: 24 }, 6: { halign: 'right', cellWidth: 26 } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(8);
  doc.setTextColor(110, 120, 135);
  doc.text(doc.splitTextToSize('Facture proforma sans valeur comptable, établie pour l’offre, l’ouverture de crédit documentaire ou les formalités douanières.', W - 2 * M), M, y);
  if (d.lines.some((l) => !l.unitPrice)) {
    doc.setTextColor(194, 65, 12);
    doc.text('Certains prix unitaires ne sont pas renseignés.', M, y + 5);
  }

  // 2) Récapitulatif douanier
  doc.addPage();
  header('RÉCAPITULATIF DOUANIER');
  y = parties(30);
  const sum = customsSummary(d.lines);
  autoTable(doc, {
    ...style,
    startY: y + 2,
    head: [['Code SH', 'Origine', 'Articles', 'Quantité', 'Poids net (kg)', 'Poids brut (kg)', `Valeur (${d.currency})`]],
    body: sum.map((s) => [s.hsCode, s.origin, String(s.articles), nf(s.quantity, s.quantity % 1 ? 2 : 0), nf(s.net), nf(s.gross), s.value ? nf(s.value) : '—']),
    foot: [['TOTAL', '', String(d.lines.length), '', nf(sum.reduce((t, s) => t + s.net, 0)), nf(sum.reduce((t, s) => t + s.gross, 0)), nf(total)]],
    footStyles: { fillColor: light, textColor: [20, 30, 45], fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(8);
  doc.setTextColor(110, 120, 135);
  doc.text(
    doc.splitTextToSize(
      `Poids bruts répartis par article (emballage compris), total des colis : ${nf(pl.totals.grossWeight)} kg. Codes SH à 6 chiffres (système harmonisé) : à compléter selon la nomenclature du pays de destination et à valider par le déclarant en douane.`,
      W - 2 * M,
    ),
    M,
    y,
  );

  // 3) Déclaration d'origine
  doc.addPage();
  header("DÉCLARATION D'ORIGINE");
  y = parties(30) + 4;
  const origins = [...new Set(d.lines.map((l) => l.origin).filter(Boolean))];
  doc.setFontSize(10);
  doc.setTextColor(30, 40, 55);
  const txt =
    `L’exportateur soussigné, ${d.seller.split('\n')[0] || '……………………'}, déclare que les marchandises désignées ci-dessous, ` +
    `expédiées à ${d.buyer.split('\n')[0] || '……………………'} sous la référence ${d.number || '……'}, ` +
    `sont originaires ${origins.length ? `des pays indiqués pour chaque article (${origins.join(', ')})` : 'du pays indiqué pour chaque article'}.`;
  doc.text(doc.splitTextToSize(txt, W - 2 * M), M, y);
  autoTable(doc, {
    ...style,
    startY: y + 16,
    head: [['Code', 'Désignation', 'Quantité', 'Code SH', "Pays d'origine"]],
    body: d.lines.map((l) => [l.code, l.description, nf(l.quantity, l.quantity % 1 ? 2 : 0), l.hsCode || '—', l.origin || '—']),
    columnStyles: { 0: { cellWidth: 22 }, 2: { halign: 'right', cellWidth: 20 }, 3: { cellWidth: 20 }, 4: { cellWidth: 26 } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 14;
  if (y > 250) {
    doc.addPage();
    y = 30;
  }
  doc.setFontSize(9);
  doc.text('Fait à ……………………………, le ……………………', M, y);
  doc.text('Nom, fonction, signature et cachet :', M, y + 10);
  doc.setDrawColor(200, 205, 212);
  doc.rect(M, y + 13, 80, 28);
  if (d.lines.some((l) => !l.origin)) {
    doc.setFontSize(8);
    doc.setTextColor(194, 65, 12);
    doc.text("Origine non renseignée pour certains articles : à compléter avant signature.", M, y + 48);
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(150, 158, 170);
    doc.text(`${settings.companyName || ''}  ·  Dossier export ${d.number || ''}  ·  page ${i}/${n}`, W / 2, 290, { align: 'center' });
  }
  download(doc.output('blob'), `dossier_export_${(d.number || pl.date).replace(/[^\w-]+/g, '_')}.pdf`);
}
