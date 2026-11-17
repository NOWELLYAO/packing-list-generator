import type { CatalogItem } from '../types';
import { load, save } from './storage';

/** Télécharge la base d'articles en JSON et mémorise la date de sauvegarde */
export function downloadCatalogBackup(catalog: CatalogItem[]) {
  const blob = new Blob([JSON.stringify(catalog)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `base_articles_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  save('lastBackup', Date.now());
}

const DAY = 86_400_000;

/** Nombre de jours depuis la dernière sauvegarde (null = jamais) */
export function daysSinceBackup(): number | null {
  const t = load<number>('lastBackup', 0);
  return t ? Math.floor((Date.now() - t) / DAY) : null;
}

/** Rappel affiché si la base n'a pas été sauvegardée depuis 14 jours (masquable 7 jours) */
export function backupReminderDue(catalogSize: number): boolean {
  if (catalogSize < 10) return false;
  const snoozed = load<number>('backupSnooze', 0);
  if (snoozed && Date.now() - snoozed < 7 * DAY) return false;
  const d = daysSinceBackup();
  return d === null || d >= 14;
}

export const snoozeBackupReminder = () => save('backupSnooze', Date.now());
