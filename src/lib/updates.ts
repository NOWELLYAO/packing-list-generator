/**
 * Gestion des mises à jour de l'application.
 *
 * À chaque déploiement, les fichiers JavaScript changent de nom. Un onglet resté ouvert
 * sur l'ancienne version ne trouve plus certains modules chargés à la demande
 * (générateur PDF, Excel, OCR) → erreur « error loading dynamically imported module ».
 * - si un module manque : rechargement automatique (une seule fois) ;
 * - en revenant sur l'onglet : on vérifie si une nouvelle version est en ligne.
 * La PL en cours, la base et les réglages sont dans le navigateur : rien n'est perdu.
 */

const RELOAD_KEY = 'plgen:reloaded-at';

export function isChunkLoadError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return /dynamically imported module|Failed to fetch dynamically|Importing a module script failed|error loading dynamically|ChunkLoadError|Unable to preload CSS/i.test(msg);
}

/** Recharge la page, sans boucler si le problème persiste */
export function reloadForUpdate(): boolean {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < 30_000) return false;
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

/** Script principal de la version actuellement chargée */
const currentEntry = () =>
  [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => new URL(s.src).pathname).find((p) => p.includes('/assets/index-'));

/** Une version plus récente est-elle en ligne ? */
export async function newVersionAvailable(): Promise<boolean> {
  const mine = currentEntry();
  if (!mine) return false; // mode développement
  try {
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const html = await res.text();
    const m = html.match(/\/assets\/index-[\w-]+\.js/);
    return !!m && m[0] !== mine;
  } catch {
    return false;
  }
}

import { registerSW } from 'virtual:pwa-register';

/** Active la nouvelle version (service hors ligne) puis recharge ; à défaut, simple rechargement */
let applyUpdate: (() => Promise<void>) | null = null;
export async function updateNow() {
  if (applyUpdate) await applyUpdate();
  else window.location.reload();
}

export function installUpdateHandlers(onNewVersion: () => void) {
  // Service hors ligne : l'application reste utilisable sans réseau une fois ouverte une première fois
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const update = registerSW({
      onNeedRefresh: () => onNewVersion(),
      onOfflineReady: () => {},
    });
    applyUpdate = () => update(true);
  }
  // Vite signale ici l'échec de chargement d'un module à la demande
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForUpdate()) event.preventDefault();
  });
  const check = async () => {
    if (document.visibilityState === 'visible' && (await newVersionAvailable())) onNewVersion();
  };
  document.addEventListener('visibilitychange', () => void check());
  window.setInterval(() => void check(), 10 * 60 * 1000);
}
