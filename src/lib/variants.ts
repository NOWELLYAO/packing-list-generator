import type { CatalogItem, PackVariant } from '../types';
import { round } from './parseValues';

/**
 * Un même article peut être expédié de plusieurs façons (2 ou 6 pompes par palette, carton ou caisse…).
 * Chaque configuration observée dans une PL est conservée comme « variante d'emballage ».
 * La fiche affichée reprend la variante la plus fiable (colis dédié, la plus fréquente),
 * et la génération choisit la variante la plus adaptée à la quantité demandée.
 */

/** emballage saisi depuis la fiche article du fabricant (SAP) */
export const SAP_SOURCE = 'Fiche article fabricant (saisie)';

const sig = (v: Pick<PackVariant, 'qtyPerPackage' | 'length' | 'width' | 'height' | 'volumePerPackage'>) =>
  `${round(v.qtyPerPackage, 3)}|${[v.length, v.width, v.height].map((n) => Math.round(n)).sort((a, b) => b - a).join('x')}|${v.length ? '' : round(v.volumePerPackage, 3)}`;

export function variantOf(item: CatalogItem): PackVariant {
  return {
    qtyPerPackage: item.qtyPerPackage,
    packageType: item.packageType,
    length: item.length,
    width: item.width,
    height: item.height,
    volumePerPackage: item.volumePerPackage,
    netWeightPerUnit: item.netWeightPerUnit,
    grossWeightPerUnit: item.grossWeightPerUnit,
    mixed: !!item.mixed,
    packShare: item.packShare,
    source: item.source,
    count: 1,
  };
}

const hasDims = (v: { length: number; width: number; height: number }) => v.length > 0 && v.width > 0 && v.height > 0;
const typeKey = (t: string) => (t || '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Configuration dont seules le volume a pu être lu (PL scannée, colonne illisible) :
 * on reconstitue L × l avec l'empreinte du même emballage vu ailleurs pour cet article
 * (ou la palette standard : 120 × 80, demi-palette 80 × 60), et H = volume ÷ (L × l).
 */
export function completeDims<V extends { packageType: string; length: number; width: number; height: number; volumePerPackage: number }>(v: V, siblings: V[]): V {
  if (hasDims(v) || !(v.volumePerPackage > 0)) return v;
  const same = siblings.find((o) => hasDims(o) && typeKey(o.packageType) === typeKey(v.packageType));
  const t = v.packageType.toLowerCase();
  // format de carton écrit dans le libellé, en mm : « 400x450x » → 40 × 45 cm
  const named = t.match(/(\d{3,4})\s*x\s*(\d{3,4})/);
  const fp: [number, number] | null = same
    ? [same.length, same.width]
    : named
      ? [Math.round(Number(named[1]) / 10), Math.round(Number(named[2]) / 10)]
      : /half|demi|1\/2/.test(t)
        ? [80, 60]
        : /pal|eur|plate/.test(t)
          ? [120, 80]
          : null;
  // palette sans empreinte connue : une charge de moins de 20 cm sur une 120 × 80 n'est pas plausible (une pompe de 96 kg
  // ne fait pas 7 cm de haut) → on prend la demi-palette 80 × 60 si elle donne une hauteur réaliste
  if (fp && !same && !named && fp[0] === 120 && fp[1] === 80) {
    const h120 = (v.volumePerPackage * 1e6) / (120 * 80);
    const h80 = (v.volumePerPackage * 1e6) / (80 * 60);
    if (h120 < 35 && h80 >= 30) [fp[0], fp[1]] = [80, 60];
  }
  if (fp) {
    const h = Math.round((v.volumePerPackage * 1e6) / (fp[0] * fp[1]));
    // palette « par défaut » sans place pour une charge (< 20 cm) : ce n'était pas une palette
    const defaultPallet = !same && !named;
    if (h >= 3 && h <= 260 && !(defaultPallet && h < 20)) return { ...v, length: Math.max(fp[0], fp[1]), width: Math.min(fp[0], fp[1]), height: h, dimsInferred: true };
  }
  // seul le volume est connu : cube de même volume (signalé « à vérifier »)
  const c = Math.round(Math.cbrt(v.volumePerPackage) * 100);
  if (c >= 5 && c <= 250) return { ...v, length: c, width: c, height: c, dimsInferred: true };
  return v;
}

/** Variantes d'une fiche (une fiche ancienne ou saisie à la main n'en a qu'une : elle-même) */
export function variantsOf(item: CatalogItem): PackVariant[] {
  const vs = item.variants?.length ? item.variants : [variantOf(item)];
  // une configuration sans dimensions est inutile si la même (quantité + emballage) a été mesurée ailleurs
  const measured = (v: PackVariant) => sane.some((o) => o !== v && hasDims(o) && o.qtyPerPackage === v.qtyPerPackage && typeKey(o.packageType) === typeKey(v.packageType));
  // relevé aberrant (ex. une date lue comme quantité : 2026 pièces par colis, sans dimensions) : écarté s'il y a mieux
  // ou physiquement impossible (plus de 3 000 kg par m³ : un zéro perdu à la lecture, 240 → 24 cm)
  const density = (v: PackVariant) => {
    const vol = hasDims(v) ? (v.length * v.width * v.height) / 1e6 : v.volumePerPackage;
    return vol > 0 ? (v.grossWeightPerUnit * v.qtyPerPackage) / vol : 0;
  };
  // ou un poids unitaire 20 fois plus faible / plus fort que les autres relevés (1 kg au lieu de 254 kg)
  // la fiche article du fabricant fait référence : c'est elle qui sert d'étalon, et elle n'est jamais écartée
  const sapVs = vs.filter((v) => v.source === SAP_SOURCE);
  const nets = (sapVs.length ? sapVs : vs).map((v) => v.netWeightPerUnit).filter((n) => n > 0).sort((a, b) => a - b);
  const medNet = nets.length >= 2 ? nets[Math.floor(nets.length / 2)] : 0;
  const weightOutlier = (v: PackVariant) => medNet > 0 && v.netWeightPerUnit > 0 && (v.netWeightPerUnit / medNet > 20 || medNet / v.netWeightPerUnit > 20);
  const absurd = (v: PackVariant) => v.source !== SAP_SOURCE && ((v.qtyPerPackage > 999 && !hasDims(v)) || density(v) > 3000 || weightOutlier(v));
  const sane = vs.some((v) => !absurd(v)) ? vs.filter((v) => !absurd(v)) : vs;
  // fiche article du fabricant saisie : les relevés de PL sans dimensions (volume seul) deviennent inutiles
  const hasSap = sane.some((v) => v.source === SAP_SOURCE && hasDims(v));
  const kept = sane.filter((v) => (hasSap ? hasDims(v) && !v.dimsInferred : hasDims(v) || !measured(v)));
  return kept.map((v) => completeDims(v, kept));
}

/** Fusionne des listes de variantes : même configuration -> compteur incrémenté, valeurs les plus récentes */
export function mergeVariants(a: PackVariant[], b: PackVariant[]): PackVariant[] {
  const map = new Map<string, PackVariant>();
  for (const v of [...a, ...b]) {
    const k = sig(v);
    const prev = map.get(k);
    if (!prev) map.set(k, { ...v });
    else {
      // un colis dédié est plus fiable qu'une estimation en colis mixte
      const keep = prev.mixed && !v.mixed ? v : prev;
      map.set(k, { ...keep, mixed: prev.mixed && v.mixed, count: prev.count + v.count });
    }
  }
  return [...map.values()];
}

/** Variante de référence : colis dédié d'abord, puis la plus fréquente */
export function preferredVariant(vs: PackVariant[]): PackVariant {
  return [...vs].sort((x, y) => Number(x.mixed) - Number(y.mixed) || y.count - x.count)[0];
}

/** Applique une variante aux champs principaux de la fiche */
export function applyVariant(item: CatalogItem, v: PackVariant): CatalogItem {
  return {
    ...item,
    qtyPerPackage: v.qtyPerPackage,
    packageType: v.packageType,
    length: v.length,
    width: v.width,
    height: v.height,
    volumePerPackage: v.volumePerPackage,
    netWeightPerUnit: v.netWeightPerUnit,
    grossWeightPerUnit: v.grossWeightPerUnit,
    mixed: v.mixed,
    packShare: v.mixed ? v.packShare : undefined,
    dimsInferred: v.dimsInferred,
    twinFrom: v.twinOf,
  };
}
