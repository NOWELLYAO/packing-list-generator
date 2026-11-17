import type { CatalogItem, GenerateOptions, PackingList, PLLine, PLPackage, RequestLine } from '../types';
import { norm } from './detect';
import { round } from './parseValues';
import { applyVariant, variantsOf } from './variants';

/** Recherche d'un article : code + PN, sinon code, sinon PN (insensible à la casse/espaces) */
export function findItem(catalog: CatalogItem[], code: string, pn: string): CatalogItem | undefined {
  const c = norm(code).replace(/\s/g, '');
  const p = norm(pn).replace(/\s/g, '');
  const k = (s: string) => norm(s).replace(/\s/g, '');
  if (c && p) {
    const both = catalog.find((i) => k(i.code) === c && k(i.pn) === p);
    if (both) return both;
  }
  if (c) {
    const byCode = catalog.find((i) => k(i.code) === c) ?? catalog.find((i) => k(i.pn) === c);
    if (byCode) return byCode;
  }
  if (p) return catalog.find((i) => k(i.pn) === p) ?? catalog.find((i) => k(i.code) === p);
  return undefined;
}

const PALLET_RE = /pal|euro|half|plywood|plate|skid/i;
const PALLET_BASE_CM = 15; // hauteur d'une palette vide
const MAX_PALLET_HEIGHT = 180; // cm, hauteur max d'une palette groupée
const MAX_PALLET_KG = 1000;
const FILL = 0.75; // taux de remplissage réaliste d'un colis groupé

/** Seuils : un colis "petit" est regroupé avec d'autres */
export const SMALL_PKG_M3 = 0.15;
export const SMALL_PKG_KG = 60;

const CARTONS: [number, number, number][] = [
  [40, 30, 30],
  [60, 40, 40],
  [80, 60, 50],
];
const PALLETS: { type: string; l: number; w: number; tare: number }[] = [
  { type: 'Demi-palette groupée', l: 80, w: 60, tare: 10 },
  { type: 'Palette groupée', l: 120, w: 80, tare: 25 },
];

interface Piece {
  lineIdx: number;
  code: string;
  qty: number;
  type: string;
  l: number;
  w: number;
  h: number;
  volume: number; // m3 du colis
  net: number;
  gross: number;
  basis: 'reference' | 'partial';
  /** volume réellement occupé par la marchandise (pour le regroupement) */
  goodsVolume: number;
}

const sorted3 = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => y - x);

/** Découpe une ligne article en colis, en tenant compte du dernier colis incomplet */
function piecesFor(item: CatalogItem, qty: number, lineIdx: number): Piece[] {
  const perPkg = item.qtyPerPackage > 0 ? item.qtyPerPackage : qty;
  const hasDims = item.length > 0 && item.width > 0 && item.height > 0;
  const refVol = hasDims ? (item.length * item.width * item.height) / 1e6 : item.volumePerPackage || 0;
  // tare (emballage) d'un colis = (brut - net) x unités par colis
  const tare = Math.max(0, item.grossWeightPerUnit - item.netWeightPerUnit) * perPkg;
  const unitVol = refVol / perPkg;
  const out: Piece[] = [];
  const mk = (q: number, h: number, basis: Piece['basis'], volume: number, packTare: number): Piece => ({
    lineIdx,
    code: item.code || item.pn,
    qty: q,
    type: item.packageType || 'Colis',
    l: item.length,
    w: item.width,
    h,
    volume,
    net: q * item.netWeightPerUnit,
    gross: q * item.netWeightPerUnit + packTare,
    basis,
    // volume de marchandise au prorata de la quantité (un carton à moitié plein compte pour moitié)
    goodsVolume: perPkg < 1 ? volume : Math.min(volume, unitVol * q) || volume,
  });

  if (perPkg < 1) {
    // un article réparti sur plusieurs caisses (ex. 0,5 par caisse)
    const n = Math.ceil(round(qty / perPkg, 6));
    for (let i = 0; i < n; i++) out.push(mk(perPkg, item.height, 'reference', refVol, tare));
    return out;
  }
  const full = Math.floor(round(qty / perPkg, 6));
  const rem = round(qty - full * perPkg, 6);
  for (let i = 0; i < full; i++) out.push(mk(perPkg, item.height, 'reference', refVol, tare));
  if (rem > 0) {
    const ratio = rem / perPkg;
    if (hasDims && perPkg > 1 && PALLET_RE.test(item.packageType)) {
      // palette incomplète : la hauteur de chargement diminue proportionnellement
      const load = Math.max(0, item.height - PALLET_BASE_CM);
      const h = Math.min(item.height, Math.ceil(PALLET_BASE_CM + load * ratio));
      const vol = (item.length * item.width * h) / 1e6;
      // la tare de la palette reste entière ; celle des cartons diminue
      out.push(mk(rem, h, 'partial', vol, tare * Math.max(ratio, 0.5)));
    } else {
      out.push(mk(rem, item.height, perPkg > 1 ? 'partial' : 'reference', refVol, tare * (perPkg > 1 ? Math.max(ratio, 0.5) : 1)));
    }
  }
  return out;
}

/** Choisit carton(s) ou palette(s) pour un ensemble de petits colis */
function consolidate(pieces: Piece[]): Omit<PLPackage, 'no'>[] {
  const result: Omit<PLPackage, 'no'>[] = [];
  const goods = (p: Piece) => p.goodsVolume || p.volume;
  const longest = Math.max(...pieces.map((p) => sorted3(p.l, p.w, p.h)[0] || 0));
  const totalVol = pieces.reduce((s, p) => s + goods(p), 0);
  const contents = (ps: Piece[]) => {
    const m = new Map<string, number>();
    for (const p of ps) m.set(p.code, round((m.get(p.code) ?? 0) + p.qty, 4));
    return [...m].map(([code, quantity]) => ({ code, quantity }));
  };

  // 1) tout tient dans un carton standard ?
  for (const [l, w, h] of CARTONS) {
    if (totalVol <= (l * w * h * FILL) / 1e6 && longest <= l) {
      const net = pieces.reduce((s, p) => s + p.net, 0);
      const gross = pieces.reduce((s, p) => s + p.gross, 0) + 1.5;
      if (gross > 40) break; // trop lourd pour un carton -> palette
      result.push({ type: 'Carton groupé', length: l, width: w, height: h, volume: round((l * w * h) / 1e6, 3), netWeight: round(net, 2), grossWeight: round(gross, 2), contents: contents(pieces), basis: 'grouped' });
      return result;
    }
  }

  // 2) palettes : on remplit par ordre décroissant de volume
  const queue = [...pieces].sort((a, b) => goods(b) - goods(a));
  const euro = PALLETS[1];
  const maxVol = (euro.l * euro.w * (MAX_PALLET_HEIGHT - PALLET_BASE_CM) * FILL) / 1e6;
  const groups: Piece[][] = [];
  let cur: Piece[] = [];
  let vol = 0;
  let kg = 0;
  for (const p of queue) {
    if (cur.length && (vol + goods(p) > maxVol || kg + p.gross > MAX_PALLET_KG)) {
      groups.push(cur);
      cur = [];
      vol = 0;
      kg = 0;
    }
    cur.push(p);
    vol += goods(p);
    kg += p.gross;
  }
  if (cur.length) groups.push(cur);

  for (const g of groups) {
    const v = g.reduce((s, p) => s + goods(p), 0);
    const maxPieceH = Math.max(...g.map((p) => sorted3(p.l, p.w, p.h)[2] || 0));
    const gLongest = Math.max(...g.map((p) => sorted3(p.l, p.w, p.h)[0] || 0));
    const gSecond = Math.max(...g.map((p) => sorted3(p.l, p.w, p.h)[1] || 0));
    // demi-palette si le volume et la taille des colis le permettent
    const base = v <= 0.3 && gLongest <= 80 && gSecond <= 60 ? PALLETS[0] : euro;
    // la palette doit être au moins aussi longue que le plus long colis (ex. pompe de 160 cm)
    const pal = { ...base, l: Math.max(base.l, Math.ceil(gLongest)), w: Math.max(base.w, Math.ceil(gSecond)) };
    const loadH = Math.max(maxPieceH, Math.ceil(((v / FILL) * 1e6) / (pal.l * pal.w)));
    const h = Math.min(MAX_PALLET_HEIGHT, PALLET_BASE_CM + loadH);
    const net = g.reduce((s, p) => s + p.net, 0);
    const gross = g.reduce((s, p) => s + p.gross, 0) + pal.tare;
    result.push({ type: pal.type, length: pal.l, width: pal.w, height: h, volume: round((pal.l * pal.w * h) / 1e6, 3), netWeight: round(net, 2), grossWeight: round(gross, 2), contents: contents(g), basis: 'grouped' });
  }
  return result;
}

/**
 * Choisit, parmi les emballages déjà observés pour cet article, celui qui donne le colisage
 * le plus compact pour la quantité demandée (volume total minimal, puis moins de colis).
 * Les estimations en colis mixte ne servent que s'il n'existe aucune autre donnée.
 */
export function chooseVariant(item: CatalogItem, qty: number): { item: CatalogItem; note?: string } {
  if (item.manual) return { item };
  const all = variantsOf(item);
  if (all.length <= 1) return { item };
  const dedicated = all.filter((v) => !v.mixed && (v.length || v.volumePerPackage));
  const pool = dedicated.length ? dedicated : all;
  // 1) La quantité demandée a déjà été expédiée telle quelle : on reprend cet emballage réel
  const exact = pool.filter((v) => Math.abs(v.qtyPerPackage - qty) < 1e-9).sort((a, b) => b.count - a.count)[0];
  if (exact) {
    const it = applyVariant(item, exact);
    return { item: it, note: `${exact.qtyPerPackage} / ${exact.packageType}` };
  }
  // 2) Sinon : le moins de colis possible, puis le volume le plus faible, puis la config la plus vue
  let best = { item, n: Infinity, vol: Infinity, count: -1 };
  for (const v of pool) {
    const cand = applyVariant(item, v);
    const pieces = piecesFor(cand, qty, 0);
    const vol = pieces.reduce((s, p) => s + p.volume, 0);
    const better =
      pieces.length < best.n ||
      (pieces.length === best.n && (vol < best.vol - 1e-6 || (Math.abs(vol - best.vol) < 1e-6 && v.count > best.count)));
    if (better) best = { item: cand, n: pieces.length, vol, count: v.count };
  }
  const q = best.item.qtyPerPackage;
  return { item: best.item, note: `${q} / ${best.item.packageType}` };
}

export function generatePackingList(
  catalog: CatalogItem[],
  requests: RequestLine[],
  options: GenerateOptions = { consolidate: true, reference: '' },
): PackingList {
  const lines: PLLine[] = [];
  const allPieces: Piece[] = [];
  for (const req of requests) {
    if (!req.code.trim() && !req.pn.trim()) continue;
    const qty = Number(req.quantity) || 0;
    if (qty <= 0) continue;
    const item = findItem(catalog, req.code, req.pn);
    const lineIdx = lines.length;
    if (!item) {
      lines.push({ lineNo: lineIdx + 1, code: req.code, pn: req.pn, description: '— Article introuvable dans la base —', quantity: qty, unit: '', cases: '', netWeight: 0, grossWeight: 0, hsCode: '', origin: '', found: false, warning: 'Introuvable' });
      continue;
    }
    const { item: chosen, note } = chooseVariant(item, qty);
    const warnings: string[] = [];
    if (!(chosen.length || chosen.volumePerPackage)) warnings.push('Dimensions manquantes');
    if (!chosen.grossWeightPerUnit) warnings.push('Poids manquant');
    if (chosen.mixed) warnings.push('Données estimées (colis mixte)');
    lines.push({ lineNo: lineIdx + 1, code: item.code, pn: item.pn, description: item.description, quantity: qty, unit: item.unit, cases: '', netWeight: 0, grossWeight: 0, hsCode: item.hsCode, origin: item.origin, found: true, warning: warnings.join(', ') || undefined });
    if (note) lines[lineIdx].packing = note;
    allPieces.push(...piecesFor(chosen, qty, lineIdx));
  }

  // Petits colis -> regroupés ; gros colis -> tels quels
  const isSmall = (p: Piece) => p.volume > 0 && p.volume < SMALL_PKG_M3 && p.gross < SMALL_PKG_KG;
  const small = options.consolidate ? allPieces.filter(isSmall) : [];
  const big = options.consolidate ? allPieces.filter((p) => !isSmall(p)) : allPieces;
  const doGroup = small.length >= 2;

  const packages: PLPackage[] = [];
  const casesByLine = new Map<number, number[]>();
  const addCase = (lineIdx: number, no: number) => casesByLine.set(lineIdx, [...(casesByLine.get(lineIdx) ?? []), no]);
  for (const p of doGroup ? big : allPieces) {
    const no = packages.length + 1;
    packages.push({ no, type: p.type, length: p.l, width: p.w, height: p.h, volume: round(p.volume, 3), netWeight: round(p.net, 2), grossWeight: round(p.gross, 2), contents: [{ code: p.code, quantity: round(p.qty, 4) }], basis: p.basis });
    addCase(p.lineIdx, no);
  }
  if (doGroup) {
    for (const g of consolidate(small)) {
      const no = packages.length + 1;
      packages.push({ ...g, no });
      for (const p of small) if (g.contents.some((c) => c.code === p.code)) addCase(p.lineIdx, no);
    }
  }

  // Poids par ligne article (hors tare des palettes groupées)
  for (const p of allPieces) {
    const l = lines[p.lineIdx];
    l.netWeight = round(l.netWeight + p.net, 2);
    l.grossWeight = round(l.grossWeight + p.gross, 2);
  }
  lines.forEach((l, i) => (l.cases = formatCases(casesByLine.get(i) ?? [])));

  const sum = (f: (p: PLPackage) => number) => packages.reduce((s, p) => s + f(p), 0);
  return {
    date: new Date().toISOString().slice(0, 10),
    reference: options.reference ?? '',
    lines,
    packages,
    totals: {
      quantity: round(lines.reduce((s, l) => s + l.quantity, 0), 2),
      packages: packages.length,
      netWeight: round(sum((p) => p.netWeight), 2),
      grossWeight: round(sum((p) => p.grossWeight), 2),
      volume: round(sum((p) => p.volume), 3),
    },
  };
}

/** [1,2,3,5] -> "1-3, 5" */
export function formatCases(nums: number[]): string {
  const u = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < u.length; i++) {
    let j = i;
    while (j + 1 < u.length && u[j + 1] === u[j] + 1) j++;
    parts.push(i === j ? `${u[i]}` : `${u[i]}-${u[j]}`);
    i = j;
  }
  return parts.join(', ');
}

/**
 * Parse un collage depuis Excel : "CODE<TAB>PN<TAB>QTE" ou "CODE;QTE" ou "CODE QTE".
 * La dernière valeur numérique est la quantité.
 */
export function parsePastedRequests(text: string): Omit<RequestLine, 'id'>[] {
  const out: Omit<RequestLine, 'id'>[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let parts = line.split(/\t|;|\|/).map((s) => s.trim());
    if (parts.length === 1) parts = line.split(/,(?=\s*\d+(?:[.,]\d+)?\s*$)|\s+/).map((s) => s.trim());
    parts = parts.filter((p, i) => p !== '' || i === 1);
    if (parts.length < 2) continue;
    const qty = Number(parts[parts.length - 1].replace(',', '.'));
    if (!Number.isFinite(qty)) continue; // ligne d'en-tête
    const ids = parts.slice(0, -1);
    out.push({ code: ids[0] ?? '', pn: ids.length > 1 ? ids[1] : '', quantity: qty });
  }
  return out;
}
