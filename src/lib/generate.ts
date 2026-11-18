import type { CatalogItem, GenerateOptions, PackingList, PackVariant, PLLine, PLPackage, RequestLine } from '../types';
import { norm } from './detect';
import { round } from './parseValues';
import { applyVariant, preferredVariant, variantsOf } from './variants';

/** Recherche d'un article : code + PN, sinon code, sinon PN (insensible à la casse/espaces) */
/**
 * Article long (pompes immergées SP/SQ, moteurs MS…) : emballé couché, dans la longueur.
 * Reconnu par la désignation ou par un emballage unitaire très allongé déjà observé.
 */
export function isLongItem(item: CatalogItem | undefined): boolean {
  if (!item) return false;
  // pompes immergées SP, SQ, SQE, SQF, moteurs MS / MMS : longues, emballées couchées
  if (/^\s*(SP|SQ[EF]?|MS|MMS)\s?-?\d/i.test(item.description)) return true;
  const elongated = (l: number, w: number, h: number) => {
    const d = [l, w, h].filter((x) => x > 0).sort((a, b) => b - a);
    return d.length === 3 && d[0] >= 3 * d[1];
  };
  return (item.variants ?? []).some((v) => v.qtyPerPackage === 1 && elongated(v.length, v.width, v.height)) || (item.qtyPerPackage === 1 && elongated(item.length, item.width, item.height));
}

/** Modèle d'un article : « SQF 2.5-2 Rp 1 PARK » → « SQF 2.5-2 » (sert à trouver un article similaire) */
export function modelKey(description: string): string {
  const toks = description.toUpperCase().replace(/\bPARK\b/g, ' ').replace(/[,;]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const key = toks.slice(0, 2).join(' ');
  return /\d/.test(key) && key.length >= 4 ? key : '';
}

/**
 * Article vu uniquement en colis partagé (pas d'emballage propre connu) : on reprend l'emballage
 * unitaire d'un article du même modèle (ex. SQF 2.5-2 Rp 1 ↔ SQF 2.5-2 Rp 1 PARK), avec son propre poids net.
 * Résultat signalé « à vérifier ».
 */
export function withSimilarPacking(item: CatalogItem, catalog: CatalogItem[]): CatalogItem {
  if (item.manual) return item;
  const own = variantsOf(item).filter((v) => !v.mixed && (v.length || v.volumePerPackage));
  if (own.length) return item;
  const key = modelKey(item.description);
  if (!key) return item;
  let best: { it: CatalogItem; v: ReturnType<typeof variantsOf>[number] } | null = null;
  for (const o of catalog) {
    if (o === item || o.id === item.id || modelKey(o.description) !== key) continue;
    for (const v of variantsOf(o)) {
      if (v.mixed || !(v.length > 0 && v.width > 0 && v.height > 0)) continue;
      const better = !best || (v.qtyPerPackage === 1 && best.v.qtyPerPackage !== 1) || (v.qtyPerPackage === best.v.qtyPerPackage && v.count > best.v.count) || (best.v.qtyPerPackage !== 1 && v.qtyPerPackage < best.v.qtyPerPackage);
      if (better) best = { it: o, v };
    }
  }
  if (!best) return item;
  // poids net de l'article lui-même (relevé dans son colis partagé), sinon celui de l'article similaire
  const ownNet = variantsOf(item).map((x) => x.netWeightPerUnit).find((n) => n > 0) ?? item.netWeightPerUnit;
  const net = ownNet > 0 ? ownNet : best.v.netWeightPerUnit;
  const tarePerUnit = Math.max(0, best.v.grossWeightPerUnit - best.v.netWeightPerUnit);
  const v = { ...best.v, netWeightPerUnit: net, grossWeightPerUnit: round(net + tarePerUnit, 4), count: 1, source: `emballage de ${best.it.code} (${best.it.description})` };
  return { ...applyVariant(item, v), variants: [v], similarFrom: `${best.it.code} ${best.it.description}`, coPacked: item.coPacked };
}

/**
 * Colis mixte : à l'import, poids et volume sont répartis au prorata des quantités
 * (20 kits garniture + 2 coffrets LC 232 → 0,72 kg par coffret, faux).
 * Quand les autres articles du colis ont un emballage propre connu, on retire leur part réelle
 * et le reste revient aux articles inconnus du colis.
 */
export function refineMixedShare(item: CatalogItem, catalog: CatalogItem[]): CatalogItem {
  if (item.manual || !item.variants?.length) return item;
  const ownPerUnit = (o: CatalogItem) => {
    const v = variantsOf(o).filter((x) => !x.mixed && x.qtyPerPackage > 0 && x.grossWeightPerUnit > 0).sort((a, b) => b.count - a.count)[0];
    if (!v) return null;
    const vol = v.length > 0 && v.width > 0 && v.height > 0 ? (v.length * v.width * v.height) / 1e6 : v.volumePerPackage;
    return { g: v.grossWeightPerUnit, n: v.netWeightPerUnit, vol: vol > 0 ? vol / v.qtyPerPackage : 0 };
  };
  if (ownPerUnit(item)) return item;
  const refine = (v: PackVariant): PackVariant => {
    if (!v.mixed || !v.packShare || v.packShare >= 1 || !(v.qtyPerPackage > 0)) return v;
    const huG = (v.grossWeightPerUnit * v.qtyPerPackage) / v.packShare;
    const huN = (v.netWeightPerUnit * v.qtyPerPackage) / v.packShare;
    const huV = v.length > 0 && v.width > 0 && v.height > 0 ? (v.length * v.width * v.height) / 1e6 : v.volumePerPackage;
    const totalQty = v.qtyPerPackage / v.packShare;
    let knownQty = 0;
    let kG = 0;
    let kN = 0;
    let kV = 0;
    let volKnown = true;
    for (const code of item.coPacked ?? []) {
      const o = catalog.find((c) => c !== item && (c.code === code || c.pn === code));
      if (!o) continue;
      // même colis : même source, mêmes dimensions et même poids total de colis (±3 %)
      const mv = (o.variants ?? []).find(
        (x) => x.mixed && x.source === v.source && x.packShare && x.length === v.length && x.width === v.width && x.height === v.height &&
          Math.abs((x.grossWeightPerUnit * x.qtyPerPackage) / x.packShare - huG) <= huG * 0.03 + 0.05,
      );
      const own = mv && ownPerUnit(o);
      if (!mv || !own) continue;
      knownQty += mv.qtyPerPackage;
      kG += mv.qtyPerPackage * own.g;
      kN += mv.qtyPerPackage * own.n;
      if (own.vol > 0) kV += mv.qtyPerPackage * own.vol;
      else volKnown = false;
    }
    const unknownQty = totalQty - knownQty;
    if (!knownQty || unknownQty < v.qtyPerPackage - 1e-6 || kG >= huG * 0.95) return v;
    const g = (huG - kG) / unknownQty;
    const n = Math.min((g * huN) / huG, Math.max(0, huN - kN) / unknownQty || g);
    const share = volKnown && huV > 0 && kV < huV * 0.95 ? (v.qtyPerPackage * ((huV - kV) / unknownQty)) / huV : v.packShare;
    return { ...v, grossWeightPerUnit: round(g, 4), netWeightPerUnit: round(n, 4), packShare: round(Math.min(1, share), 4) };
  };
  const variants = item.variants.map(refine);
  if (variants.every((v, i) => v === item.variants![i])) return item;
  const top = variants.find((_, i) => item.variants![i].source === item.source && item.variants![i].mixed);
  const base = top && item.mixed ? { ...item, netWeightPerUnit: top.netWeightPerUnit, grossWeightPerUnit: top.grossWeightPerUnit, packShare: top.packShare } : item;
  return { ...base, variants };
}

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
/** cartons de réemballage d'un petit reliquat (du plus petit au plus grand) */
const REPACK_CARTONS: [number, number, number][] = [
  [30, 20, 15],
  [40, 30, 20],
  [40, 30, 30],
  [60, 40, 40],
  [80, 60, 50],
];
/** au-delà, le reliquat reste sur palette */
const REPACK_MAX_M3 = 0.12;
const REPACK_MAX_KG = 30;
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
  dimsInferred?: boolean;
  /** petit reliquat réemballé dans un carton à sa taille */
  repacked?: boolean;
  /** dimensions issues d'un colis partagé (ce ne sont pas celles de l'article) */
  fromMixed?: boolean;
  /** emballage repris d'un article similaire */
  similar?: boolean;
  /** volume réellement occupé par la marchandise (pour le regroupement) */
  goodsVolume: number;
}

const sorted3 = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => y - x);

/** Vraie palette : emballage de type palette et surface au sol d'au moins 80 × 55 cm */
function isPalletLike(item: Pick<CatalogItem, 'packageType' | 'length' | 'width'>): boolean {
  const [a, b] = [item.length, item.width].sort((x, y) => y - x);
  return PALLET_RE.test(item.packageType) && a >= 80 && b >= 55;
}

/** Jusqu'à 50 cm de chargement, les articles sont posés en une seule couche : la hauteur ne baisse pas */
const SINGLE_LAYER_CM = 50;

/**
 * Hauteur d'une palette portant n unités (n < quantité de référence).
 * 1) Entre deux envois réels du même article sur la même palette : interpolation.
 * 2) Sinon, depuis l'envoi réel immédiatement supérieur :
 *    - une couche (≤ 50 cm de chargement) : même hauteur ;
 *    - plusieurs couches : hauteur de chargement proportionnelle.
 * Règle calée sur vos PL : erreur moyenne ≈ 4 cm (contre 9 cm en proportionnel pur).
 */
function partialHeight(item: CatalogItem, n: number): number {
  const anchors = (item.heightAnchors ?? []).filter((a) => a.n > 0 && a.h > 0).sort((a, b) => a.n - b.n);
  if (!anchors.length || !anchors.some((a) => a.n === item.qtyPerPackage)) anchors.push({ n: item.qtyPerPackage, h: item.height });
  anchors.sort((a, b) => a.n - b.n);
  const exact = anchors.find((a) => Math.abs(a.n - n) < 1e-9);
  if (exact) return exact.h;
  const upper = anchors.find((a) => a.n > n)!;
  const lower = [...anchors].reverse().find((a) => a.n < n);
  if (lower) return Math.ceil(lower.h + ((upper.h - lower.h) * (n - lower.n)) / (upper.n - lower.n));
  // Deux envois connus au-dessus : on prolonge la tendance observée (ex. 20 → 54 cm, 35 → 74 cm)
  const above = anchors.filter((x) => x.n > n);
  if (above.length >= 2) {
    const [a1, a2] = above;
    const slope = (a2.h - a1.h) / (a2.n - a1.n);
    // pente nulle entre deux envois proches (19 et 21 unités → 130 cm) : pas d'information, règle ci-dessous
    if (slope > 0) return Math.max(PALLET_BASE_CM + 10, Math.min(a1.h, Math.ceil(a1.h - slope * (a1.n - n))));
  }
  const load = Math.max(0, upper.h - PALLET_BASE_CM);
  // une seule couche (pompes couchées) : la hauteur ne change pas… sauf pour de nombreux petits articles empilés
  if (load <= SINGLE_LAYER_CM && (isLongItem(item) || item.qtyPerPackage <= 12)) return upper.h;
  return Math.ceil(PALLET_BASE_CM + (load * n) / upper.n);
}

/** Découpe une ligne article en colis, en tenant compte du dernier colis incomplet */
function piecesFor(item: CatalogItem, qty: number, lineIdx: number): Piece[] {
  // Donnée issue d'un colis mixte : les dimensions sont celles du colis entier.
  // On ne garde que la part de l'article (hauteur réduite), sinon chaque article compterait tout le colis.
  const share = item.mixed && item.packShare && item.packShare < 1 ? item.packShare : 1;
  // petit article vu seulement dans un carton mixte : il part dans son propre carton, à la taille de sa part
  if (share < 1 && item.length > 0 && item.width > 0 && item.height > 0 && !isPalletLike(item) && !isLongItem(item) && item.qtyPerPackage > 0) {
    const goodsAll = ((item.length * item.width * item.height) / 1e6) * share * (qty / item.qtyPerPackage);
    const box = goodsAll > 0 && goodsAll <= REPACK_MAX_M3 && qty * item.netWeightPerUnit <= REPACK_MAX_KG
      ? REPACK_CARTONS.find(([l, w, h]) => (l * w * h * FILL) / 1e6 >= goodsAll)
      : undefined;
    if (box) {
      const [cl, cw, ch] = box;
      const vol = (cl * cw * ch) / 1e6;
      const cartonTare = round(0.3 + vol * 8, 2);
      const inner = Math.max(0, item.grossWeightPerUnit - item.netWeightPerUnit) * 0.5;
      return [{ lineIdx, code: item.code || item.pn, qty, type: 'Carton', l: cl, w: cw, h: ch, volume: vol, net: qty * item.netWeightPerUnit, gross: qty * (item.netWeightPerUnit + inner) + cartonTare, basis: 'reference', dimsInferred: item.dimsInferred, fromMixed: true, repacked: true, goodsVolume: goodsAll }];
    }
  }
  if (share < 1 && item.length > 0 && item.width > 0 && item.height > 0) {
    const h = isPalletLike(item)
      ? Math.ceil(PALLET_BASE_CM + Math.max(0, item.height - PALLET_BASE_CM) * share)
      : Math.max(5, Math.ceil(item.height * Math.max(share, 0.3)));
    item = { ...item, height: Math.min(item.height, h), packShare: undefined, mixed: true };
  } else if (share < 1 && item.volumePerPackage > 0) {
    item = { ...item, volumePerPackage: item.volumePerPackage * share, packShare: undefined };
  }
  const perPkg = item.qtyPerPackage > 0 ? item.qtyPerPackage : qty;
  const hasDims = item.length > 0 && item.width > 0 && item.height > 0;
  const refVol = hasDims ? (item.length * item.width * item.height) / 1e6 : item.volumePerPackage || 0;
  // tare (emballage) d'un colis = (brut - net) x unités par colis
  const tare = Math.max(0, item.grossWeightPerUnit - item.netWeightPerUnit) * perPkg;
  const loadVol =
    hasDims && isPalletLike(item) ? (item.length * item.width * Math.max(5, item.height - PALLET_BASE_CM)) / 1e6 : refVol;
  const goodsUnitVol = loadVol / perPkg;
  const out: Piece[] = [];
  // Article vu seulement dans une palette partagée : ce n'est pas « sa » palette.
  // Petit article compact → carton à la taille de sa marchandise ; sinon palette propre, avec au moins le poids d'une palette vide.
  let palletFloor = 0;
  if (share < 1 && hasDims && isPalletLike(item)) {
    const goodsAll = goodsUnitVol * qty;
    const box = !isLongItem(item) && goodsAll > 0 && goodsAll <= REPACK_MAX_M3 && qty * item.netWeightPerUnit <= REPACK_MAX_KG
      ? REPACK_CARTONS.find(([l, w, h]) => (l * w * h * FILL) / 1e6 >= goodsAll)
      : undefined;
    if (box) {
      const [cl, cw, ch] = box;
      const cartonTare = round(0.3 + ((cl * cw * ch) / 1e6) * 8, 2);
      const inner = Math.max(0, item.grossWeightPerUnit - item.netWeightPerUnit) * 0.3; // emballage individuel, sans la part de palette
      const vol = (cl * cw * ch) / 1e6;
      return [{ lineIdx, code: item.code || item.pn, qty, type: 'Carton', l: cl, w: cw, h: ch, volume: vol, net: qty * item.netWeightPerUnit, gross: qty * (item.netWeightPerUnit + inner) + cartonTare, basis: 'reference', dimsInferred: item.dimsInferred, fromMixed: true, repacked: true, goodsVolume: goodsAll }];
    }
    palletFloor = item.length * item.width >= 9000 ? 25 : 10;
  } else if (hasDims && isPalletLike(item)) {
    // une palette vide pèse au moins 15 kg (120 × 80) ou 8 kg (demi-palette) : brut = net est impossible
    palletFloor = item.length * item.width >= 9000 ? 15 : 8;
  }
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
    gross: q * item.netWeightPerUnit + Math.max(packTare, palletFloor),
    basis,
    dimsInferred: item.dimsInferred,
    fromMixed: !!item.mixed,
    similar: !!item.similarFrom,
    // volume de marchandise au prorata de la quantité (un carton à moitié plein compte pour moitié),
    // sans le socle des palettes : au regroupement, la marchandise est reposée sur une seule palette
    goodsVolume: perPkg < 1 ? volume : Math.min(volume, goodsUnitVol * q) || volume,
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
    if (hasDims && perPkg > 1 && isPalletLike(item)) {
      // tare d'une palette pleine = palette vide (25 kg pour une 120 × 80, 10 kg pour une demi) + emballages des unités
      const emptyPallet = Math.min(tare, item.length * item.width >= 9000 ? 25 : 10);
      const innerPerUnit = Math.max(0, tare - emptyPallet) / perPkg;
      const goodsRem = goodsUnitVol * rem;
      const repack = !isLongItem(item) && goodsRem > 0 && goodsRem <= REPACK_MAX_M3 && rem * item.netWeightPerUnit <= REPACK_MAX_KG
        ? REPACK_CARTONS.find(([l, w, h]) => (l * w * h * FILL) / 1e6 >= goodsRem)
        : undefined;
      // article long (pompe immergée) en petit reliquat : carton long à sa longueur, section d'après la palette observée
      if (!repack && isLongItem(item) && goodsRem > 0 && goodsRem <= REPACK_MAX_M3 && rem * item.netWeightPerUnit <= REPACK_MAX_KG) {
        const len = Math.max(item.length, item.width) - 2;
        const side = Math.max(10, Math.ceil(Math.sqrt((goodsRem * 1e6) / len)));
        const vol = (len * side * side) / 1e6;
        const cartonTare = round(0.3 + vol * 8, 2);
        const piece = mk(rem, side, 'reference', vol, rem * innerPerUnit + cartonTare);
        out.push({ ...piece, gross: rem * item.netWeightPerUnit + rem * innerPerUnit + cartonTare, type: 'Carton', l: len, w: side, h: side, goodsVolume: goodsRem, repacked: true });
      } else if (repack) {
        // petit reliquat (ex. 1 flotteur sur une palette de 50) : réemballé dans un carton à sa taille
        const [cl, cw, ch] = repack;
        const cartonTare = round(0.3 + (cl * cw * ch) / 1e6 * 8, 2);
        const piece = mk(rem, ch, 'reference', (cl * cw * ch) / 1e6, rem * innerPerUnit + cartonTare);
        // carton : pas de poids minimal de palette
        out.push({ ...piece, gross: rem * item.netWeightPerUnit + rem * innerPerUnit + cartonTare, type: 'Carton', l: cl, w: cw, h: ch, goodsVolume: goodsRem, repacked: true });
      } else {
        // palette incomplète : hauteur estimée d'après les envois réels de cet article ;
        // tare = palette vide + emballages des seules unités présentes
        const h = Math.min(item.height, partialHeight(item, rem));
        const vol = (item.length * item.width * h) / 1e6;
        out.push(mk(rem, h, 'partial', vol, emptyPallet + innerPerUnit * rem));
      }
    } else if (hasDims && perPkg > 1) {
      if (isLongItem(item)) {
        // articles longs couchés côte à côte (ex. 4 pompes SQ) : on retire des rangées, la hauteur ne change pas
        const [L0, W0] = [Math.max(item.length, item.width), Math.min(item.length, item.width)];
        const w = Math.min(W0, Math.max(Math.ceil((W0 * rem) / perPkg), Math.min(item.height, W0)));
        const piece = mk(rem, item.height, 'partial', (L0 * w * item.height) / 1e6, tare);
        out.push({ ...piece, l: L0, w });
      } else {
        // carton incomplet : l'emballeur prend un carton plus bas (constaté : 4 DDC → 55 cm, 2 DDC → 27 cm)
        const h = Math.min(item.height, Math.ceil(item.height * Math.max(rem / perPkg, 0.3)));
        out.push(mk(rem, h, 'partial', (item.length * item.width * h) / 1e6, tare));
      }
    } else {
      out.push(mk(rem, item.height, 'reference', refVol, tare));
    }
  }
  return out;
}

/** Choisit carton(s) ou palette(s) pour un ensemble de petits colis */
function consolidate(pieces: Piece[]): Omit<PLPackage, 'no'>[] {
  const result: Omit<PLPackage, 'no'>[] = [];
  const goods = (p: Piece) => p.goodsVolume || p.volume;
  // les dimensions d'un colis partagé ne disent rien de la longueur de l'article (un câble vu sur une palette de 144 cm)
  const own = (ps: Piece[]) => ps.filter((p) => !p.fromMixed);
  const longest = Math.max(0, ...own(pieces).map((p) => sorted3(p.l, p.w, p.h)[0] || 0));
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
  // répartition équilibrée : 100 pompes → 34 + 33 + 33 plutôt que 49 + 49 + 2 (même nombre de palettes)
  if (groups.length > 1) {
    const k = groups.length;
    const bins: { ps: Piece[]; vol: number; kg: number }[] = Array.from({ length: k }, () => ({ ps: [], vol: 0, kg: 0 }));
    let ok = true;
    for (const p of [...queue].sort((a, b) => goods(b) - goods(a) || b.gross - a.gross)) {
      const fits = bins.filter((b) => b.vol + goods(p) <= maxVol + 1e-9 && b.kg + p.gross <= MAX_PALLET_KG);
      if (!fits.length) {
        ok = false;
        break;
      }
      const b = fits.reduce((x, y) => (y.vol < x.vol - 1e-9 || (Math.abs(y.vol - x.vol) <= 1e-9 && y.kg < x.kg) ? y : x));
      b.ps.push(p);
      b.vol += goods(p);
      b.kg += p.gross;
    }
    if (ok && bins.every((b) => b.ps.length)) {
      groups.length = 0;
      groups.push(...bins.map((b) => b.ps));
    }
  }

  for (const g of groups) {
    const v = g.reduce((s, p) => s + goods(p), 0);
    const maxPieceH = Math.max(0, ...own(g).map((p) => sorted3(p.l, p.w, p.h)[2] || 0));
    const gLongest = Math.max(0, ...own(g).map((p) => sorted3(p.l, p.w, p.h)[0] || 0));
    const gSecond = Math.max(0, ...own(g).map((p) => sorted3(p.l, p.w, p.h)[1] || 0));
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

export type Confidence = 'observed' | 'interpolated' | 'estimated' | 'mixed' | 'manual';

/** Même surface au sol et même famille (palette ou carton/caisse) : PALLET et PALPLATE 160×80 se comparent */
const footprintKey = (v: { length: number; width: number; packageType: string }) =>
  `${[Math.round(v.length), Math.round(v.width)].sort((x, y) => y - x).join('x')}|${isPalletLike(v) ? 'PAL' : v.packageType.toUpperCase().slice(0, 4)}`;

/** Niveau de fiabilité du colisage proposé pour une ligne */
function confidenceOf(item: CatalogItem, qty: number): Confidence {
  if (item.manual) return 'manual';
  if (item.similarFrom) return 'estimated';
  if (item.mixed) return 'mixed';
  const per = item.qtyPerPackage;
  if (!(per > 1)) return 'observed';
  const rem = round(qty - Math.floor(round(qty / per, 6)) * per, 6);
  if (rem <= 0) return 'observed';
  const anchors = item.heightAnchors ?? [];
  if (anchors.some((x) => Math.abs(x.n - rem) < 1e-9)) return 'observed';
  if (anchors.some((x) => x.n < rem)) return 'interpolated';
  return 'estimated';
}

/**
 * Choisit l'emballage qu'un emballeur utiliserait pour la quantité demandée,
 * à partir des envois réels de l'article (variantes) :
 * 1) quantité déjà expédiée telle quelle → même emballage ;
 * 2) sinon le moins de colis possible, puis le plus petit volume, puis la configuration la plus vue.
 * Les autres envois sur le même type de palette servent à estimer la hauteur d'une palette incomplète.
 * Les estimations en colis mixte ne servent que s'il n'existe aucune autre donnée.
 */
export function chooseVariant(item: CatalogItem, qty: number): { item: CatalogItem; note?: string; confidence: Confidence } {
  if (item.manual) return { item, confidence: 'manual' };
  const all = variantsOf(item);
  const dedicated = all.filter((v) => !v.mixed && (v.length || v.volumePerPackage));
  const pool = dedicated.length ? dedicated : all;
  const withAnchors = (v: (typeof pool)[number]): CatalogItem => {
    const it = applyVariant(item, v);
    const fk = footprintKey(v);
    it.heightAnchors = dedicated.filter((o) => o.length && footprintKey(o) === fk).map((o) => ({ n: o.qtyPerPackage, h: o.height }));
    return it;
  };
  const done = (it: CatalogItem) => ({ item: it, note: `${it.qtyPerPackage} / ${it.packageType}`, confidence: confidenceOf(it, qty) });

  if (pool.length <= 1) return done(pool.length ? withAnchors(pool[0]) : item);
  // 1) La quantité demandée a déjà été expédiée telle quelle : on reprend cet emballage réel
  const exact = pool.filter((v) => Math.abs(v.qtyPerPackage - qty) < 1e-9).sort((a, b) => b.count - a.count)[0];
  if (exact) return done(withAnchors(exact));
  // 2) Sinon : le moins de colis possible, puis le volume le plus faible, puis la config la plus vue
  let best: { item: CatalogItem; n: number; vol: number; count: number } | null = null;
  for (const v of pool) {
    const cand = withAnchors(v);
    const pieces = piecesFor(cand, qty, 0);
    const vol = pieces.reduce((s, p) => s + p.volume, 0);
    const better =
      !best ||
      pieces.length < best.n ||
      (pieces.length === best.n && (vol < best.vol - 1e-6 || (Math.abs(vol - best.vol) < 1e-6 && v.count > best.count)));
    if (better) best = { item: cand, n: pieces.length, vol, count: v.count };
  }
  return done(best!.item);
}

/**
 * Proposition « selon Grundfos » : uniquement ce que le fournisseur a réellement fait.
 * - quantité déjà expédiée telle quelle → cet envoi ;
 * - sinon colis pleins de l'emballage le plus utilisé, et le reliquat dans un vrai colis
 *   Grundfos observé (le plus petit qui le contient), sans recalcul de dimensions ;
 * - pas de regroupement des petits articles.
 */
function grundfosPieces(item: CatalogItem, qty: number, lineIdx: number): { pieces: Piece[]; confidence: Confidence; note: string } {
  const all = variantsOf(item);
  const dedicated = all.filter((v) => !v.mixed && (v.length || v.volumePerPackage));
  const pool = dedicated.length ? dedicated : all;
  const asItem = (v: (typeof pool)[number]) => applyVariant(item, v);
  const mixed = !dedicated.length && all.some((v) => v.mixed);
  const conf = (exact: boolean): Confidence => (item.manual ? 'manual' : mixed ? 'mixed' : exact && !item.similarFrom ? 'observed' : 'estimated');
  // 1) envoi identique
  const exact = pool.filter((v) => Math.abs(v.qtyPerPackage - qty) < 1e-9).sort((a, b) => b.count - a.count)[0];
  if (exact && !item.manual) {
    const it = asItem(exact);
    return { pieces: piecesFor(it, qty, lineIdx), confidence: conf(true), note: `${exact.qtyPerPackage} / ${exact.packageType}` };
  }
  // 2) emballage le plus utilisé
  const main = item.manual ? null : preferredVariant(pool);
  const ref = main ? asItem(main) : item;
  const per = ref.qtyPerPackage > 0 ? ref.qtyPerPackage : qty;
  if (per < 1) return { pieces: piecesFor(ref, qty, lineIdx), confidence: conf(true), note: `${per} / ${ref.packageType}` };
  const full = Math.floor(round(qty / per, 6));
  const rem = round(qty - full * per, 6);
  const pieces = full > 0 ? piecesFor(ref, full * per, lineIdx) : [];
  let exactAll = true;
  if (rem > 0) {
    // reliquat : le plus petit colis Grundfos réellement observé qui peut le contenir
    const hasDims = (v: (typeof pool)[number]) => (v.length > 0 && v.width > 0 && v.height > 0 ? 0 : 1);
    const holder = [...pool]
      .filter((v) => v.qtyPerPackage >= rem)
      .sort((a, b) => hasDims(a) - hasDims(b) || a.qtyPerPackage - b.qtyPerPackage || b.count - a.count)[0];
    const h = holder ? asItem(holder) : ref;
    const hv = h.length && h.width && h.height ? (h.length * h.width * h.height) / 1e6 : h.volumePerPackage || 0;
    // une palette vide pèse au moins 15 kg (8 kg la demi-palette)
    const floor = h.length > 0 && isPalletLike(h) ? (h.length * h.width >= 9000 ? 15 : 8) : 0;
    const tare = Math.max(floor, Math.max(0, h.grossWeightPerUnit - h.netWeightPerUnit) * h.qtyPerPackage);
    const exactRem = Math.abs(h.qtyPerPackage - rem) < 1e-9;
    if (!exactRem) exactAll = false;
    // petit reliquat d'une palette (ex. 1 flotteur sur 50) : même un fournisseur le réemballe en carton
    const repacked = !exactRem && h.qtyPerPackage > 1 ? piecesFor(h, rem, lineIdx).filter((x) => x.repacked) : [];
    if (repacked.length === 1) pieces.push(repacked[0]);
    else pieces.push({
      lineIdx,
      code: item.code || item.pn,
      qty: rem,
      type: h.packageType || 'Colis',
      l: h.length,
      w: h.width,
      h: h.height,
      volume: hv,
      net: rem * h.netWeightPerUnit,
      gross: rem * h.netWeightPerUnit + tare,
      basis: exactRem ? 'reference' : 'partial',
      goodsVolume: hv,
    });
  }
  return { pieces, confidence: conf(exactAll), note: `${per} / ${ref.packageType}` };
}

export function generatePackingList(
  catalog: CatalogItem[],
  requests: RequestLine[],
  options: GenerateOptions = { consolidate: true, reference: '' },
): PackingList {
  const lines: PLLine[] = [];
  const lineItems: (CatalogItem | undefined)[] = [];
  const allPieces: Piece[] = [];
  // Un même article saisi sur plusieurs lignes (ou par code puis par PN) : quantités additionnées,
  // sinon 3 + 3 pompes donneraient deux palettes incomplètes au lieu d'une palette pleine.
  const merged: { req: RequestLine; qty: number; item?: CatalogItem }[] = [];
  for (const req of requests) {
    if (!req.code.trim() && !req.pn.trim()) continue;
    const qty = Number(req.quantity) || 0;
    if (qty <= 0) continue;
    const item = findItem(catalog, req.code, req.pn);
    const same = merged.find((m) =>
      item ? m.item?.id === item.id : !m.item && norm(m.req.code || m.req.pn) === norm(req.code || req.pn),
    );
    if (same) same.qty = round(same.qty + qty, 6);
    else merged.push({ req, qty, item });
  }
  for (const { req, qty, item } of merged) {
    const lineIdx = lines.length;
    lineItems[lineIdx] = item;
    if (!item) {
      lines.push({ lineNo: lineIdx + 1, code: req.code, pn: req.pn, description: '— Article introuvable dans la base —', quantity: qty, unit: '', cases: '', netWeight: 0, grossWeight: 0, hsCode: '', origin: '', found: false, warning: 'Introuvable' });
      continue;
    }
    const grundfos = options.strategy === 'grundfos';
    const packItem = withSimilarPacking(refineMixedShare(item, catalog), catalog);
    const gf = grundfos ? grundfosPieces(packItem, qty, lineIdx) : null;
    const { item: chosen, note, confidence } = gf ? { item: packItem, note: gf.note, confidence: gf.confidence } : chooseVariant(packItem, qty);
    const warnings: string[] = [];
    if (!(chosen.length || chosen.volumePerPackage)) warnings.push('Dimensions manquantes');
    if (!chosen.grossWeightPerUnit) warnings.push('Poids manquant');
    if (chosen.mixed) warnings.push('Données estimées (colis mixte)');
    if (packItem.similarFrom) warnings.push(`Emballage repris de l'article similaire ${packItem.similarFrom}`);
    lines.push({ lineNo: lineIdx + 1, code: item.code, pn: item.pn, description: item.description, quantity: qty, unit: item.unit, cases: '', netWeight: 0, grossWeight: 0, hsCode: item.hsCode, origin: item.origin, found: true, warning: warnings.join(', ') || undefined });
    if (note) lines[lineIdx].packing = note;
    lines[lineIdx].confidence = confidence;
    allPieces.push(...(gf ? gf.pieces : piecesFor(chosen, qty, lineIdx)));
  }

  // ---------- Regroupements ----------
  const isSmall = (p: Piece) => p.volume > 0 && p.volume < SMALL_PKG_M3 && p.gross < SMALL_PKG_KG;
  const grundfosMode = options.strategy === 'grundfos';
  const grundfosGrouping = grundfosMode && options.grundfosGrouping !== false;
  const groups: { pieces: Piece[]; source: 'history' | 'rule' }[] = [];
  let pool = [...allPieces];

  if (grundfosGrouping) {
    // 1) Articles déjà mis ensemble dans un même colis par Grundfos → regroupés de la même façon
    //    (colis de moins de 300 kg : au-delà, Grundfos ne mélange pas dans vos PL)
    const parent = lines.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const ids = (it?: CatalogItem) => (it ? [it.code, it.pn].filter(Boolean) : []);
    for (let i = 0; i < lineItems.length; i++)
      for (let j = i + 1; j < lineItems.length; j++) {
        const a = lineItems[i];
        const b = lineItems[j];
        if (!a || !b) continue;
        const linked = ids(b).some((x) => a.coPacked?.includes(x)) || ids(a).some((x) => b.coPacked?.includes(x));
        if (linked) parent[find(i)] = find(j);
      }
    const comps = new Map<number, Piece[]>();
    // seuls les restes (colis incomplets) et les petits colis sont mélangés : une palette pleine d'un article reste seule
    const mixable = (p: Piece) => p.gross < 300 && p.volume > 0 && (p.basis === 'partial' || (p.volume < 0.35 && p.gross < 150));
    for (const p of pool) {
      if (!mixable(p)) continue;
      const root = find(p.lineIdx);
      comps.set(root, [...(comps.get(root) ?? []), p]);
    }
    for (const list of comps.values()) {
      if (new Set(list.map((p) => p.lineIdx)).size < 2) continue; // il faut au moins deux articles différents
      groups.push({ pieces: list, source: 'history' });
      pool = pool.filter((p) => !list.includes(p));
    }
  }
  // 2) Petits colis restants réunis sur un carton ou une palette (tendance observée chez Grundfos,
  //    et règle de la proposition optimisée si l'option est activée)
  if (grundfosGrouping || (!grundfosMode && options.consolidate)) {
    const small = pool.filter(isSmall);
    if (small.length >= 2) {
      groups.push({ pieces: small, source: 'rule' });
      pool = pool.filter((p) => !small.includes(p));
    }
  }

  const packages: PLPackage[] = [];
  const casesByLine = new Map<number, number[]>();
  const addCase = (lineIdx: number, no: number) => casesByLine.set(lineIdx, [...(casesByLine.get(lineIdx) ?? []), no]);
  for (const p of pool) {
    const no = packages.length + 1;
    packages.push({ no, type: p.type, length: p.l, width: p.w, height: p.h, volume: round(p.volume, 3), netWeight: round(p.net, 2), grossWeight: round(p.gross, 2), contents: [{ code: p.code, quantity: round(p.qty, 4) }], basis: p.basis });
    addCase(p.lineIdx, no);
  }
  for (const grp of groups) {
    for (const g of consolidate(grp.pieces)) {
      const no = packages.length + 1;
      packages.push({ ...g, no, groupSource: grp.source });
      for (const p of grp.pieces) if (g.contents.some((c) => c.code === p.code)) addCase(p.lineIdx, no);
    }
  }

  // Convention L × l × H : la longueur est toujours la plus grande cote au sol
  for (const p of packages) {
    // colis élancé hors palette (ex. pompe 14 × 12 × 143 cm) : il voyage couché, pas debout
    const realPallet = PALLET_RE.test(p.type) && Math.max(p.length, p.width) >= 80 && Math.min(p.length, p.width) >= 50;
    if (!realPallet && p.height > 60 && p.height > 2.5 * Math.max(p.length, p.width)) {
      [p.length, p.width, p.height] = [p.height, Math.max(p.length, p.width), Math.min(p.length, p.width)];
    }
    if (p.width > p.length) [p.length, p.width] = [p.width, p.length];
    // « Pallet » / « EURO PAL » de moins de 80 × 50 cm (et moins de 1,5 m) : c'est un carton, le libellé suit
    if (PALLET_RE.test(p.type) && !/plywood/i.test(p.type) && p.length > 0 && (p.width < 30 || ((p.length < 80 || p.width < 50) && p.length < 150))) p.type = 'Carton';
  }

  // Dimensions à vérifier : reconstituées à partir du volume, ou calculées pour une quantité jamais expédiée ainsi
  const lineInferred = new Set(allPieces.filter((p) => p.dimsInferred).map((p) => p.lineIdx));
  const lineSimilar = new Set(allPieces.filter((p) => p.similar || p.repacked).map((p) => p.lineIdx));
  const codeLine = new Map(lines.map((l, i) => [l.code, i] as const));
  for (const p of packages) {
    const idx = p.contents.map((c) => codeLine.get(c.code)).filter((i): i is number => i !== undefined);
    if (idx.some((i) => lineInferred.has(i))) p.dimCheck = 'inferred';
    else if (idx.some((i) => lineSimilar.has(i))) p.dimCheck = 'estimated';
    // une palette pleine déjà expédiée telle quelle reste fiable ; seuls les colis recalculés (incomplets, regroupés) sont à vérifier
    else if (p.basis !== 'reference' && idx.some((i) => lines[i].confidence === 'estimated' || lines[i].confidence === 'mixed')) p.dimCheck = 'estimated';
    else if (idx.some((i) => lines[i].confidence === 'mixed')) p.dimCheck = 'estimated';
  }

  // Indications de dessin : nombre d'unités et forme des articles
  const itemByCode = new Map<string, CatalogItem | undefined>();
  lines.forEach((l, i) => itemByCode.set(l.code, lineItems[i]));
  for (const p of packages) {
    const units = Math.round(p.contents.reduce((s, c) => s + c.quantity, 0));
    if (units >= 1) p.load = { units, long: p.contents.some((c) => isLongItem(itemByCode.get(c.code))) };
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
