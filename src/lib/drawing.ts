/**
 * Moteur de dessin vectoriel commun à l'écran (SVG) et au PDF (jsPDF).
 * Les schémas sont décrits par des formes simples dans un repère abstrait,
 * puis rendus par Drawing.tsx (SVG) ou drawShapesPdf (PDF) : mêmes schémas partout.
 */

export type Pt = [number, number];
export type Shape =
  | { kind: 'poly'; pts: Pt[]; fill: string; stroke?: string; sw?: number; opacity?: number }
  | { kind: 'line'; a: Pt; b: Pt; stroke: string; sw: number; dash?: boolean }
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

const WOOD = '#c99a62';
const KRAFT = '#d2b48c';
const INK = '#2b3442';

/* ------------------------------------------------------------------ */
/* Schéma isométrique d'un colis                                       */
/* ------------------------------------------------------------------ */

const C30 = Math.cos(Math.PI / 6);
const iso = (a: number, b: number, z: number): Pt => [(a - b) * C30, (a + b) * 0.5 - z];

/** Faces visibles d'un parallélépipède [a0..a1]×[b0..b1]×[z0..z1] */
function boxFaces(a0: number, a1: number, b0: number, b1: number, z0: number, z1: number, base: string, stroke: string): Shape[] {
  const P = iso;
  return [
    { kind: 'poly', pts: [P(a0, b1, z0), P(a1, b1, z0), P(a1, b1, z1), P(a0, b1, z1)], fill: shade(base, -0.08), stroke, sw: 0.6 }, // face avant gauche (b = b1)
    { kind: 'poly', pts: [P(a1, b0, z0), P(a1, b1, z0), P(a1, b1, z1), P(a1, b0, z1)], fill: shade(base, -0.24), stroke, sw: 0.6 }, // face avant droite (a = a1)
    { kind: 'poly', pts: [P(a0, b0, z1), P(a1, b0, z1), P(a1, b1, z1), P(a0, b1, z1)], fill: shade(base, 0.18), stroke, sw: 0.6 }, // dessus
  ];
}

export interface PackageLike {
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
export function packageDrawing(p: PackageLike, accent: string, labels: DrawLabels): Picture {
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
  const k = Math.min(150 / bw, 118 / bh);
  const ox = (W - bw * k) / 2 - Math.min(...xs) * k;
  const oy = 16 + (126 - bh * k) / 2 - Math.min(...ys) * k;
  const T = (pt: Pt): Pt => [ox + pt[0] * k, oy + pt[1] * k];
  const push = (s: Shape[]) => {
    for (const sh of s) {
      if (sh.kind === 'poly') shapes.push({ ...sh, pts: sh.pts.map(T) });
      else if (sh.kind === 'line') shapes.push({ ...sh, a: T(sh.a), b: T(sh.b) });
      else shapes.push(sh);
    }
  };
  const stroke = shade(INK, 0.35);

  // ombre portée
  push([{ kind: 'poly', pts: [iso(0, 0, 0), iso(L, 0, 0), iso(L, l, 0), iso(0, l, 0)].map(([x, y]) => [x + 4 / k, y + 3 / k] as Pt), fill: '#000', opacity: 0.08 }]);

  if (fam === 'pallet') {
    const pb = Math.min(15, H * 0.35); // socle
    push(boxFaces(0, L, 0, l, 0, pb, WOOD, shade(WOOD, -0.45)));
    // passages de fourches (3 dés visibles par face)
    const gap = (u0: number, u1: number, face: 'a' | 'b') => {
      const z0 = 0;
      const z1 = pb * 0.62;
      const pts: Pt[] =
        face === 'b' ? [iso(u0, l, z0), iso(u1, l, z0), iso(u1, l, z1), iso(u0, l, z1)] : [iso(L, u0, z0), iso(L, u1, z0), iso(L, u1, z1), iso(L, u0, z1)];
      return { kind: 'poly' as const, pts, fill: shade(WOOD, -0.62) };
    };
    push([gap(L * 0.13, L * 0.44, 'b'), gap(L * 0.56, L * 0.87, 'b'), gap(l * 0.13, l * 0.44, 'a'), gap(l * 0.56, l * 0.87, 'a')]);
    if (H - pb > 0.5) {
      // charge filmée
      const load = shade(accent, 0.62);
      push(boxFaces(0, L, 0, l, pb, H, load, shade(accent, -0.1)));
      // bandes de film étirable
      for (const f of [0.35, 0.7]) {
        const z = pb + (H - pb) * f;
        push([
          { kind: 'line', a: iso(0, l, z), b: iso(L, l, z), stroke: shade(accent, 0.3), sw: 0.5 },
          { kind: 'line', a: iso(L, 0, z), b: iso(L, l, z), stroke: shade(accent, 0.2), sw: 0.5 },
        ]);
      }
    }
  } else if (fam === 'crate') {
    push(boxFaces(0, L, 0, l, 0, H, '#ddb98a', shade(WOOD, -0.5)));
    // planches horizontales
    const n = Math.max(2, Math.min(7, Math.round(H / 25)));
    for (let i = 1; i < n; i++) {
      const z = (H * i) / n;
      push([
        { kind: 'line', a: iso(0, l, z), b: iso(L, l, z), stroke: shade(WOOD, -0.35), sw: 0.45 },
        { kind: 'line', a: iso(L, 0, z), b: iso(L, l, z), stroke: shade(WOOD, -0.45), sw: 0.45 },
      ]);
    }
    // montants d'angle
    const e = Math.min(L, l) * 0.07;
    push([
      { kind: 'poly', pts: [iso(L - e, l, 0), iso(L, l, 0), iso(L, l, H), iso(L - e, l, H)], fill: shade(WOOD, -0.2), stroke: shade(WOOD, -0.5), sw: 0.4 },
      { kind: 'poly', pts: [iso(0, l, 0), iso(e, l, 0), iso(e, l, H), iso(0, l, H)], fill: shade(WOOD, -0.2), stroke: shade(WOOD, -0.5), sw: 0.4 },
      { kind: 'poly', pts: [iso(L, 0, 0), iso(L, e, 0), iso(L, e, H), iso(L, 0, H)], fill: shade(WOOD, -0.35), stroke: shade(WOOD, -0.5), sw: 0.4 },
    ]);
  } else if (fam === 'carton') {
    push(boxFaces(0, L, 0, l, 0, H, KRAFT, shade(KRAFT, -0.45)));
    // ruban adhésif sur le dessus et la face
    const t = Math.min(l * 0.09, 6);
    push([
      { kind: 'poly', pts: [iso(0, l / 2 - t, H), iso(L, l / 2 - t, H), iso(L, l / 2 + t, H), iso(0, l / 2 + t, H)], fill: '#efe3c8', stroke: shade(KRAFT, -0.3), sw: 0.3 },
      { kind: 'poly', pts: [iso(L, l / 2 - t, H), iso(L, l / 2 + t, H), iso(L, l / 2 + t, H * 0.78), iso(L, l / 2 - t, H * 0.78)], fill: '#e4d4b0', stroke: shade(KRAFT, -0.3), sw: 0.3 },
    ]);
  } else {
    push(boxFaces(0, L, 0, l, 0, H, '#cfd6df', stroke));
  }

  // ---- cotes ----
  const d = Math.max(L, l, H) * 0.09;
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
  shapes.push({ kind: 'text', at: [ha[0] + 5, (ha[1] + hb[1]) / 2], text: fmt(H), size: 8.5, color: INK, anchor: 'middle', rotate: -90, bold: true, halo: true });

  // poids
  shapes.push({
    kind: 'text',
    at: [W / 2, Hh - 8],
    text: `${labels.packageWord} ${p.no} · ${p.grossWeight.toLocaleString(labels.locale, { maximumFractionDigits: 1 })} ${labels.kg}`,
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

export function scaleStrip(pkgs: PackageLike[], accent: string, labels: DrawLabels, width = 640): Picture {
  const shapes: Shape[] = [];
  const valid = pkgs.filter((p) => p.length > 0 && p.height > 0);
  if (!valid.length) return { shapes, w: width, h: 10 };
  const gap = 10;
  const maxH = Math.max(...valid.map((p) => p.height), 180); // repère humain 180 cm
  const totalL = valid.reduce((s, p) => s + Math.max(p.length, p.width), 0) + 60; // + silhouette
  const k = Math.min((width - gap * (valid.length + 2)) / totalL, 120 / maxH);
  const base = 140;
  let x = gap;
  // silhouette humaine 1,80 m (repère d'échelle)
  const hp = 180 * k;
  const head = hp * 0.07;
  shapes.push({ kind: 'circle', c: [x + 14 * k + 6, base - hp + head], r: head, fill: '#b8c2cf' });
  shapes.push({ kind: 'poly', pts: [[x + 6, base], [x + 6 + 28 * k, base], [x + 6 + 26 * k, base - hp + head * 2.2], [x + 6 + 2 * k, base - hp + head * 2.2]], fill: '#b8c2cf' });
  shapes.push({ kind: 'text', at: [x + 6 + 14 * k, base + 11], text: `${(1.8).toLocaleString(labels.locale)} m`, size: 7, color: '#7a8596', anchor: 'middle' });
  x += 30 * k + gap * 2;
  for (const p of valid) {
    const w = Math.max(p.length, p.width) * k;
    const h = p.height * k;
    const fam = familyOf(p.type);
    const fill = fam === 'pallet' ? shade(accent, 0.62) : fam === 'crate' ? '#ddb98a' : fam === 'carton' ? KRAFT : '#cfd6df';
    if (fam === 'pallet') {
      const pb = Math.min(15, p.height * 0.35) * k;
      shapes.push({ kind: 'poly', pts: [[x, base], [x + w, base], [x + w, base - pb], [x, base - pb]], fill: WOOD, stroke: shade(WOOD, -0.45), sw: 0.5 });
      shapes.push({ kind: 'poly', pts: [[x, base - pb], [x + w, base - pb], [x + w, base - h], [x, base - h]], fill, stroke: shade(accent, -0.1), sw: 0.5 });
    } else shapes.push({ kind: 'poly', pts: [[x, base], [x + w, base], [x + w, base - h], [x, base - h]], fill, stroke: shade(fill, -0.45), sw: 0.5 });
    shapes.push({ kind: 'text', at: [x + w / 2, base - h - 4], text: String(p.no), size: 8, color: INK, anchor: 'middle', bold: true });
    x += w + gap;
  }
  shapes.push({ kind: 'line', a: [4, base], b: [Math.min(width - 4, x), base], stroke: '#9aa5b4', sw: 0.8 });
  return { shapes, w: Math.max(width, x), h: base + 16 };
}
