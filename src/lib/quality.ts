import type { CatalogItem } from '../types';

/**
 * Contrôle qualité d'une fiche article : repère les données physiquement impossibles
 * ou incomplètes, sans jamais les corriger à la place de l'utilisateur.
 */
export interface Issue {
  code: 'density' | 'tare' | 'netGross' | 'noDims' | 'noWeight' | 'mixed';
  severity: 'error' | 'warning';
  message: string;
}

/** Au-delà, un colis est plus dense que ce qu'on observe sur du matériel emballé (acier massif = 7 850 kg/m³) */
export const MAX_DENSITY = 3000;

const PALLET_OR_CRATE = /pal|euro|half|plate|crate|caisse|plywood|wood/i;

export function itemIssues(it: CatalogItem): Issue[] {
  const out: Issue[] = [];
  const per = it.qtyPerPackage > 0 ? it.qtyPerPackage : 1;
  const vol = it.length > 0 && it.width > 0 && it.height > 0 ? (it.length * it.width * it.height) / 1e6 : it.volumePerPackage || 0;
  const gross = it.grossWeightPerUnit * per;
  if (it.netWeightPerUnit > it.grossWeightPerUnit + 1e-6)
    out.push({ code: 'netGross', severity: 'error', message: 'Poids net supérieur au poids brut' });
  if (vol > 0 && gross / vol > MAX_DENSITY)
    out.push({
      code: 'density',
      severity: 'error',
      message: `Densité impossible : ${Math.round(gross)} kg dans ${Math.round(vol * 1000)} litres (${Math.round(gross / vol).toLocaleString('fr-FR')} kg/m³) — poids ou dimensions erronés`,
    });
  if (PALLET_OR_CRATE.test(it.packageType) && gross > 50 && Math.abs(it.grossWeightPerUnit - it.netWeightPerUnit) < 1e-6)
    out.push({ code: 'tare', severity: 'warning', message: 'Brut = net sur une palette ou caisse : le poids de l’emballage semble manquer' });
  if (!vol) out.push({ code: 'noDims', severity: 'warning', message: 'Dimensions inconnues' });
  if (!(it.grossWeightPerUnit > 0)) out.push({ code: 'noWeight', severity: 'warning', message: 'Poids inconnu' });
  if (it.mixed && !it.manual) out.push({ code: 'mixed', severity: 'warning', message: 'Vu seulement en colis mixte : valeurs estimées' });
  return out;
}

export const hasError = (it: CatalogItem) => !it.manual && itemIssues(it).some((i) => i.severity === 'error');
export const needsCheck = (it: CatalogItem) => itemIssues(it).length > 0;
