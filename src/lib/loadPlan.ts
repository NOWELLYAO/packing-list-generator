import type { PLPackage } from '../types';
import type { LoadHint } from '../types';
import { CRATE, shippingLabel, type LogoInfo, drawCarton, drawCrate, drawPallet, familyOf, KRAFT, project, quad, shade, solid, withProjection, WOOD_PALLET, type Picture, type Pt, type Shape } from './drawing';
import { round } from './parseValues';

/**
 * Plan de chargement au sol (colis non gerbés), vue de dessus.
 * Placement « MaxRects » (meilleur ajustement, rotation autorisée), colis les plus lourds d'abord
 * placés vers l'avant, puis choix du moyen de transport le plus adapté.
 */

export type TransportMode = 'sea' | 'road' | 'air';

export interface Vehicle {
  id: string;
  family: 'sea' | 'road';
  name: string;
  nameEn: string;
  length: number; // cm intérieur
  width: number;
  /** hauteur intérieure (dessin) */
  height: number;
  doorHeight: number;
  payload: number; // kg
  /** silhouette du dessin 3D */
  kind: 'container' | 'van' | 'box' | 'semi';
  /** proposé seulement si l'utilisateur le choisit (peu disponible) */
  manualOnly?: boolean;
}

/** Dimensions intérieures indicatives (elles varient selon les modèles et les loueurs) */
export const VEHICLES: Vehicle[] = [
  // du plus petit au plus grand dans chaque famille
  { id: '10', family: 'sea', kind: 'container', manualOnly: true, name: "Conteneur 10'", nameEn: "10' container", length: 279, width: 235, height: 238, doorHeight: 228, payload: 9000 },
  { id: '20', family: 'sea', kind: 'container', name: "Conteneur 20'", nameEn: "20' container", length: 589, width: 235, height: 239, doorHeight: 228, payload: 28200 },
  { id: '40', family: 'sea', kind: 'container', name: "Conteneur 40'", nameEn: "40' container", length: 1203, width: 235, height: 239, doorHeight: 228, payload: 26700 },
  { id: '40hc', family: 'sea', kind: 'container', name: "Conteneur 40' HC", nameEn: "40' HC container", length: 1203, width: 235, height: 269, doorHeight: 258, payload: 26500 },
  { id: 'mini', family: 'road', kind: 'van', name: 'Mini-utilitaire 3 m³', nameEn: 'Small van 3 m³', length: 200, width: 123, height: 122, doorHeight: 115, payload: 650 },
  { id: 'van12', family: 'road', kind: 'van', name: 'Fourgon 12 m³', nameEn: '12 m³ van', length: 373, width: 176, height: 189, doorHeight: 182, payload: 1250 },
  { id: 'box20', family: 'road', kind: 'box', name: 'Camion 20 m³ (3,5 t)', nameEn: '20 m³ box truck (3.5 t)', length: 430, width: 210, height: 220, doorHeight: 215, payload: 1000 },
  { id: 'p12', family: 'road', kind: 'box', name: 'Porteur 12 t (6,2 m)', nameEn: '12 t rigid truck (6.2 m)', length: 620, width: 245, height: 245, doorHeight: 240, payload: 5500 },
  { id: 'porteur', family: 'road', kind: 'box', name: 'Porteur 19 t (7,2 m)', nameEn: '19 t rigid truck (7.2 m)', length: 720, width: 245, height: 260, doorHeight: 250, payload: 9000 },
  { id: 'semi', family: 'road', kind: 'semi', name: 'Semi-remorque 13,6 m', nameEn: '13.6 m semi-trailer', length: 1360, width: 245, height: 270, doorHeight: 270, payload: 24000 },
];

export interface Placement {
  no: number;
  x: number; // le long du véhicule (0 = fond)
  y: number; // en travers
  l: number; // emprise en longueur
  w: number; // emprise en largeur
  h: number;
  kg: number;
  type: string;
  rotated: boolean;
  load?: LoadHint;
  dimCheck?: 'inferred' | 'estimated';
}

export interface Bin {
  /** véhicule de ce chargement (un 20' peut compléter des 40') */
  vehicle: Vehicle;
  placements: Placement[];
  usedLength: number; // cm
  floorPct: number;
  weight: number;
  /** centre de gravité au sol, en % de la longueur / largeur */
  cogX: number;
  cogY: number;
}

export interface LoadPlan {
  vehicle: Vehicle;
  /** libellé de la solution, ex. "1 × Conteneur 40' + 1 × Conteneur 20'" */
  summary: string;
  summaryEn: string;
  bins: Bin[];
  /** mètres de plancher (camion) : longueur occupée sur toute la largeur */
  /** mètres de plancher, définition standard : surface au sol des colis ÷ 2,4 m (largeur de référence d'une remorque) */
  ldm: number;
  /** envoi léger : la messagerie / l'express convient mieux qu'un véhicule */
  light: boolean;
  unplaced: number[];
  warnings: string[];
  /** mêmes alertes, en anglais (documents EN) */
  warningsEn: string[];
  /** toutes les solutions évaluées, pour comparaison */
  alternatives: { vehicle: Vehicle; count: number; feasible: boolean; reason?: string }[];
}

type Rect = { x: number; y: number; l: number; w: number };

/** Remplit un véhicule ; renvoie les colis placés et ceux qui restent */
/** lambda : importance de l'équilibre gauche/droite (cm de longueur acceptés par cm de décentrage) ; -1 = compact pur */
function fillOne(v: Vehicle, items: PLPackage[], lambda: number): { placed: Placement[]; rest: PLPackage[] } {
  const balance = lambda >= 0;
  let free: Rect[] = [{ x: 0, y: 0, l: v.length, w: v.width }];
  const placed: Placement[] = [];
  const rest: PLPackage[] = [];
  let weight = 0;
  for (const it of items) {
    if (weight + it.grossWeight > v.payload) {
      rest.push(it);
      continue;
    }
    // Candidats : chaque espace libre, colis tourné ou non, calé d'un côté ou de l'autre du véhicule.
    // Priorité : le plus au fond (chargement compact), puis l'équilibre gauche/droite, puis le meilleur ajustement.
    let best: { x: number; y: number; l: number; w: number; rot: boolean; fit: number; imbalance: number } | null = null;
    const momentY = placed.reduce((s, q) => s + (q.y + q.w / 2) * q.kg, 0);
    const mass = weight + it.grossWeight;
    for (const r of free) {
      for (const [l, w, rot] of [
        [it.length, it.width, false],
        [it.width, it.length, true],
      ] as [number, number, boolean][]) {
        if (l > r.l + 0.01 || w > r.w + 0.01) continue;
        for (const y of new Set(balance ? [r.y, r.y + r.w - w] : [r.y])) {
          const fit = Math.min(r.l - l, r.w - w);
          const imbalance = balance ? Math.abs((momentY + (y + w / 2) * it.grossWeight) / mass - v.width / 2) : 0;
          const cost = r.x + Math.max(0, lambda) * imbalance;
          const bestCost = best ? best.x + Math.max(0, lambda) * best.imbalance : Infinity;
          const better =
            !best ||
            cost < bestCost - 1 ||
            (Math.abs(cost - bestCost) <= 1 && (imbalance < best.imbalance - 1 || (Math.abs(imbalance - best.imbalance) <= 1 && fit < best.fit)));
          if (better) best = { x: r.x, y, l, w, rot, fit, imbalance };
        }
      }
    }
    if (!best) {
      rest.push(it);
      continue;
    }
    const p: Placement = { no: it.no, x: best.x, y: best.y, l: best.l, w: best.w, h: it.height, kg: it.grossWeight, type: it.type, rotated: best.rot, load: it.load, dimCheck: it.dimCheck };
    placed.push(p);
    weight += it.grossWeight;
    // découpe MaxRects des espaces libres intersectés
    const next: Rect[] = [];
    for (const r of free) {
      if (p.x >= r.x + r.l || p.x + p.l <= r.x || p.y >= r.y + r.w || p.y + p.w <= r.y) {
        next.push(r);
        continue;
      }
      if (p.x > r.x) next.push({ x: r.x, y: r.y, l: p.x - r.x, w: r.w });
      if (p.x + p.l < r.x + r.l) next.push({ x: p.x + p.l, y: r.y, l: r.x + r.l - (p.x + p.l), w: r.w });
      if (p.y > r.y) next.push({ x: r.x, y: r.y, l: r.l, w: p.y - r.y });
      if (p.y + p.w < r.y + r.w) next.push({ x: r.x, y: p.y + p.w, l: r.l, w: r.y + r.w - (p.y + p.w) });
    }
    // retirer les rectangles inclus dans d'autres
    free = next.filter(
      (a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.l <= b.x + b.l && a.y + a.w <= b.y + b.w && (j < i || a.x !== b.x || a.y !== b.y || a.l !== b.l || a.w !== b.w)),
    );
  }
  return { placed, rest };
}

function binStats(v: Vehicle, placed: Placement[]): Bin {
  const usedLength = Math.max(0, ...placed.map((p) => p.x + p.l));
  const area = placed.reduce((s, p) => s + p.l * p.w, 0);
  const weight = placed.reduce((s, p) => s + p.kg, 0);
  const cx = weight ? placed.reduce((s, p) => s + (p.x + p.l / 2) * p.kg, 0) / weight : 0;
  const cy = weight ? placed.reduce((s, p) => s + (p.y + p.w / 2) * p.kg, 0) / weight : 0;
  return {
    vehicle: v,
    placements: placed,
    usedLength,
    floorPct: round((area / (v.length * v.width)) * 100, 1),
    weight: round(weight, 1),
    cogX: round((cx / v.length) * 100, 1),
    cogY: round((cy / v.width) * 100, 1),
  };
}

function packWith(v: Vehicle, pkgs: PLPackage[], lambda: number): { bins: Bin[]; unplaced: number[] } {
  // les plus grandes emprises d'abord (puis les plus lourdes) : rangement plus dense et charge vers le fond
  let queue = [...pkgs].sort((a, b) => b.length * b.width - a.length * a.width || b.grossWeight - a.grossWeight);
  const bins: Bin[] = [];
  const unplaced: number[] = [];
  for (let guard = 0; queue.length && guard < 50; guard++) {
    const { placed, rest } = fillOne(v, queue, lambda);
    if (!placed.length) {
      unplaced.push(...rest.map((r) => r.no));
      break;
    }
    bins.push(binStats(v, placed));
    queue = rest;
  }
  return { bins, unplaced };
}

/**
 * Plusieurs rangements sont essayés, du plus compact (colis calés au fond et sur un côté)
 * au plus équilibré (chaque colis du côté qui recentre la charge, quitte à allonger un peu).
 * On garde celui qui place tout avec le moins de véhicules ; à longueur équivalente
 * (± 5 % du véhicule), le mieux équilibré.
 */
function pack(v: Vehicle, pkgs: PLPackage[]): { bins: Bin[]; unplaced: number[] } {
  const cands = [-1, 0, 1, 3, 8].map((lambda) => packWith(v, pkgs, lambda));
  const len = (r: { bins: Bin[] }) => r.bins.reduce((s, b) => s + b.usedLength, 0);
  const imb = (r: { bins: Bin[] }) => Math.max(0, ...r.bins.map((b) => Math.abs(b.cogY - 50)));
  cands.sort((a, b) => {
    if (a.unplaced.length !== b.unplaced.length) return a.unplaced.length - b.unplaced.length;
    if (a.bins.length !== b.bins.length) return a.bins.length - b.bins.length;
    // longueurs équivalentes (à 5 % du véhicule près) : le mieux équilibré l'emporte
    if (Math.abs(len(a) - len(b)) > v.length * 0.05) return len(a) - len(b);
    return imb(a) - imb(b) || len(a) - len(b);
  });
  return cands[0];
}

/** Libellé « 2 × Conteneur 40' + 1 × Conteneur 20' » */
function describe(bins: Bin[], en: boolean): string {
  const counts = new Map<string, { v: Vehicle; n: number }>();
  for (const b of bins) {
    const c = counts.get(b.vehicle.id);
    if (c) c.n++;
    else counts.set(b.vehicle.id, { v: b.vehicle, n: 1 });
  }
  return [...counts.values()].map(({ v, n }) => `${n} × ${en ? v.nameEn : v.name}`).join(' + ');
}

/**
 * Choisit le transport le plus adapté dans la famille demandée (maritime : conteneurs ; routier : camions)
 * et produit le plan. Critère : le moins de véhicules, puis le plus petit véhicule.
 * Maritime : si le dernier conteneur d'une série de 40' peut être un 20', il est remplacé.
 */
export function planLoad(pkgs: PLPackage[], mode: 'auto' | string = 'auto', family: 'sea' | 'road' = 'sea'): LoadPlan | null {
  const items = pkgs.filter((p) => p.length > 0 && p.width > 0);
  if (!items.length) return null;
  const tallest = Math.max(...items.map((p) => p.height));
  const fleet = VEHICLES.filter((v) => v.family === family);
  const alternatives: LoadPlan['alternatives'] = [];
  let chosen: { v: Vehicle; bins: Bin[]; unplaced: number[] } | null = null;
  for (const v of fleet) {
    if (tallest > v.doorHeight) {
      alternatives.push({ vehicle: v, count: 0, feasible: false, reason: `colis de ${tallest} cm > porte ${v.doorHeight} cm` });
      continue;
    }
    const r = pack(v, items);
    const feasible = r.unplaced.length === 0;
    alternatives.push({ vehicle: v, count: r.bins.length, feasible, reason: feasible ? undefined : `${r.unplaced.length} colis trop grand(s)` });
    if (mode !== 'auto' ? v.id === mode : !v.manualOnly && feasible && (!chosen || r.bins.length < chosen.bins.length)) chosen = { v, bins: r.bins, unplaced: r.unplaced };
  }
  if (!chosen) {
    const v = fleet.find((x) => x.id === mode) ?? fleet[fleet.length - 1];
    chosen = { v, ...pack(v, items) };
  }
  // Compléter avec un véhicule plus petit pour le dernier chargement (ex. 40' + 20' au lieu de 2 × 40')
  if (mode === 'auto' && chosen.bins.length > 1) {
    const last = chosen.bins[chosen.bins.length - 1];
    const lastItems = items.filter((p) => last.placements.some((q) => q.no === p.no));
    const lastTallest = Math.max(...lastItems.map((p) => p.height));
    for (const small of fleet.filter((v) => !v.manualOnly && v.length * v.width < chosen!.v.length * chosen!.v.width && lastTallest <= v.doorHeight)) {
      const r = pack(small, lastItems);
      if (r.bins.length === 1 && !r.unplaced.length) {
        chosen.bins = [...chosen.bins.slice(0, -1), r.bins[0]];
        break;
      }
    }
  }
  const warnings: string[] = [];
  const warningsEn: string[] = [];
  const fr = (n: number) => String(n).replace('.', ',');
  chosen.bins.forEach((b, i) => {
    const tag = chosen!.bins.length > 1 ? ` (n° ${i + 1})` : '';
    const tagEn = chosen!.bins.length > 1 ? ` (no. ${i + 1})` : '';
    // charge reportée vers les portes : risque réel (essieu arrière, basculement à l'ouverture)
    if (b.cogX > 62 && b.weight > b.vehicle.payload * 0.2) {
      warnings.push(`Centre de gravité à ${fr(b.cogX)} % de la longueur, côté portes${tag} : avancer les colis lourds vers le fond`);
      warningsEn.push(`Centre of gravity at ${b.cogX} % of the length, door side${tagEn}: move heavy packages towards the front`);
    }
    // charge lourde concentrée tout à l'avant : surcharge de l'essieu avant possible
    else if (b.cogX < 25 && b.weight > b.vehicle.payload * 0.5) {
      warnings.push(`Charge lourde concentrée à l'avant (${fr(b.cogX)} % de la longueur)${tag} : répartir sur la longueur`);
      warningsEn.push(`Heavy load concentrated at the front (${b.cogX} % of the length)${tagEn}: spread it along the length`);
    }
    if (Math.abs(b.cogY - 50) > 10 && b.weight > Math.max(300, b.vehicle.payload * 0.15)) {
      warnings.push(`Charge décentrée en largeur (${fr(b.cogY)} %)${tag} : caler les colis`);
      warningsEn.push(`Load off-centre across the width (${b.cogY} %)${tagEn}: secure the packages`);
    }
  });
  // envoi léger : un véhicule dédié n'est pas la solution la plus logique
  const totalKg = items.reduce((t, p) => t + p.grossWeight, 0);
  const totalM3 = items.reduce((t, p) => t + (p.length * p.width * p.height) / 1e6, 0);
  const light = totalKg <= 70 && totalM3 <= 0.3;
  // 1 à 3 palettes / caisses, en route : un réseau de messagerie palette ou le groupage coûte en général moins qu'un véhicule dédié
  if (!light && family === 'road' && items.length <= 3 && totalKg <= 3000 && chosen.bins.length === 1) {
    const n = items.length;
    warnings.push(`${n} colis (${fr(Math.round(totalKg))} kg) : la messagerie palette ou le groupage est souvent moins cher qu'un véhicule dédié — à comparer`);
    warningsEn.push(`${n} package(s) (${Math.round(totalKg)} kg): a pallet network or groupage service is often cheaper than a dedicated vehicle — compare quotes`);
  }
  if (light) {
    const kg = Math.round(totalKg * 10) / 10;
    const m3 = Math.round(totalM3 * 1000) / 1000;
    warnings.push(`Envoi léger (${fr(kg)} kg, ${fr(m3)} m³) : messagerie ou express recommandé, pas de véhicule dédié`);
    warningsEn.push(`Light shipment (${kg} kg, ${m3} m³): parcel or express service is better suited than a dedicated vehicle`);
  }
  return {
    vehicle: chosen.v,
    summary: describe(chosen.bins, false),
    summaryEn: describe(chosen.bins, true),
    bins: chosen.bins,
    ldm: round(items.reduce((s, p) => s + p.length * p.width, 0) / 240 / 100, 2),
    light,
    unplaced: chosen.unplaced,
    warnings,
    warningsEn,
    alternatives,
  };
}

/* ------------------------------------------------------------------ */
/* Dessin du plan (vue de dessus)                                      */
/* ------------------------------------------------------------------ */

export function loadPlanDrawing(bin: Bin, accent: string, lang: 'fr' | 'en', width = 640): Picture {
  const v = bin.vehicle;
  const pad = 26;
  const k = (width - pad * 2) / v.length;
  const H = v.width * k;
  const shapes: Shape[] = [];
  const X = (cm: number) => pad + cm * k;
  const Y = (cm: number) => 22 + cm * k;
  const INK = '#2b3442';
  // plancher
  shapes.push({ kind: 'poly', pts: [[X(0), Y(0)], [X(v.length), Y(0)], [X(v.length), Y(v.width)], [X(0), Y(v.width)]], fill: '#f4f6f9', stroke: '#8a96a6', sw: 1.2 });
  // graduation tous les mètres
  for (let m = 100; m < v.length; m += 100) {
    shapes.push({ kind: 'line', a: [X(m), Y(v.width)], b: [X(m), Y(v.width) + 4], stroke: '#9aa5b4', sw: 0.5 });
    if (m % 200 === 0 || v.length < 700) shapes.push({ kind: 'text', at: [X(m), Y(v.width) + 12], text: `${m / 100} m`, size: 6.5, color: '#7a8596', anchor: 'middle' });
  }
  // porte
  shapes.push({ kind: 'line', a: [X(v.length) + 3, Y(0)], b: [X(v.length) + 3, Y(v.width)], stroke: accent, sw: 2.2 });
  shapes.push({ kind: 'text', at: [X(v.length) + 12, Y(v.width / 2)], text: lang === 'fr' ? 'PORTE' : 'DOOR', size: 7, color: accent, anchor: 'middle', rotate: -90, bold: true });
  shapes.push({ kind: 'text', at: [X(0) - 10, Y(v.width / 2)], text: lang === 'fr' ? 'FOND' : 'FRONT', size: 7, color: '#7a8596', anchor: 'middle', rotate: -90 });
  // colis : couleur par famille, intensité selon le poids
  const maxKg = Math.max(...bin.placements.map((p) => p.kg), 1);
  for (const p of bin.placements) {
    const fam = familyOf(p.type, { length: p.l, width: p.w, height: p.h });
    // mêmes matières que la vue 3D ; plus le colis est lourd, plus la teinte est soutenue
    const baseC = fam === 'crate' ? CRATE : fam === 'carton' ? KRAFT : fam === 'pallet' ? '#cdb08a' : '#c9d1db';
    const fill = shade(baseC, 0.45 - 0.45 * (p.kg / maxKg));
    shapes.push({ kind: 'poly', pts: [[X(p.x), Y(p.y)], [X(p.x + p.l), Y(p.y)], [X(p.x + p.l), Y(p.y + p.w)], [X(p.x), Y(p.y + p.w)]], fill, stroke: shade(baseC, -0.5), sw: fam === 'pallet' ? 1.4 : 0.8 });
    if (fam === 'crate') for (let f = 0.25; f < 1; f += 0.25) shapes.push({ kind: 'line', a: [X(p.x), Y(p.y + p.w * f)], b: [X(p.x + p.l), Y(p.y + p.w * f)], stroke: shade(CRATE, -0.3), sw: 0.4, opacity: 0.6 });
    const cx = X(p.x + p.l / 2);
    const cy = Y(p.y + p.w / 2);
    const big = p.l * k > 34 && p.w * k > 22;
    if (p.dimCheck) {
      const r: [number, number][] = [[X(p.x), Y(p.y)], [X(p.x + p.l), Y(p.y)], [X(p.x + p.l), Y(p.y + p.w)], [X(p.x), Y(p.y + p.w)]];
      r.forEach((a, i) => shapes.push({ kind: 'line', a, b: r[(i + 1) % 4], stroke: '#c2410c', sw: 1.2, dash: true }));
    }
    shapes.push({ kind: 'text', at: [cx, cy + (big ? -1 : 2.5)], text: String(p.no), size: big ? 9 : 7, color: p.dimCheck ? '#c2410c' : INK, anchor: 'middle', bold: true });
    if (big) shapes.push({ kind: 'text', at: [cx, cy + 8], text: `${(Math.round(p.kg * 100) / 100).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 })} kg`, size: 6, color: INK, anchor: 'middle' });
  }
  // longueur utilisée
  if (bin.usedLength > 0) {
    shapes.push({ kind: 'line', a: [X(0), Y(0) - 8], b: [X(bin.usedLength), Y(0) - 8], stroke: INK, sw: 0.6 });
    shapes.push({ kind: 'line', a: [X(bin.usedLength), Y(0) - 12], b: [X(bin.usedLength), Y(v.width)], stroke: INK, sw: 0.5, dash: true });
    shapes.push({
      kind: 'text',
      at: [X(bin.usedLength / 2), Y(0) - 11],
      text: `${(bin.usedLength / 100).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 })} m ${lang === 'fr' ? 'utilisés' : 'used'}`,
      size: 7,
      color: INK,
      anchor: 'middle',
      bold: true,
    });
  }
  // centre de gravité
  const gx = X((bin.cogX / 100) * v.length);
  const gy = Y((bin.cogY / 100) * v.width);
  shapes.push({ kind: 'line', a: [X(v.length / 2), Y(0)], b: [X(v.length / 2), Y(v.width)], stroke: '#9aa5b4', sw: 0.5, dash: true });
  shapes.push({ kind: 'circle', c: [gx, gy], r: 4.5, fill: '#ffffff', stroke: '#c0262d', sw: 1.4 });
  shapes.push({ kind: 'line', a: [gx - 6, gy], b: [gx + 6, gy], stroke: '#c0262d', sw: 1 });
  shapes.push({ kind: 'line', a: [gx, gy - 6], b: [gx, gy + 6], stroke: '#c0262d', sw: 1 });
  return { shapes, w: width, h: H + 50 };
}

/* ------------------------------------------------------------------ */
/* Vue 3D réaliste : véhicule ouvert (paroi avant et toit retirés)     */
/* ------------------------------------------------------------------ */

/** Projection oblique : la longueur du véhicule à l'horizontale, la profondeur en biais */
const DC = 0.42;
const DS = 0.3;

/** Ordre de dessin (peintre) : de gauche à droite, puis du fond vers l'avant */
function paintOrder(ps: Placement[]): Placement[] {
  const before = (A: Placement, B: Placement) => {
    if (A.x + A.l <= B.x + 0.01) return true;
    if (B.x + B.l <= A.x + 0.01) return false;
    return A.y + A.w <= B.y + 0.01;
  };
  const rest = [...ps];
  const out: Placement[] = [];
  while (rest.length) {
    let i = rest.findIndex((p) => !rest.some((q) => q !== p && before(q, p)));
    if (i < 0) i = rest.reduce((bi, p, j) => (p.y < rest[bi].y || (p.y === rest[bi].y && p.x < rest[bi].x) ? j : bi), 0);
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

/** animation du chargement : colis en cours de mise en place, soulevé de dz cm (le reste est posé) */
export interface LiftAnim {
  no: number;
  dz: number;
}

/** point de vue de la vue 3D : côté du véhicule regardé, extrémité (cabine à gauche ou à droite), hauteur de l'œil */
export interface View3D {
  /** regarder depuis l'autre paroi latérale (les colis du fond deviennent visibles) */
  side?: boolean;
  /** cabine à droite (vue depuis l'autre extrémité) */
  end?: boolean;
  /** inclinaison de la vue : 0,12 (rasante) → 0,7 (plongeante) ; 0,3 par défaut */
  elev?: number;
}

export function loadPlan3D(bin0: Bin, lang: 'fr' | 'en', width = 640, logo?: LogoInfo, lift?: LiftAnim, view?: View3D): Picture {
  const W0 = bin0.vehicle.width;
  const bin: Bin = view?.side ? { ...bin0, placements: bin0.placements.map((p) => ({ ...p, y: W0 - p.y - p.w })) } : bin0;
  const ds = Math.max(0.1, Math.min(0.75, view?.elev ?? DS));
  const proj = (a: number, b: number, z: number): Pt => [a - b * DC, -z + b * ds];
  const dzOf = (no: number) => (lift && lift.no === no ? lift.dz : 0);
  const v = bin.vehicle;
  const L = v.length;
  const W = v.width;
  const H = v.height;
  const kind = v.kind;
  // géométrie du véhicule (cm)
  const R = kind === 'container' ? 0 : ({ mini: 30, van12: 34, box20: 40, p12: 48, porteur: 50, semi: 50 } as Record<string, number>)[v.id] ?? 45;
  const floorH = kind === 'container' ? 16 : ({ mini: 52, van12: 60, box20: 85, p12: 110, porteur: 115, semi: 122 } as Record<string, number>)[v.id] ?? 100;
  const ground = -floorH;
  const cabL = kind === 'van' ? (v.id === 'mini' ? 95 : 130) : kind === 'box' ? (v.id === 'box20' ? 165 : 195) : kind === 'semi' ? 230 : 0;
  const gap = kind === 'box' ? 18 : kind === 'semi' ? 40 : 0;
  const hood = kind === 'van' ? (v.id === 'mini' ? 55 : 70) : 0;
  const front = -(cabL + gap + hood + (kind === 'semi' ? 30 : 0));
  const doorW = W / 2;
  const rear = L + 10 + doorW;
  // estimation de l'échelle pour choisir le niveau de détail des colis
  const kEst = (width - 40) / (rear - front + W * DC);

  const raw: Shape[] = [];
  const overlay: { at: Pt; cands: Pt[]; hidden: boolean; top: Pt[]; text: string; r: number; check?: boolean }[] = [];
  const P = (s: Shape[]) => raw.push(...s);

  withProjection(proj, () => {
    const wallC = kind === 'container' ? '#3d6d91' : '#eef1f4';
    const wallIn = kind === 'container' ? '#4f7fa3' : '#f3f5f7';
    const floorC = kind === 'container' ? '#9c7149' : '#8b6a48';
    const steel = '#2f3439';
    const cabC = kind === 'semi' ? '#b5372b' : '#f2f4f6';

    // ombre au sol
    P([quad([front, -5, ground], [rear - front, 0, 0], [0, W + 25, 0], '#1b2430', undefined, undefined, 0.1)]);

    // roues côté fond
    const axles: number[] =
      kind === 'container'
        ? []
        : kind === 'van'
          ? [front + hood * 0.45, L * 0.66]
          : kind === 'box'
            ? [-gap - cabL * 0.62, L * 0.68]
            : [-gap - cabL * 0.7, 40, L - 330, L - 230, L - 130];
    const wheel = (a: number, b: number) => {
      const c = project(a, b, ground + R);
      return [
        { kind: 'circle' as const, c, r: R, fill: '#1f2226' },
        { kind: 'circle' as const, c, r: R * 0.56, fill: '#aab2bb', stroke: '#6b737c', sw: 0.4 },
        { kind: 'circle' as const, c, r: R * 0.18, fill: '#4a5058' },
      ];
    };
    for (const a of axles) P(wheel(a, 6));

    // châssis / berceau
    if (kind === 'container') {
      P(solid(0, L + 10, 0, W, ground, 0, '#33576f', '#1d2f3d', 1, 0.5));
    } else {
      P(solid(front + 10, L - 10, W * 0.18, W * 0.82, ground + R * 0.95, ground + R * 1.5, steel, '#111', 1, 0.4));
      if (kind !== 'van') P(solid(-5, L, 0, W, ground + R * 1.5, 0, '#4a5058', '#22262a', 1, 0.4));
    }

    // cabine
    if (kind === 'van') {
      const z0 = ground + R * 0.85;
      P(solid(front, front + hood, 2, W - 2, z0, z0 + (H - z0) * 0.45, cabC, '#8e98a3', 3, 0.5));
      P(solid(front + hood, 0, 0, W, z0, H + 8, cabC, '#8e98a3', 3, 0.5));
      // vitre latérale + pare-brise suggéré
      P([quad([front + hood + cabL * 0.1, W, H * 0.45], [cabL * 0.75, 0, 0], [0, 0, H * 0.42], '#6f8aa3', '#3c4e60', 0.4)]);
      P([quad([front + hood + cabL * 0.15, W, H * 0.62], [cabL * 0.2, 0, 0], [0, 0, H * 0.22], '#ffffff', undefined, undefined, 0.25)]);
    } else if (kind === 'box' || kind === 'semi') {
      const a0 = -gap - cabL;
      const a1 = -gap;
      const z0 = ground + R * 0.9;
      const top = kind === 'semi' ? Math.max(H * 0.95, 230) : Math.min(H * 0.92, 240);
      P(solid(a0, a1, 4, W - 4, z0, top, cabC, shade(cabC, -0.5), 3, 0.5));
      // pare-chocs
      P([quad([a0, W - 4, z0], [cabL, 0, 0], [0, 0, 22], '#3a3f45', '#1d2023', 0.4)]);
      // vitre de portière
      P([quad([a0 + cabL * 0.12, W - 4, top - (top - z0) * 0.42], [cabL * 0.5, 0, 0], [0, 0, (top - z0) * 0.32], '#6f8aa3', '#3c4e60', 0.4)]);
      P([quad([a0 + cabL * 0.16, W - 4, top - (top - z0) * 0.3], [cabL * 0.12, 0, 0], [0, 0, (top - z0) * 0.15], '#ffffff', undefined, undefined, 0.25)]);
      // ligne de portière + poignée
      P([{ kind: 'line', a: project(a0 + cabL * 0.68, W - 4, z0 + 10), b: project(a0 + cabL * 0.68, W - 4, top - 8), stroke: shade(cabC, -0.45), sw: 0.5 }]);
      P([quad([a0 + cabL * 0.55, W - 4, (z0 + top) / 2], [12, 0, 0], [0, 0, 4], '#555')]);
      if (kind === 'semi') P(solid(a0 + cabL * 0.25, a1 - 5, 20, W - 20, top, top + 40, shade(cabC, 0.1), shade(cabC, -0.5), 2, 0.4)); // déflecteur
    }

    // plancher (planches)
    P([quad([0, 0, 0], [L, 0, 0], [0, W, 0], floorC, shade(floorC, -0.4), 0.4)]);
    for (let b = 30; b < W; b += 30) P([{ kind: 'line', a: project(0, b, 0), b: project(L, b, 0), stroke: shade(floorC, -0.3), sw: 0.3, opacity: 0.6 }]);

    // paroi du fond (face intérieure) avec nervures / montants
    P([quad([0, 0, 0], [L, 0, 0], [0, 0, H], shade(wallIn, -0.06), shade(wallIn, -0.4), 0.4)]);
    if (kind === 'container') {
      for (let a = 0; a < L; a += 28) P([quad([a + 14, 0, 0], [14, 0, 0], [0, 0, H], shade(wallIn, -0.16))]);
    } else {
      for (let a = 60; a < L; a += 60) P([quad([a - 3, 0, 0], [6, 0, 0], [0, 0, H], '#c3cad3')]);
      for (const z of [H * 0.35, H * 0.7]) P([{ kind: 'line', a: project(0, 0, z), b: project(L, 0, z), stroke: '#9aa4ae', sw: 0.6 }]);
    }
    // paroi avant (face intérieure)
    P([quad([0, 0, 0], [0, W, 0], [0, 0, H], shade(wallIn, -0.18), shade(wallIn, -0.45), 0.4)]);
    if (kind === 'container') for (let b = 0; b < W; b += 28) P([quad([0, b + 14, 0], [0, 14, 0], [0, 0, H], shade(wallIn, -0.26))]);
    // longerons hauts
    P(solid(0, L, -8, 0, H, H + 10, wallC, shade(wallC, -0.5), 1, 0.4));
    P(solid(-8, 0, -8, W, H, H + 10, wallC, shade(wallC, -0.5), 1, 0.4));
    P(solid(-8, 0, W - 8, W, 0, H, wallC, shade(wallC, -0.5), 1, 0.4)); // montant avant côté visible

    // porte gauche ouverte (côté fond)
    const door = (b: number) => {
      const out: Shape[] = [quad([L + 10, b, 0], [doorW, 0, 0], [0, 0, H], shade(wallC, -0.05), shade(wallC, -0.5), 0.5)];
      if (kind === 'container') for (let a = L + 24; a < L + 10 + doorW; a += 22) out.push(quad([a, b, 0], [8, 0, 0], [0, 0, H], shade(wallC, -0.15)));
      for (const f of [0.25, 0.7]) out.push({ kind: 'line', a: project(L + 10 + doorW * f, b, 6), b: project(L + 10 + doorW * f, b, H - 6), stroke: '#9aa3ac', sw: 0.9 });
      return out;
    };
    P(door(0));

    // colis
    const order = paintOrder(bin.placements);
    // silhouette projetée de chaque colis : sert à savoir si le dessus d'un colis est masqué par un colis dessiné devant
    const hulls = order.map((q) => {
      const hq = Math.max(1, q.h);
      const pts: Pt[] = [];
      for (const [a, b, z] of [[0, 0, 0], [q.l, 0, 0], [0, q.w, 0], [q.l, q.w, 0], [0, 0, hq], [q.l, 0, hq], [0, q.w, hq], [q.l, q.w, hq]]) pts.push(project(q.x + a, q.y + b, z + dzOf(q.no)));
      return convexHull(pts);
    });
    for (const [idx, p] of order.entries()) {
      const fam = familyOf(p.type, { length: p.l, width: p.w, height: p.h });
      const dz = dzOf(p.no);
      const off = project(p.x, p.y, dz);
      const push = (sh: Shape[]) => {
        for (const x of sh) {
          if (x.kind === 'poly') raw.push({ ...x, pts: x.pts.map(([u, w]) => [u + off[0], w + off[1]] as Pt) });
          else if (x.kind === 'line') raw.push({ ...x, a: [x.a[0] + off[0], x.a[1] + off[1]], b: [x.b[0] + off[0], x.b[1] + off[1]] });
          else if (x.kind === 'circle') raw.push({ ...x, c: [x.c[0] + off[0], x.c[1] + off[1]], r: x.r / kEst });
          else if (x.kind === 'image') raw.push({ ...x, p0: [x.p0[0] + off[0], x.p0[1] + off[1]], p1: [x.p1[0] + off[0], x.p1[1] + off[1]], p3: [x.p3[0] + off[0], x.p3[1] + off[1]] });
          else raw.push(x);
        }
      };
      const small = Math.min(p.l, p.w) * kEst < 26;
      const h = Math.max(1, p.h);
      if (!small) {
        if (fam === 'pallet') drawPallet(push, p.l, p.w, h, 1, p.load);
        else if (fam === 'crate') drawCrate(push, p.l, p.w, h, 1);
        else if (fam === 'carton') drawCarton(push, p.l, p.w, h, 1, 0, !!logo);
        else push(solid(0, p.l, 0, p.w, 0, h, '#c9d1db', '#5d6670', 4, 0.5));
        if (logo) push(shippingLabel(fam, p.l, p.w, h, logo));
      } else if (fam === 'pallet') {
        const pb = Math.min(14.4, h * 0.35);
        push(solid(0, p.l, 0, p.w, 0, pb, WOOD_PALLET, shade(WOOD_PALLET, -0.55), 1, 0.35));
        if (h - pb > 0.5) {
          push(solid(0, p.l, 0, p.w, pb, h, KRAFT, shade(KRAFT, -0.5), 2, 0.35));
          push([quad([0, p.w, pb], [p.l, 0, 0], [0, 0, h - pb], '#ffffff', undefined, undefined, 0.2)]);
        }
      } else if (fam === 'crate') {
        push(solid(0, p.l, 0, p.w, 0, h, CRATE, shade(CRATE, -0.55), 2, 0.4));
        for (let z = 14; z < h; z += 14) push([{ kind: 'line', a: project(0, p.w, z), b: project(p.l, p.w, z), stroke: shade(CRATE, -0.4), sw: 0.3, opacity: 0.7 }]);
      } else push(solid(0, p.l, 0, p.w, 0, h, fam === 'carton' ? KRAFT : '#c9d1db', '#6b5a45', 2, 0.4));
      // point d'accroche du numéro : la partie visible du dessus la plus proche du centre
      const samples: { pt: Pt; d: number }[] = [];
      for (const u of [0.5, 0.35, 0.65, 0.2, 0.8, 0.08, 0.92, 0.97, 0.03])
        for (const v of [0.5, 0.25, 0.75, 0.1, 0.9]) samples.push({ pt: project(p.x + p.l * u, p.y + p.w * v, h + dz), d: Math.abs(u - 0.5) + Math.abs(v - 0.5) * 0.6 });
      const visible = samples.filter((sm) => !hulls.slice(idx + 1).some((hq) => insideHull(sm.pt, hq, 1.5))).sort((a, b) => a.d - b.d);
      const top = [project(p.x, p.y, h + dz), project(p.x + p.l, p.y, h + dz), project(p.x + p.l, p.y + p.w, h + dz), project(p.x, p.y + p.w, h + dz)];
      overlay.push({ at: samples[0].pt, cands: visible.map((sm) => sm.pt), hidden: visible.length < samples.length * 0.5, top, text: String(p.no), r: Math.min(p.l, p.w), check: !!p.dimCheck });
    }

    // cadre arrière, longeron bas et arêtes du volume (côté ouvert)
    P(solid(L, L + 10, 0, 8, 0, H, wallC, shade(wallC, -0.5), 1, 0.4));
    P(solid(L, L + 10, W - 8, W, 0, H, wallC, shade(wallC, -0.5), 1, 0.4));
    P(solid(L, L + 10, -8, W, H, H + 12, wallC, shade(wallC, -0.5), 1, 0.4));
    P(solid(0, L + 10, W - 2, W + 4, kind === 'container' ? ground : -14, 0, kind === 'container' ? '#33576f' : '#5a6169', '#1d2023', 1, 0.4));
    P([
      { kind: 'line', a: project(-8, W, H + 10), b: project(L, W, H + 10), stroke: '#5b6672', sw: 0.6, dash: true, opacity: 0.7 },
      { kind: 'line', a: project(-8, W, H + 10), b: project(-8, -8, H + 10), stroke: '#5b6672', sw: 0.6, dash: true, opacity: 0.5 },
    ]);
    if (kind === 'container') {
      // pièces de coin
      for (const [a, b, z] of [[L, W - 8, ground], [L, W - 8, H], [-8, W - 8, ground], [-8, W - 8, H]] as V3[])
        P(solid(a, a + 10, b, b + 10, z, z + 12, '#2a3c4a', '#111', 1, 0.3));
    }
    // roues côté visible
    for (const a of axles) P(wheel(a, W + 2));
    // cote : longueur intérieure
    const yDim = W + 32;
    P([
      { kind: 'line', a: project(0, yDim, ground), b: project(L, yDim, ground), stroke: '#2b3442', sw: 0.6 },
      { kind: 'line', a: project(0, yDim - 6, ground), b: project(0, yDim + 6, ground), stroke: '#2b3442', sw: 0.6 },
      { kind: 'line', a: project(L, yDim - 6, ground), b: project(L, yDim + 6, ground), stroke: '#2b3442', sw: 0.6 },
    ]);
    const mid = project(L / 2, yDim + 26, ground);
    raw.push({
      kind: 'text',
      at: mid,
      text: `${(L / 100).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 })} m × ${(W / 100).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 })} m × ${(H / 100).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 })} m ${lang === 'fr' ? '(intérieur)' : '(inside)'}`,
      size: 8,
      color: '#2b3442',
      anchor: 'middle',
      bold: true,
    });
  });

  // mise à l'échelle finale
  const xs: number[] = [];
  const ys: number[] = [];
  for (const sh of raw) {
    if (sh.kind === 'poly') sh.pts.forEach(([x, y]) => (xs.push(x), ys.push(y)));
    else if (sh.kind === 'line') (xs.push(sh.a[0], sh.b[0]), ys.push(sh.a[1], sh.b[1]));
    else if (sh.kind === 'circle') (xs.push(sh.c[0] - sh.r, sh.c[0] + sh.r), ys.push(sh.c[1] - sh.r, sh.c[1] + sh.r));
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const pad = 14;
  const k = (width - 2 * pad) / (Math.max(...xs) - minX);
  const T = (pt: Pt): Pt => [pad + (pt[0] - minX) * k, pad + 10 + (pt[1] - minY) * k];
  const shapes: Shape[] = raw.map((sh) => {
    if (sh.kind === 'poly') return { ...sh, pts: sh.pts.map(T) };
    if (sh.kind === 'line') return { ...sh, a: T(sh.a), b: T(sh.b) };
    if (sh.kind === 'circle') return { ...sh, c: T(sh.c), r: Math.max(0.2, sh.r * k) };
    if (sh.kind === 'image') return { ...sh, p0: T(sh.p0), p1: T(sh.p1), p3: T(sh.p3) };
    return { ...sh, at: T(sh.at) };
  });
  // étiquettes numérotées sur le dessus de chaque colis
  const taken: { c: Pt; r: number }[] = [];
  const free = (c: Pt, r: number) => taken.every((t) => Math.hypot(t.c[0] - c[0], t.c[1] - c[1]) >= t.r + r + 1);
  for (const o of overlay) {
    const br = Math.max(4, Math.min(6.5, o.r * k * 0.28));
    let c = T(o.at);
    if (o.hidden) {
      // colis en grande partie caché derrière d'autres : contour pointillé de son dessus, pour le situer
      const tp = o.top.map(T);
      for (let i = 0; i < 4; i++) shapes.push({ kind: 'line', a: tp[i], b: tp[(i + 1) % 4], stroke: o.check ? '#c2410c' : '#2b3442', sw: 0.8, dash: true, opacity: 0.85 });
    }
    if (o.cands.length) {
      const cs = o.cands.map(T);
      c = cs.find((x) => free(x, br)) ?? cs[0];
    }
    // dernier recours : décaler la pastille pour qu'aucun numéro n'en recouvre un autre
    for (let step = 1; step < 12 && !free(c, br); step++) c = [c[0], c[1] - br * 0.9];
    taken.push({ c, r: br });
    shapes.push({ kind: 'circle', c, r: br, fill: o.check ? '#fff1e6' : '#ffffff', stroke: o.check ? '#c2410c' : '#2b3442', sw: o.check ? 1.1 : 0.8 });
    shapes.push({ kind: 'text', at: [c[0], c[1] + 0.3], text: o.text, size: br * 1.25, color: o.check ? '#c2410c' : '#2b3442', anchor: 'middle', bold: true });
  }
  const h = pad + 10 + (Math.max(...ys) - minY) * k + 8;
  if (view?.end) {
    // vue depuis l'autre extrémité : image retournée, textes et logos gardés lisibles
    const X = (pt: Pt): Pt => [width - pt[0], pt[1]];
    for (let i = 0; i < shapes.length; i++) {
      const sh = shapes[i];
      if (sh.kind === 'poly') shapes[i] = { ...sh, pts: sh.pts.map(X) };
      else if (sh.kind === 'line') shapes[i] = { ...sh, a: X(sh.a), b: X(sh.b) };
      else if (sh.kind === 'circle') shapes[i] = { ...sh, c: X(sh.c) };
      else if (sh.kind === 'text') shapes[i] = { ...sh, at: X(sh.at), anchor: sh.anchor === 'start' ? 'end' : sh.anchor === 'end' ? 'start' : sh.anchor, rotate: sh.rotate ? -sh.rotate : sh.rotate };
      else if (sh.kind === 'image') {
        const [p0, p1, p3] = [X(sh.p0), X(sh.p1), X(sh.p3)];
        // le bord gauche devient le droit : on repart du nouveau coin haut-gauche pour ne pas inverser le logo
        shapes[i] = { ...sh, p0: p1, p1: p0, p3: [p1[0] + (p3[0] - p0[0]), p1[1] + (p3[1] - p0[1])] };
      }
    }
  }
  return { shapes, w: width, h };
}

type V3 = [number, number, number];

/** enveloppe convexe (chaîne monotone) */
function convexHull(pts: Pt[]): Pt[] {
  const ps = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of ps) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of ps.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** point strictement à l'intérieur d'une enveloppe convexe (marge en unités du dessin) */
function insideHull(pt: Pt, hull: Pt[], margin = 0): boolean {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const cr = ((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0])) / len;
    if (cr < margin) return false;
  }
  return true;
}

/** ordre réel de chargement : du fond du véhicule vers les portes, puis d'un côté à l'autre */
export function loadingOrder(bin: Bin): Placement[] {
  return [...bin.placements].sort((a, b) => a.x - b.x || a.y - b.y);
}
