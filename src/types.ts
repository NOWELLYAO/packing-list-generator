/** Un article de référence, extrait des Packing Lists chargées. */
export interface CatalogItem {
  id: string;
  code: string; // Code article
  pn: string; // Part Number
  description: string;
  unit: string; // PCS, SET, KG...
  /** Nombre d'unités par colis (carton, caisse, palette) */
  qtyPerPackage: number;
  packageType: string; // Carton, Caisse, Palette...
  /** Dimensions d'un colis, en cm */
  length: number;
  width: number;
  height: number;
  /** Volume d'un colis en m³ si pas de dimensions (sinon calculé) */
  volumePerPackage: number;
  /** Poids net par unité, kg */
  netWeightPerUnit: number;
  /** Poids brut par unité, kg (emballage inclus) */
  grossWeightPerUnit: number;
  hsCode: string;
  origin: string;
  source: string; // fichier d'origine
  /** valeurs estimées à partir d'un colis partagé avec d'autres articles */
  mixed?: boolean;
  /** L × l × H reconstitués à partir du volume (dimensions illisibles sur la PL) */
  dimsInferred?: boolean;
  /** emballage repris d'un article similaire (l'article n'a été vu qu'en colis partagé) */
  similarFrom?: string;
  /** emballage en cours repris d'un article jumeau (calcul interne) */
  twinFrom?: string;
  /** origine de l'emballage en cours (calcul interne) */
  packSource?: string;
  /** toutes les configurations d'emballage observées dans les PL importées */
  variants?: PackVariant[];
  /** fiche corrigée à la main : ses valeurs priment sur les variantes */
  manual?: boolean;
  /** codes des articles avec lesquels Grundfos l'a déjà mis dans un même colis */
  coPacked?: string[];
  /** colis mixte : part du colis occupée par cet article (0–1, au prorata des quantités) */
  packShare?: number;
  /** (calcul) hauteurs réelles observées pour d'autres quantités sur le même emballage */
  heightAnchors?: { n: number; h: number }[];
  /** colis d'une seule unité connu (carton individuel) : sert aux reliquats et aux palettes incomplètes (calcul interne) */
  unitBox?: { l: number; w: number; h: number; net: number; gross: number };
  updatedAt: string;
}

/** Une configuration d'emballage observée pour un article */
export interface PackVariant {
  qtyPerPackage: number;
  packageType: string;
  length: number;
  width: number;
  height: number;
  volumePerPackage: number;
  netWeightPerUnit: number;
  grossWeightPerUnit: number;
  mixed: boolean;
  /** colis mixte : part du colis occupée par l'article */
  packShare?: number;
  source: string;
  /** nombre de fois où cette configuration a été vue */
  count: number;
  /** L × l × H reconstitués à partir du volume */
  /** emballage repris d'un article jumeau (même produit, autre variante) : à vérifier */
  twinOf?: string;
  dimsInferred?: boolean;
}

/** Champs reconnus lors de l'import d'un PL */
export type FieldKey =
  | 'code'
  | 'pn'
  | 'description'
  | 'quantity'
  | 'unit'
  | 'packages'
  | 'packageType'
  | 'dimensions'
  | 'length'
  | 'width'
  | 'height'
  | 'netWeight'
  | 'grossWeight'
  | 'volume'
  | 'hsCode'
  | 'origin';

export type Mapping = Partial<Record<FieldKey, number>>; // field -> index de colonne

export type WeightBasis = 'line' | 'unit' | 'package';
export type DimUnit = 'auto' | 'mm' | 'cm' | 'm';

export interface ImportOptions {
  weightBasis: WeightBasis;
  dimUnit: DimUnit;
}

export interface ParsedTable {
  name: string; // nom de feuille / page
  rows: string[][];
}

export interface ImportDraft {
  fileName: string;
  tables: ParsedTable[];
  tableIndex: number;
  headerRow: number;
  mapping: Mapping;
  options: ImportOptions;
}

/** Ligne saisie par l'utilisateur pour générer un PL */
export interface RequestLine {
  id: string;
  code: string;
  pn: string;
  quantity: number;
}

/** Ligne article de la Packing List générée */
export interface PLLine {
  lineNo: number;
  code: string;
  pn: string;
  description: string;
  quantity: number;
  unit: string;
  /** n° des colis contenant l'article, ex. "1-3" ou "5" */
  cases: string;
  netWeight: number;
  grossWeight: number;
  hsCode: string;
  origin: string;
  found: boolean;
  warning?: string;
  /** emballage retenu quand plusieurs configurations existent, ex. "6 / PALPLATE" */
  packing?: string;
  /** fiabilité : déjà expédié tel quel, interpolé, estimé, colis mixte, saisie manuelle */
  confidence?: 'observed' | 'interpolated' | 'estimated' | 'mixed' | 'manual';
}

/** Colis physique (palette, caisse, carton) avec ses dimensions calculées */
export interface PLPackage {
  no: number;
  type: string;
  length: number; // cm
  width: number;
  height: number;
  volume: number; // m3
  netWeight: number;
  grossWeight: number;
  contents: { code: string; quantity: number }[];
  /** comment les dimensions ont été obtenues */
  basis: 'reference' | 'partial' | 'grouped';
  /** regroupement : 'history' = articles déjà réunis par Grundfos dans un même colis ; 'rule' = petits articles réunis */
  groupSource?: 'history' | 'rule';
  /** pour le dessin : nombre d'unités posées sur la palette et forme des articles (longs : pompes immergées, moteurs) */
  load?: LoadHint;
  /** dimensions à vérifier : 'inferred' = reconstituées à partir du volume, 'estimated' = calculées (jamais expédié ainsi) */
  dimCheck?: 'inferred' | 'estimated';
  /** gerbable (un colis peut être posé dessus) : choix de l'utilisateur ; absent = règle automatique */
  stackable?: boolean;
}

export interface LoadHint {
  units: number;
  long: boolean;
}

export interface GenerateOptions {
  /** regrouper les petits articles sur un carton / une palette commune */
  consolidate: boolean;
  /** 'grundfos' : uniquement les emballages réellement utilisés par le fournisseur ; 'smart' (défaut) : proposition optimisée */
  strategy?: 'grundfos' | 'smart';
  /** proposition « selon Grundfos » : reproduire ses regroupements (défaut : oui) */
  grundfosGrouping?: boolean;
  /** référence libre (facultative) affichée sur le document */
  reference?: string;
}

export interface PackingList {
  date: string;
  reference: string;
  lines: PLLine[];
  packages: PLPackage[];
  totals: {
    quantity: number;
    packages: number;
    netWeight: number;
    grossWeight: number;
    volume: number;
  };
}

/** Réglages de mise en forme des documents */
export interface Settings {
  companyName: string;
  /** logo en data URL (PNG/JPEG), importé par l'utilisateur */
  logo: string;
  /** palette de couleurs des documents */
  accent: string;
  /** langue des documents et des libellés d'emballage */
  lang?: 'fr' | 'en';
  /** mode de transport retenu pour le plan de chargement et les indicateurs */
  transportMode?: 'sea' | 'road' | 'air';
  /** tarifs de fret (estimation du coût par mode de transport) */
  freightRates?: FreightRates;
  /** plan de chargement : gerber les colis (oui par défaut) */
  stacking?: boolean;
  /** dossier export : vendeur, conditions, devise, prix unitaires */
  exportDoc?: ExportDocSettings;
  /** étiquettes de colis : derniers réglages utilisés */
  labels?: { format: 'a6' | '100x150'; marking: string; reference: string; fragile: boolean; noStack: boolean; twoForLarge?: boolean };
}

/** PL générée, conservée dans l'historique */
export interface HistoryEntry {
  id: string;
  createdAt: string;
  reference: string;
  requests: RequestLine[];
  totals: PackingList['totals'];
  /** réglages utilisés lors de l'export, restaurés à la réouverture */
  proposal?: 'grundfos' | 'smart';
  lang?: 'fr' | 'en';
  transportMode?: 'sea' | 'road' | 'air';
}

/** Modification de la base proposée par un utilisateur, en attente de validation par l'administrateur */
export interface PendingChange {
  id: string;
  at: string;
  by: { id: string; name: string };
  /** ex. « Modification de la fiche 96510206 », « Import de 35433112.pdf » */
  label: string;
  /** fiches ajoutées ou modifiées, telles que proposées */
  upserts: CatalogItem[];
  /** fiches supprimées (clé code|PN) avec leur désignation */
  removals: { key: string; code: string; description: string }[];
}

/** Tarifs de fret saisis par l'utilisateur (montants dans la devise choisie) */
export interface FreightRates {
  currency: string;
  airPerKg: number;
  airMin: number;
  lclPerUp: number;
  lclMin: number;
  /** prix par conteneur, par id de véhicule (20, 40, 40hc…) */
  container: Record<string, number>;
  courierPerKg: number;
  courierMin: number;
  /** prix par camion dédié, par id de véhicule */
  truck: Record<string, number>;
  /** l'utilisateur a saisi ses propres tarifs */
  custom?: boolean;
}

export interface ExportDocSettings {
  seller: string;
  buyer: string;
  incoterm: string;
  currency: string;
  payment: string;
  /** prix unitaires connus, par code article */
  prices: Record<string, number>;
}
