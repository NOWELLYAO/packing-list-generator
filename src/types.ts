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
  /** toutes les configurations d'emballage observées dans les PL importées */
  variants?: PackVariant[];
  /** fiche corrigée à la main : ses valeurs priment sur les variantes */
  manual?: boolean;
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
  source: string;
  /** nombre de fois où cette configuration a été vue */
  count: number;
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
}

export interface GenerateOptions {
  /** regrouper les petits articles sur un carton / une palette commune */
  consolidate: boolean;
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
}

/** PL générée, conservée dans l'historique */
export interface HistoryEntry {
  id: string;
  createdAt: string;
  reference: string;
  requests: RequestLine[];
  totals: PackingList['totals'];
}
