import type { CatalogItem, PackVariant } from '../types';
import { applyVariant, mergeVariants, preferredVariant, variantOf } from './variants';
import { round } from './parseValues';
import { uid } from './normalize';

/**
 * Lecteur des Packing Lists au format SAP (Grundfos et similaires) :
 *
 *   Hand. unit:  Delivery:   Pack.:   Gross wt. KG.  Nett. wt. KG:  Vol.M3:  Dimens. CM:
 *   Pos: Material: Description: Cust. mat. no.: [Net Wt/KG.] Qty: Cust. order no.: Sales order:
 *
 *   657086010004 2024356374 CRATE   1.648,000  1.608,000  7,020  120X260X225     <- colis (HU)
 *   0010 99843986 Hydro EN 80-250            0,500  PO-A16-1734  14701353       <- article(s) du colis
 *        Country of Origin: IT - Italy
 *
 * Fonctionne sur le texte d'un PDF ou sur le résultat d'un OCR (tolère les erreurs courantes).
 */

export interface SapHU {
  hu: string;
  packType: string;
  gross: number;
  net: number;
  volume: number; // m3
  dims: { l: number; w: number; h: number } | null; // cm
  positions: SapPosition[];
}

export interface SapPosition {
  pos: string;
  material: string;
  description: string;
  custMat: string;
  qty: number;
  origin: string;
}

export interface SapDocument {
  number: string;
  globalOrigin: string;
  hus: SapHU[];
  warnings: string[];
}

export function looksLikeSapPackingList(text: string): boolean {
  // version anglaise (Packing list) ou française (Note de colisage)
  return (
    /Hand\.?\s*unit|Colis\s*N[°o]/i.test(text) &&
    /Material|Mat[ée]riel/i.test(text) &&
    /(Gross|Nett?)\.?\s*wt|Poids\s*(Brut|Net)/i.test(text)
  );
}

/** Corrige les confusions OCR courantes dans un jeton censé être numérique */
function fixDigits(tok: string): string {
  if (!/\d/.test(tok)) return tok;
  return tok
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Ss§]/g, '5')
    .replace(/B/g, '8');
}

const NUM = /^\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?$|^\d+(?:[.,]\d+)?$/;
const DIMS = /([0-9OoSs§Il]{1,4})\s*[Xx×*]\s*([0-9OoSs§Il]{1,4})\s*[Xx×*]\s*([0-9OoSs§Il]{1,4})/;

/** Les nombres SAP ont toujours le séparateur décimal en dernier : "1.648,000", "164.000", "0,168" */
function sapNum(tok: string): number {
  const t = fixDigits(tok).replace(/[^\d.,]/g, '');
  const i = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  if (i === -1) return Number(t);
  return Number(t.slice(0, i).replace(/[.,]/g, '') + '.' + t.slice(i + 1));
}

/** Dernières dimensions de la ligne (colonne "Dimens. CM"), l'emballage pouvant contenir "340x225x" */
function lastDims(s: string): { m: RegExpMatchArray | null } {
  const all = [...s.matchAll(new RegExp(DIMS.source, 'g'))];
  return { m: all.length ? all[all.length - 1] : null };
}

function parseDims(s: string) {
  const { m } = lastDims(s);
  if (!m) return null;
  const [l, w, h] = [m[1], m[2], m[3]].map((x) => Number(fixDigits(x)));
  if (![l, w, h].every((n) => Number.isFinite(n) && n >= 5)) return null; // "1X0X1" = non renseigné
  return { l, w, h };
}

// Colis : n° HU (6-20 chiffres) + n° livraison (10 chiffres) + emballage + poids...
const HU_RE = /^(?:\S{1,3}\s+)?(\d{6,20})\s+(\d{10})\b(.*)$/;
// Article : position (4 chiffres) + matériel (7-9 chiffres) + reste
const POS_RE = /^(?:\S{1,2}\s+)?([0-9O]{4})\s+((?=(?:[A-Z]*\d){5})[0-9A-Z]{7,9})\s+(.*)$/;

function cleanLine(l: string) {
  return l.replace(/[—–|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseHuRest(rest: string) {
  const dims = parseDims(rest);
  const { m } = lastDims(rest);
  const noDims = m && m.index !== undefined ? rest.slice(0, m.index) : rest;
  const tokens = noDims.split(' ').filter(Boolean);
  const nums: number[] = [];
  const typeTokens: string[] = [];
  for (const t of tokens) {
    const f = fixDigits(t.replace(/[^\dA-Za-z.,§]/g, ''));
    if (NUM.test(f) && /[.,]\d{3}$/.test(f)) nums.push(sapNum(f));
    else if (nums.length === 0) typeTokens.push(t);
  }
  // le type d'emballage contient parfois des dimensions de carton ("480 x 38")
  const packType = typeTokens
    .map((t) => t.replace(/[^\w/-]/g, ''))
    .filter((t) => t.length >= 3 || /^\d+$|^x$/i.test(t))
    .join(' ')
    .trim();
  return { packType, gross: nums[0] ?? NaN, net: nums[1] ?? NaN, volume: nums[2] ?? NaN, dims };
}

function parsePosRest(rest: string): { description: string; custMat: string; qty: number; lineNet: number; orderTail: string } {
  const tokens = rest.split(' ').filter(Boolean);
  // Retirer le n° de commande client et le n° de commande de vente en fin de ligne
  let end = tokens.length;
  if (end > 0 && /^\d{7,10}$/.test(fixDigits(tokens[end - 1]))) end--; // sales order
  // quantité = dernier jeton numérique "court" (<= 5 chiffres avant la virgule)…
  let qIdx = -1;
  // …sauf si un n° de commande client en texte suit la quantité (« 7 N° HY 0010 CN 2026 ») :
  // la quantité est alors le nombre placé juste avant « N° » / « No » / « PO »
  for (let i = 0; i < end - 1; i++) {
    const f = fixDigits(tokens[i]).replace(/\.$/, '');
    if (/^\d{1,5}(?:[.,]\d{1,3})?$/.test(f) && /^(N°?|N\.?°|No\.?|Nr\.?|PO|P\.O\.?|°)$/i.test(tokens[i + 1]) && i > 0) {
      qIdx = i;
      break;
    }
  }
  if (qIdx === -1) for (let i = end - 1; i >= 0; i--) {
    const f = fixDigits(tokens[i]).replace(/\.$/, '');
    if (/^\d{1,5}(?:[.,]\d{1,3})?$/.test(f)) {
      qIdx = i;
      break;
    }
  }
  if (qIdx === -1) return { description: tokens.slice(0, end).join(' '), custMat: '', qty: NaN, lineNet: NaN, orderTail: '' };
  const qty = sapNum(tokens[qIdx].replace(/\.$/, ''));
  let descTokens = tokens.slice(0, qIdx);
  // poids net de ligne éventuel juste avant la quantité (colonne "Net Wt/KG.")
  let lineNet = NaN;
  const last = descTokens[descTokens.length - 1];
  if (last && /^\d+[.,]\d{3}$/.test(last)) {
    lineNet = sapNum(last);
    descTokens = descTokens.slice(0, -1);
  }
  const orderTail = tokens.slice(qIdx + 1, end).join(' ');
  return { description: descTokens.join(' ').replace(/\s*[.:,;]$/, ''), custMat: '', qty, lineNet, orderTail };
}

export function parseSapPackingList(rawLines: string[]): SapDocument {
  const doc: SapDocument = { number: '', globalOrigin: '', hus: [], warnings: [] };
  let hu: SapHU | null = null;
  let lastPos: SapPosition | null = null;
  let lastOrderTail = '';
  let inTable = false;

  for (const raw of rawLines) {
    const line = cleanLine(raw);
    if (!line) continue;
    const num = line.match(/(?:Packing\s*list(?:\s*shipment)?|Note\s*de\s*colisage)\s*(\d{6,12})/i);
    if (num && !doc.number) doc.number = num[1];
    const go = line.match(/COUNTRY OF ORIGIN\s*[:;]\s*([A-Z][A-Za-z ]+)$/);
    if (go && !hu) doc.globalOrigin = go[1].trim();

    if (/Hand\.?\s*unit|^Colis\s*N[°o]/i.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/^Total\s*HU/i.test(line)) {
      inTable = false;
      hu = null;
      lastPos = null;
      continue;
    }
    if (/^Pos\b|^Poste|Cust\.?\s*ord|R[ée]f\.?\s*Cde|^no\.?:?$|^livraison|^client\b|^KG/i.test(line)) continue;

    const coo = line.match(/Country\s*of\s*Origin\s*[:;]?\s*([A-Z]{2})\b/i);
    if (coo) {
      if (lastPos) lastPos.origin = coo[1].toUpperCase();
      continue;
    }

    const pm = line.match(POS_RE);
    if (pm && hu) {
      const { description, qty, lineNet, orderTail } = parsePosRest(pm[3]);
      lastOrderTail = orderTail;
      const p: SapPosition = {
        pos: fixDigits(pm[1]),
        material: fixDigits(pm[2]),
        description,
        custMat: '',
        qty,
        origin: '',
      };
      if (!Number.isFinite(qty)) doc.warnings.push(`Quantité illisible : ${p.material} ${description}`);
      void lineNet;
      hu.positions.push(p);
      lastPos = p;
      continue;
    }

    const hm = line.match(HU_RE);
    if (hm && !/^\d{4}$/.test(hm[1])) {
      const r = parseHuRest(hm[3]);
      hu = { hu: hm[1], ...r, positions: [] };
      doc.hus.push(hu);
      lastPos = null;
      continue;
    }

    // Suite de description (ligne courte juste après un article)
    if (/Packing\s*list|Note\s*de\s*colisage|^Page\b/i.test(line)) continue;
    // suite d'une réf. de commande en mots ("PROJECT" / "DANGA" / "PARK") : ce n'est pas la désignation
    if (/^[A-Z]{3,}$/.test(lastOrderTail) && /^[A-Z]+$/.test(line)) continue;
    if (lastPos && !/^\d{5,}$/.test(line) && !/:/.test(line)) {
      // retirer les morceaux de n° de commande client ("1734-SEG", "_Civ-Os", "0826cim_Civ-")
      const kept = line
        .split(' ')
        .filter((t) => !/^\d+[-_/]|[-_]$|^[-_]|^PO-|^N°|cim|civ|^Os$|SEG$/i.test(t) && /[A-Za-z0-9(]/.test(t));
      const extra = kept.join(' ');
      if (extra.length >= 2 && extra.length <= 24 && /^[A-Z0-9(]/.test(extra)) lastPos.description += ' ' + extra;
      lastPos = null; // une seule ligne de suite
    }
  }
  return doc;
}

/** Une observation (article dans un colis) -> fiche catalogue */
export interface SapObservation {
  item: CatalogItem;
  mixed: boolean; // colis partagé avec d'autres articles
}

export function sapToCatalog(doc: SapDocument, source: string): SapObservation[] {
  const out: SapObservation[] = [];
  const now = new Date().toISOString();
  for (const hu of doc.hus) {
    const positions = hu.positions.filter((p) => Number.isFinite(p.qty) && p.qty > 0);
    if (!positions.length) continue;
    const totalQty = positions.reduce((s, p) => s + p.qty, 0);
    const mixed = new Set(positions.map((p) => p.material)).size > 1;
    // le même article peut apparaître sur plusieurs positions d'un colis : on regroupe
    const byMat = new Map<string, SapPosition & { qty: number }>();
    for (const p of positions) {
      const prev = byMat.get(p.material);
      if (prev) prev.qty += p.qty;
      else byMat.set(p.material, { ...p });
    }
    const volFromDims = hu.dims ? (hu.dims.l * hu.dims.w * hu.dims.h) / 1e6 : 0;
    const matsInHu = [...byMat.keys()];
    for (const p of byMat.values()) {
      const share = p.qty / totalQty;
      const gross = Number.isFinite(hu.gross) ? hu.gross * share : 0;
      const net = Number.isFinite(hu.net) ? hu.net * share : gross;
      out.push({
        mixed,
        item: {
          id: uid(),
          code: p.material,
          pn: p.material,
          description: p.description
            .replace(/\s+/g, ' ')
            .replace(/^[^A-Za-z0-9(]+/, '') // bruit OCR en début ("$L1.50…")
            .replace(/[\s:;.,’‘'"_|]+$/, '') // et en fin (" : .", " ’")
            .trim(),
          unit: 'PCS',
          // colis partagé : l'article occupe au moins un colis entier
          qtyPerPackage: round(mixed ? p.qty : p.qty, 4),
          packageType: hu.packType || 'Colis',
          length: hu.dims?.l ?? 0,
          width: hu.dims?.w ?? 0,
          height: hu.dims?.h ?? 0,
          volumePerPackage: !hu.dims && Number.isFinite(hu.volume) ? round(hu.volume, 4) : round(volFromDims, 4),
          netWeightPerUnit: round(net / p.qty, 4),
          grossWeightPerUnit: round(gross / p.qty, 4),
          hsCode: '',
          origin: p.origin || doc.globalOrigin,
          source: `${source}${doc.number ? ` (PL ${doc.number})` : ''}${mixed ? ' – colis mixte' : ''}`,
          updatedAt: now,
          mixed,
          // articles mis dans le même colis par Grundfos (sert à reproduire ses regroupements)
          coPacked: mixed ? matsInHu.filter((m) => m !== p.material) : undefined,
          packShare: mixed ? round(share, 4) : undefined,
        },
      });
    }
  }
  return out;
}

/**
 * Regroupe les observations d'un fichier par article : chaque configuration de colis
 * devient une variante d'emballage (la fusion dans le catalogue choisit la référence).
 */
export function bestObservations(obs: SapObservation[]): CatalogItem[] {
  const groups = new Map<string, SapObservation[]>();
  for (const o of obs) groups.set(o.item.pn, [...(groups.get(o.item.pn) ?? []), o]);
  const result: CatalogItem[] = [];
  for (const list of groups.values()) {
    const variants = list.reduce<PackVariant[]>((acc, o) => mergeVariants(acc, [variantOf(o.item)]), []);
    const desc = list.map((o) => o.item.description).sort((a, b) => b.length - a.length)[0];
    const origin = list.map((o) => o.item.origin).find(Boolean) ?? '';
    const coPacked = [...new Set(list.flatMap((o) => o.item.coPacked ?? []))];
    const base = applyVariant(
      { ...list[0].item, description: desc, origin, variants, coPacked: coPacked.length ? coPacked : undefined },
      preferredVariant(variants),
    );
    result.push(base);
  }
  return result;
}
