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
  updatedAt: string;
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

export interface PLLine {
  lineNo: number;
  caseFrom: number;
  caseTo: number;
  code: string;
  pn: string;
  description: string;
  quantity: number;
  unit: string;
  packages: number;
  packageType: string;
  length: number;
  width: number;
  height: number;
  netWeight: number;
  grossWeight: number;
  volume: number; // m3
  hsCode: string;
  origin: string;
  found: boolean;
  warning?: string;
}

export interface PLHeader {
  plNumber: string;
  date: string;
  invoiceNumber: string;
  shipper: string;
  consignee: string;
  notify: string;
  transport: string;
  portLoading: string;
  portDischarge: string;
  marks: string;
  remarks: string;
}

export interface PackingList {
  header: PLHeader;
  lines: PLLine[];
  totals: {
    quantity: number;
    packages: number;
    netWeight: number;
    grossWeight: number;
    volume: number;
  };
}
