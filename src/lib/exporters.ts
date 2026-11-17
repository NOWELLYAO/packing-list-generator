import * as XLSX from 'xlsx';
import type { CatalogItem, PackingList, PLPackage, Settings } from '../types';
import { DOC, packLabel, type Lang } from './i18n';
import { packageDrawing, scaleStrip, type Picture } from './drawing';
import { loadPlanDrawing, planLoad } from './loadPlan';
import { comparePL } from './compare';

/* ------------------------------------------------------------------ */
/* Outils communs                                                      */
/* ------------------------------------------------------------------ */

export const DEFAULT_ACCENT = '#0B4F8A';

const fileName = (pl: PackingList) =>
  `packing_list_${pl.date.replace(/-/g, '')}${pl.reference ? '_' + pl.reference.replace(/[^\w-]+/g, '_') : ''}`;
const fmtDate = (d: string, lang: Lang = 'fr') => new Date(d).toLocaleDateString(DOC[lang].locale);
let numLocale = 'fr-FR';
const nf = (n: number, d = 2) => n.toLocaleString(numLocale, { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/[\u202f\u00a0]/g, ' ');
const dimsOf = (p: PLPackage) => (p.length ? `${p.length} × ${p.width} × ${p.height}` : '—');
const contentsOf = (p: PLPackage) => p.contents.map((c) => `${c.code} × ${c.quantity}`).join('\n');
const basisLabel = (p: PLPackage, lang: Lang) => (p.basis === 'grouped' ? '' : p.basis === 'partial' ? ` (${DOC[lang].partial})` : '');
const typeOf = (p: PLPackage, lang: Lang) => packLabel(p.type, lang) + basisLabel(p, lang);

function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || DEFAULT_ACCENT).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const tint = (rgb: [number, number, number], k: number): [number, number, number] =>
  rgb.map((c) => Math.round(c + (255 - c) * k)) as [number, number, number];

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Dessine un schéma (lib/drawing) dans le PDF : x, y en mm, largeur en mm */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawPicturePdf(doc: any, pic: Picture, x: number, y: number, width: number) {
  const s = width / pic.w;
  const P = (pt: [number, number]): [number, number] => [x + pt[0] * s, y + pt[1] * s];
  for (const sh of pic.shapes) {
    if (sh.kind === 'poly') {
      const pts = sh.pts.map(P);
      const deltas = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
      let gs = false;
      if (sh.opacity !== undefined && doc.GState) {
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity: sh.opacity }));
        gs = true;
      }
      doc.setFillColor(sh.fill);
      if (sh.stroke) {
        doc.setDrawColor(sh.stroke);
        doc.setLineWidth((sh.sw ?? 0.5) * s);
      }
      doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], sh.stroke ? 'FD' : 'F', true);
      if (gs) doc.restoreGraphicsState();
    } else if (sh.kind === 'line') {
      doc.setDrawColor(sh.stroke);
      doc.setLineWidth(sh.sw * s);
      if (sh.dash) doc.setLineDashPattern([1.2, 0.8], 0);
      const [a, b] = [P(sh.a), P(sh.b)];
      doc.line(a[0], a[1], b[0], b[1]);
      if (sh.dash) doc.setLineDashPattern([], 0);
    } else if (sh.kind === 'circle') {
      const c = P(sh.c);
      doc.setFillColor(sh.fill);
      if (sh.stroke) {
        doc.setDrawColor(sh.stroke);
        doc.setLineWidth((sh.sw ?? 0.5) * s);
      }
      doc.circle(c[0], c[1], sh.r * s, sh.stroke ? 'FD' : 'F');
    } else {
      const at = P(sh.at);
      doc.setFont('helvetica', sh.bold ? 'bold' : 'normal');
      doc.setFontSize((sh.size * s) / 0.3528);
      doc.setTextColor(sh.color);
      doc.text(sh.text.replace(/\u202f|\u00a0/g, ' ').replace('m³', 'm3'), at[0], at[1], {
        align: sh.anchor === 'middle' ? 'center' : sh.anchor === 'end' ? 'right' : 'left',
        baseline: 'middle',
        angle: sh.rotate ? -sh.rotate : 0,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

export async function buildPackingListPdf(pl: PackingList, settings: Settings): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const lang: Lang = settings.lang ?? 'fr';
  const T = DOC[lang];
  numLocale = T.locale;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const accent = hexToRgb(settings.accent);
  const light = tint(accent, 0.9);
  const ink: [number, number, number] = [33, 41, 54];
  const muted: [number, number, number] = [110, 120, 135];
  const t = pl.totals;

  // Bandeau supérieur
  doc.setFillColor(...accent);
  doc.rect(0, 0, W, 5, 'F');

  // Logo + nom de l'entreprise
  let leftY = 14;
  if (settings.logo) {
    const { w, h } = await imageSize(settings.logo);
    if (w && h) {
      const maxW = 48;
      const maxH = 18;
      const r = Math.min(maxW / w, maxH / h);
      const fmt = settings.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(settings.logo, fmt, M, 11, w * r, h * r);
      leftY = 11 + h * r + 5;
    }
  }
  if (settings.companyName) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...ink);
    doc.text(settings.companyName, M, leftY);
  }

  // Titre
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...accent);
  doc.text(T.title, W - M, 19, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...muted);
  doc.text(`${T.date} : ${fmtDate(pl.date, lang)}`, W - M, 25.5, { align: 'right' });
  if (pl.reference) doc.text(`${T.ref} : ${pl.reference}`, W - M, 30.5, { align: 'right' });

  // Cartes de synthèse
  const cards: [string, string][] = [
    [T.packages.toUpperCase(), String(t.packages)],
    [T.net.toUpperCase(), `${nf(t.netWeight)} kg`],
    [T.gross.toUpperCase(), `${nf(t.grossWeight)} kg`],
    [T.volume.toUpperCase(), `${nf(t.volume, 3)} m3`],
  ];
  const top = Math.max(38, leftY + 4);
  const gap = 4;
  const cw = (W - 2 * M - gap * 3) / 4;
  cards.forEach(([label, value], i) => {
    const x = M + i * (cw + gap);
    doc.setFillColor(...light);
    doc.roundedRect(x, top, cw, 17, 2, 2, 'F');
    doc.setFillColor(...accent);
    doc.rect(x, top + 2, 1.2, 13, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text(label, x + 5, top + 6.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(...ink);
    doc.text(value, x + 5, top + 13.5);
  });

  const section = (title: string, y: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...accent);
    doc.text(title, M, y);
    doc.setDrawColor(...accent);
    doc.setLineWidth(0.6);
    doc.line(M, y + 1.8, M + 18, y + 1.8);
    return y + 5;
  };
  const tableStyle = {
    theme: 'grid' as const,
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, textColor: ink, lineColor: [225, 230, 236] as [number, number, number], lineWidth: 0.2, valign: 'middle' as const },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: 'bold' as const, fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] },
    footStyles: { fillColor: light, textColor: ink, fontStyle: 'bold' as const },
    margin: { left: M, right: M, top: 14, bottom: 16 },
  };

  let y = section(T.packing, top + 27);
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [[T.no, T.packType, T.dims, T.vol, T.netKg, T.grossKg, T.contents]],
    body: pl.packages.map((p) => [String(p.no), typeOf(p, lang), dimsOf(p), nf(p.volume, 3), nf(p.netWeight), nf(p.grossWeight), contentsOf(p)]),
    foot: [['', T.nPackages(t.packages), '', nf(t.volume, 3), nf(t.netWeight), nf(t.grossWeight), '']],
    columnStyles: {
      0: { halign: 'center', cellWidth: 9 },
      1: { cellWidth: 34 },
      2: { cellWidth: 34 },
      3: { halign: 'right', cellWidth: 17 },
      4: { halign: 'right', cellWidth: 19 },
      5: { halign: 'right', cellWidth: 19 },
      6: { fontSize: 7.5 },
    },
  });
  // @ts-expect-error propriété ajoutée par jspdf-autotable
  y = (doc.lastAutoTable?.finalY ?? y) + 9;
  if (y > H - 40) {
    doc.addPage();
    y = 18;
  }
  y = section(T.articles, y);
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [[T.no, T.codePn, T.description, T.qty, T.caseNo, T.netKg, T.grossKg, T.origin]],
    body: pl.lines.map((l) => [
      String(l.lineNo),
      l.code === l.pn || !l.pn ? l.code : `${l.code}\n${l.pn}`,
      l.description,
      String(l.quantity),
      l.cases,
      nf(l.netWeight),
      nf(l.grossWeight),
      l.origin,
    ]),
    columnStyles: {
      0: { halign: 'center', cellWidth: 9 },
      1: { cellWidth: 26 },
      3: { halign: 'right', cellWidth: 12 },
      4: { halign: 'center', cellWidth: 18 },
      5: { halign: 'right', cellWidth: 19 },
      6: { halign: 'right', cellWidth: 19 },
      7: { halign: 'center', cellWidth: 13 },
    },
  });

  // ---- Schémas des colis ----
  const labels = { cm: 'cm', kg: 'kg', packageWord: lang === 'fr' ? 'Colis' : 'Package', locale: T.locale };
  const drawable = pl.packages.filter((p) => p.length > 0 && p.width > 0 && p.height > 0);
  if (drawable.length) {
    doc.addPage();
    let yy = section(T.schemas, 18);
    const strip = scaleStrip(drawable.map((p) => ({ ...p, type: p.type })), settings.accent || DEFAULT_ACCENT, labels, 640);
    const stripW = Math.min(W - 2 * M, (strip.w / 640) * (W - 2 * M));
    drawPicturePdf(doc, strip, M, yy, stripW);
    yy += (strip.h * stripW) / strip.w + 1;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text(T.scaleView, M, yy + 2);
    yy += 7;
    const cols = 3;
    const cellW = (W - 2 * M) / cols;
    let col = 0;
    for (const p of drawable) {
      const pic = packageDrawing({ ...p, type: p.type }, settings.accent || DEFAULT_ACCENT, labels);
      const cellH = (pic.h * cellW) / pic.w;
      if (yy + cellH + 8 > H - 16) {
        doc.addPage();
        yy = 18;
        col = 0;
      }
      const cx = M + col * cellW;
      doc.setDrawColor(230, 235, 241);
      doc.setLineWidth(0.25);
      doc.roundedRect(cx + 1, yy, cellW - 2, cellH + 6, 2, 2, 'S');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      doc.text(typeOf(p, lang), cx + 4, yy + 4.5);
      drawPicturePdf(doc, pic, cx + 1, yy + 5, cellW - 2);
      col++;
      if (col === cols) {
        col = 0;
        yy += cellH + 9;
      }
    }

    // ---- Plan de chargement ----
    const plan = planLoad(pl.packages);
    if (plan) {
      doc.addPage();
      yy = section(T.loadPlan, 18);
      const vName = lang === 'fr' ? plan.vehicle.name : plan.vehicle.nameEn;
      const facts: [string, string][] = [
        [T.vehicle, `${plan.bins.length} × ${vName}`],
        [T.lengthUsed, plan.bins.map((b) => `${nf(b.usedLength / 100, 2)} m`).join(' + ')],
        [T.floorUsed, plan.bins.map((b) => `${nf(b.floorPct, 1)} %`).join(' + ')],
        [T.ldm, `${nf(plan.ldm, 2)}`],
      ];
      const fw = (W - 2 * M - 9) / 4;
      facts.forEach(([k2, v2], i) => {
        const x0 = M + i * (fw + 3);
        doc.setFillColor(...light);
        doc.roundedRect(x0, yy, fw, 14, 2, 2, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...muted);
        doc.text(k2.toUpperCase(), x0 + 3, yy + 5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(...ink);
        doc.text(doc.splitTextToSize(v2, fw - 5)[0], x0 + 3, yy + 11);
      });
      yy += 20;
      for (const [i, b] of plan.bins.entries()) {
        const pic = loadPlanDrawing(plan.vehicle, b, settings.accent || DEFAULT_ACCENT, lang, 640);
        const ph = (pic.h * (W - 2 * M)) / pic.w;
        if (yy + ph + 10 > H - 16) {
          doc.addPage();
          yy = 18;
        }
        if (plan.bins.length > 1) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(...ink);
          doc.text(`${vName} n° ${i + 1} — ${nf(b.weight, 0)} kg`, M, yy + 2);
          yy += 4;
        }
        drawPicturePdf(doc, pic, M, yy, W - 2 * M);
        yy += ph + 6;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      doc.text(T.loadNote, M, yy);
      yy += 5;
      for (const wmsg of plan.warnings) {
        doc.setTextColor(180, 83, 9);
        doc.text(`⚠ ${wmsg}`.replace('⚠ ', '! '), M, yy);
        yy += 4.5;
      }
    }
  }

  // Pied de page sur chaque page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(225, 230, 236);
    doc.setLineWidth(0.3);
    doc.line(M, H - 11, W - M, H - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text(`${settings.companyName ? settings.companyName + ' — ' : ''}${T.footer(fmtDate(pl.date, lang))}`, M, H - 6.5);
    doc.text(T.page(i, pages), W - M, H - 6.5, { align: 'right' });
  }
  return doc.output('blob');
}

export async function exportPackingListPdf(pl: PackingList, settings: Settings) {
  download(await buildPackingListPdf(pl, settings), `${fileName(pl)}.pdf`);
}

/** Partage natif (iPhone / Android) : envoi du PDF par mail, WhatsApp… ; sinon téléchargement */
export async function sharePackingListPdf(pl: PackingList, settings: Settings): Promise<'shared' | 'downloaded'> {
  const blob = await buildPackingListPdf(pl, settings);
  const file = new File([blob], `${fileName(pl)}.pdf`, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Packing List' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  download(blob, file.name);
  return 'downloaded';
}

/** PDF comparatif « selon Grundfos » / « optimisée » (document interne d'aide à la décision) */
export async function exportComparisonPdf(g: PackingList, sm: PackingList, settings: Settings) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const lang: Lang = settings.lang ?? 'fr';
  numLocale = 'fr-FR';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const accent = hexToRgb(settings.accent);
  const light = tint(accent, 0.9);
  const c = comparePL(g, sm, lang);
  doc.setFillColor(...accent);
  doc.rect(0, 0, W, 5, 'F');
  if (settings.logo) {
    const { w, h } = await imageSize(settings.logo);
    if (w && h) {
      const r = Math.min(40 / w, 15 / h);
      doc.addImage(settings.logo, settings.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', M, 10, w * r, h * r);
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...accent);
  doc.text('COMPARAISON DES PROPOSITIONS', W - M, 17, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 120, 135);
  doc.text(`Date : ${fmtDate(g.date)} — document interne`, W - M, 23, { align: 'right' });
  const style = {
    theme: 'grid' as const,
    styles: { fontSize: 8.5, cellPadding: 1.8, lineColor: [225, 230, 236] as [number, number, number], lineWidth: 0.2 },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] },
    margin: { left: M, right: M },
  };
  autoTable(doc, {
    ...style,
    startY: 32,
    head: [['', 'Selon Grundfos', 'Optimisée', 'Écart']],
    body: [
      ...c.rows.map((r) => {
        const d = r.s - r.g;
        const same = Math.abs(d) < Math.pow(10, -r.decimals) / 2;
        const pct = r.g ? ` (${d > 0 ? '+' : '-'}${nf(Math.abs((d / r.g) * 100), 0)} %)` : '';
        return [r.label, `${nf(r.g, r.decimals)} ${r.unit}`.replace('m³', 'm3'), `${nf(r.s, r.decimals)} ${r.unit}`.replace('m³', 'm3'), same ? '=' : `${d > 0 ? '+' : '-'}${nf(Math.abs(d), r.decimals)}${pct}`];
      }),
      ['Transport proposé', c.transportG, c.transportS, c.transportG === c.transportS ? '=' : '≠'],
    ],
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: (d: { section: string; column: { index: number }; row: { index: number }; cell: { styles: { textColor: unknown } } }) => {
      if (d.section !== 'body' || d.column.index !== 3) return;
      const r = c.rows[d.row.index];
      if (!r) return;
      const diff = r.s - r.g;
      if (Math.abs(diff) < Math.pow(10, -r.decimals) / 2) return;
      d.cell.styles.textColor = (r.lowerIsBetter ? diff < 0 : diff > 0) ? [22, 121, 74] : [192, 38, 45];
    },
  });
  // @ts-expect-error propriété ajoutée par jspdf-autotable
  let y: number = doc.lastAutoTable.finalY + 8;
  if (c.changes.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...accent);
    doc.text('Ce qui change dans la proposition optimisée', M, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(33, 41, 54);
    for (const t of c.changes) {
      const lines = doc.splitTextToSize(`• ${t.replace('→', '->')}`, W - 2 * M);
      doc.text(lines, M, y);
      y += lines.length * 4.2;
    }
    y += 4;
  }
  for (const [title, pl] of [
    ['SELON GRUNDFOS', g],
    ['OPTIMISÉE', sm],
  ] as const) {
    autoTable(doc, {
      ...style,
      startY: y,
      head: [[{ content: `${title} — ${pl.totals.packages} colis`, colSpan: 6, styles: { fillColor: light, textColor: accent } }], ['N°', 'Emballage', 'L × l × H (cm)', 'Vol. (m3)', 'Brut (kg)', 'Contenu']],
      body: pl.packages.map((p) => [String(p.no), typeOf(p, lang), dimsOf(p), nf(p.volume, 3), nf(p.grossWeight), contentsOf(p)]),
      columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { fontSize: 7.5 } },
    });
    // @ts-expect-error propriété ajoutée par jspdf-autotable
    y = doc.lastAutoTable.finalY + 7;
  }
  download(doc.output('blob'), `comparaison_${g.date.replace(/-/g, '')}.pdf`);
}

/* ------------------------------------------------------------------ */
/* Excel (mise en forme complète avec ExcelJS)                         */
/* ------------------------------------------------------------------ */

export async function exportPackingListXlsx(pl: PackingList, settings: Settings) {
  const ExcelJS = (await import('exceljs')).default;
  const lang: Lang = settings.lang ?? 'fr';
  const T = DOC[lang];
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.companyName || 'PL Generator';
  wb.created = new Date();
  const ws = wb.addWorksheet('Packing List', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
    headerFooter: { oddFooter: lang === 'fr' ? '&L&8Packing List&R&8Page &P / &N' : '&L&8Packing List&R&8Page &P of &N' },
  });
  const accent = (settings.accent || DEFAULT_ACCENT).replace('#', '').toUpperCase();
  const [r, g, b] = tint(hexToRgb(settings.accent), 0.9);
  const light = [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  const t = pl.totals;
  ws.columns = [
    { width: 6 }, { width: 22 }, { width: 18 }, { width: 36 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 10 },
  ];
  const thin = { style: 'thin' as const, color: { argb: 'FFE1E6EC' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  // Bandeau + logo + titre
  ws.getRow(1).height = 6;
  for (let c = 1; c <= 9; c++) ws.getCell(1, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + accent } };
  ws.getRow(2).height = 26;
  ws.getRow(3).height = 18;
  ws.getRow(4).height = 18;
  if (settings.logo) {
    const { w, h } = await imageSize(settings.logo);
    if (w && h) {
      const ext = settings.logo.startsWith('data:image/png') ? 'png' : 'jpeg';
      const id = wb.addImage({ base64: settings.logo, extension: ext });
      const maxH = 52;
      const maxW = 190;
      const k = Math.min(maxW / w, maxH / h);
      ws.addImage(id, { tl: { col: 0.2, row: 1.3 }, ext: { width: w * k, height: h * k } });
    }
  }
  ws.mergeCells('F2:I2');
  ws.getCell('F2').value = T.title;
  ws.getCell('F2').font = { name: 'Calibri', size: 22, bold: true, color: { argb: 'FF' + accent } };
  ws.getCell('F2').alignment = { horizontal: 'right', vertical: 'middle' };
  ws.mergeCells('F3:I3');
  ws.getCell('F3').value = `${T.date} : ${fmtDate(pl.date, lang)}`;
  ws.getCell('F3').alignment = { horizontal: 'right' };
  ws.getCell('F3').font = { size: 10, color: { argb: 'FF6E7887' } };
  if (pl.reference) {
    ws.mergeCells('F4:I4');
    ws.getCell('F4').value = `${T.ref} : ${pl.reference}`;
    ws.getCell('F4').alignment = { horizontal: 'right' };
    ws.getCell('F4').font = { size: 10, color: { argb: 'FF6E7887' } };
  }
  if (settings.companyName) {
    ws.mergeCells('A5:D5');
    ws.getCell('A5').value = settings.companyName;
    ws.getCell('A5').font = { bold: true, size: 11 };
  }

  // Synthèse
  const sumRow = 7;
  const cards: [string, string | number, string, string][] = [
    [T.packages, t.packages, '0', 'A7:B7'],
    [T.netKgLong, t.netWeight, '#,##0.00', 'C7:C7'],
    [T.grossKgLong, t.grossWeight, '#,##0.00', 'D7:D7'],
    [T.volXl, t.volume, '0.000', 'E7:G7'],
  ];
  ws.getRow(sumRow).height = 20;
  ws.getRow(sumRow + 1).height = 30;
  for (const [label, value, fmt, range] of cards) {
    const [a, z] = range.split(':');
    const a2 = a.replace('7', '8');
    const z2 = z.replace('7', '8');
    if (a !== z) {
      ws.mergeCells(range);
      ws.mergeCells(`${a2}:${z2}`);
    }
    const lc = ws.getCell(a);
    lc.value = label.toUpperCase();
    lc.font = { size: 9, bold: true, color: { argb: 'FF6E7887' } };
    lc.alignment = { indent: 1, vertical: 'bottom' };
    const vc = ws.getCell(a2);
    vc.value = value;
    vc.numFmt = fmt;
    vc.font = { size: 15, bold: true, color: { argb: 'FF212936' } };
    vc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    for (const cell of [lc, vc]) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + light } };
      cell.border = { left: { style: 'thick', color: { argb: 'FF' + accent } } };
    }
  }

  const sectionTitle = (row: number, text: string) => {
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { bold: true, size: 12, color: { argb: 'FF' + accent } };
    ws.getRow(row).height = 22;
  };
  const header = (row: number, labels: string[]) => {
    labels.forEach((lbl, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = lbl;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + accent } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = border;
    });
    ws.getRow(row).height = 30;
  };
  type HAlign = 'left' | 'center' | 'right';
  const bodyRow = (row: number, values: (string | number)[], fmts: (string | undefined)[], zebra: boolean, align: HAlign[] = []) => {
    values.forEach((v, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = v;
      if (fmts[i]) c.numFmt = fmts[i]!;
      c.border = border;
      c.alignment = { vertical: 'middle', wrapText: true, indent: align[i] === 'center' ? 0 : 1, horizontal: align[i] ?? (typeof v === 'number' ? 'right' : 'left') };
      c.font = { size: 10 };
      if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
  };

  // Colisage
  let row = 10;
  sectionTitle(row, T.packing);
  row++;
  header(row, [T.no, T.packType, T.dimsShort, T.contents, T.volXl, T.netKg, T.grossKg]);
  const pkgAlign: HAlign[] = ['center', 'left', 'center', 'left', 'right', 'right', 'right'];
  const pkgStart = row + 1;
  pl.packages.forEach((p, i) => {
    row++;
    bodyRow(row, [p.no, typeOf(p, lang), dimsOf(p), contentsOf(p), p.volume, p.netWeight, p.grossWeight], [undefined, undefined, undefined, undefined, '0.000', '#,##0.00', '#,##0.00'], i % 2 === 1, pkgAlign);
    ws.getRow(row).height = Math.max(18, 14 * p.contents.length);
  });
  row++;
  const totRow = row;
  bodyRow(row, ['', T.nPackages(t.packages), '', T.total, 0, 0, 0], [undefined, undefined, undefined, undefined, '0.000', '#,##0.00', '#,##0.00'], false, pkgAlign);
  // formules : le total reste juste si l'utilisateur modifie une ligne dans Excel
  ws.getCell(totRow, 5).value = { formula: `SUM(E${pkgStart}:E${totRow - 1})`, result: t.volume };
  ws.getCell(totRow, 6).value = { formula: `SUM(F${pkgStart}:F${totRow - 1})`, result: t.netWeight };
  ws.getCell(totRow, 7).value = { formula: `SUM(G${pkgStart}:G${totRow - 1})`, result: t.grossWeight };
  for (let c = 1; c <= 7; c++) {
    const cell = ws.getCell(totRow, c);
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + light } };
  }

  // Articles
  row += 2;
  sectionTitle(row, T.articles);
  row++;
  header(row, [T.no, T.code, T.pn, T.description, T.qty, T.caseNo, T.netKg, T.grossKg, T.originLong]);
  pl.lines.forEach((l, i) => {
    row++;
    bodyRow(row, [l.lineNo, l.code, l.pn, l.description, l.quantity, l.cases, l.netWeight, l.grossWeight, l.origin], [undefined, '@', '@', undefined, '0.###', undefined, '#,##0.00', '#,##0.00', undefined], i % 2 === 1, ['center', 'left', 'left', 'left', 'right', 'center', 'right', 'right', 'center']);
  });

  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileName(pl)}.xlsx`);
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
