/**
 * Moteur de dessin vectoriel commun à l'écran (SVG) et au PDF (jsPDF).
 * Les schémas sont décrits par des formes simples dans un repère abstrait,
 * puis rendus par Drawing.tsx (SVG) ou drawShapesPdf (PDF) : mêmes schémas partout.
 */

import type { LoadHint } from '../types';

export type Pt = [number, number];
export type Shape =
  | { kind: 'poly'; pts: Pt[]; fill: string; stroke?: string; sw?: number; opacity?: number }
  | { kind: 'line'; a: Pt; b: Pt; stroke: string; sw: number; dash?: boolean; opacity?: number }
  | { kind: 'circle'; c: Pt; r: number; fill: string; stroke?: string; sw?: number }
  | {
      kind: 'text';
      at: Pt;
      text: string;
      size: number;
      color: string;
      anchor?: 'start' | 'middle' | 'end';
      bold?: boolean;
      /** rotation en degrés, sens horaire à l'écran */
      rotate?: number;
      /** fond blanc derrière le texte (lisibilité sur les traits) */
      halo?: boolean;
    };

export interface Picture {
  shapes: Shape[];
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* Couleurs                                                            */
/* ------------------------------------------------------------------ */

function hex(c: string): [number, number, number] {
  const h = c.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** k > 0 éclaircit, k < 0 assombrit */
export const shade = (c: string, k: number) => toHex(hex(c).map((v) => (k >= 0 ? v + (255 - v) * k : v * (1 + k))));

type Family = 'pallet' | 'crate' | 'carton' | 'other';
export function familyOf(type: string): Family {
  const t = type.toLowerCase();
  if (/carton group|^carton|^box|^\d{2,4}\s*x|pre-?pack|emballage d/.test(t)) return 'carton';
  if (/crate|caisse|plywood|wood|contreplaq/.test(t)) return 'crate';
  if (/pal|euro|half|plate/.test(t)) return 'pallet';
  return 'other';
}

export const KRAFT = '#d2b48c';
const INK = '#2b3442';

/* ------------------------------------------------------------------ */
/* Schéma isométrique d'un colis                                       */
/* ------------------------------------------------------------------ */

const C30 = Math.cos(Math.PI / 6);
const isoProj = (a: number, b: number, z: number): Pt => [(a - b) * C30, (a + b) * 0.5 - z];
/** Projection courante : isométrique pour les schémas de colis, oblique pour les véhicules */
let PROJ: (a: number, b: number, z: number) => Pt = isoProj;
const iso = (a: number, b: number, z: number): Pt => PROJ(a, b, z);
/** Exécute fn avec une autre projection (linéaire) puis revient à l'isométrique */
export function withProjection<T>(proj: (a: number, b: number, z: number) => Pt, fn: () => T): T {
  const prev = PROJ;
  PROJ = proj;
  try {
    return fn();
  } finally {
    PROJ = prev;
  }
}
export { iso as project };



/* ---------- primitives de rendu réaliste (repère modèle, en cm) ---------- */
export type V3 = [number, number, number];
const I3 = (p: V3) => iso(p[0], p[1], p[2]);
const add3 = (p: V3, q: V3, f = 1): V3 => [p[0] + q[0] * f, p[1] + q[1] * f, p[2] + q[2] * f];
export type Push = (s: Shape[]) => void;

/** Quadrilatère plan o, o+u, o+u+v, o+v */
export function quad(o: V3, u: V3, v: V3, fill: string, stroke?: string, sw?: number, opacity?: number): Shape {
  return { kind: 'poly', pts: [I3(o), I3(add3(o, u)), I3(add3(add3(o, u), v)), I3(add3(o, v))], fill, stroke, sw, opacity };
}
/** Face avec dégradé (bandes successives le long de u) */
export function gradQuad(o: V3, u: V3, v: V3, base: string, k0: number, k1: number, n: number): Shape[] {
  const out: Shape[] = [];
  for (let i = 0; i < n; i++) {
    const c = shade(base, n === 1 ? k0 : k0 + ((k1 - k0) * i) / (n - 1));
    out.push(quad(add3(o, u, i / n), [u[0] / n, u[1] / n, u[2] / n], v, c, c, 0.25));
  }
  return out;
}
/** Arêtes visibles d'un pavé */
export function edges(a0: number, a1: number, b0: number, b1: number, z0: number, z1: number, stroke: string, sw: number): Shape[] {
  const L = (p: V3, q: V3): Shape => ({ kind: 'line', a: I3(p), b: I3(q), stroke, sw });
  return [
    L([a0, b1, z0], [a1, b1, z0]), L([a1, b1, z0], [a1, b0, z0]),
    L([a0, b1, z0], [a0, b1, z1]), L([a1, b1, z0], [a1, b1, z1]), L([a1, b0, z0], [a1, b0, z1]),
    L([a0, b0, z1], [a1, b0, z1]), L([a1, b0, z1], [a1, b1, z1]), L([a1, b1, z1], [a0, b1, z1]), L([a0, b1, z1], [a0, b0, z1]),
  ];
}
/** Pavé plein éclairé en haut à gauche, avec dégradés */
export function solid(a0: number, a1: number, b0: number, b1: number, z0: number, z1: number, base: string, stroke: string, n = 1, sw = 0.45): Shape[] {
  return [
    ...gradQuad([a0, b1, z0], [a1 - a0, 0, 0], [0, 0, z1 - z0], base, -0.02, -0.16, n),
    ...gradQuad([a1, b0, z0], [0, b1 - b0, 0], [0, 0, z1 - z0], base, -0.24, -0.36, Math.max(1, Math.ceil(n / 2))),
    quad([a0, b0, z1], [a1 - a0, 0, 0], [0, b1 - b0, 0], shade(base, 0.2)),
    ...edges(a0, a1, b0, b1, z0, z1, stroke, sw),
  ];
}
/** variation de teinte déterministe (planches) */
const tone = (i: number) => [0.03, -0.05, 0.06, -0.02, 0.0, -0.07, 0.04][i % 7];

export const WOOD_PALLET = '#d4ad7a';

export function drawPallet(push: Push, L: number, l: number, H: number, px: number, hint?: LoadHint) {
  const pb = Math.min(14.4, H * 0.35); // socle
  const t = pb * 0.16; // épaisseur des planches
  const dark = shade(WOOD_PALLET, -0.55);
  const bw = Math.min(l * 0.14, 14.5);
  const blkA = Math.min(L * 0.12, 14.5);
  const blkB = Math.min(l * 0.16, 14.5);
  const rows = [0, (l - bw) / 2, l - bw];
  const brows = [0, (l - blkB) / 2, l - blkB];
  const cols = [0, (L - blkA) / 2, L - blkA];
  const byDepth = (xs: { a: number; b: number; s: Shape[] }[]) => xs.sort((p, q) => p.a + p.b - (q.a + q.b)).forEach((x) => push(x.s));
  // semelles
  byDepth(rows.map((b, i) => ({ a: 0, b, s: solid(0, L, b, b + bw, 0, t, shade(WOOD_PALLET, tone(i)), dark, 1, 0.35) })));
  // dés
  byDepth(cols.flatMap((a, i) => brows.map((b, j) => ({ a, b, s: solid(a, a + blkA, b, b + blkB, t, pb - 2 * t, shade(WOOD_PALLET, -0.06 + tone(i + j) * 0.8), dark, 1, 0.35) }))));
  // traverses
  byDepth(cols.map((a, i) => ({ a, b: 0, s: solid(a, a + blkA, 0, l, pb - 2 * t, pb - t, shade(WOOD_PALLET, tone(i + 3)), dark, 1, 0.35) })));
  // planches de dessus
  const nd = Math.max(3, Math.min(9, Math.round(L / 16)));
  const dw = (L / nd) * 0.8;
  const deck: { a: number; b: number; s: Shape[] }[] = [];
  for (let i = 0; i < nd; i++) {
    const a = (i * (L - dw)) / (nd - 1);
    deck.push({ a, b: 0, s: solid(a, a + dw, 0, l, pb - t, pb, shade(WOOD_PALLET, 0.04 + tone(i)), dark, 1, 0.35) });
  }
  byDepth(deck);
  // clous visibles sur la face avant des dés
  for (const a of cols) push([{ kind: 'circle', c: iso(a + blkA / 2, l, pb / 2), r: 0.55, fill: '#5b4630' }]);

  const hl = H - pb;
  if (hl > 0.5) drawLoad(push, L, l, pb, H, px, hint);
}

/**
 * Disposition des unités sur la palette (en cellules nx × ny × nz) :
 * - articles longs (SP, moteurs…) : couchés dans la plus grande longueur de la palette, en rangées et couches ;
 * - autres : cartons dont la taille découle du nombre réel d'unités ;
 * - sans indication : cartons d'environ 40 cm.
 */
export function loadGrid(L: number, l: number, hl: number, hint?: LoadHint): { nx: number; ny: number; nz: number; count: number } {
  const q = hint?.units ?? 0;
  if (q >= 1 && q <= 80) {
    let best = { nx: 1, ny: 1, nz: 1, count: q, cost: Infinity };
    for (let nx = 1; nx <= 12; nx++)
      for (let ny = 1; ny <= 12; ny++)
        for (let nz = 1; nz <= 12; nz++) {
          const n = nx * ny * nz;
          if (n < q || n > q * 1.5 + 1) continue;
          const cx = L / nx;
          const cy = l / ny;
          const cz = hl / nz;
          let cost: number;
          if (hint!.long) {
            // un article long occupe toute la longueur ; section à peu près carrée (carton tubulaire)
            const along = L >= l ? nx : ny;
            if (along !== 1) continue;
            const cross = L >= l ? cy : cx;
            // le moins de places vides possible ; cartons plutôt plus larges que hauts (couchés)
            cost = (n - q) / q + 0.5 * Math.max(0, Math.log(cz / cross)) + 0.15 * Math.max(0, Math.log(cross / cz));
          } else {
            const d = [cx, cy, cz].sort((a, b) => b - a);
            cost = Math.log(d[0] / d[2]) + 1.2 * ((n - q) / q) + (cz < 8 ? 2 : 0);
          }
          if (cost < best.cost) best = { nx, ny, nz, count: q, cost };
        }
    if (best.cost < Infinity) return best;
  }
  const nx = Math.max(1, Math.min(4, Math.round(L / 42)));
  const ny = Math.max(1, Math.min(3, Math.round(l / 42)));
  const nz = Math.max(1, Math.min(5, Math.round(hl / 32)));
  return { nx, ny, nz, count: nx * ny * nz };
}

/** Charge de palette : unités (cartons) empilées sous film étirable */
function drawLoad(push: Push, L: number, l: number, z0: number, H: number, px: number, hint?: LoadHint) {
  const hl = H - z0;
  const { nx, ny, nz, count } = loadGrid(L, l, hl, hint);
  const cx = L / nx;
  const cy = l / ny;
  const cz = hl / nz;
  const g = Math.min(0.6, Math.min(cx, cy) * 0.03);
  const long = !!hint?.long;
  // ordre de remplissage : couche par couche, en partant du fond ; la dernière couche peut être incomplète
  const cells: [number, number, number][] = [];
  for (let kz = 0; kz < nz; kz++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cells.push([i, j, kz]);
  const used = cells.slice(0, count);
  // peintre : couche après couche, puis du fond vers l'avant
  used.sort((p, q) => p[2] - q[2] || p[0] + p[1] - (q[0] + q[1]));
  const topOf = new Map<string, number>();
  for (const [i, j, kz] of used) topOf.set(`${i},${j}`, Math.max(topOf.get(`${i},${j}`) ?? -1, kz));
  for (const [i, j, kz] of used) {
    let a0 = i * cx + g;
    let a1 = (i + 1) * cx - g;
    let b0 = j * cy + g;
    let b1 = (j + 1) * cy - g;
    if (long) {
      // section réaliste d'un carton de pompe : pas plus large que 1,4 × sa hauteur, centré dans sa place
      const maxW = cz * 1.4;
      if (L >= l && b1 - b0 > maxW) {
        const m = (b0 + b1) / 2;
        [b0, b1] = [m - maxW / 2, m + maxW / 2];
      } else if (L < l && a1 - a0 > maxW) {
        const m = (a0 + a1) / 2;
        [a0, a1] = [m - maxW / 2, m + maxW / 2];
      }
    }
    const zz = z0 + kz * cz;
    const z1 = zz + cz - g * 0.5;
    const base = shade(KRAFT, tone(i * 3 + j + kz * 2) * 0.7);
    push(solid(a0, a1, b0, b1, zz, z1, base, shade(KRAFT, -0.45), long ? 2 : 4, 0.3));
    const isTop = topOf.get(`${i},${j}`) === kz;
    if (long) {
      // carton long : bandes de ruban aux deux extrémités et au milieu
      const alongA = L >= l;
      for (const f of [0.08, 0.5, 0.92]) {
        const w = Math.min((alongA ? a1 - a0 : b1 - b0) * 0.025, 3);
        if (alongA) {
          const x = a0 + (a1 - a0) * f - w;
          push([quad([x, b1, zz], [2 * w, 0, 0], [0, 0, z1 - zz], '#c79e63', undefined, undefined, 0.85)]);
          if (isTop) push([quad([x, b0, z1], [2 * w, 0, 0], [0, b1 - b0, 0], '#c79e63', undefined, undefined, 0.85)]);
        } else {
          const y = b0 + (b1 - b0) * f - w;
          push([quad([a1, y, zz], [0, 2 * w, 0], [0, 0, z1 - zz], '#c79e63', undefined, undefined, 0.85)]);
          if (isTop) push([quad([a0, y, z1], [a1 - a0, 0, 0], [0, 2 * w, 0], '#c79e63', undefined, undefined, 0.85)]);
        }
      }
      // étiquette produit en bout de carton
      if (alongA && b1 - b0 > 8 && z1 - zz > 7) push([quad([a1, b0 + (b1 - b0) * 0.3, zz + (z1 - zz) * 0.35], [0, (b1 - b0) * 0.4, 0], [0, 0, (z1 - zz) * 0.3], '#efe9dc', undefined, undefined, 0.8)]);
    } else if (isTop) {
      const tw = Math.min((b1 - b0) * 0.08, 2.5);
      const bm = (b0 + b1) / 2;
      push([quad([a0, bm - tw, z1], [a1 - a0, 0, 0], [0, 2 * tw, 0], '#c79e63', undefined, undefined, 0.8)]);
    }
  }
  // film étirable : voile clair + reflets
  const film = (o: V3, u: V3, v: V3) => [quad(o, u, v, '#ffffff', undefined, undefined, 0.16)];
  push([...film([0, l, z0], [L, 0, 0], [0, 0, hl]), ...film([L, 0, z0], [0, l, 0], [0, 0, hl])]);
  const streak = (o: V3, u: V3, v: V3, f0: number, w: number) => quad(add3(add3(o, u, f0), v, 0), [u[0] * w, u[1] * w, u[2] * w], v, '#ffffff', undefined, undefined, 0.28);
  push([
    streak([0, l, z0], [L, 0, 0], [0, 0, hl], 0.18, 0.05),
    streak([0, l, z0], [L, 0, 0], [0, 0, hl], 0.27, 0.02),
    streak([0, l, z0], [L, 0, 0], [0, 0, hl], 0.7, 0.04),
    streak([L, 0, z0], [0, l, 0], [0, 0, hl], 0.35, 0.05),
  ]);
  // spires de film
  for (const f of [0.12, 0.3, 0.55, 0.8]) {
    const z = z0 + hl * f;
    push([
      { kind: 'line', a: iso(0, l, z), b: iso(L, l, z + hl * 0.05), stroke: '#ffffff', sw: 0.5, opacity: 0.5 },
      { kind: 'line', a: iso(L, 0, z + hl * 0.05), b: iso(L, l, z + hl * 0.05), stroke: '#ffffff', sw: 0.5, opacity: 0.5 },
    ]);
  }
  void px;
}

export const CRATE = '#d9b483';

export function drawCrate(push: Push, L: number, l: number, H: number, px: number) {
  const dark = shade(CRATE, -0.55);
  const sk = H >= 25 ? Math.min(9, H * 0.15) : 0; // patins (passage de fourches)
  if (sk > 0) {
    const sw = Math.min(9, l * 0.18);
    const rows = l > 60 ? [0, (l - sw) / 2, l - sw] : [0, l - sw];
    for (const b of rows) push(solid(0, L, b, b + sw, 0, sk, shade(CRATE, -0.22), dark, 1, 0.35));
  }
  const z0 = sk;
  const h = H - z0;
  // panneaux en planches
  const np = Math.max(2, Math.min(12, Math.round(h / 14)));
  for (let i = 0; i < np; i++) {
    const za = z0 + (h * i) / np;
    const dz = h / np;
    push(gradQuad([0, l, za], [L, 0, 0], [0, 0, dz], shade(CRATE, tone(i)), -0.02, -0.14, 4));
    push(gradQuad([L, 0, za], [0, l, 0], [0, 0, dz], shade(CRATE, tone(i + 2)), -0.24, -0.34, 2));
    // veinage du bois
    push([
      { kind: 'line', a: iso(L * 0.05, l, za + dz * 0.45), b: iso(L * 0.42, l, za + dz * 0.52), stroke: '#8a6236', sw: 0.3, opacity: 0.25 },
      { kind: 'line', a: iso(L * 0.5, l, za + dz * 0.3), b: iso(L * 0.93, l, za + dz * 0.38), stroke: '#8a6236', sw: 0.3, opacity: 0.2 },
    ]);
    if (i > 0) {
      push([
        { kind: 'line', a: iso(0, l, za), b: iso(L, l, za), stroke: shade(CRATE, -0.4), sw: 0.35, opacity: 0.7 },
        { kind: 'line', a: iso(L, 0, za), b: iso(L, l, za), stroke: shade(CRATE, -0.5), sw: 0.35, opacity: 0.7 },
      ]);
    }
  }
  // dessus : planches dans la longueur
  const nt = Math.max(2, Math.min(8, Math.round(l / 14)));
  for (let i = 0; i < nt; i++) push([quad([0, (l * i) / nt, H], [L, 0, 0], [0, l / nt, 0], shade(CRATE, 0.2 + tone(i) * 0.8), shade(CRATE, -0.3), 0.3)]);
  push(edges(0, L, 0, l, z0, H, dark, 0.5));

  // cadre extérieur : lisses, montants, raidisseurs et écharpes (face longue)
  const fr = Math.max(Math.min(9, h * 0.16, L * 0.08), 3);
  const frame = shade(CRATE, 0.08);
  const frameR = shade(CRATE, -0.18);
  const fb = (a0: number, a1: number, za: number, zb: number) => quad([a0, l, za], [a1 - a0, 0, 0], [0, 0, zb - za], frame, shade(CRATE, -0.5), 0.35);
  const fa = (b0: number, b1: number, za: number, zb: number) => quad([L, b0, za], [0, b1 - b0, 0], [0, 0, zb - za], frameR, shade(CRATE, -0.55), 0.35);
  const nc = Math.max(0, Math.min(4, Math.round(L / 90) - 1));
  const posts = [0, ...Array.from({ length: nc }, (_, i) => ((i + 1) * L) / (nc + 1) - fr / 2), L - fr];
  // écharpes entre montants (si la caisse est assez haute)
  if (h > 30) {
    for (let i = 0; i < posts.length - 1; i++) {
      const xa = posts[i] + fr;
      const xb = posts[i + 1];
      const zA = z0 + fr;
      const zB = H - fr;
      const w = fr * 1.25;
      push([{ kind: 'poly', pts: [iso(xa, l, zA), iso(xa + w, l, zA), iso(xb, l, zB), iso(xb - w, l, zB)], fill: frame, stroke: shade(CRATE, -0.5), sw: 0.35 }]);
    }
  }
  push([fb(0, L, z0, z0 + fr), fb(0, L, H - fr, H)]);
  for (const x of posts) push([fb(x, x + fr, z0, H)]);
  push([fa(0, l, z0, z0 + fr), fa(0, l, H - fr, H), fa(0, Math.min(fr, l / 3), z0, H), fa(l - Math.min(fr, l / 3), l, z0, H)]);
  // ombre sous les lisses
  push([{ kind: 'line', a: iso(0, l, H - fr - 0.4), b: iso(L, l, H - fr - 0.4), stroke: '#000', sw: 0.6, opacity: 0.12 }]);
  // clous aux assemblages
  const nail = (p: Pt): Shape => ({ kind: 'circle', c: p, r: 0.6, fill: '#4a3a28' });
  for (const x of posts) {
    push([nail(iso(x + fr / 2, l, z0 + fr / 2)), nail(iso(x + fr / 2, l, H - fr / 2))]);
  }
  // marquage « haut » (deux flèches) sur le petit côté
  if (l > 15 && h > 20) {
    const cxm = l / 2;
    const s0 = Math.min(l, h) * 0.18;
    for (const d of [-0.35, 0.35]) {
      const bx = cxm + d * s0 * 1.6;
      const zb = z0 + h * 0.35;
      const ink = '#3c2a1a';
      push([
        { kind: 'poly', pts: [iso(L, bx - s0 * 0.12, zb), iso(L, bx + s0 * 0.12, zb), iso(L, bx + s0 * 0.12, zb + s0 * 0.7), iso(L, bx - s0 * 0.12, zb + s0 * 0.7)], fill: ink, opacity: 0.75 },
        { kind: 'poly', pts: [iso(L, bx - s0 * 0.35, zb + s0 * 0.7), iso(L, bx + s0 * 0.35, zb + s0 * 0.7), iso(L, bx, zb + s0 * 1.15)], fill: ink, opacity: 0.75 },
      ]);
    }
  }
  void px;
}

export function drawCarton(push: Push, L: number, l: number, H: number, px: number, z0: number) {
  const dark = shade(KRAFT, -0.5);
  push(solid(0, L, 0, l, z0, H, KRAFT, dark, 14, 0.5));
  // cannelure visible (épaisseur du carton) sur les arêtes hautes
  push([
    { kind: 'line', a: iso(0, l, H - 0.35), b: iso(L, l, H - 0.35), stroke: shade(KRAFT, 0.35), sw: 0.6, opacity: 0.8 },
    { kind: 'line', a: iso(L, 0, H - 0.35), b: iso(L, l, H - 0.35), stroke: shade(KRAFT, 0.25), sw: 0.6, opacity: 0.8 },
  ]);
  // rabats : jointure au centre du dessus
  push([{ kind: 'line', a: iso(0, l / 2, H), b: iso(L, l / 2, H), stroke: shade(KRAFT, -0.4), sw: 0.45 }]);
  // ruban adhésif sur la jointure, qui descend sur le petit côté
  const t = Math.min(l * 0.09, 2.6);
  const tape = '#c39a5f';
  push([
    quad([0, l / 2 - t, H], [L, 0, 0], [0, 2 * t, 0], tape, undefined, undefined, 0.85),
    quad([L, l / 2 - t, H - (H - z0) * 0.24], [0, 2 * t, 0], [0, 0, (H - z0) * 0.24], shade(tape, -0.2), undefined, undefined, 0.85),
    { kind: 'line', a: iso(0, l / 2 - t * 0.4, H), b: iso(L, l / 2 - t * 0.4, H), stroke: '#ffffff', sw: 0.4, opacity: 0.45 },
  ]);
  // étiquette d'expédition avec code-barres
  const h = H - z0;
  const lw = Math.min(L * 0.32, 22);
  const lh = Math.min(h * 0.32, 15);
  if (lw > 4 && lh > 3) {
    const la = L * 0.92 - lw;
    const lz = z0 + h * 0.18;
    push([quad([la, l, lz], [lw, 0, 0], [0, 0, lh], '#fbfbf8', '#9a8f7d', 0.3)]);
    const bars = 14;
    for (let i = 0; i < bars; i++) {
      if (i % 3 === 1) continue;
      const x = la + lw * 0.1 + ((lw * 0.8) * i) / bars;
      push([{ kind: 'line', a: iso(x, l, lz + lh * 0.12), b: iso(x, l, lz + lh * 0.45), stroke: '#222', sw: i % 2 ? 0.25 : 0.45 }]);
    }
    for (const f of [0.62, 0.78]) push([{ kind: 'line', a: iso(la + lw * 0.1, l, lz + lh * f), b: iso(la + lw * (f > 0.7 ? 0.6 : 0.85), l, lz + lh * f), stroke: '#888', sw: 0.4 }]);
  }
  // pictogramme « haut » imprimé
  const s0 = Math.min(L, h) * 0.12;
  if (s0 > 1.5) {
    const ink = '#5a3e22';
    for (const dx of [0, s0 * 0.9]) {
      const bx = L * 0.1 + dx;
      const zb = z0 + h * 0.58;
      push([
        { kind: 'poly', pts: [iso(bx - s0 * 0.1, l, zb), iso(bx + s0 * 0.1, l, zb), iso(bx + s0 * 0.1, l, zb + s0 * 0.6), iso(bx - s0 * 0.1, l, zb + s0 * 0.6)], fill: ink, opacity: 0.8 },
        { kind: 'poly', pts: [iso(bx - s0 * 0.3, l, zb + s0 * 0.6), iso(bx + s0 * 0.3, l, zb + s0 * 0.6), iso(bx, l, zb + s0)], fill: ink, opacity: 0.8 },
      ]);
    }
  }
  void px;
}

export interface PackageLike {
  load?: LoadHint;
  no: number;
  type: string;
  length: number;
  width: number;
  height: number;
  grossWeight: number;
}

export interface DrawLabels {
  cm: string;
  kg: string;
  packageWord: string; // "Colis" / "Package"
  locale: string;
}

/**
 * Colis en perspective isométrique, à l'échelle de ses propres dimensions,
 * avec cotes L / l / H et poids brut.
 */
/** Échelle qui ferait remplir la vignette par ce colis (sert de référence entre colis d'une même PL) */
export function fitScale(p: { length: number; width: number; height: number }): number {
  const L = Math.max(1, p.length || 40);
  const l = Math.max(1, p.width || 30);
  const H = Math.max(1, p.height || 30);
  const corners = [0, L].flatMap((a) => [0, l].flatMap((b) => [0, H].map((z) => isoProj(a, b, z))));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return Math.min(150 / (Math.max(...xs) - Math.min(...xs)), 118 / (Math.max(...ys) - Math.min(...ys)));
}
/** Échelle de référence d'un ensemble de colis : celle du plus encombrant */
export const refScale = (pkgs: { length: number; width: number; height: number }[]) => Math.min(...pkgs.filter((p) => p.length > 0).map(fitScale), Infinity);

/**
 * refK : échelle du plus gros colis de la PL. Les colis plus petits sont dessinés plus petits
 * (taille relative adoucie, au moins 45 % de la vignette) pour que la différence de taille se voie.
 */
export function packageDrawing(p: PackageLike, _accent: string, labels: DrawLabels, title?: string, refK?: number): Picture {
  const W = 220;
  const Hh = 190;
  const L = Math.max(1, p.length || 40);
  const l = Math.max(1, p.width || 30);
  const H = Math.max(1, p.height || 30);
  const fam = familyOf(p.type);
  const shapes: Shape[] = [];

  // mise à l'échelle : la boîte + ses cotes doivent tenir dans ~170 × 130
  const corners = [0, L].flatMap((a) => [0, l].flatMap((b) => [0, H].map((z) => iso(a, b, z))));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  const kFit = Math.min(150 / bw, 118 / bh);
  const k = refK && Number.isFinite(refK) && refK < kFit ? kFit * Math.max(0.45, Math.sqrt(refK / kFit)) : kFit;
  const ox = (W - bw * k) / 2 - Math.min(...xs) * k;
  const oy = 16 + (126 - bh * k) / 2 - Math.min(...ys) * k;
  const T = (pt: Pt): Pt => [ox + pt[0] * k, oy + pt[1] * k];
  const push = (s: Shape[]) => {
    for (const sh of s) {
      if (sh.kind === 'poly') shapes.push({ ...sh, pts: sh.pts.map(T) });
      else if (sh.kind === 'line') shapes.push({ ...sh, a: T(sh.a), b: T(sh.b) });
      else if (sh.kind === 'circle') shapes.push({ ...sh, c: T(sh.c) });
      else shapes.push(sh);
    }
  };

  // ombre portée douce (plusieurs couches)
  for (const [off, op] of [[7, 0.035], [4.5, 0.05], [2.5, 0.07]] as const)
    push([{ kind: 'poly', pts: [iso(0, 0, 0), iso(L, 0, 0), iso(L, l, 0), iso(0, l, 0)].map(([x, y]) => [x + off / k, y + (off * 0.7) / k] as Pt), fill: '#1b2430', opacity: op }]);

  const px = 1 / k; // 1 unité de dessin exprimée en cm du modèle
  if (fam === 'pallet') drawPallet(push, L, l, H, px, p.load);
  else if (fam === 'crate') drawCrate(push, L, l, H, px);
  else if (fam === 'carton') drawCarton(push, L, l, H, px, 0);
  else push(solid(0, L, 0, l, 0, H, '#c9d1db', shade('#c9d1db', -0.5), 8));

  // ---- cotes ----
  const d = Math.max(Math.max(L, l, H) * 0.09, 9 / k); // écart des cotes : au moins 9 unités à l'écran
  const dimColor = shade(INK, 0.15);
  const fmt = (v: number) => `${Math.round(v).toLocaleString(labels.locale)} ${labels.cm}`;
  // longueur L : le long de l'arête avant gauche (b = l), décalée vers l'extérieur
  const la = T(iso(0, l + d, 0));
  const lb = T(iso(L, l + d, 0));
  shapes.push({ kind: 'line', a: la, b: lb, stroke: dimColor, sw: 0.6 });
  shapes.push({ kind: 'line', a: T(iso(0, l, 0)), b: T(iso(0, l + d * 1.3, 0)), stroke: dimColor, sw: 0.35 });
  shapes.push({ kind: 'line', a: T(iso(L, l, 0)), b: T(iso(L, l + d * 1.3, 0)), stroke: dimColor, sw: 0.35 });
  shapes.push({ kind: 'text', at: [(la[0] + lb[0]) / 2 - 3, (la[1] + lb[1]) / 2 + 9], text: fmt(L), size: 8.5, color: INK, anchor: 'middle', rotate: 30, bold: true, halo: true });
  // largeur l : le long de l'arête avant droite (a = L)
  const wa = T(iso(L + d, 0, 0));
  const wb = T(iso(L + d, l, 0));
  shapes.push({ kind: 'line', a: wa, b: wb, stroke: dimColor, sw: 0.6 });
  shapes.push({ kind: 'line', a: T(iso(L, 0, 0)), b: T(iso(L + d * 1.3, 0, 0)), stroke: dimColor, sw: 0.35 });
  shapes.push({ kind: 'line', a: T(iso(L, l, 0)), b: T(iso(L + d * 1.3, l, 0)), stroke: dimColor, sw: 0.35 });
  shapes.push({ kind: 'text', at: [(wa[0] + wb[0]) / 2 + 3, (wa[1] + wb[1]) / 2 + 9], text: fmt(l), size: 8.5, color: INK, anchor: 'middle', rotate: -30, bold: true, halo: true });
  // hauteur H : arête verticale la plus à droite (a = L, b = 0)
  const ha = T(iso(L + d, -d * 0.2, 0));
  const hb = T(iso(L + d, -d * 0.2, H));
  shapes.push({ kind: 'line', a: ha, b: hb, stroke: dimColor, sw: 0.6 });
  shapes.push({ kind: 'line', a: T(iso(L, 0, H)), b: T(iso(L + d * 1.3, -d * 0.2, H)), stroke: dimColor, sw: 0.35 });
  shapes.push({ kind: 'text', at: [ha[0] + 6.5, (ha[1] + hb[1]) / 2], text: fmt(H), size: 8.5, color: INK, anchor: 'middle', rotate: -90, bold: true, halo: true });

  // poids
  shapes.push({
    kind: 'text',
    at: [W / 2, Hh - 8],
    text: `${title ?? `${labels.packageWord} ${p.no}`} · ${p.grossWeight.toLocaleString(labels.locale, { maximumFractionDigits: 1 })} ${labels.kg}`,
    size: 9.5,
    color: INK,
    anchor: 'middle',
    bold: true,
  });
  return { shapes, w: W, h: Hh };
}

/* ------------------------------------------------------------------ */
/* Vue de face de tous les colis à la même échelle                     */
/* ------------------------------------------------------------------ */

export function scaleStrip(pkgs: PackageLike[], _accent: string, labels: DrawLabels, width = 640): Picture {
  const shapes: Shape[] = [];
  // un exemplaire par forme de colis (famille + dimensions), avec le nombre de colis identiques
  const groups = new Map<string, { p: PackageLike; n: number }>();
  for (const p of pkgs) {
    if (!(p.length > 0 && p.height > 0)) continue;
    const k = `${familyOf(p.type)}|${Math.max(p.length, p.width)}|${p.height}`;
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { p, n: 1 });
  }
  // les plus grands d'abord, 16 formes au plus pour rester lisible
  const valid = [...groups.values()].sort((a, b) => Math.max(b.p.length, b.p.width) * b.p.height - Math.max(a.p.length, a.p.width) * a.p.height).slice(0, 16);
  if (!valid.length) return { shapes, w: width, h: 10 };
  const gap = 10;
  const maxH = Math.max(...valid.map((g) => g.p.height), 180); // repère humain 180 cm
  const totalL = valid.reduce((s, g) => s + Math.max(g.p.length, g.p.width), 0) + 60; // + silhouette
  const k = Math.max(0.02, Math.min((width - gap * (valid.length + 3)) / totalL, 120 / maxH));
  const base = 140;
  let x = gap;
  // silhouette humaine 1,80 m (repère d'échelle)
  const hp = 180 * k;
  const head = hp * 0.07;
  shapes.push({ kind: 'circle', c: [x + 14 * k + 6, base - hp + head], r: Math.max(0.5, head), fill: '#b8c2cf' });
  shapes.push({ kind: 'poly', pts: [[x + 6, base], [x + 6 + 28 * k, base], [x + 6 + 26 * k, base - hp + head * 2.2], [x + 6 + 2 * k, base - hp + head * 2.2]], fill: '#b8c2cf' });
  shapes.push({ kind: 'text', at: [x + 6 + 14 * k, base + 11], text: `${(1.8).toLocaleString(labels.locale)} m`, size: 7, color: '#7a8596', anchor: 'middle' });
  x += 30 * k + gap * 2;
  for (const { p, n } of valid) {
    const w = Math.max(p.length, p.width) * k;
    const h = p.height * k;
    const fam = familyOf(p.type);
    const rect = (x0: number, y0: number, x1: number, y1: number, fill: string, stroke?: string, sw?: number, opacity?: number): Shape => ({ kind: 'poly', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill, stroke, sw, opacity });
    const hline = (y: number, x0: number, x1: number, stroke: string, sw = 0.3, opacity?: number): Shape => ({ kind: 'line', a: [x0, y], b: [x1, y], stroke, sw, opacity });
    if (fam === 'pallet') {
      const pb = Math.min(14.4, p.height * 0.35) * k;
      shapes.push(rect(x, base, x + w, base - pb, WOOD_PALLET, shade(WOOD_PALLET, -0.5), 0.4));
      // passages de fourches entre les dés
      const bl = Math.min(w * 0.12, 14.5 * k);
      for (const [a0, a1] of [[x + bl, x + w / 2 - bl / 2], [x + w / 2 + bl / 2, x + w - bl]]) shapes.push(rect(a0, base - pb * 0.16, a1, base - pb * 0.68, shade(WOOD_PALLET, -0.6)));
      // charge : cartons + film
      const hl = h - pb;
      if (hl > 0.5) {
        shapes.push(rect(x, base - pb, x + w, base - h, KRAFT, shade(KRAFT, -0.45), 0.4));
        const grid = loadGrid(Math.max(p.length, p.width), Math.min(p.length, p.width), p.height - 14.4, p.load);
        const nx = grid.nx;
        const nz = grid.nz;
        for (let i = 1; i < nx; i++) shapes.push({ kind: 'line', a: [x + (w * i) / nx, base - pb], b: [x + (w * i) / nx, base - h], stroke: shade(KRAFT, -0.4), sw: 0.4 });
        for (let j = 1; j < nz; j++) shapes.push(hline(base - pb - (hl * j) / nz, x, x + w, shade(KRAFT, -0.4), 0.4));
        shapes.push(rect(x, base - pb, x + w, base - h, '#ffffff', undefined, undefined, 0.18));
        shapes.push(rect(x + w * 0.2, base - pb, x + w * 0.26, base - h, '#ffffff', undefined, undefined, 0.3));
      }
    } else if (fam === 'crate') {
      shapes.push(rect(x, base, x + w, base - h, CRATE, shade(CRATE, -0.5), 0.4));
      const np = Math.max(2, Math.min(12, Math.round(p.height / 14)));
      for (let i = 1; i < np; i++) shapes.push(hline(base - (h * i) / np, x, x + w, shade(CRATE, -0.35), 0.3, 0.7));
      const fr = Math.max(Math.min(9 * k, h * 0.16, w * 0.08), 1);
      shapes.push(rect(x, base, x + w, base - fr, shade(CRATE, 0.08), shade(CRATE, -0.5), 0.3));
      shapes.push(rect(x, base - h + fr, x + w, base - h, shade(CRATE, 0.08), shade(CRATE, -0.5), 0.3));
      shapes.push(rect(x, base, x + fr, base - h, shade(CRATE, 0.08), shade(CRATE, -0.5), 0.3));
      shapes.push(rect(x + w - fr, base, x + w, base - h, shade(CRATE, 0.08), shade(CRATE, -0.5), 0.3));
    } else if (fam === 'carton') {
      shapes.push(rect(x, base, x + w, base - h, KRAFT, shade(KRAFT, -0.5), 0.4));
      shapes.push(rect(x + w * 0.44, base - h, x + w * 0.56, base - h + h * 0.22, '#c39a5f', undefined, undefined, 0.85));
    } else shapes.push(rect(x, base, x + w, base - h, '#c9d1db', shade('#c9d1db', -0.45), 0.5));
    shapes.push({ kind: 'text', at: [x + w / 2, base - h - 5], text: n > 1 ? `×${n}` : `n° ${p.no}`, size: 7.5, color: INK, anchor: 'middle', bold: true });
    x += w + gap;
  }
  shapes.push({ kind: 'line', a: [4, base], b: [Math.min(width - 4, x), base], stroke: '#9aa5b4', sw: 0.8 });
  return { shapes, w: Math.max(width, x), h: base + 16 };
}

/** Regroupe les colis strictement identiques (emballage, dimensions, poids, contenu) */
export interface PackageGroup<P> {
  first: P;
  nos: number[];
}
export function groupIdentical<P extends PackageLike & { netWeight: number; contents: { code: string; quantity: number }[]; basis?: string }>(pkgs: P[]): PackageGroup<P>[] {
  const out: PackageGroup<P>[] = [];
  const index = new Map<string, PackageGroup<P>>();
  for (const p of pkgs) {
    const key = JSON.stringify([p.type, p.length, p.width, p.height, p.grossWeight, p.netWeight, p.basis, p.contents]);
    const g = index.get(key);
    if (g) g.nos.push(p.no);
    else {
      const ng = { first: p, nos: [p.no] };
      index.set(key, ng);
      out.push(ng);
    }
  }
  return out;
}

/** [3,4,5,9] -> "3 à 5, 9" */
export function formatNos(nos: number[], to = 'à'): string {
  const parts: string[] = [];
  for (let i = 0; i < nos.length; i++) {
    let j = i;
    while (j + 1 < nos.length && nos[j + 1] === nos[j] + 1) j++;
    parts.push(j - i >= 1 ? `${nos[i]} ${to} ${nos[j]}` : `${nos[i]}`);
    if (j - i === 1) parts[parts.length - 1] = `${nos[i]}, ${nos[j]}`;
    i = j;
  }
  return parts.join(', ');
}

/** Schéma → texte SVG autonome (pour le convertir en image PNG, par ex. dans l'Excel) */
export function pictureToSvg(pic: Picture): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = pic.shapes
    .map((s) => {
      switch (s.kind) {
        case 'poly':
          return `<polygon points="${s.pts.map((p) => p.map((n) => n.toFixed(2)).join(',')).join(' ')}" fill="${s.fill}"${s.opacity !== undefined ? ` fill-opacity="${s.opacity}"` : ''} stroke="${s.stroke ?? 'none'}" stroke-width="${s.sw ?? 0}" stroke-linejoin="round"/>`;
        case 'line':
          return `<line x1="${s.a[0].toFixed(2)}" y1="${s.a[1].toFixed(2)}" x2="${s.b[0].toFixed(2)}" y2="${s.b[1].toFixed(2)}" stroke="${s.stroke}" stroke-width="${s.sw}"${s.opacity !== undefined ? ` stroke-opacity="${s.opacity}"` : ''}${s.dash ? ' stroke-dasharray="3 2"' : ''}/>`;
        case 'circle':
          return `<circle cx="${s.c[0].toFixed(2)}" cy="${s.c[1].toFixed(2)}" r="${Math.max(0.1, s.r).toFixed(2)}" fill="${s.fill}" stroke="${s.stroke ?? 'none'}" stroke-width="${s.sw ?? 0}"/>`;
        case 'text': {
          const anchor = s.anchor ?? 'start';
          const rot = s.rotate ? ` transform="rotate(${s.rotate} ${s.at[0].toFixed(2)} ${s.at[1].toFixed(2)})"` : '';
          const halo = s.halo ? ' stroke="#fff" stroke-width="3" paint-order="stroke"' : '';
          return `<text x="${s.at[0].toFixed(2)}" y="${s.at[1].toFixed(2)}" font-size="${s.size}" fill="${s.color}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-weight="${s.bold ? 700 : 400}"${rot}${halo}>${esc(s.text)}</text>`;
        }
      }
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pic.w} ${pic.h}" width="${pic.w}" height="${pic.h}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
}
