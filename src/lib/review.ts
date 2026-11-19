import type { CatalogItem, PendingChange } from '../types';
import { itemKey } from './normalize';

/**
 * Validation des modifications : quand la protection par code est active, un utilisateur qui n'est pas
 * administrateur ne modifie pas la base directement ; ses changements (édition, ajout, suppression, import)
 * deviennent une proposition que l'administrateur approuve, modifie ou refuse.
 */

const k = (i: CatalogItem) => itemKey(i.code, i.pn);
/** comparaison sans les champs purement techniques */
const sig = (i: CatalogItem) => JSON.stringify({ ...i, updatedAt: undefined, id: undefined });

/** différence entre la base actuelle et la base voulue par l'utilisateur */
export function diffCatalog(before: CatalogItem[], after: CatalogItem[]): Pick<PendingChange, 'upserts' | 'removals'> {
  const old = new Map(before.map((i) => [k(i), i]));
  const next = new Map(after.map((i) => [k(i), i]));
  const upserts = after.filter((i) => {
    const o = old.get(k(i));
    return !o || sig(o) !== sig(i);
  });
  const removals = before.filter((i) => !next.has(k(i))).map((i) => ({ key: k(i), code: i.code, description: i.description }));
  return { upserts, removals };
}

/** applique une proposition (ou une partie) à la base */
export function applyChange(catalog: CatalogItem[], c: Pick<PendingChange, 'upserts' | 'removals'>): CatalogItem[] {
  const gone = new Set(c.removals.map((r) => r.key));
  const map = new Map(catalog.filter((i) => !gone.has(k(i))).map((i) => [k(i), i]));
  const now = new Date().toISOString();
  for (const u of c.upserts) {
    const prev = map.get(k(u));
    map.set(k(u), { ...u, id: prev?.id ?? u.id, updatedAt: now });
  }
  return [...map.values()];
}

/** champs comparés dans l'écran de validation */
export const REVIEW_FIELDS: { key: keyof CatalogItem; label: string }[] = [
  { key: 'description', label: 'Désignation' },
  { key: 'qtyPerPackage', label: 'Qté/colis' },
  { key: 'packageType', label: 'Emballage' },
  { key: 'length', label: 'L' },
  { key: 'width', label: 'l' },
  { key: 'height', label: 'H' },
  { key: 'netWeightPerUnit', label: 'Net/u' },
  { key: 'grossWeightPerUnit', label: 'Brut/u' },
];

export function fieldChanges(before: CatalogItem | undefined, after: CatalogItem): { label: string; from: string; to: string }[] {
  if (!before) return [];
  const out = REVIEW_FIELDS.filter((f) => String(before[f.key] ?? '') !== String(after[f.key] ?? '')).map((f) => ({ label: f.label, from: String(before[f.key] ?? '—'), to: String(after[f.key] ?? '—') }));
  const vb = before.variants?.length ?? 0;
  const va = after.variants?.length ?? 0;
  if (vb !== va) out.push({ label: 'Emballages connus', from: String(vb), to: String(va) });
  return out;
}

/** fusion des files d'attente de deux appareils : union, sans les propositions déjà traitées */
export function mergePending(a: PendingChange[] = [], b: PendingChange[] = [], done: string[] = []): PendingChange[] {
  const gone = new Set(done);
  const m = new Map<string, PendingChange>();
  for (const p of [...b, ...a]) if (!gone.has(p.id)) m.set(p.id, p);
  return [...m.values()].sort((x, y) => x.at.localeCompare(y.at));
}
