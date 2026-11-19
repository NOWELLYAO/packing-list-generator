import type { CatalogItem, PackVariant } from '../types';
import { applyVariant, preferredVariant, SAP_SOURCE } from './variants';

/**
 * Emballage « intelligent » à partir des fiches article SAP.
 * Une fiche SAP donne l'article (dimensions, poids) mais pas toujours le colis réel : une pompe S2 de 1 t
 * part en caisse, pas sur une palette nue. On s'appuie, dans l'ordre :
 *  1. sur les envois réels de l'article (PL importées) ;
 *  2. sur les envois réels de sa famille (même début de désignation : S2, SL1, SEG, SP, CR, Hydro MPC…),
 *     à poids comparable — avec l'écart réel entre fiche SAP et caisse quand la famille le montre ;
 *  3. sur des règles physiques (au-delà de 400 kg → caisse ; pompe immergée lourde → caisse).
 */

export type PackClass = 'crate' | 'pallet' | 'carton';

export function packClass(t: string): PackClass {
  if (/crate|caisse|kiste|wood|plywood|bois/i.test(t)) return 'crate';
  if (/pal|euro|half|skid|plate/i.test(t)) return 'pallet';
  return 'carton';
}

const CLASS_LABEL: Record<PackClass, string> = { crate: 'Caisse', pallet: 'Palette', carton: 'Carton' };

/** Famille d'un article d'après sa désignation : « S2.110.200.1600… » → S2 ; « SL1.50.65 » → SL1 ; « Hydro MPC-E » → HYDRO MPC */
export function familyKey(desc: string): string {
  const d = desc.toUpperCase().replace(/\bPARK\b/g, ' ').trim();
  const dotted = d.match(/^([A-Z]{1,4}\d?)\./);
  if (dotted) return dotted[1];
  const two = d.match(/^(HYDRO|CONTROL|MULTIBOX|DUMMY)\s+([A-Z]+)/);
  if (two) return `${two[1]} ${two[2]}`;
  const m = d.match(/^([A-Z]{1,6})(?=[\s\d-])/);
  return m ? m[1] : '';
}

const hasDims = (v: PackVariant) => v.length > 0 && v.width > 0 && v.height > 0;
const isSap = (v: PackVariant) => v.source === SAP_SOURCE;
const realOwn = (v: PackVariant) => !isSap(v) && !v.mixed && hasDims(v) && !v.dimsInferred;
const sorted = (v: PackVariant) => [v.length, v.width, v.height].sort((a, b) => b - a);

export interface FamilyIndex {
  get(key: string): { item: CatalogItem; real: PackVariant; sap?: PackVariant }[];
}

/** Envois réels unitaires (1 article par colis) de chaque famille */
export function buildFamilyIndex(catalog: CatalogItem[]): FamilyIndex {
  const m = new Map<string, { item: CatalogItem; real: PackVariant; sap?: PackVariant }[]>();
  for (const it of catalog) {
    const k = familyKey(it.description);
    if (!k) continue;
    const vs = it.variants ?? [];
    const sap = vs.find((v) => isSap(v) && v.qtyPerPackage === 1 && hasDims(v));
    for (const real of vs.filter((v) => realOwn(v) && v.qtyPerPackage === 1)) m.set(k, [...(m.get(k) ?? []), { item: it, real, sap }]);
  }
  return { get: (k) => m.get(k) ?? [] };
}

/**
 * Adapte les emballages issus de SAP pour la génération.
 * - mode « grundfos » : ce que Grundfos a réellement fait d'abord (les fiches SAP ne servent que si l'article n'a jamais été expédié seul) ;
 * - mode optimisé : fiche SAP gardée, mais avec le bon type de colis (et la caisse réelle quand l'article a déjà été expédié en caisse).
 */
export function adaptSapPacking(item: CatalogItem, fam: FamilyIndex, strategy: 'smart' | 'grundfos'): CatalogItem {
  const vs = item.variants ?? [];
  if (item.manual || !vs.some(isSap)) return item;
  const own = vs.filter(realOwn);
  let out = vs;
  let note = '';
  if (strategy === 'grundfos' && own.length) {
    out = vs.filter((v) => !isSap(v));
  } else {
    out = vs.flatMap((v) => {
      if (!isSap(v) || !hasDims(v)) return [v];
      // 1) l'article lui-même a déjà été expédié avec cette quantité
      const same = own.find((o) => o.qtyPerPackage === v.qtyPerPackage);
      // caisse ou palette réellement expédiée : c'est elle qui fait foi (la fiche SAP décrit l'article, pas le colis)
      if (same && packClass(same.packageType) !== 'carton') return [];
      if (same) return [{ ...v, packageType: CLASS_LABEL[packClass(same.packageType)] }];
      if (v.qtyPerPackage !== 1) return [v];
      // 2) la famille, à poids comparable
      const peers = fam
        .get(familyKey(item.description))
        .filter((p) => p.item.id !== item.id && p.real.grossWeightPerUnit > 0 && v.grossWeightPerUnit / p.real.grossWeightPerUnit <= 2.5 && v.grossWeightPerUnit / p.real.grossWeightPerUnit >= 0.4);
      if (peers.length) {
        const votes: Record<PackClass, number> = { crate: 0, pallet: 0, carton: 0 };
        for (const p of peers) votes[packClass(p.real.packageType)] += p.real.count || 1;
        const cls = (Object.keys(votes) as PackClass[]).sort((a, b) => votes[b] - votes[a])[0];
        // écart réel fiche SAP → colis expédié, sur un article de la famille qui a les deux
        const pair = peers.find((p) => p.sap && packClass(p.real.packageType) === cls);
        if (pair && cls !== 'carton') {
          const [a, b] = [sorted(pair.sap!), sorted(pair.real)];
          // marge ajoutée à chaque cote selon son rang (la plus grande avec la plus grande…), orientation d'origine conservée
          const dims = [v.length, v.width, v.height];
          const rank = dims.map((x, i) => dims.filter((y, j) => y > x || (y === x && j < i)).length);
          const grown = dims.map((x, i) => Math.round(x + Math.min(Math.max(0, b[rank[i]] - a[rank[i]]), x * 0.35)));
          const tare = Math.max(0, pair.real.grossWeightPerUnit - pair.sap!.grossWeightPerUnit);
          note = `${pair.item.code} ${pair.item.description} (${CLASS_LABEL[cls].toLowerCase()} estimée, même famille)`;
          return [{ ...v, packageType: CLASS_LABEL[cls], length: grown[0], width: grown[1], height: grown[2], volumePerPackage: (grown[0] * grown[1] * grown[2]) / 1e6, grossWeightPerUnit: Math.round((v.grossWeightPerUnit + Math.min(tare, v.grossWeightPerUnit * 0.25)) * 100) / 100, dimsInferred: false }];
        }
        return [{ ...v, packageType: CLASS_LABEL[cls] }];
      }
      // 3) règles physiques
      const long = Math.max(v.length, v.width, v.height) >= 150 && Math.min(v.length, v.width, v.height) <= 45;
      if (v.grossWeightPerUnit >= 400 || (long && v.grossWeightPerUnit >= 60)) return [{ ...v, packageType: 'Caisse' }];
      return [v];
    });
  }
  if (!out.length) return item;
  const pref = preferredVariant(out);
  const res: CatalogItem = { ...applyVariant({ ...item, variants: out }, pref), variants: out };
  if (note && pref.source === SAP_SOURCE && !res.similarFrom) res.similarFrom = note;
  return res;
}
