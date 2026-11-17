import { createContext, useContext } from 'react';
import type { CatalogItem } from '../types';
import { load, save } from './storage';

/* ------------------------------------------------------------------ */
/* Sauvegardes automatiques de la base avant toute action destructrice */
/* ------------------------------------------------------------------ */

export interface Snapshot {
  id: string;
  createdAt: string;
  reason: string;
  catalog: CatalogItem[];
}

const KEY = 'catalog_snapshots';
const MAX = 3;

export function listSnapshots(): Snapshot[] {
  return load<Snapshot[]>(KEY, []);
}

/** Enregistre une copie de la base (les 3 plus récentes sont gardées) */
export function snapshotCatalog(catalog: CatalogItem[], reason: string) {
  if (!catalog.length) return;
  const snaps = listSnapshots();
  const entry: Snapshot = { id: Date.now().toString(36), createdAt: new Date().toISOString(), reason, catalog };
  save(KEY, [entry, ...snaps].slice(0, MAX));
}

/* ------------------------------------------------------------------ */
/* Confirmation et notifications avec « Annuler »                      */
/* ------------------------------------------------------------------ */

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  /** mot à recopier pour valider (actions irréversibles ou massives) */
  typeToConfirm?: string;
}

export interface Safety {
  /** demande une confirmation ; résout true si l'utilisateur valide */
  ask: (o: ConfirmOptions) => Promise<boolean>;
  /** message éphémère, avec bouton d'annulation optionnel */
  notify: (msg: string, undo?: () => void) => void;
}

export const SafetyContext = createContext<Safety>({
  ask: async () => false,
  notify: () => {},
});
export const useSafety = () => useContext(SafetyContext);
