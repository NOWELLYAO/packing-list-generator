import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { PackingList, PLPackage, Settings } from '../types';
import { packLabel } from './i18n';
import { familyOf } from './drawing';

/**
 * Étiquettes de colis (marquage d'expédition) :
 * - « a6 » : 4 étiquettes A6 par feuille A4, à découper ;
 * - « 100x150 » : une étiquette par page de 100 × 150 mm (imprimante thermique).
 * Chaque étiquette : n° de colis / total, destinataire, dimensions, poids, contenu,
 * pictogrammes de manutention et QR code reprenant ces informations.
 */

export type LabelFormat = 'a6' | '100x150';

export interface LabelOptions {
  format: LabelFormat;
  /** destinataire / marquage libre (plusieurs lignes) */
  marking: string;
  /** référence d'expédition (commande, dossier…) */
  reference: string;
  fragile: boolean;
  noStack: boolean;
  /** palettes et caisses : 2 étiquettes (deux faces adjacentes), l'usage en logistique */
  twoForLarge?: boolean;
}

/** Nombre d'étiquettes à imprimer pour un colis */
export function copiesFor(p: PLPackage, opts: Pick<LabelOptions, 'twoForLarge'>): number {
  if (opts.twoForLarge === false) return 1;
  const fam = familyOf(p.type, p);
  return fam === 'pallet' || fam === 'crate' ? 2 : 1;
}

const L = {
  fr: { pkg: 'COLIS', to: 'DESTINATAIRE', dims: 'Dimensions (cm)', gross: 'Poids brut', net: 'Poids net', vol: 'Volume', contents: 'Contenu', ref: 'Réf.', of: 'sur', up: 'HAUT', fragile: 'FRAGILE', noStack: 'NE PAS GERBER', approx: '≈ à vérifier' },
  en: { pkg: 'PACKAGE', to: 'CONSIGNEE', dims: 'Dimensions (cm)', gross: 'Gross weight', net: 'Net weight', vol: 'Volume', contents: 'Contents', ref: 'Ref.', of: 'of', up: 'THIS WAY UP', fragile: 'FRAGILE', noStack: 'DO NOT STACK', approx: '≈ to be checked' },
};

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const nf = (n: number, d: number, locale: string) => n.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ | /g, ' ');
const safe = (t: string) => t.replace(/≈/g, '~').replace(/³/g, '3').replace(/[  ]/g, ' ');

/** Texte encodé dans le QR code (lisible par n'importe quel lecteur, sans application) */
export function labelQrText(pl: PackingList, p: PLPackage, opts: Pick<LabelOptions, 'reference'>, lang: 'fr' | 'en'): string {
  const t = L[lang];
  return [
    `${t.pkg} ${p.no}/${pl.packages.length}`,
    opts.reference ? `${t.ref} ${opts.reference}` : '',
    `PL ${pl.date}`,
    `${p.length}x${p.width}x${p.height} cm`,
    `${t.gross} ${p.grossWeight} kg / ${t.net} ${p.netWeight} kg`,
    ...p.contents.map((c) => `${c.code} x ${c.quantity}`),
  ]
    .filter(Boolean)
    .join('\n')
    // sans accents : lisible par tous les lecteurs de QR code (certains échouent sur l'UTF-8)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\n]/g, '');
}

/* ---------------- pictogrammes de manutention (vectoriels, style ISO 780) ---------------- */
function picUp(doc: jsPDF, x: number, y: number, s: number) {
  doc.setLineWidth(s * 0.07);
  for (const dx of [0.3, 0.7]) {
    const cx = x + s * dx;
    doc.line(cx, y + s * 0.82, cx, y + s * 0.3);
    doc.triangle(cx - s * 0.13, y + s * 0.36, cx + s * 0.13, y + s * 0.36, cx, y + s * 0.12, 'F');
  }
  doc.line(x + s * 0.12, y + s * 0.9, x + s * 0.88, y + s * 0.9);
}
function picFragile(doc: jsPDF, x: number, y: number, s: number) {
  doc.setLineWidth(s * 0.06);
  // verre à pied
  doc.lines([[s * 0.44, 0], [-s * 0.06, s * 0.3], [-s * 0.32, 0], [-s * 0.06, -s * 0.3]], x + s * 0.28, y + s * 0.12, [1, 1], 'S', true);
  doc.line(x + s * 0.5, y + s * 0.42, x + s * 0.5, y + s * 0.78);
  doc.line(x + s * 0.32, y + s * 0.8, x + s * 0.68, y + s * 0.8);
  // fêlure
  doc.setLineWidth(s * 0.03);
  doc.line(x + s * 0.48, y + s * 0.14, x + s * 0.54, y + s * 0.24);
  doc.line(x + s * 0.54, y + s * 0.24, x + s * 0.47, y + s * 0.32);
}
function picNoStack(doc: jsPDF, x: number, y: number, s: number) {
  doc.setLineWidth(s * 0.06);
  doc.rect(x + s * 0.22, y + s * 0.5, s * 0.56, s * 0.38); // colis du bas
  doc.rect(x + s * 0.3, y + s * 0.1, s * 0.4, s * 0.3); // colis posé dessus…
  doc.setLineWidth(s * 0.08);
  doc.line(x + s * 0.1, y + s * 0.02, x + s * 0.9, y + s * 0.48); // …interdit
  doc.line(x + s * 0.9, y + s * 0.02, x + s * 0.1, y + s * 0.48);
}

/** QR code vectoriel (des carrés pleins) : net à toute taille et à toute résolution d'impression */
function drawQr(doc: jsPDF, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2; // marge blanche (en modules) pour la lecture
  const m = size / (n + 2 * quiet);
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, size, size, 'F');
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) {
        c++;
        continue;
      }
      // regroupe les modules noirs consécutifs d'une ligne (PDF plus léger)
      let e = c;
      while (e + 1 < n && qr.modules.get(r, e + 1)) e++;
      doc.rect(x + (quiet + c) * m, y + (quiet + r) * m, (e - c + 1) * m + 0.01, m + 0.01, 'F');
      c = e + 1;
    }
  }
}

/** Dessine une étiquette dans le rectangle (x, y, w, h) en mm */
async function drawLabel(doc: jsPDF, pl: PackingList, p: PLPackage, settings: Settings, opts: LabelOptions, x: number, y: number, w: number, h: number) {
  const lang = settings.lang ?? 'fr';
  const t = L[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const accent = hexRgb(settings.accent || '#0B4F8A');
  const ink: [number, number, number] = [24, 33, 46];
  const muted: [number, number, number] = [110, 120, 135];
  const pad = 4;
  const iw = w - 2 * pad;

  // cadre
  doc.setDrawColor(...ink);
  doc.setLineWidth(0.5);
  doc.rect(x + 1.5, y + 1.5, w - 3, h - 3);

  // bandeau : société + n° de colis
  const bandH = 16;
  doc.setFillColor(...accent);
  doc.rect(x + 1.5, y + 1.5, w - 3, bandH, 'F');
  let lx = x + pad;
  if (settings.logo) {
    try {
      const props = doc.getImageProperties(settings.logo);
      const lh = 11;
      const lw = Math.min(36, (props.width / props.height) * lh);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(lx - 1.5, y + 2.75, lw + 3, lh + 2, 1.2, 1.2, 'F');
      doc.addImage(settings.logo, lx, y + 3.75, lw, lh);
      lx += lw + 4;
    } catch {
      /* logo illisible : ignoré */
    }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  if (settings.companyName) doc.text(safe(settings.companyName), lx, y + 9.5, { maxWidth: w * 0.45 });
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(safe(`PL ${new Date(pl.date).toLocaleDateString(locale)}${opts.reference ? ` · ${t.ref} ${opts.reference}` : ''}`), lx, y + 14, { maxWidth: w * 0.5 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(t.pkg, x + w - pad - 1, y + 6.5, { align: 'right' });
  doc.setFontSize(20);
  doc.text(`${p.no} / ${pl.packages.length}`, x + w - pad - 1, y + 15, { align: 'right' });

  let cy = y + bandH + 5;
  // destinataire
  if (opts.marking.trim()) {
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(t.to, x + pad, cy);
    cy += 4.2;
    doc.setTextColor(...ink);
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(safe(opts.marking.trim()), iw).slice(0, 4) as string[];
    doc.text(lines, x + pad, cy);
    cy += lines.length * 4.6 + 1.5;
    doc.setDrawColor(210, 216, 224);
    doc.setLineWidth(0.25);
    doc.line(x + pad, cy, x + w - pad, cy);
    cy += 4;
  }

  // chiffres clés
  const cell = (label: string, value: string, cx: number, cw: number, big = false, warn = false) => {
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(label.toUpperCase(), cx, cy);
    doc.setTextColor(...(warn ? ([194, 65, 12] as [number, number, number]) : ink));
    doc.setFontSize(big ? 16 : 11);
    doc.text(safe(value), cx, cy + (big ? 6.5 : 5.2), { maxWidth: cw - 1 });
  };
  const half = iw / 2;
  cell(t.gross, `${nf(p.grossWeight, 1, locale)} kg`, x + pad, half, true);
  cell(t.dims, p.length ? `${p.dimCheck ? '≈ ' : ''}${p.length} × ${p.width} × ${p.height}` : '—', x + pad + half, half, false, !!p.dimCheck);
  cy += 11;
  cell(t.net, `${nf(p.netWeight, 1, locale)} kg`, x + pad, half);
  cell(t.vol, `${nf(p.volume, 3, locale)} m³`, x + pad + half, half);
  cy += 9;
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(safe(packLabel(p.type, lang)), x + pad, cy);
  cy += 3;
  doc.setDrawColor(210, 216, 224);
  doc.line(x + pad, cy, x + w - pad, cy);
  cy += 4;

  // contenu
  const desc = new Map(pl.lines.map((l) => [l.code, l.description]));
  const qrSize = Math.min(30, w * 0.3);
  const bottomZone = qrSize + 6;
  const maxY = y + h - bottomZone - 3;
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text(t.contents.toUpperCase(), x + pad, cy);
  cy += 4;
  doc.setTextColor(...ink);
  doc.setFontSize(8);
  const rowH = 3.8;
  const room = Math.max(1, Math.floor((maxY - cy) / rowH));
  const shown = p.contents.length > room ? p.contents.slice(0, room - 1) : p.contents;
  for (const c of shown) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${nf(c.quantity, Number.isInteger(c.quantity) ? 0 : 2, locale)} ×`, x + pad, cy);
    doc.text(c.code, x + pad + 11, cy);
    doc.setFont('helvetica', 'normal');
    doc.text(safe((doc.splitTextToSize(desc.get(c.code) || '', iw - 34)[0] as string) || ''), x + pad + 31, cy);
    cy += rowH;
  }
  if (shown.length < p.contents.length) {
    doc.setTextColor(...muted);
    doc.text(lang === 'fr' ? `+ ${p.contents.length - shown.length} autre(s) article(s)` : `+ ${p.contents.length - shown.length} more item(s)`, x + pad, cy);
  }

  // bas : QR code + pictogrammes
  const by = y + h - pad - qrSize - 1;
  drawQr(doc, labelQrText(pl, p, opts, lang), x + pad, by, qrSize);
  const pics: [(d: jsPDF, x: number, y: number, s: number) => void, string][] = [[picUp, t.up]];
  if (opts.fragile) pics.push([picFragile, t.fragile]);
  if (opts.noStack) pics.push([picNoStack, t.noStack]);
  const ps = Math.min(16, (iw - qrSize - 4) / pics.length - 3);
  doc.setDrawColor(...ink);
  doc.setFillColor(...ink);
  pics.forEach(([draw, label], i) => {
    const px = x + w - pad - (pics.length - i) * (ps + 3) + 3;
    const py = by + qrSize - ps - 4;
    doc.setDrawColor(...ink);
    doc.setFillColor(...ink);
    draw(doc, px, py, ps);
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5);
    doc.text(label, px + ps / 2, py + ps + 3, { align: 'center', maxWidth: ps + 4 });
  });
}

/** PDF d'étiquettes : un document, une étiquette par colis */
export async function buildLabelsPdf(pl: PackingList, settings: Settings, opts: LabelOptions): Promise<jsPDF> {
  const pkgs = pl.packages.flatMap((p) => Array.from({ length: copiesFor(p, opts) }, () => p));
  if (opts.format === '100x150') {
    const doc = new jsPDF({ unit: 'mm', format: [100, 150], orientation: 'portrait' });
    for (const [i, p] of pkgs.entries()) {
      if (i > 0) doc.addPage([100, 150], 'portrait');
      await drawLabel(doc, pl, p, settings, opts, 0, 0, 100, 150);
    }
    return doc;
  }
  // 4 × A6 (105 × 148,5) sur A4, avec repères de découpe
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = 210;
  const H = 297;
  for (const [i, p] of pkgs.entries()) {
    const k = i % 4;
    if (i > 0 && k === 0) doc.addPage();
    if (k === 0) {
      doc.setDrawColor(180, 186, 196);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([2, 2], 0);
      doc.line(W / 2, 0, W / 2, H);
      doc.line(0, H / 2, W, H / 2);
      doc.setLineDashPattern([], 0);
    }
    const x = (k % 2) * (W / 2);
    const y = Math.floor(k / 2) * (H / 2);
    await drawLabel(doc, pl, p, settings, opts, x + 2, y + 2, W / 2 - 4, H / 2 - 4);
  }
  return doc;
}

export async function exportLabelsPdf(pl: PackingList, settings: Settings, opts: LabelOptions) {
  const doc = await buildLabelsPdf(pl, settings, opts);
  doc.save(`etiquettes_colis_${pl.date.replace(/-/g, '')}.pdf`);
}
