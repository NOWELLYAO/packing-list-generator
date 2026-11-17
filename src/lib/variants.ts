import type { CatalogItem, PackVariant } from '../types';
import { round } from './parseValues';

/**
 * Un même article peut être expédié de plusieurs façons (2 ou 6 pompes par palette, carton ou caisse…).
 * Chaque configuration observée dans une PL est conservée comme « variante d'emballage ».
 * La fiche affichée reprend la variante la plus fiable (colis dédié, la plus fréquente),
 * et la génération choisit la variante la plus adaptée à la quantité demandée.
 */

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

/** Variantes d'une fiche (une fiche ancienne ou saisie à la main n'en a qu'une : elle-même) */
export function variantsOf(item: CatalogItem): PackVariant[] {
  return item.variants?.length ? item.variants : [variantOf(item)];
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
  };
}
