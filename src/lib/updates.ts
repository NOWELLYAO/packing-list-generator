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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attend qu'un service worker passe à l'état voulu (ou abandonne après `ms`) */
function waitState(sw: ServiceWorker, states: string[], ms: number): Promise<boolean> {
  if (states.includes(sw.state)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    sw.addEventListener('statechange', () => {
      if (states.includes(sw.state)) {
        clearTimeout(t);
        resolve(true);
      } else if (sw.state === 'redundant') {
        clearTimeout(t);
        resolve(false);
      }
    });
  });
}

/** Recharge en contournant tout cache (adresse unique) */
function hardReload() {
  const url = new URL(window.location.href);
  url.searchParams.set('v', String(Date.now()));
  window.location.replace(url.toString());
}

/**
 * Passe à la nouvelle version, de façon fiable :
 * 1. le service hors ligne télécharge la nouvelle version si ce n'est pas déjà fait ;
 * 2. il l'active, puis la page se recharge ;
 * 3. à défaut (téléchargement bloqué, iPhone…), le service et ses caches sont effacés
 *    et la page est rechargée depuis le serveur.
 * La base d'articles, l'historique et les réglages (stockage du navigateur) ne sont pas touchés.
 */
export async function updateNow(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        let waiting = reg.waiting;
        if (!waiting) {
          await reg.update().catch(() => {});
          const installing = reg.installing;
          if (installing && (await waitState(installing, ['installed', 'activated'], 20_000))) waiting = reg.waiting;
          else waiting = reg.waiting;
        }
        if (waiting) {
          const switched = new Promise<boolean>((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true });
            setTimeout(() => resolve(false), 8_000);
          });
          waiting.postMessage({ type: 'SKIP_WAITING' });
          if (await switched) {
            hardReload();
            return;
          }
        }
        // repli : on repart de zéro (l'application se remet en cache au chargement suivant)
        await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
      }
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => /workbox|precache|runtime/i.test(k)).map((k) => caches.delete(k)));
    }
  } catch {
    /* on recharge quand même */
  }
  await wait(50);
  hardReload();
}

export function installUpdateHandlers(onNewVersion: () => void) {
  // nettoie le paramètre ajouté par le rechargement forcé
  const u = new URL(window.location.href);
  if (u.searchParams.has('v')) {
    u.searchParams.delete('v');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
  // Service hors ligne : l'application reste utilisable sans réseau une fois ouverte une première fois
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    registerSW({
      onNeedRefresh: () => onNewVersion(),
      onOfflineReady: () => {},
    });
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
