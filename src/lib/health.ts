import type { CatalogItem } from '../types';
import { variantsOf } from './variants';
import { withSimilarPacking } from './generate';
import { hasError, itemIssues } from './quality';

/**
 * Santé de la base : pour chaque article, l'emballage proposé repose-t-il sur une mesure réelle ?
 * - ok        : emballage relevé tel quel sur au moins une PL (ou fiche corrigée à la main)
 * - suspect   : données impossibles (densité, net > brut…) → à ressaisir
 * - nodata    : ni dimensions ni volume
 * - inferred  : dimensions illisibles sur la PL, reconstituées à partir du volume
 * - similar   : vu seulement dans un colis partagé, emballage repris d'un article du même modèle
 * - shared    : vu seulement dans un colis partagé, sans article similaire (emballage estimé)
 */
export type HealthStatus = 'ok' | 'suspect' | 'nodata' | 'inferred' | 'similar' | 'shared';

export interface ItemHealth {
  status: HealthStatus;
  reason: string;
  /** nombre d'envois connus (priorité : les articles les plus expédiés d'abord) */
  seen: number;
}

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  ok: 'Fiable',
  suspect: 'Données fausses',
  nodata: 'Sans dimensions',
  inferred: 'Reconstitué',
  similar: 'Article similaire',
  shared: 'Colis partagé',
};

/** Ordre de priorité de correction */
// les accessoires vus seulement en colis partagé passent en dernier : ils sont regroupés comme Grundfos le fait
export const HEALTH_ORDER: HealthStatus[] = ['suspect', 'nodata', 'inferred', 'similar', 'shared', 'ok'];

const hasDims = (v: { length: number; width: number; height: number }) => v.length > 0 && v.width > 0 && v.height > 0;

export function itemHealth(item: CatalogItem, catalog: CatalogItem[]): ItemHealth {
  const vs = variantsOf(item);
  const seen = vs.reduce((s, v) => s + (v.count || 1), 0);
  if (item.manual) return { status: 'ok', reason: 'Fiche corrigée à la main', seen };
  if (hasError(item))
    return {
      status: 'suspect',
      reason: itemIssues(item)
        .filter((i) => i.severity === 'error')
        .map((i) => i.message)
        .join(' ; '),
      seen,
    };
  const own = vs.filter((v) => !v.mixed);
  if (!own.length) {
    const sim = withSimilarPacking(item, catalog);
    if (sim.similarFrom) return { status: 'similar', reason: `Vu seulement dans un colis partagé : emballage repris de ${sim.similarFrom}`, seen };
    return { status: 'shared', reason: 'Vu seulement dans un colis partagé avec d’autres articles : son propre emballage est estimé', seen };
  }
  if (own.every((v) => !hasDims(v) && !(v.volumePerPackage > 0))) return { status: 'nodata', reason: 'Ni dimensions ni volume sur les PL importées', seen };
  if (own.every((v) => v.dimsInferred || !hasDims(v))) {
    const v = own.find((x) => x.volumePerPackage > 0) ?? own[0];
    return { status: 'inferred', reason: `Dimensions illisibles sur la PL : ${v.length}×${v.width}×${v.height} cm reconstitués à partir du volume (${v.volumePerPackage} m³)`, seen };
  }
  return { status: 'ok', reason: 'Emballage relevé tel quel sur une PL', seen };
}

export function catalogHealth(catalog: CatalogItem[]) {
  const map = new Map<string, ItemHealth>();
  const counts: Record<HealthStatus, number> = { ok: 0, suspect: 0, nodata: 0, inferred: 0, similar: 0, shared: 0 };
  for (const it of catalog) {
    const h = itemHealth(it, catalog);
    map.set(it.id, h);
    counts[h.status]++;
  }
  const toFix = catalog.length - counts.ok;
  return { map, counts, toFix, okPct: catalog.length ? Math.round((counts.ok / catalog.length) * 100) : 100 };
}
