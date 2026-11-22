import type { CatalogItem, PackingList, PLPackage, RequestLine } from '../types';
import type { SapDocument } from './sapPackingList';
import { findItem, generatePackingList } from './generate';
import { round } from './parseValues';

/**
 * Apprentissage à partir des PL réelles.
 *
 * Quand une PL réelle (Grundfos) est importée, l'application génère d'abord SA proposition pour les
 * mêmes articles et quantités, avec la base telle qu'elle était AVANT l'import (test à l'aveugle),
 * mesure l'écart, puis seulement ensuite enregistre la PL dans la base.
 * L'historique de ces mesures donne la précision réelle de l'application, et sa progression.
 */

export interface RealPackage {
  type: string;
  length: number;
  width: number;
  height: number;
  volume: number;
  grossWeight: number;
  netWeight: number;
  codes: string[];
}

export interface ArticleCheck {
  code: string;
  description: string;
  quantity: number;
  proposed: string;
  real: string;
  ok: boolean;
}

export interface ProposalScore {
  score: number; // 0-100
  packages: number;
  exactPackages: number; // colis réels retrouvés à l'identique (mêmes articles, dimensions à ± 5 cm)
  volume: number;
  gross: number;
  volumeErrPct: number;
  grossErrPct: number;
  articles: ArticleCheck[];
}

export interface AccuracyRecord {
  id: string;
  date: string;
  plNumber: string;
  fileName: string;
  /** articles déjà connus de la base au moment du test (les nouveaux ne peuvent pas être prédits) */
  known: number;
  unknown: number;
  real: { packages: number; volume: number; gross: number };
  grundfos: ProposalScore;
  smart: ProposalScore;
}

/** Colis réels d'une PL SAP */
export function realPackages(doc: SapDocument): RealPackage[] {
  const pkgs = realPackagesRaw(doc);
  // colis sans volume exploitable (cotes illisibles dans la PL) : estimé d'après les autres colis du même article
  const perUnit = new Map<string, number[]>();
  for (const h of doc.hus) {
    const mats = [...new Set(h.positions.map((p) => p.material))];
    const q = h.positions.reduce((t, p) => t + (Number.isFinite(p.qty) ? p.qty : 0), 0);
    const pk = pkgs.find((x) => x.hu === h);
    if (mats.length === 1 && q > 0 && pk && pk.volume > 0) perUnit.set(mats[0], [...(perUnit.get(mats[0]) ?? []), pk.volume / q]);
  }
  return pkgs.map(({ hu, ...p }) => {
    if (p.volume > 0 || p.codes.length !== 1) return p;
    const v = perUnit.get(p.codes[0]);
    const q = hu.positions.reduce((t, x) => t + (Number.isFinite(x.qty) ? x.qty : 0), 0);
    return v?.length ? { ...p, volume: round((v.reduce((a, b) => a + b, 0) / v.length) * q, 3) } : p;
  });
}

function realPackagesRaw(doc: SapDocument): (RealPackage & { hu: SapDocument['hus'][number] })[] {
  return doc.hus
    .filter((h) => h.positions.some((p) => Number.isFinite(p.qty) && p.qty > 0))
    .map((h) => {
      const dims = h.dims && h.dims.l > 1 && h.dims.w > 1 && h.dims.h > 1 ? h.dims : null;
      const [l, w] = dims ? [Math.max(dims.l, dims.w), Math.min(dims.l, dims.w)] : [0, 0];
      return {
        type: h.packType,
        length: l,
        width: w,
        height: dims?.h ?? 0,
        volume: dims ? round((dims.l * dims.w * dims.h) / 1e6, 3) : Number.isFinite(h.volume) ? h.volume : 0,
        grossWeight: Number.isFinite(h.gross) ? h.gross : 0,
        netWeight: Number.isFinite(h.net) ? h.net : 0,
        codes: [...new Set(h.positions.map((p) => p.material))],
        hu: h,
      };
    });
}

/** Articles et quantités de la PL réelle (ce qu'il aurait fallu saisir dans l'application) */
export function realRequests(doc: SapDocument): { requests: RequestLine[]; descriptions: Map<string, string> } {
  const qty = new Map<string, number>();
  const descriptions = new Map<string, string>();
  for (const h of doc.hus)
    for (const p of h.positions) {
      if (!(Number.isFinite(p.qty) && p.qty > 0)) continue;
      qty.set(p.material, round((qty.get(p.material) ?? 0) + p.qty, 4));
      if (!descriptions.has(p.material)) descriptions.set(p.material, p.description.replace(/\s+/g, ' ').trim());
    }
  return { requests: [...qty].map(([code, quantity], i) => ({ id: `r${i}`, code, pn: '', quantity })), descriptions };
}

const dimsKey = (l: number, w: number, h: number) => [l, w, h].map((x) => Math.round(x)).sort((a, b) => b - a);
const close = (a: number[], b: number[]) => a.length === 3 && b.length === 3 && a.every((x, i) => Math.abs(x - b[i]) <= 5);
const fmtPkgs = (ps: { length: number; width: number; height: number; volume: number }[]) => {
  if (!ps.length) return '—';
  const m = new Map<string, number>();
  for (const p of ps) {
    const k = p.length ? `${p.length}×${p.width}×${p.height}` : `${p.volume} m³`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([k, n]) => (n > 1 ? `${n} × ${k}` : k)).join(' + ');
};
const errPct = (a: number, b: number) => (b > 0 ? Math.abs(a - b) / b : a > 0 ? 1 : 0);

/** Compare une proposition à la PL réelle, sur les seuls articles que la base connaissait */
export function scoreProposal(pl: PackingList, real: RealPackage[], knownCodes: Set<string>, descriptions: Map<string, string>): ProposalScore {
  // on ne compare que les colis réels dont tous les articles étaient connus
  const realKnown = real.filter((r) => r.codes.every((c) => knownCodes.has(c)));
  const used = new Set<PLPackage>();
  let exact = 0;
  for (const r of realKnown) {
    const rk = dimsKey(r.length, r.width, r.height);
    const m = pl.packages.find(
      (p) => !used.has(p) && p.contents.length === r.codes.length && r.codes.every((c) => p.contents.some((x) => x.code === c)) && close(dimsKey(p.length, p.width, p.height), rk),
    );
    if (m) {
      used.add(m);
      exact++;
    }
  }
  const volume = round(pl.packages.reduce((s, p) => s + p.volume, 0), 3);
  const gross = round(pl.packages.reduce((s, p) => s + p.grossWeight, 0), 1);
  const rVol = realKnown.reduce((s, r) => s + r.volume, 0);
  const rGross = realKnown.reduce((s, r) => s + r.grossWeight, 0);
  const volumeErrPct = round(errPct(volume, rVol) * 100, 1);
  const grossErrPct = round(errPct(gross, rGross) * 100, 1);

  const articles: ArticleCheck[] = pl.lines
    .filter((l) => l.found)
    .map((l) => {
      const mine = pl.packages.filter((p) => p.contents.some((c) => c.code === l.code));
      const theirs = realKnown.filter((r) => r.codes.includes(l.code));
      const a = fmtPkgs(mine);
      const b = fmtPkgs(theirs);
      const ok = mine.length === theirs.length && theirs.every((r) => mine.some((p) => close(dimsKey(p.length, p.width, p.height), dimsKey(r.length, r.width, r.height))));
      return { code: l.code, description: l.description || descriptions.get(l.code) || '', quantity: l.quantity, proposed: a, real: b, ok };
    });

  // score : nombre de colis (30), volume (30), poids (25), colis identiques (15)
  const nReal = realKnown.length;
  const countPart = nReal ? Math.max(0, 1 - Math.abs(pl.packages.length - nReal) / nReal) : 1;
  const volPart = Math.max(0, 1 - volumeErrPct / 50);
  const grossPart = Math.max(0, 1 - grossErrPct / 50);
  const exactPart = nReal ? exact / nReal : 1;
  const score = Math.round(100 * (0.3 * countPart + 0.3 * volPart + 0.25 * grossPart + 0.15 * exactPart));
  return { score, packages: pl.packages.length, exactPackages: exact, volume, gross, volumeErrPct, grossErrPct, articles };
}

/**
 * Test à l'aveugle d'une PL réelle contre la base actuelle (avant apprentissage).
 * Renvoie null si aucun article de la PL n'est connu (rien à prédire : la base apprend simplement).
 */
export function blindTest(doc: SapDocument, catalog: CatalogItem[], fileName: string): AccuracyRecord | null {
  const real = realPackages(doc);
  if (!real.length) return null;
  const { requests, descriptions } = realRequests(doc);
  const knownCodes = new Set(requests.filter((r) => findItem(catalog, r.code, r.pn)).map((r) => r.code));
  // un colis réel mélangeant un article inconnu n'est pas comparable : ses articles connus sont exclus aussi
  const comparable = new Set(real.filter((r) => r.codes.every((c) => knownCodes.has(c))).flatMap((r) => r.codes));
  const knownReq = requests.filter((r) => comparable.has(r.code));
  if (!knownReq.length) return null;
  const realKnown = real.filter((r) => r.codes.every((c) => comparable.has(c)));
  const g = generatePackingList(catalog, knownReq, { consolidate: true, strategy: 'grundfos' });
  const s = generatePackingList(catalog, knownReq, { consolidate: true, strategy: 'smart' });
  return {
    id: `${doc.number || fileName}-${Date.now()}`,
    date: new Date().toISOString(),
    plNumber: doc.number,
    fileName,
    known: knownReq.length,
    unknown: requests.length - knownReq.length,
    real: {
      packages: realKnown.length,
      volume: round(realKnown.reduce((t, r) => t + r.volume, 0), 3),
      gross: round(realKnown.reduce((t, r) => t + r.grossWeight, 0), 1),
    },
    grundfos: scoreProposal(g, realKnown, comparable, descriptions),
    smart: scoreProposal(s, realKnown, comparable, descriptions),
  };
}

/** Synthèse de toutes les mesures : précision moyenne et tendance (les plus récentes contre les plus anciennes) */
export function accuracySummary(log: AccuracyRecord[]) {
  if (!log.length) return null;
  const best = (r: AccuracyRecord) => Math.max(r.grundfos.score, r.smart.score);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
  // médiane : quelques PL atypiques ne doivent pas masquer la précision habituelle
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const v = [...xs].sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 10) / 10;
  };
  const sorted = [...log].sort((a, b) => a.date.localeCompare(b.date));
  const half = Math.max(1, Math.floor(sorted.length / 2));
  const exactPkgs = sorted.reduce((s, r) => s + r.grundfos.exactPackages, 0);
  const realPkgs = sorted.reduce((s, r) => s + r.real.packages, 0);
  return {
    count: log.length,
    average: avg(sorted.map(best)),
    grundfos: avg(sorted.map((r) => r.grundfos.score)),
    smart: avg(sorted.map((r) => r.smart.score)),
    exactRate: realPkgs ? Math.round((exactPkgs / realPkgs) * 100) : 0,
    volumeErr: median(sorted.map((r) => Math.min(r.grundfos.volumeErrPct, r.smart.volumeErrPct))),
    grossErr: median(sorted.map((r) => Math.min(r.grundfos.grossErrPct, r.smart.grossErrPct))),
    trend: sorted.length >= 4 ? avg(sorted.slice(-half).map(best)) - avg(sorted.slice(0, half).map(best)) : null,
  };
}
