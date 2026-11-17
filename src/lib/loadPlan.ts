import type { PLPackage } from '../types';
import { familyOf, shade, type Picture, type Shape } from './drawing';
import { round } from './parseValues';

/**
 * Plan de chargement au sol (colis non gerbés), vue de dessus.
 * Placement « MaxRects » (meilleur ajustement, rotation autorisée), colis les plus lourds d'abord
 * placés vers l'avant, puis choix du moyen de transport le plus adapté.
 */

export interface Vehicle {
  id: string;
  name: string;
  nameEn: string;
  length: number; // cm intérieur
  width: number;
  doorHeight: number;
  payload: number; // kg
}

export const VEHICLES: Vehicle[] = [
  { id: '20', name: "Conteneur 20'", nameEn: "20' container", length: 589, width: 235, doorHeight: 228, payload: 28200 },
  { id: '40', name: "Conteneur 40'", nameEn: "40' container", length: 1203, width: 235, doorHeight: 228, payload: 26700 },
  { id: '40hc', name: "Conteneur 40' HC", nameEn: "40' HC container", length: 1203, width: 235, doorHeight: 258, payload: 26500 },
  { id: 'semi', name: 'Semi-remorque 13,6 m', nameEn: '13.6 m semi-trailer', length: 1360, width: 245, doorHeight: 270, payload: 24000 },
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
}

export interface Bin {
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
  bins: Bin[];
  /** mètres de plancher (camion) : longueur occupée sur toute la largeur */
  ldm: number;
  unplaced: number[];
  warnings: string[];
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
    const p: Placement = { no: it.no, x: best.x, y: best.y, l: best.l, w: best.w, h: it.height, kg: it.grossWeight, type: it.type, rotated: best.rot };
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

/** Choisit le transport le plus adapté et produit le plan */
export function planLoad(pkgs: PLPackage[], mode: 'auto' | string = 'auto'): LoadPlan | null {
  const items = pkgs.filter((p) => p.length > 0 && p.width > 0);
  if (!items.length) return null;
  const tallest = Math.max(...items.map((p) => p.height));
  const alternatives: LoadPlan['alternatives'] = [];
  let chosen: { v: Vehicle; bins: Bin[]; unplaced: number[] } | null = null;
  for (const v of VEHICLES) {
    if (tallest > v.doorHeight) {
      alternatives.push({ vehicle: v, count: 0, feasible: false, reason: `colis de ${tallest} cm > porte ${v.doorHeight} cm` });
      continue;
    }
    const r = pack(v, items);
    const feasible = r.unplaced.length === 0;
    alternatives.push({ vehicle: v, count: r.bins.length, feasible, reason: feasible ? undefined : `${r.unplaced.length} colis trop grand(s)` });
    if (mode !== 'auto' ? v.id === mode : feasible && (!chosen || r.bins.length < chosen.bins.length)) chosen = { v, bins: r.bins, unplaced: r.unplaced };
  }
  if (!chosen) {
    const v = VEHICLES.find((x) => x.id === mode) ?? VEHICLES[VEHICLES.length - 1];
    const r = pack(v, items);
    chosen = { v, ...r };
  }
  const warnings: string[] = [];
  chosen.bins.forEach((b, i) => {
    const tag = chosen!.bins.length > 1 ? ` (n° ${i + 1})` : '';
    if (Math.abs(b.cogX - 50) > 15 && b.usedLength > chosen!.v.length * 0.5)
      warnings.push(`Centre de gravité à ${b.cogX} % de la longueur${tag} : répartir les colis lourds pour équilibrer`);
    if (Math.abs(b.cogY - 50) > 10) warnings.push(`Charge décentrée en largeur (${b.cogY} %)${tag} : caler les colis`);
  });
  return {
    vehicle: chosen.v,
    bins: chosen.bins,
    ldm: round(chosen.bins.reduce((s, b) => s + b.usedLength, 0) / 100, 2),
    unplaced: chosen.unplaced,
    warnings,
    alternatives,
  };
}

/* ------------------------------------------------------------------ */
/* Dessin du plan (vue de dessus)                                      */
/* ------------------------------------------------------------------ */

export function loadPlanDrawing(v: Vehicle, bin: Bin, accent: string, lang: 'fr' | 'en', width = 640): Picture {
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
    const fam = familyOf(p.type);
    const baseC = fam === 'crate' ? '#c99a62' : fam === 'carton' ? '#d2b48c' : accent;
    const fill = shade(baseC, 0.75 - 0.5 * (p.kg / maxKg));
    shapes.push({ kind: 'poly', pts: [[X(p.x), Y(p.y)], [X(p.x + p.l), Y(p.y)], [X(p.x + p.l), Y(p.y + p.w)], [X(p.x), Y(p.y + p.w)]], fill, stroke: shade(baseC, -0.35), sw: 0.8 });
    const cx = X(p.x + p.l / 2);
    const cy = Y(p.y + p.w / 2);
    const big = p.l * k > 34 && p.w * k > 22;
    shapes.push({ kind: 'text', at: [cx, cy + (big ? -1 : 2.5)], text: String(p.no), size: big ? 9 : 7, color: INK, anchor: 'middle', bold: true });
    if (big) shapes.push({ kind: 'text', at: [cx, cy + 8], text: `${Math.round(p.kg)} kg`, size: 6, color: INK, anchor: 'middle' });
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
