import { createContext, useContext } from 'react';

export type Lang = 'fr' | 'en';

/**
 * Libellés d'emballage : les PL fournisseurs utilisent des codes SAP en anglais
 * (PALPLATE, CRATE, Half eur, 480 x 38…). On les traduit à l'affichage,
 * la donnée d'origine reste intacte dans la base.
 */
const PACK_RULES: { re: RegExp; fr: string; en: string }[] = [
  { re: /^carton group/i, fr: 'Carton groupé', en: 'Consolidated carton' },
  { re: /^demi-palette group/i, fr: 'Demi-palette groupée', en: 'Consolidated half pallet' },
  { re: /^palette group/i, fr: 'Palette groupée', en: 'Consolidated pallet' },
  { re: /^palette [ée]troite/i, fr: 'Palette étroite', en: 'Narrow pallet (skid)' },
  { re: /^carton\s*(pa|sur)/i, fr: 'Carton sur palette', en: 'Carton on pallet' },
  { re: /^pal\s*plate/i, fr: 'Palette à plateau', en: 'Pallet with top plate' },
  { re: /^(half|demi-?\s*palette)/i, fr: 'Demi-palette', en: 'Half pallet' },
  { re: /^euro/i, fr: 'Palette Europe', en: 'Euro pallet' },
  { re: /^p*pal(let|ette)?\b|^pal(let|ette)/i, fr: 'Palette', en: 'Pallet' },
  { re: /^(crate|caisse)/i, fr: 'Caisse', en: 'Crate' },
  { re: /^sans emb/i, fr: 'Sans emballage', en: 'Unpacked' },
  { re: /^plywood/i, fr: 'Caisse contreplaqué', en: 'Plywood case' },
  { re: /^wood/i, fr: 'Caisse bois', en: 'Wooden case' },
  { re: /^pre-?\s*pack/i, fr: "Emballage d'origine", en: 'Original packaging' },
  { re: /^(box|carton)|^\d{2,4}\s*x\s*\d{0,4}/i, fr: 'Carton', en: 'Carton' },
  { re: /^colis$/i, fr: 'Colis', en: 'Package' },
];

/** cote en cm au format de la langue : 32,7 (fr) / 32.7 (en), une décimale au plus */
export const dimNum = (n: number, lang: Lang = 'fr') => n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 1 });
export const dimsText = (l: number, w: number, h: number, lang: Lang = 'fr', sep = ' × ') => [l, w, h].map((x) => dimNum(x, lang)).join(sep);

export function packLabel(raw: string, lang: Lang): string {
  const s = (raw || '').trim();
  for (const r of PACK_RULES) if (r.re.test(s)) return r[lang];
  // codes illisibles (OCR) ou génériques
  return lang === 'fr' ? 'Colis' : 'Package';
}

/** Textes des documents PDF / Excel */
export const DOC = {
  fr: {
    title: 'PACKING LIST',
    date: 'Date',
    ref: 'Réf.',
    packages: 'Colis',
    net: 'Poids net',
    gross: 'Poids brut',
    volume: 'Volume',
    packing: 'COLISAGE',
    articles: 'ARTICLES',
    no: 'N°',
    packType: 'Emballage',
    dims: 'Dimensions L × l × H (cm)',
    dimsShort: 'L × l × H (cm)',
    vol: 'Vol. (m3)',
    volXl: 'Volume (m³)',
    netKg: 'Net (kg)',
    grossKg: 'Brut (kg)',
    contents: 'Contenu',
    codePn: 'Code / PN',
    code: 'Code article',
    pn: 'PN',
    description: 'Désignation',
    qty: 'Qté',
    caseNo: 'Colis N°',
    origin: 'Orig.',
    originLong: 'Origine',
    total: 'TOTAL',
    nPackages: (n: number) => `${n} colis`,
    grouped: 'groupé',
    partial: 'incomplet',
    footer: (d: string) => `Packing List du ${d}`,
    page: (i: number, n: number) => `Page ${i} / ${n}`,
    netKgLong: 'Poids net (kg)',
    grossKgLong: 'Poids brut (kg)',
    schemas: 'SCHÉMAS DES COLIS',
    scaleView: 'Vue de face à la même échelle (repère : silhouette de 1,80 m)',
    loadPlan: 'PLAN DE CHARGEMENT',
    dimNote: '≈ en orange : dimensions à vérifier (reconstituées à partir du volume, reprises d’un article similaire ou calculées pour une quantité jamais expédiée ainsi).',
    loadNote: 'Vue 3D (véhicule ouvert) et vue de dessus, colis posés au sol sans gerbage. Point rouge : centre de gravité. Dimensions des véhicules indicatives.',
    vehicle: 'Transport proposé',
    floorUsed: 'Plancher occupé',
    lengthUsed: 'Longueur utilisée',
    ldm: 'Mètres de plancher (LDM)',
    cog: 'Centre de gravité',
    unit: 'unité(s)',
    reliability: 'Fiabilité',
    conf: { observed: 'Déjà expédié', interpolated: 'Interpolé', estimated: 'Estimé', mixed: 'Colis mixte', manual: 'Fiche manuelle', unknown: 'Introuvable' } as Record<string, string>,
    locale: 'fr-FR',
  },
  en: {
    title: 'PACKING LIST',
    date: 'Date',
    ref: 'Ref.',
    packages: 'Packages',
    net: 'Net weight',
    gross: 'Gross weight',
    volume: 'Volume',
    packing: 'PACKAGES',
    articles: 'ITEMS',
    no: 'No.',
    packType: 'Packaging',
    dims: 'Dimensions L × W × H (cm)',
    dimsShort: 'L × W × H (cm)',
    vol: 'Vol. (m3)',
    volXl: 'Volume (m³)',
    netKg: 'Net (kg)',
    grossKg: 'Gross (kg)',
    contents: 'Contents',
    codePn: 'Item code / PN',
    code: 'Item code',
    pn: 'PN',
    description: 'Description',
    qty: 'Qty',
    caseNo: 'Package No.',
    origin: 'Orig.',
    originLong: 'Origin',
    total: 'TOTAL',
    nPackages: (n: number) => `${n} package${n > 1 ? 's' : ''}`,
    grouped: 'consolidated',
    partial: 'partial',
    footer: (d: string) => `Packing List dated ${d}`,
    page: (i: number, n: number) => `Page ${i} of ${n}`,
    netKgLong: 'Net weight (kg)',
    grossKgLong: 'Gross weight (kg)',
    schemas: 'PACKAGE DRAWINGS',
    scaleView: 'Front view at the same scale (reference: 1.80 m silhouette)',
    loadPlan: 'LOADING PLAN',
    dimNote: '≈ in orange: dimensions to be checked (rebuilt from the volume, taken from a similar item, or calculated for a quantity never shipped this way).',
    loadNote: '3D view (open vehicle) and top view, packages on the floor, not stacked. Red dot: centre of gravity. Vehicle sizes are indicative.',
    vehicle: 'Proposed transport',
    floorUsed: 'Floor used',
    lengthUsed: 'Length used',
    ldm: 'Loading metres (LDM)',
    cog: 'Centre of gravity',
    unit: 'unit(s)',
    reliability: 'Reliability',
    conf: { observed: 'Shipped as is before', interpolated: 'Interpolated', estimated: 'Estimated', mixed: 'Mixed package', manual: 'Manual data', unknown: 'Not found' } as Record<string, string>,
    locale: 'en-GB',
  },
};

export const LangContext = createContext<Lang>('fr');
export const useLang = () => useContext(LangContext);
